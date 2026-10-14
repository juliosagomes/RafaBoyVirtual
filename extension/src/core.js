/*
 * Núcleo de conversão: recebe os anexos (nome + bytes), expande os .zip em
 * pastas (recursivamente, inclusive .zip dentro de .zip), converte .txt e .csv
 * em .pdf e devolve um único .zip com tudo.
 *
 * Não depende do Chrome: as bibliotecas (JSZip, jsPDF, autoTable) são
 * injetadas, o que permite usar o mesmo código na extensão e nos testes (Node).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZipPdfCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_ZIP_DEPTH = 10;
  const IGNORED_ENTRIES = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;

  // Tabela CP850 (0x80–0xFF): codificação usada pelo Windows/DOS em nomes de
  // arquivos dentro de .zip sem a flag UTF-8 (comum no Brasil).
  const CP850_HIGH =
    'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐' +
    '└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ';

  // ---------------------------------------------------------------- utilidades

  function extOf(name) {
    const base = name.split('/').pop();
    const i = base.lastIndexOf('.');
    return i > 0 ? base.slice(i + 1).toLowerCase() : '';
  }

  function stripExt(path) {
    const slash = path.lastIndexOf('/');
    const dot = path.lastIndexOf('.');
    return dot > slash + 1 ? path.slice(0, dot) : path;
  }

  function toUint8(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new Uint8Array(data);
  }

  function looksLikeZip(bytes) {
    // PK\x03\x04 (arquivo normal) ou PK\x05\x06 (zip vazio)
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
      ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06));
  }

  /** Normaliza um caminho para dentro do zip de saída (sem "..", "/" inicial etc.). */
  function sanitizePath(path) {
    return String(path)
      .replace(/\\/g, '/')
      .split('/')
      .map((seg) => seg.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim())
      .filter((seg) => seg && seg !== '.' && seg !== '..')
      .join('/');
  }

  function decodeFileName(bytes) {
    const arr = toUint8(bytes);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(arr);
    } catch (e) {
      let s = '';
      for (const b of arr) s += b < 0x80 ? String.fromCharCode(b) : CP850_HIGH[b - 0x80];
      return s;
    }
  }

  /** Decodifica texto detectando BOM; sem BOM tenta UTF-8 e cai para Windows-1252. */
  function decodeText(bytes) {
    const b = toUint8(bytes);
    if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(b.subarray(3));
    }
    if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
    if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(b);
    } catch (e) {
      return new TextDecoder('windows-1252').decode(b);
    }
  }

  // As fontes padrão do PDF (Helvetica/Courier) só cobrem Latin-1; o resto é
  // trocado por equivalentes ASCII ou "?".
  const CHAR_REPLACEMENTS = {
    '‘': "'", '’': "'", '‚': "'", '‛': "'",
    '“': '"', '”': '"', '„': '"', '″': '"',
    '–': '-', '—': '-', '−': '-', '‐': '-', '‑': '-',
    '…': '...', '•': '*', '·': '·', '€': 'EUR',
    '™': '(TM)', '→': '->', '←': '<-', '≤': '<=', '≥': '>=',
    ' ': ' ', ' ': ' ', '​': '', '﻿': '',
  };

  function pdfSafe(text, tabSize) {
    let out = '';
    let col = 0;
    for (const ch of String(text)) {
      if (ch === '\t') {
        const n = tabSize - (col % tabSize);
        out += ' '.repeat(n);
        col += n;
        continue;
      }
      const code = ch.codePointAt(0);
      let r;
      if (code < 0x20 || (code >= 0x7f && code < 0xa0)) r = '';
      else if (CHAR_REPLACEMENTS[ch] !== undefined) r = CHAR_REPLACEMENTS[ch];
      else if (code <= 0xff) r = ch;
      else r = '?';
      out += r;
      col += r.length;
    }
    return out;
  }

  // --------------------------------------------------------------------- CSV

  function detectDelimiter(text) {
    const sample = text.slice(0, 64 * 1024).split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 20);
    if (!sample.length) return ',';
    let best = ',';
    let bestScore = -1;
    for (const d of [';', ',', '\t', '|']) {
      const counts = sample.map((line) => {
        let n = 0;
        let inQ = false;
        for (const ch of line) {
          if (ch === '"') inQ = !inQ;
          else if (ch === d && !inQ) n++;
        }
        return n;
      });
      const first = counts[0];
      if (!first) continue;
      const consistent = counts.filter((c) => c === first).length;
      const score = consistent * 1000 + first;
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return best;
  }

  /** Parser CSV (RFC 4180): aspas, aspas escapadas e quebras de linha dentro de campos. */
  function parseCsv(text, delimiter) {
    const d = delimiter || detectDelimiter(text);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else inQuotes = false;
        } else field += ch;
      } else if (ch === '"' && field === '') inQuotes = true;
      else if (ch === d) {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    // descarta linhas totalmente vazias
    const clean = rows.filter((r) => r.some((c) => c.trim() !== ''));
    const width = clean.reduce((m, r) => Math.max(m, r.length), 0);
    return { delimiter: d, rows: clean.map((r) => r.concat(Array(width - r.length).fill(''))) };
  }

  // --------------------------------------------------------------------- PDF

  function drawHeaderFooter(doc, title) {
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    const page = doc.internal.getCurrentPageInfo().pageNumber;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(doc.splitTextToSize(pdfSafe(title, 4), w - 30)[0] || '', 10, 7);
    doc.text(`Página ${page}`, w - 10, h - 5, { align: 'right' });
    doc.setTextColor(0);
  }

  function txtToPdf(bytes, title, deps) {
    const text = decodeText(bytes).replace(/\r\n?/g, '\n');
    const lines = text.split('\n').map((l) => pdfSafe(l, 4));
    while (lines.length && lines[lines.length - 1] === '') lines.pop();

    const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
    const landscape = longest > 100;
    const doc = new deps.jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
    const fontSize = 9;
    const lineH = fontSize * 0.3528 * 1.25; // pt -> mm, entrelinha 1.25
    const margin = 12;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const maxW = pageW - margin * 2;

    drawHeaderFooter(doc, title);
    doc.setFont('courier', 'normal');
    doc.setFontSize(fontSize);
    let y = margin;

    if (!lines.length) {
      doc.text('(arquivo vazio)', margin, y + lineH);
      return doc.output('arraybuffer');
    }
    for (const line of lines) {
      const wrapped = line === '' ? [''] : doc.splitTextToSize(line, maxW);
      for (const part of wrapped) {
        if (y + lineH > pageH - margin) {
          doc.addPage();
          drawHeaderFooter(doc, title);
          doc.setFont('courier', 'normal');
          doc.setFontSize(fontSize);
          y = margin;
        }
        y += lineH;
        doc.text(part, margin, y);
      }
    }
    return doc.output('arraybuffer');
  }

  function csvToPdf(bytes, title, deps) {
    const { rows } = parseCsv(decodeText(bytes));
    const doc = new deps.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    if (!rows.length) {
      drawHeaderFooter(doc, title);
      doc.setFontSize(10);
      doc.text('(arquivo vazio)', 12, 20);
      return doc.output('arraybuffer');
    }
    const safe = rows.map((r) => r.map((c) => pdfSafe(c, 4)));
    const cols = safe[0].length;
    deps.autoTable(doc, {
      head: [safe[0]],
      body: safe.slice(1),
      startY: 12,
      margin: { top: 12, right: 8, bottom: 12, left: 8 },
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: cols > 12 ? 6 : 7.5,
        cellPadding: 1,
        overflow: 'linebreak',
        minCellWidth: 12,
      },
      headStyles: { fillColor: [66, 103, 178], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [244, 246, 250] },
      horizontalPageBreak: true,
      horizontalPageBreakRepeat: 0,
      didDrawPage: () => drawHeaderFooter(doc, title),
    });
    return doc.output('arraybuffer');
  }

  // --------------------------------------------------------------- montagem

  /**
   * @param {Array<{name: string, data: ArrayBuffer|Uint8Array}>} attachments
   * @param {{JSZip, jsPDF, autoTable}} deps
   * @param {{onLog?: Function, outputType?: string}} [opts]
   */
  async function buildOutputZip(attachments, deps, opts = {}) {
    const log = opts.onLog || (() => {});
    const out = new deps.JSZip();
    const usedFiles = new Set();
    const usedFolders = new Set();
    const stats = { zips: 0, txt: 0, csv: 0, copied: 0, errors: 0 };

    const uniqueFile = (path) => {
      let candidate = path;
      for (let n = 2; usedFiles.has(candidate.toLowerCase()) || usedFolders.has(candidate.toLowerCase()); n++) {
        const base = stripExt(path);
        const ext = path.slice(base.length);
        candidate = `${base} (${n})${ext}`;
      }
      usedFiles.add(candidate.toLowerCase());
      return candidate;
    };

    const uniqueFolder = (path) => {
      let candidate = path;
      for (let n = 2; usedFolders.has(candidate.toLowerCase()) || usedFiles.has(candidate.toLowerCase()); n++) {
        candidate = `${path} (${n})`;
      }
      usedFolders.add(candidate.toLowerCase());
      return candidate;
    };

    const addRaw = (path, bytes, date) => {
      out.file(uniqueFile(path), bytes, date ? { date } : undefined);
      stats.copied++;
    };

    async function addFile(path, bytes, depth, date) {
      const ext = extOf(path);
      if (ext === 'zip' && looksLikeZip(bytes) && depth < MAX_ZIP_DEPTH) {
        try {
          const zip = await deps.JSZip.loadAsync(bytes, { decodeFileName });
          const folder = uniqueFolder(stripExt(path) || 'zip');
          out.folder(folder);
          stats.zips++;
          log(`📦 Extraindo ${path}`);
          await expand(zip, folder, depth + 1);
          return;
        } catch (e) {
          stats.errors++;
          log(`⚠️ Não foi possível abrir ${path} (${e.message}); mantido como .zip`, 'warn');
          addRaw(path, bytes, date);
          return;
        }
      }
      if (ext === 'txt' || ext === 'csv') {
        try {
          const title = path.split('/').pop();
          const pdf = ext === 'txt' ? txtToPdf(bytes, title, deps) : csvToPdf(bytes, title, deps);
          out.file(uniqueFile(`${stripExt(path)}.pdf`), pdf, date ? { date } : undefined);
          stats[ext]++;
          log(`📝 ${path} → PDF`);
        } catch (e) {
          stats.errors++;
          log(`⚠️ Falha ao converter ${path} (${e.message}); mantido original`, 'warn');
          addRaw(path, bytes, date);
        }
        return;
      }
      addRaw(path, bytes, date);
    }

    async function expand(zip, folder, depth) {
      const entries = Object.values(zip.files).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (IGNORED_ENTRIES.test(entry.name)) continue;
        const rel = sanitizePath(entry.name);
        if (!rel) continue;
        const full = `${folder}/${rel}`;
        if (entry.dir) {
          out.folder(full);
          continue;
        }
        const bytes = await entry.async('uint8array');
        await addFile(full, bytes, depth, entry.date);
      }
    }

    for (const att of attachments) {
      const name = sanitizePath(att.name) || 'anexo';
      await addFile(name, toUint8(att.data), 0);
    }

    log('🗜️ Gerando o .zip final…');
    const content = await out.generateAsync({
      type: opts.outputType || 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      mimeType: 'application/zip',
    });
    return { content, stats };
  }

  return {
    buildOutputZip,
    // exportados para testes
    parseCsv,
    detectDelimiter,
    decodeText,
    decodeFileName,
    sanitizePath,
    pdfSafe,
    txtToPdf,
    csvToPdf,
    CP850_HIGH,
  };
});
