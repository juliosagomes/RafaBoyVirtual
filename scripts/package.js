/*
 * Valida a extensão e gera dist/rafaboy-virtual-<versão>.zip para enviar à Chrome Web Store.
 * Uso: npm run package
 */
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');
const errors = [];
const check = (ok, msg) => ok || errors.push(msg);

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Limites da Chrome Web Store
check(manifest.manifest_version === 3, 'manifest_version deve ser 3');
check(manifest.name && manifest.name.length <= 75, 'name: máximo de 75 caracteres');
check(!manifest.short_name || manifest.short_name.length <= 12, 'short_name: máximo de 12 caracteres');
check(manifest.description && manifest.description.length <= 132, `description: máximo de 132 caracteres (atual: ${manifest.description.length})`);
check(/^\d+(\.\d+){0,3}$/.test(manifest.version), 'version: até 4 números separados por ponto');
check(manifest.version === pkg.version, `versão do manifest (${manifest.version}) diferente do package.json (${pkg.version})`);
check(manifest.icons && manifest.icons['128'], 'ícone de 128px obrigatório');

// Todos os arquivos referenciados existem e nenhum código vem de fora
const exists = (rel) => fs.existsSync(path.join(EXT, rel));
for (const icon of [...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {})]) {
  check(exists(icon), `ícone não encontrado: ${icon}`);
}
const htmlFiles = fs.readdirSync(EXT).filter((f) => f.endsWith('.html'));
check(exists(manifest.action.default_popup), 'popup não encontrado');
for (const html of htmlFiles) {
  const src = fs.readFileSync(path.join(EXT, html), 'utf8');
  for (const [, ref] of src.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (/^https?:|^\/\//.test(ref)) errors.push(`${html}: recurso remoto não é permitido (${ref})`);
    else if (!exists(ref)) errors.push(`${html}: arquivo não encontrado (${ref})`);
  }
  check(!/<script(?![^>]*src=)[^>]*>/i.test(src), `${html}: scripts inline são bloqueados pelo Manifest V3`);
}

// Arquivos a incluir (sem arquivos ocultos/de sistema)
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('.') || /^(Thumbs\.db|desktop\.ini)$/i.test(e.name)) return [];
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}
const files = walk(EXT);
for (const f of files.filter((f) => f.endsWith('.js'))) {
  const src = fs.readFileSync(f, 'utf8');
  check(!/\bimportScripts\s*\(\s*['"]https?:/.test(src) && !/\bimport\s*\(\s*['"]https?:/.test(src), `${path.relative(EXT, f)}: carrega código remoto`);
}

if (errors.length) {
  console.error('❌ Problemas encontrados:\n - ' + errors.join('\n - '));
  process.exit(1);
}

(async () => {
  const zip = new JSZip();
  for (const f of files) zip.file(path.relative(EXT, f).split(path.sep).join('/'), fs.readFileSync(f));
  const out = path.join(DIST, `rafaboy-virtual-${manifest.version}.zip`);
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`✅ ${path.relative(ROOT, out)} (${files.length} arquivos, ${kb} KB) pronto para enviar à Chrome Web Store.`);
})();
