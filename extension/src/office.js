/*
 * Conversores de documentos do Office para PDF, registrados no núcleo:
 *   - .docx (e .docs): mammoth → HTML simples → PDF com títulos, negrito/itálico,
 *     listas, tabelas e imagens;
 *   - .doc (Word 97–2003): extração do texto do arquivo binário (sem formatação);
 *   - .xlsx / .xls: SheetJS → uma tabela por planilha.
 *
 * O conteúdo é identificado pelos bytes, não só pela extensão: um ".doc" que na
 * verdade é .docx, RTF ou HTML também é convertido.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.ZipPdfOffice = factory(root.ZipPdfCore);
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  const { pdfSafe, decodeText, drawHeaderFooter, renderTable, emptyPdf, looksLikeZip, toUint8 } = core.helpers;
  const PT = 0.3528; // 1pt em mm

  function isCfb(b) {
    return b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
  }

  function startsWithText(b, prefix) {
    const head = new TextDecoder('latin1').decode(b.subarray(0, 512)).replace(/^﻿|^ï»¿/, '').trimStart();
    return head.toLowerCase().startsWith(prefix);
  }

  // ------------------------------------------------------------------------
  // Escrita de texto corrido com quebra de linha, estilos e paginação.

  class FlowWriter {
    constructor(doc, title) {
      this.doc = doc;
      this.title = title;
      this.margin = 16;
      this.top = 14;
      this.pageW = doc.internal.pageSize.getWidth();
      this.pageH = doc.internal.pageSize.getHeight();
      this.y = this.top;
      this.empty = true;
      drawHeaderFooter(doc, title);
    }

    newPage() {
      this.doc.addPage();
      drawHeaderFooter(this.doc, this.title);
      this.y = this.top;
    }

    ensure(h) {
      if (this.y + h > this.pageH - this.margin) this.newPage();
    }

    space(mm) {
      this.y += mm;
    }

    font(style, size) {
      const s = style.bold && style.italic ? 'bolditalic' : style.bold ? 'bold' : style.italic ? 'italic' : 'normal';
      this.doc.setFont('helvetica', s);
      this.doc.setFontSize(size);
    }

    /**
     * runs: [{ text, bold, italic, underline, link } | { br: true }]
     * opts: { size, bold, indent, bullet, before, after }
     */
    paragraph(runs, opts = {}) {
      const doc = this.doc;
      const size = opts.size || 10.5;
      const lineH = size * PT * 1.35;
      const x0 = this.margin + (opts.indent || 0);
      const maxW = this.pageW - this.margin - x0;

      const pieces = [];
      for (const run of runs) {
        if (run.br) {
          pieces.push({ br: true });
          continue;
        }
        const style = { ...run, bold: run.bold || opts.bold };
        for (const part of pdfSafe(run.text, 4).split(/(\s+)/)) {
          if (part) pieces.push({ text: part.replace(/\s+/g, ' '), style, space: /^\s+$/.test(part) });
        }
      }
      if (!pieces.some((p) => p.text && !p.space) && !opts.bullet) {
        this.space(size * PT * 0.6);
        return;
      }

      const measure = (p) => {
        this.font(p.style, size);
        return doc.getTextWidth(p.text);
      };
      const lines = [];
      let line = [];
      let w = 0;
      const flush = () => {
        while (line.length && line[line.length - 1].space) line.pop();
        lines.push(line);
        line = [];
        w = 0;
      };
      for (const p of pieces) {
        if (p.br) {
          flush();
          continue;
        }
        if (p.space && !line.length) continue;
        let pw = measure(p);
        if (w + pw > maxW && line.length) {
          flush();
          if (p.space) continue;
        }
        // palavra maior que a linha inteira: quebra por caractere
        if (pw > maxW) {
          let chunk = '';
          for (const ch of p.text) {
            const test = chunk + ch;
            if (measure({ ...p, text: test }) > maxW && chunk) {
              line.push({ ...p, text: chunk, w: measure({ ...p, text: chunk }) });
              flush();
              chunk = ch;
            } else chunk = test;
          }
          p.text = chunk;
          pw = measure(p);
        }
        line.push({ ...p, w: pw });
        w += pw;
      }
      flush();

      if (!this.empty) this.space(opts.before || 0);
      lines.forEach((ln, i) => {
        this.ensure(lineH);
        this.y += lineH;
        if (i === 0 && opts.bullet) {
          this.font({}, size);
          doc.text(pdfSafe(opts.bullet, 4), x0 - 1.5, this.y, { align: 'right' });
        }
        let x = x0;
        for (const p of ln) {
          this.font(p.style, size);
          if (p.style.link) doc.setTextColor(26, 13, 171);
          doc.text(p.text, x, this.y);
          if ((p.style.underline || p.style.link) && !p.space) {
            doc.setDrawColor(p.style.link ? 26 : 0, p.style.link ? 13 : 0, p.style.link ? 171 : 0);
            doc.setLineWidth(0.2);
            doc.line(x, this.y + 0.7, x + p.w, this.y + 0.7);
          }
          doc.setTextColor(0);
          x += p.w;
        }
      });
      this.y += opts.after != null ? opts.after : size * PT * 0.6;
      this.empty = false;
    }

    image(src) {
      const doc = this.doc;
      try {
        const props = doc.getImageProperties(src);
        let w = (props.width * 25.4) / 96;
        let h = (props.height * 25.4) / 96;
        const maxW = this.pageW - this.margin * 2;
        const maxH = this.pageH - this.top - this.margin - 2;
        const scale = Math.min(1, maxW / w, maxH / h);
        w *= scale;
        h *= scale;
        this.ensure(h + 2);
        doc.addImage(src, props.fileType, this.margin, this.y + 1, w, h);
        this.y += h + 3;
        this.empty = false;
      } catch (e) {
        this.paragraph([{ text: '[imagem não suportada]', italic: true }], { size: 9 });
      }
    }

    table(rows, head, deps) {
      if (!rows.length) return;
      this.ensure(12);
      const finalY = renderTable(this.doc, rows, this.title, deps, {
        startY: this.empty ? this.top : this.y + 1.5,
        head,
        marginX: this.margin,
        fontSize: 8.5,
        striped: false,
      });
      this.y = finalY + 3;
      this.empty = false;
    }

    hr() {
      this.ensure(4);
      this.doc.setDrawColor(180);
      this.doc.setLineWidth(0.3);
      this.doc.line(this.margin, this.y + 2, this.pageW - this.margin, this.y + 2);
      this.doc.setDrawColor(0);
      this.y += 4;
    }
  }

  // ------------------------------------------------------------------------
  // Mini parser do HTML gerado pelo mammoth (bem formado e com poucas tags).

  const VOID_TAGS = new Set(['br', 'img', 'hr', 'col', 'meta', 'link', 'input']);

  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
      const k = e.toLowerCase();
      if (k[0] === '#') {
        const code = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
        try {
          return String.fromCodePoint(code);
        } catch (err) {
          return '';
        }
      }
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[k];
    });
  }

  function parseAttrs(s) {
    const attrs = {};
    const re = /([^\s=\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let m;
    while ((m = re.exec(s))) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
    return attrs;
  }

  function parseHtml(html) {
    const root = { tag: 'root', attrs: {}, children: [] };
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)|</g;
    let m;
    while ((m = re.exec(html))) {
      const top = stack[stack.length - 1];
      if (m[5] !== undefined) {
        top.children.push({ text: decodeEntities(m[5]) });
      } else if (m[2]) {
        const tag = m[2].toLowerCase();
        if (m[1]) {
          const idx = stack.map((n) => n.tag).lastIndexOf(tag);
          if (idx > 0) stack.length = idx;
        } else {
          const node = { tag, attrs: parseAttrs(m[3]), children: [] };
          top.children.push(node);
          if (!m[4] && !VOID_TAGS.has(tag)) stack.push(node);
        }
      }
    }
    return root;
  }

  // ------------------------------------------------------------------------
  // HTML → PDF

  const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'div', 'blockquote', 'hr']);
  const HEADING_SIZES = { h1: 18, h2: 15, h3: 13, h4: 12, h5: 11, h6: 11 };

  function inlineItems(node, style, out) {
    for (const c of node.children) {
      if (c.text !== undefined) {
        out.push({ ...style, text: c.text });
        continue;
      }
      switch (c.tag) {
        case 'strong':
        case 'b':
          inlineItems(c, { ...style, bold: true }, out);
          break;
        case 'em':
        case 'i':
          inlineItems(c, { ...style, italic: true }, out);
          break;
        case 'u':
          inlineItems(c, { ...style, underline: true }, out);
          break;
        case 'a':
          inlineItems(c, c.attrs.href && !c.attrs.href.startsWith('#') ? { ...style, link: true } : style, out);
          break;
        case 'br':
          out.push({ br: true });
          break;
        case 'img':
          out.push({ img: c.attrs.src || '' });
          break;
        default:
          inlineItems(c, style, out);
      }
    }
    return out;
  }

  /** Desenha conteúdo inline; imagens interrompem o parágrafo e são desenhadas em bloco. */
  function renderInline(w, nodes, opts) {
    const items = inlineItems({ children: nodes }, {}, []);
    let runs = [];
    let first = true;
    const flushRuns = (force) => {
      if (runs.length || (force && first)) {
        w.paragraph(runs, first ? opts : { ...opts, bullet: undefined, before: 0 });
        first = false;
      }
      runs = [];
    };
    for (const it of items) {
      if (it.img !== undefined) {
        if (runs.some((r) => r.text && r.text.trim()) || (first && opts.bullet)) flushRuns(true);
        runs = [];
        if (it.img) w.image(it.img);
        first = false;
      } else runs.push(it);
    }
    if (runs.some((r) => r.br || (r.text && r.text.trim()))) flushRuns(false);
    else if (first) flushRuns(true);
  }

  function cellText(node) {
    let s = '';
    const walk = (n) => {
      for (const c of n.children) {
        if (c.text !== undefined) s += c.text;
        else if (c.tag === 'br') s += '\n';
        else if (c.tag === 'img') s += '[imagem]';
        else if (BLOCK_TAGS.has(c.tag)) {
          if (s && !s.endsWith('\n')) s += '\n';
          if (c.tag === 'li') s += '• ';
          walk(c);
          if (!s.endsWith('\n')) s += '\n';
        } else walk(c);
      }
    };
    walk(node);
    return s.replace(/\n+$/, '');
  }

  function tableRows(table) {
    const rows = [];
    let head = false;
    const walk = (n, inHead) => {
      for (const c of n.children) {
        if (c.text !== undefined) continue;
        if (c.tag === 'tr') {
          const cells = c.children.filter((td) => td.tag === 'td' || td.tag === 'th');
          if (rows.length === 0 && (inHead || (cells.length && cells.every((td) => td.tag === 'th')))) head = true;
          rows.push(
            cells.map((td) => {
              const content = cellText(td);
              const colSpan = Number(td.attrs.colspan) || 1;
              const rowSpan = Number(td.attrs.rowspan) || 1;
              return colSpan > 1 || rowSpan > 1 ? { content, colSpan, rowSpan } : content;
            }),
          );
        } else if (c.tag !== 'table') walk(c, inHead || c.tag === 'thead');
      }
    };
    walk(table, false);
    return { rows: rows.filter((r) => r.length), head };
  }

  function renderBlocks(w, node, ctx, deps) {
    let inline = [];
    const flush = () => {
      if (inline.some((c) => c.text === undefined || c.text.trim())) renderInline(w, inline, { indent: ctx.indent });
      inline = [];
    };
    for (const c of node.children) {
      if (c.text === undefined && BLOCK_TAGS.has(c.tag)) {
        flush();
        renderBlock(w, c, ctx, deps);
      } else inline.push(c);
    }
    flush();
  }

  function renderBlock(w, node, ctx, deps) {
    const tag = node.tag;
    if (HEADING_SIZES[tag]) {
      renderInline(w, node.children, { indent: ctx.indent, size: HEADING_SIZES[tag], bold: true, before: 3, after: 1.5 });
    } else if (tag === 'p') {
      renderInline(w, node.children, { indent: ctx.indent });
    } else if (tag === 'ul' || tag === 'ol') {
      let n = Number(node.attrs.start) || 1;
      for (const li of node.children.filter((c) => c.tag === 'li')) {
        renderListItem(w, li, { indent: ctx.indent + 7, bullet: tag === 'ol' ? `${n++}.` : '•' }, deps);
      }
    } else if (tag === 'table') {
      const { rows, head } = tableRows(node);
      w.table(rows, head, deps);
    } else if (tag === 'hr') {
      w.hr();
    } else {
      renderBlocks(w, node, ctx, deps);
    }
  }

  function renderListItem(w, li, ctx, deps) {
    let bullet = ctx.bullet;
    let inline = [];
    const flush = (force) => {
      if (inline.some((c) => c.text === undefined || c.text.trim()) || (force && bullet)) {
        renderInline(w, inline, { indent: ctx.indent, bullet, after: 1 });
        bullet = undefined;
      }
      inline = [];
    };
    for (const c of li.children) {
      if (c.text === undefined && BLOCK_TAGS.has(c.tag)) {
        if (c.tag === 'p' && bullet && !inline.length) {
          inline = c.children;
          flush(true);
          continue;
        }
        flush(c.tag !== 'ul' && c.tag !== 'ol');
        renderBlock(w, c, { indent: ctx.indent }, deps);
      } else inline.push(c);
    }
    flush(true);
  }

  function htmlToPdf(html, title, deps) {
    const doc = new deps.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const w = new FlowWriter(doc, title);
    renderBlocks(w, parseHtml(html), { indent: 0 }, deps);
    if (w.empty) w.paragraph([{ text: '(documento sem texto)', italic: true }]);
    return doc.output('arraybuffer');
  }

  // ------------------------------------------------------------------------
  // .docx

  async function docxToPdf(bytes, title, deps) {
    if (!deps.mammoth) throw new Error('biblioteca mammoth não carregada');
    const u8 = toUint8(bytes);
    const input = { arrayBuffer: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) };
    if (typeof Buffer !== 'undefined') input.buffer = Buffer.from(u8);
    const { value } = await deps.mammoth.convertToHtml(input);
    return htmlToPdf(value, title, deps);
  }

  // ------------------------------------------------------------------------
  // .doc (Word 97–2003, formato binário): texto do documento principal.

  const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

  function readDocText(bytes, deps) {
    const CFB = deps.CFB || (deps.XLSX && deps.XLSX.CFB);
    if (!CFB) throw new Error('biblioteca CFB (SheetJS) não carregada');
    const cfb = CFB.read(bytes, { type: 'array' });
    const wdEntry = CFB.find(cfb, 'WordDocument');
    if (!wdEntry) {
      if (CFB.find(cfb, 'EncryptedPackage')) throw new Error('documento protegido por senha');
      throw new Error('não é um documento do Word');
    }
    const wd = toUint8(wdEntry.content);
    const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
    if (dv.getUint16(0, true) !== 0xa5ec) throw new Error('formato do Word não reconhecido');
    if (dv.getUint16(2, true) < 101) throw new Error('Word 6/95 não suportado');
    const flags = dv.getUint16(0x0a, true);
    if (flags & 0x0100) throw new Error('documento protegido por senha');
    const tableEntry = CFB.find(cfb, flags & 0x0200 ? '1Table' : '0Table');
    if (!tableEntry) throw new Error('tabela do documento não encontrada');
    const tbl = toUint8(tableEntry.content);
    const tv = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength);

    const ccpText = dv.getUint32(0x4c, true);
    const fcClx = dv.getUint32(0x1a2, true);
    const lcbClx = dv.getUint32(0x1a6, true);
    let pos = fcClx;
    const end = fcClx + lcbClx;
    while (pos < end && tbl[pos] === 0x01) pos += 3 + tv.getInt16(pos + 1, true); // Prc (formatação), ignorado
    if (tbl[pos] !== 0x02) throw new Error('estrutura do documento inválida');
    const lcb = tv.getUint32(pos + 1, true);
    const plc = pos + 5;
    const n = (lcb - 4) / 12;

    let text = '';
    for (let i = 0; i < n && text.length < ccpText; i++) {
      const cpStart = tv.getUint32(plc + i * 4, true);
      const cpEnd = tv.getUint32(plc + (i + 1) * 4, true);
      let fc = tv.getUint32(plc + (n + 1) * 4 + i * 8 + 2, true);
      const compressed = (fc & 0x40000000) !== 0;
      fc &= 0x3fffffff;
      const len = cpEnd - cpStart;
      if (compressed) {
        const off = fc / 2;
        for (let k = 0; k < len && off + k < wd.length; k++) {
          const b = wd[off + k];
          text += b >= 0x80 && b < 0xa0 ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b);
        }
      } else {
        text += new TextDecoder('utf-16le').decode(wd.subarray(fc, Math.min(fc + len * 2, wd.length)));
      }
    }
    return cleanWordText(text.slice(0, ccpText));
  }

  function cleanWordText(raw) {
    // Campos: \x13 código \x14 resultado \x15 → mantém só o resultado.
    let out = '';
    const stack = [];
    for (const ch of raw) {
      if (ch === '\x13') stack.push(false);
      else if (ch === '\x14') {
        if (stack.length) stack[stack.length - 1] = true;
      } else if (ch === '\x15') stack.pop();
      else if (!stack.length || stack[stack.length - 1]) out += ch;
    }
    return out
      .replace(/\x07\x07/g, '\x07\r') // fim de linha de tabela
      .replace(/\x07/g, ' | ')
      .replace(/( \| )+(?=\r|$)/g, '')
      .replace(/[\r\x0b]/g, '\n')
      .replace(/\x1e/g, '-')
      .replace(/[\x01\x02\x03\x04\x05\x08\x1f]/g, '');
  }

  function plainTextToPdf(text, title, deps) {
    const doc = new deps.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const w = new FlowWriter(doc, title);
    const pages = text.split('\x0c');
    pages.forEach((page, i) => {
      if (i > 0 && !w.empty) w.newPage();
      for (const line of page.split('\n')) w.paragraph([{ text: line }], { after: 1.2 });
    });
    if (w.empty) w.paragraph([{ text: '(documento sem texto)', italic: true }]);
    return doc.output('arraybuffer');
  }

  // ------------------------------------------------------------------------
  // RTF (alguns sistemas salvam .doc como RTF)

  function rtfToText(rtf) {
    const SKIP = /^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer|headerl|headerr|footerl|footerr|listtable|listoverridetable|rsidtbl|xmlnstbl|themedata|colorschememapping|latentstyles|datastore|generator|filetbl|revtbl)$/;
    let out = '';
    let i = 0;
    let uc = 1;
    let skipChars = 0;
    const stack = [];
    let skipping = false;
    while (i < rtf.length) {
      const ch = rtf[i];
      if (ch === '{') {
        stack.push({ skipping, uc });
        i++;
        if (rtf.startsWith('\\*', i)) skipping = true;
      } else if (ch === '}') {
        const st = stack.pop() || { skipping: false, uc: 1 };
        skipping = st.skipping;
        uc = st.uc;
        i++;
      } else if (ch === '\\') {
        const m = /^\\([a-zA-Z]+)(-?\d+)? ?|^\\'([0-9a-fA-F]{2})|^\\([^a-zA-Z])/.exec(rtf.slice(i, i + 40));
        if (!m) {
          i++;
          continue;
        }
        i += m[0].length;
        if (m[3]) {
          if (skipChars) skipChars--;
          else if (!skipping) {
            const b = parseInt(m[3], 16);
            out += b >= 0x80 && b < 0xa0 ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b);
          }
        } else if (m[4]) {
          if (!skipping) out += { '\\': '\\', '{': '{', '}': '}', '~': ' ', '-': '', _: '-' }[m[4]] ?? '';
        } else {
          const word = m[1];
          const arg = m[2] !== undefined ? Number(m[2]) : null;
          if (SKIP.test(word)) skipping = true;
          else if (skipping) continue;
          else if (word === 'par' || word === 'line' || word === 'row') out += '\n';
          else if (word === 'tab') out += '\t';
          else if (word === 'cell') out += ' | ';
          else if (word === 'page') out += '\x0c';
          else if (word === 'uc') uc = arg ?? 1;
          else if (word === 'u' && arg !== null) {
            out += String.fromCharCode(arg < 0 ? arg + 65536 : arg);
            skipChars = uc;
          }
        }
      } else {
        if (ch !== '\r' && ch !== '\n') {
          if (skipChars) skipChars--;
          else if (!skipping) out += ch;
        }
        i++;
      }
    }
    return out.replace(/( \| )+\n/g, '\n');
  }

  function htmlDocToText(html) {
    return decodeEntities(
      html
        .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
        .replace(/<\/t[dh]>/gi, ' | ')
        .replace(/<[^>]+>/g, ''),
    ).replace(/[ \t]+\n/g, '\n');
  }

  /** Word em qualquer variante (.doc, .docx, RTF, HTML), identificado pelo conteúdo. */
  async function wordToPdf(bytes, title, deps) {
    const b = toUint8(bytes);
    if (looksLikeZip(b)) return docxToPdf(b, title, deps);
    if (isCfb(b)) return plainTextToPdf(readDocText(b, deps), title, deps);
    if (startsWithText(b, '{\\rtf')) return plainTextToPdf(rtfToText(new TextDecoder('latin1').decode(b)), title, deps);
    if (startsWithText(b, '<')) return htmlToPdf(decodeText(b).replace(/^[\s\S]*?<body[^>]*>|<\/body>[\s\S]*$/gi, ''), title, deps);
    if (b.length === 0) return plainTextToPdf('', title, deps);
    throw new Error('formato de documento do Word não reconhecido');
  }

  // ------------------------------------------------------------------------
  // .xlsx / .xls

  /** Números no padrão brasileiro: 1,234.57 → 1.234,57 (datas e textos ficam como estão). */
  function localizeNumbers(ws, XLSX) {
    const fix = (cell) => {
      if (!cell || cell.t !== 'n' || typeof cell.w !== 'string') return;
      if (cell.z && XLSX.SSF.is_date(cell.z)) return;
      cell.w = cell.w.replace(/[.,]/g, (c) => (c === '.' ? ',' : '.'));
    };
    if (ws['!data']) ws['!data'].forEach((row) => row && row.forEach(fix));
    else Object.keys(ws).forEach((k) => k[0] !== '!' && fix(ws[k]));
  }

  function excelToPdf(bytes, title, deps) {
    const XLSX = deps.XLSX;
    if (!XLSX) throw new Error('biblioteca SheetJS não carregada');
    const wb = XLSX.read(toUint8(bytes), { type: 'array', dense: true });
    const doc = new deps.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const meta = (wb.Workbook && wb.Workbook.Sheets) || [];
    let pages = 0;

    wb.SheetNames.forEach((name, idx) => {
      const ws = wb.Sheets[name];
      if (!ws || !ws['!ref']) return;
      localizeNumbers(ws, XLSX);
      let rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
      const width = rows.reduce((m, r) => {
        for (let c = r.length - 1; c >= 0; c--) if (String(r[c]).trim() !== '') return Math.max(m, c + 1);
        return m;
      }, 0);
      rows = rows.map((r) => Array.from({ length: width }, (_, c) => String(r[c] ?? ''))).filter((r) => r.some((c) => c.trim()));
      if (!rows.length) return;

      if (pages++) doc.addPage();
      drawHeaderFooter(doc, title);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      const hidden = meta[idx] && meta[idx].Hidden ? ' (oculta)' : '';
      doc.text(pdfSafe(`Planilha: ${name}${hidden}`, 4), 8, 15);
      renderTable(doc, rows, title, deps, { startY: 18 });
    });

    if (!pages) return emptyPdf(doc, title, '(planilha vazia)');
    return doc.output('arraybuffer');
  }

  core.registerConverter(['docx', 'docs', 'doc'], wordToPdf);
  // SheetJS também reconhece CSV/HTML salvos com extensão .xls.
  core.registerConverter(['xlsx', 'xls'], excelToPdf);

  return { parseHtml, rtfToText, cleanWordText, readDocText, wordToPdf, excelToPdf, htmlToPdf };
});
