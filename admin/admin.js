// Administrace appky — ucseslovesa.cz/admin/
// Přihlášení přes Google (stejný Firebase projekt jako appka); všechna data jdou
// přes backend (Railway), který pustí jen účty z env ADMIN_EMAILS.
// Moduly: #chat, #reports, #settings — další (promo kódy, zákazníci…) přibudou.

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


// ---------- 🎟️ Promo kódy ----------
const PLAN_LABEL = { annual_teacher: 'Učitelský (roční)', promo: 'Promo', student: 'Studentský' };
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
        <div class="small muted promo-note">${esc(c.note || PLAN_LABEL[c.plan] || c.plan)}</div>
        <div class="promo-stats">
          <div><b>${c.usedCount}</b>${c.maxUses ? ` / ${c.maxUses}` : ''}<span>použito</span></div>
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
      <div><b>${c.usedCount}</b>${c.maxUses ? ` / ${c.maxUses}` : ''}<span>použito</span></div>
      <div><b>${durTxt(c)}</b><span>Premium od uplatnění</span></div>
      <div><b>${c.expiresAt ? dateOnly(c.expiresAt) : 'bez termínu'}</b><span>uplatnit do</span></div>
      <div><b>${esc(PLAN_LABEL[c.plan] || c.plan)}</b><span>typ</span></div>
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
