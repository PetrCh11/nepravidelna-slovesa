# Slovesa backend (Stripe + Firebase)

Tiny Node/Express server that:
- Creates Stripe Checkout sessions for the frontend.
- Receives Stripe webhooks and updates `users/{uid}.premium` in Firestore via Firebase Admin SDK.

## Endpoints

- `POST /create-checkout-session` — body `{ priceId, uid, mode, returnUrl, email? }` → `{ url }`
- `POST /webhook` — Stripe webhook (raw body, signature-verified)
- `GET /health` — liveness probe

## Required environment variables

| Var | Where to find it |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys → Secret key (`sk_test_…` for test) |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Developers → Webhooks → click endpoint → Signing secret (`whsec_…`) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase console → ⚙️ → Project settings → Service accounts → Generate new private key. Paste **entire JSON** as a single string. |
| `ALLOWED_ORIGINS` | comma-separated, e.g. `https://petrch11.github.io,http://localhost:8765` |
| `PORT` | Auto-set by Railway. Locally defaults to `3000`. |

## Deploy on Railway

1. In [railway.app](https://railway.app/) → **New Project** → **Deploy from GitHub repo** → pick `nepravidelna-slovesa`.
2. After import, click the service → **Settings** → **Root Directory** = `backend`.
3. **Build Command:** leave empty (Railway auto-runs `npm install`).
4. **Start Command:** `npm start` (auto-detected).
5. **Variables** tab → add all 4 env vars above.
6. **Settings** → **Networking** → **Generate Domain** (you'll get e.g. `slovesa-backend-production-xxxx.up.railway.app`). Send this URL to me; I'll wire the frontend.
7. Set the Stripe webhook URL: Stripe Dashboard → Developers → Webhooks → **+ Add endpoint** → URL = `https://<your-railway-domain>/webhook`. Select events:
   - `checkout.session.completed`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
   Save → copy the **Signing secret** (`whsec_…`) into Railway as `STRIPE_WEBHOOK_SECRET`.

## Local dev

```bash
cd backend
npm install
export STRIPE_SECRET_KEY=sk_test_...
export STRIPE_WEBHOOK_SECRET=whsec_...
export FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
export ALLOWED_ORIGINS=http://localhost:8765
npm start
```

Test the webhook locally with the Stripe CLI:
```bash
stripe listen --forward-to http://localhost:3000/webhook
```
