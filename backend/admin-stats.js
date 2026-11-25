// Admin — zákazníci, přehled tržeb a Search Console (jen čtení).
//   GET /admin/customers  — Stripe předplatná + doživotní nákupy + promo Premium z Firestore
//   GET /admin/overview   — tržby po měsících (CZK/PLN), trialy, konverze, uživatelé
//   GET /admin/gsc        — Google Search Console (servisní účet Firebase musí mít
//                           ve Search Console přístup k webu; API „Google Search
//                           Console API" musí být povolené v GCP projektu)
//   GET/POST /admin/integrations — sdílený odkaz Plausible (embed) v adminConfig/integrations
//
// Do Stripe se jen čte. Data se krátce cachují v paměti.

import { JWT } from 'google-auth-library';

const DAY = 86400000;
const clip = (v, n) => String(v ?? '').slice(0, n);

function cached(ttlMs, fn) {
  let at = 0; let val = null; let pending = null;
  return async (force = false) => {
    if (!force && val && Date.now() - at < ttlMs) return val;
    if (pending) return pending;
    pending = fn().then((v) => { val = v; at = Date.now(); return v; }).finally(() => { pending = null; });
    return pending;
  };
}

export function registerStatsRoutes(app, { db, admin, stripe, requireAdmin, svcAcc }) {
  const isApp = (meta) => (meta || {}).app === 'slovesa';

  // ---------- Stripe: načtení všeho potřebného (malý účet → stačí stránkovat) ----------
  const loadStripe = cached(60 * 1000, async () => {
    const subs = (await stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.customer'] }).autoPagingToArray({ limit: 5000 }))
      .filter((s) => isApp(s.metadata));
    const sessions = (await stripe.checkout.sessions.list({ limit: 100 }).autoPagingToArray({ limit: 5000 }))
      .filter((s) => isApp(s.metadata) && s.status === 'complete');
    const since = Math.floor((Date.now() - 400 * DAY) / 1000);
    const invoices = (await stripe.invoices.list({ status: 'paid', limit: 100, created: { gte: since } }).autoPagingToArray({ limit: 5000 }))
      .filter((inv) => {
        const meta = inv.subscription_details?.metadata || inv.parent?.subscription_details?.metadata || {};
        return isApp(meta) && inv.amount_paid > 0;
      });
    return { subs, sessions, invoices };
  });

  const emailOfCustomer = (c) => (c && typeof c === 'object' ? c.email : null);
  const subPlan = (s) => {
    const it = s.items?.data?.[0]?.price;
    return {
      interval: it?.recurring?.interval || null, // month | year
      amount: it?.unit_amount ?? null,
      currency: (it?.currency || s.currency || '').toUpperCase(),
    };
  };

  // ---------- 👥 Zákazníci ----------
  app.get('/admin/customers', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const { subs, sessions } = await loadStripe(req.query.fresh === '1');
      const rows = [];
      const seenUid = new Set();
      for (const s of subs) {
        const p = subPlan(s);
        const uid = s.metadata?.uid || null;
        if (uid && ['active', 'trialing', 'past_due'].includes(s.status)) seenUid.add(uid);
        rows.push({
          kind: 'subscription',
          id: s.id,
          uid,
          email: emailOfCustomer(s.customer) || null,
          name: (typeof s.customer === 'object' && s.customer?.name) || null,
          lang: s.metadata?.lang || 'cs',
          status: s.status, // trialing | active | past_due | canceled | unpaid | incomplete...
          interval: p.interval,
          amount: p.amount,
          currency: p.currency,
          created: s.created * 1000,
          trialEnd: s.trial_end ? s.trial_end * 1000 : null,
          periodEnd: (s.current_period_end || s.items?.data?.[0]?.current_period_end || 0) * 1000 || null,
          cancelAtPeriodEnd: !!s.cancel_at_period_end,
          canceledAt: s.canceled_at ? s.canceled_at * 1000 : null,
          stripeUrl: `https://dashboard.stripe.com/subscriptions/${s.id}`,
        });
      }
      for (const cs of sessions.filter((x) => x.mode === 'payment' && x.payment_status === 'paid')) {
        const uid = cs.metadata?.uid || null;
        if (uid) seenUid.add(uid);
        rows.push({
          kind: 'lifetime',
          id: cs.id,
          uid,
          email: cs.customer_details?.email || cs.customer_email || null,
          name: cs.customer_details?.name || null,
          lang: cs.metadata?.lang || 'cs',
          status: 'paid',
          amount: cs.amount_total,
          currency: (cs.currency || '').toUpperCase(),
          created: cs.created * 1000,
          stripeUrl: cs.payment_intent ? `https://dashboard.stripe.com/payments/${cs.payment_intent}` : null,
        });
      }
      // Premium přes promo kód (bez Stripe)
      const promoSnap = await db.collection('users').where('premium', '==', true).get();
      const promoUsers = promoSnap.docs.filter((d) => {
        const u = d.data();
        return !seenUid.has(d.id) && u.premiumPlan !== 'subscription' && u.premiumPlan !== 'lifetime';
      });
      if (promoUsers.length) {
        const authMap = new Map();
        for (let i = 0; i < promoUsers.length; i += 100) {
          const r = await admin.auth().getUsers(promoUsers.slice(i, i + 100).map((d) => ({ uid: d.id })));
          r.users.forEach((u) => authMap.set(u.uid, u));
        }
        for (const d of promoUsers) {
          const u = d.data();
          const a = authMap.get(d.id);
          const exp = Number(u.premiumExpiresAt) || null;
          rows.push({
            kind: 'promo',
            id: d.id,
            uid: d.id,
            email: a?.email || null,
            name: a?.displayName || null,
            lang: u.lang || 'cs',
            status: exp && exp < Date.now() ? 'expired' : 'active',
            code: u.premiumCode || null,
            created: Number(u.premiumUpdatedAt) || null,
            periodEnd: exp,
          });
        }
      }
      rows.sort((a, b) => (b.created || 0) - (a.created || 0));
      res.json({ rows, generatedAt: Date.now() });
    } catch (e) {
      console.error('Admin customers failed:', e);
      res.status(500).json({ error: 'failed', detail: e.message });
    }
  });

  // ---------- 📊 Přehled ----------
  const loadUsers = cached(10 * 60 * 1000, async () => {
    const created = [];
    let token;
    do {
      const r = await admin.auth().listUsers(1000, token);
      r.users.forEach((u) => created.push(Date.parse(u.metadata.creationTime) || 0));
      token = r.pageToken;
    } while (token && created.length < 50000);
    let pl = 0;
    try { pl = (await db.collection('users').where('lang', '==', 'pl').count().get()).data().count; } catch { /* nevadí */ }
    return { created, pl };
  });

  app.get('/admin/overview', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const fresh = req.query.fresh === '1';
      const [{ subs, sessions, invoices }, users] = await Promise.all([loadStripe(fresh), loadUsers(fresh)]);
      const now = Date.now();
      // Platby: doživotní (checkout, mode payment) + zaplacené faktury předplatných
      const payments = [
        ...sessions.filter((s) => s.mode === 'payment' && s.payment_status === 'paid' && s.amount_total > 0)
          .map((s) => ({ at: s.created * 1000, amount: s.amount_total, currency: (s.currency || '').toUpperCase(), kind: 'lifetime' })),
        ...invoices.map((inv) => ({ at: inv.created * 1000, amount: inv.amount_paid, currency: (inv.currency || '').toUpperCase(), kind: 'subscription' })),
      ];
      // Po měsících — posledních 12
      const months = [];
      const d0 = new Date(); d0.setDate(1); d0.setHours(0, 0, 0, 0);
      for (let i = 11; i >= 0; i--) {
        const d = new Date(d0); d.setMonth(d.getMonth() - i);
        const next = new Date(d); next.setMonth(next.getMonth() + 1);
        const inM = payments.filter((p) => p.at >= d.getTime() && p.at < next.getTime());
        const sum = (cur) => inM.filter((p) => p.currency === cur).reduce((a, p) => a + p.amount, 0) / 100;
        months.push({
          key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          CZK: sum('CZK'), PLN: sum('PLN'), count: inM.length,
          signups: users.created.filter((t) => t >= d.getTime() && t < next.getTime()).length,
        });
      }
      const last = (days) => payments.filter((p) => p.at >= now - days * DAY);
      const sumCur = (list, cur) => list.filter((p) => p.currency === cur).reduce((a, p) => a + p.amount, 0) / 100;
      const p30 = last(30);
      const trialsStarted30 = subs.filter((s) => s.trial_start && s.trial_start * 1000 >= now - 30 * DAY);
      // Konverze: trialy, které už skončily (posledních 90 dní) → kolik se zaplatilo
      const trialsEnded = subs.filter((s) => s.trial_end && s.trial_end * 1000 < now && s.trial_end * 1000 >= now - 90 * DAY);
      const converted = trialsEnded.filter((s) => invoices.some((inv) => (inv.subscription === s.id || inv.parent?.subscription_details?.subscription === s.id) && inv.amount_paid > 0));
      const status = (st) => subs.filter((s) => s.status === st).length;
      let premiumPromo = 0;
      try {
        const snap = await db.collection('users').where('premium', '==', true).get();
        premiumPromo = snap.docs.filter((d) => !['subscription', 'lifetime'].includes(d.data().premiumPlan)).length;
      } catch { /* nevadí */ }
      res.json({
        generatedAt: now,
        revenue30: { CZK: sumCur(p30, 'CZK'), PLN: sumCur(p30, 'PLN'), count: p30.length },
        revenueTotal12: { CZK: months.reduce((a, m) => a + m.CZK, 0), PLN: months.reduce((a, m) => a + m.PLN, 0) },
        months,
        subs: {
          trialing: status('trialing'), active: status('active'), past_due: status('past_due'),
          canceledLast30: subs.filter((s) => s.canceled_at && s.canceled_at * 1000 >= now - 30 * DAY).length,
          cancelAtPeriodEnd: subs.filter((s) => ['active', 'trialing'].includes(s.status) && s.cancel_at_period_end).length,
        },
        lifetime: sessions.filter((s) => s.mode === 'payment' && s.payment_status === 'paid').length,
        premiumPromo,
        trials30: trialsStarted30.length,
        conversion90: { ended: trialsEnded.length, converted: converted.length },
        users: {
          total: users.created.length,
          pl: users.pl,
          new7: users.created.filter((t) => t >= now - 7 * DAY).length,
          new30: users.created.filter((t) => t >= now - 30 * DAY).length,
        },
      });
    } catch (e) {
      console.error('Admin overview failed:', e);
      res.status(500).json({ error: 'failed', detail: e.message });
    }
  });

  // ---------- 🔎 Google Search Console ----------
  let gscClient = null;
  const gsc = () => {
    if (!gscClient) {
      gscClient = new JWT({
        email: svcAcc.client_email,
        key: svcAcc.private_key,
        scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
      });
    }
    return gscClient;
  };
  async function gscReq(path, body) {
    const r = await gsc().request({
      url: `https://searchconsole.googleapis.com/webmasters/v3/${path}`,
      method: body ? 'POST' : 'GET',
      data: body,
    });
    return r.data;
  }
  const gscCache = new Map();
  app.get('/admin/gsc', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const days = [7, 28, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 28;
    const key = String(days);
    const hit = gscCache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60 * 1000 && req.query.fresh !== '1') return res.json(hit.data);
    try {
      const list = await gscReq('sites');
      const sites = (list.siteEntry || []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser').map((s) => s.siteUrl);
      if (!sites.length) {
        return res.json({ configured: false, serviceAccount: svcAcc.client_email, reason: 'no_sites' });
      }
      // GSC má data se zpožděním ~2–3 dny
      const end = new Date(Date.now() - 2 * DAY);
      const start = new Date(end.getTime() - (days - 1) * DAY);
      const fmt = (d) => d.toISOString().slice(0, 10);
      const out = [];
      for (const siteUrl of sites) {
        const base = { startDate: fmt(start), endDate: fmt(end) };
        const enc = encodeURIComponent(siteUrl);
        const [byDate, queries, pages] = await Promise.all([
          gscReq(`sites/${enc}/searchAnalytics/query`, { ...base, dimensions: ['date'], rowLimit: 500 }),
          gscReq(`sites/${enc}/searchAnalytics/query`, { ...base, dimensions: ['query'], rowLimit: 15 }),
          gscReq(`sites/${enc}/searchAnalytics/query`, { ...base, dimensions: ['page'], rowLimit: 10 }),
        ]);
        const rows = byDate.rows || [];
        const clicks = rows.reduce((a, r) => a + r.clicks, 0);
        const impressions = rows.reduce((a, r) => a + r.impressions, 0);
        const posW = rows.reduce((a, r) => a + r.position * r.impressions, 0);
        out.push({
          siteUrl,
          totals: { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: impressions ? posW / impressions : null },
          daily: rows.map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
          queries: (queries.rows || []).map((r) => ({ q: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position })),
          pages: (pages.rows || []).map((r) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
        });
      }
      const data = { configured: true, days, range: { start: fmt(start), end: fmt(end) }, sites: out, serviceAccount: svcAcc.client_email };
      gscCache.set(key, { at: Date.now(), data });
      res.json(data);
    } catch (e) {
      const msg = e?.response?.data?.error?.message || e.message || String(e);
      const disabled = /has not been used|is disabled|SERVICE_DISABLED/i.test(msg);
      console.error('GSC failed:', msg);
      res.json({ configured: false, serviceAccount: svcAcc.client_email, projectId: svcAcc.project_id, reason: disabled ? 'api_disabled' : 'error', detail: clip(msg, 300) });
    }
  });

  // ---------- 📈 Plausible (sdílený odkaz pro embed) ----------
  const integ = db.collection('adminConfig').doc('integrations');
  app.get('/admin/integrations', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const s = await integ.get();
    res.json(s.exists ? s.data() : {});
  });
  app.post('/admin/integrations', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const link = String(req.body?.plausibleSharedLink || '').trim();
    if (link && !/^https:\/\/plausible\.io\/share\/[^\s"'<>]+$/.test(link)) return res.status(400).json({ error: 'bad_link' });
    await integ.set({ plausibleSharedLink: link || null, updatedAt: Date.now() }, { merge: true });
    res.json({ ok: true });
  });
}
