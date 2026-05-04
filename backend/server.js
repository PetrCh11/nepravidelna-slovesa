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
      ...(mode === 'subscription' ? { subscription_data: { metadata: { uid, app: 'slovesa' } } } : {}),
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

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Slovesa backend listening on :${port}`));
