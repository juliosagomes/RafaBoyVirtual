/*
 * Função injetada (chrome.scripting.executeScript) na aba do Gmail.
 * Precisa ser autocontida: não pode usar nada definido fora dela.
 *
 * Retorna { subject, attachments: [{ name, url, mime }] } com os anexos do
 * e-mail/conversa aberto(a) no momento.
 */
function collectGmailAttachments() {
  const root = document.querySelector('div[role="main"]') || document.body;
  const attachments = [];
  const seen = new Set();

  function keyFor(url, name) {
    try {
      const u = new URL(url, location.href);
      const attid = u.searchParams.get('attid') || u.searchParams.get('realattid');
      const msg = u.searchParams.get('permmsgid') || u.searchParams.get('th') || '';
      if (attid) return `${attid}|${(name || '').toLowerCase()}|${msg}`;
      return u.href;
    } catch (e) {
      return url;
    }
  }

  function add(name, url, mime, viaDownloadUrl) {
    let absolute;
    try {
      absolute = new URL(url, location.href);
    } catch (e) {
      return;
    }
    if (absolute.searchParams.get('disp') === 'zip') return; // link "Baixar todos"
    if (absolute.searchParams.has('disp')) absolute.searchParams.set('disp', 'safe');
    const clean = (name || '').trim();
    // "download_url" e o link do cartão às vezes usam parâmetros diferentes
    // para a mesma mensagem: compara também só por attid + nome.
    const key = keyFor(absolute.href, clean);
    const looseKey = key.split('|').slice(0, 2).join('|');
    if (seen.has(key) || (!viaDownloadUrl && seen.has(looseKey))) return;
    seen.add(key);
    seen.add(looseKey);
    attachments.push({ name: clean, url: absolute.href, mime: mime || '' });
  }

  // 1) Atributo download_url (formato "mime:nome:url"), usado pelo Gmail para
  //    arrastar anexos para a área de trabalho. É a fonte mais confiável.
  root.querySelectorAll('[download_url]').forEach((el) => {
    const v = el.getAttribute('download_url') || '';
    const m = v.match(/^([^:]*):(.*?):(https?:\/\/.+)$/);
    if (m) add(m[2], m[3], m[1], true);
  });

  // 2) Links de download dos cartões de anexo (fallback).
  root.querySelectorAll('a[href*="view=att"]').forEach((a) => {
    if (a.closest('[download_url]')) return;
    const card = a.closest('span.aZo, div.aQH > span, [role="listitem"]') || a.parentElement;
    if (card && card.querySelector('[download_url]')) return;

    let name = a.getAttribute('download') || '';
    if (!name && card) {
      const label = card.querySelector('.aV3, .aQA span[title], [title]');
      name = label ? label.getAttribute('title') || label.textContent : '';
    }
    if (!name) {
      const aria = a.getAttribute('aria-label') || (card && card.getAttribute('aria-label')) || '';
      const m = aria.match(/([^\s"“”]+\.[A-Za-z0-9]{1,6})\s*$/);
      if (m) name = m[1];
    }
    add(name, a.href, '', false);
  });

  const subjectEl = root.querySelector('h2.hP') || document.querySelector('h2[data-thread-perm-id]');
  const subject = subjectEl ? subjectEl.textContent.trim() : '';

  attachments.forEach((att, i) => {
    if (!att.name) att.name = `anexo_${i + 1}`;
  });
  return { subject, attachments };
}

if (typeof module === 'object' && module.exports) module.exports = { collectGmailAttachments };
