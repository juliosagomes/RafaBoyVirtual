/*
 * Gera as imagens da ficha da Chrome Web Store em store/:
 *   screenshot-1..4.png (1280x800), promo-small-440x280.png, promo-marquee-1400x560.png
 *
 * As capturas usam a interface real da extensão (carregada no Chromium) com
 * dados de exemplo e PDFs gerados pela própria extensão a partir de test/fixtures.
 *
 * Requisitos: Playwright com Chromium, pdftoppm (poppler-utils) e Python 3 com Pillow.
 * Uso: node scripts/store-assets.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  ({ chromium } = require(path.join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright')));
}

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const STORE = path.join(ROOT, 'store');
const FIX = path.join(ROOT, 'test', 'fixtures');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rafaboy-store-'));

const JSZip = require('jszip');
const core = require('../extension/src/core.js');
require('../extension/src/office.js');

const deps = {
  JSZip,
  jsPDF: require('jspdf').jsPDF,
  autoTable: require('jspdf-autotable').autoTable,
  mammoth: require('mammoth'),
  XLSX: require('@e965/xlsx'),
};

const dataUri = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;

const FAKE_EMAIL = {
  subject: 'Fechamento de setembro',
  attachments: [
    { name: 'Relatorios_Setembro.zip', url: 'https://mail.google.com/x1', mime: 'application/zip' },
    { name: 'Planilhas_Financeiro.zip', url: 'https://mail.google.com/x2', mime: 'application/zip' },
    { name: 'Contratos_Assinados.zip', url: 'https://mail.google.com/x3', mime: 'application/zip' },
    { name: 'Leia-me.txt', url: 'https://mail.google.com/x4', mime: 'text/plain' },
  ],
};

/** Planilha de exemplo mais completa que a dos testes, para a imagem ficar representativa. */
function sampleXlsx() {
  const { utils, write } = deps.XLSX;
  const produtos = ['Café especial', 'Açúcar orgânico', 'Pão de queijo', 'Leite integral', 'Chá mate', 'Biscoito'];
  const rows = [['Data', 'Produto', 'Quantidade', 'Preço unitário', 'Total']];
  for (let i = 0; i < 18; i++) {
    const qtd = 5 + ((i * 7) % 40);
    const preco = 3.5 + ((i * 13) % 50) * 1.37;
    rows.push([new Date(Date.UTC(2026, 8, 1 + i)), produtos[i % produtos.length], qtd, preco, qtd * preco]);
  }
  const ws = utils.aoa_to_sheet(rows, { cellDates: true });
  for (let r = 1; r < rows.length; r++) {
    ws[utils.encode_cell({ r, c: 0 })].z = 'dd/mm/yyyy';
    ws[utils.encode_cell({ r, c: 3 })].z = '#,##0.00';
    ws[utils.encode_cell({ r, c: 4 })].z = '#,##0.00';
  }
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, 'Vendas de setembro');
  return write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function sampleZip() {
  const z = new JSZip();
  z.file('Relatorios/Relatorio_Mensal.docx', fs.readFileSync(path.join(FIX, 'documento.docx')));
  z.file('Relatorios/antigos/Relatorio_2019.doc', fs.readFileSync(path.join(FIX, 'documento.doc')));
  z.file('Financeiro/Vendas.xlsx', sampleXlsx());
  z.file('Financeiro/Vendas_legado.xls', fs.readFileSync(path.join(FIX, 'planilha.xls')));
  z.file('Financeiro/extrato.csv', 'Data;Descrição;Valor\n01/09/2026;Saldo inicial;1.500,00\n05/09/2026;Fornecedor ABC;-320,90\n');
  z.file('Financeiro/logo.png', fs.readFileSync(path.join(STORE, 'icon-128.png')));
  z.file('Leia-me.txt', 'Segue o fechamento de setembro.\nQualquer dúvida, estou à disposição.\n');
  const file = path.join(TMP, 'Fechamento_Setembro.zip');
  fs.writeFileSync(file, await z.generateAsync({ type: 'nodebuffer' }));
  return file;
}

async function renderPdfPage(data, name) {
  const { content } = await core.buildOutputZip(
    [{ name, data }],
    deps,
    { outputType: 'uint8array' },
  );
  const out = await JSZip.loadAsync(content);
  const pdfName = Object.keys(out.files).find((n) => n.endsWith('.pdf'));
  const pdf = path.join(TMP, pdfName);
  fs.writeFileSync(pdf, await out.file(pdfName).async('nodebuffer'));
  const prefix = path.join(TMP, path.basename(pdfName, '.pdf'));
  execFileSync('pdftoppm', ['-r', '90', '-png', '-f', '1', '-l', '1', '-singlefile', pdf, prefix]);
  return `${prefix}.png`;
}

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: "DejaVu Sans", system-ui, sans-serif; color: #fff;
    background: linear-gradient(135deg, #0b57d0 0%, #1a73e8 55%, #4c8df6 100%); overflow: hidden; }
  .slide { width: 1280px; height: 800px; display: flex; align-items: center; gap: 56px; padding: 0 80px; }
  .text { flex: 1; }
  h1 { font-size: 48px; line-height: 1.15; font-weight: 700; letter-spacing: -0.5px; }
  p.sub { font-size: 24px; line-height: 1.45; margin-top: 22px; opacity: .92; }
  ul.points { margin-top: 26px; padding: 0; list-style: none; font-size: 21px; line-height: 1.9; }
  ul.points li::before { content: "✓  "; font-weight: 700; color: #b9f6ca; }
  .card { background: #fff; border-radius: 14px; box-shadow: 0 24px 60px rgba(0,0,0,.35); overflow: hidden; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 22px; font-weight: 700; margin-bottom: 28px; opacity: .95; }
  .brand img { width: 44px; height: 44px; }
`;

function slide(inner, extraCss = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${extraCss}</style></head><body>${inner}</body></html>`;
}

async function shot(page, html, file, width = 1280, height = 800) {
  await page.setViewportSize({ width, height });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: file });
}

(async () => {
  const icon = dataUri(path.join(STORE, 'icon-512.png'));
  const brand = `<div class="brand"><img src="${icon}">RafaBoy Virtual</div>`;
  const ctx = await chromium.launchPersistentContext(path.join(TMP, 'profile'), {
    headless: true,
    channel: 'chromium', // headless completo: necessário para carregar extensões
    acceptDownloads: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const page0 = await ctx.newPage();
  await page0.goto('chrome://extensions');
  const extId = await page0.evaluate(async () => (await chrome.management.getAll()).find((e) => e.name === 'RafaBoy Virtual').id);

  // 1) Popup com anexos de exemplo (APIs do Chrome simuladas só para esta captura)
  const popup = await ctx.newPage();
  await popup.addInitScript((fake) => {
    chrome.tabs.query = async () => [{ id: 1, url: 'https://mail.google.com/mail/u/0/#inbox/abc' }];
    chrome.scripting.executeScript = async () => [{ result: fake }];
  }, FAKE_EMAIL);
  await popup.setViewportSize({ width: 360, height: 420 });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForSelector('#convert:not([hidden])');
  const popupPng = path.join(TMP, 'popup.png');
  await popup.locator('body').screenshot({ path: popupPng });

  // 2) Tela de conversão real (modo manual com um .zip de exemplo)
  const proc = await ctx.newPage();
  await proc.setViewportSize({ width: 1100, height: 560 });
  await proc.goto(`chrome-extension://${extId}/processor.html?mode=manual`);
  const dl = proc.waitForEvent('download');
  await proc.setInputFiles('#files', await sampleZip());
  const download = await dl;
  await proc.waitForSelector('#result:not([hidden])');
  await proc.evaluate(() => {
    document.title = 'Fechamento de setembro → PDF';
  });
  const procPng = path.join(TMP, 'processor.png');
  await proc.screenshot({ path: procPng });
  const outZip = path.join(TMP, 'saida.zip');
  await download.saveAs(outZip);
  const outFiles = Object.values((await JSZip.loadAsync(fs.readFileSync(outZip))).files)
    .filter((f) => !f.dir)
    .map((f) => f.name)
    .sort();

  // 3) Páginas de PDF geradas
  const docxPng = await renderPdfPage(fs.readFileSync(path.join(FIX, 'documento.docx')), 'Relatorio_Mensal.docx');
  const xlsxPng = await renderPdfPage(sampleXlsx(), 'Vendas.xlsx');

  const page = await ctx.newPage();

  await shot(
    page,
    slide(
      `<div class="slide"><div class="text">${brand}
        <h1>Todos os anexos do e-mail em PDF, com um clique</h1>
        <p class="sub">Abra o e-mail no Gmail, clique no ícone e baixe um único .zip com tudo convertido.</p>
        <ul class="points"><li>Abre os .zip e as subpastas</li><li>.txt, .csv, Word e Excel viram PDF</li><li>Os demais arquivos são mantidos</li></ul>
      </div><div class="card" style="width:400px"><img src="${dataUri(popupPng)}" style="width:400px;display:block"></div></div>`,
    ),
    path.join(STORE, 'screenshot-1.png'),
  );

  await shot(
    page,
    slide(
      `<div class="slide" style="flex-direction:column;justify-content:center;gap:28px">
        <h1 style="font-size:38px;text-align:center">Acompanhe a conversão e receba o .zip pronto</h1>
        <div class="card" style="width:1000px"><img src="${dataUri(procPng)}" style="width:1000px;display:block"></div></div>`,
    ),
    path.join(STORE, 'screenshot-2.png'),
  );

  const tree = (items) => items.map((n) => `<div>${n.replace(/^([^/]+\/)*/, (m) => '<span class="dir">' + m + '</span>')}</div>`).join('');
  await shot(
    page,
    slide(
      `<div class="slide" style="gap:40px">
        <div class="text" style="flex:0 0 470px">${brand}
          <h1 style="font-size:40px">Cada .zip vira uma pasta; cada arquivo, um PDF</h1>
          <div class="files">${tree(outFiles)}</div>
        </div>
        <div class="pages">
          <div class="card page"><img src="${dataUri(docxPng)}"><span>Word (.docx)</span></div>
          <div class="card page"><img src="${dataUri(xlsxPng)}"><span>Excel (.xlsx)</span></div>
        </div></div>`,
      `.files { margin-top: 26px; background: rgba(0,0,0,.22); border-radius: 12px; padding: 18px 20px; font: 15px/1.75 "DejaVu Sans Mono", monospace; }
       .files .dir { opacity: .7; }
       .pages { position: relative; flex: 1; height: 660px; }
       .page { position: absolute; }
       .page img { width: 100%; display: block; }
       .page span { position: absolute; top: 10px; right: 10px; background: #d93025; color: #fff; font-size: 15px; font-weight: 700; padding: 5px 12px; border-radius: 20px; }
       .page:first-child { width: 370px; left: 0; top: 0; transform: rotate(-2.5deg); }
       .page:last-child { width: 440px; left: 120px; top: 340px; transform: rotate(2deg); }`,
    ),
    path.join(STORE, 'screenshot-3.png'),
  );

  await shot(
    page,
    slide(
      `<div class="slide" style="justify-content:center;text-align:center;flex-direction:column;gap:0">
        <div style="font-size:110px;line-height:1">🔒</div>
        <h1 style="margin-top:24px">Seus arquivos não saem do seu computador</h1>
        <p class="sub" style="max-width:900px">A conversão acontece inteiramente no seu navegador. Sem servidores, sem cadastro,
          sem anúncios e sem coleta de dados.</p>
        <ul class="points" style="display:flex;gap:40px;justify-content:center"><li>Processamento local</li><li>Sem cadastro</li><li>Sem anúncios</li></ul>
      </div>`,
    ),
    path.join(STORE, 'screenshot-4.png'),
  );

  await shot(
    page,
    slide(
      `<div style="width:440px;height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center">
        <img src="${icon}" style="width:96px;height:96px">
        <div style="font-size:30px;font-weight:700">RafaBoy Virtual</div>
        <div style="font-size:16px;opacity:.92">Anexos do Gmail → PDF em um clique</div></div>`,
    ),
    path.join(STORE, 'promo-small-440x280.png'),
    440,
    280,
  );

  await shot(
    page,
    slide(
      `<div style="width:1400px;height:560px;display:flex;align-items:center;gap:60px;padding:0 100px">
        <img src="${icon}" style="width:260px;height:260px">
        <div><div style="font-size:64px;font-weight:700">RafaBoy Virtual</div>
        <div style="font-size:30px;margin-top:16px;opacity:.92;line-height:1.4">Converta .txt, .csv, Word e Excel dos anexos<br>do Gmail em PDF — tudo em um único .zip.</div></div></div>`,
    ),
    path.join(STORE, 'promo-marquee-1400x560.png'),
    1400,
    560,
  );

  await ctx.close();

  // A loja pede PNG de 24 bits (sem canal alfa)
  execFileSync('python3', [
    '-c',
    `import sys,glob
from PIL import Image
for f in glob.glob(sys.argv[1] + '/screenshot-*.png') + glob.glob(sys.argv[1] + '/promo-*.png'):
    Image.open(f).convert('RGB').save(f)`,
    STORE,
  ]);
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('Imagens geradas em store/:', fs.readdirSync(STORE).filter((f) => f.endsWith('.png')).join(', '));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
