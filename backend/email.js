// Email sending via MailerSend
// Env vars required:
//   MAILERSEND_API_KEY  — token from app.mailersend.com → API tokens
//   EMAIL_FROM          — e.g. "Slovesa <hello@ucseslovesa.cz>"
//   EMAIL_FROM_NAME     — optional pretty name, defaults to "Nepravidelná slovesa"

import { MailerSend, EmailParams, Sender, Recipient } from 'mailersend';

const apiKey = process.env.MAILERSEND_API_KEY;
const fromEmail = process.env.EMAIL_FROM || 'hello@ucseslovesa.cz';
const fromName = process.env.EMAIL_FROM_NAME || 'Nepravidelná slovesa';

let client = null;
if (apiKey) {
  client = new MailerSend({ apiKey });
} else {
  console.warn('[email] MAILERSEND_API_KEY not set — emails will be skipped');
}

// Send a single transactional email
export async function sendEmail({ to, subject, html, text }) {
  if (!client) {
    console.warn('[email] skipping (no client)', { to, subject });
    return { ok: false, reason: 'no_client' };
  }
  if (!to || !subject || !html) {
    return { ok: false, reason: 'missing_params' };
  }
  try {
    const params = new EmailParams()
      .setFrom(new Sender(fromEmail, fromName))
      .setTo([new Recipient(to)])
      .setSubject(subject)
      .setHtml(html);
    if (text) params.setText(text);
    const resp = await client.email.send(params);
    return { ok: true, id: resp?.body?.message_id || null };
  } catch (e) {
    console.error('[email] send failed:', e?.message || e);
    return { ok: false, reason: 'send_error', error: e?.message };
  }
}

// ---------- Templates ----------

const APP_URL = 'https://ucseslovesa.cz';

export function welcomeEmail({ plan, isPromo }) {
  const planLabel = {
    lifetime: 'navždy (jednorázová platba)',
    yearly: 'roční předplatné',
    monthly: 'měsíční předplatné',
    promo: 'přístup přes promo kód',
  }[plan] || 'premium';

  const trialNote = (plan === 'monthly' || plan === 'yearly')
    ? `<p style="margin:0 0 16px;"><strong>7 dní zdarma:</strong> prvních 7 dní ti karta nic nestrhne. Pokud nebudeš chtít pokračovat, zruš to v Menu → 💳 Spravovat předplatné.</p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="cs">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f7fa;color:#1d2329;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 18px rgba(0,0,0,0.06);">
        <tr><td style="padding:32px 32px 8px;">
          <div style="font-size:0.72rem;font-weight:700;color:#5dc9bd;letter-spacing:0.04em;text-transform:uppercase;">Nepravidelná slovesa</div>
          <div style="font-size:1.6rem;font-weight:800;line-height:1.2;margin:6px 0 0;color:#1d2329;">Vítej v Premium! 🎉</div>
        </td></tr>
        <tr><td style="padding:16px 32px 24px;font-size:0.95rem;line-height:1.55;color:#3b454f;">
          <p style="margin:0 0 16px;">Díky moc za podporu! Máš odemčených všech <strong>106 nepravidelných sloves</strong> ve 24 výslovnostních skupinách. Plán: <strong>${planLabel}</strong>.</p>
          ${trialNote}
          <p style="margin:0 0 16px;"><strong>Jak začít:</strong></p>
          <ol style="margin:0 0 18px;padding-left:20px;">
            <li style="margin:0 0 6px;">Otevři appku a vyber si jakoukoli skupinu</li>
            <li style="margin:0 0 6px;">Projdi si "studium" → uvidíš vzorec, jak se slovesa chovají</li>
            <li style="margin:0 0 6px;">Pokračuj na "v pořadí" a "zamícháno" — píšeš tvary, dostáváš zpětnou vazbu</li>
            <li style="margin:0 0 6px;">Cvič 5 minut denně, ne dlouhé maratony</li>
          </ol>
          <p style="margin:0 0 20px;text-align:center;">
            <a href="${APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#5dc9bd,#7c6ff5);color:#fff;text-decoration:none;padding:12px 26px;border-radius:999px;font-weight:700;font-size:0.95rem;">Otevřít appku →</a>
          </p>
          ${isPromo ? '' : `<p style="margin:0 0 8px;font-size:0.86rem;color:#6b7280;"><strong>Spravovat předplatné:</strong> v appce klikni na ☰ Menu → 💳 Spravovat předplatné. Můžeš tam změnit kartu, stáhnout faktury nebo kdykoli zrušit.</p>`}
          <p style="margin:0;font-size:0.86rem;color:#6b7280;">Pokud máš jakýkoli dotaz, odpověz na tento e-mail.</p>
        </td></tr>
        <tr><td style="padding:18px 32px;border-top:1px solid #eef0f3;background:#fafbfc;font-size:0.78rem;color:#8a92a0;">
          ucseslovesa.cz · <a href="${APP_URL}/seznam/" style="color:#8a92a0;">Kompletní seznam sloves</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Vítej v Premium!

Díky za podporu. Máš odemčených všech 106 nepravidelných sloves.
Plán: ${planLabel}

Otevři appku: ${APP_URL}

Tip: cvič 5 minut denně, ne dlouhé maratony.

Spravovat předplatné: v appce ☰ Menu → 💳 Spravovat předplatné.

— Nepravidelná slovesa`;

  return {
    subject: 'Vítej v Premium! 🎉',
    html,
    text,
  };
}
