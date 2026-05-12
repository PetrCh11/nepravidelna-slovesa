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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Firebase Admin
const svcAcc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
admin.initializeApp({ credential: admin.credential.cert(svcAcc) });
const db = admin.firestore();

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
      await db.collection('users').doc(uid).set({
        premium: true,
        premiumPlan: o.mode === 'subscription' ? 'monthly' : 'lifetime',
        premiumUpdatedAt: Date.now(),
      }, { merge: true });
      console.log('Premium granted →', uid);
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
  const { priceId, uid, mode, returnUrl, email } = req.body || {};
  if (!priceId || !uid || !mode || !returnUrl) {
    return res.status(400).json({ error: 'missing params (priceId, uid, mode, returnUrl)' });
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
      } : {}),
      ...(email ? { customer_email: email } : {}),
      allow_promotion_codes: true,
      locale: 'cs',
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
  const { uid, code } = req.body || {};
  if (!uid || !code) return res.status(400).json({ error: 'missing uid or code' });
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
      tx.set(db.collection('users').doc(uid), {
        premium: true,
        premiumPlan: data.plan || 'promo',
        premiumCode: normalized,
        premiumUpdatedAt: Date.now(),
      }, { merge: true });
      return { plan: data.plan || 'promo', note: data.note || null };
    });
    console.log('Promo redeemed →', normalized, 'uid', uid);
    res.json({ ok: true, ...result });
  } catch (e) {
    const msg = e?.message || 'error';
    const codeStatus = ['not_found', 'inactive', 'expired', 'exhausted', 'already_redeemed'].includes(msg) ? 400 : 500;
    if (codeStatus === 500) console.error('Redeem error:', e);
    res.status(codeStatus).json({ error: msg });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Slovesa backend listening on :${port}`));
