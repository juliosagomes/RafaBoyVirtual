/* global ZipPdfCore, JSZip, jspdf, autoTable */
const logEl = document.getElementById('log');
const deps = { JSZip, jsPDF: jspdf.jsPDF, autoTable };

function log(msg, level = 'info') {
  const li = document.createElement('li');
  li.className = level;
  li.textContent = msg;
  logEl.append(li);
  li.scrollIntoView({ block: 'nearest' });
}

function safeFileName(s) {
  return (s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Lê o nome do arquivo do cabeçalho Content-Disposition, se houver. */
function nameFromDisposition(header) {
  if (!header) return '';
  const star = header.match(/filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ''));
    } catch (e) { /* ignora */ }
  }
  const plain = header.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i);
  return plain ? (plain[1] || plain[2]).trim() : '';
}

async function download(att) {
  const res = await fetch(att.url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  const data = await res.arrayBuffer();
  if (/text\/html/i.test(type) && !/\.html?$/i.test(att.name)) {
    throw new Error('o Gmail devolveu uma página HTML em vez do arquivo (sessão expirada ou anexo bloqueado)');
  }
  const headerName = nameFromDisposition(res.headers.get('content-disposition'));
  const name = /^anexo_\d+$/.test(att.name) && headerName ? headerName : att.name;
  return { name, data };
}

async function run(subject, attachments) {
  const t0 = performance.now();
  const { content, stats } = await ZipPdfCore.buildOutputZip(attachments, deps, { onLog: log });
  const fileName = `${safeFileName(subject) || 'anexos'} - PDF.zip`;
  const url = URL.createObjectURL(content);
  const a = document.getElementById('download');
  a.href = url;
  a.download = fileName;
  a.click();

  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  document.getElementById('summary').textContent =
    `✅ Pronto em ${secs}s: ${stats.zips} .zip extraído(s), ${stats.txt} .txt e ${stats.csv} .csv convertidos, ` +
    `${stats.copied} arquivo(s) copiado(s) sem alteração` + (stats.errors ? `, ${stats.errors} aviso(s).` : '.') +
    ` Arquivo: “${fileName}”.`;
  document.getElementById('result').hidden = false;
  log('✅ Concluído.', 'ok');
}

async function fromJob(jobId) {
  const stored = await chrome.storage.session.get(jobId);
  const job = stored[jobId];
  if (!job) {
    log('Tarefa não encontrada. Abra o e-mail no Gmail e clique na extensão novamente.', 'error');
    return;
  }
  await chrome.storage.session.remove(jobId);
  document.title = `${job.subject || 'Anexos'} → PDF`;

  const files = [];
  for (const att of job.attachments) {
    log(`⬇️ Baixando ${att.name}…`);
    try {
      files.push(await download(att));
    } catch (e) {
      log(`❌ Falha ao baixar ${att.name}: ${e.message}`, 'error');
    }
  }
  if (!files.length) {
    log('Nenhum anexo pôde ser baixado. Alternativa: baixe os anexos manualmente e use o modo “Selecionar arquivos do computador”.', 'error');
    return;
  }
  await run(job.subject, files);
}

function setupManual() {
  document.getElementById('manual').hidden = false;
  const input = document.getElementById('files');
  const drop = document.getElementById('drop');
  const handle = async (fileList) => {
    const list = [...fileList];
    if (!list.length) return;
    document.getElementById('manual').hidden = true;
    const files = await Promise.all(list.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })));
    const subject = list.length === 1 ? list[0].name.replace(/\.[^.]+$/, '') : 'anexos';
    await run(subject, files);
  };
  input.addEventListener('change', () => handle(input.files).catch((e) => log(`❌ ${e.message}`, 'error')));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    handle(e.dataTransfer.files).catch((err) => log(`❌ ${err.message}`, 'error'));
  });
}

const params = new URLSearchParams(location.search);
if (params.get('job')) fromJob(params.get('job')).catch((e) => log(`❌ ${e.message}`, 'error'));
else setupManual();
