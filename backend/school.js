// Školní licence (jen CZ) — objednávka z /pro-skoly/, správa v adminu (#schools).
//   POST /school/order               — veřejné: objednávka (škola platí fakturou)
//   GET  /admin/schools              — seznam objednávek + využití licenčního kódu
//   POST /admin/schools/:id/status   — new | invoiced | paid | cancelled (+ číslo faktury)
//   POST /admin/schools/:id/license  — vytvoří licenční kód v promoCodes (Premium do 31. 8.)
//   POST /admin/schools/:id/send     — pošle kód a návod škole e-mailem
//
// Ceník: třída (do 30 žáků) 490 Kč, celá škola (bez omezení) 1 990 Kč, vždy na
// školní rok. Fakturu vystavuje provozovatel ručně; tady se jen eviduje stav.

const PRICES = { class: 490, school: 1990 };
const CLASS_SEATS = 30;
const SCHOOL_SEATS = 3000;
const STATUSES = ['new', 'invoiced', 'paid', 'cancelled'];
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Konec školního roku: objednávka od června platí až do 31. 8. příštího roku.
export function schoolYearEnd(now = new Date()) {
  const y = now.getMonth() >= 5 ? now.getFullYear() + 1 : now.getFullYear();
  return new Date(`${y}-08-31T23:59:59+02:00`).getTime();
}
const fmtDate = (ts) => new Date(ts).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Europe/Prague' });

function randCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return 'SKOLA-' + s;
}

export function registerSchoolRoutes(app, { db, requireAdmin, sendEmail, pushAll }) {
  const orders = db.collection('schoolOrders');
  const promo = db.collection('promoCodes');

  const hits = new Map();
  const allow = (ip) => {
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < 3600000);
    if (recent.length >= 5) { hits.set(ip, recent); return false; }
    recent.push(now); hits.set(ip, recent);
    if (hits.size > 2000) hits.clear();
    return true;
  };

  const tierLabel = (o) => (o.tier === 'school' ? 'celá škola' : `${o.classes} ${o.classes === 1 ? 'třída' : o.classes < 5 ? 'třídy' : 'tříd'}`);

  // ---------- Veřejná objednávka ----------
  app.post('/school/order', async (req, res) => {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true }); // honeypot
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    if (!allow(ip)) return res.status(429).json({ error: 'rate_limited' });
    const tier = b.tier === 'school' ? 'school' : 'class';
    const classes = tier === 'class' ? Math.min(20, Math.max(1, parseInt(b.classes, 10) || 1)) : null;
    const o = {
      tier,
      classes,
      school: clip(b.school, 200),
      ico: clip(b.ico, 20).replace(/\s/g, ''),
      address: clip(b.address, 300),
      name: clip(b.name, 120),
      email: clip(b.email, 200).toLowerCase(),
      note: clip(b.note, 1000),
      dpa: !!b.dpa,
    };
    if (!o.school || !o.name || !emailRe.test(o.email)) return res.status(400).json({ error: 'missing_fields' });
    if (o.ico && !/^\d{6,10}$/.test(o.ico)) return res.status(400).json({ error: 'bad_ico' });
    o.price = tier === 'school' ? PRICES.school : PRICES.class * classes;
    o.seats = tier === 'school' ? SCHOOL_SEATS : CLASS_SEATS * classes;
    o.validUntil = schoolYearEnd();
    o.status = 'new';
    o.createdAt = Date.now();
    try {
      const ref = await orders.add(o);
      console.log('School order →', ref.id, o.school, tierLabel(o), o.price);
      res.json({ ok: true, price: o.price, validUntil: o.validUntil });

      // Upozornění provozovatele (push do adminu, jinak e-mail)
      const title = '🏫 Objednávka školní licence';
      const body = `${o.school} — ${tierLabel(o)}, ${o.price.toLocaleString('cs-CZ')} Kč`;
      let pushed = 0;
      try { pushed = await pushAll({ title, body, url: '/admin/#schools', tag: 'school-' + ref.id }); } catch { /* nevadí */ }
      if (!pushed && process.env.REPORT_EMAIL_TO) {
        await sendEmail({
          to: process.env.REPORT_EMAIL_TO,
          subject: title + ': ' + o.school,
          html: `<p>${escHtml(body)}</p><p>${escHtml(o.name)} · ${escHtml(o.email)}</p><p><a href="https://ucseslovesa.cz/admin/#schools">Otevřít v adminu</a></p>`,
          text: `${body}\n${o.name} · ${o.email}\nhttps://ucseslovesa.cz/admin/#schools`,
        }).catch(() => {});
      }
      // Potvrzení objednávajícímu
      const priceTxt = o.price.toLocaleString('cs-CZ') + ' Kč';
      await sendEmail({
        to: o.email,
        subject: 'Objednávka školní licence — ucseslovesa.cz',
        html: `<p>Dobrý den,</p>
<p>děkujeme za objednávku školní licence aplikace <strong>Nepravidelná slovesa</strong> pro <strong>${escHtml(o.school)}</strong>.</p>
<ul><li>Rozsah: ${escHtml(tierLabel(o))} (až ${o.seats.toLocaleString('cs-CZ')} žáků)</li>
<li>Cena: <strong>${priceTxt}</strong> (neplátce DPH)</li>
<li>Platnost: do ${fmtDate(o.validUntil)}, bez automatického prodloužení</li></ul>
<p>Fakturu se splatností 14 dní pošleme do 2 pracovních dnů. Licenční kód pro žáky dostanete e-mailem spolu s návodem, jak ho rozdat.</p>
<p>Kdybyste cokoli potřebovali, napište na hello@ucseslovesa.cz.</p>
<p>S pozdravem<br>Petr, ucseslovesa.cz</p>`,
        text: `Dobrý den,\n\nděkujeme za objednávku školní licence pro ${o.school}.\nRozsah: ${tierLabel(o)} (až ${o.seats} žáků)\nCena: ${priceTxt} (neplátce DPH)\nPlatnost: do ${fmtDate(o.validUntil)}, bez automatického prodloužení\n\nFakturu se splatností 14 dní pošleme do 2 pracovních dnů. Licenční kód pro žáky dostanete e-mailem spolu s návodem.\n\nS pozdravem\nPetr, ucseslovesa.cz`,
      }).catch(() => {});
    } catch (e) {
      console.error('School order failed:', e);
      if (!res.headersSent) res.status(500).json({ error: 'failed' });
    }
  });

  // ---------- Admin ----------
  app.get('/admin/schools', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const snap = await orders.orderBy('createdAt', 'desc').limit(300).get();
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const codes = list.map((o) => o.licenseCode).filter(Boolean);
      const usage = {};
      if (codes.length) {
        const docs = await db.getAll(...codes.map((c) => promo.doc(c)));
        docs.forEach((d) => { if (d.exists) usage[d.id] = { used: Number(d.data().usedCount || 0), max: d.data().maxUses || null, active: d.data().active !== false }; });
      }
      list.forEach((o) => { if (o.licenseCode) o.usage = usage[o.licenseCode] || null; });
      res.json({ orders: list, prices: PRICES, seats: { class: CLASS_SEATS, school: SCHOOL_SEATS } });
    } catch (e) {
      console.error('Admin schools failed:', e);
      res.status(500).json({ error: 'failed', detail: e.message });
    }
  });

  app.post('/admin/schools/:id/status', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const st = String(req.body?.status || '');
    if (!STATUSES.includes(st)) return res.status(400).json({ error: 'bad_status' });
    const patch = { status: st, [`${st}At`]: Date.now() };
    if ('invoiceNo' in (req.body || {})) patch.invoiceNo = clip(req.body.invoiceNo, 40);
    try {
      await orders.doc(req.params.id).update(patch);
      // Zrušená objednávka → vypnout licenční kód (nemazat, ať zůstane historie)
      if (st === 'cancelled') {
        const o = (await orders.doc(req.params.id).get()).data();
        if (o?.licenseCode) await promo.doc(o.licenseCode).set({ active: false }, { merge: true });
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'failed', detail: e.message }); }
  });

  app.post('/admin/schools/:id/license', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const ref = orders.doc(req.params.id);
      const out = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('not_found');
        const o = snap.data();
        if (o.licenseCode) return { code: o.licenseCode, existed: true };
        let code; let pref;
        for (let i = 0; i < 5; i++) {
          code = randCode(); pref = promo.doc(code);
          if (!(await tx.get(pref)).exists) break;
          code = null;
        }
        if (!code) throw new Error('code_collision');
        const until = o.validUntil || schoolYearEnd();
        tx.set(pref, {
          active: true,
          plan: 'school',
          note: `Školní licence: ${o.school} (${tierLabel(o)})`,
          durationDays: null,
          premiumUntil: until,   // Premium každého žáka končí 31. 8.
          expiresAt: until,      // a po tomhle dni už kód nejde uplatnit
          maxUses: o.seats,
          usedCount: 0,
          redeemers: [],
          schoolOrderId: ref.id,
          createdAt: Date.now(),
        });
        tx.update(ref, { licenseCode: code, licenseAt: Date.now() });
        return { code, existed: false };
      });
      console.log('School license →', req.params.id, out.code);
      res.json({ ok: true, ...out });
    } catch (e) {
      if (e.message === 'not_found') return res.status(404).json({ error: 'not_found' });
      console.error('School license failed:', e);
      res.status(500).json({ error: 'failed', detail: e.message });
    }
  });

  app.post('/admin/schools/:id/send', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const ref = orders.doc(req.params.id);
      const o = (await ref.get()).data();
      if (!o) return res.status(404).json({ error: 'not_found' });
      if (!o.licenseCode) return res.status(400).json({ error: 'no_code' });
      const until = fmtDate(o.validUntil || schoolYearEnd());
      const r = await sendEmail({
        to: o.email,
        subject: `Licenční kód pro ${o.school} — ucseslovesa.cz`,
        html: `<p>Dobrý den,</p>
<p>posíláme licenční kód pro <strong>${escHtml(o.school)}</strong>:</p>
<p style="font-size:24px;font-weight:800;letter-spacing:2px;background:#f2f4f8;padding:12px 16px;border-radius:10px;display:inline-block">${escHtml(o.licenseCode)}</p>
<p>Kód platí pro až <strong>${Number(o.seats).toLocaleString('cs-CZ')} žáků</strong> a odemyká plnou verzi (všech 106 sloves, Car Mode, synchronizace) do <strong>${until}</strong>.</p>
<p><strong>Jak ho žáci uplatní:</strong></p>
<ol><li>Otevřou <a href="https://ucseslovesa.cz">ucseslovesa.cz</a> (mobil i počítač, nic se neinstaluje).</li>
<li>Přihlásí se přes Google (tlačítko vpravo nahoře).</li>
<li>Kliknou na kteroukoli zamčenou skupinu → <strong>🎟️ Mám slevový kód</strong> → zadají kód.</li></ol>
<p>Kód můžete rozdat na papírku, v Bakalářích nebo v Teams. Každý žák ho uplatní jen jednou.</p>
<p>S pozdravem<br>Petr, ucseslovesa.cz</p>`,
        text: `Dobrý den,\n\nlicenční kód pro ${o.school}: ${o.licenseCode}\n\nPlatí pro až ${o.seats} žáků do ${until}.\n\nJak ho žáci uplatní:\n1. Otevřou ucseslovesa.cz\n2. Přihlásí se přes Google\n3. Kliknou na zamčenou skupinu → Mám slevový kód → zadají kód.\n\nS pozdravem\nPetr, ucseslovesa.cz`,
      });
      if (!r.ok) return res.status(502).json({ error: 'email_failed', detail: r.reason || '' });
      await ref.update({ codeSentAt: Date.now() });
      res.json({ ok: true });
    } catch (e) {
      console.error('School send failed:', e);
      res.status(500).json({ error: 'failed', detail: e.message });
    }
  });
}
