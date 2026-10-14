const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const JSZip = require('jszip');
const { jsPDF } = require('jspdf');
const { autoTable } = require('jspdf-autotable');
const mammoth = require('mammoth');
const XLSX = require('@e965/xlsx');
const core = require('../extension/src/core.js');
const office = require('../extension/src/office.js');

const deps = { JSZip, jsPDF, autoTable, mammoth, XLSX };
const FIXTURES = path.join(__dirname, 'fixtures');
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name));
const OUT = path.join(__dirname, 'out');

function hasPdftotext() {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function pdfText(bytes, name) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, bytes);
  return execFileSync('pdftotext', ['-layout', file, '-']).toString('utf8');
}

const latin1 = (s) => Buffer.from(s, 'latin1');

test('CP850 table has 128 entries', () => {
  assert.strictEqual([...core.CP850_HIGH].length, 128);
});

test('CSV parsing: delimiter detection, quotes and multi-line fields', () => {
  const { delimiter, rows } = core.parseCsv('nome;valor;obs\n"Silva; J";10,5;"linha1\nlinha2"\n\nAna;3;"diz ""oi"""\n');
  assert.strictEqual(delimiter, ';');
  assert.deepStrictEqual(rows, [
    ['nome', 'valor', 'obs'],
    ['Silva; J', '10,5', 'linha1\nlinha2'],
    ['Ana', '3', 'diz "oi"'],
  ]);
  assert.strictEqual(core.parseCsv('a,b\n1,2').delimiter, ',');
  assert.strictEqual(core.parseCsv('a\tb\n1\t2').delimiter, '\t');
});

test('text decoding: UTF-8, BOM and Windows-1252', () => {
  assert.strictEqual(core.decodeText(Buffer.from('ação', 'utf8')), 'ação');
  assert.strictEqual(core.decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('é')])), 'é');
  assert.strictEqual(core.decodeText(latin1('Relatório São Paulo')), 'Relatório São Paulo');
});

test('zip file names in CP850 are decoded', () => {
  // "relatório.txt" em CP850: ó = 0xA2
  const bytes = Buffer.from([...Buffer.from('relat'), 0xa2, ...Buffer.from('rio.txt')]);
  assert.strictEqual(core.decodeFileName(bytes), 'relatório.txt');
});

test('paths are sanitized', () => {
  assert.strictEqual(core.sanitizePath('../../etc/passwd'), 'etc/passwd');
  assert.strictEqual(core.sanitizePath('a\\b\\c.txt'), 'a/b/c.txt');
  assert.strictEqual(core.sanitizePath('/x/./y:z.txt'), 'x/y_z.txt');
});

test('builds output zip: zips become folders, txt/csv become pdf, others copied', async () => {
  const inner = new JSZip();
  inner.file('profundo/nota.txt', 'arquivo dentro de zip aninhado');
  inner.file('tabela.CSV', 'a,b\n1,2\n');
  const innerBytes = await inner.generateAsync({ type: 'uint8array' });

  const z1 = new JSZip();
  z1.file('leia-me.txt', latin1('Relatório de produção\tcom acentuação (Windows-1252)\n' + 'x'.repeat(300) + '\n'));
  z1.file('dados/vendas.csv', 'Produto;Preço;Qtd\nCafé;12,50;3\n"Pão; francês";0,80;10\n');
  z1.file('dados/sub/imagem.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  z1.file('dados/sub/interno.zip', innerBytes);
  z1.file('__MACOSX/._leia-me.txt', 'lixo');
  z1.file('leia-me.pdf', '%PDF-existing');
  z1.folder('vazia');
  const z1Bytes = await z1.generateAsync({ type: 'uint8array' });

  const z2 = new JSZip();
  z2.file('outro.txt', '');
  const z2Bytes = await z2.generateAsync({ type: 'uint8array' });

  const logs = [];
  const { content, stats } = await core.buildOutputZip(
    [
      { name: 'Lote 1.zip', data: z1Bytes },
      { name: 'lote2.zip', data: z2Bytes },
      { name: 'solto.csv', data: Buffer.from('x,y\n1,2\n') },
      { name: 'contrato.docx', data: Buffer.from('PK\x03\x04fake') },
      { name: 'quebrado.zip', data: Buffer.from('not a zip') },
      { name: 'Lote 1.zip', data: z2Bytes },
    ],
    deps,
    { outputType: 'uint8array', onLog: (m) => logs.push(m) },
  );

  const out = await JSZip.loadAsync(content);
  const files = Object.values(out.files).filter((f) => !f.dir).map((f) => f.name).sort();
  assert.deepStrictEqual(files, [
    'Lote 1 (2)/outro.pdf',
    'Lote 1/dados/sub/imagem.png',
    'Lote 1/dados/sub/interno/profundo/nota.pdf',
    'Lote 1/dados/sub/interno/tabela.pdf',
    'Lote 1/dados/vendas.pdf',
    'Lote 1/leia-me (txt).pdf',
    'Lote 1/leia-me.pdf',
    'contrato.docx',
    'lote2/outro.pdf',
    'quebrado.zip',
    'solto.pdf',
  ]);
  assert.ok(out.files['Lote 1/vazia/'], 'empty folder kept');
  // contrato.docx é inválido: a conversão falha e o original é mantido
  assert.deepStrictEqual(stats, { zips: 4, converted: { txt: 4, csv: 3 }, copied: 4, errors: 1 });

  for (const f of files.filter((n) => n.endsWith('.pdf') && n !== 'Lote 1/leia-me.pdf')) {
    const head = Buffer.from(await out.file(f).async('uint8array')).subarray(0, 5).toString();
    assert.strictEqual(head, '%PDF-', f);
  }

  if (hasPdftotext()) {
    // leia-me.pdf (original) vem antes de leia-me.txt em ordem alfabética, então o convertido ganha " (txt)"
    assert.strictEqual(await out.file('Lote 1/leia-me.pdf').async('string'), '%PDF-existing');
    const txt = pdfText(await out.file('Lote 1/leia-me (txt).pdf').async('uint8array'), 'leia-me.pdf');
    assert.match(txt, /Relatório de produção\s+com acentuação/);
    const csv = pdfText(await out.file('Lote 1/dados/vendas.pdf').async('uint8array'), 'vendas.pdf');
    assert.match(csv, /Produto\s+Preço\s+Qtd/);
    assert.match(csv, /Pão; francês\s+0,80\s+10/);
    const nested = pdfText(await out.file('Lote 1/dados/sub/interno/profundo/nota.pdf').async('uint8array'), 'nota.pdf');
    assert.match(nested, /arquivo dentro de zip aninhado/);
  }
});

test('large txt and wide csv produce multi-page PDFs', () => {
  const big = Array.from({ length: 500 }, (_, i) => `linha ${i + 1} ` + 'conteúdo '.repeat(5)).join('\r\n');
  const pdf = Buffer.from(core.txtToPdf(Buffer.from(big), 'big.txt', deps));
  const wide = [Array.from({ length: 40 }, (_, i) => `coluna_${i}`).join(',')]
    .concat(Array.from({ length: 200 }, (_, r) => Array.from({ length: 40 }, (_, c) => `${r}-${c}`).join(',')))
    .join('\n');
  const pdf2 = Buffer.from(core.csvToPdf(Buffer.from(wide), 'wide.csv', deps));
  if (hasPdftotext()) {
    const t = pdfText(pdf, 'big.pdf');
    assert.match(t, /linha 500 conteúdo/);
    assert.ok((t.match(/Página \d+/g) || []).length > 5);
    const t2 = pdfText(pdf2, 'wide.pdf');
    assert.match(t2, /coluna_39/);
    assert.match(t2, /199-39/);
  }
});

test('registers Word and Excel converters', () => {
  assert.deepStrictEqual(core.supportedExtensions().sort(), ['csv', 'doc', 'docs', 'docx', 'txt', 'xls', 'xlsx']);
});

test('Word and Excel inside a zip become PDFs', async () => {
  const z = new JSZip();
  z.file('docs/documento.docx', fixture('documento.docx'));
  z.file('docs/antigo/documento.doc', fixture('documento.doc'));
  z.file('docs/rtf.doc', fixture('rtf-disfarcado.doc'));
  z.file('docs/digitado-errado.docs', fixture('documento.docx'));
  z.file('planilhas/planilha.xlsx', fixture('planilha.xlsx'));
  z.file('planilhas/planilha.xls', fixture('planilha.xls'));
  z.file('planilhas/corrompida.xlsx', 'isto não é uma planilha');
  const { content, stats } = await core.buildOutputZip(
    [{ name: 'Office.zip', data: await z.generateAsync({ type: 'uint8array' }) }],
    deps,
    { outputType: 'uint8array' },
  );
  assert.deepStrictEqual(stats.converted, { doc: 2, docs: 1, docx: 1, xls: 1, xlsx: 2 });
  assert.strictEqual(stats.errors, 0);

  const out = await JSZip.loadAsync(content);
  const files = Object.values(out.files).filter((f) => !f.dir).map((f) => f.name).sort();
  assert.deepStrictEqual(files, [
    'Office/docs/antigo/documento.pdf',
    'Office/docs/digitado-errado.pdf',
    'Office/docs/documento.pdf',
    'Office/docs/rtf.pdf',
    'Office/planilhas/corrompida.pdf',
    'Office/planilhas/planilha (xlsx).pdf',
    'Office/planilhas/planilha.pdf',
  ]);
  if (!hasPdftotext()) return;
  const read = async (n) => pdfText(await out.file(n).async('uint8array'), n.replace(/\//g, '_'));

  const docx = await read('Office/docs/documento.pdf');
  assert.match(docx, /Relatório Mensal de Produção/);
  assert.match(docx, /Texto com negrito e itálico — “aspas” e 10 €/);
  assert.match(docx, /• Primeiro item/);
  assert.match(docx, /2\. Passo dois/);
  assert.match(docx, /Pão de queijo\s+10\s+0,80/);

  const doc = await read('Office/docs/antigo/documento.pdf');
  assert.match(doc, /Relatório Mensal de Produção/);
  assert.match(doc, /Pão de queijo \| 10 \| 0,80/);

  assert.match(await read('Office/docs/rtf.pdf'), /Olá mundo RTF\s+Segunda linha com ça/);

  for (const n of ['Office/planilhas/planilha.pdf', 'Office/planilhas/planilha (xlsx).pdf']) {
    const xls = await read(n);
    assert.match(xls, /Planilha: Vendas/);
    assert.match(xls, /15\/01\/2026\s+Café\s+12,5/);
    assert.match(xls, /Açúcar\s+1\.234,57/);
    assert.match(xls, /Planilha: Resumo/);
    assert.doesNotMatch(xls, /Planilha: Vazia/);
  }
});

test('broken Word file is kept as original with a warning', async () => {
  const logs = [];
  const { content, stats } = await core.buildOutputZip(
    [{ name: 'quebrado.docx', data: Buffer.from('PK\x03\x04 lixo') }],
    deps,
    { outputType: 'uint8array', onLog: (m) => logs.push(m) },
  );
  assert.strictEqual(stats.errors, 1);
  const out = await JSZip.loadAsync(content);
  assert.ok(out.file('quebrado.docx'));
  assert.ok(logs.some((m) => /Falha ao converter quebrado\.docx/.test(m)));
});

test('HTML parser and Word text cleanup', () => {
  const tree = office.parseHtml('<p>a &amp; <strong>b</strong><br/>c</p><img src="x.png" />');
  assert.strictEqual(tree.children[0].tag, 'p');
  assert.strictEqual(tree.children[0].children[0].text, 'a & ');
  assert.strictEqual(tree.children[1].attrs.src, 'x.png');
  assert.strictEqual(
    office.cleanWordText('Veja \x13 HYPERLINK "http://x" \x14o site\x15.\ra\x07b\x07\x07'),
    'Veja o site.\na | b\n',
  );
});
