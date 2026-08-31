#!/usr/bin/env node
// Create or update the POLISH teacher promo code in Firestore.
//
// Sesterský skript k create-promo-code.js (český UCITELE8892). Kódy jsou ve
// Firestore jazykově neutrální — oddělené jsou jen proto, aby šlo hlídat
// vyčerpání každé kampaně zvlášť a aby polský učitel viděl polský kód.
//
// Usage (from repo root):
//   FIREBASE_SERVICE_ACCOUNT_JSON="$(cat path/to/svc.json)" \
//     node backend/scripts/create-promo-code-pl.js
//
// Re-running for the same code is a no-op for the existing redeemers list
// (set+merge, never touches usedCount/redeemers/lastRedeemedAt — ty spravuje
// redeem transakce v server.js).

const admin = require('firebase-admin');

const CONFIG = {
  // Co učitel napíše do paywallu.
  // POZOR: musí sedět s kódem na /dla-nauczycieli/ (pl/dla-nauczycieli/index.html).
  code: 'NAUCZYCIEL8892',
  // Kolik různých učitelů ho může uplatnit (každý uid jen jednou).
  // 100 pro kampaň na polské školy 2026/27 — stejně jako česká kampaň.
  maxUses: 100,
  // 365 dní premium na uplatnění. Backend to čte v /redeem-code.
  durationDays: 365,
  // Po tomhle datu se NOVÁ uplatnění nepřijímají. Kdo už kód uplatnil,
  // svých 365 dní si nechá bez ohledu na tohle datum.
  // 31. 8. 2027 23:59:59 CEST v ms:
  expiresAt: Date.UTC(2027, 7, 31, 21, 59, 59), // Aug = month 7 (0-indexed)
  active: true,
  plan: 'annual_teacher',
  note: 'czasowniki.pl/dla-nauczycieli — kampaň na polské školy 2026/27',
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
