// Administrace appky — ucseslovesa.cz/admin/
// Přihlášení přes Google (stejný Firebase projekt jako appka); všechna data jdou
// přes backend (Railway), který pustí jen účty z env ADMIN_EMAILS.
// Moduly: #chat, #reports, #settings — další (promo kódy, zákazníci…) přibudou.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

const BACKEND_URL = 'https://nepravidelna-slovesa-production.up.railway.app';
const fbApp = initializeApp({
  apiKey: 'AIzaSyBeIrsdlsA0KOwJxHG1s_jjqfEEyce-oxU',
  authDomain: 'ucse-slovesa.firebaseapp.com',
  projectId: 'ucse-slovesa',
  storageBucket: 'ucse-slovesa.firebasestorage.app',
  messagingSenderId: '594618849247',
  appId: '1:594618849247:web:7b80c8b46b0e4ec012d66a',
});
const auth = getAuth(fbApp);

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl2br = (v) => esc(v).replace(/\n/g, '<br>');

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('cs', { hour: '2-digit', minute: '2-digit' });
  const opts = { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleString('cs', opts);
}
function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'teď';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}
const flag = (lang) => (lang === 'pl' ? '🇵🇱' : '🇨🇿');

let toastTimer = null;
function toast(msg, kind = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast toast-${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

async function api(path, { method = 'GET', body } = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('unauthenticated');
  const token = await user.getIdToken();
  const resp = await fetch(BACKEND_URL + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) { const e = new Error(data.error || 'http ' + resp.status); e.status = resp.status; e.data = data; throw e; }
  return data;
}

// ---------- Přihlášení ----------
const gateMsg = (html) => { $('#gate-msg').innerHTML = html; };
$('#gate-login').addEventListener('click', async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { gateMsg(`Přihlášení se nepovedlo: ${esc(e.code || e.message)}`); }
});
const doLogout = () => signOut(auth);
$('#gate-logout').addEventListener('click', doLogout);
$('#logout').addEventListener('click', doLogout);

let me = null;
onAuthStateChanged(auth, async (user) => {
  $('#shell').classList.add('hidden');
  $('#gate').classList.remove('hidden');
  $('#gate-login').classList.toggle('hidden', !!user);
  $('#gate-logout').classList.add('hidden');
  stopTimers();
  if (!user) { gateMsg('Přihlaste se účtem, který má přístup do administrace.'); return; }
  gateMsg('Ověřuji přístup…');
  try {
    me = await api('/admin/me');
  } catch (e) {
    if (e.status === 403) {
      gateMsg(`Účet <strong>${esc(user.email)}</strong> nemá přístup do administrace.`);
    } else {
      gateMsg(`Server neodpovídá (${esc(e.message)}). Zkuste to za chvíli.`);
    }
    $('#gate-logout').classList.remove('hidden');
    return;
  }
  $('#me-email').textContent = me.email;
  $('#gate').classList.add('hidden');
  $('#shell').classList.remove('hidden');
  setBadges(me.counts);
  route();
  countsTimer = setInterval(refreshCounts, 30000);
});

let countsTimer = null;
let modTimer = null;
function stopTimers() { clearInterval(countsTimer); clearInterval(modTimer); countsTimer = modTimer = null; }
function setBadges(c = {}) {
  for (const [k, n] of Object.entries(c)) {
    const b = $('#badge-' + k);
    if (!b) continue;
    b.textContent = n > 99 ? '99+' : n;
    b.classList.toggle('hidden', !n);
  }
  const total = (c.chats || 0) + (c.reports || 0);
  document.title = (total ? `(${total}) ` : '') + 'Admin · Nepravidelná slovesa';
}
async function refreshCounts() {
  if (document.hidden) return;
  try { const r = await api('/admin/me'); me = r; setBadges(r.counts); } catch { /* nevadí */ }
}

// ---------- Router ----------
window.addEventListener('hashchange', route);
function route() {
  if (!me) return;
  clearInterval(modTimer);
  modTimer = null;
  const [mod, arg] = (location.hash.replace(/^#/, '') || 'chat').split('/');
  document.querySelectorAll('.nav-item[data-mod]').forEach((a) => a.classList.toggle('is-active', a.dataset.mod === mod));
  const main = $('#main');
  if (mod === 'reports') return renderReports(main);
  if (mod === 'settings') return renderSettings(main);
  return renderChat(main, arg ? decodeURIComponent(arg) : null);
}

// ---------- 💬 Chat ----------
let chatFilter = 'open';
let chatList = [];
async function renderChat(main, openId) {
  main.innerHTML = `
    <div class="chat-layout ${openId ? 'has-open' : ''}">
      <section class="pane list-pane">
        <header class="pane-head">
          <h1>Chat</h1>
          <div class="seg" id="chat-filter">
            <button data-f="open">Otevřené</button><button data-f="closed">Uzavřené</button><button data-f="all">Vše</button>
          </div>
        </header>
        <div class="chat-list" id="chat-list"><div class="muted pad">Načítám…</div></div>
      </section>
      <section class="pane conv-pane" id="conv">
        ${openId ? '<div class="muted pad">Načítám…</div>' : '<div class="empty-state"><div class="empty-ico">💬</div><p>Vyberte konverzaci vlevo.</p></div>'}
      </section>
    </div>`;
  const seg = $('#chat-filter');
  const syncSeg = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.f === chatFilter));
  syncSeg();
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    chatFilter = b.dataset.f;
    syncSeg();
    drawChatList(openId);
  });
  await loadChatList(openId);
  if (openId) await openConversation(openId, true);
  modTimer = setInterval(async () => {
    if (document.hidden) return;
    await loadChatList(openId);
    if (openId) await openConversation(openId, false);
  }, 10000);
}
async function loadChatList(openId) {
  try {
    const r = await api('/admin/chats');
    chatList = r.chats || [];
    drawChatList(openId);
  } catch (e) {
    const el = $('#chat-list');
    if (el) el.innerHTML = `<div class="muted pad">Nepodařilo se načíst (${esc(e.message)}).</div>`;
  }
}
function chatName(c) {
  return c.email || c.contactEmail || (c.name ? c.name : 'Anonym · ' + c.id.slice(2, 8));
}
function drawChatList(openId) {
  const el = $('#chat-list');
  if (!el) return;
  const items = chatList.filter((c) => chatFilter === 'all' || (c.status || 'open') === chatFilter);
  if (!items.length) {
    el.innerHTML = `<div class="muted pad">${chatFilter === 'open' ? 'Žádné otevřené konverzace. 🎉' : 'Nic tu není.'}</div>`;
    return;
  }
  el.innerHTML = items.map((c) => `
    <a class="chat-item ${c.id === openId ? 'is-active' : ''} ${c.unreadAdmin ? 'is-unread' : ''}" href="#chat/${encodeURIComponent(c.id)}">
      <div class="ci-top">
        <span class="ci-name">${flag(c.lang)} ${esc(chatName(c))}</span>
        <span class="ci-time">${ago(c.updatedAt)}</span>
      </div>
      <div class="ci-last">${c.lastFrom === 'admin' ? '<span class="muted">Vy: </span>' : ''}${esc(c.lastText)}</div>
      <div class="ci-tags">
        ${c.premium ? '<span class="tag tag-gold">⭐ Premium</span>' : ''}
        ${c.uid ? '' : '<span class="tag">nepřihlášený</span>'}
        ${c.unreadAdmin ? `<span class="tag tag-hot">${c.unreadAdmin} nová</span>` : ''}
      </div>
    </a>`).join('');
}
let convSig = '';
async function openConversation(id, first) {
  const box = $('#conv');
  if (!box) return;
  let r;
  try { r = await api('/admin/chats/' + encodeURIComponent(id)); } catch (e) {
    if (first) box.innerHTML = `<div class="muted pad">${e.status === 404 ? 'Konverzace neexistuje.' : 'Nepodařilo se načíst.'}</div>`;
    return;
  }
  const { chat, messages } = r;
  const sig = messages.map((m) => m.id).join(',') + chat.status;
  if (!first && sig === convSig) return;
  convSig = sig;
  const mailTo = chat.contactEmail || chat.email || '';
  const draft = first ? '' : ($('#reply-text')?.value || '');
  const wantMail = first ? !!mailTo : ($('#reply-mail')?.checked ?? !!mailTo);
  box.innerHTML = `
    <header class="conv-head">
      <a class="back" href="#chat" aria-label="Zpět">←</a>
      <div class="conv-who">
        <div class="conv-name">${flag(chat.lang)} ${esc(chatName(chat))}</div>
        <div class="conv-meta">
          ${chat.premium ? '<span class="tag tag-gold">⭐ Premium</span>' : '<span class="tag">zdarma</span>'}
          ${chat.uid ? '<span class="tag">přihlášený</span>' : '<span class="tag">nepřihlášený</span>'}
          ${chat.contactEmail && chat.contactEmail !== chat.email ? `<span class="tag">✉ ${esc(chat.contactEmail)}</span>` : ''}
          <span class="muted small">od ${fmtTime(chat.createdAt)}</span>
        </div>
      </div>
      <div class="conv-actions">
        <button class="btn btn-ghost btn-sm" id="conv-status">${chat.status === 'closed' ? '↺ Znovu otevřít' : '✓ Uzavřít'}</button>
        <button class="btn btn-ghost btn-sm btn-danger" id="conv-del" title="Smazat konverzaci">🗑</button>
      </div>
    </header>
    <details class="conv-tech"><summary>Technické info</summary>
      <div class="small muted">ID: ${esc(chat.id)}${chat.uid ? ' · uid ' + esc(chat.uid) : ''}<br>Stránka: ${esc(chat.page || '—')}<br>Zařízení: ${esc(chat.userAgent || '—')}</div>
    </details>
    <div class="msgs" id="msgs">
      ${messages.map((m) => `
        <div class="msg ${m.from === 'admin' ? 'from-admin' : 'from-user'}">
          <div class="bubble">${nl2br(m.text)}</div>
          <div class="msg-time">${m.from === 'admin' ? 'Vy · ' : ''}${fmtTime(m.at)}</div>
        </div>`).join('')}
    </div>
    <div class="reply">
      <textarea id="reply-text" rows="3" placeholder="Napište odpověď… (⌘/Ctrl + Enter odešle)"></textarea>
      <div class="reply-bar">
        <label class="check ${mailTo ? '' : 'is-disabled'}">
          <input type="checkbox" id="reply-mail" ${mailTo && wantMail ? 'checked' : ''} ${mailTo ? '' : 'disabled'} />
          <span>${mailTo ? `Poslat i e-mailem (${esc(mailTo)})` : 'Zákazník nenechal e-mail — uvidí odpověď v appce'}</span>
        </label>
        <button class="btn btn-primary" id="reply-send">Odeslat</button>
      </div>
    </div>`;
  const msgs = $('#msgs');
  msgs.scrollTop = msgs.scrollHeight;
  const ta = $('#reply-text');
  ta.value = draft;
  if (first && window.matchMedia('(min-width: 900px)').matches) ta.focus();
  const send = async () => {
    const text = ta.value.trim();
    if (!text) return;
    const btn = $('#reply-send');
    btn.disabled = true;
    try {
      const res = await api(`/admin/chats/${encodeURIComponent(id)}/reply`, { method: 'POST', body: { text, email: $('#reply-mail').checked } });
      ta.value = '';
      if (res.emailed === false) toast('Odpověď uložena, ale e-mail se nepodařilo odeslat.', 'error');
      else toast(res.emailed ? 'Odesláno do appky i e-mailem ✓' : 'Odesláno ✓', 'ok');
      convSig = '';
      await openConversation(id, false);
      loadChatList(id);
    } catch (e) {
      toast('Odeslání selhalo: ' + e.message, 'error');
    } finally {
      const b = $('#reply-send');
      if (b) b.disabled = false;
    }
  };
  $('#reply-send').addEventListener('click', send);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } });
  $('#conv-status').addEventListener('click', async () => {
    const next = chat.status === 'closed' ? 'open' : 'closed';
    try {
      await api(`/admin/chats/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status: next } });
      toast(next === 'closed' ? 'Uzavřeno' : 'Znovu otevřeno', 'ok');
      convSig = '';
      if (next === 'closed') { location.hash = '#chat'; return; }
      await openConversation(id, false);
      loadChatList(id);
    } catch (e) { toast('Nepovedlo se: ' + e.message, 'error'); }
  });
  $('#conv-del').addEventListener('click', async () => {
    if (!confirm(`Opravdu smazat celou konverzaci s „${chatName(chat)}“? Nedá se to vrátit.`)) return;
    try {
      await api(`/admin/chats/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Smazáno', 'ok');
      location.hash = '#chat';
    } catch (e) { toast('Smazání selhalo: ' + e.message, 'error'); }
  });
  refreshCounts();
}

// ---------- ⚑ Nahlášené chyby ----------
let repFilter = 'new';
const CAT = { form: 'Špatný tvar', rejected: 'Odpověď neuznána', translation: 'Překlad', audio: 'Výslovnost', other: 'Jiné' };
async function renderReports(main) {
  main.innerHTML = `
    <section class="pane full-pane">
      <header class="pane-head">
        <h1>Nahlášené chyby</h1>
        <div class="seg" id="rep-filter">
          <button data-f="new">Nové</button><button data-f="done">Vyřešené</button><button data-f="ignored">Ignorované</button><button data-f="all">Vše</button>
        </div>
      </header>
      <div class="reports" id="reports"><div class="muted pad">Načítám…</div></div>
    </section>`;
  let reports = [];
  const seg = $('#rep-filter');
  const syncSeg = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.f === repFilter));
  const draw = () => {
    const el = $('#reports');
    const items = reports.filter((r) => repFilter === 'all' || (r.status || 'new') === repFilter);
    if (!items.length) { el.innerHTML = `<div class="muted pad">${repFilter === 'new' ? 'Žádná nová hlášení. 🎉' : 'Nic tu není.'}</div>`; return; }
    el.innerHTML = items.map((r) => {
      const ans = r.answers ? Object.entries(r.answers).map(([k, v]) => `${k}: <b>${esc(v) || '—'}</b>`).join(' · ') : '';
      const st = r.status || 'new';
      return `
      <article class="card rep" data-id="${esc(r.id)}">
        <div class="rep-top">
          <div class="rep-verb">${esc(r.verb?.inf)} – ${esc(r.verb?.past)} – ${esc(r.verb?.pp)}</div>
          <div class="muted small">${flag(r.lang)} ${fmtTime(r.createdAt)}</div>
        </div>
        <div class="rep-tags"><span class="tag tag-hot">${esc(CAT[r.category] || r.category)}</span>${r.verb?.cs ? `<span class="tag">${esc(r.verb.cs)}</span>` : ''}${r.where ? `<span class="tag">${esc(r.where)}</span>` : ''}${r.dialect ? `<span class="tag">${esc(r.dialect)}</span>` : ''}</div>
        ${r.message ? `<p class="rep-msg">${nl2br(r.message)}</p>` : '<p class="muted small">(bez textu)</p>'}
        ${ans ? `<div class="small">Co žák napsal: ${ans}</div>` : ''}
        <div class="rep-foot">
          <div class="small">${r.email ? `<a href="mailto:${esc(r.email)}?subject=${encodeURIComponent('Vaše hlášení: ' + (r.verb?.inf || ''))}">✉ ${esc(r.email)}</a>` : '<span class="muted">bez e-mailu</span>'}</div>
          <div class="rep-actions">
            ${st !== 'done' ? '<button class="btn btn-sm btn-primary" data-st="done">✓ Vyřešeno</button>' : ''}
            ${st !== 'ignored' ? '<button class="btn btn-sm btn-ghost" data-st="ignored">Ignorovat</button>' : ''}
            ${st !== 'new' ? '<button class="btn btn-sm btn-ghost" data-st="new">↺ Vrátit mezi nové</button>' : ''}
          </div>
        </div>
      </article>`;
    }).join('');
  };
  syncSeg();
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    repFilter = b.dataset.f;
    syncSeg();
    draw();
  });
  $('#reports').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-st]');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    b.disabled = true;
    try {
      await api(`/admin/reports/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status: b.dataset.st } });
      const r = reports.find((x) => x.id === id);
      if (r) r.status = b.dataset.st;
      draw();
      refreshCounts();
    } catch (err) { toast('Nepovedlo se: ' + err.message, 'error'); b.disabled = false; }
  });
  try {
    reports = (await api('/admin/reports')).reports || [];
    draw();
  } catch (e) {
    $('#reports').innerHTML = `<div class="muted pad">Nepodařilo se načíst (${esc(e.message)}).</div>`;
  }
}

// ---------- ⚙️ Nastavení ----------
async function renderSettings(main) {
  await refreshCounts();
  const tg = me.telegram || {};
  main.innerHTML = `
    <section class="pane full-pane">
      <header class="pane-head"><h1>Nastavení</h1></header>
      <div class="settings">
        <article class="card">
          <h2>🔔 Upozornění na nové zprávy</h2>
          <div class="status-row">
            <span class="dot ${tg.linked ? 'dot-ok' : tg.tokenSet ? 'dot-warn' : 'dot-off'}"></span>
            <div><strong>Telegram:</strong> ${tg.linked ? 'propojeno — každá nová zpráva přijde jako notifikace.' : tg.tokenSet ? 'token je nastavený, zbývá propojit (krok 3).' : 'zatím nenastaveno.'}</div>
          </div>
          <div class="status-row">
            <span class="dot ${me.email_notify ? (tg.linked ? 'dot-off' : 'dot-ok') : 'dot-off'}"></span>
            <div><strong>E-mail (záloha):</strong> ${me.email_notify ? (tg.linked ? 'nepoužívá se, dokud funguje Telegram.' : 'chodí na REPORT_EMAIL_TO, jen u první nepřečtené zprávy v konverzaci.') : 'REPORT_EMAIL_TO není nastavené.'}</div>
          </div>
          ${tg.linked ? '<button class="btn btn-ghost" id="tg-test">Poslat testovací notifikaci</button> <button class="btn btn-ghost" id="tg-link">Propojit znovu</button>' : `
          <ol class="steps">
            <li>V Telegramu otevřete <strong>@BotFather</strong>, pošlete <code>/newbot</code> a zvolte jméno (např. „Slovesa podpora“).</li>
            <li>Token, který BotFather pošle, vložte v Railway do proměnné <code>TELEGRAM_BOT_TOKEN</code> (Variables) a počkejte na redeploy.</li>
            <li>Otevřete svého nového bota, pošlete mu <code>/start</code> a pak tady klikněte:</li>
          </ol>
          <button class="btn btn-primary" id="tg-link" ${tg.tokenSet ? '' : 'disabled'}>Propojit Telegram</button>`}
        </article>
        <article class="card">
          <h2>👤 Přístup</h2>
          <p class="small">Přihlášen: <strong>${esc(me.email)}</strong>. Kdo má přístup, určuje proměnná <code>ADMIN_EMAILS</code> v Railway.</p>
        </article>
      </div>
    </section>`;
  $('#tg-link')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await api('/admin/telegram/link', { method: 'POST' });
      toast('Telegram propojen ✓', 'ok');
      renderSettings(main);
    } catch (err) {
      const msg = err.message === 'no_message' ? 'Bot zatím nedostal žádnou zprávu — pošlete mu /start a zkuste znovu.' : 'Nepovedlo se: ' + (err.data?.detail || err.message);
      toast(msg, 'error');
      e.target.disabled = false;
    }
  });
  $('#tg-test')?.addEventListener('click', async () => {
    try { const r = await api('/admin/telegram/test', { method: 'POST' }); toast(r.ok ? 'Odesláno — mrkněte do Telegramu' : 'Nepovedlo se: ' + r.detail, r.ok ? 'ok' : 'error'); } catch (e) { toast('Nepovedlo se: ' + e.message, 'error'); }
  });
}
