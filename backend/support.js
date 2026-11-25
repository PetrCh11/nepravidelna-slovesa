// Chat s podporou + admin API (stránka ucseslovesa.cz/admin/).
//
// Firestore:
//   supportChats/{chatId}            — jedna konverzace na zákazníka
//     chatId = 'u_<uid>' (přihlášený) nebo 'a_<sha256(anonKey)>' (nepřihlášený;
//     anonKey je náhodný řetězec uložený jen v zařízení zákazníka)
//   supportChats/{chatId}/messages   — {from: 'user'|'admin', text, at}
//   adminConfig/telegram             — {chatId} po propojení Telegram bota
//
// Env (Railway):
//   ADMIN_EMAILS         — Google účty s přístupem do adminu (čárkami)
//   TELEGRAM_BOT_TOKEN   — volitelné; upozornění na nové zprávy do Telegramu
//   (Web Push do admin stránky nepotřebuje nic: VAPID klíče si server vygeneruje
//    sám a uloží do adminConfig/webpush, odběry zařízení do adminConfig/webpush/subs)
//   REPORT_EMAIL_TO      — záložní upozornění e-mailem, když Telegram není propojený

import crypto from 'node:crypto';
import webpush from 'web-push';

const ADMIN_URL = 'https://ucseslovesa.cz/admin/';
const APP_URLS = { cs: 'https://ucseslovesa.cz', pl: 'https://czasowniki.pl' };
const MAX_TEXT = 2000;

const clip = (v, n) => String(v ?? '').slice(0, n);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isEmail = (v) => /^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{2,20}$/.test(String(v || '').trim());
const langOf = (v) => (v === 'pl' ? 'pl' : 'cs');

// Jednoduchý limit v paměti (po restartu se vynuluje, což nevadí).
function makeLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((ts) => now - ts < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return false; }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear();
    return true;
  };
}

export function registerSupportRoutes(app, { db, admin, sendEmail }) {
  const chats = db.collection('supportChats');
  const sendLimit = makeLimiter(20, 10 * 60 * 1000);   // 20 zpráv / 10 min / IP
  const readLimit = makeLimiter(120, 10 * 60 * 1000);  // polling
  const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();

  async function decodeToken(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) return null;
    try { return await admin.auth().verifyIdToken(m[1]); } catch { return null; }
  }

  const adminEmails = () => (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  // Přístup: Google účet z ADMIN_EMAILS (ověřený e-mail), nebo zařízení
  // spárované jednorázovým kódem (custom token s claimem adminPair — e-mail
  // se pak bere z uživatelského záznamu a znovu kontroluje proti ADMIN_EMAILS).
  async function requireAdmin(req, res) {
    const d = await decodeToken(req);
    if (!d) { res.status(401).json({ error: 'unauthenticated' }); return null; }
    let email = String(d.email || '').toLowerCase();
    let ok = !!d.email_verified && adminEmails().includes(email);
    if (!ok && d.adminPair === true) {
      try {
        const u = await admin.auth().getUser(d.uid);
        email = String(u.email || '').toLowerCase();
        ok = adminEmails().includes(email);
      } catch { ok = false; }
    }
    if (!ok) {
      res.status(403).json({ error: 'forbidden', email });
      return null;
    }
    return { ...d, email };
  }

  // ---------- Párování zařízení kódem ----------
  // iPhone s adminem „na ploše" má oddělené úložiště a Google přihlášení
  // (popup/redirect přes firebaseapp.com) v něm selže. Na přihlášeném zařízení
  // se proto vygeneruje jednorázový kód (10 min) a nové zařízení ho vymění
  // za Firebase custom token.
  const pairRef = db.collection('adminConfig').doc('pairing');
  const pairLimit = makeLimiter(10, 10 * 60 * 1000);
  const hashCode = (c) => crypto.createHash('sha256').update('pair:' + String(c).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
  app.post('/admin/pair/create', async (req, res) => {
    const d = await requireAdmin(req, res);
    if (!d) return;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(8);
    const code = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    const exp = Date.now() + 10 * 60 * 1000;
    try {
      await pairRef.set({ hash: hashCode(code), uid: d.uid, exp, attempts: 0 });
      res.json({ code: code.slice(0, 4) + '-' + code.slice(4), exp });
    } catch (e) {
      console.error('Pair create failed:', e);
      res.status(500).json({ error: 'failed' });
    }
  });
  app.post('/admin/pair/redeem', async (req, res) => {
    if (!pairLimit(ipOf(req))) return res.status(429).json({ error: 'too_many' });
    const code = String(req.body?.code || '');
    try {
      const snap = await pairRef.get();
      const p = snap.exists ? snap.data() : null;
      if (!p || p.exp < Date.now()) return res.status(400).json({ error: 'expired' });
      if (p.hash !== hashCode(code)) {
        // Po 5 chybných pokusech kód zneplatnit
        if ((p.attempts || 0) + 1 >= 5) await pairRef.delete();
        else await pairRef.update({ attempts: (p.attempts || 0) + 1 });
        return res.status(400).json({ error: 'bad_code' });
      }
      await pairRef.delete();
      const u = await admin.auth().getUser(p.uid);
      if (!adminEmails().includes(String(u.email || '').toLowerCase())) return res.status(403).json({ error: 'forbidden' });
      const token = await admin.auth().createCustomToken(p.uid, { adminPair: true });
      console.log('Admin pair: zařízení spárováno →', u.email);
      res.json({ token });
    } catch (e) {
      console.error('Pair redeem failed:', e);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Najde (případně připraví) konverzaci volajícího. Přihlášený má 'u_<uid>';
  // pokud ale už dřív psal nepřihlášený z tohoto zařízení, pokračuje se v té
  // anonymní konverzaci (doplní se k ní uid/e-mail), ať se historie neztratí.
  async function resolveChat(req, anonKey) {
    const d = await decodeToken(req);
    const anonId = /^[A-Za-z0-9_-]{20,64}$/.test(String(anonKey || ''))
      ? 'a_' + crypto.createHash('sha256').update(String(anonKey)).digest('hex').slice(0, 32)
      : null;
    if (d) {
      const uRef = chats.doc('u_' + d.uid);
      const uSnap = await uRef.get();
      if (uSnap.exists) return { ref: uRef, snap: uSnap, user: d };
      if (anonId) {
        const aRef = chats.doc(anonId);
        const aSnap = await aRef.get();
        if (aSnap.exists) return { ref: aRef, snap: aSnap, user: d };
      }
      return { ref: uRef, snap: uSnap, user: d };
    }
    if (!anonId) return null;
    const aRef = chats.doc(anonId);
    return { ref: aRef, snap: await aRef.get(), user: null };
  }

  async function messagesOf(ref, limit = 300) {
    const qs = await ref.collection('messages').orderBy('at', 'asc').limitToLast(limit).get();
    return qs.docs.map((m) => ({ id: m.id, ...m.data() }));
  }


  // ---------- Web Push (notifikace do admin stránky / PWA na ploše) ----------
  const pushRef = db.collection('adminConfig').doc('webpush');
  let vapid = null;
  async function getVapid() {
    if (vapid) return vapid;
    const snap = await pushRef.get();
    if (snap.exists && snap.data().publicKey) {
      vapid = snap.data();
    } else {
      const k = webpush.generateVAPIDKeys();
      vapid = { publicKey: k.publicKey, privateKey: k.privateKey, createdAt: Date.now() };
      await pushRef.set(vapid);
      console.log('Web Push: vygenerovány nové VAPID klíče');
    }
    return vapid;
  }
  const subId = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 40);

  // Pošle notifikaci na všechna přihlášená zařízení; vrátí počet doručených.
  async function pushAll(payload) {
    const subs = await pushRef.collection('subs').get();
    if (subs.empty) return 0;
    const v = await getVapid();
    let ok = 0;
    await Promise.all(subs.docs.map(async (d) => {
      try {
        await webpush.sendNotification(d.data().subscription, JSON.stringify(payload), {
          TTL: 24 * 3600,
          urgency: 'high',
          vapidDetails: { subject: 'https://ucseslovesa.cz/admin/', publicKey: v.publicKey, privateKey: v.privateKey },
        });
        ok++;
      } catch (e) {
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await d.ref.delete().catch(() => {});
          console.log('Web Push: odběr vypršel, smazán →', d.id);
        } else {
          console.error('Web Push FAILED →', d.id, e?.statusCode || '', e?.body || e?.message || e);
        }
      }
    }));
    return ok;
  }
  async function unreadTotal() {
    try { return (await chats.where('unreadAdmin', '>', 0).count().get()).data().count; } catch { return 0; }
  }

  // ---------- Telegram ----------
  async function telegramChatId() {
    if (process.env.TELEGRAM_CHAT_ID) return process.env.TELEGRAM_CHAT_ID;
    const s = await db.collection('adminConfig').doc('telegram').get();
    return s.exists ? s.data().chatId || null : null;
  }
  async function telegram(method, body) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return { ok: false, description: 'no_token' };
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return r.json().catch(() => ({ ok: false, description: 'bad_json' }));
  }

  // Upozornění autora na novou zprávu: Telegram (každá zpráva), jinak e-mail
  // jen u první nepřečtené zprávy v konverzaci (šetří limit MailerSend).
  async function notifyAdmin(chatId, chat, text, wasUnread) {
    const who = [
      chat.lang === 'pl' ? '🇵🇱 PL' : '🇨🇿 CZ',
      chat.premium ? '⭐ Premium' : null,
      chat.email || chat.contactEmail || 'anonym',
    ].filter(Boolean).join(' · ');
    const link = `${ADMIN_URL}#chat/${chatId}`;
    try {
      const delivered = await pushAll({
        title: `💬 ${chat.email || chat.contactEmail || 'Nová zpráva'}`,
        body: `${chat.lang === 'pl' ? '🇵🇱 ' : ''}${chat.premium ? '⭐ ' : ''}${clip(text, 180)}`,
        url: `/admin/#chat/${chatId}`,
        tag: 'chat-' + chatId,
        badge: await unreadTotal(),
      }).catch((e) => { console.error('Web Push notify failed:', e?.message || e); return 0; });
      if (delivered > 0) return;
      const tgChat = process.env.TELEGRAM_BOT_TOKEN ? await telegramChatId() : null;
      if (tgChat) {
        const r = await telegram('sendMessage', {
          chat_id: tgChat,
          text: `💬 ${who}\n\n${clip(text, 3000)}\n\n${link}`,
          disable_web_page_preview: true,
        });
        if (r.ok) return;
        console.error('Telegram notify FAILED →', r.description);
      }
      const to = process.env.REPORT_EMAIL_TO;
      if (!to || wasUnread) return;
      const r = await sendEmail({
        to,
        subject: `💬 Nová zpráva v chatu (${who})`,
        html: `<p style="color:#555">${esc(who)}</p><p style="font-size:16px">${esc(text).replace(/\n/g, '<br>')}</p><p><a href="${link}">Odpovědět v adminu →</a></p>`,
        text: `${who}\n\n${text}\n\nOdpovědět: ${link}`,
      });
      if (!r.ok) console.error('Chat notify email FAILED →', chatId, r.reason, r.error || '');
    } catch (e) {
      console.error('Chat notify failed:', e?.message || e);
    }
  }

  // ---------- Zákaznická strana ----------

  // POST /chat/thread {anonKey, peek} → historie (a označení odpovědí za přečtené),
  // s peek:true jen počet nepřečtených odpovědí (pro tečku u menu).
  app.post('/chat/thread', async (req, res) => {
    if (!readLimit(ipOf(req))) return res.status(429).json({ error: 'too_many' });
    const b = req.body || {};
    try {
      const c = await resolveChat(req, b.anonKey);
      if (!c || !c.snap.exists) return res.json({ exists: false, unread: 0, messages: [] });
      const data = c.snap.data();
      if (b.peek) return res.json({ exists: true, unread: data.unreadUser || 0 });
      const messages = await messagesOf(c.ref);
      if (data.unreadUser) await c.ref.update({ unreadUser: 0 });
      res.json({
        exists: true,
        unread: 0,
        hasEmail: !!(data.email || data.contactEmail),
        messages: messages.map((m) => ({ id: m.id, from: m.from, text: m.text, at: m.at })),
      });
    } catch (e) {
      console.error('Chat thread failed:', e);
      res.status(500).json({ error: 'failed' });
    }
  });

  // POST /chat/send {anonKey, text, email?, lang, page, website}
  app.post('/chat/send', async (req, res) => {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true }); // honeypot
    if (!sendLimit(ipOf(req))) return res.status(429).json({ error: 'too_many' });
    const text = String(b.text || '').trim().slice(0, MAX_TEXT);
    if (!text) return res.status(400).json({ error: 'empty' });
    try {
      const c = await resolveChat(req, b.anonKey);
      if (!c) return res.status(400).json({ error: 'no_identity' });
      const now = Date.now();
      const prev = c.snap.exists ? c.snap.data() : null;
      const patch = {
        updatedAt: now,
        lastText: clip(text, 160),
        lastFrom: 'user',
        unreadAdmin: (prev?.unreadAdmin || 0) + 1,
        status: 'open',
        lang: langOf(b.lang),
        page: clip(b.page, 300),
        userAgent: clip(req.headers['user-agent'], 300),
      };
      if (!prev) { patch.createdAt = now; patch.unreadUser = 0; }
      if (isEmail(b.email)) patch.contactEmail = String(b.email).trim();
      if (c.user) {
        patch.uid = c.user.uid;
        if (c.user.email) patch.email = c.user.email;
        if (c.user.name) patch.name = clip(c.user.name, 80);
        try {
          const u = await db.collection('users').doc(c.user.uid).get();
          const ud = u.exists ? u.data() : {};
          const exp = Number(ud.premiumExpiresAt) || 0;
          patch.premium = !!ud.premium && (!exp || exp > now);
        } catch { /* nevadí */ }
      }
      await c.ref.set(patch, { merge: true });
      await c.ref.collection('messages').add({ from: 'user', text, at: now });
      console.log('Chat message →', c.ref.id, patch.lang, text.length + ' zn.');
      notifyAdmin(c.ref.id, { ...prev, ...patch }, text, (prev?.unreadAdmin || 0) > 0);
      res.json({ ok: true, at: now });
    } catch (e) {
      console.error('Chat send failed:', e);
      res.status(500).json({ error: 'failed' });
    }
  });

  // ---------- Admin ----------

  app.get('/admin/me', async (req, res) => {
    const d = await requireAdmin(req, res);
    if (!d) return;
    try {
      const [unreadChats, newReports] = await Promise.all([
        chats.where('unreadAdmin', '>', 0).count().get(),
        db.collection('errorReports').where('status', '==', 'new').count().get(),
      ]);
      res.json({
        email: d.email,
        counts: { chats: unreadChats.data().count, reports: newReports.data().count },
        telegram: { tokenSet: !!process.env.TELEGRAM_BOT_TOKEN, linked: !!(await telegramChatId()) },
        pushDevices: (await pushRef.collection('subs').count().get()).data().count,
        email_notify: !!process.env.REPORT_EMAIL_TO,
      });
    } catch (e) {
      console.error('Admin me failed:', e);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.get('/admin/chats', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const qs = await chats.orderBy('updatedAt', 'desc').limit(300).get();
      res.json({ chats: qs.docs.map((d) => ({ id: d.id, ...d.data() })) });
    } catch (e) {
      console.error('Admin chats failed:', e);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.get('/admin/chats/:id', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const ref = chats.doc(req.params.id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'not_found' });
      const messages = await messagesOf(ref, 1000);
      if (snap.data().unreadAdmin) await ref.update({ unreadAdmin: 0 });
      res.json({ chat: { id: snap.id, ...snap.data(), unreadAdmin: 0 }, messages });
    } catch (e) {
      console.error('Admin chat failed:', e);
      res.status(500).json({ error: 'failed' });
    }
  });

  // POST /admin/chats/:id/reply {text, email: bool}
  app.post('/admin/chats/:id/reply', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const text = String(req.body?.text || '').trim().slice(0, 5000);
    if (!text) return res.status(400).json({ error: 'empty' });
    try {
      const ref = chats.doc(req.params.id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'not_found' });
      const chat = snap.data();
      const now = Date.now();
      await ref.collection('messages').add({ from: 'admin', text, at: now });
      await ref.update({
        updatedAt: now,
        lastText: clip(text, 160),
        lastFrom: 'admin',
        unreadAdmin: 0,
        unreadUser: (chat.unreadUser || 0) + 1,
      });
      let emailed = null;
      const to = chat.contactEmail || chat.email;
      if (req.body?.email && to) {
        const pl = chat.lang === 'pl';
        const url = `${APP_URLS[langOf(chat.lang)]}/?chat=1`;
        const r = await sendEmail({
          to,
          senderName: pl ? 'Czasowniki nieregularne' : null,
          subject: pl ? 'Odpowiedź na Twoją wiadomość 💬' : 'Odpověď na vaši zprávu 💬',
          html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.6;color:#1d2329;max-width:560px">
            <p style="margin:0 0 14px;color:#6b7280">${pl ? 'Odpowiedź na Twoją wiadomość w aplikacji:' : 'Odpověď na vaši zprávu v appce:'}</p>
            <div style="background:#f3f1ff;border-left:4px solid #7c6ff5;border-radius:10px;padding:14px 16px;margin:0 0 18px">${esc(text).replace(/\n/g, '<br>')}</div>
            <p style="margin:0 0 18px"><a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#5dc9bd,#7c6ff5);color:#fff;text-decoration:none;padding:11px 24px;border-radius:999px;font-weight:700">${pl ? 'Odpowiedz w aplikacji →' : 'Odpovědět v appce →'}</a></p>
            <p style="margin:0;font-size:13px;color:#8a92a0">${pl ? 'Na tego maila możesz też po prostu odpowiedzieć.' : 'Na tento e-mail můžete také jen odpovědět.'}</p>
          </div>`,
          text: `${text}\n\n${pl ? 'Odpowiedz w aplikacji' : 'Odpovědět v appce'}: ${url}`,
        });
        emailed = r.ok;
        if (!r.ok) console.error('Chat reply email FAILED →', ref.id, r.reason, r.error || '');
      }
      res.json({ ok: true, at: now, emailed });
    } catch (e) {
      console.error('Admin reply failed:', e);
      res.status(500).json({ error: 'failed' });
    }
  });

  // POST /admin/chats/:id/status {status: 'open'|'closed'}
  app.post('/admin/chats/:id/status', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const status = req.body?.status === 'closed' ? 'closed' : 'open';
    try {
      await chats.doc(req.params.id).update({ status, unreadAdmin: 0 });
      res.json({ ok: true, status });
    } catch (e) {
      res.status(500).json({ error: 'failed' });
    }
  });

  // Smazání konverzace i se zprávami (admin potvrzuje v UI).
  app.delete('/admin/chats/:id', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      await db.recursiveDelete(chats.doc(req.params.id));
      console.log('Chat deleted →', req.params.id);
      res.json({ ok: true });
    } catch (e) {
      console.error('Admin chat delete failed:', e);
      res.status(500).json({ error: 'failed' });
    }
  });

  // ---------- 🎟️ Promo kódy (kolekce promoCodes, uplatnění přes /redeem-code v server.js) ----------
  const promo = db.collection('promoCodes');
  const promoPublic = (id, d) => ({
    code: id,
    plan: d.plan || 'promo',
    note: d.note || '',
    active: d.active !== false,
    usedCount: Number(d.usedCount || 0),
    maxUses: Number(d.maxUses || 0) || null,
    durationDays: Number(d.durationDays || 0) || null,
    expiresAt: Number(d.expiresAt || 0) || null,
    lastRedeemedAt: Number(d.lastRedeemedAt || 0) || null,
    createdAt: Number(d.createdAt || 0) || null,
  });
  const numOrNull = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };

  app.get('/admin/promo', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const qs = await promo.get();
      const codes = qs.docs.map((d) => promoPublic(d.id, d.data()))
        .sort((a, b) => (b.lastRedeemedAt || b.createdAt || 0) - (a.lastRedeemedAt || a.createdAt || 0));
      res.json({ codes });
    } catch (e) {
      console.error('Admin promo list failed:', e);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Detail kódu včetně toho, kdo ho uplatnil (e-mail z Firebase Auth, platnost Premium z users/{uid})
  app.get('/admin/promo/:code', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const snap = await promo.doc(req.params.code).get();
      if (!snap.exists) return res.status(404).json({ error: 'not_found' });
      const d = snap.data();
      const uids = (Array.isArray(d.redeemers) ? d.redeemers : []).slice(-300);
      const people = [];
      for (let i = 0; i < uids.length; i += 100) {
        const chunk = uids.slice(i, i + 100);
        const [authRes, docs] = await Promise.all([
          admin.auth().getUsers(chunk.map((uid) => ({ uid }))),
          db.getAll(...chunk.map((uid) => db.collection('users').doc(uid))),
        ]);
        const byUid = new Map(authRes.users.map((u) => [u.uid, u]));
        chunk.forEach((uid, j) => {
          const u = byUid.get(uid);
          const ud = docs[j]?.exists ? docs[j].data() : {};
          people.push({
            uid,
            email: u?.email || null,
            name: u?.displayName || null,
            lang: ud.lang || null,
            premium: !!ud.premium,
            premiumCode: ud.premiumCode || null,
            premiumExpiresAt: Number(ud.premiumExpiresAt || 0) || null,
            redeemedAt: Number(ud.premiumUpdatedAt || 0) || null,
          });
        });
      }
      res.json({ code: promoPublic(snap.id, d), people: people.reverse() });
    } catch (e) {
      console.error('Admin promo detail failed:', e);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Nový kód
  app.post('/admin/promo', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const b = req.body || {};
    const code = String(b.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) return res.status(400).json({ error: 'bad_code' });
    try {
      const ref = promo.doc(code);
      const doc = {
        active: b.active !== false,
        plan: clip(b.plan || 'promo', 40),
        note: clip(b.note, 300),
        durationDays: numOrNull(b.durationDays),
        maxUses: numOrNull(b.maxUses),
        expiresAt: numOrNull(b.expiresAt),
        usedCount: 0,
        redeemers: [],
        createdAt: Date.now(),
      };
      await db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) throw new Error('exists');
        tx.set(ref, doc);
      });
      console.log('Promo code created →', code);
      res.json({ ok: true, code: promoPublic(code, doc) });
    } catch (e) {
      if (e.message === 'exists') return res.status(409).json({ error: 'exists' });
      console.error('Admin promo create failed:', e);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Úprava kódu (nemaže se — vypíná se přes active:false, ať zůstane historie)
  app.patch('/admin/promo/:code', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const b = req.body || {};
    const patch = {};
    if ('active' in b) patch.active = !!b.active;
    if ('note' in b) patch.note = clip(b.note, 300);
    if ('plan' in b) patch.plan = clip(b.plan || 'promo', 40);
    for (const k of ['maxUses', 'durationDays', 'expiresAt']) if (k in b) patch[k] = numOrNull(b[k]);
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'empty' });
    try {
      const ref = promo.doc(req.params.code);
      if (!(await ref.get()).exists) return res.status(404).json({ error: 'not_found' });
      await ref.update(patch);
      console.log('Promo code updated →', req.params.code, Object.keys(patch).join(','));
      res.json({ ok: true, code: promoPublic(req.params.code, (await ref.get()).data()) });
    } catch (e) {
      console.error('Admin promo update failed:', e);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Nahlášené chyby u sloves
  app.get('/admin/reports', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const qs = await db.collection('errorReports').orderBy('createdAt', 'desc').limit(300).get();
      res.json({ reports: qs.docs.map((d) => ({ id: d.id, ...d.data() })) });
    } catch (e) {
      console.error('Admin reports failed:', e);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/admin/reports/:id/status', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const status = ['new', 'done', 'ignored'].includes(req.body?.status) ? req.body.status : 'new';
    try {
      await db.collection('errorReports').doc(req.params.id).update({ status, resolvedAt: status === 'new' ? null : Date.now() });
      res.json({ ok: true, status });
    } catch (e) {
      res.status(500).json({ error: 'failed' });
    }
  });


  // Web Push — správa odběrů z admin stránky
  app.get('/admin/push/key', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const v = await getVapid();
      const subs = await pushRef.collection('subs').get();
      res.json({ publicKey: v.publicKey, devices: subs.docs.map((d) => ({ id: d.id, label: d.data().label || '', at: d.data().createdAt })) });
    } catch (e) {
      console.error('Push key failed:', e);
      res.status(500).json({ error: 'failed' });
    }
  });
  app.post('/admin/push/subscribe', async (req, res) => {
    const d = await requireAdmin(req, res);
    if (!d) return;
    const sub = req.body?.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
      return res.status(400).json({ error: 'bad_subscription' });
    }
    try {
      const id = subId(sub.endpoint);
      await pushRef.collection('subs').doc(id).set({
        subscription: { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } },
        label: clip(req.body?.label, 120),
        email: d.email,
        createdAt: Date.now(),
      });
      res.json({ ok: true, id });
    } catch (e) {
      console.error('Push subscribe failed:', e);
      res.status(500).json({ error: 'failed' });
    }
  });
  app.post('/admin/push/unsubscribe', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const endpoint = req.body?.endpoint;
    const id = req.body?.id || (endpoint ? subId(endpoint) : null);
    if (!id) return res.status(400).json({ error: 'missing' });
    try {
      await pushRef.collection('subs').doc(String(id)).delete();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'failed' });
    }
  });
  app.post('/admin/push/test', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const n = await pushAll({ title: '🔔 Funguje to!', body: 'Takhle vám budou chodit nové zprávy z chatu v appce.', url: '/admin/#settings', tag: 'test', badge: await unreadTotal() });
      res.json({ ok: n > 0, delivered: n });
    } catch (e) {
      console.error('Push test failed:', e);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Telegram: propojení — autor napíše svému botovi /start a tady klikne „Propojit".
  app.post('/admin/telegram/link', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    if (!process.env.TELEGRAM_BOT_TOKEN) return res.status(400).json({ error: 'no_token' });
    try {
      const r = await telegram('getUpdates', { limit: 50 });
      if (!r.ok) return res.status(502).json({ error: 'telegram', detail: r.description });
      const msgs = (r.result || []).map((u) => u.message).filter((m) => m && m.chat && m.chat.type === 'private');
      const last = msgs[msgs.length - 1];
      if (!last) return res.status(404).json({ error: 'no_message' });
      await db.collection('adminConfig').doc('telegram').set({ chatId: String(last.chat.id), linkedAt: Date.now() });
      await telegram('sendMessage', { chat_id: last.chat.id, text: '✅ Propojeno. Sem vám budou chodit nové zprávy z chatu v appce.' });
      res.json({ ok: true });
    } catch (e) {
      console.error('Telegram link failed:', e);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/admin/telegram/test', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const id = await telegramChatId();
    if (!id) return res.status(400).json({ error: 'not_linked' });
    const r = await telegram('sendMessage', { chat_id: id, text: '🔔 Testovací upozornění z adminu.' });
    res.json({ ok: !!r.ok, detail: r.description || null });
  });
}
