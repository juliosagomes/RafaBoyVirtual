/* global collectGmailAttachments */
const statusEl = document.getElementById('status');
const listEl = document.getElementById('list');
const convertBtn = document.getElementById('convert');

let found = null;

function openProcessor(query) {
  chrome.tabs.create({ url: chrome.runtime.getURL(`processor.html?${query}`) });
  window.close();
}

document.getElementById('manual').addEventListener('click', () => openProcessor('mode=manual'));

convertBtn.addEventListener('click', async () => {
  const selected = [...listEl.querySelectorAll('input:checked')].map((cb) => found.attachments[Number(cb.value)]);
  if (!selected.length) {
    statusEl.textContent = 'Selecione ao menos um anexo.';
    return;
  }
  const jobId = crypto.randomUUID();
  await chrome.storage.session.set({ [jobId]: { subject: found.subject, attachments: selected } });
  openProcessor(`job=${encodeURIComponent(jobId)}`);
});

(async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.startsWith('https://mail.google.com/')) {
    statusEl.textContent = 'Abra um e-mail no Gmail (mail.google.com) e clique na extensão novamente.';
    return;
  }
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectGmailAttachments });
    found = res && res.result;
  } catch (e) {
    statusEl.textContent = `Não foi possível ler a página do Gmail: ${e.message}`;
    return;
  }
  if (!found || !found.attachments.length) {
    statusEl.textContent = 'Nenhum anexo encontrado. Abra o e-mail (não a lista da caixa de entrada) e tente de novo.';
    return;
  }
  statusEl.textContent = `${found.attachments.length} anexo(s) encontrado(s)${found.subject ? ` em “${found.subject}”` : ''}:`;
  found.attachments.forEach((att, i) => {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = String(i);
    cb.checked = true;
    label.append(cb, ` ${att.name}`);
    li.append(label);
    listEl.append(li);
  });
  convertBtn.hidden = false;
})();
