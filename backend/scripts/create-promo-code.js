#!/usr/bin/env node
// Create or update a shared multi-use promo code in Firestore.
//
// Usage (from repo root):
//   FIREBASE_SERVICE_ACCOUNT_JSON="$(cat path/to/svc.json)" \
//     node backend/scripts/create-promo-code.js
//
// Tweak the CONFIG below for different campaigns. Re-running this for the same
// code is a no-op for the existing redeemers list (we use set+merge, but never
// touch usedCount/redeemers/lastRedeemedAt — those are managed by the redeem
// transaction in server.js).

const admin = require('firebase-admin');

const CONFIG = {
  // What teachers will type into the paywall.
  // POZOR: musí sedět s kódem na /pro-skoly/ a v docs/email-skoly.md.
  code: 'UCITELE8892',
  // How many distinct teachers can redeem it (each uid only once).
  // 100 pro kampaň na školy 2026/27. Musí sedět s hodnotou ve Firestore —
  // když dojde, učitel uvidí „Kód byl vyčerpán", tak hlídej usedCount.
  maxUses: 100,
  // 365-day premium per redeemer. Backend reads this in /redeem-code.
  durationDays: 365,
  // Stop accepting NEW redemptions after this date. Already-redeemed teachers
  // keep their full 365 days regardless of this date.
  // 31. 8. 2027 23:59:59 CEST in ms:
  expiresAt: Date.UTC(2027, 7, 31, 21, 59, 59), // Aug = month 7 (0-indexed)
  active: true,
  plan: 'annual_teacher',
  note: 'ucseslovesa.cz/pro-skoly — kampaň na školy 2026/27',
};

(async () => {
  const svcAcc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
  if (!svcAcc.client_email) {
    console.error('Missing FIREBASE_SERVICE_ACCOUNT_JSON env var.');
    process.exit(1);
  }
  admin.initializeApp({ credential: admin.credential.cert(svcAcc) });
  const db = admin.firestore();
  const id = String(CONFIG.code).trim().toUpperCase();
  const ref = db.collection('promoCodes').doc(id);
  const snap = await ref.get();

  const base = {
    active: CONFIG.active,
    maxUses: CONFIG.maxUses,
    durationDays: CONFIG.durationDays,
    expiresAt: CONFIG.expiresAt,
    plan: CONFIG.plan,
    note: CONFIG.note,
    createdAt: snap.exists ? (snap.data().createdAt || Date.now()) : Date.now(),
    updatedAt: Date.now(),
  };
  if (!snap.exists) {
    base.usedCount = 0;
    base.redeemers = [];
  }

  await ref.set(base, { merge: true });
  const after = (await ref.get()).data();
  console.log(snap.exists ? 'Updated promo code:' : 'Created promo code:', id);
  console.log(JSON.stringify(after, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});
