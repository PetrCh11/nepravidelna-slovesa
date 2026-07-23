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
import { sendEmail, welcomeEmail } from './email.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Firebase Admin
const svcAcc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
admin.initializeApp({ credential: admin.credential.cert(svcAcc) });
const db = admin.firestore();

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
            const tpl = welcomeEmail({ plan, isPromo: false });
            await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text });
            console.log('Welcome email sent →', email, plan);
          }
        } catch (e) {
          console.error('Welcome email failed:', e?.message || e);
        }
      }
    } else if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') {
      // Subscription cancelled or payment failed → revoke
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
  try {
    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${returnUrl}?premium=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${returnUrl}?premium=cancel`,
      metadata: { uid, app: 'slovesa' },
      ...(mode === 'subscription' ? {
        subscription_data: {
          metadata: { uid, app: 'slovesa' },
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
      allow_promotion_codes: true,
      // Checkout UI language: language mutations send their own (e.g. 'pl').
      locale: ['cs', 'pl'].includes(locale) ? locale : 'cs',
    });
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
  const { code } = req.body || {};
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
        const tpl = welcomeEmail({ plan: 'promo', isPromo: true });
        await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text });
        console.log('Promo welcome email sent →', email);
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

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Slovesa backend listening on :${port}`));
