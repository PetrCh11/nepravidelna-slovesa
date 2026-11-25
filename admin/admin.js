// Administrace appky — ucseslovesa.cz/admin/
// Přihlášení přes Google (stejný Firebase projekt jako appka); všechna data jdou
// přes backend (Railway), který pustí jen účty z env ADMIN_EMAILS.
// Moduly: #chat, #reports, #overview, #customers, #web, #promo, #langs, #settings.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithCustomToken, signOut, onAuthStateChanged,
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
// Přihlášení kódem (spárování z jiného, už přihlášeného zařízení)
const standaloneIOS = (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
  && (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);
$('#gate-code-inp').addEventListener('input', (e) => {
  let v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (v.length > 4) v = v.slice(0, 4) + '-' + v.slice(4);
  e.target.value = v;
});
$('#gate-code').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#gate-code-inp').value.trim();
  if (code.replace(/-/g, '').length !== 8) { gateMsg('Kód má 8 znaků (XXXX-XXXX).'); return; }
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  gateMsg('Ověřuji kód…');
  try {
    const r = await fetch(BACKEND_URL + '/admin/pair/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      gateMsg(data.error === 'expired' ? 'Kód vypršel nebo už byl použit. Vygenerujte nový.'
        : data.error === 'bad_code' ? 'Špatný kód, zkuste to znovu.'
        : data.error === 'too_many' ? 'Moc pokusů, zkuste to za pár minut.' : 'Přihlášení se nepovedlo.');
      return;
    }
    await signInWithCustomToken(auth, data.token);
  } catch (err) {
    gateMsg('Přihlášení se nepovedlo: ' + esc(err.code || err.message));
  } finally {
    btn.disabled = false;
  }
});
const doLogout = () => signOut(auth);
$('#gate-logout').addEventListener('click', doLogout);
$('#logout').addEventListener('click', doLogout);

let me = null;
onAuthStateChanged(auth, async (user) => {
  $('#shell').classList.add('hidden');
  $('#gate').classList.remove('hidden');
  $('#gate-login').classList.toggle('hidden', !!user || standaloneIOS);
  $('#gate-code').classList.toggle('hidden', !!user);
  $('#gate-logout').classList.add('hidden');
  stopTimers();
  if (!user) {
    gateMsg(standaloneIOS ? 'V aplikaci na ploše se přihlaste <strong>kódem</strong> — Google přihlášení tady iPhone nedovolí.' : 'Přihlaste se účtem, který má přístup do administrace.');
    return;
  }
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
  try { if (c.chats) navigator.setAppBadge?.(c.chats); else navigator.clearAppBadge?.(); } catch { /* nepodporováno */ }
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
  if (mod === 'customers') return renderCustomers(main);
  if (mod === 'overview') return renderOverview(main);
  if (mod === 'web') return renderWeb(main);
  if (mod === 'langs') return renderLangs(main);
  if (mod === 'promo') return arg ? renderPromoDetail(main, decodeURIComponent(arg)) : renderPromo(main);
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
        <a class="push-banner hidden" id="push-banner" href="#settings">🔔 Zapněte si upozornění na nové zprávy do mobilu →</a>
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
  maybePushBanner();
  await loadChatList(openId);
  if (openId) { await openConversation(openId, true); loadChatList(openId); }
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
      await loadChatList(id);
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

// ---------- 🔔 Web Push ----------
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function deviceLabel() {
  const ua = navigator.userAgent;
  const dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (isIOS && !/iPhone/.test(ua)) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Zařízení';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return `${dev}${br ? ' · ' + br : ''}${isStandalone ? ' (na ploše)' : ''}`;
}
function b64ToU8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function adminReg() {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' });
}
async function currentSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/admin/');
  return reg ? reg.pushManager.getSubscription() : null;
}
async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'denied' : 'dismissed');
  await adminReg();
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api('/admin/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // Jiný klíč (např. po resetu na serveru) → přeregistrovat
    const k = sub.options?.applicationServerKey;
    if (k && btoa(String.fromCharCode(...new Uint8Array(k))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== publicKey) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(publicKey) });
  await api('/admin/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), label: deviceLabel() } });
}
async function disablePush() {
  const sub = await currentSub();
  if (!sub) return;
  await api('/admin/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}
// Banner nad seznamem chatů, dokud tohle zařízení nemá zapnuté notifikace
async function maybePushBanner() {
  const el = $('#push-banner');
  if (!el) return;
  let on = false;
  try { on = !!(await currentSub()) && Notification.permission === 'granted'; } catch {}
  el.classList.toggle('hidden', on);
}
adminReg().catch(() => {});



// ---------- společné ----------
const money = (amount, cur) => {
  if (amount == null) return '';
  const v = amount / 100;
  if (cur === 'PLN') return v.toLocaleString('pl', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' zł';
  if (cur === 'CZK') return v.toLocaleString('cs', { maximumFractionDigits: 2 }) + ' Kč';
  return v.toLocaleString('cs') + ' ' + cur;
};
const sumMoney = (czk, pln) => [czk ? Math.round(czk).toLocaleString('cs') + ' Kč' : null, pln ? pln.toLocaleString('pl', { maximumFractionDigits: 2 }) + ' zł' : null].filter(Boolean).join(' + ') || '0 Kč';
const daysLeft = (ts) => Math.ceil((ts - Date.now()) / 86400000);

// ---------- 👥 Zákazníci ----------
let custFilter = 'live';
let custQuery = '';
const CUST_TABS = [
  ['live', 'Platící + zkušební'], ['trialing', 'Zkušební'], ['active', 'Aktivní'], ['past_due', 'Neprošlá platba'],
  ['canceled', 'Zrušené'], ['lifetime', 'Navždy'], ['promo', 'Promo'], ['all', 'Vše'],
];
function custMatches(r, f) {
  if (f === 'all') return true;
  if (f === 'lifetime') return r.kind === 'lifetime';
  if (f === 'promo') return r.kind === 'promo';
  if (r.kind !== 'subscription') return false;
  if (f === 'live') return ['trialing', 'active', 'past_due'].includes(r.status);
  if (f === 'canceled') return ['canceled', 'unpaid', 'incomplete_expired'].includes(r.status);
  return r.status === f;
}
function custRow(r) {
  let plan = '', state = '', when = '';
  if (r.kind === 'subscription') {
    plan = `${r.interval === 'year' ? 'Roční' : 'Měsíční'} · ${money(r.amount, r.currency)}`;
    const st = {
      trialing: ['tag tag-gold', 'zkušební'], active: ['tag tag-ok', 'aktivní'], past_due: ['tag tag-hot', 'neprošla platba'],
      canceled: ['tag', 'zrušeno'], unpaid: ['tag tag-hot', 'nezaplaceno'], incomplete: ['tag', 'nedokončeno'], incomplete_expired: ['tag', 'nedokončeno'],
    }[r.status] || ['tag', r.status];
    state = `<span class="${st[0]}">${st[1]}</span>${r.cancelAtPeriodEnd && r.status !== 'canceled' ? ' <span class="tag">ruší se</span>' : ''}`;
    if (r.status === 'trialing' && r.trialEnd) {
      const d = daysLeft(r.trialEnd);
      when = r.cancelAtPeriodEnd ? `trial končí ${dateOnly(r.trialEnd)} (zrušeno)` : `první platba ${dateOnly(r.trialEnd)}${d >= 0 ? ` · za ${d} d` : ''}`;
    } else if (r.status === 'active' && r.periodEnd) when = r.cancelAtPeriodEnd ? `končí ${dateOnly(r.periodEnd)}` : `obnovení ${dateOnly(r.periodEnd)}`;
    else if (r.status === 'past_due') when = 'Stripe zkouší platbu znovu';
    else if (r.canceledAt) when = `zrušeno ${dateOnly(r.canceledAt)}`;
  } else if (r.kind === 'lifetime') {
    plan = `Navždy · ${money(r.amount, r.currency)}`;
    state = '<span class="tag tag-ok">zaplaceno</span>';
    when = `koupeno ${dateOnly(r.created)}`;
  } else {
    plan = `Promo · ${esc(r.code || '?')}`;
    state = r.status === 'expired' ? '<span class="tag">vypršelo</span>' : '<span class="tag tag-ok">aktivní</span>';
    when = r.periodEnd ? `do ${dateOnly(r.periodEnd)}` : 'navždy';
  }
  return `
    <div class="cust">
      <div class="cust-who"><div class="cust-mail">${flag(r.lang)} ${esc(r.email || '—')}</div>${r.name ? `<div class="small muted">${esc(r.name)}</div>` : ''}</div>
      <div class="cust-plan">${plan}</div>
      <div class="cust-state">${state}</div>
      <div class="cust-when small muted">${when}</div>
      <div class="cust-link">${r.stripeUrl ? `<a href="${esc(r.stripeUrl)}" target="_blank" rel="noopener" title="Otevřít ve Stripe">Stripe ↗</a>` : ''}</div>
    </div>`;
}
async function renderCustomers(main) {
  main.innerHTML = `
    <section class="pane full-pane">
      <header class="pane-head">
        <h1>Zákazníci</h1>
        <div class="row-gap"><input class="search" id="cust-q" type="search" placeholder="Hledat e-mail…" value="${esc(custQuery)}" /><button class="btn btn-ghost btn-sm" id="cust-refresh" title="Načíst znovu ze Stripe">↻</button></div>
      </header>
      <div class="wrap">
        <div class="seg seg-wrap" id="cust-tabs"></div>
        <div id="cust-list" class="cust-list"><div class="muted pad">Načítám ze Stripe…</div></div>
      </div>
    </section>`;
  let rows = [];
  const draw = () => {
    const counts = Object.fromEntries(CUST_TABS.map(([k]) => [k, rows.filter((r) => custMatches(r, k)).length]));
    $('#cust-tabs').innerHTML = CUST_TABS.map(([k, l]) => `<button data-f="${k}" class="${k === custFilter ? 'is-on' : ''}">${l} <span class="cnt">${counts[k]}</span></button>`).join('');
    const q = custQuery.toLowerCase();
    const items = rows.filter((r) => custMatches(r, custFilter) && (!q || (r.email || '').toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q)));
    $('#cust-list').innerHTML = items.length ? items.map(custRow).join('') : '<div class="muted pad">Nic tu není.</div>';
  };
  const load = async (fresh) => {
    try {
      rows = (await api('/admin/customers' + (fresh ? '?fresh=1' : ''))).rows || [];
      draw();
    } catch (e) { $('#cust-list').innerHTML = `<div class="muted pad">Nepodařilo se načíst (${esc(e.data?.detail || e.message)}).</div>`; }
  };
  $('#cust-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; custFilter = b.dataset.f; draw(); });
  $('#cust-q').addEventListener('input', (e) => { custQuery = e.target.value; draw(); });
  $('#cust-refresh').addEventListener('click', () => { $('#cust-list').innerHTML = '<div class="muted pad">Načítám ze Stripe…</div>'; load(true); });
  load(false);
}

// ---------- 📊 Přehled ----------
function barChart(months, key, fmt, cls) {
  const max = Math.max(1, ...months.map((m) => m[key]));
  return `<div class="bars ${cls || ''}">${months.map((m) => {
    const h = Math.round((m[key] / max) * 100);
    const [y, mo] = m.key.split('-');
    return `<div class="bar-col" title="${mo}/${y}: ${fmt(m[key])}"><div class="bar-val">${m[key] ? fmt(m[key]) : ''}</div><div class="bar-fill" style="height:${Math.max(h, m[key] ? 3 : 0)}%"></div><div class="bar-lbl">${Number(mo)}/${y.slice(2)}</div></div>`;
  }).join('')}</div>`;
}
async function renderOverview(main) {
  main.innerHTML = `
    <section class="pane full-pane">
      <header class="pane-head"><h1>Přehled</h1><button class="btn btn-ghost btn-sm" id="ov-refresh" title="Načíst znovu">↻</button></header>
      <div class="wrap" id="ov"><div class="muted pad">Počítám…</div></div>
    </section>`;
  const load = async (fresh) => {
    let o;
    try { o = await api('/admin/overview' + (fresh ? '?fresh=1' : '')); } catch (e) {
      $('#ov').innerHTML = `<div class="muted pad">Nepodařilo se načíst (${esc(e.data?.detail || e.message)}).</div>`; return;
    }
    const conv = o.conversion90.ended ? Math.round((o.conversion90.converted / o.conversion90.ended) * 100) : null;
    const tile = (label, value, sub, cls = '') => `<div class="kpi ${cls}"><div class="kpi-lbl">${label}</div><div class="kpi-val">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
    $('#ov').innerHTML = `
      <div class="kpis">
        ${tile('Tržby 30 dní', sumMoney(o.revenue30.CZK, o.revenue30.PLN), `${o.revenue30.count} plateb`)}
        ${tile('Tržby 12 měsíců', sumMoney(o.revenueTotal12.CZK, o.revenueTotal12.PLN), 'hrubé, bez refundací')}
        ${tile('Aktivní předplatná', o.subs.active, o.subs.cancelAtPeriodEnd ? `${o.subs.cancelAtPeriodEnd} se ruší ke konci období` : 'platící')}
        ${tile('Ve zkušebním období', o.subs.trialing, `${o.trials30} nových za 30 dní`)}
        ${tile('Neprošlá platba', o.subs.past_due, 'Stripe zkouší znovu', o.subs.past_due ? 'kpi-hot' : '')}
        ${tile('Konverze trialů', conv == null ? '—' : conv + ' %', `${o.conversion90.converted} z ${o.conversion90.ended} za 90 dní`)}
        ${tile('Navždy', o.lifetime, 'jednorázové nákupy')}
        ${tile('Premium přes kód', o.premiumPromo, 'učitelské a studentské kódy')}
        ${tile('Uživatelé', o.users.total.toLocaleString('cs'), `+${o.users.new7} za 7 dní · +${o.users.new30} za 30 dní · 🇵🇱 ${o.users.pl}`)}
      </div>
      <div class="charts">
        <article class="card"><h2>Tržby CZK po měsících</h2>${barChart(o.months, 'CZK', (v) => Math.round(v).toLocaleString('cs') + ' Kč', 'b-teal')}</article>
        <article class="card"><h2>Tržby PLN po měsících</h2>${barChart(o.months, 'PLN', (v) => v.toLocaleString('pl', { maximumFractionDigits: 0 }) + ' zł', 'b-violet')}</article>
        <article class="card"><h2>Nové účty po měsících</h2>${barChart(o.months, 'signups', (v) => v.toLocaleString('cs'), 'b-orange')}</article>
      </div>
      <p class="small muted">Aktualizováno ${fmtTime(o.generatedAt)}. Účty = přihlášení přes Google (anonymní uživatelé bez přihlášení se nepočítají — ty ukazuje Plausible v sekci Web).</p>`;
  };
  $('#ov-refresh').addEventListener('click', () => { $('#ov').innerHTML = '<div class="muted pad">Počítám…</div>'; load(true); });
  load(false);
}

// ---------- 📈 Web (Plausible + Search Console) ----------
let gscDays = 28;
async function renderWeb(main) {
  main.innerHTML = `
    <section class="pane full-pane">
      <header class="pane-head"><h1>Web</h1></header>
      <div class="wrap">
        <article class="card" id="plausible-card"><h2>📈 Návštěvnost (Plausible)</h2><div class="muted">Načítám…</div></article>
        <article class="card" id="gsc-card">
          <div class="card-head"><h2>🔎 Vyhledávání Google (Search Console)</h2>
            <div class="seg" id="gsc-days"><button data-d="7">7 dní</button><button data-d="28">28 dní</button><button data-d="90">90 dní</button></div></div>
          <div id="gsc-body" class="muted">Načítám…</div>
        </article>
      </div>
    </section>`;
  drawPlausible();
  const seg = $('#gsc-days');
  const sync = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.d) === gscDays));
  sync();
  seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; gscDays = Number(b.dataset.d); sync(); drawGsc(); });
  drawGsc();
}
async function drawPlausible() {
  const card = $('#plausible-card');
  let cfg = {};
  try { cfg = await api('/admin/integrations'); } catch {}
  const link = cfg.plausibleSharedLink;
  if (link) {
    const src = link + (link.includes('?') ? '&' : '?') + 'embed=true&theme=dark&background=%23191d27';
    card.innerHTML = `<div class="card-head"><h2>📈 Návštěvnost (Plausible)</h2><div class="row-gap"><a class="small" href="https://plausible.io/ucseslovesa.cz" target="_blank" rel="noopener">Otevřít v Plausible ↗</a><button class="btn-link small" id="pl-edit">změnit odkaz</button></div></div>
      <iframe class="plausible-frame" src="${esc(src)}" loading="lazy" title="Plausible"></iframe>`;
    $('#pl-edit').addEventListener('click', () => drawPlausibleForm(card, link));
  } else {
    drawPlausibleForm(card, '');
  }
}
function drawPlausibleForm(card, link) {
  card.innerHTML = `<h2>📈 Návštěvnost (Plausible)</h2>
    <ol class="steps">
      <li>V Plausible otevřete <strong>ucseslovesa.cz → Settings → Visibility → Shared links → Add shared link</strong> (bez hesla).</li>
      <li>Zkopírovaný odkaz (https://plausible.io/share/…) vložte sem:</li>
    </ol>
    <form class="row" id="pl-form"><input class="search grow" name="link" value="${esc(link)}" placeholder="https://plausible.io/share/ucseslovesa.cz?auth=…" /><button class="btn btn-primary btn-sm" type="submit">Uložit</button></form>
    <p class="small muted">Odkaz se ukládá jen na server (adminConfig), do kódu webu se nedostane.</p>`;
  $('#pl-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/admin/integrations', { method: 'POST', body: { plausibleSharedLink: e.target.link.value.trim() } }); toast('Uloženo ✓', 'ok'); drawPlausible(); }
    catch (err) { toast(err.message === 'bad_link' ? 'To nevypadá jako sdílený odkaz Plausible (https://plausible.io/share/…).' : 'Nepovedlo se: ' + err.message, 'error'); }
  });
}
async function drawGsc() {
  const body = $('#gsc-body');
  if (!body) return;
  body.innerHTML = '<div class="muted">Načítám…</div>';
  let g;
  try { g = await api('/admin/gsc?days=' + gscDays); } catch (e) { body.innerHTML = `<div class="muted">Nepodařilo se načíst (${esc(e.message)}).</div>`; return; }
  if (!g.configured) {
    const sa = esc(g.serviceAccount || '');
    body.innerHTML = `
      <div class="status-row"><span class="dot dot-warn"></span><div><strong>Zatím nepropojeno.</strong> ${g.reason === 'api_disabled' ? 'V Google Cloud projektu není povolené Search Console API.' : g.reason === 'no_sites' ? 'Servisní účet zatím nemá přístup k žádnému webu.' : esc(g.detail || '')}</div></div>
      <ol class="steps">
        ${g.reason === 'api_disabled' ? `<li>Povolte <strong>Google Search Console API</strong> v projektu <code>${esc(g.projectId || 'ucse-slovesa')}</code>: <a href="https://console.cloud.google.com/apis/library/searchconsole.googleapis.com?project=${esc(g.projectId || 'ucse-slovesa')}" target="_blank" rel="noopener">otevřít ↗</a> → Povolit.</li>` : ''}
        <li>V <a href="https://search.google.com/search-console" target="_blank" rel="noopener">Search Console</a> (účtem, který weby spravuje) otevřete web → <strong>Nastavení → Uživatelé a oprávnění → Přidat uživatele</strong>.</li>
        <li>E-mail: <code class="copy" id="sa-mail">${sa}</code> <button class="btn-link small" id="sa-copy">kopírovat</button>, oprávnění <strong>Omezené</strong> (stačí na čtení).</li>
        <li>Totéž pro czasowniki.pl, pokud ho tam máte jako samostatnou službu.</li>
      </ol>
      <button class="btn btn-ghost btn-sm" id="gsc-retry">Zkusit znovu</button>`;
    $('#sa-copy')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(g.serviceAccount); toast('Zkopírováno', 'ok'); } catch {} });
    $('#gsc-retry').addEventListener('click', drawGsc);
    return;
  }
  const n = (v) => Math.round(v).toLocaleString('cs');
  body.innerHTML = `<div class="small muted" style="margin-bottom:10px">${g.range.start} – ${g.range.end} (Google má data se zpožděním ~2 dny)</div>` + g.sites.map((s) => {
    const maxC = Math.max(1, ...s.daily.map((d) => d.clicks));
    const name = s.siteUrl.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    return `
      <div class="gsc-site">
        <h3>${esc(name)}</h3>
        <div class="kpis kpis-sm">
          <div class="kpi"><div class="kpi-lbl">Kliknutí</div><div class="kpi-val">${n(s.totals.clicks)}</div></div>
          <div class="kpi"><div class="kpi-lbl">Zobrazení</div><div class="kpi-val">${n(s.totals.impressions)}</div></div>
          <div class="kpi"><div class="kpi-lbl">CTR</div><div class="kpi-val">${(s.totals.ctr * 100).toFixed(1)} %</div></div>
          <div class="kpi"><div class="kpi-lbl">Prům. pozice</div><div class="kpi-val">${s.totals.position ? s.totals.position.toFixed(1) : '—'}</div></div>
        </div>
        <div class="spark" title="Kliknutí po dnech">${s.daily.map((d) => `<span style="height:${Math.max(2, Math.round((d.clicks / maxC) * 100))}%" title="${d.date}: ${d.clicks} kliknutí, ${d.impressions} zobrazení"></span>`).join('')}</div>
        <div class="gsc-cols">
          <div><h4>Dotazy</h4><div class="table">${s.queries.map((q) => `<div class="tr tr3"><span>${esc(q.q)}</span><span>${n(q.clicks)}</span><span class="muted">${q.position.toFixed(1)}</span></div>`).join('') || '<p class="muted small">Zatím nic.</p>'}</div></div>
          <div><h4>Stránky</h4><div class="table">${s.pages.map((p) => `<div class="tr tr3"><span>${esc(p.page.replace(/^https?:\/\/[^/]+/, '') || '/')}</span><span>${n(p.clicks)}</span><span class="muted">${n(p.impressions)}</span></div>`).join('') || '<p class="muted small">Zatím nic.</p>'}</div></div>
        </div>
      </div>`;
  }).join('');
}

// ---------- 🌍 Jazyky ----------
// Jen kontrola (žádná editace): čte živé soubory webu přímo v prohlížeči —
// české TEXTS z /app.js (zdroj pravdy), jazykový pack /lang/<kód>.js (spuštěný
// v izolovaném window), data/verbs.json a index.html mutace. Nový jazyk = další
// položka v LANGS (postup v docs/i18n.md).
const LANGS = [
  { code: 'pl', flag: '🇵🇱', name: 'Polština', pack: '/lang/pl.js', index: '/pl/index.html', site: 'https://czasowniki.pl' },
];
// Záměrné rozdíly — nehlásit.
const I18N_IGNORE_IDS = new Set(['tone-pick-hantec']); // hantec (brněnský styl) je jen česky
const I18N_PACK_ONLY = new Set(['wv_app_labels']);     // čte se z packu napřímo, bez t()
// Soubory, které se na doménu mutace kopírují beze změny (build-pl.sh) → musí být shodné.
const I18N_SYNC_FILES = ['app.js', 'lang/pl.js', 'cloud.js', 'styles.css', 'data/verbs.json'];
// Znaky, které polština nemá — v překladu podezřelé (zapomenutá čeština).
const CZ_CHARS = /[ěščřžůťďňýáíéú]/i;

const fetchText = async (url) => {
  const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'nc=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error(url + ' → ' + r.status);
  return r.text();
};
function csTextKeys(app) {
  const s = app.indexOf('const TEXTS = {');
  const e = app.indexOf('\n};', s);
  if (s < 0 || e < 0) throw new Error('V app.js nenalezen slovník TEXTS');
  const block = app.slice(s, e);
  const keys = new Map(); // klíč → ukázka české hodnoty
  const re = /^ {2}(?:get\s+)?([A-Za-z_$][\w$]*)\s*[:(]([^\n]*)/gm;
  let m;
  while ((m = re.exec(block))) {
    const sample = (m[2].match(/'([^']{2,})'|`([^`]{2,})`|"([^"]{2,})"/) || []).slice(1).find(Boolean) || '';
    keys.set(m[1], sample);
  }
  const used = new Set([...app.matchAll(/\bt\('([A-Za-z_0-9]+)'\s*[,)]/g)].map((x) => x[1]));
  return { keys, used };
}
function runPack(src) {
  const win = {};
  new Function('window', src)(win); // stejný původ, náš vlastní soubor
  if (!win.LANG_PACK) throw new Error('pack nenastavil window.LANG_PACK');
  return win.LANG_PACK;
}
const flatStrings = (v) => {
  if (typeof v === 'string') return [v];
  if (typeof v === 'function') return [];
  if (Array.isArray(v)) return v.flatMap(flatStrings);
  if (v && typeof v === 'object') return Object.values(v).flatMap(flatStrings);
  return [];
};
function htmlIdsAndText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const ids = new Set([...doc.querySelectorAll('[id]')].map((e) => e.id));
  doc.querySelectorAll('script,style,template').forEach((e) => e.remove());
  const texts = [];
  const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) { const t = walker.currentNode.nodeValue.trim(); if (t) texts.push(t); }
  doc.querySelectorAll('[alt],[title],[aria-label],[placeholder]').forEach((e) => {
    ['alt', 'title', 'aria-label', 'placeholder'].forEach((a) => { const v = e.getAttribute(a); if (v) texts.push(v); });
  });
  doc.querySelectorAll('meta[content]').forEach((e) => { if (/description|title/.test(e.getAttribute('name') || e.getAttribute('property') || '')) texts.push(e.getAttribute('content')); });
  return { ids, texts };
}
async function analyzeLang(L, base) {
  const res = { L, issues: 0 };
  const pack = runPack(await fetchText(L.pack));
  const pt = pack.texts || {};
  res.textsTotal = base.cs.keys.size;
  res.missing = [...base.cs.keys.keys()].filter((k) => !(k in pt)).map((k) => ({ k, cs: base.cs.keys.get(k) }));
  res.extra = Object.keys(pt).filter((k) => !base.cs.keys.has(k) && !I18N_PACK_ONLY.has(k));
  res.suspicious = [];
  for (const [k, v] of Object.entries(pt)) {
    const bad = flatStrings(v).find((x) => CZ_CHARS.test(x));
    if (bad) res.suspicious.push({ k, v: bad });
  }
  const d = pack.data || {};
  res.verbs = base.verbs.filter((v) => !(d.verbs && d.verbs[v]));
  res.groups = base.groups.filter((g) => !(d.groups && d.groups[g] && d.groups[g].pattern && d.groups[g].rule));
  res.sections = base.sections.filter((s) => !(d.sections && d.sections[s]));
  res.voice = pack.voice || '';
  res.prices = pack.stripePrices ? Object.keys(pack.stripePrices) : [];
  // index.html mutace vs. český
  const h = htmlIdsAndText(await fetchText(L.index));
  res.htmlMissingIds = [...base.html.ids].filter((id) => !h.ids.has(id) && !I18N_IGNORE_IDS.has(id));
  res.htmlCz = [...new Set(h.texts.filter((t) => CZ_CHARS.test(t)))];
  res.issues = res.missing.length + res.suspicious.length + res.verbs.length + res.groups.length + res.sections.length + res.htmlMissingIds.length + res.htmlCz.length;
  return res;
}
async function checkSync(L) {
  if (!L.site) return null;
  const out = [];
  for (const f of I18N_SYNC_FILES) {
    const path = f.replace('lang/pl.js', L.pack.replace(/^\//, ''));
    try {
      const [a, b] = await Promise.all([fetchText('/' + path), fetchText(L.site + '/' + path)]);
      out.push({ f: path, same: a === b });
    } catch (e) { out.push({ f: path, same: null, err: e.message }); }
  }
  return out;
}
const pct = (have, total) => (total ? Math.round((have / total) * 100) : 100);
function langListHtml(items, fmt, limit = 40) {
  if (!items.length) return '';
  const more = items.length > limit ? `<div class="muted small">… a dalších ${items.length - limit}</div>` : '';
  return `<div class="table">${items.slice(0, limit).map(fmt).join('')}</div>${more}`;
}
async function renderLangs(main) {
  main.innerHTML = `
    <section class="pane full-pane">
      <header class="pane-head"><h1>Jazyky</h1><button class="btn btn-ghost btn-sm" id="lang-refresh" title="Znovu zkontrolovat">↻</button></header>
      <div class="wrap" id="lang-body"><div class="muted">Kontroluji překlady…</div></div>
    </section>`;
  $('#lang-refresh').addEventListener('click', () => renderLangs(main));
  const body = $('#lang-body');
  let base;
  try {
    const [app, verbsJson, idx] = await Promise.all([fetchText('/app.js'), fetchText('/data/verbs.json'), fetchText('/index.html')]);
    const data = JSON.parse(verbsJson);
    base = { cs: csTextKeys(app), verbs: [], groups: [], sections: [], html: htmlIdsAndText(idx) };
    data.sections.forEach((sec) => { base.sections.push(sec.id); sec.subsections.forEach((sub) => { base.groups.push(sub.id); sub.verbs.forEach((v) => base.verbs.push(v.inf)); }); });
  } catch (e) { body.innerHTML = `<div class="card">Nepodařilo se načíst zdroj: ${esc(e.message)}</div>`; return; }
  const undefinedKeys = [...base.cs.used].filter((k) => !base.cs.keys.has(k));
  let html = `<article class="card">
      <h2>🇨🇿 Čeština (zdroj pravdy)</h2>
      <div class="kpis kpis-sm">
        <div class="kpi"><div class="kpi-lbl">Texty</div><div class="kpi-val">${base.cs.keys.size}</div></div>
        <div class="kpi"><div class="kpi-lbl">Slovesa</div><div class="kpi-val">${base.verbs.length}</div></div>
        <div class="kpi"><div class="kpi-lbl">Skupiny</div><div class="kpi-val">${base.groups.length}</div></div>
        <div class="kpi"><div class="kpi-lbl">Sekce</div><div class="kpi-val">${base.sections.length}</div></div>
      </div>
      ${undefinedKeys.length ? `<div class="status-row" style="margin-top:12px"><span class="dot dot-warn"></span><div>Appka volá texty, které v TEXTS nejsou (uživatel by viděl jen název klíče): ${undefinedKeys.map((k) => `<code>${esc(k)}</code>`).join(', ')}</div></div>` : ''}
    </article>`;
  for (const L of LANGS) {
    let r;
    try { r = await analyzeLang(L, base); } catch (e) { html += `<article class="card"><h2>${L.flag} ${esc(L.name)}</h2><div class="muted">Kontrola selhala: ${esc(e.message)}</div></article>`; continue; }
    const textsHave = r.textsTotal - r.missing.length;
    const row = (lbl, have, total) => `<div class="kpi"><div class="kpi-lbl">${lbl}</div><div class="kpi-val">${pct(have, total)} %</div><div class="kpi-sub">${have} / ${total}</div></div>`;
    html += `<article class="card" id="lang-${L.code}">
      <div class="card-head"><h2>${L.flag} ${esc(L.name)} <span class="tag ${r.issues ? 'tag-gold' : 'tag-ok'}">${r.issues ? r.issues + ' k řešení' : 'vše přeloženo'}</span></h2>
        <div class="row-gap">${L.site ? `<a class="small" href="${esc(L.site)}" target="_blank" rel="noopener">${esc(L.site.replace(/^https:\/\//, ''))} ↗</a>` : ''}</div></div>
      <div class="kpis kpis-sm">
        ${row('Texty', textsHave, r.textsTotal)}
        ${row('Slovesa', base.verbs.length - r.verbs.length, base.verbs.length)}
        ${row('Skupiny', base.groups.length - r.groups.length, base.groups.length)}
        ${row('Sekce', base.sections.length - r.sections.length, base.sections.length)}
      </div>
      <div class="small muted" style="margin:10px 0 4px">Hlas pro čtení: <code>${esc(r.voice || '—')}</code> · Stripe ceny: ${r.prices.length ? r.prices.map(esc).join(', ') : '<span class="tag tag-hot">chybí — platilo by se v Kč</span>'}</div>
      ${r.missing.length ? `<h4>Nepřeložené texty (ukáže se česky)</h4>${langListHtml(r.missing, (x) => `<div class="tr tr-lang"><code>${esc(x.k)}</code><span class="muted">${esc(x.cs)}</span></div>`)}` : ''}
      ${r.suspicious.length ? `<h4>Podezřelé — v překladu je česká diakritika</h4>${langListHtml(r.suspicious, (x) => `<div class="tr tr-lang"><code>${esc(x.k)}</code><span>${esc(x.v)}</span></div>`)}` : ''}
      ${r.verbs.length ? `<h4>Slovesa bez překladu</h4><p>${r.verbs.map((v) => `<code>${esc(v)}</code>`).join(' ')}</p>` : ''}
      ${r.groups.length ? `<h4>Skupiny bez vzorce/pravidla</h4><p>${r.groups.map((v) => `<code>${esc(v)}</code>`).join(' ')}</p>` : ''}
      ${r.sections.length ? `<h4>Sekce bez názvu</h4><p>${r.sections.map((v) => `<code>${esc(v)}</code>`).join(' ')}</p>` : ''}
      ${r.htmlMissingIds.length ? `<h4>Prvky z české stránky, které v ${esc(L.index)} chybí</h4><p class="small muted">Typicky nová funkce, kterou jsme do mutace zapomněli přidat.</p><p>${r.htmlMissingIds.map((v) => `<code>#${esc(v)}</code>`).join(' ')}</p>` : ''}
      ${r.htmlCz.length ? `<h4>Česky vypadající text v ${esc(L.index)}</h4>${langListHtml(r.htmlCz, (x) => `<div class="tr tr-lang1"><span>${esc(x)}</span></div>`)}` : ''}
      ${r.extra.length ? `<details class="small muted" style="margin-top:10px"><summary>Klíče jen v packu (${r.extra.length}) — v češtině už nejsou, nejspíš přebytečné</summary><p>${r.extra.map((v) => `<code>${esc(v)}</code>`).join(' ')}</p></details>` : ''}
      <div id="sync-${L.code}" class="lang-sync"><div class="muted small">Porovnávám nasazenou verzi…</div></div>
    </article>`;
  }
  html += `<article class="card"><h2>➕ Nový jazyk</h2><p class="muted small">Postup je v <code>docs/i18n.md</code>: jazykový pack <code>lang/&lt;kód&gt;.js</code>, přeložený <code>&lt;kód&gt;/index.html</code>, ikony, Stripe ceny v místní měně a build/deploy skript. Až bude, objeví se tady s procenty hotového překladu.</p></article>`;
  body.innerHTML = html;
  for (const L of LANGS) {
    const box = $('#sync-' + L.code);
    if (!box) continue;
    const s = await checkSync(L);
    if (!s) { box.innerHTML = ''; continue; }
    const behind = s.filter((x) => x.same === false);
    const failed = s.filter((x) => x.same === null);
    box.innerHTML = `<div class="status-row" style="margin:14px 0 0"><span class="dot ${behind.length ? 'dot-warn' : failed.length ? 'dot-off' : 'dot-ok'}"></span><div>
      ${behind.length
        ? `<strong>${esc(L.site.replace(/^https:\/\//, ''))} je pozadu</strong> — liší se ${behind.map((x) => `<code>${esc(x.f)}</code>`).join(', ')}. Je potřeba nasadit mutaci (<code>sh tools/deploy-pl.sh</code>).`
        : failed.length ? `Nepodařilo se porovnat: ${failed.map((x) => esc(x.f)).join(', ')}`
        : `<strong>${esc(L.site.replace(/^https:\/\//, ''))} má aktuální verzi</strong> <span class="muted small">(${s.length} sdílených souborů shodných s ucseslovesa.cz)</span>`}
    </div></div>`;
  }
}

// ---------- 🎟️ Promo kódy ----------
const PLAN_LABEL = { annual_teacher: 'Učitelský (roční)', promo: 'Promo', student: 'Studentský', lifetime: 'Navždy' };
const unq = (v) => String(v ?? '').replace(/^["“„]+|["”“]+$/g, '');
const planLbl = (p) => PLAN_LABEL[unq(p)] || unq(p);
const dateOnly = (ts) => (ts ? new Date(ts).toLocaleDateString('cs', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '');
const toDateInput = (ts) => { if (!ts) return ''; const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fromDateInput = (v) => (v ? new Date(v + 'T23:59:59').getTime() : null);
function promoState(c) {
  if (!c.active) return { cls: 'tag', txt: 'vypnutý' };
  if (c.expiresAt && c.expiresAt < Date.now()) return { cls: 'tag', txt: 'po termínu' };
  if (c.maxUses && c.usedCount >= c.maxUses) return { cls: 'tag', txt: 'vyčerpaný' };
  return { cls: 'tag tag-ok', txt: 'aktivní' };
}
const durTxt = (c) => (c.durationDays ? (c.durationDays === 365 ? '1 rok' : `${c.durationDays} dní`) : 'navždy');

async function renderPromo(main) {
  main.innerHTML = `
    <section class="pane full-pane">
      <header class="pane-head">
        <h1>Promo kódy</h1>
        <button class="btn btn-primary btn-sm" id="promo-new-btn">＋ Nový kód</button>
      </header>
      <div class="promo-wrap">
        <article class="card hidden" id="promo-new"></article>
        <div class="promo-grid" id="promo-grid"><div class="muted pad">Načítám…</div></div>
      </div>
    </section>`;
  $('#promo-new-btn').addEventListener('click', () => {
    const box = $('#promo-new');
    if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = promoForm(null);
    wirePromoForm(box, null);
    box.querySelector('[name=code]').focus();
  });
  try {
    const { codes } = await api('/admin/promo');
    const grid = $('#promo-grid');
    if (!codes.length) { grid.innerHTML = '<div class="muted pad">Zatím žádné kódy.</div>'; return; }
    grid.innerHTML = codes.map((c) => {
      const st = promoState(c);
      const pct = c.maxUses ? Math.min(100, Math.round((c.usedCount / c.maxUses) * 100)) : 0;
      return `
      <a class="card promo-card" href="#promo/${encodeURIComponent(c.code)}">
        <div class="promo-top"><span class="promo-code">${esc(c.code)}</span><span class="${st.cls}">${st.txt}</span></div>
        <div class="small muted promo-note">${esc(unq(c.note) || planLbl(c.plan))}</div>
        <div class="promo-stats">
          <div><b>${c.usedCount}${c.maxUses ? ` / ${c.maxUses}` : ''}</b><span>použito</span></div>
          <div><b>${durTxt(c)}</b><span>Premium</span></div>
          <div><b>${c.expiresAt ? dateOnly(c.expiresAt) : '—'}</b><span>uplatnit do</span></div>
        </div>
        ${c.maxUses ? `<div class="bar"><span style="width:${pct}%"></span></div>` : ''}
        <div class="small muted">${c.lastRedeemedAt ? 'Naposledy použit ' + fmtTime(c.lastRedeemedAt) : 'Zatím nepoužit'}</div>
      </a>`;
    }).join('');
  } catch (e) {
    $('#promo-grid').innerHTML = `<div class="muted pad">Nepodařilo se načíst (${esc(e.message)}).</div>`;
  }
}

function promoForm(c) {
  const isNew = !c;
  const v = c || { active: true, plan: 'annual_teacher', durationDays: 365, maxUses: 100, expiresAt: null, note: '' };
  return `
    <h2>${isNew ? 'Nový kód' : 'Nastavení kódu'}</h2>
    <form class="form-grid" autocomplete="off">
      ${isNew ? `
      <label class="fld fld-wide"><span>Kód</span>
        <div class="row"><input name="code" required maxlength="40" placeholder="např. SKOLA2027" style="text-transform:uppercase" /><button type="button" class="btn btn-ghost btn-sm" data-gen>Vygenerovat</button></div>
        <small>Písmena, čísla, - a _. Uživatel ho zadává v appce v nabídce Premium → 🎟️ Mám slevový kód.</small>
      </label>` : ''}
      <label class="fld fld-wide"><span>Poznámka (k čemu kód je)</span><input name="note" maxlength="300" value="${esc(v.note || '')}" placeholder="např. ZŠ Brno – 8. A" /></label>
      <label class="fld"><span>Typ</span>
        <select name="plan">${Object.entries(PLAN_LABEL).map(([k, l]) => `<option value="${k}" ${v.plan === k ? 'selected' : ''}>${l}</option>`).join('')}${PLAN_LABEL[v.plan] ? '' : `<option value="${esc(v.plan)}" selected>${esc(v.plan)}</option>`}</select>
      </label>
      <label class="fld"><span>Délka Premium (dní)</span>
        <input name="durationDays" type="number" min="1" value="${v.durationDays || ''}" placeholder="prázdné = navždy" />
        <div class="chips"><button type="button" data-dur="30">30 dní</button><button type="button" data-dur="365">1 rok</button><button type="button" data-dur="">navždy</button></div>
      </label>
      <label class="fld"><span>Max. počet použití</span><input name="maxUses" type="number" min="1" value="${v.maxUses || ''}" placeholder="prázdné = bez limitu" /></label>
      <label class="fld"><span>Uplatnit lze do</span><input name="expiresAt" type="date" value="${toDateInput(v.expiresAt)}" /><small>Prázdné = bez termínu. Kdo už kód uplatnil, má Premium dál.</small></label>
      <label class="check fld-wide"><input type="checkbox" name="active" ${v.active ? 'checked' : ''} /><span>Kód je aktivní (lze ho uplatnit)</span></label>
      <div class="fld-wide form-actions"><button class="btn btn-primary" type="submit">${isNew ? 'Vytvořit kód' : 'Uložit změny'}</button></div>
    </form>`;
}

function wirePromoForm(box, c) {
  const f = box.querySelector('form');
  f.querySelector('[data-gen]')?.addEventListener('click', () => {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const rnd = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => abc[b % abc.length]).join('');
    const pre = f.plan.value === 'student' ? 'STUDENT' : f.plan.value === 'annual_teacher' ? 'UCITEL' : 'PROMO';
    f.code.value = pre + rnd;
  });
  f.querySelectorAll('[data-dur]').forEach((b) => b.addEventListener('click', () => { f.durationDays.value = b.dataset.dur; }));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      note: f.note.value.trim(),
      plan: f.plan.value,
      durationDays: f.durationDays.value || null,
      maxUses: f.maxUses.value || null,
      expiresAt: fromDateInput(f.expiresAt.value),
      active: f.active.checked,
    };
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      if (!c) {
        body.code = f.code.value.trim().toUpperCase();
        await api('/admin/promo', { method: 'POST', body });
        toast(`Kód ${body.code} vytvořen ✓`, 'ok');
        location.hash = '#promo/' + encodeURIComponent(body.code);
      } else {
        await api('/admin/promo/' + encodeURIComponent(c.code), { method: 'PATCH', body });
        toast('Uloženo ✓', 'ok');
        renderPromoDetail($('#main'), c.code);
      }
    } catch (err) {
      toast(err.message === 'exists' ? 'Takový kód už existuje.' : err.message === 'bad_code' ? 'Kód smí mít jen písmena, čísla, - a _ (3–40 znaků).' : 'Nepovedlo se: ' + err.message, 'error');
      btn.disabled = false;
    }
  });
}

async function renderPromoDetail(main, code) {
  main.innerHTML = `<section class="pane full-pane"><header class="pane-head"><h1><a class="back-inline" href="#promo">←</a> ${esc(code)}</h1></header><div class="promo-wrap"><div class="muted pad">Načítám…</div></div></section>`;
  let r;
  try { r = await api('/admin/promo/' + encodeURIComponent(code)); } catch (e) {
    main.querySelector('.promo-wrap').innerHTML = `<div class="muted pad">${e.status === 404 ? 'Kód neexistuje.' : 'Nepodařilo se načíst.'}</div>`;
    return;
  }
  const c = r.code;
  const st = promoState(c);
  const people = r.people || [];
  main.querySelector('.promo-wrap').innerHTML = `
    <div class="promo-head-row">
      <span class="promo-code big">${esc(c.code)}</span><span class="${st.cls}">${st.txt}</span>
      <button class="btn btn-ghost btn-sm" id="promo-copy">Kopírovat kód</button>
    </div>
    <div class="promo-stats wide card">
      <div><b>${c.usedCount}${c.maxUses ? ` / ${c.maxUses}` : ''}</b><span>použito</span></div>
      <div><b>${durTxt(c)}</b><span>Premium od uplatnění</span></div>
      <div><b>${c.expiresAt ? dateOnly(c.expiresAt) : 'bez termínu'}</b><span>uplatnit do</span></div>
      <div><b>${esc(planLbl(c.plan))}</b><span>typ</span></div>
    </div>
    <article class="card">
      <h2>Kdo kód uplatnil (${people.length})</h2>
      ${people.length ? `<div class="table"><div class="tr th"><span>Uživatel</span><span>Jazyk</span><span>Premium do</span></div>${people.map((p) => {
        const exp = p.premiumExpiresAt;
        const other = p.premiumCode && p.premiumCode !== c.code;
        const state = !p.premium ? '<span class="muted">bez Premium</span>'
          : exp ? (exp < Date.now() ? `<span class="muted">vypršelo ${dateOnly(exp)}</span>` : dateOnly(exp)) : 'navždy';
        return `<div class="tr"><span>${p.email ? esc(p.email) : '<span class="muted">' + esc(p.uid.slice(0, 10)) + '…</span>'}${p.name ? `<br><span class="small muted">${esc(p.name)}</span>` : ''}</span><span>${p.lang === 'pl' ? '🇵🇱' : p.lang ? '🇨🇿' : '—'}</span><span>${state}${other ? `<br><span class="small muted">teď přes ${esc(p.premiumCode)}</span>` : ''}</span></div>`;
      }).join('')}</div>` : '<p class="muted small">Zatím ho nikdo neuplatnil.</p>'}
    </article>
    <article class="card" id="promo-edit">${promoForm(c)}</article>`;
  wirePromoForm($('#promo-edit'), c);
  $('#promo-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(c.code); toast('Zkopírováno', 'ok'); } catch { toast(c.code); }
  });
}

// ---------- ⚙️ Nastavení ----------
async function renderSettings(main) {
  main.innerHTML = `
    <section class="pane full-pane">
      <header class="pane-head"><h1>Nastavení</h1></header>
      <div class="settings">
        <article class="card" id="push-card"><h2>🔔 Upozornění na nové zprávy</h2><div class="muted">Načítám…</div></article>
        <article class="card" id="pair-card">
          <h2>📱 Přihlásit další zařízení</h2>
          <p class="small muted" style="margin:0 0 12px">Hlavně pro iPhone s adminem na ploše, kde Google přihlášení nefunguje. Vygenerujte kód a zadejte ho na úvodní obrazovce adminu na druhém zařízení. Platí 10 minut a jen jednou.</p>
          <div id="pair-box"><button class="btn btn-primary" id="pair-gen">Vygenerovat kód</button></div>
        </article>
        <article class="card">
          <h2>👤 Přístup</h2>
          <p class="small">Přihlášen: <strong>${esc(me.email)}</strong>. Kdo má přístup, určuje proměnná <code>ADMIN_EMAILS</code> v Railway.</p>
        </article>
      </div>
    </section>`;
  drawPushCard();
  $('#pair-gen').addEventListener('click', genPairCode);
}
let pairTimer = null;
async function genPairCode() {
  const box = $('#pair-box');
  try {
    const r = await api('/admin/pair/create', { method: 'POST' });
    box.innerHTML = `<div class="pair-code">${esc(r.code)}</div><div class="small muted" id="pair-left"></div><button class="btn btn-ghost btn-sm" id="pair-gen" style="margin-top:10px">Nový kód</button>`;
    $('#pair-gen').addEventListener('click', genPairCode);
    clearInterval(pairTimer);
    const tick = () => {
      const s = Math.max(0, Math.round((r.exp - Date.now()) / 1000));
      const el = $('#pair-left');
      if (!el) { clearInterval(pairTimer); return; }
      el.textContent = s ? `Platí ještě ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'Kód vypršel.';
      if (!s) clearInterval(pairTimer);
    };
    tick();
    pairTimer = setInterval(tick, 1000);
  } catch (e) {
    toast('Nepovedlo se: ' + e.message, 'error');
  }
}
async function drawPushCard() {
  const card = $('#push-card');
  if (!card) return;
  let devices = [];
  try { devices = (await api('/admin/push/key')).devices || []; } catch {}
  let sub = null;
  try { sub = await currentSub(); } catch {}
  const on = !!sub && Notification.permission === 'granted';
  let state;
  if (!pushSupported() && isIOS && !isStandalone) {
    state = `
      <div class="status-row"><span class="dot dot-warn"></span><div><strong>Na iPhonu chodí notifikace jen z ikony na ploše.</strong></div></div>
      <ol class="steps">
        <li>Otevřete <strong>ucseslovesa.cz/admin</strong> v Safari.</li>
        <li>Klepněte na <strong>Sdílet</strong> (čtvereček se šipkou) → <strong>Přidat na plochu</strong>.</li>
        <li>Spusťte <strong>Admin</strong> z plochy, přejděte do Nastavení a klepněte na „Zapnout notifikace“.</li>
      </ol>`;
  } else if (!pushSupported()) {
    state = '<div class="status-row"><span class="dot dot-off"></span><div>Tento prohlížeč notifikace neumí. Zkuste Chrome nebo Safari.</div></div>';
  } else if (Notification.permission === 'denied') {
    state = '<div class="status-row"><span class="dot dot-off"></span><div>Notifikace jsou pro tuto stránku <strong>zakázané</strong>. Povolte je v nastavení prohlížeče (na iPhonu: Nastavení → Oznámení → Admin) a zkuste znovu.</div></div>';
  } else if (on) {
    state = `
      <div class="status-row"><span class="dot dot-ok"></span><div><strong>Zapnuto na tomto zařízení.</strong> Každá nová zpráva z chatu přijde jako notifikace.</div></div>
      <div class="btn-row"><button class="btn btn-primary" id="push-test">Poslat testovací notifikaci</button><button class="btn btn-ghost" id="push-off">Vypnout na tomto zařízení</button></div>`;
  } else {
    state = `
      <div class="status-row"><span class="dot dot-off"></span><div>Na tomto zařízení zatím vypnuto.</div></div>
      <div class="btn-row"><button class="btn btn-primary" id="push-on">🔔 Zapnout notifikace</button></div>`;
  }
  const others = devices.length
    ? `<div class="devices"><div class="small muted">Zařízení s notifikacemi (${devices.length}):</div>${devices.map((d) => `
        <div class="device"><span>📱 ${esc(d.label || 'Zařízení')} <span class="muted small">· od ${fmtTime(d.at)}</span></span><button class="btn-link small" data-del-dev="${esc(d.id)}">odebrat</button></div>`).join('')}</div>`
    : '';
  const fallback = `<p class="small muted" style="margin:14px 0 0">Když žádné zařízení notifikace nemá, chodí upozornění e-mailem (jen u první nepřečtené zprávy v konverzaci).</p>`;
  card.innerHTML = `<h2>🔔 Upozornění na nové zprávy</h2>${state}${others}${fallback}`;
  $('#push-on')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await enablePush(); toast('Notifikace zapnuté ✓', 'ok'); }
    catch (err) {
      toast(err.message === 'denied' ? 'Notifikace jste zakázal — povolte je v nastavení.' : err.message === 'dismissed' ? 'Povolení nebylo potvrzeno.' : 'Nepovedlo se: ' + err.message, 'error');
    }
    drawPushCard();
  });
  $('#push-off')?.addEventListener('click', async () => { await disablePush(); toast('Vypnuto', 'ok'); drawPushCard(); });
  $('#push-test')?.addEventListener('click', async () => {
    try { const r = await api('/admin/push/test', { method: 'POST' }); toast(r.ok ? `Odesláno na ${r.delivered} zaříz. — mrkněte na notifikaci` : 'Žádné zařízení ji nepřijalo.', r.ok ? 'ok' : 'error'); }
    catch (e) { toast('Nepovedlo se: ' + e.message, 'error'); }
  });
  card.querySelectorAll('[data-del-dev]').forEach((b) => b.addEventListener('click', async () => {
    await api('/admin/push/unsubscribe', { method: 'POST', body: { id: b.dataset.delDev } }).catch(() => {});
    drawPushCard();
  }));
}
