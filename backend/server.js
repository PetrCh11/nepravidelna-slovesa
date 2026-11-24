// Tiny backend for Stripe Checkout + Firebase premium flag updates.
// Endpoints:
//   POST /create-checkout-session   → returns Stripe Checkout URL
//   POST /webhook                   → Stripe events; sets users/{uid}.premium in Firestore
//   GET  /health                    → liveness probe
//
// Env vars (set in Railway):
//   STRIPE_SECRET_KEY               sk_test_... (or sk_live_...)
//   STRIPE_WEBHOOK_SECRET           whsec_...
//   FIREBASE_SERVICE_ACCOUNT_JSON   { "type": "service_account", ... } as a single JSON string
//   ALLOWED_ORIGINS                 https://petrch11.github.io,http://localhost:8765 (comma-separated)

import express from 'express';
import Stripe from 'stripe';
import admin from 'firebase-admin';
import cors from 'cors';
import { sendEmail, welcomeEmail, normalizeLang } from './email.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Firebase Admin
const svcAcc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
admin.initializeApp({ credential: admin.credential.cert(svcAcc) });
const db = admin.firestore();

// Aktivní (i zkušební) předplatná appky pro daný uid — napříč všemi Stripe
// zákazníky, protože každá platba zakládala nového. Search API může mít pár
// desítek sekund zpoždění indexu, což tu nevadí.
const LIVE_SUB_STATUSES = new Set(['active', 'trialing', 'past_due']);
async function liveSubscriptionsFor(uid) {
  const found = [];
  let page = null;
  do {
    const res = await stripe.subscriptions.search({
      query: `metadata['uid']:'${String(uid).replace(/'/g, '')}'`,
      limit: 100,
      ...(page ? { page } : {}),
    });
    res.data.forEach((sub) => {
      if (sub.metadata?.app === 'slovesa' && LIVE_SUB_STATUSES.has(sub.status)) found.push(sub);
    });
    page = res.has_more ? res.next_page : null;
  } while (page);
  return found;
}

// Verify the caller's Firebase ID token (Authorization: Bearer <token>) and
// return their uid, or null if missing/invalid. The uid MUST come from a
// verified token — never from the request body — so a caller can only ever
// act on their own account (no acting as another user by guessing their uid).
async function verifyUid(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(m[1]);
    return decoded.uid || null;
  } catch (e) {
    console.warn('ID token verification failed:', e.message);
    return null;
  }
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

const app = express();
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
}));

// Webhook needs raw body for signature verification — must be registered BEFORE express.json()
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Webhook signature verification failed:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    const o = event.data.object;
    const meta = o.metadata || {};
    if (meta.app !== 'slovesa') {
      // Ignore events from other products on the same Stripe account
      return res.json({ ignored: true });
    }
    const uid = meta.uid;
    if (!uid) return res.json({ ignored: true, reason: 'no uid' });

    if (event.type === 'checkout.session.completed' || event.type === 'invoice.paid') {
      // Capture Stripe customer ID so we can open the Customer Portal later
      const stripeCustomerId = o.customer || null;
      await db.collection('users').doc(uid).set({
        premium: true,
        premiumPlan: o.mode === 'subscription' ? 'subscription' : 'lifetime',
        premiumUpdatedAt: Date.now(),
        ...(stripeCustomerId ? { stripeCustomerId } : {}),
      }, { merge: true });
      console.log('Premium granted →', uid, stripeCustomerId ? `(customer ${stripeCustomerId})` : '');

      // Welcome email — only on the initial checkout, not on every recurring invoice.paid
      if (event.type === 'checkout.session.completed') {
        try {
          const email = o.customer_details?.email || o.customer_email || null;
          if (email) {
            // Infer plan name from line items if available, fall back to mode
            let plan = o.mode === 'subscription' ? 'monthly' : 'lifetime';
            try {
              const line = o.line_items?.data?.[0]
                || (await stripe.checkout.sessions.listLineItems(o.id, { limit: 1 })).data[0];
              const interval = line?.price?.recurring?.interval;
              if (interval === 'year') plan = 'yearly';
              else if (interval === 'month') plan = 'monthly';
            } catch {}
            const tpl = welcomeEmail({ plan, isPromo: false, lang: meta.lang });
            const r = await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text, senderName: tpl.senderName });
            if (r.ok) console.log('Welcome email sent →', email, plan, meta.lang || 'cs');
            else console.error('Welcome email FAILED →', email, plan, r.reason, r.error || '');
          }
        } catch (e) {
          console.error('Welcome email failed:', e?.message || e);
        }
      }
    } else if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') {
      // Subscription cancelled or payment failed → revoke — ale jen když účet
      // nemá jiné živé předplatné ani doživotní nákup. Jinak by konec jednoho
      // (např. omylem koupeného druhého) předplatného vypnul Premium celému účtu.
      const endedSubId = event.type === 'customer.subscription.deleted' ? o.id : null;
      try {
        const userSnap = await db.collection('users').doc(uid).get();
        if (userSnap.exists && userSnap.data().premiumPlan === 'lifetime') {
          console.log('Premium kept (lifetime) →', uid);
          return res.json({ received: true, kept: 'lifetime' });
        }
        const others = (await liveSubscriptionsFor(uid)).filter((sub) => sub.id !== endedSubId);
        if (others.length) {
          console.log('Premium kept (other live subscription) →', uid, others.map((x) => x.id).join(','));
          return res.json({ received: true, kept: 'other_subscription' });
        }
      } catch (e) {
        // Kontrola selhala → chovej se jako dřív (odebrat), ale zaloguj to.
        console.error('Live-subscription check failed, revoking anyway:', e?.message || e);
      }
      await db.collection('users').doc(uid).set({
        premium: false,
        premiumUpdatedAt: Date.now(),
      }, { merge: true });
      console.log('Premium revoked →', uid);
    }
    res.json({ received: true });
  } catch (e) {
    console.error('Webhook handler error:', e);
    res.status(500).send('Internal error');
  }
});

// JSON parser for the rest
app.use(express.json());

// Vánoční sleva −30 % na roční a doživotní Premium (CZK i PLN), v roce 2026 od 16. 11. (jinak od 1. adventní
// neděle) do konce Štědrého dne (časy v UTC = půlnoc v Praze). Kupony jsou ve
// Stripe (Product catalog → Coupons) a samy expirují 24. 12. 23:59:
//   VANOCE30-NAVZDY — jednorázově, na doživotní nákup
//   VANOCE30-ROK    — 1 měsíc od začátku předplatného, takže zlevní jen první
//                     roční platbu po 7denním trialu, obnova už je za plnou cenu
// Frontend ukazuje stejné období (app.js, isXmasSale) — při změně dat upravit obojí.
const XMAS_SALE = {
  start: Date.parse('2026-11-15T23:00:00Z'), // 16. 11. 00:00 Praha
  end: Date.parse('2026-12-24T23:00:00Z'),
  coupons: {
    price_1TYOTrK1GA1fPMpODCB8e5uA: 'VANOCE30-NAVZDY', // CZ doživotní 449 Kč
    price_1TsQVcK1GA1fPMpO4R1U3f9r: 'VANOCE30-NAVZDY', // PL doživotní 89,99 zł
    price_1TYOVlK1GA1fPMpOONV6P92W: 'VANOCE30-ROK',    // CZ roční 249 Kč
    price_1TsQULK1GA1fPMpO9h6Jglu4: 'VANOCE30-ROK',    // PL roční 49,99 zł
  },
};
function xmasCouponFor(priceId, now = Date.now()) {
  if (now < XMAS_SALE.start || now >= XMAS_SALE.end) return null;
  return XMAS_SALE.coupons[priceId] || null;
}

app.post('/create-checkout-session', async (req, res) => {
  const uid = await verifyUid(req);
  if (!uid) return res.status(401).json({ error: 'unauthenticated' });
  const { priceId, mode, returnUrl, email, locale } = req.body || {};
  if (!priceId || !mode || !returnUrl) {
    return res.status(400).json({ error: 'missing params (priceId, mode, returnUrl)' });
  }
  if (!['payment', 'subscription'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be payment or subscription' });
  }
  // Jazyková mutace (cs/pl) — řídí jazyk Stripe Checkoutu i uvítacího mailu.
  const lang = normalizeLang(locale);
  // Pojistka proti dvojí platbě: účet s doživotním nákupem nebo se živým
  // (i zkušebním) předplatným si znovu nekoupí. Když kontrola selže, platbu
  // nebrzdíme — prodej je důležitější než pojistka.
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    const u = userSnap.exists ? userSnap.data() : {};
    const lifetime = u.premium === true && u.premiumPlan === 'lifetime';
    const live = lifetime ? [] : await liveSubscriptionsFor(uid);
    if (lifetime || live.length) {
      console.log('Checkout blocked (already premium) →', uid, lifetime ? 'lifetime' : live.map((x) => x.id).join(','));
      return res.status(409).json({ error: 'already_premium' });
    }
  } catch (e) {
    console.error('Already-premium check failed, allowing checkout:', e?.message || e);
  }
  // Stripe nedovolí kupon a pole pro slevový kód zároveň — v době vánoční slevy
  // se kupon přidá sám a pole pro kód zmizí.
  const xmasCoupon = xmasCouponFor(priceId);
  try {
    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${returnUrl}?premium=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${returnUrl}?premium=cancel`,
      metadata: { uid, app: 'slovesa', lang },
      ...(mode === 'subscription' ? {
        subscription_data: {
          metadata: { uid, app: 'slovesa', lang },
          // 7-day free trial on subscriptions (monthly + yearly).
          // Card is collected upfront; Stripe auto-charges at trial end unless cancelled.
          trial_period_days: 7,
          trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
        },
      } : {
        // For one-time (lifetime) payments, force creation of a permanent Stripe
        // customer so the buyer can later use Customer Portal (invoice download,
        // payment method update). Without this, Stripe issues a 'guest customer'
        // which portal refuses.
        customer_creation: 'always',
        invoice_creation: { enabled: true },
      }),
      ...(email ? { customer_email: email } : {}),
      ...(xmasCoupon ? { discounts: [{ coupon: xmasCoupon }] } : { allow_promotion_codes: true }),
      // Checkout UI language: language mutations send their own (e.g. 'pl').
      locale: lang,
    });
    if (xmasCoupon) console.log('Checkout with Xmas coupon →', uid, xmasCoupon);
    res.json({ url: session.url });
  } catch (e) {
    console.error('Checkout create failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// Redeem a free-access promo code (e.g. teacher codes for their class).
// Stripe-based percentage discounts work natively via the checkout's
// allow_promotion_codes flag — this endpoint is only for granting full
// premium without a payment.
app.post('/redeem-code', async (req, res) => {
  const uid = await verifyUid(req);
  if (!uid) return res.status(401).json({ error: 'unauthenticated' });
  const { code, lang: bodyLang } = req.body || {};
  if (!code) return res.status(400).json({ error: 'missing code' });
  const normalized = String(code).trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,40}$/.test(normalized)) {
    return res.status(400).json({ error: 'invalid_code_format' });
  }
  const ref = db.collection('promoCodes').doc(normalized);
  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('not_found');
      const data = snap.data() || {};
      if (data.active === false) throw new Error('inactive');
      if (data.expiresAt && Date.now() > Number(data.expiresAt)) throw new Error('expired');
      const used = Number(data.usedCount || 0);
      if (data.maxUses && used >= Number(data.maxUses)) throw new Error('exhausted');
      // Prevent same uid redeeming twice
      const redeemers = Array.isArray(data.redeemers) ? data.redeemers : [];
      if (redeemers.includes(uid)) throw new Error('already_redeemed');
      tx.update(ref, {
        usedCount: used + 1,
        redeemers: [...redeemers, uid],
        lastRedeemedAt: Date.now(),
      });
      // Time-limited promos: write premiumExpiresAt so the gate auto-expires.
      // durationDays on the code = how long each redeemer gets premium
      // (e.g. 365 from the moment of redemption). The `expiresAt` field
      // above is a separate concept — the deadline for NEW redemptions —
      // and is already enforced. Stripe-paid users have no durationDays
      // and thus no premiumExpiresAt → treated as lifetime by the client.
      const durationDays = Number(data.durationDays) || 0;
      const premiumExpiresAt = durationDays > 0
        ? Date.now() + durationDays * 86400000
        : null;
      tx.set(db.collection('users').doc(uid), {
        premium: true,
        premiumPlan: data.plan || 'promo',
        premiumCode: normalized,
        premiumUpdatedAt: Date.now(),
        premiumExpiresAt: premiumExpiresAt, // null = lifetime
      }, { merge: true });
      return { plan: data.plan || 'promo', note: data.note || null, premiumExpiresAt };
    });
    console.log('Promo redeemed →', normalized, 'uid', uid);

    // Optional welcome email for promo redemptions (no Stripe → no auto receipt)
    try {
      const userRec = await admin.auth().getUser(uid).catch(() => null);
      const email = userRec?.email || null;
      if (email) {
        // Jazyk posílá frontend; starší klient ho neposílá → vezmeme ho z profilu.
        let lang = bodyLang;
        if (!lang) {
          const profile = await db.collection('users').doc(uid).get().catch(() => null);
          lang = profile?.exists ? profile.data().lang : undefined;
        }
        const tpl = welcomeEmail({ plan: 'promo', isPromo: true, lang });
        const r = await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text, senderName: tpl.senderName });
        if (r.ok) console.log('Promo welcome email sent →', email, lang || 'cs');
        else console.error('Promo welcome email FAILED →', email, r.reason, r.error || '');
      }
    } catch (e) {
      console.error('Promo welcome email failed:', e?.message || e);
    }

    res.json({ ok: true, ...result });
  } catch (e) {
    const msg = e?.message || 'error';
    const codeStatus = ['not_found', 'inactive', 'expired', 'exhausted', 'already_redeemed'].includes(msg) ? 400 : 500;
    if (codeStatus === 500) console.error('Redeem error:', e);
    res.status(codeStatus).json({ error: msg });
  }
});

// Stripe Customer Portal — lets users cancel, update card, download invoices
app.post('/create-portal-session', async (req, res) => {
  const uid = await verifyUid(req);
  if (!uid) return res.status(401).json({ error: 'unauthenticated' });
  const { returnUrl } = req.body || {};
  if (!returnUrl) return res.status(400).json({ error: 'missing returnUrl' });
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    const data = userSnap.exists ? userSnap.data() : {};
    const customerId = data.stripeCustomerId;
    if (!customerId) {
      // User has no Stripe customer yet (e.g. promo-redeemed premium or never paid)
      return res.status(404).json({ error: 'no_customer' });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    res.json({ url: session.url });
  } catch (e) {
    // Stored customer no longer exists in this Stripe account (deleted, or a
    // leftover test-mode id under live keys). Degrade to the friendly
    // "nothing to manage" path instead of surfacing a raw Stripe error.
    if (e?.code === 'resource_missing' || e?.statusCode === 404) {
      return res.status(404).json({ error: 'no_customer' });
    }
    console.error('Portal create failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// welcomeLangs: jazyky uvítacího mailu — zvenku je z toho poznat, která verze běží.
// dupGuard: pojistka proti dvojí platbě + bezpečné rušení předplatného (2026-10).
// ---------- Nahlášení chyby u slovesa (z appky, i bez přihlášení) ----------
// Uloží do Firestore `errorReports` (status 'new') a pošle e-mail autorovi
// na REPORT_EMAIL_TO. Ochrana: honeypot `website`, limit délky, max 5 hlášení
// na IP za 10 minut (v paměti — po restartu se vynuluje, což nevadí).
const REPORT_CATS = new Set(['form', 'rejected', 'translation', 'audio', 'other']);
const reportHits = new Map(); // ip -> [timestamps]
function reportRateOk(ip) {
  const now = Date.now();
  const recent = (reportHits.get(ip) || []).filter((ts) => now - ts < 10 * 60 * 1000);
  if (recent.length >= 5) { reportHits.set(ip, recent); return false; }
  recent.push(now);
  reportHits.set(ip, recent);
  if (reportHits.size > 5000) reportHits.clear();
  return true;
}
const clip = (v, n) => String(v ?? '').slice(0, n);
const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

app.post('/report-error', async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot → tiše zahodit
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  if (!reportRateOk(ip)) return res.status(429).json({ error: 'too_many' });
  const verb = b.verb || {};
  if (!verb.inf || typeof verb.inf !== 'string') return res.status(400).json({ error: 'missing_verb' });
  const category = REPORT_CATS.has(b.category) ? b.category : 'other';
  const email = /^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{2,20}$/.test(String(b.email || '').trim()) ? String(b.email).trim() : '';
  let answers = null;
  if (b.answers && typeof b.answers === 'object') {
    answers = {};
    for (const k of ['inf', 'past', 'pp']) if (k in b.answers) answers[k] = clip(b.answers[k], 80);
  }
  const uid = await verifyUid(req);
  const doc = {
    verb: { inf: clip(verb.inf, 60), past: clip(verb.past, 80), pp: clip(verb.pp, 80), cs: clip(verb.cs, 200) },
    category,
    message: clip(b.message, 1000),
    email,
    answers,
    where: clip(b.where, 40),
    dialect: clip(b.dialect, 10),
    lang: clip(b.lang, 5) || 'cs',
    page: clip(b.page, 300),
    uid: uid || null,
    userAgent: clip(req.headers['user-agent'], 300),
    status: 'new',
    createdAt: Date.now(),
  };
  try {
    const ref = await db.collection('errorReports').add(doc);
    console.log('Error report saved →', ref.id, doc.verb.inf, category);
    const to = process.env.REPORT_EMAIL_TO;
    if (to) {
      const catLabel = { form: 'Špatný tvar', rejected: 'Odpověď neuznána', translation: 'Překlad', audio: 'Výslovnost', other: 'Jiné' }[category];
      const ans = answers ? Object.entries(answers).map(([k, v]) => `${k}: <b>${escHtml(v) || '—'}</b>`).join(' · ') : '—';
      const html = `
        <h2 style="margin:0 0 8px">⚑ ${escHtml(doc.verb.inf)} – ${escHtml(doc.verb.past)} – ${escHtml(doc.verb.pp)}</h2>
        <p style="margin:0 0 12px;color:#555">${escHtml(doc.verb.cs)} · jazyk <b>${escHtml(doc.lang)}</b> · ${escHtml(doc.where)} · ${escHtml(doc.dialect)}</p>
        <p><b>Kategorie:</b> ${catLabel}</p>
        <p><b>Zpráva:</b><br>${escHtml(doc.message).replace(/\n/g, '<br>') || '<i>(bez textu)</i>'}</p>
        <p><b>Co žák napsal:</b> ${ans}</p>
        <p><b>E-mail pro odpověď:</b> ${email ? `<a href="mailto:${escHtml(email)}">${escHtml(email)}</a>` : '<i>neuveden</i>'}</p>
        <p style="color:#888;font-size:12px">ID ${ref.id} · uid ${escHtml(uid || '—')} · ${escHtml(doc.page)}</p>`;
      sendEmail({
        to,
        subject: `⚑ Nahlášená chyba: ${doc.verb.inf} (${catLabel}, ${doc.lang})`,
        html,
        text: `${doc.verb.inf} – ${doc.verb.past} – ${doc.verb.pp}\nKategorie: ${catLabel}\nZpráva: ${doc.message}\nOdpovědi: ${JSON.stringify(answers)}\nE-mail: ${email || '-'}\nID: ${ref.id}`,
      }).then((r) => {
        if (!r.ok) console.error('Report email FAILED →', ref.id, r.reason, r.error || '');
      }).catch((e) => console.error('Report email failed:', e?.message || e));
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Report save failed:', e);
    res.status(500).json({ error: 'save_failed' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now(), welcomeLangs: ['cs', 'pl'], errorReports: true, dupGuard: true, xmasSale: { start: XMAS_SALE.start, end: XMAS_SALE.end, active: !!xmasCouponFor(Object.keys(XMAS_SALE.coupons)[0]) } }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Slovesa backend listening on :${port}`));
