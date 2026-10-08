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
export async function sendEmail({ to, subject, html, text, senderName }) {
  if (!client) {
    console.warn('[email] skipping (no client)', { to, subject });
    return { ok: false, reason: 'no_client' };
  }
  if (!to || !subject || !html) {
    return { ok: false, reason: 'missing_params' };
  }
  try {
    const params = new EmailParams()
      .setFrom(new Sender(fromEmail, senderName || fromName))
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

// Jazykové mutace uvítacího mailu. Jazyk přichází z metadata checkoutu
// (Stripe) nebo z pole `lang` v profilu (promo kódy); neznámý → čeština.
const WELCOME = {
  cs: {
    appUrl: 'https://ucseslovesa.cz',
    listUrl: 'https://ucseslovesa.cz/seznam/',
    listLabel: 'Kompletní seznam sloves',
    domain: 'ucseslovesa.cz',
    brand: 'Nepravidelná slovesa',
    iconAlt: 'UČ SE!',
    senderName: null, // výchozí EMAIL_FROM_NAME
    planLabel: {
      lifetime: 'navždy (jednorázová platba)',
      yearly: 'roční předplatné',
      monthly: 'měsíční předplatné',
      promo: 'přístup přes promo kód',
    },
    subject: 'Vítej v Premium! 🎉',
    title: 'Vítej v Premium! 🎉',
    trial: 'prvních 7 dní ti karta nic nestrhne. Pokud nebudeš chtít pokračovat, zruš to v Menu → 💳 Spravovat předplatné.',
    trialLead: '7 dní zdarma:',
    intro: (plan) => `Díky moc za podporu! Máš odemčených všech <strong>106 nepravidelných sloves</strong> ve 24 výslovnostních skupinách. Plán: <strong>${plan}</strong>.`,
    howTo: 'Jak začít:',
    steps: [
      'Otevři appku a vyber si jakoukoli skupinu',
      'Projdi si <strong>studium</strong> → uvidíš vzorec, jak se slovesa chovají',
      'Pokračuj na <strong>v pořadí</strong> a <strong>zamícháno</strong> — píšeš tvary, dostáváš zpětnou vazbu',
      'Cvič 5 minut denně, ne dlouhé maratony',
    ],
    cta: 'Otevřít appku →',
    manage: '<strong>Spravovat předplatné:</strong> v appce klikni na ☰ Menu → 💳 Spravovat předplatné. Můžeš tam změnit kartu, stáhnout faktury nebo kdykoli zrušit.',
    reply: 'Pokud máš jakýkoli dotaz, odpověz na tento e-mail.',
    text: (plan, url) => `Vítej v Premium!

Díky za podporu. Máš odemčených všech 106 nepravidelných sloves.
Plán: ${plan}

Otevři appku: ${url}

Tip: cvič 5 minut denně, ne dlouhé maratony.

Spravovat předplatné: v appce ☰ Menu → 💳 Spravovat předplatné.

— Nepravidelná slovesa`,
  },
  pl: {
    appUrl: 'https://czasowniki.pl',
    listUrl: 'https://czasowniki.pl/lista/',
    listLabel: 'Pełna lista czasowników',
    domain: 'czasowniki.pl',
    brand: 'Czasowniki nieregularne',
    iconAlt: 'UCZ SIĘ!',
    senderName: 'Czasowniki nieregularne',
    planLabel: {
      lifetime: 'na zawsze (płatność jednorazowa)',
      yearly: 'subskrypcja roczna',
      monthly: 'subskrypcja miesięczna',
      promo: 'dostęp przez kod promocyjny',
    },
    subject: 'Witaj w Premium! 🎉',
    title: 'Witaj w Premium! 🎉',
    trial: 'przez pierwsze 7 dni nie pobierzemy z karty ani grosza. Jeśli nie zechcesz kontynuować, anuluj w Menu → ⚙️ Ustawienia → 💳 Zarządzaj subskrypcją.',
    trialLead: '7 dni za darmo:',
    intro: (plan) => `Wielkie dzięki za wsparcie! Masz odblokowane wszystkie <strong>106 czasowników nieregularnych</strong> w 24 grupach według wzorców. Plan: <strong>${plan}</strong>.`,
    howTo: 'Jak zacząć:',
    steps: [
      'Otwórz aplikację i wybierz dowolną grupę',
      'Przejdź etap <strong>nauka</strong> → zobaczysz wzorzec, według którego zmieniają się czasowniki',
      'Kontynuuj etapami <strong>po kolei</strong> i <strong>wymieszane</strong> — wpisujesz formy i od razu wiesz, gdzie jest błąd',
      'Ćwicz 5 minut dziennie zamiast długich maratonów',
    ],
    cta: 'Otwórz aplikację →',
    manage: '<strong>Zarządzanie subskrypcją:</strong> w aplikacji kliknij ☰ Menu → ⚙️ Ustawienia → 💳 Zarządzaj subskrypcją. Zmienisz tam kartę, pobierzesz faktury albo w każdej chwili anulujesz.',
    reply: 'Jeśli masz jakiekolwiek pytanie, po prostu odpowiedz na tego maila.',
    text: (plan, url) => `Witaj w Premium!

Dzięki za wsparcie. Masz odblokowane wszystkie 106 czasowników nieregularnych.
Plan: ${plan}

Otwórz aplikację: ${url}

Wskazówka: ćwicz 5 minut dziennie zamiast długich maratonów.

Zarządzanie subskrypcją: w aplikacji ☰ Menu → ⚙️ Ustawienia → 💳 Zarządzaj subskrypcją.

— Czasowniki nieregularne`,
  },
};

export function normalizeLang(lang) {
  return Object.prototype.hasOwnProperty.call(WELCOME, lang) ? lang : 'cs';
}

export function welcomeEmail({ plan, isPromo, lang }) {
  const L = WELCOME[normalizeLang(lang)];
  const APP_URL = L.appUrl;
  const planLabel = L.planLabel[plan] || 'premium';

  const trialNote = (plan === 'monthly' || plan === 'yearly')
    ? `<p style="margin:0 0 16px;"><strong>${L.trialLead}</strong> ${L.trial}</p>`
    : '';

  const steps = L.steps.map((s) => `<li style="margin:0 0 6px;">${s}</li>`).join('\n            ');

  const html = `<!DOCTYPE html>
<html lang="${normalizeLang(lang)}">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f7fa;color:#1d2329;font-size:16px;line-height:1.6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 4px 18px rgba(0,0,0,0.06);">
        <tr><td style="padding:32px 32px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td valign="middle" style="text-align:left;">
                <div style="font-size:12px;font-weight:700;color:#5dc9bd;letter-spacing:0.06em;text-transform:uppercase;">${L.brand}</div>
                <div style="font-size:25px;font-weight:800;line-height:1.2;margin:6px 0 0;color:#1d2329;">${L.title}</div>
              </td>
              <td valign="middle" align="right" width="72" style="padding-left:12px;">
                <img src="${APP_URL}/icon-192.png" alt="${L.iconAlt}" width="72" height="72" style="display:block;width:72px;height:72px;border-radius:16px;" />
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 36px 28px;font-size:16px;line-height:1.6;color:#3b454f;">
          <p style="margin:0 0 16px;">${L.intro(planLabel)}</p>
          ${trialNote}
          <p style="margin:0 0 10px;"><strong>${L.howTo}</strong></p>
          <ol style="margin:0 0 20px;padding-left:22px;">
            ${steps}
          </ol>
          <p style="margin:0 0 22px;text-align:center;">
            <a href="${APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#5dc9bd,#7c6ff5);color:#fff;text-decoration:none;padding:13px 30px;border-radius:999px;font-weight:700;font-size:16px;">${L.cta}</a>
          </p>
          ${isPromo ? '' : `<p style="margin:0 0 10px;font-size:14px;color:#6b7280;line-height:1.55;">${L.manage}</p>`}
          <p style="margin:0;font-size:14px;color:#6b7280;line-height:1.55;">${L.reply}</p>
        </td></tr>
        <tr><td align="center" style="padding:18px 32px;border-top:1px solid #eef0f3;background:#fafbfc;font-size:13px;color:#8a92a0;">
          <a href="${APP_URL}" style="color:#8a92a0;text-decoration:none;">${L.domain}</a> · <a href="${L.listUrl}" style="color:#8a92a0;">${L.listLabel}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return {
    subject: L.subject,
    html,
    text: L.text(planLabel, APP_URL),
    senderName: L.senderName,
  };
}
