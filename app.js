// ============================================================
// Irregular Verbs App — guided lesson + browse/flashcards/quiz
// ============================================================

import * as cloud from './cloud.js';

// ---- i18n -------------------------------------------------------------------
// Jazyk UI se čte z <html lang="…">. Česká verze je zdroj pravdy — texty žijí
// přímo v TEXTS níže. Jazyková mutace dodá window.LANG_PACK (script tag PŘED
// app.js), který může přepsat libovolný klíč z TEXTS i překlady dat. Postup
// přidání jazyka: docs/i18n.md.
const LANG = document.documentElement.lang || 'cs';
// TTS hlas pro zadání v mateřském jazyce (anglická slovesa mají vlastní výběr hlasu).
const PROMPT_VOICE = (window.LANG_PACK && window.LANG_PACK.voice) || 'cs-CZ';

// Jazyková mutace může přeložit i data z verbs.json (překlady sloves, patterny
// a pravidla skupin, názvy sekcí). Mutuje se in-place hned po fetch(), takže
// zbytek aplikace čte pořád stejná pole (v.cs pak nese překlad daného jazyka).
function localizeData(data) {
  const pack = window.LANG_PACK;
  if (!pack || !pack.data) return;
  const d = pack.data;
  data.sections.forEach((sec) => {
    if (d.sections && d.sections[sec.id]) sec.title = d.sections[sec.id];
    sec.subsections.forEach((sub) => {
      const g = d.groups && d.groups[sub.id];
      if (g) {
        if (g.pattern) sub.pattern = g.pattern;
        if (g.rule) sub.rule = g.rule;
        if (g.title) sub.title = g.title;
      }
      sub.verbs.forEach((v) => {
        if (d.verbs && d.verbs[v.inf]) v.cs = d.verbs[v.inf];
      });
    });
  });
}

// ---- In-app webview (FB/IG/etc.) handling ----------------------------------
// Google's signInWithPopup is blocked in embedded webviews ("disallowed_useragent").
// The early <head> script in index.html sets html.is-inapp-webview + window.__inAppWebview.
// Here we wire up the banner UI and intercept login clicks to steer users to a real browser.
function isInAppWebview() { return !!window.__inAppWebview; }
function showWebviewBanner(opts) {
  opts = opts || {};
  const banner = document.getElementById('webview-banner');
  if (!banner) return;
  const dismissed = sessionStorage.getItem('webview-banner-dismissed') === '1';
  // Forced shows (e.g. after clicking login) ignore the per-session dismiss.
  if (dismissed && !opts.force) return;
  banner.hidden = false;
  banner.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    if (typeof window.plausible === 'function') {
      window.plausible('webview_banner_shown', { props: { app: window.__inAppWebviewName || 'unknown', forced: !!opts.force } });
    }
  } catch (_) {}
}
function handleLoginInWebview(source) {
  if (!isInAppWebview()) return false;
  try {
    if (typeof window.plausible === 'function') {
      window.plausible('webview_login_blocked', { props: { app: window.__inAppWebviewName || 'unknown', source: source || 'unknown' } });
    }
  } catch (_) {}
  showWebviewBanner({ force: true });
  return true; // signal "we handled it; do not call signIn()"
}
// One-time wiring of banner buttons + initial event.
(function initWebviewBanner() {
  if (typeof document === 'undefined') return;
  function setup() {
    if (!isInAppWebview()) return;
    const banner = document.getElementById('webview-banner');
    if (!banner) return;
    // Label which app we're in.
    const appName = window.__inAppWebviewName || 'facebook';
    const labelMap = { facebook: 'Facebooku', instagram: 'Instagramu', messenger: 'Messengeru', tiktok: 'TikToku', linkedin: 'LinkedInu', twitter: 'X/Twitteru', other: 'aplikace třetí strany' };
    // Jazyková mutace může názvy aplikací přepsat (TEXTS/t() tady ještě nejsou k dispozici).
    if (window.LANG_PACK && window.LANG_PACK.texts && window.LANG_PACK.texts.wv_app_labels) {
      Object.assign(labelMap, window.LANG_PACK.texts.wv_app_labels);
    }
    const labelEl = document.getElementById('webview-banner-app');
    if (labelEl) labelEl.textContent = labelMap[appName] || labelMap.other;
    // Android: offer "Open in Chrome" via intent URL.
    const isAndroid = /Android/i.test(navigator.userAgent);
    const openBtn = document.getElementById('webview-banner-open');
    if (openBtn && isAndroid) {
      openBtn.hidden = false;
      openBtn.addEventListener('click', () => {
        const url = location.href.replace(/^https?:\/\//, '');
        const intent = 'intent://' + url + '#Intent;scheme=https;package=com.android.chrome;end';
        try { if (typeof window.plausible === 'function') window.plausible('webview_open_external_clicked', { props: { app: appName, target: 'chrome_intent' } }); } catch(_){}
        window.location.href = intent;
      });
    }
    const copyBtn = document.getElementById('webview-banner-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(location.href);
          copyBtn.textContent = t('wv_copied');
          setTimeout(() => { copyBtn.textContent = t('wv_copy'); }, 2200);
          try { if (typeof window.plausible === 'function') window.plausible('webview_copy_link_clicked', { props: { app: appName } }); } catch(_){}
        } catch (_) {
          // Fallback: select location bar text not possible; just tell user.
          copyBtn.textContent = t('wv_copy_fail');
          setTimeout(() => { copyBtn.textContent = t('wv_copy'); }, 2200);
        }
      });
    }
    const closeBtn = document.getElementById('webview-banner-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        banner.hidden = true;
        sessionStorage.setItem('webview-banner-dismissed', '1');
      });
    }
    // Show on load (passive — respects dismiss).
    showWebviewBanner({ force: false });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();

// Subsections free without premium. Premium unlocks all 106 verbs across all groups.
const FREE_SUB_BASE = ['1.1.0', '1.2.1', '1.2.5'];
const FREE_SUB_IDS = new Set(FREE_SUB_BASE); // kept for backwards-compat; new code uses getFreeSubIds()

// ----- Streak rewards (Phase B in product spec) -----
// Each milestone offers the user a CHOICE of 3 curated groups (or wildcard at day 30).
// Picked groups are added to state.streakRewards.unlockedSubIds permanently,
// even if the streak later breaks. Cap = 4 milestones × 1 group + 3 base = 7 free groups max.
// Trophies — visual "medal cabinet" on the streak pill. Derived from
// maxStreakReached (never lost, even if streak breaks). The first threshold
// matches the first STREAK_MILESTONES entry by design.
const STREAK_TROPHIES = [
  { days: 3,   icon: '🔥', labelKey: 'trophy_3' },
  { days: 7,   icon: '⭐', labelKey: 'trophy_7' },
  { days: 14,  icon: '💎', labelKey: 'trophy_14' },
  { days: 30,  icon: '👑', labelKey: 'trophy_30' },
  { days: 100, icon: '🏆', labelKey: 'trophy_100' },
  { days: 365, icon: '🐉', labelKey: 'trophy_365' },
];
function earnedTrophies(maxStreak) {
  return STREAK_TROPHIES.filter((t) => maxStreak >= t.days);
}

const STREAK_MILESTONES = [
  {
    days: 3,
    options: ['3.0.0', '2.1.1', '1.2.10'],  // kvantita / krása / kuriozita
  },
  {
    days: 7,
    options: ['2.1.3', '1.2.3', '2.4.0'],   // prestiž / klasika / anomálie
  },
  {
    days: 14,
    options: ['2.3.2', '2.2.4', '1.2.6'],   // 8 sl. / 7 sl. / 6 sl.
  },
  {
    days: 30,
    options: null,                          // wildcard — uživatel si vybere z čehokoli zbývajícího
  },
];
function milestoneFor(days) {
  return STREAK_MILESTONES.find((m) => m.days === days);
}
function loadStreakRewards() {
  try {
    const raw = JSON.parse(localStorage.getItem('streakRewards') || '{}');
    return {
      unlockedSubIds: Array.isArray(raw.unlockedSubIds) ? raw.unlockedSubIds : [],
      claimedMilestones: Array.isArray(raw.claimedMilestones) ? raw.claimedMilestones : [],
      pendingMilestones: Array.isArray(raw.pendingMilestones) ? raw.pendingMilestones : [],
      maxStreakReached: typeof raw.maxStreakReached === 'number' ? raw.maxStreakReached : 0,
    };
  } catch {
    return { unlockedSubIds: [], claimedMilestones: [], pendingMilestones: [], maxStreakReached: 0 };
  }
}
function saveStreakRewards() {
  try { localStorage.setItem('streakRewards', JSON.stringify(state.streakRewards)); } catch {}
}
function getFreeSubIds() {
  return new Set([...FREE_SUB_BASE, ...(state.streakRewards?.unlockedSubIds || [])]);
}
// Cheap inline check used in many render paths; respects streak rewards.
function isFreeSub(subId) {
  return FREE_SUB_BASE.includes(subId)
    || (state.streakRewards?.unlockedSubIds || []).includes(subId);
}

// Stripe / backend config — backend URL set after Railway deploy
const BACKEND_URL = 'https://nepravidelna-slovesa-production.up.railway.app'; // backend stays on Railway
const STRIPE_PRICES = {
  lifetime: { id: 'price_1TYOTrK1GA1fPMpODCB8e5uA', mode: 'payment' },      // 449 Kč one-time (live)
  yearly:   { id: 'price_1TYOVlK1GA1fPMpOONV6P92W', mode: 'subscription' }, // 249 Kč/year (live)
  monthly:  { id: 'price_1TYOX3K1GA1fPMpO7yLM6x8i', mode: 'subscription' }, // 49 Kč/mo (live)
};
// Jazyková mutace může dodat vlastní Stripe ceny v lokální měně (docs/i18n.md).
if (window.LANG_PACK && window.LANG_PACK.stripePrices) {
  Object.assign(STRIPE_PRICES, window.LANG_PACK.stripePrices);
}

// Effective premium check. Stripe payers: premium=true with no expiry → always active.
// Promo redemptions (teacher codes etc.) may set premiumExpiresAt — once past, the
// flag flips to false offline too, without waiting for the next Firestore sync.
function isPremiumActive() {
  if (localStorage.getItem('premium') !== 'true') return false;
  const exp = Number(localStorage.getItem('premiumExpiresAt')) || 0;
  if (!exp) return true; // no expiry = lifetime / stripe
  return exp > Date.now();
}

const state = {
  data: null,
  dialect: localStorage.getItem('dialect') || 'BrE',
  theme: localStorage.getItem('theme') || 'light',
  style: localStorage.getItem('style') || 'pro', // 'pro' | 'student' | 'hantec'
  currentView: 'lesson',
  lesson: null, // lesson state when active
  // test: null = volný kvíz; jinak zadání z odkazu #/test/<kód> (viz dtDecode)
  quiz: { pool: [], idx: 0, score: 0, total: 0, type: 'mixed', selectedSections: new Set(), review: [], test: null, rng: null },
  progress: JSON.parse(localStorage.getItem('progress') || '{}'), // { inf: {status, lastSeen, attempts} }
  premium: isPremiumActive(),
  // Streak-based group unlocks. Picked at milestones 3/7/14/30; permanent.
  streakRewards: loadStreakRewards(),
  // When true, the three correct forms are read aloud after the student submits
  // their answer in Stage 2 (askStage2Verb). Toggled by a small 🔊/🔇 button in
  // the top-right corner of the question card; preference persists.
  audioAfterAnswer: localStorage.getItem('audioAfterAnswer') === 'true',
  // Short UI confirmation/wrong/streak cues. Defaults ON — set to 'false' in
  // localStorage to mute. Independent of audioAfterAnswer (which reads the
  // three verb forms aloud). May get its own toggle later if needed.
  soundEffects: localStorage.getItem('soundEffects') !== 'false',
};

// ============================================================
// Text presets: "pro" (default) vs "student" (slangy)
// ============================================================

// Feedback phrase pools — t() picks randomly when value is an array.
// {name} → user's first name (Google account); lines with {name} are
// skipped when no user is signed in.
const POS_PRO = [
  'Approved bez připomínek! ✅',
  'Tohle mělo skvělý drive. 🚀',
  'Čistej win-win. 🤝',
  'Tenhle task máš splněnej na 110 %. 📈',
  'Doručeno v termínu a v top kvalitě. 📦',
  'Tady někdo aspiroval na povýšení. 💼',
  'KPI splněny pro dnešek. 📊',
  'As per my previous email... tohle bylo bez chyby! 📩',
  'Skvěle odřízený projekt. 🦾',
  'Kdo neskáče, není {name}, HOP HOP HOP! ⚽️',
  'V příštím mailu zahraničním kolegům už neuděláš chybu. 👋',
  'Dovolená v zahraničí se začíná vyplácet. ✈️',
  'HR oddělení tleská. 👏',
  'Rodilí mluvčí na callu nebudou chápat. 🎧',
  'Lepší investice do sebe než do kryptoměn. 🪙',
  'Tohle sloveso prošlo auditem bez ztráty kytičky. 🕵️‍♂️',
  'Skoro tak dobrý pocit, jako když v pátek padne čtrnáctá hodina. 🍻',
];
const NEG_PRO = [
  'Tenhle draft ještě potřebuje revizi. 📝',
  'Chybička v matrixu. Pojďme na re-work. 🔄',
  'Tady nám to trochu uletělo z rozpočtu. 📉',
  'Zamítnuto finančním ředitelem. Zkus to znovu a lépe. 🏦',
  'Někde se nám zasekl workflow. 🚧',
  'Tohle na prezentaci před boardem radši nedávej. 🤫',
  'Asi špatný signál na callu. Zkusíme to znovu? 📞',
  'Tenhle task neprošel přes QA (kontrolu kvality). 🛠️',
  'Chce to ještě jeden lok kafe. ☕',
  'Mozek už přepnul do offline režimu? 🧠💤',
  'Tohle byl vyloženě překlep z únavy. 🥱',
  'Kofeinový deficit se projevil. 📉☕',
  'Prsty byly rychlejší než myšlenka. 🏎️',
  'Nevadí, po celém dni v práci máš právo na jeden fail. 🤝',
];
const POS_STUDENT = [
  'Clean! ✨',
  'Pure skill! 🧠',
  'Flexíš solidně! 💪',
  'Certified pro. 🤝',
  'Ona tam ta slovesa prostě padají. 🔥',
  'Ez pz lemon squeezy. 🍋',
  'Big brain energy! ⚡',
  'Trefa do černýho. 🎯',
  'No cap, tohle bylo perfektní. 🙌',
  'Slay! 💅',
  'Kdo neskáče, není {name}, HOP HOP HOP! ⚽️',
];
const STREAK_PRO = [
  'Tohle je na povýšení ještě před kvartálním hodnocením! 📈',
  'Ty ten test drtíš jako senior manažer. 👑',
  'S takovou ti za chvíli dají na starosti celou zahraniční pobočku. 🌍',
  'Employee of the month! 🏆',
  'Tenhle výkon chci vidět ve tvém týdenním reportu. 📑',
  'Drtíš to jako prezentaci před investory. 💸',
  'Tvůj profesní růst právě nabral raketové tempo. 🚀',
  'S takovou slovní zásobou můžeš na příštím mezinárodním callu rovnou diktovat podmínky. 🗣️',
];
const STREAK_STUDENT = [
  'Tak to je streak jako býk! 🐂',
  'Ty seš mašina! 🚂',
  'Někdo to zastavte, hoříš! ☄️',
  'God mode aktivován. 👑',
  'Ty ten algoritmus úplně ničíš. 💥',
  'Unstoppable! 🌪️',
  'Čistá práce, tleskám ve stoje. 👏',
  'Irregular verbs masterclass. 🎓',
  'Rodilí mluvčí ti právě závidí. 🇬🇧',
  'Shakespearovi ukápla slza štěstí. 🥲',
  'Tvoje angličtinářka is proud of you. 👩‍🏫',
  'Tohle sloveso se ti podvolilo. 😎',
  'Už i tvůj telefon uznává tvou dominanci. 📱',
  'S takovou můžeš jít rovnou do Hollywoodu. 🎬',
  'Moje databáze přímo přede blahem. 🤖',
];
const NEG_STUDENT = [
  'Auuu, tak tohle docela bolelo. 💀',
  'Tohle sloveso tě totálně vyoutovalo. ❌',
  'Trochu missclick, ne? 🎯',
  'Tady ti ujel vlak i s gramatikou. 🚂💨',
  'Nekecej, že tomuhle tvaru věříš. 🤨',
  'Tohle neprošlo ani u tvojí lavice. 🎒',
  'Tvoje angličtinářka právě ucítila podivné chvění v síle. 👵⚡',
  'Tohle sloveso si tě dalo k snídani. 🥣',
  'Wasted. 🎮',
  'Tohle nebyl úplně pro-move. 📉',
  'Chyba v kódu, restartuj prsty. ⌨️',
  'Tady ti spadlo FPS na nulu. 📉',
  'Laglo se ti to, zkus to znova. 🌐',
  'Tohle sloveso tě zaspamovalo chybou. 👾',
  'Skill issue. Ale dá se to natrénovat! 🛠️',
  'Tenhle tvar dostal instantní ban. 🚫',
  'Mission failed, we\'ll get \'em next time. 🎖️',
  'Nope. 🛑',
  'Bruh... fakt? 💀',
  'Těsně vedle, jako tvůj odhad na testu. 📉',
  'Zkus to vymyslet znovu a lépe. 🧠',
  'Tudy ne, kámo. 🚷',
  'Fake news. 📰',
  'Eeeej, vedle. 🥶',
];
const POS_HANTEC = [
  'Betelný! 👌',
  'Seš borec jak hrom. 💪',
  'Zgómls to jak nic. 🧠',
  'Tak tomu říkám fachman. 🛠️',
  'Hokna odvedená na jedničku. ✅',
  'Na štatlu by ti tleskali. 👏',
  'Betelně to sype, jen tak dál. 🔥',
  'Šalina jede a ty taky. 🚋',
  'Angličtinu gómeš jak málokdo. 🎓',
  'Kdo neskáče, není {name}, HOP HOP HOP! ⚽️',
  'Petrov by zazvonil na tvoju počest. 🔔',
  'To byla čurina, co? Máš to za jedna. 😎',
];
const NEG_HANTEC = [
  'Hmm, tohle negómu. Zkus to ešče raz. 🤔',
  'Tos trochu zvoral, kámo. Nevadí. 😅',
  'Ujela ti šalina. Počkej na další a jeď znova. 🚋',
  'Klídek, aji největší borci se sekajou. 🤝',
  'To bylo vedle jak ta jedle u Prygla. 🌲',
  'Švihls to moc hrr. Zkus to v klidu. 🐢',
  'Tady to drhlo jak stará šalina do kopca. 📉',
  'Tohle sloveso na tebe vyzrálo. Oplať mu to. 👾',
];
const STREAK_HANTEC = [
  'Jedeš jak šalina bez zastávek! 🚋💨',
  'Betelná šňůra, kámo! 🔥',
  'Tak tohle je čistý Brno! 🏙️',
  'Z tebe bude king anglickýho štatlu. 👑',
  'Hattrick jak za Zbrojovku! ⚽',
  'Prygl by se z tebe zvlnil. 🌊',
  'Gómeš to líp než rodilí Angláni. 🇬🇧',
];

const TEXTS = {
  // Hero
  hero_h2:       { pro: '106 sloves a 24 skupin ve vzorcích. Pochopíš změnu → zvládneš celou skupinu.',
                   student: '106 sloves a 24 skupin ve vzorcích. Chytneš vzorec → máš celou skupinu.' },
  hero_h2_html:  { pro: '<span class="hero-facts">106 sloves a 24 skupin ve vzorcích.</span><span class="hero-slogan">Pochopíš změnu <span class="hero-arrow">→</span> zvládneš celou skupinu.</span>',
                   student: '<span class="hero-facts">106 sloves a 24 skupin ve vzorcích.</span><span class="hero-slogan">Chytneš vzorec <span class="hero-arrow">→</span> máš celou skupinu.</span>' },
  hero_lead:     { pro: '', student: '' },
  hero_foot:     { pro: '', student: '' },
  // Fáze 1 (study)
  s1_eyebrow:    { pro: 'Pohodová prohlídka', student: 'Mrk-mrk 👀' },
  s1_title:      { pro: 'Mrkni se na všechna slovesa ve skupině',
                   student: 'Mrk-mrk 👀 na všechna slovesa ve skupině' },
  s1_sub:        { pro: 'Žádné psaní zatím — jen se podívej, klikni na 🔊 a všimni si, jak se mění samohláska.',
                   student: 'Žádný stres, žádný psaní. Klikni si na 🔊 a poslechni, jak to zní.' },
  s1_intro_desc: { pro: 'V klidu si projdi všechna slovesa v této skupině.',
                   student: 'Žádný stres, jen koukáš. Klikni na 🔊 a poslouchej.' },
  s1_done_btn:   { pro: 'Hotovo, jdu psát ✍️ →', student: 'OK, jdu na to ✍️ →' },
  // Mezifáze
  mh_title:      { pro: 'Hold your horses! / Zadrž! ✋', student: 'Hold your horses! / Zadrž! ✋' },
  mh_sub:        { pro: 'Která ti vypadají záludně? Označ je — věnujeme jim potom víc péče.',
                   student: 'Která vypadají, že tě potrápí? Cvakni je. Pak si na ně dáme bacha.' },
  mh_intro_desc: { pro: 'Označ slovesa, u kterých si myslíš, že ti budou dělat největší problém.',
                   student: 'Která ti vypadají záludně? Označ je. Pak si na ně dáme bacha.' },
  mh_done_btn:   { pro: 'Hotovo, jdu na to →', student: 'Hotovo, jedem dál →' },
  // Fáze 2 — combined pass (1) + finále (2)
  s2_intro_title:{ pro: 'Fáze 2 — Psaní tvarů', student: 'Fáze 2 — Píšeme to ✍️' },
  s2_intro_desc: { pro: 'Vidíš česky, píšeš 3 anglické tvary, potvrdíš Enterem. Když se chyba objeví, sloveso se vrátí na konec fronty a počkáš si na něj. Jdeme na to.',
                   student: 'Češtinu vidíš, anglicky píšeš 3 tvary. Enter po každym poli. Když ti něco uteče, počkáme si na něj a dáme to znovu. Boom. 💥' },
  s2_finale_title:{ pro: 'Zamícháno', student: 'Zamícháno 🔀' },
  s2_finale_desc:{ pro: 'Všechna slovesa zamíchaně. Napíšeš všechny 3 tvary najednou, výsledek uvidíš po Enteru — a 1× bez chyby stačí, aby sloveso vypadlo z fronty.',
                   student: 'Náhodně, všechno najednou. Napíšeš 3 tvary, mrkneš na výsledek a jedem dál. 1× bez chyby = hotovo. 🔀' },
  tip_atomic:    { pro: '<kbd>Enter</kbd> = další pole, vyhodnotí se na konci',
                   student: '<kbd>Enter</kbd> = další pole. Vyhodnocení až na konci.' },
  tip_field:     { pro: 'Po každém tvaru zmáčkni <kbd>Enter</kbd>',
                   student: 'Po každym tvaru <kbd>Enter</kbd>' },
  giveup_btn:    { pro: 'Nevím 😭', student: 'Vzdávám 🏳️' },
  giveup_confirm:{ pro: 'Vážně? Klikni znovu 😭', student: 'Fakt? Klikni ještě jednou 😭' },
  // Feedback — combined pass (random pick from phrase pools above)
  fb_pass_ok:     { pro: POS_PRO, student: POS_STUDENT, hantec: POS_HANTEC },
  fb_pass_redo_ok:{ pro: POS_PRO, student: POS_STUDENT, hantec: POS_HANTEC },
  fb_pass_wrong:  { pro: NEG_PRO, student: NEG_STUDENT, hantec: NEG_HANTEC },
  // Feedback — finále
  fb_finale_ok:   { pro: POS_PRO, student: POS_STUDENT, hantec: POS_HANTEC },
  fb_finale_wrong:{ pro: NEG_PRO, student: NEG_STUDENT, hantec: NEG_HANTEC },
  // Streak — 3+ correct in a row (student only; pro reuses positive pool)
  fb_streak:      { pro: STREAK_PRO, student: STREAK_STUDENT, hantec: STREAK_HANTEC },
  // Results
  results_h2:    { pro: 'Hotovo! 🎉', student: 'Hotovo, válíš! 🎉' },
  stat_green:    { pro: 'zvládnuto', student: 'v kapse' },
  stat_yellow:   { pro: 'rozjeté', student: 'na hraně' },
  stat_red:      { pro: 'ještě bojuje', student: 'boj o život' },
  res_again:     { pro: 'Procvičit jen ta zlobivá',
                   student: 'Ještě jednou jen ty problematický' },
  res_again_all: { pro: 'Procvičit znovu', student: 'Dát si to ještě jednou' },
  res_new:       { pro: 'Nová lekce', student: 'Nová skupina' },
  res_back_all:  { pro: 'Zpět na všechny skupiny', student: 'Zpět na skupiny' },
  // Section chip
  chip_default:  { pro: 'Zamíchaně 🎲', student: 'Náhodný mix 🎲' },
  chip_mastered: { pro: 'Velký test 🏆', student: 'Final boss 🏆' },
  // Group modal
  gsm_title:     { pro: 'Jak budeš procvičovat?', student: 'Jak na to půjdeš?' },
  gsm_sub:       { pro: 'Tuhle skupinu už znáš — vyber si režim.',
                   student: 'Tuhle skupinu už znáš. Co dneska?' },
  gsm_all:       { pro: 'Všechna slovesa', student: 'Všechno' },
  gsm_problem:   { pro: 'Jen ta zlobivá', student: 'Jen ta, co zlobí' },
  // Section review modal (variant)
  // Streak reward modal (separate from srm_*, which is the section-review-mix modal)
  streak_title_h:   { pro: 'Den vyplácení bonusů — vyber si', student: 'Tvoje odměna — vyber si!' },
  streak_sub_h:     {
    pro: (days) => `${days}denní streak ti vynesl novou skupinu sloves. Vyber si, kterou. Bude tvá natrvalo.`,
    student: (days) => `Máš za sebou ${days} dní v řadě. 🔥 Tahle skupinka je tvoje napořád, i kdyby ses později zasekl/a.`,
  },
  streak_foot_h:    { pro: 'Tip: vybranou skupinu si můžeš procvičovat hned po výběru.',
                      student: 'Ber si tu, na kterou se nejvíc těšíš. 🎒' },
  // Streak pill label — inline smart text on the existing label row.
  // Desktop carries the full hint; mobile gets a shorter version of the same idea.
  streak_label_zero:    {
    pro:     '<span class="streak-lbl-d">🎁 ještě 3 dny v řadě = nová skupina zdarma</span><span class="streak-lbl-m">ještě 3 dny = nová skupina</span>',
    student: '<span class="streak-lbl-d">🎁 ještě 3 dny v řadě = nová skupina zdarma</span><span class="streak-lbl-m">ještě 3 dny = nová skupina</span>',
  },
  streak_label_pending: { pro: '🎁 nečerpaná odměna — vyber si',
                          student: '🎁 odměna čeká! vyber si ✨' },
  // Grace period: today missing, but yesterday studied — streak is still
  // visible but at risk of breaking at midnight.
  streak_label_grace:   {
    pro:     '<span class="streak-lbl-d">⏳ dodělej dnes, jinak streak končí</span><span class="streak-lbl-m">⏳ dodělej dnes</span>',
    student: '<span class="streak-lbl-d">⏳ rychle dnes, ať to neztratíš!</span><span class="streak-lbl-m">⏳ rychle dnes!</span>',
  },
  streak_label_maxed:   {
    pro:     '👑 vše zvládnuto',
    student: '👑 vše! 🐉',
  },
  streak_label_progress: {
    pro:     (n, nWord, r, rWord) => `🎁 ještě ${r} ${rWord} = nová skupina`,
    student: (n, nWord, r, rWord) => `🎁 ještě ${r} ${rWord} = nová skupina!`,
  },
  streak_label_premium: { pro: '🔥 jen tak dál', student: '🔥 frčíš!' },

  srm_title:     { pro: 'Zamíchané procvičení', student: 'Velký random 🎲' },
  srm_sub_some:  { pro: 'Zamíchaná procházka napříč celou sekcí. Vyber si rozsah.',
                   student: 'Náhodně přes celou sekci. Co dnes?' },
  srm_sub_clean: { pro: 'Celou sekci máš zelenou — žádná problematická slovesa. Klidně si všechna projdi znovu pro jistotu.',
                   student: 'Celá sekce v kapse! Žádný problémové, můžeš si všechno dát ještě jednou pro frajeřinu.' },
  // Paywall
  pw_title:      { pro: 'Odemkni všechna slovesa 🔓', student: 'Odemkni všechno 🔓' },
  pw_sub:        { pro: 'Zdarma máš 3 skupiny (15 sloves). Premium ti otevře všech <strong>106 sloves</strong> ve 24 skupinách a <strong>🚗 Car mode</strong> pro procvičování v autě.',
                   student: 'Zdarma máš 3 skupiny (15 sloves). Premium ti otevře všech <strong>106 sloves</strong> ve 24 skupinách + <strong>🚗 Car mode</strong> na cesty autem.' },
  pw_plan1_note: { pro: 'jednorázově, bez obnovování', student: 'jednorázově, klid navždy' },
  pw_plan2_note: { pro: '7 dní zdarma · pak 49 Kč/měs · kdykoli zrušíš',
                   student: '7 dní zdarma · pak 49 Kč/měs · kdykoli stopneš' },
  pw_plan_yearly_note: { pro: '7 dní zdarma · pak 249 Kč/rok · ušetříš 57 %',
                         student: '7 dní zdarma · pak 249 Kč/rok · ušetříš víc než půlku 🔥' },
  // Toasts
  toast_resume:  { pro: 'Pokračujeme tam, kde jsi skončil(a). 👍',
                   student: 'Jedem od místa, kde jsi přestal. 👍' },
  toast_pay_ok:  { pro: '🎉 Hotovo! Premium se aktivuje během pár vteřin. (Pokud máš 7-day trial, první platba ti přijde až po týdnu.)',
                   student: '🎉 Hotovo! Premium se chytne za pár vteřin. Trial běží 7 dní, pak se začne strhávat.' },
  toast_pay_cancel:{ pro: 'Platba zrušená. Můžeš se k ní kdykoli vrátit.',
                     student: 'Platba zrušená. Žádný stres — můžeš se vrátit kdykoli.' },
  toast_no_problem:{ pro: '🎉 Žádná problematická slovesa — celou skupinu máš zvládnutou.',
                     student: '🎉 Žádný problémové — máš to celý zelený.' },
  toast_login_fail:{ pro: (e) => 'Přihlášení se nezdařilo — ' + e,
                     student: (e) => 'Něco se kouslo — ' + e },
  // Menu
  menu_lesson:   { pro: '🎓 Lekce', student: '🎓 Lekce' },
  menu_browse:   { pro: '📚 Seznam sloves', student: '📚 Seznam sloves' },
  menu_fc:       { pro: '🃏 Flashcards', student: '🃏 Karty' },
  menu_quiz:     { pro: '✅ Volný kvíz', student: '✅ Rychlokvíz' },

  // --- i18n: texty dříve zapsané natvrdo v kódu -----------------------------
  // Prostý řetězec = stejný pro všechny styly. Funkce = parametrizovaný text.
  // Jazykové mutace tyhle klíče přepisují přes window.LANG_PACK (docs/i18n.md).
  wv_copied: '✓ Zkopírováno',
  wv_copy: 'Zkopírovat odkaz',
  wv_copy_fail: '✗ Nepodařilo se',
  trophy_3: '3 dny v řadě',
  trophy_7: '7 dní — týden v kuse',
  trophy_14: '14 dní — dva týdny',
  trophy_30: '30 dní — měsíc',
  trophy_100: '100 dní — stovka',
  trophy_365: '365 dní — rok',
  style_names: () => ({ pro: 'Styl: 💼 Korporátní slang', student: 'Styl: 🎒 Školní prostředí', hantec: 'Styl: 🚋 Brněnský hantec' }),
  tts_missing: '🔊 Nemáš nainstalovaný anglický hlas — slovesa se proto čtou „česky". ',
  tts_android: 'Android: Nastavení → Jazyk → Text-to-speech → Google → Stáhnout English.',
  tts_ios: 'iOS: Nastavení → Obecné → Jazyk a oblast → přidat English.',
  tts_windows: 'Windows: Nastavení → Čas a jazyk → Jazyk → Přidat English.',
  tts_other: 'Nainstaluj si anglický TTS hlas v systému.',
  plur_verbs: (n) => (n === 1 ? 'sloveso' : (n >= 2 && n <= 4 ? 'slovesa' : 'sloves')),
  plur_groups: (n) => (n === 1 ? 'skupina' : (n >= 2 && n <= 4 ? 'skupiny' : 'skupin')),
  plur_days_row: (n) => (n === 1 ? 'den v řadě' : (n >= 2 && n <= 4 ? 'dny v řadě' : 'dní v řadě')),
  plur_day: (n) => (n === 1 ? 'den' : (n >= 2 && n <= 4 ? 'dny' : 'dní')),
  chip_title_mastered: (n) => `Souhrnný test celé sekce — všech ${n} sloves, zamíchaně`,
  chip_title_default: (n) => `Zamíchaná procházka přes všech ${n} sloves této sekce`,
  medal_all: 'Všechna slovesa zvládnuta!',
  medal_weak: 'Skoro! Jedno sloveso ti uklouzlo — oprav ho a medaile je zpět.',
  lock_premium: 'Pouze pro Premium',
  bonus_free_toast: '🎁 Tahle skupina je pro tebe odemčená zdarma!',
  sec_review_pattern: (n) => `Souhrnný test · ${n} ${t('plur_verbs', n)}`,
  sec_review_label: 'Souhrnný test',
  sec_review_title: 'Souhrnný test sekce',
  sec_review_desc: (n) => `Všech ${n} sloves z této sekce v náhodném pořadí. Napíšeš všechny tři tvary, stiskneš Enter — a 1× bez chyby stačí, aby sloveso vypadlo z fronty. Jdeme na to!`,
  resume_stage1: 'Fáze 1 · Seznámení',
  resume_stage15: 'Mezifáze · Označ obtížná',
  resume_stage2: 'Fáze 2 · Psaní',
  resume_stage_generic: 'rozdělané cvičení',
  resume_step1: 'v pořadí',
  resume_step2: 'zamícháno',
  resume_filtered: (n) => ` · jen problematická (${n})`,
  resume_dismiss_aria: 'Zavřít hlášku — zapomenout rozdělané cvičení',
  resume_dismiss_title: 'Zavřít — rozdělané cvičení zapomeneme',
  resume_title: 'Máš rozdělané cvičení',
  resume_continue: 'Pokračovat',
  resume_restart: 'Začít znovu',
  s1_intro_title: 'Fáze 1 — Seznámení',
  form_inf: 'infinitiv',
  form_past: 'past',
  form_past_full: 'past simple',
  form_pp: 'past participle',
  speak_all_title: 'Přehrát všechny tvary',
  speak_title: 'Přehrát',
  step_pill_1: '1) studium',
  step_pill_2: '2) v pořadí',
  step_pill_3: '3) zamícháno',
  remaining_of: (n, total) => `zbývá ${n} z ${total}`,
  remaining: (n) => `zbývá ${n}`,
  audio_title_on: 'Audio po odpovědi je ZAPNUTO — klikni pro vypnutí',
  audio_title_off: 'Audio po odpovědi je VYPNUTO — klikni pro zapnutí',
  check_btn: 'Zkontrolovat',
  next_btn: 'Další →',
  pick_btn: 'Vybrat',
  reset_confirm_cloud: 'Opravdu chceš vynulovat veškerý pokrok? Smaže se i v cloudu (Google účet).\n\nTuto akci nelze vrátit zpět.',
  reset_confirm: 'Opravdu chceš vynulovat veškerý pokrok?\n\nTuto akci nelze vrátit zpět.',
  generic_fail: 'Něco se nepovedlo. Zkus to znovu.',
  start_today: 'začni dnes',
  stats_mastered_verbs: 'slovesa',
  stats_in_progress: (n) => ` · ${n} v procesu`,
  stats_trophies_aria: 'Získané trofeje',
  streak_pill_aria: 'Streak — jak to funguje',
  stats_mastered_groups: 'skupin',
  // Popisky po kliknutí na dlaždici statistiky (toast)
  stat_verbs_info: (m, total, inp) =>
    inp
      ? `${m}/${total} sloves ovládáš dokonale! (${inp} máš rozpracovaných)`
      : `${m}/${total} sloves ovládáš dokonale!`,
  stat_groups_info: (m, total) =>
    m ? `${m}/${total} skupin máš celých zvládnutých!`
      : `Zvládni celou skupinu a přibude ti sem. Celkem jich je ${total}.`,
  stat_verbs_aria: 'Zvládnutá slovesa — co to znamená',
  stat_groups_aria: 'Zvládnuté skupiny — co to znamená',
  next_weak_batch: 'Další porce slabin →',
  slaba_icon: { pro: '🎯', student: '👾', hantec: '🛠️' },
  slaba_tile_title: { pro: 'Dnešní cílovka', student: 'Boss mode', hantec: 'Betelná šichta' },
  slaba_sub_mixed: {
    pro:     (w, r) => `${w} ${czAdj(w, 'problémov')} + ${r} ${czAdj(r, 'náhodn')}`,
    student: (w, r) => `${w} ${czAdj(w, 'failnut')} + ${r} random`,
    hantec:  (w, r) => `${w} ${czAdj(w, 'zvoran')} + ${r} z fleku`,
  },
  slaba_sub_clean: {
    pro:     (n) => `${n} ${czAdj(n, 'náhodn')} · retention check`,
    student: (n) => `${n} random · spot check`,
    hantec:  (n) => `${n} z fleku · prubnem to`,
  },
  try_title: { pro: 'Začni procvičovat', student: 'Pojď to zkusit!', hantec: 'Pojď to zkusit!' },
  try_sub: { pro: 'Začni první skupinou — stačí kliknout', student: 'První skupina tě navede, jen klikni', hantec: 'První skupina tě navede, jen klikni' },
  slaba_cold: 'Zatím není dost dat — udělej pár lekcí a vrať se. 🌱',
  slaba_title: 'Slabá místa',
  slaba_pattern: (n) => `Dnešní porce slabin · ${n} ${t('plur_verbs', n)}`,
  premium_badge: 'Premium',
  practice_cta: 'Procvič si to!',
  flash_hint: 'klikni pro otočení',
  auto_pick_group: 'Vyber alespoň jednu skupinu sloves.',
  auto_no_problem: 'Žádná problematická slovesa — všechno máš zvládnuté! 🎉',
  auto_empty: 'Vybrané skupiny neobsahují žádná slovesa.',
  auto_exit_btn: '⏏️ Exit',
  auto_exit_aria: 'Ukončit audio jízdu',
  auto_stop_btn: '⏸ Stop',
  auto_stop_aria: 'Pozastavit audio jízdu',
  auto_shuffled: '🔀 Zamícháno — začínáme 3 kola znovu.',
  auto_done: '🎉 Hotovo! 3 kola dokončena.',
  auto_round_toast: (r, total) => `Kolo ${r} / ${total} 🚀`,
  auto_progress: (r, total, i, n) => `Kolo ${r}/${total} · ${i}/${n}`,
  auto_zero_groups: '0 skupin',
  auto_selection: (g, v) => `${g} ${t('plur_groups', g)} · ${v} ${t('plur_verbs', v)}`,
  quiz_all_chip: 'Vše',
  quiz_pick_correct: (label) => `Vyber správný tvar (${label})`,
  quiz_fill_hint: (cs) => `Doplň past simple a past participle · <em>${cs}</em>`,
  quiz_cs3_hint: 'Doplň všechny tři tvary anglicky',
  quiz_correct_is: 'Správně:',
  theme_light: 'Světlý režim',
  theme_dark: 'Tmavý režim',
  sounds_on: 'Zvuky odpovědí: zapnuté',
  sounds_off: 'Zvuky odpovědí: vypnuté',
  backend_unavailable: 'Backend není dostupný.',
  login_first: 'Nejdřív se přihlas přes Google.',
  opening: 'Otevírám…',
  portal_no_customer: 'Předplatné nemáš přes Stripe (např. promo kód). Není co spravovat.',
  portal_error: 'Chyba při otevírání portálu: ',
  account_word: 'účet',
  sign_out_label: (name) => `Odhlásit (${name})`,
  sign_in_google: 'Přihlásit se přes Google',
  signed_in_aria: (name) => `Přihlášen jako ${name}. Kliknutím odhlásit.`,
  signed_in_title: (name) => `Přihlášen: ${name} — klikni pro odhlášení`,
  sign_in_short: 'Přihlásit',
  signing_in: 'Přihlašuji…',
  login_failed: 'Přihlášení selhalo: ',
  promo_errors: () => ({
    not_found: 'Tento kód neznáme. Zkontroluj překlepy.',
    inactive: 'Kód je deaktivovaný.',
    expired: 'Kód už vypršel.',
    exhausted: 'Kód byl vyčerpán — všechna místa obsazená.',
    already_redeemed: 'Tento kód už jsi jednou uplatnil(a).',
    invalid_code_format: 'Kód má špatný formát.',
    no_user: 'Nejdřív se prosím přihlas přes Google.',
    no_backend: 'Backend není dostupný. Zkus to později.',
    network: 'Síťová chyba. Zkus to za chvíli.',
  }),
  promo_enter: 'Zadej kód.',
  promo_checking: 'Ověřuji…',
  promo_error_prefix: 'Chyba: ',
  promo_ok_msg: 'Kód uplatněn! 🎉 Premium je tvoje.',
  promo_ok_toast: '🎉 Kód uplatněn — všechny skupiny jsou tvoje!',
  loading: 'Načítám…',
  backend_wait: 'Backend zatím není dostupný. Zkus to prosím za chvíli.',
  checkout_error: 'Chyba při zahájení platby: ',
  sync_titles: () => ({
    idle: 'cloud sync vypnutý',
    'signing-in': 'přihlašování…',
    syncing: 'synchronizace…',
    synced: 'synchronizováno',
    error: 'chyba synchronizace',
  }),
  signout_confirm: 'Opravdu se chceš odhlásit?',
  dialect_ame: 'Varianta: americká (AmE)',
  dialect_bre: 'Varianta: britská (BrE)',

  // --- Teacher mode (generátor testů) ---
  teacher_pick_all: 'vybrat vše',
  teacher_pick_none: 'zrušit',
  teacher_selected: (n, g) =>
    `Vybráno: ${n} ${n === 1 ? 'sloveso' : n >= 2 && n <= 4 ? 'slovesa' : 'sloves'} · ${g} ${g === 1 ? 'skupina' : g >= 2 && g <= 4 ? 'skupiny' : 'skupin'}`,
  teacher_none_selected: 'Vyber aspoň jednu skupinu sloves.',
  teacher_test_title: 'Nepravidelná slovesa — test',
  teacher_key_title: 'Nepravidelná slovesa — klíč pro učitele',
  teacher_variant: (v) => `Varianta ${v}`,
  teacher_name: 'Jméno:',
  teacher_class: 'Třída:',
  teacher_date: 'Datum:',
  teacher_score: 'Body:',
  teacher_grade: 'Známka:',
  teacher_col_num: '№',
  teacher_col_inf: 'Infinitiv',
  teacher_col_past: 'Past simple',
  teacher_col_pp: 'Past participle',
  teacher_col_cs: 'Česky',
  teacher_instr_inf2: 'Doplň minulý čas (past simple) a příčestí minulé (past participle).',
  teacher_instr_cs3: 'Doplň všechny tři tvary slovesa podle českého překladu.',
  teacher_instr_missing: 'Doplň chybějící tvar v každém řádku.',
  teacher_instr_choice: 'Zakroužkuj správnou dvojici tvarů (past simple – past participle).',
  teacher_groups_label: 'Skupiny: ',
  teacher_groups_mix: (g) => `mix z ${g} skupin`,
  teacher_domain: 'ucseslovesa.cz',
  teacher_footer: 'ucseslovesa.cz — appka, se kterou se tvoje třída naučí nepravidelná slovesa',
  teacher_key_correct: 'Správné odpovědi (u sloves s více tvary platí kterýkoli uvedený):',

  // --- Digitální test (sdílený odkaz + kód o odevzdání) ---
  dt_copied: 'Odkaz zkopírován 📋',
  dt_copy_fail: 'Kopírování se nepovedlo — označ odkaz a zkopíruj ručně.',
  dt_premium_blocked: 'Vybrané skupiny jsou nad rámec bezplatné verze — odemkni Premium, nebo vyber jen skupiny zdarma.',

  dt_intro_sub: (n) => `${n} ${n === 1 ? 'otázka' : n >= 2 && n <= 4 ? 'otázky' : 'otázek'} · po dokončení dostaneš kód pro učitele`,
  dt_name_missing: 'Vyplň prosím jméno, ať tě učitel pozná.',
  dt_attempt_note: (n) => (n > 1 ? `Tohle je tvůj ${n}. pokus — v kódu to učitel uvidí.` : ''),

  dt_code_attempt: (n) => `${n}. pokus`,
  dt_code_copied: 'Kód zkopírován 📋',
  dt_bad_link: 'Odkaz na test je poškozený nebo už neplatí. Popros učitele o nový.',

  dt_verify_col_name: 'Jméno',
  dt_verify_col_score: 'Skóre',
  dt_verify_col_attempt: 'Pokus',
  dt_verify_col_state: 'Stav',
  dt_verify_col_wrong: 'Chybné odpovědi',
  dt_verify_no_mistakes: 'bez chyby',
  dt_verify_ok: '✅ platný',
  dt_verify_bad: '❌ nesedí',
  dt_verify_verified: 'jméno z účtu Google',
  dt_verify_empty: 'Vlož aspoň jeden kód.',
  dt_verify_no_test: 'Nejdřív vytvoř odkaz na test — kódy se ověřují proti němu.',
  dt_verify_summary: (ok, total) => `Platných ${ok} z ${total}`,
};

// Česká koncovka přídavného jména pro počítaná "slovesa" (stř. rod mn. č.):
// 1 → -é, 2–4 → -á, 0 / 5+ → -ých. Jazykové mutace dodají v packu vlastní
// verze textů, které tuhle češtinu nepotřebují.
function czAdj(n, stem) {
  if (n === 1) return stem + 'é';
  if (n >= 2 && n <= 4) return stem + 'á';
  return stem + 'ých';
}

// Plausible custom event helper — safe to call even if script blocked / not loaded
function track(eventName, props) {
  try {
    if (typeof window.plausible === 'function') {
      window.plausible(eventName, props ? { props } : undefined);
    }
  } catch {}
}

// Vrátí definici textu pro klíč — jazyková mutace (window.LANG_PACK.texts) má
// přednost před českým zdrojem v TEXTS. Hodnota v packu smí být prostý řetězec,
// funkce, pole (pool) i objekt se stylovými variantami jako v TEXTS.
function resolveTextEntry(key) {
  const pack = window.LANG_PACK;
  if (pack && pack.texts && key in pack.texts) return pack.texts[key];
  return TEXTS[key];
}

function t(key, ...args) {
  const entry = resolveTextEntry(key);
  if (entry === undefined || entry === null) return key;
  // Objekt (a ne pole) = stylové varianty { pro, student, hantec }.
  // Cokoli jiného (řetězec, funkce, pole) se použije pro všechny styly.
  let v = (typeof entry === 'object' && !Array.isArray(entry))
    ? (entry[state.style] ?? entry.pro)
    : entry;
  if (typeof v === 'function') return v(...args);
  if (Array.isArray(v)) {
    // Phrase pool — pick random. Filter out {name}-templated lines if no signed-in user.
    const firstName = (state.user && state.user.displayName)
      ? state.user.displayName.split(' ')[0]
      : null;
    const usable = firstName ? v : v.filter((s) => !/\{name\}/.test(s));
    const pool = usable.length ? usable : v;
    let picked = pool[Math.floor(Math.random() * pool.length)];
    if (firstName) picked = picked.replace(/\{name\}/g, firstName);
    return picked;
  }
  return v;
}

// First-login tone picker modal
function openToneModal() {
  const modal = document.getElementById('tone-modal');
  if (!modal) return;
  const btnPro = document.getElementById('tone-pick-pro');
  const btnStudent = document.getElementById('tone-pick-student');
  const btnHantec = document.getElementById('tone-pick-hantec');
  if (!btnPro || !btnStudent) return;
  const pick = (chosen) => {
    state.style = chosen;
    localStorage.setItem('style', chosen);
    localStorage.setItem('styleAsked', 'true');
    $$('.menu-style-btn').forEach((b) => b.classList.toggle('active', b.dataset.style === state.style));
    applyStyleTexts();
    try { cloud.pushSoon && cloud.pushSoon(); } catch (_) {}
    try { track('style_picked', { style: chosen }); } catch (_) {}
    closeToneModal();
    const styleLabels = t('style_names');
    toast(styleLabels[chosen] || styleLabels.pro, 'success', 2200);
  };
  btnPro.onclick = () => pick('pro');
  btnStudent.onclick = () => pick('student');
  if (btnHantec) btnHantec.onclick = () => pick('hantec');
  modal.classList.remove('hidden');
  requestAnimationFrame(() => modal.classList.add('visible'));
}
function closeToneModal() {
  const modal = document.getElementById('tone-modal');
  if (!modal) return;
  modal.classList.remove('visible');
  setTimeout(() => modal.classList.add('hidden'), 200);
}

function applyStyleTexts() {
  // Update all static elements tagged with data-tone="<key>"
  document.querySelectorAll('[data-tone]').forEach((el) => {
    el.textContent = t(el.dataset.tone);
  });
  document.querySelectorAll('[data-tone-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.toneHtml);
  });
  // Re-render dynamic views that might be currently visible
  if (state.data) {
    if (state.currentView === 'lesson' && !state.lesson) renderLessonPicker();
  }
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// ---------- Utilities ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickForm(verb, which, dialect) {
  if (dialect === 'AmE') {
    if (which === 'past' && verb.pastAm) return verb.pastAm;
    if (which === 'pp' && verb.ppAm) return verb.ppAm;
  }
  return verb[which];
}

// Normalize the student's input so common slips don't get penalized:
//   - leading/trailing whitespace
//   - leading/trailing punctuation (!? . , ; :)
//   - any letter case
//   - multiple/inconsistent internal whitespace
function normalizeAnswerInput(s) {
  return String(s || '')
    .trim()
    .replace(/^[\s.,;:!?'"()-]+|[\s.,;:!?'"()-]+$/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// Break student's input into individual verb-form tokens, treating any of these
// as separators between forms: whitespace, comma, semicolon, slash, ampersand, "and"
function tokensFromAnswer(s, { stripInfinitiveTo = false } = {}) {
  let norm = normalizeAnswerInput(s);
  // Optionally drop leading "to " — only valid for infinitive forms ("to begin" → "begin")
  if (stripInfinitiveTo) norm = norm.replace(/^to\s+/, '');
  return norm.split(/[\s,;/&]+|\band\b/).filter(Boolean);
}

// Build the set of "acceptable form strings" for a given slot (inf/past/pp).
// Each may itself contain "/" meaning a verb has multiple required forms
// (e.g. be: past = "was/were" — student should write both).
function acceptableFormsFor(verb, which, dialect) {
  const forms = [];
  if (which === 'inf') {
    forms.push(verb.inf);
    return forms;
  }
  forms.push(pickForm(verb, which, dialect));
  [verb.past, verb.pastAm, verb.pastAlt, verb.pp, verb.ppAm, verb.ppAlt]
    .filter(Boolean)
    .forEach((f) => {
      if (which === 'past' && (f === verb.past || f === verb.pastAm || f === verb.pastAlt)) forms.push(f);
      if (which === 'pp' && (f === verb.pp || f === verb.ppAm || f === verb.ppAlt)) forms.push(f);
    });
  return forms;
}

// True when the student's typed answer matches one of the acceptable forms.
// Multi-token forms (like "was/were"): student must include ALL tokens, but the
// order and separators are free — "was/were", "were/was", "was, were",
// "was were", "were,was", "was; were" all match.
function isAnswerCorrect(input, verb, which, dialect) {
  const inputTokens = tokensFromAnswer(input, { stripInfinitiveTo: which === 'inf' });
  if (inputTokens.length === 0) return false;
  const forms = acceptableFormsFor(verb, which, dialect);
  for (const form of forms) {
    const expected = form.split('/').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (inputTokens.length !== expected.length) continue;
    const a = [...inputTokens].sort();
    const b = [...expected].sort();
    if (a.every((t, i) => t === b[i])) return true;
  }
  return false;
}

// Back-compat shim: some legacy spots still call allAcceptableForms().has(value).
// Keep it returning a Set of the simple (single-token) acceptable forms so
// callers that only check single-form correctness still work.
function allAcceptableForms(verb, which, dialect) {
  const set = new Set();
  acceptableFormsFor(verb, which, dialect).forEach((f) => {
    f.split('/').forEach((x) => set.add(x.trim().toLowerCase()));
  });
  return set;
}

function flattenVerbs(data, onlySections = null) {
  const out = [];
  data.sections.forEach((sec) => {
    sec.subsections.forEach((sub) => {
      if (onlySections && onlySections.size > 0 && !onlySections.has(sub.id)) return;
      sub.verbs.forEach((v) =>
        out.push({ ...v, subId: sub.id, subRule: sub.rule, subPattern: sub.pattern, mainTitle: sec.title })
      );
    });
  });
  return out;
}

// Phonetic overrides for homographs whose past/pp spelling matches the
// infinitive but pronounces differently. TTS reads literal letters, so we
// substitute a phonetic spelling for the audio only. UI text is unchanged.
//   read /riːd/  → past/pp /rɛd/  → spell as "red"
const PHON_PAST_PP = { read: 'red' };
function phon(word) {
  if (!word) return word;
  const key = String(word).toLowerCase().trim();
  return PHON_PAST_PP[key] || word;
}

// ---------- TTS voice selection ----------
// Some platforms (older Android without Google English TTS data, Windows
// without an English language pack, occasionally Firefox) ignore `utter.lang`
// and use the system default voice, which for Czech users means English text
// gets read with Czech phonetics ("written" → [vrɪtːɛn]). Mitigation: pick an
// explicit English voice from getVoices() when one is available, and warn the
// user once when no English voice exists at all.
function _allVoices() {
  if (!('speechSynthesis' in window)) return [];
  try { return window.speechSynthesis.getVoices() || []; } catch (_) { return []; }
}

function pickEnglishVoice(lang) {
  const voices = _allVoices();
  if (!voices.length) return null;
  const wanted = (lang || 'en-GB').toLowerCase();
  // 1) Exact match
  let v = voices.find((vv) => (vv.lang || '').toLowerCase() === wanted);
  if (v) return v;
  // 2) Same region prefix (en-us vs en-US-variant)
  const region = wanted.split('-')[1];
  if (region) {
    v = voices.find((vv) => (vv.lang || '').toLowerCase().startsWith('en-' + region));
    if (v) return v;
  }
  // 3) Any English voice — prefer non-novelty (no "Bells", "Trinoids" etc.) by
  //    sorting localService voices first (those are the OS-quality ones).
  const enVoices = voices.filter((vv) => (vv.lang || '').toLowerCase().startsWith('en'));
  if (enVoices.length === 0) return null;
  enVoices.sort((a, b) => (b.localService ? 1 : 0) - (a.localService ? 1 : 0));
  return enVoices[0];
}

let _noEnVoiceWarned = false;
function _checkEnglishVoiceAvailable() {
  if (_noEnVoiceWarned) return;
  if (localStorage.getItem('noEnVoiceWarned') === 'true') { _noEnVoiceWarned = true; return; }
  const voices = _allVoices();
  if (!voices.length) return; // not loaded yet — try again later
  const hasEn = voices.some((v) => (v.lang || '').toLowerCase().startsWith('en'));
  if (hasEn) { _noEnVoiceWarned = true; return; }
  const ua = navigator.userAgent || '';
  let hint = t('tts_missing');
  if (/Android/i.test(ua)) hint += t('tts_android');
  else if (/iPad|iPhone|iPod/.test(ua)) hint += t('tts_ios');
  else if (/Windows/i.test(ua)) hint += t('tts_windows');
  else hint += t('tts_other');
  if (typeof toast === 'function') toast(hint, 'info', 9000);
  else console.warn('[tts]', hint);
  localStorage.setItem('noEnVoiceWarned', 'true');
  _noEnVoiceWarned = true;
}

// getVoices() is async on Chromium — fires 'voiceschanged' once the list loads.
// Some Android WebViews never fire it, so also probe on a short timeout.
if ('speechSynthesis' in window) {
  try {
    window.speechSynthesis.addEventListener('voiceschanged', () => _checkEnglishVoiceAvailable());
  } catch (_) {}
  setTimeout(() => _checkEnglishVoiceAvailable(), 1500);
  setTimeout(() => _checkEnglishVoiceAvailable(), 4000);
}

function speak(text, dialect) {
  if (!('speechSynthesis' in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = dialect === 'AmE' ? 'en-US' : 'en-GB';
  const v = pickEnglishVoice(utter.lang);
  if (v) utter.voice = v;
  utter.rate = 0.9;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

// ============================================================
// UI cue sounds (Web Audio API — no external assets).
// - 'correct' → glass-chime triad (sound #5 from sounds-preview.html)
// - 'wrong'   → soft pop bubble    (sound #6)
// - 'streak'  → gentle C-major chord (sound #7) — plays on 3+ correct in a row
// Sounds are subtle (low gain, short) and respect state.soundEffects.
// ============================================================
let _audioCtx = null;
function getAudioCtx() {
  if (_audioCtx) return _audioCtx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    _audioCtx = new AC();
    return _audioCtx;
  } catch (_) {
    return null;
  }
}

function playUiSound(kind) {
  if (!state.soundEffects) return;
  const ctx = getAudioCtx();
  if (!ctx) return;

  const schedule = () => {
    const t0 = ctx.currentTime;
    const playTone = (freq, peak, dur, attack = 0.005) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    };

    if (kind === 'correct') {
      playTone(1760, 0.22, 0.55);
      playTone(3520, 0.08, 0.55);
      playTone(5000, 0.04, 0.55);
    } else if (kind === 'wrong') {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(200, t0);
      o.frequency.exponentialRampToValueAtTime(600, t0 + 0.06);
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.22, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
      o.start(t0);
      o.stop(t0 + 0.1);
    } else if (kind === 'streak') {
      [523.25, 659.25, 783.99].forEach((f) => playTone(f, 0.16, 0.25, 0.01));
    }
  };

  // Browsers (esp. Safari) keep the AudioContext suspended until a user gesture
  // resumes it. resume() is async — if we schedule oscillators before the
  // promise settles, they're silently dropped. Await the resume, then play.
  if (ctx.state === 'suspended') {
    const p = ctx.resume();
    if (p && typeof p.then === 'function') p.then(schedule, () => {});
    else schedule();
  } else {
    schedule();
  }
}

// One-time global audio unlock: ensure the AudioContext is created + resumed
// inside a real user gesture, so the first feedback sound actually plays.
// Subsequent playUiSound calls reuse the warmed context.
function _unlockAudio() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
}
window.addEventListener('pointerdown', _unlockAudio, { once: true, capture: true });
window.addEventListener('keydown', _unlockAudio, { once: true, capture: true });
window.addEventListener('touchstart', _unlockAudio, { once: true, capture: true });

// Highlight the segment of `word` between indices [start, end). When called with
// the legacy Set-based vowelSet (back-compat), fall back to highlighting the
// first vowel char — but all production call sites now pass a [start, end) range
// produced by inferVowels(), which marks the actually changing region across
// the three forms (inf / past / pp).
function highlightVowel(word, range) {
  if (!word) return '';
  if (Array.isArray(range)) {
    // Empty array → no highlight at all (explicit override)
    if (range.length === 0) return word;
    // Multi-range form: [[s,e], [s,e], ...] — non-contiguous highlights
    if (Array.isArray(range[0])) {
      const sorted = range
        .filter((r) => Array.isArray(r) && r.length === 2 && r[0] != null && r[1] != null && r[0] < r[1] && r[0] >= 0 && r[1] <= word.length)
        .sort((a, b) => a[0] - b[0]);
      if (sorted.length === 0) return word;
      let out = '';
      let pos = 0;
      for (const [s, e] of sorted) {
        if (s < pos) continue; // skip overlap
        out += word.slice(pos, s) + `<span class="vowel">${word.slice(s, e)}</span>`;
        pos = e;
      }
      out += word.slice(pos);
      return out;
    }
    // Single range [s, e)
    const [s, e] = range;
    if (s == null || e == null || s >= e || s < 0 || e > word.length) return word;
    return word.slice(0, s) + `<span class="vowel">${word.slice(s, e)}</span>` + word.slice(e);
  }
  // Legacy fallback (Set of vowel chars) — highlight first matching vowel.
  if (range && typeof range.has === 'function') {
    const lower = word.toLowerCase();
    for (let i = 0; i < word.length; i++) {
      if (range.has(lower[i])) {
        return word.slice(0, i) + `<span class="vowel">${word[i]}</span>` + word.slice(i + 1);
      }
    }
  }
  return word;
}

// Compute the [start, end) range in each form (inf/past/pp) covering the
// segment that actually CHANGES across the three forms. Uses longest common
// prefix + suffix; whatever is left in the middle gets highlighted. For verbs
// where all three forms are identical (cut/cut/cut) nothing is highlighted.
// For wholly irregular verbs without any common edge (be/was-were/been,
// go/went/gone) the entire form is highlighted, which is the honest answer.
function diffRanges(forms) {
  const arr = forms.map((f) => String(f || ''));
  // All identical (case-insensitive) → no highlight
  const norm = arr.map((s) => s.toLowerCase());
  if (norm.every((s) => s === norm[0])) return arr.map(() => [0, 0]);
  // Common prefix across ALL forms
  let pre = 0;
  const minLen = Math.min(...arr.map((s) => s.length));
  while (pre < minLen && arr.every((s) => s[pre].toLowerCase() === arr[0][pre].toLowerCase())) pre++;
  // Common suffix (cannot overlap the prefix in any string)
  let suf = 0;
  while (
    arr.every((s) => s.length - suf > pre) &&
    arr.every((s) => s[s.length - 1 - suf].toLowerCase() === arr[0][arr[0].length - 1 - suf].toLowerCase())
  ) suf++;
  return arr.map((s) => [pre, s.length - suf]);
}

// Returns { infV, pastV, ppV } where each value is a [start, end) range used by
// highlightVowel(). Uses the dialect-resolved past/pp forms so AmE highlights
// line up with the actually displayed word (e.g. learn/learned/learned).
function inferVowels(verb, dialect) {
  const d = dialect || (state && state.dialect) || 'BrE';
  const inf = verb.inf || '';
  const past = pickForm(verb, 'past', d) || '';
  const pp = pickForm(verb, 'pp', d) || '';
  const [infR, pastR, ppR] = diffRanges([inf, past, pp]);
  // Per-verb override: verb.hl = { inf?: ranges, past?: ranges, pp?: ranges }
  // where `ranges` is either a single [s,e] or an array of [s,e] for non-contiguous
  // highlights, or [] to disable highlighting entirely for that form.
  const hl = verb && verb.hl;
  if (hl && typeof hl === 'object') {
    return {
      infV: hl.inf !== undefined ? hl.inf : infR,
      pastV: hl.past !== undefined ? hl.past : pastR,
      ppV: hl.pp !== undefined ? hl.pp : ppR,
    };
  }
  return { infV: infR, pastV: pastR, ppV: ppR };
}

// ---------- View switching ----------
function setView(view) {
  // Guard: a missing/unknown view used to wipe every .view and then throw on
  // null.classList.add, leaving the user on a blank page.
  const target = view ? document.getElementById(`view-${view}`) : null;
  if (!target) return;
  state.currentView = view;
  // Remember last view across reloads so refresh keeps the user where they were.
  try { localStorage.setItem('lastView', view); } catch (_) {}
  $$('.view').forEach((v) => v.classList.remove('active'));
  target.classList.add('active');
  // Switching top-level view ends any active practice session — otherwise the
  // mobile "hidden header" chrome could linger on a non-lesson view.
  document.body.classList.remove('practicing');
  // Odchod ze zadaného testu → kvíz se vrátí do běžného stavu (jinak by zůstala
  // schovaná nastavovací obrazovka a viset testový režim).
  if (view !== 'quiz' && state.quiz.test) {
    state.quiz.test = null;
    $('#dt-intro')?.classList.add('hidden');
    $('#dt-result')?.classList.add('hidden');
    $('.quiz-setup')?.classList.remove('hidden');
  }
  markActiveMenuItem();
  $('#menu-dropdown').classList.remove('open');
  $('#menu-btn').setAttribute('aria-expanded', 'false');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// Zvýrazní v menu položku odpovídající aktuálnímu view (state.currentView).
function markActiveMenuItem() {
  $$('.menu-item[data-view]').forEach((b) => {
    const isActive = b.dataset.view === state.currentView;
    b.classList.toggle('menu-item-active', isActive);
    if (isActive) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

// Valid views that can be restored on reload. Keep in sync with #view-* sections.
const RESTORABLE_VIEWS = new Set(['lesson', 'browse', 'flashcards', 'quiz', 'auto', 'teacher']);

// ============================================================
// LESSON (guided 3-stage flow)
// ============================================================

function renderLessonPicker() {
  ensurePickerBanners(); // shared row that holds resume-card + slaba-mista-tile
  renderResumeCard();
  renderSlabaMistaTile();
  renderTryAppTile();
  finalizePickerBanners();
  const c = $('#lesson-groups');
  c.innerHTML = '';
  let subIdx = 0;
  const totalSubs = state.data.sections.reduce((n, s) => n + s.subsections.length, 0);
  const sectionEmojis = { '1.0.0': '🎯', '2.0.0': '🌀', '3.0.0': '⚡' };
  state.data.sections.forEach((sec) => {
    // Section-review chip in header (right side) — always visible, visuals change with mastery
    const allSecMastered = sec.subsections.every((sub) =>
      sub.verbs.every((v) => state.progress[v.inf]?.status === 'green')
    );
    const totalVerbs = sec.subsections.reduce((n, ss) => n + ss.verbs.length, 0);
    const sectionLocked = !state.premium && sec.subsections.some((sub) => !isFreeSub(sub.id));
    const icon = allSecMastered ? '🏆' : '🎲';
    const chipLabel = allSecMastered ? t('chip_mastered') : t('chip_default');
    const chipTitle = allSecMastered
      ? t('chip_title_mastered', totalVerbs)
      : t('chip_title_default', totalVerbs);

    const h = document.createElement('h3');
    h.className = 'lesson-sec-title';
    const emoji = sectionEmojis[sec.id] || '📚';
    h.innerHTML = `
      <span class="lesson-sec-emoji">${emoji}</span>
      <span class="lesson-sec-text">
        <span class="lesson-sec-num">${sec.id}</span>
        <span class="lesson-sec-name">${sec.title}</span>
      </span>
      <button type="button" class="section-review-chip${allSecMastered ? ' mastered' : ''}${sectionLocked ? ' locked' : ''}" title="${chipTitle}">
        <span class="section-review-chip-icon">${icon}</span>
        <span class="section-review-chip-label">${chipLabel}</span>
        ${sectionLocked ? '<span class="section-review-chip-lock">🔒</span>' : ''}
      </button>
    `;
    c.appendChild(h);
    h.querySelector('.section-review-chip').addEventListener('click', (e) => {
      e.stopPropagation();
      if (sectionLocked) {
        const lockedSub = sec.subsections.find((s) => !isFreeSub(s.id));
        showPaywall(lockedSub);
        return;
      }
      openSectionReviewChoice(sec);
    });
    sec.subsections.forEach((sub) => {
      const hue = Math.round((subIdx / totalSubs) * 360);
      subIdx++;
      const card = document.createElement('button');
      card.className = 'group-card';
      card.type = 'button';
      card.dataset.sub = sub.id;
      card.style.setProperty('--sub-hue', hue);
      const progress = subProgress(sub);
      const subProgressEntries = sub.verbs.map((v) => state.progress[v.inf]);
      const allMastered = subProgressEntries.every((p) => p?.status === 'green');
      // Weakened medal: the group HAD the medal (everything was green) and the
      // only thing breaking it now are verbs that slipped out of green. Any
      // never-mastered verb (no progress / never green / no slip tag) means the
      // medal was never earned, so no weak medal either.
      const medalWeak = !allMastered &&
        subProgressEntries.some((p) => p?.slippedAt) &&
        subProgressEntries.every((p) => p?.status === 'green' || p?.slippedAt);
      if (allMastered) card.classList.add('group-card-mastered');
      else if (medalWeak) card.classList.add('group-card-medal-weak');
      const isLocked = !state.premium && !isFreeSub(sub.id);
      if (isLocked) card.classList.add('group-card-locked');
      const previewVerbs = sub.verbs.slice(0, 8);
      const previewHtml = previewVerbs.map((v) => `
        <span class="group-preview-verb">
          <span class="group-preview-emoji">${v.emoji || '·'}</span>
          <span class="group-preview-inf">${v.inf}</span>
        </span>
      `).join('');
      card.innerHTML = `
        ${allMastered ? `<span class="group-medal" title="${t('medal_all')}">🏅</span>` : ''}
        ${medalWeak ? `<span class="group-medal group-medal-weak" title="${t('medal_weak')}">🏅</span>` : ''}
        ${isLocked ? `<span class="group-lock" title="${t('lock_premium')}">🔒</span>` : ''}
        <div class="group-card-top">
          <span class="subsection-id">${sub.id}</span>
          <span class="subsection-pattern">${sub.pattern}</span>
        </div>
        <div class="group-preview" aria-hidden="true">${previewHtml}</div>
        <div class="group-card-meta">
          <span>${sub.verbs.length} ${t('plur_verbs', sub.verbs.length)}</span>
          ${progress.green ? `<span class="dot green" title="${t('stat_green')}: ${progress.green}"></span>${progress.green}` : ''}
          ${progress.yellow ? `<span class="dot yellow" title="${t('stat_yellow')}: ${progress.yellow}"></span>${progress.yellow}` : ''}
          ${progress.red ? `<span class="dot red" title="${t('stat_red')}: ${progress.red}"></span>${progress.red}` : ''}
        </div>
      `;
      card.addEventListener('click', () => {
        if (isLocked) { showPaywall(sub); return; }
        // If student already worked on this group, offer "all" vs "problematic"
        const hasPrior = sub.verbs.some((v) => state.progress[v.inf]?.status);
        if (hasPrior) openGroupStartChoice(sub);
        else startLesson(sub);
      });
      c.appendChild(card);
    });
  });
  // Shrink pattern font if it overflows the available space
  requestAnimationFrame(() => {
    c.querySelectorAll('.group-card-top .subsection-pattern').forEach((el) => {
      if (el.scrollWidth > el.clientWidth + 1) el.classList.add('is-small');
    });
  });
  maybeHighlightBonusSub();
}

// One-time nudge: group 1.2.5 is free, but in the picker it sits surrounded by
// locked cards, so students often miss it. Once both base free groups (1.1.0
// and 1.2.1) are fully gone through, scroll to the 1.2.5 card and pulse it.
const BONUS_HINT_KEY = 'bonusSubHintShown';
function maybeHighlightBonusSub() {
  if (state.premium) return;
  if (localStorage.getItem(BONUS_HINT_KEY) === 'true') return;
  const subById = (id) => {
    for (const sec of state.data.sections)
      for (const sub of sec.subsections)
        if (sub.id === id) return sub;
    return null;
  };
  const isDone = (id) => {
    const sub = subById(id);
    return !!sub && sub.verbs.every((v) => state.progress[v.inf]?.status);
  };
  if (!isDone('1.1.0') || !isDone('1.2.1')) return;
  // If the student already started 1.2.5 on their own, no nudge needed.
  const bonus = subById('1.2.5');
  if (!bonus || bonus.verbs.some((v) => state.progress[v.inf]?.status)) {
    localStorage.setItem(BONUS_HINT_KEY, 'true');
    return;
  }
  const card = document.querySelector('.group-card[data-sub="1.2.5"]');
  // offsetParent is null while the picker (or its view) is hidden — keep the
  // flag unset so the nudge fires the next time the picker is actually shown.
  if (!card || !card.offsetParent) return;
  localStorage.setItem(BONUS_HINT_KEY, 'true');
  // Re-query inside the timeout: the picker may re-render (cloud sync, style
  // change) between now and then, which replaces all card elements.
  setTimeout(() => {
    const el = document.querySelector('.group-card[data-sub="1.2.5"]');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('group-card-bonus-pulse');
    toast(t('bonus_free_toast'), 'success', 4000);
    setTimeout(() => el.classList.remove('group-card-bonus-pulse'), 6000);
  }, 450);
}

function subProgress(sub) {
  const g = { green: 0, yellow: 0, red: 0 };
  sub.verbs.forEach((v) => {
    const p = state.progress[v.inf];
    if (!p) return;
    if (p.status === 'green') g.green++;
    else if (p.status === 'yellow') g.yellow++;
    else if (p.status === 'red') g.red++;
  });
  return g;
}

// Deep link entry point used by SEO landing pages.
// URL convention: https://ucseslovesa.cz/#/skupina/1-1-0  (dashes ↔ dots)
// Also accepts ?skupina=1.1.0 in the query string for share/paste-friendly links.
function handleDeepLink() {
  // Zadaný test od učitele: #/test/<kód> — má přednost před ostatními odkazy.
  const testMatch = (window.location.hash || '').match(/^#\/test\/([0-9a-z]+)/i);
  if (testMatch) {
    history.replaceState(null, '', window.location.pathname);
    dtOpen(testMatch[1]);
    return;
  }
  let target = null;
  const hashMatch = (window.location.hash || '').match(/^#\/skupina\/([\w.\-]+)/);
  if (hashMatch) target = hashMatch[1];
  if (!target) {
    const params = new URLSearchParams(window.location.search);
    target = params.get('skupina');
  }
  if (!target) return;
  const id = target.replace(/-/g, '.');
  let found = null;
  for (const sec of state.data.sections) {
    for (const sub of sec.subsections) {
      if (sub.id === id) { found = sub; break; }
    }
    if (found) break;
  }
  // Clean URL regardless — avoid replay on reload
  history.replaceState(null, '', window.location.pathname);
  if (!found) return;
  track('deeplink_skupina', { sub: found.id });
  setView('lesson');
  const isLocked = !state.premium && !isFreeSub(found.id);
  if (isLocked) { showPaywall(found); return; }
  openGroupStartChoice(found);
}

// Shared entry point for "Procvič si to!" CTA buttons in Browse + Flashcards views.
function practiceSubFromCTA(sub) {
  track('practice_cta_clicked', { sub: sub.id });
  setView('lesson');
  const isLocked = !state.premium && !isFreeSub(sub.id);
  if (isLocked) { showPaywall(sub); return; }
  openGroupStartChoice(sub);
}

function startLesson(sub, options) {
  track('lesson_started', { sub: sub.id });
  const verbs = sub.verbs.map((v) => ({ ...v, subId: v.subId || sub.id }));
  state.lesson = {
    sub,
    verbs,
    stage: 1,
    perVerb: new Map(verbs.map((v) => [v.inf, { status: 'pending', stage1: null, stage2R1: null, stage2R2: null, stage2Correct: 0, hard: false }])),
    stage2Round: 1,
    stage2Queue: [],
    markedHard: new Set(),
    done: false,
  };
  clearActiveLesson(); // fresh start — wipe any previous resume snapshot for any group
  $('.lesson-picker').classList.add('hidden');
  $('.lesson-results').classList.add('hidden');
  $('.lesson-active').classList.remove('hidden');
  document.body.classList.add('practicing');
  $('#lesson-group-label').innerHTML = `<span class="subsection-id" style="background:hsl(${hueOf(sub.id)} 65% 45%)">${sub.id}</span> ${sub.pattern}`;
  document.querySelector('.lesson-active').style.setProperty('--sub-hue', hueOf(sub.id));
  if (options && options.skipToFinale) {
    // "Slabá místa": no study, no mark — student knows these verbs, jump
    // straight to the shuffled atomic finale.
    state.lesson.stage = 2;
    stage2InitStep1();
    stage2AdvanceToFinale();
  } else {
    showStageIntro(1);
  }
}

function openGroupStartChoice(sub) {
  const modal = $('#group-start-modal');
  if (!modal) { startLesson(sub); return; }
  $('#gsm-emoji').textContent = '🔁';
  $('#gsm-title').textContent = t('gsm_title');
  // refresh button labels for current tone
  $('#gsm-all').querySelector('.modal-option-name').textContent = t('gsm_all');
  $('#gsm-problem').querySelector('.modal-option-name').textContent = t('gsm_problem');
  const all = sub.verbs.length;
  const problematic = sub.verbs.filter((v) => {
    const s = state.progress[v.inf]?.status;
    return s === 'yellow' || s === 'red';
  });
  $('#gsm-all-count').textContent = `${all} ${t('plur_verbs', all)}`;
  const pn = problematic.length;
  $('#gsm-problem-count').textContent = `${pn} ${t('plur_verbs', pn)}`;
  const problemBtn = $('#gsm-problem');
  if (pn === 0) {
    problemBtn.classList.add('disabled');
    problemBtn.disabled = true;
    $('#gsm-sub').textContent = t('srm_sub_clean');
  } else {
    problemBtn.classList.remove('disabled');
    problemBtn.disabled = false;
    $('#gsm-sub').textContent = t('gsm_sub');
  }
  modal.classList.remove('hidden');
  const close = () => modal.classList.add('hidden');
  $('#gsm-close').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  $('#gsm-all').onclick = () => { close(); startLesson(sub); };
  problemBtn.onclick = () => {
    if (pn === 0) return;
    close();
    const pseudoSub = { ...sub, verbs: problematic };
    startLesson(pseudoSub);
  };
}

function openSectionReviewChoice(sec) {
  const modal = $('#group-start-modal');
  // Gather all + problematic counts
  const all = [];
  const problematic = [];
  sec.subsections.forEach((sub) => {
    sub.verbs.forEach((v) => {
      all.push(v);
      const s = state.progress[v.inf]?.status;
      if (s === 'yellow' || s === 'red') problematic.push(v);
    });
  });
  if (!modal) { startSectionReview(sec); return; }
  $('#gsm-emoji').textContent = '🎲';
  $('#gsm-title').textContent = t('srm_title');
  $('#gsm-all').querySelector('.modal-option-name').textContent = t('gsm_all');
  $('#gsm-problem').querySelector('.modal-option-name').textContent = t('gsm_problem');
  const sw = (n) => `${n} ${t('plur_verbs', n)}`;
  // Náhodný mix je capnutý na 10 — ukážeme reálnou velikost dávky, ne celé sekce
  const allShown = Math.min(all.length, 10);
  const problemShown = Math.min(problematic.length, 10);
  $('#gsm-all-count').textContent = all.length > 10 ? `${sw(allShown)} z ${all.length}` : sw(all.length);
  $('#gsm-problem-count').textContent = problematic.length > 10 ? `${sw(problemShown)} z ${problematic.length}` : sw(problematic.length);
  const problemBtn = $('#gsm-problem');
  if (problematic.length === 0) {
    problemBtn.classList.add('disabled');
    problemBtn.disabled = true;
    $('#gsm-sub').textContent = t('srm_sub_clean');
  } else {
    problemBtn.classList.remove('disabled');
    problemBtn.disabled = false;
    $('#gsm-sub').textContent = t('srm_sub_some');
  }
  modal.classList.remove('hidden');
  const close = () => {
    modal.classList.add('hidden');
    // Restore default emoji for the per-group choice modal
    $('#gsm-emoji').textContent = '🔁';
    $('#gsm-title').textContent = t('gsm_title');
  };
  $('#gsm-close').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  $('#gsm-all').onclick = () => { close(); startSectionReview(sec); };
  problemBtn.onclick = () => {
    if (problematic.length === 0) return;
    close();
    startSectionReview(sec, problematic);
  };
}

function startSectionReview(sec, customVerbs = null) {
  track('section_review_started', { sec: sec.id, filtered: !!customVerbs });
  // Gather all verbs across all subsections of the section, tagged with their original subId
  let verbs;
  if (customVerbs) {
    // Filter passed in (e.g. only problematic). Re-tag with the right subId.
    verbs = customVerbs.map((v) => {
      const ownerSub = sec.subsections.find((s) => s.verbs.some((sv) => sv.inf === v.inf));
      return { ...v, subId: ownerSub ? ownerSub.id : sec.id };
    });
  } else {
    verbs = [];
    sec.subsections.forEach((sub) => {
      sub.verbs.forEach((v) => verbs.push({ ...v, subId: sub.id }));
    });
  }
  if (verbs.length === 0) return;
  shuffle(verbs);
  // Cap náhodného mixu na 10 sloves — víc je v jedné dávce na hlavu moc
  if (verbs.length > 10) verbs = verbs.slice(0, 10);
  // Synthetic "sub" used by lesson code: id is sec.id, pattern reflects review mode
  const pseudoSub = {
    id: sec.id,
    pattern: t('sec_review_pattern', verbs.length),
    verbs,
  };
  state.lesson = {
    sub: pseudoSub,
    verbs,
    stage: 2,
    perVerb: new Map(verbs.map((v) => [v.inf, {
      status: 'pending', stage1: null, stage2R1: null, stage2R2: null, stage2Correct: 0, hard: false,
      step1Wrong: new Set(),
      passWrong: 0, passCleared: true,        // skip combined pass — jump straight to finále
      finalWrong: 0, finalHadError: false, finalCleared: false, gaveUp: false,
    }])),
    stage2Round: 1,
    stage2Step: 2,
    stage2Q: verbs.slice(),
    markedHard: new Set(),
    isReview: true,
    done: false,
  };
  clearActiveLesson(); // review doesn't compete with a regular saved lesson
  $('.lesson-picker').classList.add('hidden');
  $('.lesson-results').classList.add('hidden');
  $('.lesson-active').classList.remove('hidden');
  document.body.classList.add('practicing');
  $('#lesson-group-label').innerHTML = `<span class="subsection-id" style="background:hsl(${hueOf(sec.subsections[0].id)} 65% 45%)">${sec.id}</span> 🏆 ${t('sec_review_label')}`;
  document.querySelector('.lesson-active').style.setProperty('--sub-hue', hueOf(sec.subsections[0].id));
  // Show a custom intro then jump straight to step 3
  $('#lesson-stage-intro').classList.remove('hidden');
  $('#stage-intro-emoji').textContent = '🏆';
  $('#stage-intro-title').textContent = t('sec_review_title');
  $('#stage-intro-desc').textContent = t('sec_review_desc', verbs.length);
  $('#lesson-question').innerHTML = '';
  updateStageDots();
  updateLessonBar();
  renderVerbChips();
  renderStepPills(2);
}

// ============================================================
// Resume / persistence of in-progress lesson
// ============================================================
const ACTIVE_LESSON_KEY = 'activeLesson';
const ACTIVE_LESSON_AT_KEY = 'activeLessonAt'; // separate timestamp so 'cleared' state is also datable
// Lessons older than this are ignored on resume (per-device + cross-device sync). Avoids
// surfacing stale state when one device left a lesson open days ago. 72h covers a long
// weekend off the app without dropping in-progress work.
const ACTIVE_LESSON_TTL_MS = 72 * 60 * 60 * 1000;

function persistActiveLesson() {
  const L = state.lesson;
  if (!L || L.done) return;
  const perVerb = {};
  L.perVerb.forEach((p, inf) => {
    perVerb[inf] = {
      ...p,
      step1Wrong: p.step1Wrong instanceof Set ? Array.from(p.step1Wrong) : (p.step1Wrong || []),
    };
  });
  const now = Date.now();
  const data = {
    subId: L.sub.id,
    subPattern: L.sub.pattern,
    stage: L.stage,
    stage2Step: L.stage2Step || null,
    stage2Q: (L.stage2Q || []).map((v) => v.inf),
    markedHard: Array.from(L.markedHard || []),
    perVerb,
    verbInfs: L.verbs.map((v) => v.inf), // preserves filtered subset on resume
    updatedAt: now,
  };
  try {
    localStorage.setItem(ACTIVE_LESSON_KEY, JSON.stringify(data));
    localStorage.setItem(ACTIVE_LESSON_AT_KEY, String(now));
  } catch {}
  cloud.pushSoon();
}

function clearActiveLesson() {
  try {
    localStorage.removeItem(ACTIVE_LESSON_KEY);
    localStorage.setItem(ACTIVE_LESSON_AT_KEY, String(Date.now())); // tombstone — null state with timestamp
  } catch {}
  cloud.pushSoon();
}

function getActiveLesson() {
  try {
    const raw = localStorage.getItem(ACTIVE_LESSON_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && typeof data.updatedAt === 'number') {
      if (Date.now() - data.updatedAt > ACTIVE_LESSON_TTL_MS) {
        // Drop stale resume state silently.
        try { localStorage.removeItem(ACTIVE_LESSON_KEY); } catch {}
        return null;
      }
    }
    return data;
  } catch { return null; }
}

function findSubById(subId) {
  for (const sec of state.data.sections) {
    for (const sub of sec.subsections) {
      if (sub.id === subId) return sub;
    }
  }
  return null;
}

// Shared row for the two top banners (resume-card + slaba-mista-tile). When
// both are present they sit side-by-side; on narrow screens they wrap. When
// neither is present the row is removed so it adds no vertical space.
function ensurePickerBanners() {
  const picker = document.querySelector('.lesson-picker');
  if (!picker) return null;
  let row = picker.querySelector('.picker-banners');
  if (!row) {
    row = document.createElement('div');
    row.className = 'picker-banners';
    const statsStrip = picker.querySelector('#stats-strip');
    if (statsStrip && statsStrip.nextSibling) picker.insertBefore(row, statsStrip.nextSibling);
    else picker.appendChild(row);
  }
  row.innerHTML = '';
  return row;
}
function finalizePickerBanners() {
  const row = document.querySelector('.lesson-picker .picker-banners');
  if (row && row.children.length === 0) row.remove();
}

function renderResumeCard() {
  const row = document.querySelector('.lesson-picker .picker-banners') || ensurePickerBanners();
  if (!row) return;
  const old = row.querySelector('.resume-card');
  if (old) old.remove();
  const saved = getActiveLesson();
  if (!saved) return;
  const sub = findSubById(saved.subId);
  if (!sub) { clearActiveLesson(); return; }
  const isLocked = !state.premium && !isFreeSub(sub.id);
  const stageLabels = { 1: t('resume_stage1'), 1.5: t('resume_stage15'), 2: t('resume_stage2') };
  const stageLabel = stageLabels[saved.stage] || t('resume_stage_generic');
  const stepLabels = { 1: t('resume_step1'), 2: t('resume_step2') };
  const stepLabel = saved.stage === 2 && saved.stage2Step ? ` · ${stepLabels[saved.stage2Step]}` : '';
  const filteredNote = (saved.verbInfs && saved.verbInfs.length && saved.verbInfs.length < sub.verbs.length)
    ? t('resume_filtered', saved.verbInfs.length)
    : '';
  const card = document.createElement('div');
  card.className = 'resume-card';
  card.style.setProperty('--sub-hue', hueOf(sub.id));
  card.innerHTML = `
    <button type="button" class="resume-dismiss" id="resume-dismiss" aria-label="${t('resume_dismiss_aria')}" title="${t('resume_dismiss_title')}">✕</button>
    <div class="resume-icon">⏯️</div>
    <div class="resume-text">
      <div class="resume-title">${t('resume_title')}</div>
      <div class="resume-meta">
        <span class="subsection-id">${sub.id}</span>
        <span class="resume-pattern">${sub.pattern}</span>
      </div>
      <div class="resume-stage">${stageLabel}${stepLabel}${filteredNote}</div>
    </div>
    <div class="resume-actions">
      <button class="btn btn-primary" id="resume-continue">${t('resume_continue')}</button>
      <button class="btn btn-secondary" id="resume-restart">${t('resume_restart')}</button>
    </div>
  `;
  row.appendChild(card);
  card.querySelector('#resume-continue').addEventListener('click', () => {
    if (isLocked) { showPaywall(sub); return; }
    resumeLesson(saved);
  });
  card.querySelector('#resume-restart').addEventListener('click', () => {
    if (isLocked) { showPaywall(sub); return; }
    clearActiveLesson();
    startLesson(sub);
  });
  // Dismiss (✕): zapomeň rozdělané cvičení a skryj kartu — chová se jako
  // "Začít znovu", jen bez automatického spuštění. Student se ke skupině může
  // kdykoli vrátit přes mřížku níž.
  card.querySelector('#resume-dismiss').addEventListener('click', (e) => {
    e.stopPropagation();
    try { track('resume_card_dismissed', { sub: sub.id, stage: saved.stage }); } catch (_) {}
    clearActiveLesson();
    card.remove();
  });
}

function resumeLesson(saved) {
  const sub = findSubById(saved.subId);
  if (!sub) { clearActiveLesson(); return; }
  // If a filtered subset was saved, honor it (e.g. "jen problematická" lesson)
  const sourceVerbs = saved.verbInfs && saved.verbInfs.length
    ? saved.verbInfs.map((inf) => sub.verbs.find((v) => v.inf === inf)).filter(Boolean)
    : sub.verbs;
  const verbs = sourceVerbs.map((v) => ({ ...v, subId: sub.id }));
  const perVerb = new Map();
  verbs.forEach((v) => {
    const sp = saved.perVerb && saved.perVerb[v.inf] ? saved.perVerb[v.inf] : {};
    perVerb.set(v.inf, {
      status: 'pending', stage1: null, stage2R1: null, stage2R2: null, stage2Correct: 0, hard: false,
      ...sp,
      step1Wrong: new Set(sp.step1Wrong || []),
    });
  });
  state.lesson = {
    sub, verbs,
    stage: saved.stage,
    perVerb,
    stage2Round: 1,
    stage2Step: saved.stage2Step || null,
    stage2Q: (saved.stage2Q || []).map((inf) => verbs.find((v) => v.inf === inf)).filter(Boolean),
    markedHard: new Set(saved.markedHard || []),
    done: false,
  };
  $('.lesson-picker').classList.add('hidden');
  $('.lesson-results').classList.add('hidden');
  $('.lesson-active').classList.remove('hidden');
  document.body.classList.add('practicing');
  $('#lesson-group-label').innerHTML = `<span class="subsection-id" style="background:hsl(${hueOf(sub.id)} 65% 45%)">${sub.id}</span> ${sub.pattern}`;
  document.querySelector('.lesson-active').style.setProperty('--sub-hue', hueOf(sub.id));
  if (saved.stage === 1) {
    showStageIntro(1);
  } else if (saved.stage === 1.5) {
    stage1Mark();
  } else if (saved.stage === 2) {
    // Skip the stage intro; jump directly back to the next pending question
    $('#lesson-stage-intro').classList.add('hidden');
    renderVerbChips();
    renderStepPills(saved.stage2Step || 1);
    if (state.lesson.stage2Q.length === 0) {
      // Edge case: queue empty for current step → advance
      if (saved.stage2Step === 1) stage2AdvanceToFinale();
      else if (saved.stage2Step === 2) stage2Finish();
    } else {
      stage2Next();
    }
  }
  updateStageDots();
  updateLessonBar();
  toast(t('toast_resume'), 'info', 2500);
}

function hueOf(subId) {
  let subIdx = 0;
  const totalSubs = state.data.sections.reduce((n, s) => n + s.subsections.length, 0);
  for (const sec of state.data.sections) {
    for (const sub of sec.subsections) {
      if (sub.id === subId) return Math.round((subIdx / totalSubs) * 360);
      subIdx++;
    }
  }
  return 20;
}

// Scroll the page to the very top — used between lesson stages so the student
// always sees the new headline/prompt instead of staying mid-page from the
// previous step. Uses smooth behavior so a still-resting finger doesn't end
// up tapping whatever the instant snap moves under it (was causing the
// "← Zpět" / logo to be hit accidentally after pressing Hotovo at the bottom).
// Also temporarily disables pointer events on the header for ~450 ms so any
// stray secondary tap during the scroll cannot dismiss the lesson.
function scrollLessonTop() {
  try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
  const guards = [document.querySelector('.app-header'), document.querySelector('.lesson-topbar')]
    .filter(Boolean);
  guards.forEach((el) => {
    el.style.pointerEvents = 'none';
    setTimeout(() => { el.style.pointerEvents = ''; }, 450);
  });
}

function showStageIntro(stage) {
  scrollLessonTop();
  const intros = {
    1:   { emoji: '👀', title: t('s1_intro_title'), desc: t('s1_intro_desc') },
    1.5: { emoji: '✋', title: t('mh_title'),         desc: t('mh_intro_desc') },
    2:   { emoji: '✍️', title: t('s2_intro_title'),  desc: t('s2_intro_desc') },
  };
  const i = intros[stage];
  $('#stage-intro-emoji').textContent = i.emoji;
  $('#stage-intro-title').textContent = i.title;
  $('#stage-intro-desc').textContent = i.desc;
  $('#lesson-question').innerHTML = '';
  $('#lesson-stage-intro').classList.remove('hidden');
  updateStageDots();
  updateLessonBar();
  renderStepPills();
}

function updateStageDots() {
  $$('.stage-dot').forEach((el) => {
    const s = parseFloat(el.dataset.stage);
    el.classList.remove('active', 'done');
    if (s < state.lesson.stage) el.classList.add('done');
    if (s === state.lesson.stage) el.classList.add('active');
  });
}

function updateLessonBar() {
  const L = state.lesson;
  const total = L.verbs.length;
  let done = 0;
  L.perVerb.forEach((v) => {
    if (v.status === 'green' || v.status === 'red') done++;
  });
  const fill = $('#lesson-bar-fill');
  if (fill) fill.style.width = `${Math.round((done / total) * 100)}%`;
}

// ---------- Stage 1: Study view — read all verbs in the group ----------
function stage1Study() {
  scrollLessonTop();
  $('#lesson-stage-intro').classList.add('hidden');
  const L = state.lesson;
  const hue = hueOf(L.sub.id);
  const rowsHtml = L.verbs.map((v, i) => {
    const past = pickForm(v, 'past', state.dialect);
    const pp = pickForm(v, 'pp', state.dialect);
    const { infV, pastV, ppV } = inferVowels(v);
    return `
      <div class="study-row" style="--row-i:${i}">
        <div class="study-num">${i + 1}</div>
        <div class="study-emoji">${v.emoji || '❓'}</div>
        <div class="study-forms">
          <span class="study-form" data-speak="${v.inf}">
            <span class="study-form-label">${t('form_inf')}</span>
            <span class="study-form-word">${highlightVowel(v.inf, infV)}</span>
          </span>
          <span class="study-arrow">→</span>
          <span class="study-form" data-speak="${phon(past)}">
            <span class="study-form-label">${t('form_past')}</span>
            <span class="study-form-word">${highlightVowel(past, pastV)}</span>
          </span>
          <span class="study-arrow">→</span>
          <span class="study-form" data-speak="${phon(pp)}">
            <span class="study-form-label">${t('form_pp')}</span>
            <span class="study-form-word">${highlightVowel(pp, ppV)}</span>
          </span>
        </div>
        <button class="speak-btn study-speak" data-speak="${v.inf}, ${phon(past)}, ${phon(pp)}" title="${t('speak_all_title')}">🔊</button>
        <div class="study-cs">${v.cs}</div>
      </div>
    `;
  }).join('');
  const q = $('#lesson-question');
  q.innerHTML = `
    <div class="study-view" style="--sub-hue:${hue}">
      <div class="study-hero">
        <div class="study-hero-pattern">${L.sub.pattern}</div>
        <div class="study-hero-text">
          <div class="study-hero-eyebrow">${t('s1_eyebrow')}</div>
          <div class="study-hero-title">${t('s1_title')}</div>
        </div>
        <div class="study-hero-count">${L.verbs.length}<span>${t('plur_verbs', L.verbs.length)}</span></div>
      </div>
      <div class="study-list">${rowsHtml}</div>
      <div class="study-actions">
        <button class="btn btn-primary study-done-btn" id="study-done">${t('s1_done_btn')}</button>
      </div>
    </div>
  `;
  q.querySelectorAll('[data-speak]').forEach((el) =>
    el.addEventListener('click', (e) => { e.stopPropagation(); speak(el.dataset.speak, state.dialect); })
  );
  q.querySelector('#study-done').addEventListener('click', () => {
    // Go straight to interlude (mezifáze) — no extra intro screen
    L.stage = 1.5;
    persistActiveLesson();
    stage1Mark();
  }, { once: true });
  updateStageDots();
  updateLessonBar();
  renderStepPills();
}

// ---------- Mezifáze: Mark verbs the student thinks will be hardest ----------
function stage1Mark() {
  scrollLessonTop();
  $('#lesson-stage-intro').classList.add('hidden');
  const L = state.lesson;
  const hue = hueOf(L.sub.id);
  const rowsHtml = L.verbs.map((v, i) => {
    const past = pickForm(v, 'past', state.dialect);
    const pp = pickForm(v, 'pp', state.dialect);
    const { infV, pastV, ppV } = inferVowels(v);
    const isMarked = L.markedHard.has(v.inf);
    return `
      <button type="button" class="study-row mark-row ${isMarked ? 'is-marked' : ''}" data-inf="${v.inf}" style="--row-i:${i}">
        <div class="mark-checkbox" aria-hidden="true">
          <span class="mark-check">✓</span>
        </div>
        <div class="study-emoji">${v.emoji || '❓'}</div>
        <div class="study-forms">
          <span class="study-form-word">${highlightVowel(v.inf, infV)}</span>
          <span class="study-arrow">→</span>
          <span class="study-form-word">${highlightVowel(past, pastV)}</span>
          <span class="study-arrow">→</span>
          <span class="study-form-word">${highlightVowel(pp, ppV)}</span>
        </div>
        <div class="study-cs">${v.cs}</div>
      </button>
    `;
  }).join('');
  const q = $('#lesson-question');
  q.innerHTML = `
    <div class="study-view mark-view" style="--sub-hue:${hue}">
      <div class="mark-hero">
        <div class="mark-hero-emoji">✋</div>
        <div class="mark-hero-text">
          <div class="mark-hero-title">${t('mh_title')}</div>
          <div class="mark-hero-sub">${t('mh_sub')}</div>
        </div>
        <div class="mark-counter" id="mark-counter">${L.markedHard.size}</div>
      </div>
      <div class="study-list mark-list">${rowsHtml}</div>
      <div class="study-actions">
        <button class="btn btn-primary study-done-btn" id="mark-done">${t('mh_done_btn')}</button>
      </div>
    </div>
  `;
  q.querySelectorAll('.mark-row').forEach((row) => {
    row.addEventListener('click', () => {
      const inf = row.dataset.inf;
      if (L.markedHard.has(inf)) {
        L.markedHard.delete(inf);
        L.perVerb.get(inf).hard = false;
        row.classList.remove('is-marked');
      } else {
        L.markedHard.add(inf);
        L.perVerb.get(inf).hard = true;
        row.classList.add('is-marked');
      }
      $('#mark-counter').textContent = L.markedHard.size;
      updateLessonBar();
      persistActiveLesson();
    });
  });
  q.querySelector('#mark-done').addEventListener('click', () => {
    // Move to stage 2 — initialize step 1 (in-order)
    L.stage = 2;
    stage2InitStep1();
    if (L.stage2Q.length === 0) { finishLesson(); return; }
    showStageIntro(2);
    renderVerbChips();
    renderStepPills();
    persistActiveLesson();
  }, { once: true });
  updateStageDots();
  updateLessonBar();
  renderStepPills();
}

// ---------- Stage 2: Type all 3 forms — 3 steps ----------
// Step 1: every verb in original order, per-field Enter check.
// Step 2: only verbs that errored in step 1, per-field Enter check, fields with prior errors get a soft blue aura.
//         Each verb must be answered correctly 2× in a row to leave the queue.
// Step 3: all verbs shuffled, atomic check (type all 3 then evaluate). Each verb 2× in a row to leave;
//         exception: if step 1 was perfect AND first attempt in step 3 is perfect → done immediately.

function stage2InitStep1() {
  const L = state.lesson;
  L.stage2Step = 1; // 1 = combined pass (per-field), 2 = finale (atomic)
  L.stage2Q = L.verbs.slice();
  L.currentInf = null;
  L.lastCleared = null;
  L.verbs.forEach((v) => {
    const p = L.perVerb.get(v.inf);
    p.step1Wrong = new Set();       // which fields were wrong last attempt — used for aura on requeue
    p.passWrong = 0;                // count of failed attempts in combined pass
    p.passCleared = false;
    p.finalWrong = 0;
    p.finalCleared = false;
    p.finalHadError = false;
    p.gaveUp = false;
  });
}

function renderStepPills(_ignored) {
  const c = $('#step-pills');
  if (!c) return;
  const L = state.lesson;
  if (!L) { c.innerHTML = ''; return; }
  // Compute active step from current lesson state — 3 unified steps:
  //   1) studium (= old stage 1 + 1.5 mark)
  //   2) v pořadí (= old stage 2 step 1)
  //   3) zamícháno (= old stage 2 step 2)
  let activeStep;
  if (L.stage === 1 || L.stage === 1.5) activeStep = 1;
  else if (L.stage === 2 && L.stage2Step === 1) activeStep = 2;
  else if (L.stage === 2 && L.stage2Step === 2) activeStep = 3;
  else activeStep = 1;
  const labels = { 1: t('step_pill_1'), 2: t('step_pill_2'), 3: t('step_pill_3') };
  c.innerHTML = [1, 2, 3].map((s) => {
    let cls = 'step-pill';
    if (s === activeStep) cls += ' active';
    else if (s < activeStep) cls += ' done';
    return `<span class="${cls}">${labels[s]}</span>${s < 3 ? '<span class="step-arrow">→</span>' : ''}`;
  }).join('');
}

function renderVerbChips() {
  const L = state.lesson;
  const c = $('#verb-chips');
  if (!c) return;
  // Verb chips only relevant during writing stages (Fáze 2)
  if (!L || L.stage !== 2) { c.innerHTML = ''; return; }
  const justInf = L.lastCleared;
  L.lastCleared = null;
  c.innerHTML = L.verbs.map((v) => {
    const p = L.perVerb.get(v.inf);
    let cls = 'verb-chip';
    if (p.finalCleared) cls += ' done';
    else if (p.passCleared) cls += ' good';
    else if (p.passWrong > 0 || (p.step1Wrong && p.step1Wrong.size > 0)) cls += ' warn';
    else cls += ' pending';
    const isCurrent = v.inf === L.currentInf;
    if (isCurrent) cls += ' current';
    if (v.inf === justInf) cls += ' just-cleared';
    // Tooltip with infinitiv + cs translation — but never for the verb the student
    // is currently answering (would spoil the answer).
    const titleAttr = isCurrent ? '' : ` title="${`${v.inf} – ${v.cs}`.replace(/"/g, '&quot;')}"`;
    return `<span class="${cls}"${titleAttr}>${v.emoji || '·'}</span>`;
  }).join('');
}

function stage2Next() {
  $('#lesson-stage-intro').classList.add('hidden');
  const L = state.lesson;
  if (L.stage2Step === 1) {
    if (L.stage2Q.length === 0) return stage2AdvanceToFinale();
    return askStage2Verb(L.stage2Q[0], 1);
  }
  if (L.stage2Step === 2) {
    if (L.stage2Q.length === 0) return stage2Finish();
    return askStage2Verb(L.stage2Q[0], 2);
  }
}

function stage2AdvanceToFinale() {
  const L = state.lesson;
  L.stage2Step = 2;
  L.stage2Q = shuffle(L.verbs.slice());
  L.verbs.forEach((v) => {
    const p = L.perVerb.get(v.inf);
    p.finalWrong = 0;
    p.finalHadError = false;
    p.finalCleared = false;
    p.gaveUp = false;
  });
  $('#lesson-stage-intro').classList.remove('hidden');
  $('#stage-intro-emoji').textContent = '🔀';
  $('#stage-intro-title').textContent = t('s2_finale_title');
  $('#stage-intro-desc').textContent = t('s2_finale_desc');
  $('#lesson-question').innerHTML = '';
  updateStageDots();
  updateLessonBar();
  renderVerbChips();
  renderStepPills(2);
  persistActiveLesson();
}

function stage2Finish() {
  const L = state.lesson;
  L.verbs.forEach((v) => {
    const p = L.perVerb.get(v.inf);
    // Red    = "Nevím" v Finále NEBO 3+ chyb ve Finále
    // Yellow = jakákoli chyba v 1. průchodu NEBO 1-2 chyby ve Finále
    // Green  = obojí bez chyby
    const wrongFin = p.finalWrong || 0;
    const wrongPass = p.passWrong || 0;
    if (p.gaveUp || wrongFin >= 3) p.status = 'red';
    else if (wrongFin >= 1 || wrongPass >= 1) p.status = 'yellow';
    else p.status = 'green';
  });
  finishLesson();
}

function askStage2Verb(verb, step) {
  scrollLessonTop();
  $('#lesson-stage-intro').classList.add('hidden');
  const L = state.lesson;
  const p = L.perVerb.get(verb.inf);
  L.currentInf = verb.inf;
  renderVerbChips();
  renderStepPills(step);
  const past = pickForm(verb, 'past', state.dialect);
  const pp = pickForm(verb, 'pp', state.dialect);
  const hue = hueOf(verb.subId);
  const isAtomicCheck = step === 2; // finále evaluates after all 3 forms
  // Combined pass: show blue aura on fields that were wrong last attempt of this verb (only if it was requeued)
  const auraSet = (step === 1 && (p.passWrong || 0) > 0) ? (p.step1Wrong || new Set()) : new Set();

  let progressText;
  const total = L.verbs.length;
  if (step === 1) {
    progressText = t('remaining_of', L.stage2Q.length, total);
  } else {
    progressText = t('remaining', L.stage2Q.length);
  }

  const tipText = isAtomicCheck ? t('tip_atomic') : t('tip_field');

  const fieldHtml = (key, placeholder) => {
    const auraCls = auraSet.has(key) ? ' has-aura' : '';
    return `
      <div class="fill-row${auraCls}">
        <input data-form="${key}" placeholder="${placeholder}" autocomplete="off" autocorrect="off" spellcheck="false" autocapitalize="none" enterkeyhint="next" inputmode="text" />
        <span class="field-indicator"></span>
      </div>`;
  };

  const q = $('#lesson-question');
  const audioOn = !!state.audioAfterAnswer;
  q.innerHTML = `
    <div class="q-card" style="--sub-hue:${hue}">
      <button type="button" class="audio-toggle ${audioOn ? 'is-on' : 'is-off'}" id="audio-toggle"
        aria-pressed="${audioOn ? 'true' : 'false'}"
        title="${audioOn ? t('audio_title_on') : t('audio_title_off')}">
        <span class="audio-toggle-icon" aria-hidden="true">${audioOn ? '🔊' : '🔇'}</span>
      </button>
      <div class="q-emoji">${verb.emoji || '❓'}</div>
      <div class="q-prompt">${verb.cs}</div>
      <div class="q-sub">${progressText}</div>
      <div class="enter-tip">${tipText}</div>
      <div class="quiz-fill-inputs">
        ${fieldHtml('inf', t('form_inf'))}
        ${fieldHtml('past', t('form_past_full'))}
        ${fieldHtml('pp', t('form_pp'))}
      </div>
      <div class="q-feedback"></div>
      <div class="q-actions">${isAtomicCheck ? `<button class="btn btn-primary" id="s2-check">${t('check_btn')}</button>` : ''}</div>
      <button type="button" class="give-up-btn" id="give-up-btn">${t('giveup_btn')}</button>
    </div>
  `;

  const inputs = Array.from(q.querySelectorAll('.quiz-fill-inputs input'));
  const fieldResults = {};
  let finalized = false;
  // Čas posledního dotyku prstu/myši V RÁMCI stránky. Slouží k rozlišení, čím se
  // pohnul focus: stiskem "Další" na systémové klávesnici (ta žádný pointerdown
  // do stránky nepošle) vs. klepnutím prstem na jiné pole (to pointerdown pošle).
  let lastPointerDownAt = 0;
  const giveUpBtn = q.querySelector('#give-up-btn');

  const markField = (inp) => {
    const key = inp.dataset.form;
    if (key in fieldResults) return;
    const good = isAnswerCorrect(inp.value, verb, key, state.dialect);
    fieldResults[key] = good;
    inp.classList.add(good ? 'correct' : 'wrong');
    inp.disabled = true;
    const ind = inp.closest('.fill-row').querySelector('.field-indicator');
    if (good) {
      ind.innerHTML = '<span class="fi-icon">✓</span>';
      ind.className = 'field-indicator correct';
    } else {
      const correctForm = pickForm(verb, key, state.dialect);
      ind.innerHTML = `<span class="fi-icon">✗</span><span class="fi-correct">${correctForm}</span>`;
      ind.className = 'field-indicator wrong';
    }
  };

  const finalize = () => {
    if (finalized) return;
    finalized = true;
    if (giveUpBtn) giveUpBtn.classList.add('hidden');
    inputs.forEach((inp) => markField(inp));
    const allRight = inputs.every((inp) => fieldResults[inp.dataset.form]);

    let msg = '';
    if (step === 1) {
      // Combined pass: per-field check. Right → remove from queue (1× clean clears it).
      // Wrong → push to end of queue (must be re-attempted later until 1× clean).
      const wrongFields = new Set();
      Object.entries(fieldResults).forEach(([k, v]) => { if (!v) wrongFields.add(k); });
      p.step1Wrong = wrongFields; // remembered for blue aura on requeue
      if (allRight) {
        L.stage2Q.shift();
        p.passCleared = true;
        L.lastCleared = verb.inf;
        L.streak = (L.streak || 0) + 1;
        const streakKey = (L.streak >= 3) ? 'fb_streak'
          : ((p.passWrong || 0) > 0 ? 'fb_pass_redo_ok' : 'fb_pass_ok');
        msg = '✅ ' + t(streakKey);
      } else {
        p.passWrong = (p.passWrong || 0) + 1;
        L.stage2Q.push(L.stage2Q.shift());
        L.streak = 0;
        msg = '🔍 ' + t('fb_pass_wrong');
      }
    } else if (step === 2) {
      // Finále: atomic. 1× right clears it. Wrong → requeue.
      if (allRight) {
        L.stage2Q.shift();
        p.finalCleared = true;
        L.lastCleared = verb.inf;
        L.streak = (L.streak || 0) + 1;
        const streakKey = (L.streak >= 3) ? 'fb_streak' : 'fb_finale_ok';
        msg = '✅ ' + t(streakKey);
      } else {
        // Leitner-style spacing instead of "always to the end". On the first
        // miss the verb comes back after a short detour (so the student isn't
        // grilled on the same word immediately, but also doesn't have to wait
        // for the whole queue to cycle). On repeated misses the gap widens.
        p.finalWrong = (p.finalWrong || 0) + 1;
        p.finalHadError = true;
        const current = L.stage2Q.shift();
        const remaining = L.stage2Q.length;
        const back = p.finalWrong === 1 ? Math.min(3, remaining)
                   : p.finalWrong === 2 ? Math.min(6, remaining)
                   : remaining; // 3+ misses → straight to the end
        L.stage2Q.splice(back, 0, current);
        L.streak = 0;
        msg = '❌ ' + t('fb_finale_wrong');
      }
    }

    const fb = q.querySelector('.q-feedback');
    fb.innerHTML = msg;
    fb.className = `q-feedback ${allRight ? 'correct' : 'wrong'}`;
    // Short confirmation cue. Always the same glass-chime for any correct
    // answer (streak included) — separate streak chord turned out too musical.
    playUiSound(allRight ? 'correct' : 'wrong');
    // Read the three correct forms aloud if the student opted in via the
    // top-right toggle. Small delay so the feedback text + cue play first.
    if (state.audioAfterAnswer) {
      setTimeout(() => {
        try { speak(`${verb.inf}, ${phon(past)}, ${phon(pp)}`, state.dialect); } catch (_) {}
      }, 600);
    }
    persistProgress();
    persistActiveLesson();
    L.currentInf = null;
    renderVerbChips();
    const checkBtn = q.querySelector('#s2-check');
    if (checkBtn) checkBtn.classList.add('hidden');
    const next = document.createElement('button');
    next.className = 'next-btn-corner';
    next.textContent = t('next_btn');
    next.addEventListener('click', stage2Next, { once: true });
    q.querySelector('.q-card').appendChild(next);
    next.focus();
    updateLessonBar();
  };

  inputs.forEach((inp, idx) => {
    // Poslední pole má "done" (✓) hint, ostatní "next" (➤). Android klávesnice
    // podle toho zobrazí správné akční tlačítko místo defaultní "Next" šipky,
    // která by jen přesunula focus bez vyvolání naší kontroly.
    inp.setAttribute('enterkeyhint', idx === inputs.length - 1 ? 'done' : 'next');

    const advance = (e) => {
      if (e) e.preventDefault();
      if (!isAtomicCheck) {
        markField(inp);
        const nextEmpty = inputs.find((x) => !(x.dataset.form in fieldResults));
        if (nextEmpty) nextEmpty.focus();
        else finalize();
      } else {
        if (idx < inputs.length - 1) inputs[idx + 1].focus();
        else finalize();
      }
    };

    // Touch zařízení (mobil/tablet) — některé Android klávesnice "Next" tlačítko
    // emitují jako Tab. Na PC s hw klávesnicí má Tab klasicky přeskakovat focus.
    const isTouchDevice = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
      || (navigator.maxTouchPoints || 0) > 0;
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') advance(e);
      else if (e.key === 'Tab' && isTouchDevice) advance(e);
    });
    // Fallback pro Android klávesnice, které "Next" emitují jako insertLineBreak
    // přes beforeinput místo keydown (žádný Enter event neproběhne).
    inp.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'insertLineBreak') advance(e);
    });
    // Záchytná síť pro klávesnice (např. Samsung), jejichž "Další" tlačítko udělá
    // nativní skok focusu na další pole BEZ keydown i beforeinput — pak by se
    // opuštěné pole nikdy nezkontrolovalo. Spustí se JEN když focus přeskočil bez
    // dotyku v stránce (= stisk "Další"). Když student ťukne prstem jinam,
    // předchází tomu pointerdown a kontrolu schválně NEspustíme.
    inp.addEventListener('pointerdown', () => { lastPointerDownAt = Date.now(); });
    if (!isAtomicCheck) {
      inp.addEventListener('focusin', () => {
        if (finalized) return;
        // Focus se pohnul kvůli dotyku prstem → nekontrolovat, jen přesunout.
        if (Date.now() - lastPointerDownAt < 700) return;
        let marked = false;
        inputs.forEach((other) => {
          if (other === inp) return;
          if (other.dataset.form in fieldResults) return;
          if (other.value.trim() === '') return;
          markField(other);
          marked = true;
        });
        if (marked && !inputs.some((x) => !(x.dataset.form in fieldResults))) finalize();
      });
    }
  });

  if (isAtomicCheck) {
    q.querySelector('#s2-check').addEventListener('click', finalize);
  }

  // Audio toggle (top-right corner of the card). Persists across questions
  // and sessions; reflects state without forcing a re-render of the card.
  const audioBtn = q.querySelector('#audio-toggle');
  if (audioBtn) {
    audioBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.audioAfterAnswer = !state.audioAfterAnswer;
      localStorage.setItem('audioAfterAnswer', state.audioAfterAnswer ? 'true' : 'false');
      const on = state.audioAfterAnswer;
      audioBtn.classList.toggle('is-on', on);
      audioBtn.classList.toggle('is-off', !on);
      audioBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      audioBtn.title = on ? t('audio_title_on') : t('audio_title_off');
      const icon = audioBtn.querySelector('.audio-toggle-icon');
      if (icon) icon.textContent = on ? '🔊' : '🔇';
      // If the student just turned audio on AFTER finalizing, play the forms now
      // so they don't have to wait for the next verb.
      if (on && finalized) {
        try { speak(`${verb.inf}, ${phon(past)}, ${phon(pp)}`, state.dialect); } catch (_) {}
      }
    });
  }

  // Give-up: requires double-tap to prevent accidental triggers (especially on mobile)
  let giveUpArmed = false;
  let giveUpResetTimer = null;
  giveUpBtn?.addEventListener('click', () => {
    if (finalized) return;
    if (!giveUpArmed) {
      giveUpArmed = true;
      const orig = giveUpBtn.textContent;
      giveUpBtn.textContent = t('giveup_confirm');
      giveUpBtn.classList.add('armed');
      giveUpResetTimer = setTimeout(() => {
        giveUpArmed = false;
        giveUpBtn.textContent = orig;
        giveUpBtn.classList.remove('armed');
      }, 2500);
      return;
    }
    if (giveUpResetTimer) clearTimeout(giveUpResetTimer);
    // Mark gave-up on the per-verb record so final status can become 'red'
    if (step === 2) p.gaveUp = true;
    inputs.forEach((inp) => {
      const k = inp.dataset.form;
      if (k in fieldResults) return;
      const correctForm = pickForm(verb, k, state.dialect);
      inp.value = correctForm;
      inp.disabled = true;
      inp.classList.add('gave-up');
      fieldResults[k] = false;
      const ind = inp.closest('.fill-row').querySelector('.field-indicator');
      if (ind) { ind.innerHTML = ''; ind.className = 'field-indicator'; }
    });
    finalize();
  });

  setTimeout(() => q.querySelector('input')?.focus(), 50);
  updateStageDots();
  updateLessonBar();
}

function finishLesson() {
  scrollLessonTop();
  const L = state.lesson;
  L.done = true;
  // Telemetry — how many verbs ended up in each bucket
  const counts = { green: 0, yellow: 0, red: 0 };
  L.perVerb.forEach((p) => { counts[p.status] = (counts[p.status] || 0) + 1; });
  track('lesson_completed', { sub: L.sub.id, green: counts.green, yellow: counts.yellow, red: counts.red });
  clearActiveLesson(); // lesson finished — no resume needed
  // Save to progress. Per-lesson binary accumulation:
  //   - attempts: number of lessons that included this verb (incl. this one)
  //   - errors:   subset of those that ended yellow / red / gave-up
  //   - lastWrong: timestamp of the most recent error-ending lesson
  // errorRate = errors / attempts → drives the "Slabá místa" selection later.
  const now = Date.now();
  L.perVerb.forEach((p, inf) => {
    const prev = state.progress[inf] || {};
    const erred = p.status !== 'green' || !!p.gaveUp;
    // "Slipped from green": a verb that had been mastered (green) just dropped.
    // We tag it with a timestamp so it (a) jumps the queue in the next daily
    // review and (b) keeps the group medal in a weakened state instead of
    // wiping it. The tag clears the moment the verb is green again.
    const slipped = p.status !== 'green' && (prev.status === 'green' || prev.slippedAt);
    state.progress[inf] = {
      status: p.status,
      lastSeen: now,
      attempts: (prev.attempts || 0) + 1,
      errors: (prev.errors || 0) + (erred ? 1 : 0),
      lastWrong: erred ? now : (prev.lastWrong || null),
      slippedAt: slipped ? (prev.slippedAt || now) : null,
    };
  });
  persistProgress();
  markStudyToday();

  $('.lesson-active').classList.add('hidden');
  document.body.classList.remove('practicing');
  $('.lesson-results').classList.remove('hidden');
  // Adapt the two result actions to the score and lesson type:
  //   - Slabá místa (isReview): "Další porce slabin" (re-pick) + "Zpět na skupiny"
  //   - Regular lesson, all green: "Procvičit znovu" + "Zpět na všechny skupiny"
  //   - Regular lesson, some misses: "Procvičit jen ta zlobivá" + "Nová lekce"
  const allGreen = ((counts.yellow || 0) + (counts.red || 0)) === 0;
  const isReview = !!(L.sub && L.sub.isReview);
  const againBtn = $('#results-again');
  const newBtn = $('#results-new');
  if (againBtn && newBtn) {
    // Replace nodes to wipe any prior listeners, then re-bind for this run.
    const freshAgain = againBtn.cloneNode(true);
    const freshNew = newBtn.cloneNode(true);
    againBtn.replaceWith(freshAgain);
    newBtn.replaceWith(freshNew);
    freshAgain.removeAttribute('data-tone');
    freshNew.removeAttribute('data-tone');
    if (isReview) {
      freshAgain.textContent = t('next_weak_batch');
      freshAgain.addEventListener('click', () => {
        // Tear down current lesson, then re-pick a fresh batch
        state.lesson = null;
        startSlabaMista();
      });
      freshNew.textContent = t('res_back_all');
      freshNew.addEventListener('click', exitLesson);
    } else if (allGreen) {
      freshAgain.textContent = t('res_again_all');
      freshAgain.addEventListener('click', againFullLesson);
      freshNew.textContent = t('res_back_all');
      freshNew.addEventListener('click', exitLesson);
    } else {
      freshAgain.textContent = t('res_again');
      freshAgain.setAttribute('data-tone', 'res_again');
      freshAgain.addEventListener('click', againOnlyProblem);
      freshNew.textContent = t('res_new');
      freshNew.setAttribute('data-tone', 'res_new');
      freshNew.addEventListener('click', exitLesson);
    }
  }
  $('#results-summary').innerHTML = `
    <div class="stat stat-green"><div class="stat-num">${counts.green || 0}</div><div class="stat-label">${t('stat_green')}</div></div>
    <div class="stat stat-yellow"><div class="stat-num">${counts.yellow || 0}</div><div class="stat-label">${t('stat_yellow')}</div></div>
    <div class="stat stat-red"><div class="stat-num">${counts.red || 0}</div><div class="stat-label">${t('stat_red')}</div></div>
  `;
  // Celebration confetti — intensity scales with success rate
  try {
    const total = (counts.green || 0) + (counts.yellow || 0) + (counts.red || 0);
    const successRate = total ? ((counts.green || 0) + 0.4 * (counts.yellow || 0)) / total : 1;
    // Map 0..1 success rate → 0.55..1.6 intensity (always some celebration)
    const intensity = 0.55 + successRate * 1.05;
    window.celebrate && window.celebrate({ intensity });
  } catch (_) {}
  // Offer "Install app" after the success moment — short delay so the user
  // first sees their result. Throttled to once per 7 days via install.js.
  setTimeout(() => { try { window.showInstallBanner && window.showInstallBanner(); } catch (_) {} }, 1800);
  const list = $('#results-list');
  list.innerHTML = '';
  L.verbs.forEach((v) => {
    const p = L.perVerb.get(v.inf);
    const past = pickForm(v, 'past', state.dialect);
    const pp = pickForm(v, 'pp', state.dialect);
    const row = document.createElement('div');
    row.className = `result-row ${p.status}`;
    row.innerHTML = `
      <span class="emoji">${v.emoji || '❓'}</span>
      <span class="forms"><strong>${v.inf}</strong> – ${past} – ${pp}</span>
      <span class="cs">${v.cs}</span>
      <span class="status-dot dot ${p.status}"></span>
    `;
    list.appendChild(row);
  });
}

function persistProgress() {
  localStorage.setItem('progress', JSON.stringify(state.progress));
  cloud.pushSoon();
}

function openSettingsModal() {
  const modal = $('#settings-modal');
  if (!modal) return;
  // Show "Spravovat předplatné" only for signed-in premium users.
  updatePortalBtn();
  // Close the menu dropdown if open.
  try { $('#menu-dropdown').classList.remove('open'); } catch (_) {}
  modal.classList.remove('hidden');
}
function closeSettingsModal() {
  const modal = $('#settings-modal');
  if (modal) modal.classList.add('hidden');
}

// ----- Streak reward modal -----
function updateStreakRewardBadge() {
  const btn = $('#streak-reward-btn');
  if (!btn) return;
  const sr = state.streakRewards || {};
  const hasPending = (sr.pendingMilestones || []).length > 0;
  // Premium gets everything — no need for the header gift badge.
  btn.classList.toggle('hidden', !hasPending || !!state.premium);
}

// Returns subIds eligible for the wildcard milestone: all locked, not-yet-base, not yet streak-unlocked.
function wildcardCandidates() {
  if (!state.data) return [];
  const taken = new Set([...FREE_SUB_BASE, ...(state.streakRewards?.unlockedSubIds || [])]);
  const ids = [];
  for (const sec of state.data.sections) {
    for (const sub of sec.subsections) {
      // Skip section-header pseudo-rows that have no verbs.
      if (!sub.verbs || sub.verbs.length === 0) continue;
      if (!taken.has(sub.id)) ids.push(sub.id);
    }
  }
  return ids;
}

function openStreakRewardModal(milestoneDay) {
  const modal = $('#streak-reward-modal');
  if (!modal || !state.data) return;
  const milestone = milestoneFor(milestoneDay);
  if (!milestone) return;

  // Header copy (tone-aware).
  $('#srm-title').textContent = t('streak_title_h');
  $('#srm-sub').textContent = t('streak_sub_h', milestoneDay);
  $('#srm-foot').textContent = t('streak_foot_h');
  $('#srm-emoji').textContent = milestoneDay >= 30 ? '👑' : milestoneDay >= 14 ? '💎' : milestoneDay >= 7 ? '⭐' : '🎁';

  const optsEl = $('#srm-options');
  optsEl.innerHTML = '';
  let optionIds = milestone.options;
  const isWildcard = optionIds === null;
  optsEl.classList.toggle('srm-wildcard', isWildcard);
  if (isWildcard) optionIds = wildcardCandidates();

  // Filter out any already-unlocked (defensive — shouldn't happen if pendingMilestones is well-managed).
  const taken = new Set([...FREE_SUB_BASE, ...(state.streakRewards?.unlockedSubIds || [])]);
  optionIds = optionIds.filter((id) => !taken.has(id));

  if (optionIds.length === 0) {
    // Nothing left to give (e.g. all groups already unlocked). Just claim and bail.
    claimMilestoneSilently(milestoneDay);
    return;
  }

  optionIds.forEach((subId) => {
    const sub = findSubById(subId);
    if (!sub) return;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'srm-option';
    card.style.setProperty('--sub-hue', hueOf(subId));
    const examples = (sub.verbs || []).slice(0, 3).map((v) => v.inf).join(', ');
    const count = (sub.verbs || []).length;
    const countLabel = `${count} ${t('plur_verbs', count)}`;
    const pattern = sub.title || sub.id;
    card.innerHTML = `
      <div class="srm-option-pattern">${pattern}</div>
      <div class="srm-option-count">${sub.id} · ${countLabel}</div>
      <div class="srm-option-examples">${examples}</div>
      <span class="srm-option-cta">${t('pick_btn')}</span>
    `;
    card.addEventListener('click', () => claimMilestone(milestoneDay, subId));
    optsEl.appendChild(card);
  });

  modal.classList.remove('hidden');
}

function closeStreakRewardModal() {
  const modal = $('#streak-reward-modal');
  if (modal) modal.classList.add('hidden');
}

// Streak info modal — explains tiers + grace period. Opened by clicking the
// streak pill on the lesson picker. Purely informational; no state changes.
function openStreakInfoModal() {
  const modal = $('#streak-info-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
}
function closeStreakInfoModal() {
  const modal = $('#streak-info-modal');
  if (modal) modal.classList.add('hidden');
}

function claimMilestoneSilently(day) {
  const sr = state.streakRewards;
  sr.pendingMilestones = sr.pendingMilestones.filter((d) => d !== day);
  if (!sr.claimedMilestones.includes(day)) sr.claimedMilestones.push(day);
  saveStreakRewards();
  updateStreakRewardBadge();
  cloud.pushSoon();
}

function claimMilestone(day, subId) {
  const sr = state.streakRewards;
  if (!sr.unlockedSubIds.includes(subId)) sr.unlockedSubIds.push(subId);
  sr.pendingMilestones = sr.pendingMilestones.filter((d) => d !== day);
  if (!sr.claimedMilestones.includes(day)) sr.claimedMilestones.push(day);
  saveStreakRewards();
  try { track('streak_reward_claimed', { day, subId }); } catch (_) {}
  cloud.pushSoon();
  closeStreakRewardModal();
  // Refresh lesson picker so the newly-unlocked group is no longer locked,
  // and stats strip so the new trophy appears next to the streak number.
  if (state.currentView === 'lesson' && !state.lesson) {
    renderLessonPicker();
    renderStatsStrip();
  }
  // If more pending milestones exist, queue next modal after a short beat.
  if (sr.pendingMilestones.length > 0) {
    const next = sr.pendingMilestones[0];
    setTimeout(() => openStreakRewardModal(next), 350);
  } else {
    updateStreakRewardBadge();
  }
}

// Wipe all learning progress: per-verb mastery, study-day streak, and any
// in-flight lesson. If signed in, also clears the user's Firestore doc.
async function resetProgress() {
  const signedIn = !!(state.user);
  const msg = signedIn ? t('reset_confirm_cloud') : t('reset_confirm');
  if (!confirm(msg)) return;
  try {
    state.progress = {};
    localStorage.setItem('progress', '{}');
    localStorage.setItem('studyDays', '[]');
    localStorage.removeItem(ACTIVE_LESSON_KEY);
    localStorage.setItem(ACTIVE_LESSON_AT_KEY, String(Date.now())); // tombstone propagates to other devices
    state.streakRewards = { unlockedSubIds: [], claimedMilestones: [], pendingMilestones: [], maxStreakReached: 0 };
    saveStreakRewards();
    updateStreakRewardBadge();
    if (signedIn) {
      try { await cloud.clearCloudProgress(); } catch (e) { console.error(e); }
    }
    try { track('reset_progress', { signedIn }); } catch (_) {}
    try { $('#menu-dropdown').classList.remove('open'); } catch (_) {}
    renderLessonPicker();
  } catch (e) {
    console.error('Reset failed', e);
    alert(t('generic_fail'));
  }
}

// ---------- Macro progress: mastery counts, group medals, study streak ----------
function loadStudyDays() {
  try { return new Set(JSON.parse(localStorage.getItem('studyDays') || '[]')); } catch { return new Set(); }
}
function saveStudyDays(set) {
  localStorage.setItem('studyDays', JSON.stringify(Array.from(set)));
}
function todayKey() {
  const d = new Date();
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function markStudyToday() {
  const days = loadStudyDays();
  days.add(todayKey());
  saveStudyDays(days);
  checkStreakMilestones();
  cloud.pushSoon();
}

// After any study event, check whether the current streak crossed a milestone
// the user hasn't yet claimed or queued. Updates state.streakRewards and
// triggers UI to surface a pending reward (header 🎁 badge + auto-open modal
// if user is on the lesson picker).
function checkStreakMilestones() {
  const streak = computeStreak();
  const sr = state.streakRewards || (state.streakRewards = loadStreakRewards());
  if (streak > (sr.maxStreakReached || 0)) sr.maxStreakReached = streak;
  // Premium users already have everything unlocked — keep the trophy/max
  // tracking (so a trophy still appears in the cabinet) but don't queue any
  // unclaimed group rewards.
  if (state.premium) {
    saveStreakRewards();
    updateStreakRewardBadge();
    if (state.currentView === 'lesson' && !state.lesson) renderStatsStrip();
    return;
  }
  const eligible = STREAK_MILESTONES
    .filter((m) => sr.maxStreakReached >= m.days)
    .map((m) => m.days);
  let added = false;
  eligible.forEach((d) => {
    const claimed = sr.claimedMilestones.includes(d);
    const pending = sr.pendingMilestones.includes(d);
    if (!claimed && !pending) {
      sr.pendingMilestones.push(d);
      added = true;
    }
  });
  saveStreakRewards();
  updateStreakRewardBadge();
  // Refresh strip so a newly-earned trophy renders right away (independent of modal flow).
  if (state.currentView === 'lesson' && !state.lesson) renderStatsStrip();
  if (added) {
    // Auto-open modal only on lesson picker (don't interrupt mid-lesson).
    if (state.currentView === 'lesson' && !state.lesson) {
      const nextDay = sr.pendingMilestones[0];
      openStreakRewardModal(nextDay);
    }
  }
}
function computeStreak() {
  const days = loadStudyDays();
  let streak = 0;
  const cur = new Date();
  // Grace period: if today is missing but yesterday is in studyDays, count
  // from yesterday. This keeps the streak visible until the end of "today"
  // so users don't see a sudden 0 right after midnight before they've had a
  // chance to study. The streak still breaks at the next midnight if not
  // refreshed (yesterday becomes the-day-before-yesterday → no grace).
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (!days.has(fmt(cur))) {
    cur.setDate(cur.getDate() - 1);
    if (!days.has(fmt(cur))) return 0;
  }
  while (true) {
    if (days.has(fmt(cur))) {
      streak++;
      cur.setDate(cur.getDate() - 1);
    } else break;
  }
  return streak;
}
// True when the visible streak depends on the grace period — i.e. today is
// missing from studyDays but yesterday is present. Used by the UI to surface
// "dodělej dnes" hint.
function isStreakPending() {
  const days = loadStudyDays();
  const d = new Date();
  const fmt = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  if (days.has(fmt(d))) return false;
  d.setDate(d.getDate() - 1);
  return days.has(fmt(d));
}
function computeMacroStats() {
  const all = flattenVerbs(state.data);
  let mastered = 0, inProgress = 0;
  all.forEach((v) => {
    const p = state.progress[v.inf];
    if (p?.status === 'green') mastered++;
    else if (p?.status === 'yellow') inProgress++;
  });
  let masteredGroups = 0, totalGroups = 0;
  state.data.sections.forEach((sec) => sec.subsections.forEach((sub) => {
    totalGroups++;
    if (sub.verbs.every((v) => state.progress[v.inf]?.status === 'green')) masteredGroups++;
  }));
  return { mastered, inProgress, total: all.length, masteredGroups, totalGroups, streak: computeStreak() };
}
function plurDays(n) { return t('plur_days_row', n); }
function plurDayWord(n) { return t('plur_day', n); }

// Inline smart label for the streak pill — communicates the streak reward
// system without growing the pill (replaces the plain "N dní v řadě" label).
function streakLabelText(streak, maxStreak, pending) {
  const sr = state.streakRewards || {};
  const rewardPending = (sr.pendingMilestones || []).length > 0;
  // Premium has every group unlocked — drop the reward-related copy and just
  // surface the streak number (or the grace warning when at risk).
  if (state.premium) {
    if (pending && streak > 0) return t('streak_label_grace');
    if (streak === 0) return t('start_today');
    return t('streak_label_premium');
  }
  if (rewardPending) return t('streak_label_pending');
  if (pending && streak > 0) return t('streak_label_grace', streak, plurDays(streak));
  const next = STREAK_MILESTONES.find((m) => maxStreak < m.days);
  if (!next) return t('streak_label_maxed', streak, plurDays(streak));
  if (streak === 0) return t('streak_label_zero');
  const remaining = next.days - streak;
  return t('streak_label_progress', streak, plurDays(streak), remaining, plurDayWord(remaining));
}
function renderStatsStrip() {
  const c = $('#stats-strip');
  if (!c || !state.data) return;
  const s = computeMacroStats();
  const pct = s.total ? Math.round((s.mastered / s.total) * 100) : 0;
  const groupPct = s.totalGroups ? Math.round((s.masteredGroups / s.totalGroups) * 100) : 0;
  const streakBig = s.streak >= 3 ? ' is-hot' : '';
  c.innerHTML = `
    <div class="stat-pill stat-pill-mastery is-clickable" id="mastery-info-open" role="button" tabindex="0" aria-label="${t('stat_verbs_aria')}">
      <div class="stat-pill-head">
        <span class="stat-pill-icon">🎯</span>
        <span class="stat-pill-num">${s.mastered}<span class="stat-pill-of"> / ${s.total}</span></span>
      </div>
      <div class="stat-pill-label">${t('stats_mastered_verbs')}</div>
      <div class="stat-pill-bar"><div class="stat-pill-bar-fill" style="width:${pct}%"></div></div>
    </div>
    ${(() => {
      const max = Math.max(s.streak, state.streakRewards?.maxStreakReached || 0);
      const trophies = earnedTrophies(max);
      const pending = isStreakPending();
      const labelText = streakLabelText(s.streak, max, pending);
      const trophyHTML = trophies.length
        ? `<div class="stat-pill-trophies" aria-label="${t('stats_trophies_aria')}">${trophies.map((tr) => `<span class="trophy" title="${t(tr.labelKey)}">${tr.icon}</span>`).join('')}</div>`
        : '';
      return `
    <div class="stat-pill stat-pill-streak is-clickable${streakBig}${trophies.length ? ' has-trophies' : ''}${pending ? ' is-pending' : ''}" id="streak-info-open" role="button" tabindex="0" aria-label="${t('streak_pill_aria')}">
      <div class="stat-pill-streak-main">
        <div class="stat-pill-head">
          <span class="stat-pill-icon">🔥</span>
          <span class="stat-pill-num">${s.streak}<span class="stat-pill-unit"> ${plurDayWord(s.streak)}</span></span>
        </div>
        <div class="stat-pill-label">${labelText}</div>
      </div>
      ${trophyHTML}
    </div>`;
    })()}
    <div class="stat-pill stat-pill-groups is-clickable" id="groups-info-open" role="button" tabindex="0" aria-label="${t('stat_groups_aria')}">
      <div class="stat-pill-head">
        <span class="stat-pill-icon">🏅</span>
        <span class="stat-pill-num">${s.masteredGroups}<span class="stat-pill-of"> / ${s.totalGroups}</span></span>
      </div>
      <div class="stat-pill-label">${t('stats_mastered_groups')}</div>
      <div class="stat-pill-bar"><div class="stat-pill-bar-fill" style="width:${groupPct}%"></div></div>
    </div>
  `;
}

function exitLesson() {
  state.lesson = null;
  $('.lesson-active').classList.add('hidden');
  document.body.classList.remove('practicing');
  $('.lesson-results').classList.add('hidden');
  $('.lesson-picker').classList.remove('hidden');
  $('#step-pills').innerHTML = '';
  $('#verb-chips').innerHTML = '';
  renderLessonPicker();
  renderStatsStrip();
}

function stageIntroStart() {
  const s = state.lesson.stage;
  if (s === 1) stage1Study();
  else if (s === 1.5) stage1Mark();
  else if (s === 2) stage2Next();
}

function againOnlyProblem() {
  // restart with only yellow + red verbs
  const L = state.lesson;
  const keep = L.verbs.filter((v) => L.perVerb.get(v.inf).status !== 'green');
  if (keep.length === 0) {
    toast(t('toast_no_problem'), 'success');
    return;
  }
  const pseudoSub = { ...L.sub, verbs: keep };
  startLesson(pseudoSub);
}

// Restart the same lesson from scratch (used when student scored 100 % green
// — "Procvičit jen ta zlobivá" would be a no-op then, so we offer a full redo).
function againFullLesson() {
  const L = state.lesson;
  if (!L) return;
  startLesson({ ...L.sub, verbs: L.verbs.slice() });
}

// ============================================================
// "Slabá místa" — cross-group daily review
// ============================================================
// Composition target: 10 verbs total = ~7 weak + ~3 spot-check greens.
// Cold-start: returns null if there isn't enough history (< 5 verbs seen).
// Selection is across all UNLOCKED groups (free for free users, all for premium).

const SLABA_TARGET = 10;
const SLABA_WEAK_MAX = 7;
const SLABA_COLD_START_MIN = 5;

// Editorial allowlist: green verbs from this set are preferred when filling
// the green-filler slots. Comes from two sources:
//   1) every verb in a "small" group (1-3 verbs) — those are pedagogically
//      precious because they're either core (be, have, do) or oddballs
//      (forget, lie) that lose visibility in random shuffling.
//   2) curated list of high-frequency / commonly-confused verbs.
// Soft preference: ordered first, then random rest. Doesn't override weak
// scoring or replace any of the up-to-7 weak slots.
const SLABA_PRIORITY_GREENS = new Set([
  // small groups (≤ 3 verbs)
  'be', 'become', 'bite', 'bleed', 'burn', 'come', 'deal', 'do',
  'eat', 'fall', 'feed', 'forget', 'forgive', 'get', 'give', 'go',
  'hide', 'lay', 'lead', 'learn', 'lie', 'lose', 'mean', 'pay',
  'run', 'say', 'see', 'sell', 'shake', 'swear', 'take', 'tear',
  'tell', 'wear',
  // explicit editorial picks
  'sink', 'stink', 'begin', 'blow', 'draw', 'rise', 'choose', 'steal',
  'feel', 'sweep', 'keep', 'bring', 'catch', 'seek', 'bend', 'lend',
  'hold', 'find', 'sting', 'hang', 'light', 'strike', 'bet', 'hit',
  'hurt', 'quit', 'spread', 'upset',
]);

function selectSlabaMista() {
  if (!state.data) return null;
  // Pool of verbs the student can practice (premium gate respected)
  const allVerbs = flattenVerbs(state.data).filter((v) =>
    state.premium || isFreeSub(v.subId)
  );
  const seen = allVerbs.filter((v) => state.progress[v.inf]);
  if (seen.length < SLABA_COLD_START_MIN) return null; // cold start

  const weak = [];
  const greens = [];
  seen.forEach((v) => {
    const p = state.progress[v.inf];
    if (p.status === 'green') greens.push(v);
    else weak.push(v);
  });

  // Score weak verbs by errorRate × status weight × recency boost.
  const now = Date.now();
  const scored = weak.map((v) => {
    const p = state.progress[v.inf];
    const errorRate = p.attempts ? (p.errors / p.attempts) : 0.5;
    const statusBoost = p.status === 'red' ? 2.0 : 1.0;
    // Recency: verbs missed within the last week get a small boost, decays.
    const ageDays = p.lastWrong ? (now - p.lastWrong) / 86400000 : 7;
    const recency = Math.max(0.6, 1.5 - ageDays / 14);
    // A verb that just slipped out of green jumps the queue so the student can
    // win the group medal back at the next opportunity. errorRate is low for a
    // freshly-slipped green, so floor the score to keep it competitive.
    const slipBoost = p.slippedAt ? 4.0 : 1.0;
    const base = p.slippedAt ? Math.max(errorRate, 0.4) : errorRate;
    return { verb: v, score: base * statusBoost * recency * slipBoost };
  });
  scored.sort((a, b) => b.score - a.score);

  // Compose pool: take up to 7 weakest, fill rest with greens (priority-first).
  // If weaks < 7, take all weaks. If no weaks, dose is all greens (light review).
  const targetWeak = Math.min(SLABA_WEAK_MAX, scored.length);
  const targetGreen = SLABA_TARGET - targetWeak;
  const picked = [];
  scored.slice(0, targetWeak).forEach((s) => picked.push(s.verb));
  // Editorial preference: priority greens go first (shuffled among themselves),
  // then any remaining slots get random non-priority greens.
  const priorityGreens = shuffle(greens.filter((v) => SLABA_PRIORITY_GREENS.has(v.inf)));
  const otherGreens    = shuffle(greens.filter((v) => !SLABA_PRIORITY_GREENS.has(v.inf)));
  [...priorityGreens, ...otherGreens].slice(0, targetGreen).forEach((v) => picked.push(v));
  // If still under target (very few seen verbs), pad with any seen verb we
  // haven't included yet — better to have a slightly shorter dose than to
  // repeat the same verb.
  if (picked.length < SLABA_TARGET) {
    const have = new Set(picked.map((v) => v.inf));
    const rest = seen.filter((v) => !have.has(v.inf));
    shuffle(rest).slice(0, SLABA_TARGET - picked.length).forEach((v) => picked.push(v));
  }
  return shuffle(picked);
}

// Tile on the lesson picker. Hidden until the student has ≥ SLABA_COLD_START_MIN
// verbs with any progress recorded (cold-start protection). Sits between the
// stats-strip and the section grid.
function renderSlabaMistaTile() {
  const row = document.querySelector('.lesson-picker .picker-banners') || ensurePickerBanners();
  if (!row) return;
  const old = row.querySelector('.slaba-mista-tile');
  if (old) old.remove();
  const picks = selectSlabaMista();
  if (!picks || picks.length === 0) return; // cold start — nothing to show

  // Quick descriptive subline based on the pool composition
  const weakCount = picks.filter((v) => {
    const p = state.progress[v.inf];
    return p && p.status !== 'green';
  }).length;
  const restCount = picks.length - weakCount;

  const icon = t('slaba_icon');
  const title = t('slaba_tile_title');
  const sub = weakCount > 0
    ? t('slaba_sub_mixed', weakCount, restCount)
    : t('slaba_sub_clean', picks.length);

  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'slaba-mista-tile';
  tile.innerHTML = `
    <span class="slaba-mista-icon" aria-hidden="true">${icon}</span>
    <span class="slaba-mista-text">
      <span class="slaba-mista-title">${title}</span>
      <span class="slaba-mista-sub">${sub}</span>
    </span>
    <span class="slaba-mista-arrow" aria-hidden="true">▶</span>
  `;
  tile.addEventListener('click', startSlabaMista);
  row.appendChild(tile);
}

// First-visit nudge: a single "try the app" tile that lives in the same
// picker-banners spot as the Boss-mode tile. Shown only when the visitor has no
// progress at all — once they practice anything it disappears and the Boss-mode
// tile takes over (the two never coexist). Click scrolls to the section grid
// and pulses the first group card.
function renderTryAppTile() {
  const row = document.querySelector('.lesson-picker .picker-banners') || ensurePickerBanners();
  if (!row) return;
  const old = row.querySelector('.try-app-tile');
  if (old) old.remove();
  // Only for brand-new visitors: no recorded progress, no resume in flight.
  const hasProgress = Object.keys(state.progress || {}).length > 0;
  if (hasProgress || row.querySelector('.resume-card')) return;

  const title = t('try_title');
  const sub = t('try_sub');

  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'slaba-mista-tile try-app-tile';
  tile.innerHTML = `
    <span class="slaba-mista-icon" aria-hidden="true">🚀</span>
    <span class="slaba-mista-text">
      <span class="slaba-mista-title">${title}</span>
      <span class="slaba-mista-sub">${sub}</span>
    </span>
    <span class="slaba-mista-arrow" aria-hidden="true">▶</span>
  `;
  tile.addEventListener('click', () => {
    try { track('try_app_tile_clicked', {}); } catch (_) {}
    const first = document.querySelector('#lesson-groups .group-card');
    if (!first) return;
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    first.classList.remove('pulse-attention');
    // Reflow so re-adding the class restarts the animation if clicked again.
    void first.offsetWidth;
    first.classList.add('pulse-attention');
    const stop = () => { first.classList.remove('pulse-attention'); first.removeEventListener('animationend', stop); };
    first.addEventListener('animationend', stop);
  });
  row.appendChild(tile);
}

function startSlabaMista() {
  const picks = selectSlabaMista();
  if (!picks || picks.length === 0) {
    toast(t('slaba_cold'), 'info');
    return;
  }
  // Pseudo-sub mimics the regular shape lesson code expects. The isReview
  // flag lets finishLesson swap the result actions accordingly.
  const pseudoSub = {
    id: 'slabaMista',
    title: t('slaba_title'),
    pattern: t('slaba_pattern', picks.length),
    rule: '',
    verbs: picks,
    isReview: true,
  };
  track('slaba_mista_started', { n: picks.length });
  startLesson(pseudoSub, { skipToFinale: true });
}

// ============================================================
// BROWSE view
// ============================================================

function renderBrowse() {
  const container = $('#sections-list');
  container.innerHTML = '';
  container.classList.remove('browse-preview');
  let subIdx = 0;
  const totalSubs = state.data.sections.reduce((n, s) => n + s.subsections.length, 0);
  state.data.sections.forEach((sec) => {
    const details = document.createElement('details');
    details.className = 'section-group';
    details.open = true;
    const summary = document.createElement('summary');
    summary.innerHTML = `<span>${sec.id} — ${sec.title}</span>`;
    details.appendChild(summary);
    sec.subsections.forEach((sub) => {
      const hue = Math.round((subIdx / totalSubs) * 360);
      subIdx++;
      const div = document.createElement('div');
      div.className = 'subsection';
      div.style.setProperty('--sub-hue', hue);
      const subLocked = !state.premium && !isFreeSub(sub.id);
      div.innerHTML = `
        <div class="subsection-head">
          <span class="subsection-id">${sub.id}</span>
          <span class="subsection-pattern">${sub.pattern}</span>
          ${subLocked ? `<span class="menu-premium-badge">${t('premium_badge')}</span>` : ''}
        </div>
        <p class="subsection-rule">${sub.rule}</p>
        <div class="verb-grid"></div>
        <button type="button" class="practice-cta${subLocked ? ' locked' : ''}" data-sub="${sub.id}">
          ${subLocked ? '🔒 ' : '🎯 '}${t('practice_cta')}
        </button>
      `;
      const grid = div.querySelector('.verb-grid');
      sub.verbs.forEach((v) => grid.appendChild(renderVerbCard(v)));
      const cta = div.querySelector('.practice-cta');
      cta.addEventListener('click', (e) => {
        e.stopPropagation();
        practiceSubFromCTA(sub);
      });
      details.appendChild(div);
    });
    container.appendChild(details);
  });
}

function renderVerbCard(verb) {
  const card = document.createElement('div');
  card.className = 'verb-card';
  const { infV, pastV, ppV } = inferVowels(verb);
  const past = pickForm(verb, 'past', state.dialect);
  const pp = pickForm(verb, 'pp', state.dialect);
  const altParts = [];
  if (verb.pastAm && verb.pastAm !== verb.past) altParts.push(`AmE past: ${verb.pastAm}`);
  if (verb.ppAm && verb.ppAm !== verb.pp) altParts.push(`AmE pp: ${verb.ppAm}`);
  if (verb.pastAlt) altParts.push(`alt past: ${verb.pastAlt}`);
  if (verb.ppAlt) altParts.push(`alt pp: ${verb.ppAlt}`);
  card.innerHTML = `
    <div class="verb-emoji">${verb.emoji || '❓'}</div>
    <span class="verb-form" data-speak="${verb.inf}">${highlightVowel(verb.inf, infV)}</span>
    <span class="verb-form" data-speak="${phon(past)}">${highlightVowel(past, pastV)}</span>
    <span class="verb-form" data-speak="${phon(pp)}">${highlightVowel(pp, ppV)}</span>
    <button class="speak-btn" data-speak="${verb.inf}, ${phon(past)}, ${phon(pp)}" title="${t('speak_all_title')}">🔊</button>
    <div class="verb-cs">${verb.cs}${altParts.length ? `<div class="verb-alt">${altParts.join(' · ')}</div>` : ''}</div>
  `;
  card.querySelectorAll('[data-speak]').forEach((el) =>
    el.addEventListener('click', (e) => { e.stopPropagation(); speak(el.dataset.speak, state.dialect); })
  );
  return card;
}

// ============================================================
// FLASHCARDS view
// ============================================================

function renderFlashcards() {
  const container = $('#fc-sections');
  container.innerHTML = '';
  container.classList.remove('fc-preview');
  const side = $('#fc-side').value;
  let subIdx = 0;
  const totalSubs = state.data.sections.reduce((n, s) => n + s.subsections.length, 0);
  state.data.sections.forEach((sec) => {
    const secWrap = document.createElement('div');
    secWrap.className = 'fc-section-group';
    secWrap.innerHTML = `<h3 class="fc-section-title">${sec.id} — ${sec.title}</h3>`;
    sec.subsections.forEach((sub) => {
      const hue = Math.round((subIdx / totalSubs) * 360);
      subIdx++;
      const subWrap = document.createElement('div');
      subWrap.className = 'fc-sub';
      subWrap.style.setProperty('--sub-hue', hue);
      const subLocked = !state.premium && !isFreeSub(sub.id);
      subWrap.innerHTML = `
        <div class="fc-sub-head">
          <span class="subsection-id">${sub.id}</span>
          <span class="subsection-pattern">${sub.pattern}</span>
          ${subLocked ? `<span class="menu-premium-badge">${t('premium_badge')}</span>` : ''}
          <span class="fc-sub-rule">${sub.rule}</span>
        </div>
        <div class="fc-grid"></div>
        <button type="button" class="practice-cta${subLocked ? ' locked' : ''}" data-sub="${sub.id}">
          ${subLocked ? '🔒 ' : '🎯 '}${t('practice_cta')}
        </button>
      `;
      const grid = subWrap.querySelector('.fc-grid');
      sub.verbs.forEach((v) => grid.appendChild(renderFlashCard(v, side)));
      subWrap.querySelector('.practice-cta').addEventListener('click', (e) => {
        e.stopPropagation();
        practiceSubFromCTA(sub);
      });
      secWrap.appendChild(subWrap);
    });
    container.appendChild(secWrap);
  });
}

// ============================================================
// 🚗 Audio jízda — hands-free practice for driving
// ============================================================
// Persisted setup state
const AUTO_SETUP_KEY = 'autoSetup';
function loadAutoSetup() {
  try {
    const raw = localStorage.getItem(AUTO_SETUP_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (Array.isArray(o.selectedSubs)) o.selectedSubs = new Set(o.selectedSubs);
    return o;
  } catch { return null; }
}
function saveAutoSetup() {
  const s = state.autoSetup;
  if (!s) return;
  try {
    localStorage.setItem(AUTO_SETUP_KEY, JSON.stringify({
      selectedSubs: Array.from(s.selectedSubs || []),
      scope: s.scope,
      mode: s.mode,
      tempo: s.tempo,
    }));
  } catch {}
}

// Tempo presets — multipliers for pauses + speech rate
const AUTO_TEMPOS = {
  slow:   { pauseAfterCs: 4000, gapBetweenForms: 1500, gapBetweenVerbs: 1400, rateEn: 0.78, rateCs: 0.90 },
  normal: { pauseAfterCs: 2500, gapBetweenForms: 1000, gapBetweenVerbs: 800,  rateEn: 0.85, rateCs: 0.95 },
  fast:   { pauseAfterCs: 1500, gapBetweenForms: 500,  gapBetweenVerbs: 500,  rateEn: 1.0,  rateCs: 1.0  },
};

function renderAutoSetup() {
  if (!state.data) return;
  // Initialize state from localStorage or defaults
  if (!state.autoSetup) {
    const loaded = loadAutoSetup();
    state.autoSetup = loaded || {
      selectedSubs: new Set(),
      scope: 'groups',  // 'problem' | 'groups'
      mode: 'test',
      tempo: 'normal',
    };
    if (loaded && !loaded.scope) state.autoSetup.scope = 'groups';
  }
  // Update problematic count in scope card
  const problemVerbs = flattenVerbs(state.data).filter((v) => {
    const s = state.progress[v.inf]?.status; return s === 'yellow' || s === 'red';
  });
  const probDesc = $('#auto-scope-problem-desc');
  if (probDesc) probDesc.textContent = `${problemVerbs.length} ${t('plur_verbs', problemVerbs.length)}`;
  // Wire scope radios
  $$('#view-auto input[name="auto-scope"]').forEach((r) => {
    r.checked = r.value === state.autoSetup.scope;
    if (r.value === 'problem' && problemVerbs.length === 0) r.disabled = true;
    r.onchange = () => {
      state.autoSetup.scope = r.value;
      saveAutoSetup();
      applyScopeVisibility();
    };
  });
  applyScopeVisibility();
  renderAutoTiles();
  // Wire mode + tempo
  $$('#auto-mode input').forEach((r) => {
    r.checked = r.value === state.autoSetup.mode;
    r.onchange = () => { state.autoSetup.mode = r.value; saveAutoSetup(); };
  });
  $$('#auto-tempo input').forEach((r) => {
    r.checked = r.value === state.autoSetup.tempo;
    r.onchange = () => { state.autoSetup.tempo = r.value; saveAutoSetup(); };
  });
  updateAutoSelectionCount();
}

function applyScopeVisibility() {
  const tilesSection = $('#auto-tiles-section');
  if (!tilesSection) return;
  if (state.autoSetup.scope === 'problem') tilesSection.classList.add('hidden');
  else tilesSection.classList.remove('hidden');
}

function renderAutoTiles() {
  const c = $('#auto-tiles');
  if (!c) return;
  c.innerHTML = '';
  let subIdx = 0;
  const totalSubs = state.data.sections.reduce((n, s) => n + s.subsections.length, 0);
  state.data.sections.forEach((sec) => {
    sec.subsections.forEach((sub) => {
      const hue = Math.round((subIdx / totalSubs) * 360);
      subIdx++;
      const selected = state.autoSetup.selectedSubs.has(sub.id);
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'auto-tile' + (selected ? ' selected' : '');
      tile.style.setProperty('--sub-hue', hue);
      const previewVerbs = sub.verbs.slice(0, 4);
      const previewHtml = previewVerbs.map((v) => `<span class="auto-tile-verb">${v.emoji || '·'} ${v.inf}</span>`).join('');
      tile.innerHTML = `
        <span class="auto-tile-check" aria-hidden="true">✓</span>
        <div class="auto-tile-top">
          <span class="subsection-id">${sub.id}</span>
          <span class="auto-tile-pattern">${sub.pattern}</span>
        </div>
        <div class="auto-tile-preview">${previewHtml}</div>
        <div class="auto-tile-meta">${sub.verbs.length} ${t('plur_verbs', sub.verbs.length)}</div>
      `;
      tile.onclick = () => {
        if (state.autoSetup.selectedSubs.has(sub.id)) state.autoSetup.selectedSubs.delete(sub.id);
        else state.autoSetup.selectedSubs.add(sub.id);
        state.autoSetup._onlyProblemMode = false;
        tile.classList.toggle('selected');
        saveAutoSetup();
        updateAutoSelectionCount();
      };
      c.appendChild(tile);
    });
  });
}

function updateAutoSelectionCount() {
  const el = $('#auto-selection-count');
  if (!el) return;
  const picked = state.autoSetup.selectedSubs;
  const totalVerbs = state.data.sections.flatMap((s) => s.subsections)
    .filter((sub) => picked.has(sub.id))
    .reduce((n, sub) => n + sub.verbs.length, 0);
  if (picked.size === 0) el.textContent = t('auto_zero_groups');
  else el.textContent = t('auto_selection', picked.size, totalVerbs);
}

function getAutoSelectedVerbs() {
  const all = flattenVerbs(state.data);
  if (state.autoSetup.scope === 'problem') {
    return all.filter((v) => {
      const s = state.progress[v.inf]?.status; return s === 'yellow' || s === 'red';
    });
  }
  // 'groups' scope
  const picked = state.autoSetup.selectedSubs;
  return all.filter((v) => picked.has(v.subId));
}

// State holder for the running session
let autoSession = null;

const AUTO_ROUNDS = 3;

function autoStart() {
  if (!state.autoSetup) return;
  // Defensive: Car mode is Premium-only
  if (!state.premium) {
    showPaywall();
    return;
  }
  if (state.autoSetup.scope === 'groups' && state.autoSetup.selectedSubs.size === 0) {
    toast(t('auto_pick_group'), 'error');
    return;
  }
  const base = getAutoSelectedVerbs();
  if (base.length === 0) {
    toast(state.autoSetup.scope === 'problem' ? t('auto_no_problem') : t('auto_empty'), 'error');
    return;
  }

  autoSession = {
    baseVerbs: base,
    verbs: base.slice(),       // current round queue, fed from baseVerbs
    round: 1,
    totalRounds: AUTO_ROUNDS,
    index: 0,
    shuffled: false,
    aborted: false,
    timers: [],
    mode: state.autoSetup.mode,
    tempo: AUTO_TEMPOS[state.autoSetup.tempo] || AUTO_TEMPOS.normal,
  };
  $('.auto-setup').classList.add('hidden');
  $('#auto-stage').classList.remove('hidden');
  document.body.classList.add('auto-driving');
  // Try to keep screen on (Wake Lock API; might be blocked if dock isn't fullscreen)
  try {
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then((lock) => { autoSession.wakeLock = lock; }).catch(() => {});
    }
  } catch {}
  track('auto_started', {
    scope: state.autoSetup.scope,
    subs: state.autoSetup.scope === 'groups' ? state.autoSetup.selectedSubs.size : 0,
    verbs: base.length,
    mode: state.autoSetup.mode,
    tempo: state.autoSetup.tempo,
  });
  autoTickNext();
}

// Pause the session — stops speech + timers but keeps the stage and state.
// First press of Stop calls this; the button morphs into "Exit" + a Play
// button is revealed.
function autoPause() {
  if (!autoSession || autoSession.paused || autoSession.aborted) return;
  autoSession.paused = true;
  (autoSession.timers || []).forEach(clearTimeout);
  autoSession.timers = [];
  try { window.speechSynthesis.cancel(); } catch {}
  // Morph buttons
  const stopBtn = $('#auto-stop');
  const playBtn = $('#auto-play');
  if (stopBtn) {
    stopBtn.textContent = t('auto_exit_btn');
    stopBtn.setAttribute('aria-label', t('auto_exit_aria'));
    stopBtn.classList.add('is-exit');
  }
  if (playBtn) playBtn.classList.remove('hidden');
}

// Resume from the current verb (replays from the Czech word).
function autoResume() {
  if (!autoSession || !autoSession.paused || autoSession.aborted) return;
  autoSession.paused = false;
  // Restore buttons
  const stopBtn = $('#auto-stop');
  const playBtn = $('#auto-play');
  if (stopBtn) {
    stopBtn.textContent = t('auto_stop_btn');
    stopBtn.setAttribute('aria-label', t('auto_stop_aria'));
    stopBtn.classList.remove('is-exit');
  }
  if (playBtn) playBtn.classList.add('hidden');
  // Restart playback from current verb
  autoTickNext();
}

// Fully exit the session — destroys state and returns to setup.
function autoExit() {
  if (autoSession) {
    autoSession.aborted = true;
    (autoSession.timers || []).forEach(clearTimeout);
    try { autoSession.wakeLock?.release?.(); } catch {}
    autoSession = null;
  }
  try { window.speechSynthesis.cancel(); } catch {}
  $('#auto-stage').classList.add('hidden');
  $('.auto-setup').classList.remove('hidden');
  document.body.classList.remove('auto-driving');
  // Reset button visuals back to default state
  const stopBtn = $('#auto-stop');
  const playBtn = $('#auto-play');
  if (stopBtn) {
    stopBtn.textContent = t('auto_stop_btn');
    stopBtn.setAttribute('aria-label', t('auto_stop_aria'));
    stopBtn.classList.remove('is-exit');
  }
  if (playBtn) playBtn.classList.add('hidden');
  // Clear visuals
  $('#auto-cs').textContent = '';
  $('#auto-forms').querySelectorAll('.auto-form-item').forEach((el) => { el.textContent = ''; el.classList.remove('visible'); });
}

// Single handler for the bottom button — pauses first, exits on second press.
function autoStopOrExit() {
  if (!autoSession) { autoExit(); return; }
  if (autoSession.paused) autoExit();
  else autoPause();
}

// Kept for backwards-compat with existing callers (logo home, menu switch).
function autoStop() { autoExit(); }

function autoShuffleRemaining() {
  if (!autoSession) return;
  // Shuffle the base verbs and restart 3 fresh rounds from the beginning
  const base = autoSession.baseVerbs.slice();
  for (let i = base.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  autoSession.baseVerbs = base;
  autoSession.verbs = base.slice();
  autoSession.round = 1;
  autoSession.index = 0;
  autoSession.shuffled = true;
  // Reset any in-flight timers + speech
  (autoSession.timers || []).forEach(clearTimeout);
  autoSession.timers = [];
  try { window.speechSynthesis.cancel(); } catch {}
  toast(t('auto_shuffled'), 'info', 2000);
  autoTickNext();
}

function scheduleAuto(fn, ms) {
  if (!autoSession || autoSession.aborted || autoSession.paused) return;
  const id = setTimeout(() => {
    if (autoSession && !autoSession.aborted && !autoSession.paused) fn();
  }, ms);
  autoSession.timers.push(id);
}

function speakCs(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || autoSession?.aborted || autoSession?.paused) return resolve();
    try { window.speechSynthesis.cancel(); } catch {}
    const u = new SpeechSynthesisUtterance(text);
    u.lang = PROMPT_VOICE;
    u.rate = autoSession?.tempo?.rateCs || 0.95;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

function speakEn(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || autoSession?.aborted || autoSession?.paused) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = state.dialect === 'AmE' ? 'en-US' : 'en-GB';
    const v = pickEnglishVoice(u.lang);
    if (v) u.voice = v;
    u.rate = autoSession?.tempo?.rateEn || 0.85;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

async function autoTickNext() {
  if (!autoSession || autoSession.aborted || autoSession.paused) return;
  if (autoSession.index >= autoSession.verbs.length) {
    // Round finished. Move to next round, or finish if 3 done.
    if (autoSession.round >= autoSession.totalRounds) {
      toast(t('auto_done'), 'success', 4000);
      setTimeout(() => autoStop(), 2000);
      return;
    }
    autoSession.round++;
    autoSession.index = 0;
    autoSession.verbs = autoSession.baseVerbs.slice();
    toast(t('auto_round_toast', autoSession.round, autoSession.totalRounds), 'info', 1800);
    // Brief breath before next round
    scheduleAuto(() => autoTickNext(), 1500);
    return;
  }
  const v = autoSession.verbs[autoSession.index];
  updateAutoProgress();
  await renderAutoVerb(v);
  if (!autoSession || autoSession.aborted || autoSession.paused) return;
  autoSession.index++;
  // Gap between verbs (tempo-controlled)
  const gap = autoSession.tempo?.gapBetweenVerbs ?? 800;
  scheduleAuto(() => autoTickNext(), gap);
}

function updateAutoProgress() {
  if (!autoSession) return;
  const el = $('#auto-progress');
  if (!el) return;
  el.textContent = t('auto_progress', autoSession.round, autoSession.totalRounds, autoSession.index + 1, autoSession.verbs.length);
}

async function renderAutoVerb(verb) {
  const cs = $('#auto-cs');
  const items = $('#auto-forms').querySelectorAll('.auto-form-item');
  // Reset
  cs.textContent = '';
  items.forEach((el) => { el.textContent = ''; el.classList.remove('visible'); });

  const tempo = autoSession?.tempo || AUTO_TEMPOS.normal;

  // 1. Show + say Czech
  cs.textContent = verb.cs;
  cs.classList.add('visible');
  await speakCs(verb.cs);
  if (!autoSession || autoSession.aborted || autoSession.paused) return;

  // 2. Pause for student to think (skip in listen-only mode)
  if (autoSession.mode !== 'listen') {
    await new Promise((res) => scheduleAuto(res, tempo.pauseAfterCs));
    if (!autoSession || autoSession.aborted || autoSession.paused) return;
  } else {
    await new Promise((res) => scheduleAuto(res, 400));
    if (!autoSession || autoSession.aborted || autoSession.paused) return;
  }

  // 3. Reveal + speak each of the three forms, with tempo gap between them
  const past = pickForm(verb, 'past', state.dialect);
  const pp = pickForm(verb, 'pp', state.dialect);
  const forms = [verb.inf, past, pp];
  // For TTS, past/pp may need a phonetic respelling (e.g. read → red).
  const ttsForms = [verb.inf, phon(past), phon(pp)];
  for (let i = 0; i < forms.length; i++) {
    if (!autoSession || autoSession.aborted || autoSession.paused) return;
    items[i].textContent = forms[i];
    items[i].classList.add('visible');
    await speakEn(ttsForms[i]);
    if (i < forms.length - 1) {
      await new Promise((res) => scheduleAuto(res, tempo.gapBetweenForms));
    }
  }
}

function renderFlashCard(verb, side) {
  const past = pickForm(verb, 'past', state.dialect);
  const pp = pickForm(verb, 'pp', state.dialect);
  const { infV, pastV, ppV } = inferVowels(verb);
  const card = document.createElement('button');
  card.className = 'flash-card';
  card.type = 'button';
  if (side === 'en') card.classList.add('flipped');
  card.innerHTML = `
    <div class="flash-inner">
      <div class="flash-face flash-front">
        <div class="flash-emoji">${verb.emoji || '❓'}</div>
        <div class="flash-cs">${verb.cs}</div>
        <div class="flash-hint">${t('flash_hint')}</div>
      </div>
      <div class="flash-face flash-back">
        <div class="flash-forms">
          <span>${highlightVowel(verb.inf, infV)}</span>
          <span>${highlightVowel(past, pastV)}</span>
          <span>${highlightVowel(pp, ppV)}</span>
        </div>
        <button class="speak-btn flash-speak" data-speak="${verb.inf}, ${phon(past)}, ${phon(pp)}" title="${t('speak_title')}">🔊</button>
      </div>
    </div>
  `;
  card.addEventListener('click', (e) => {
    if (e.target.closest('.speak-btn')) return;
    card.classList.toggle('flipped');
  });
  card.querySelector('.speak-btn').addEventListener('click', (e) => {
    e.stopPropagation(); speak(e.currentTarget.dataset.speak, state.dialect);
  });
  return card;
}

function fcFlipAll() {
  const cards = $$('#fc-sections .flash-card');
  const allFlipped = cards.every((c) => c.classList.contains('flipped'));
  cards.forEach((c) => c.classList.toggle('flipped', !allFlipped));
}

// ============================================================
// QUIZ view
// ============================================================

function renderSectionChips(container, selectedSet) {
  container.innerHTML = '';
  const allChip = document.createElement('button');
  allChip.className = 'chip meta active';
  allChip.textContent = t('quiz_all_chip');
  allChip.addEventListener('click', () => {
    selectedSet.clear();
    container.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === allChip));
  });
  container.appendChild(allChip);
  state.data.sections.forEach((sec) => {
    sec.subsections.forEach((sub) => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = sub.id;
      chip.title = sub.pattern;
      chip.addEventListener('click', () => {
        if (selectedSet.has(sub.id)) { selectedSet.delete(sub.id); chip.classList.remove('active'); }
        else { selectedSet.add(sub.id); chip.classList.add('active'); allChip.classList.remove('active'); }
        if (selectedSet.size === 0) allChip.classList.add('active');
      });
      container.appendChild(chip);
    });
  });
}

function quizStart() {
  state.quiz.test = null; // volný kvíz — zahodit případný zadaný test
  const all = flattenVerbs(state.data, state.quiz.selectedSections);
  if (all.length === 0) return;
  const countSel = parseInt($('#quiz-count').value, 10);
  const n = countSel === 0 ? all.length : Math.min(countSel, all.length);
  state.quiz.pool = shuffle(all).slice(0, n);
  state.quiz.idx = 0;
  state.quiz.score = 0;
  state.quiz.maxScore = 0;
  state.quiz.scoring = 'verb';
  state.quiz.total = n;
  state.quiz.type = $('#quiz-type').value;
  state.quiz.review = [];
  $('#quiz-total').textContent = n;
  $('.quiz-setup').classList.add('hidden');
  $('.quiz-done').classList.add('hidden');
  $('.quiz-play').classList.remove('hidden');
  quizRender();
}

function quizRender() {
  const verb = state.quiz.pool[state.quiz.idx];
  const allVerbs = flattenVerbs(state.data);
  // Zadaný test: náhodnost každé otázky se odvozuje ze seedu odkazu a jejího
  // pořadí, takže celá třída dostane identické otázky i možnosti.
  state.quiz.rng = state.quiz.test
    ? mulberry32(state.quiz.test.seed + state.quiz.idx * 7919)
    : null;
  $('#quiz-current').textContent = state.quiz.idx + 1;
  $('#quiz-score').textContent = state.quiz.score;
  $('#quiz-bar-fill').style.width = `${(state.quiz.idx / state.quiz.total) * 100}%`;
  let mode = state.quiz.type;
  if (mode === 'mixed') mode = qRand() < 0.5 ? 'mc' : 'fill';
  const card = $('#quiz-card');
  card.innerHTML = '';
  if (mode === 'mc') {
    const ask = qRand() < 0.5 ? 'past' : 'pp';
    const askLabel = ask === 'past' ? 'past simple' : 'past participle';
    const correct = pickForm(verb, ask, state.dialect);
    const distractors = shuffleWith(allVerbs.filter((v) => v.inf !== verb.inf).map((v) => pickForm(v, ask, state.dialect)), qRand).slice(0, 3);
    const options = shuffleWith([correct, ...distractors], qRand);
    card.innerHTML = `
      <div class="q-emoji">${verb.emoji || '❓'}</div>
      <div class="q-prompt">${verb.inf} <button class="speak-btn" data-speak="${verb.inf}">🔊</button></div>
      <div class="q-hint">${t('quiz_pick_correct', askLabel)}</div>
      <div class="quiz-options-list"></div>
      <div class="quiz-feedback"></div>
      <div class="quiz-next-row"><button class="btn btn-primary hidden" id="quiz-next">${t('next_btn')}</button></div>
    `;
    const list = card.querySelector('.quiz-options-list');
    options.forEach((opt) => {
      const b = document.createElement('button');
      b.className = 'quiz-option';
      b.textContent = opt;
      b.addEventListener('click', () => {
        const ok = opt.toLowerCase() === correct.toLowerCase();
        list.querySelectorAll('button').forEach((btn) => {
          btn.disabled = true;
          if (btn.textContent.toLowerCase() === correct.toLowerCase()) btn.classList.add('correct');
          else if (btn === b && !ok) btn.classList.add('wrong');
        });
        handleQuizAnswer(ok, verb, `${verb.inf} (${askLabel})`, correct, { gained: ok ? 1 : 0, possible: 1, typed: [opt] });
      });
      list.appendChild(b);
    });
  } else {
    const past = pickForm(verb, 'past', state.dialect);
    const pp = pickForm(verb, 'pp', state.dialect);
    // Které tvary se doplňují a co je v zadání:
    //   fill    — dané sloveso (infinitiv), doplň past + pp
    //   cs3     — dané české sloveso, doplň všechny tři tvary
    //   missing — dané dva tvary, doplň ten chybějící
    let blanks;
    if (mode === 'cs3') blanks = ['inf', 'past', 'pp'];
    else if (mode === 'missing') blanks = [['inf', 'past', 'pp'][Math.floor(qRand() * 3)]];
    else blanks = ['past', 'pp'];
    const labels = { inf: 'infinitiv', past: 'past simple', pp: 'past participle' };
    const shownForms = { inf: verb.inf, past, pp };
    const promptHTML = mode === 'cs3'
      ? `<div class="q-prompt q-prompt-cs">${verb.cs}</div><div class="q-hint">${t('quiz_cs3_hint')}</div>`
      : mode === 'missing'
        ? `<div class="q-prompt q-prompt-missing">${['inf', 'past', 'pp']
            .map((k) => (blanks.includes(k)
              ? '<span class="q-blank">?</span>'
              : `<span>${shownForms[k]}</span>`)).join('<span class="q-sep">–</span>')}</div>
           <div class="q-hint">${t('quiz_fill_hint', verb.cs)}</div>`
        : `<div class="q-prompt">${verb.inf} <button class="speak-btn" data-speak="${verb.inf}">🔊</button></div>
           <div class="q-hint">${t('quiz_fill_hint', verb.cs)}</div>`;
    card.innerHTML = `
      <div class="q-emoji">${verb.emoji || '❓'}</div>
      ${promptHTML}
      <div class="quiz-fill-inputs">
        ${blanks.map((k, i) => `<input data-form="${k}" placeholder="${labels[k]}" autocomplete="off" autocorrect="off" spellcheck="false" autocapitalize="none" enterkeyhint="${i === blanks.length - 1 ? 'done' : 'next'}" inputmode="text" />`).join('')}
      </div>
      <div class="quiz-feedback"></div>
      <div class="quiz-next-row"><button class="btn btn-primary" id="quiz-check">${t('check_btn')}</button><button class="btn btn-primary hidden" id="quiz-next">${t('next_btn')}</button></div>
    `;
    const fillInputs = Array.from(card.querySelectorAll('.quiz-fill-inputs input'));
    const submitFill = () => {
      let ok = true;
      let goodCount = 0;
      const typed = [];
      fillInputs.forEach((inp) => {
        const key = inp.dataset.form;
        const good = isAnswerCorrect(inp.value, verb, key, state.dialect);
        inp.classList.add(good ? 'correct' : 'wrong');
        inp.disabled = true;
        typed.push(inp.value.trim());
        if (good) goodCount++; else ok = false;
      });
      // Bodování: 'form' = bod za každý správný tvar, jinak vše nebo nic.
      const byForm = state.quiz.scoring === 'form';
      const gained = byForm ? goodCount : (ok ? 1 : 0);
      const possible = byForm ? fillInputs.length : 1;
      handleQuizAnswer(ok, verb, mode === 'cs3' ? verb.cs : verb.inf, `${verb.inf} – ${past} – ${pp}`, { gained, possible, typed });
      card.querySelector('#quiz-check').classList.add('hidden');
    };
    card.querySelector('#quiz-check').addEventListener('click', submitFill);

    // Enter chování: posuň na další prázdné pole; teprve když jsou všechna
    // vyplněná (a Enter je v posledním), odešli — stejně jako klasická Lekce.
    fillInputs.forEach((inp, idx) => {
      const advance = (e) => {
        if (e) e.preventDefault();
        const nextEmpty = fillInputs.find((x) => !x.value.trim());
        if (nextEmpty && nextEmpty !== inp) { nextEmpty.focus(); return; }
        if (idx < fillInputs.length - 1) { fillInputs[idx + 1].focus(); return; }
        submitFill();
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') advance(e);
      });
      // Android: "Next" může přijít jako insertLineBreak místo Enter
      inp.addEventListener('beforeinput', (e) => {
        if (e.inputType === 'insertLineBreak') advance(e);
      });
    });
    setTimeout(() => fillInputs[0]?.focus(), 50);
  }
  card.querySelectorAll('[data-speak]').forEach((el) =>
    el.addEventListener('click', (e) => { e.stopPropagation(); speak(el.dataset.speak, state.dialect); })
  );
}

function handleQuizAnswer(ok, verb, qText, aText, detail) {
  const fb = $('#quiz-card .quiz-feedback');
  const past = pickForm(verb, 'past', state.dialect);
  const pp = pickForm(verb, 'pp', state.dialect);
  const gained = detail ? detail.gained : (ok ? 1 : 0);
  const possible = detail ? detail.possible : 1;
  state.quiz.score += gained;
  state.quiz.maxScore = (state.quiz.maxScore || 0) + possible;
  if (ok) {
    state.quiz.streak = (state.quiz.streak || 0) + 1;
    const key = (state.quiz.streak >= 3) ? 'fb_streak' : 'fb_pass_ok';
    fb.textContent = '✅ ' + t(key);
    fb.className = 'quiz-feedback correct';
  } else {
    state.quiz.streak = 0;
    fb.innerHTML = `❌ ${t('fb_pass_wrong')}<br><span style="font-size:0.9em;opacity:0.85">${t('quiz_correct_is')} <strong>${verb.inf} – ${past} – ${pp}</strong></span>`;
    fb.className = 'quiz-feedback wrong';
  }
  state.quiz.review.push({ ok, q: qText, a: aText, verb, typed: detail ? detail.typed : [] });
  $('#quiz-score').textContent = state.quiz.score;
  const next = $('#quiz-card #quiz-next');
  next.classList.remove('hidden');
  next.focus();
  next.addEventListener('click', quizNext, { once: true });
}

function quizNext() {
  state.quiz.idx++;
  if (state.quiz.idx >= state.quiz.pool.length) quizFinish();
  else quizRender();
}

function quizFinish() {
  $('.quiz-play').classList.add('hidden');
  $('.quiz-done').classList.remove('hidden');
  const maxPts = state.quiz.maxScore || state.quiz.total;
  const pct = maxPts ? Math.round((state.quiz.score / maxPts) * 100) : 0;
  $('#quiz-final').textContent = `${state.quiz.score} / ${maxPts} (${pct} %)`;
  dtRenderResult();
  const review = $('#quiz-review');
  review.innerHTML = '';
  state.quiz.review.forEach((r) => {
    const item = document.createElement('div');
    item.className = 'review-item' + (r.ok ? '' : ' wrong');
    item.innerHTML = `
      <div class="q-text">${r.ok ? '✅' : '❌'} ${r.verb.emoji || ''} ${r.verb.inf} – ${pickForm(r.verb, 'past', state.dialect)} – ${pickForm(r.verb, 'pp', state.dialect)}</div>
      <div class="a-text">${r.verb.cs}</div>
    `;
    review.appendChild(item);
  });
}

// ============================================================
// Theme + dialect + menu
// ============================================================

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const ht = $('#theme-toggle');
  if (ht) ht.textContent = state.theme === 'dark' ? '☀️' : '🌙';
  const mi = $('#theme-toggle-menu-icon');
  const ml = $('#theme-toggle-menu-label');
  if (mi) mi.textContent = state.theme === 'dark' ? '☀️' : '🌙';
  if (ml) ml.textContent = state.theme === 'dark' ? t('theme_light') : t('theme_dark');
}
function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', state.theme);
  applyTheme();
}

// ---------- Sound-effects menu toggle ----------
function applySoundEffectsUI() {
  const btn = $('#sound-toggle-menu');
  const ic = $('#sound-toggle-menu-icon');
  const lb = $('#sound-toggle-menu-label');
  const on = !!state.soundEffects;
  if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  if (ic) ic.textContent = on ? '🔔' : '🔕';
  if (lb) lb.textContent = on ? t('sounds_on') : t('sounds_off');
}
function toggleSoundEffects() {
  state.soundEffects = !state.soundEffects;
  localStorage.setItem('soundEffects', state.soundEffects ? 'true' : 'false');
  applySoundEffectsUI();
  // Audible confirmation when turning ON (so the student knows what to expect).
  if (state.soundEffects) playUiSound('correct');
}
function toggleMenu() {
  const d = $('#menu-dropdown');
  const open = d.classList.toggle('open');
  if (open) markActiveMenuItem();
  $('#menu-btn').setAttribute('aria-expanded', open ? 'true' : 'false');
  $('#practice-menu-btn')?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// While practicing on mobile the full header is hidden, so the shared
// #menu-dropdown is reparented to <body> (CSS anchors it under the floating ☰)
// and restored to the header afterwards. Driven by body.practicing + viewport.
const _mqMobile = window.matchMedia('(max-width: 600px)');
function syncPracticeChrome() {
  const dd = $('#menu-dropdown');
  if (!dd) return;
  const wrap = $('.menu-wrap');
  const useFloating = document.body.classList.contains('practicing') && _mqMobile.matches;
  if (useFloating) {
    if (dd.parentElement !== document.body) document.body.appendChild(dd);
  } else {
    if (wrap && dd.parentElement !== wrap) wrap.appendChild(dd);
    dd.classList.remove('open');
    $('#menu-btn')?.setAttribute('aria-expanded', 'false');
    $('#practice-menu-btn')?.setAttribute('aria-expanded', 'false');
  }
}

// ============================================================
// Cloud sync UI helpers
// ============================================================

function applyPremiumUI() {
  document.body.classList.toggle('is-premium', !!state.premium);
  // Premium toggles the visibility of streak-reward UI — keep the header
  // gift badge and the pill label in sync whenever premium state changes.
  updateStreakRewardBadge();
  if (state.data) renderStatsStrip();
}

function updatePortalBtn() {
  const btn = $('#settings-portal');
  if (!btn) return;
  // Show only for signed-in premium users (promo redemptions also see it; backend will return no_customer for those)
  if (cloud.getCurrentUser() && state.premium) btn.classList.remove('hidden');
  else btn.classList.add('hidden');
}

// Headers for authenticated backend calls. The Firebase ID token is verified
// server-side and the uid is derived from it there — the backend no longer
// trusts any uid sent in the body, so we don't send one.
async function backendAuthHeaders() {
  const token = await cloud.getIdToken();
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function openCustomerPortal() {
  if (!BACKEND_URL) { toast(t('backend_unavailable'), 'error'); return; }
  const user = cloud.getCurrentUser();
  if (!user) { toast(t('login_first'), 'error'); return; }
  const btn = $('#settings-portal');
  const origHtml = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = `<span>${t('opening')}</span>`; }
  try {
    const resp = await fetch(`${BACKEND_URL}/create-portal-session`, {
      method: 'POST',
      headers: await backendAuthHeaders(),
      body: JSON.stringify({
        returnUrl: window.location.origin + window.location.pathname,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 404 && data.error === 'no_customer') {
      toast(t('portal_no_customer'), 'info', 6000);
      return;
    }
    if (!resp.ok || !data.url) throw new Error(data.error || 'unknown');
    window.location.href = data.url;
  } catch (e) {
    toast(t('portal_error') + (e.message || e), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
  }
}

function updateCloudUI(user) {
  updatePortalBtn();
  const label = $('#cloud-label');
  const btn = $('#cloud-btn');
  if (label && btn) {
    if (user) {
      const name = user.displayName || user.email || t('account_word');
      label.textContent = t('sign_out_label', name);
      btn.classList.add('signed-in');
    } else {
      label.textContent = t('sign_in_google');
      btn.classList.remove('signed-in');
    }
  }
  // Header Google button
  const gBtn = $('#google-btn');
  const gLabel = $('#google-btn-label');
  if (gBtn && gLabel) {
    if (user) {
      // Show short first name + signed-in style
      const first = (user.displayName || user.email || t('account_word')).split(' ')[0].split('@')[0];
      gLabel.textContent = first.length > 12 ? first.slice(0, 12) + '…' : first;
      gBtn.classList.add('signed-in');
      gBtn.setAttribute('aria-label', t('signed_in_aria', user.displayName || user.email));
      gBtn.title = t('signed_in_title', user.displayName || user.email);
    } else {
      gLabel.textContent = t('sign_in_short');
      gBtn.classList.remove('signed-in');
      gBtn.setAttribute('aria-label', t('sign_in_google'));
      gBtn.title = t('sign_in_google');
    }
  }
}

function showPaywall(sub) {
  const m = $('#paywall');
  m.classList.remove('hidden');
  track('paywall_shown', sub ? { sub: sub.id } : undefined);
  // Inline sign-in prompt if not signed in
  const signin = m.querySelector('#paywall-signin');
  const options = m.querySelector('.paywall-options');
  const refreshSignInState = () => {
    const user = cloud.getCurrentUser();
    if (user) {
      signin.classList.add('hidden');
      options.classList.remove('disabled');
    } else {
      signin.classList.remove('hidden');
      options.classList.add('disabled');
    }
  };
  refreshSignInState();
  m._refreshSignIn = refreshSignInState;
  const signBtn = m.querySelector('#paywall-signin-btn');
  signBtn.onclick = async () => {
    if (handleLoginInWebview('paywall')) return;
    signBtn.disabled = true;
    signBtn.textContent = t('signing_in');
    try {
      await cloud.signIn();
      refreshSignInState();
    } catch (e) {
      toast(t('login_failed') + (e?.message || e), 'error');
    } finally {
      signBtn.disabled = false;
      signBtn.textContent = t('sign_in_google');
    }
  };
  m.querySelectorAll('.paywall-option').forEach((btn) => {
    btn.onclick = () => startCheckout(btn.dataset.plan, btn);
  });
  m.querySelector('#paywall-close').onclick = () => m.classList.add('hidden');
  m.onclick = (e) => { if (e.target === m) m.classList.add('hidden'); };
  // Promo code redemption
  const promoToggle = m.querySelector('#paywall-promo-toggle');
  const promoForm = m.querySelector('#paywall-promo-form');
  const promoInput = m.querySelector('#paywall-promo-input');
  const promoSubmit = m.querySelector('#paywall-promo-submit');
  const promoMsg = m.querySelector('#paywall-promo-msg');
  promoToggle.onclick = () => {
    promoForm.classList.toggle('hidden');
    if (!promoForm.classList.contains('hidden')) setTimeout(() => promoInput.focus(), 50);
  };
  const setMsg = (text, kind) => {
    promoMsg.textContent = text;
    promoMsg.className = 'paywall-promo-msg' + (kind ? ' is-' + kind : '');
  };
  setMsg('', null);
  promoSubmit.onclick = () => redeemPromo(promoInput.value, { promoSubmit, promoInput, setMsg, modal: m });
  promoInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); promoSubmit.click(); } };
}

// Chybové hlášky promo kódů žijí v TEXTS.promo_errors (kvůli jazykovým mutacím).
function promoError(code) {
  const map = t('promo_errors');
  return map && typeof map === 'object' ? map[code] : null;
}

async function redeemPromo(rawCode, ctx) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) { ctx.setMsg(t('promo_enter'), 'error'); return; }
  if (!BACKEND_URL) { ctx.setMsg(promoError('no_backend'), 'error'); return; }
  const user = cloud.getCurrentUser();
  if (!user) {
    ctx.setMsg(promoError('no_user'), 'error');
    // Open inline sign-in in paywall
    const signin = ctx.modal.querySelector('#paywall-signin');
    if (signin) signin.classList.remove('hidden');
    return;
  }
  ctx.promoSubmit.disabled = true;
  ctx.promoInput.disabled = true;
  const origLabel = ctx.promoSubmit.textContent;
  ctx.promoSubmit.textContent = t('promo_checking');
  ctx.setMsg('', null);
  try {
    const resp = await fetch(`${BACKEND_URL}/redeem-code`, {
      method: 'POST',
      headers: await backendAuthHeaders(),
      body: JSON.stringify({ code }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      ctx.setMsg(promoError(data.error) || (t('promo_error_prefix') + (data.error || resp.status)), 'error');
      return;
    }
    // Success — flip local state and close paywall. Mirror the expiry from the
    // backend response so the gate flips back automatically when the year ends,
    // even before the next Firestore sync arrives.
    state.premium = true;
    localStorage.setItem('premium', 'true');
    if (data.premiumExpiresAt) {
      localStorage.setItem('premiumExpiresAt', String(data.premiumExpiresAt));
    } else {
      localStorage.removeItem('premiumExpiresAt');
    }
    applyPremiumUI();
    updatePortalBtn();
    track('promo_redeemed', { code });
    ctx.setMsg(t('promo_ok_msg'), 'success');
    toast(t('promo_ok_toast'), 'success', 5000);
    setTimeout(() => {
      ctx.modal.classList.add('hidden');
      renderLessonPicker();
      renderBrowse();
      renderFlashcards();
    }, 1200);
  } catch (e) {
    ctx.setMsg(promoError('network'), 'error');
  } finally {
    ctx.promoSubmit.disabled = false;
    ctx.promoInput.disabled = false;
    ctx.promoSubmit.textContent = origLabel;
  }
}

// Toast notifications (replaces window.alert)
function toast(message, type = 'info', duration = 4500) {
  const c = document.getElementById('toast-container');
  if (!c) { console.log('[toast]', message); return; }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = message;
  c.appendChild(t);
  // Animate in
  requestAnimationFrame(() => t.classList.add('show'));
  const close = () => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 250);
  };
  t.addEventListener('click', close);
  setTimeout(close, duration);
}

async function startCheckout(plan, btn) {
  const price = STRIPE_PRICES[plan];
  if (!price) return;
  track('checkout_started', { plan });
  if (!BACKEND_URL) {
    toast(t('backend_wait'), 'error');
    return;
  }
  const user = cloud.getCurrentUser();
  if (!user) {
    // Show inline sign-in prompt in paywall instead of alert
    const m = $('#paywall');
    if (m && m._refreshSignIn) m._refreshSignIn();
    return;
  }
  const orig = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = t('loading'); }
  try {
    const resp = await fetch(`${BACKEND_URL}/create-checkout-session`, {
      method: 'POST',
      headers: await backendAuthHeaders(),
      body: JSON.stringify({
        priceId: price.id,
        mode: price.mode,
        returnUrl: window.location.origin + window.location.pathname,
        email: user.email,
        locale: LANG, // jazyk Stripe Checkoutu; backend má whitelist s fallbackem na 'cs'
      }),
    });
    const data = await resp.json();
    if (data.url) window.location.href = data.url;
    else throw new Error(data.error || 'unknown error');
  } catch (e) {
    toast(t('checkout_error') + e.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
  }
}

function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('premium');
  if (!status) return;
  // Clean URL so refresh doesn't re-trigger
  const url = window.location.origin + window.location.pathname;
  history.replaceState({}, '', url);
  if (status === 'success') {
    track('payment_success');
    updatePortalBtn();
    setTimeout(() => toast(t('toast_pay_ok'), 'success', 6000), 300);
  } else if (status === 'cancel') {
    track('payment_cancelled');
    setTimeout(() => toast(t('toast_pay_cancel'), 'info'), 300);
  }
}

function updateSyncStatus(status) {
  const dot = $('#cloud-status');
  if (!dot) return;
  dot.dataset.status = status;
  const titles = t('sync_titles');
  dot.title = titles[status] || status;
}

// ============================================================
// TEACHER MODE — generátor tisknutelných testů
// ============================================================

const teacher = {
  selected: new Set(), // ids vybraných skupin (sub.id)
  pages: null,         // poslední vygenerovaný test: { tests: [html], key: html }
};

function teacherSelectedSubs() {
  const out = [];
  state.data.sections.forEach((sec) =>
    sec.subsections.forEach((sub) => { if (teacher.selected.has(sub.id)) out.push(sub); })
  );
  return out;
}

function updateTeacherCount() {
  const subs = teacherSelectedSubs();
  const n = subs.reduce((a, s) => a + s.verbs.length, 0);
  $('#teacher-count-info').textContent = subs.length ? t('teacher_selected', n, subs.length) : '';
}

function renderTeacherSetup() {
  const c = $('#teacher-groups');
  if (!c) return;
  c.innerHTML = '';
  state.data.sections.forEach((sec) => {
    const head = document.createElement('div');
    head.className = 'teacher-sec-head';
    head.innerHTML = `
      <span class="teacher-sec-name">${sec.id} · ${sec.title}</span>
      <span class="teacher-sec-btns">
        <button type="button" class="teacher-mini-btn" data-act="all">${t('teacher_pick_all')}</button>
        <button type="button" class="teacher-mini-btn" data-act="none">${t('teacher_pick_none')}</button>
      </span>`;
    c.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'teacher-grid';
    sec.subsections.forEach((sub) => {
      const label = document.createElement('label');
      label.className = 'teacher-group';
      label.innerHTML = `
        <input type="checkbox" data-sub="${sub.id}" ${teacher.selected.has(sub.id) ? 'checked' : ''} />
        <span class="teacher-group-main">
          <span class="teacher-group-top">
            <span class="teacher-group-pattern">${sub.pattern}</span>
            <span class="teacher-group-count">${sub.verbs.length}</span>
          </span>
          <span class="teacher-group-verbs">${sub.verbs.map((v) => v.inf).join(', ')}</span>
        </span>`;
      grid.appendChild(label);
    });
    c.appendChild(grid);
    const setAll = (on) => {
      sec.subsections.forEach((sub) => { if (on) teacher.selected.add(sub.id); else teacher.selected.delete(sub.id); });
      grid.querySelectorAll('input').forEach((i) => { i.checked = on; });
      updateTeacherCount();
    };
    head.querySelector('[data-act="all"]').addEventListener('click', () => setAll(true));
    head.querySelector('[data-act="none"]').addEventListener('click', () => setAll(false));
  });
  c.addEventListener('change', (e) => {
    const id = e.target && e.target.dataset ? e.target.dataset.sub : null;
    if (!id) return;
    if (e.target.checked) teacher.selected.add(id); else teacher.selected.delete(id);
    updateTeacherCount();
  });
  updateTeacherCount();

  // Překlad je u typu "česky → 3 tvary" vždy v zadání — checkbox nedává smysl
  $$('input[name="tt-type"]').forEach((r) => r.addEventListener('change', () => {
    $('#tt-cs-row').style.display = r.value === 'cs3' && r.checked ? 'none' : '';
  }));

  $('#teacher-generate').addEventListener('click', () => teacherGenerate());
  $('#teacher-reshuffle').addEventListener('click', () => teacherGenerate());
  $('#teacher-print-test').addEventListener('click', () => teacherPrint('test'));
  $('#teacher-print-key').addEventListener('click', () => teacherPrint('key'));
  window.addEventListener('afterprint', () => {
    document.body.classList.remove('printing');
    $('#print-area').innerHTML = '';
  });

  // Záložky „Na papír / Odkazem“ — každá forma zadání ukazuje jen svoje volby.
  $$('.tt-tab').forEach((tab) => tab.addEventListener('click', () => {
    const which = tab.dataset.tab;
    $$('.tt-tab').forEach((b) => {
      const on = b === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('#tt-pane-paper').classList.toggle('hidden', which !== 'paper');
    $('#tt-pane-digital').classList.toggle('hidden', which !== 'digital');
    // Náhled papírového testu nedává smysl u online zadání.
    if (which === 'digital') $('#teacher-result').hidden = true;
  }));

  // Digitální test
  $('#dt-make-link')?.addEventListener('click', dtCreateLink);
  $('#dt-copy-link')?.addEventListener('click', dtCopyLink);
  $('#dt-verify-btn')?.addEventListener('click', dtRunVerify);
  $('#dt-link')?.addEventListener('focus', (e) => e.target.select());
  // Ověřovací pole si pamatuje poslední vytvořený test i po reloadu.
  try {
    const last = localStorage.getItem('dtLastTest');
    if (last) { teacher.testCode = last; $('#dt-verify-test').value = last; }
  } catch (_) {}
}

function teacherSettings() {
  const type = (document.querySelector('input[name="tt-type"]:checked') || {}).value || 'inf2';
  return {
    count: Math.max(3, Math.min(106, parseInt($('#tt-count').value, 10) || 20)),
    type,
    variants: $('#tt-variants').checked,
    // U "česky → 3 tvary" je překlad součástí zadání vždy
    showCs: type === 'cs3' ? true : $('#tt-cs').checked,
    color: (document.querySelector('input[name="tt-color"]:checked') || {}).value === 'color',
    // Bodování digitálního testu: 'verb' = celé sloveso za bod, 'form' = po tvarech
    scoring: (document.querySelector('input[name="tt-scoring"]:checked') || {}).value || 'verb',
  };
}

// Všechny platné tvary pro klíč (learnt / learned, gotten…)
function ttForms(v, which) {
  const forms = [v[which]];
  [v[which + 'Alt'], v[which + 'Am']].forEach((f) => { if (f && !forms.includes(f)) forms.push(f); });
  return forms.join(' / ');
}

// Pseudopravidelný tvar jako distraktor (beginned, cutted — typická žákovská chyba)
function ttRegular(inf) {
  return inf.endsWith('e') ? inf + 'd' : inf + 'ed';
}

function teacherBuildVariant(pool, s) {
  const verbs = shuffle(pool).slice(0, Math.min(s.count, pool.length));
  return verbs.map((v) => {
    const row = { v };
    if (s.type === 'missing') {
      row.blank = ['inf', 'past', 'pp'][Math.floor(Math.random() * 3)];
    } else if (s.type === 'choice') {
      const correct = `${v.past} – ${v.pp}`;
      const reg = ttRegular(v.inf);
      const opts = [correct];
      [`${reg} – ${reg}`, v.past !== v.pp ? `${v.pp} – ${v.past}` : `${v.past} – ${reg}`, `${v.inf} – ${reg}`]
        .forEach((d) => { if (opts.length < 3 && !opts.includes(d)) opts.push(d); });
      row.opts = shuffle(opts);
      row.correct = row.opts.indexOf(correct);
    }
    return row;
  });
}

function teacherGroupsLine(subs) {
  if (subs.length > 8) return t('teacher_groups_label') + t('teacher_groups_mix', subs.length);
  return t('teacher_groups_label') + subs.map((s) => s.pattern).join(' · ');
}

function teacherDocHeader(s, titleKey, variantLabel, subs) {
  return `
    <div class="tt-doc-header">
      <div class="tt-domain">${t('teacher_domain')}</div>
      <div class="tt-title-row">
        ${s.color ? '<img class="tt-logo" src="icon-192.png" alt="" />' : ''}
        <div class="tt-title-block">
          <h1>${t(titleKey)}${variantLabel ? ` — ${t('teacher_variant', variantLabel)}` : ''}</h1>
          <div class="tt-sub">${teacherGroupsLine(subs)}</div>
        </div>
      </div>
    </div>`;
}

function teacherCols(s) {
  const cols = [{ key: 'num', label: '' }];
  if (s.type === 'cs3') cols.push({ key: 'cs', label: t('teacher_col_cs') });
  cols.push(
    { key: 'inf', label: t('teacher_col_inf') },
    { key: 'past', label: t('teacher_col_past') },
    { key: 'pp', label: t('teacher_col_pp') }
  );
  if (s.showCs && s.type !== 'cs3') cols.push({ key: 'cs', label: t('teacher_col_cs') });
  return cols;
}

function teacherCard(cols, rowsHtml) {
  const colsCss = cols.map((c) => (c.key === 'num' ? '26px' : '1fr')).join(' ');
  return `
    <div class="tt-card" style="--tt-cols:${colsCss}">
      <div class="tt-card-head"><div class="tt-cols-head">${cols.map((c) => `<span class="tt-col-label">${c.label}</span>`).join('')}</div></div>
      ${rowsHtml.join('')}
    </div>`;
}

function teacherRow(cols, r, i, total, s, isKey) {
  const v = r.v;
  const emoji = `<span class="tt-emoji">${v.emoji}</span>`;
  // Když je infinitiv v testu prázdný (cs3 / missing), obrázek putuje k češtině
  const infBlank = !isKey && (s.type === 'cs3' || (s.type === 'missing' && r.blank === 'inf'));
  const cells = cols.map((c) => {
    if (c.key === 'num') return `<span class="tt-cnum">${i + 1}.</span>`;
    if (c.key === 'cs') return `<span class="tt-vcs">${infBlank ? emoji : ''}${v.cs}</span>`;
    // Slovesné tvary: v testu se podle typu vynechávají, v klíči jsou všechny
    const isBlank = !isKey && (s.type === 'cs3' || (s.type === 'missing' ? r.blank === c.key : c.key !== 'inf'));
    if (isBlank) return '<span class="tt-write"></span>';
    const form = isKey ? ttForms(v, c.key) : v[c.key];
    return `<span class="tt-vinf">${c.key === 'inf' ? emoji : ''}<b class="tt-vform">${form}</b></span>`;
  });
  return `<div class="tt-row">${cells.join('')}</div>`;
}

function teacherTestPage(rows, s, subs, variantLabel) {
  const total = rows.length;
  let body;
  if (s.type === 'choice') {
    body = `<div class="tt-choices">${rows.map((r, i) => `
      <div class="tt-choice-row">
        <span class="tt-choice-q">${i + 1}. <span class="tt-emoji">${r.v.emoji}</span><b>${r.v.inf}</b>${s.showCs ? ` <span class="tt-vcs">(${r.v.cs})</span>` : ''}</span>
        <span class="tt-choice-opts">${r.opts.map((o, j) => `<span>${'abc'[j]})&nbsp;${o}</span>`).join('')}</span>
      </div>`).join('')}</div>`;
  } else {
    const cols = teacherCols(s);
    body = teacherCard(cols, rows.map((r, i) => teacherRow(cols, r, i, total, s, false)));
  }
  return `
  <div class="tt-page ${s.color ? 'tt-color' : 'tt-bw'}">
    ${teacherDocHeader(s, 'teacher_test_title', variantLabel, subs)}
    <div class="tt-meta">
      <span class="tt-meta-cell"><span class="tt-meta-label">${t('teacher_name').replace(/:$/, '')}</span></span>
      <span class="tt-meta-cell"><span class="tt-meta-label">${t('teacher_class').replace(/:$/, '')}</span></span>
      <span class="tt-meta-cell"><span class="tt-meta-label">${t('teacher_date').replace(/:$/, '')}</span></span>
    </div>
    <p class="tt-instr">${t('teacher_instr_' + s.type)}</p>
    ${body}
    <div class="tt-scorebar">
      <span class="tt-meta-cell"><span class="tt-meta-label">${t('teacher_score').replace(/:$/, '')}</span></span>
      <span class="tt-meta-cell"><span class="tt-meta-label">${t('teacher_grade').replace(/:$/, '')}</span></span>
    </div>
    <div class="tt-foot">${t('teacher_footer')}</div>
  </div>`;
}

function teacherKeyPage(variants, s, subs) {
  const blocks = variants.map(({ label, rows }) => {
    const total = rows.length;
    let card;
    if (s.type === 'choice') {
      const cols = [
        { key: 'num', label: '' },
        { key: 'inf', label: t('teacher_col_inf') },
        { key: 'ok', label: '✔' },
        { key: 'cs', label: t('teacher_col_cs') },
      ];
      card = teacherCard(cols, rows.map((r, i) => `
        <div class="tt-row">
          <span class="tt-cnum">${i + 1}.</span>
          <span class="tt-vinf"><span class="tt-emoji">${r.v.emoji}</span><b class="tt-vform">${r.v.inf}</b></span>
          <span class="tt-key-correct">${'abc'[r.correct]}) ${r.opts[r.correct]}</span>
          <span class="tt-vcs">${r.v.cs}</span>
        </div>`));
    } else {
      const cols = [
        { key: 'num', label: '' },
        { key: 'inf', label: t('teacher_col_inf') },
        { key: 'past', label: t('teacher_col_past') },
        { key: 'pp', label: t('teacher_col_pp') },
        { key: 'cs', label: t('teacher_col_cs') },
      ];
      card = teacherCard(cols, rows.map((r, i) => teacherRow(cols, r, i, total, s, true)));
    }
    return `${label ? `<h3 class="tt-key-variant">${t('teacher_variant', label)}</h3>` : ''}${card}`;
  }).join('');
  return `
  <div class="tt-page tt-key ${s.color ? 'tt-color' : 'tt-bw'}">
    ${teacherDocHeader(s, 'teacher_key_title', null, subs)}
    <p class="tt-instr">${t('teacher_key_correct')}</p>
    ${blocks}
    <div class="tt-foot">${t('teacher_footer')}</div>
  </div>`;
}

function teacherGenerate() {
  const subs = teacherSelectedSubs();
  if (!subs.length) { toast(t('teacher_none_selected'), 'error'); return; }
  const s = teacherSettings();
  const pool = subs.flatMap((sub) => sub.verbs);
  const labels = s.variants ? ['A', 'B'] : [null];
  const variants = labels.map((label) => ({ label, rows: teacherBuildVariant(pool, s) }));
  teacher.pages = {
    tests: variants.map((v) => teacherTestPage(v.rows, s, subs, v.label)),
    key: teacherKeyPage(variants, s, subs),
  };
  const result = $('#teacher-result');
  $('#teacher-preview').innerHTML = teacher.pages.tests.join('') + teacher.pages.key;
  result.hidden = false;
  result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  track('teacher_test_generated', { type: s.type, verbs: String(Math.min(s.count, pool.length)) });
}

function teacherPrint(kind) {
  if (!teacher.pages) return;
  $('#print-area').innerHTML = kind === 'key' ? teacher.pages.key : teacher.pages.tests.join('');
  document.body.classList.add('printing');
  window.print();
}

// ============================================================
// DIGITÁLNÍ TEST — sdílený odkaz (#/test/<kód>) + kód o odevzdání
//
// Celé zadání je zakódované v odkazu, nic se neukládá na server: každý, kdo
// odkaz otevře, dostane díky seedovanému generátoru přesně stejný test.
// Po dokončení dostane žák kód o odevzdání (jméno · skóre · pokus · kontrolní
// součet), který pošle učiteli; ten ho ověří v Teacher mode.
// ============================================================

// Deterministický RNG (mulberry32) — stejný seed = stejné otázky pro celou třídu.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWith(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Náhodnost kvízu: v zadaném testu jede přes seed, jinak Math.random.
function qRand() {
  return state.quiz.rng ? state.quiz.rng() : Math.random();
}

function allSubIdsInOrder() {
  const out = [];
  state.data.sections.forEach((sec) => sec.subsections.forEach((sub) => out.push(sub.id)));
  return out;
}

// Typy testu v odkazu. Pořadí je součástí formátu kódu — nové typy se přidávají
// jen na konec. Mapování z papírového Teacher mode: inf2→fill, cs3→cs3,
// missing→missing, choice→mc.
const DT_TYPES = ['mixed', 'mc', 'fill', 'cs3', 'missing'];
const DT_TYPE_FROM_PAPER = { inf2: 'fill', cs3: 'cs3', missing: 'missing', choice: 'mc' };
// Kontrolní součet kódů je jen proti přepsání skóre "od stolu" — klíč je
// nutně v klientu, takže odhodlaného žáka nezastaví (viz docs).
const DT_SALT = 'ucseslovesa-dt-2026';

function dtHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36).toUpperCase().padStart(4, '0').slice(-4);
}

// Zadání → krátký řetězec do odkazu. Bitové pole: skupiny | počet | typ | jméno | seed
function dtEncode(cfg) {
  const all = allSubIdsInOrder();
  let v = 0n;
  for (let i = all.length - 1; i >= 0; i--) {
    v = (v << 1n) | (cfg.subIds.includes(all[i]) ? 1n : 0n);
  }
  v = (v << 7n) | BigInt(Math.max(1, Math.min(127, cfg.count)));
  v = (v << 3n) | BigInt(Math.max(0, DT_TYPES.indexOf(cfg.type)));
  v = (v << 1n) | BigInt(cfg.askName ? 1 : 0);
  v = (v << 1n) | BigInt(cfg.scoring === 'form' ? 1 : 0);
  v = (v << 16n) | BigInt(cfg.seed & 0xffff);
  const payload = v.toString(36);
  // Dvouznakový kontrolní součet: bez něj by se náhodný/překlepnutý odkaz
  // dekódoval na "nějaké" zadání a žák by dostal test, který nikdo nezadal.
  return payload + dtCheck(payload);
}

function dtCheck(payload) {
  return dtHash(payload + DT_SALT).slice(0, 2).toLowerCase();
}

function dtDecode(code) {
  try {
    if (!/^[0-9a-z]{4,40}$/i.test(code)) return null;
    const payload = code.slice(0, -2).toLowerCase();
    if (dtCheck(payload) !== code.slice(-2).toLowerCase()) return null;
    let v = 0n;
    for (const ch of payload) {
      const d = BigInt(parseInt(ch, 36));
      if (Number.isNaN(Number(d))) return null;
      v = v * 36n + d;
    }
    const seed = Number(v & 0xffffn); v >>= 16n;
    const scoring = Number(v & 1n) === 1 ? 'form' : 'verb'; v >>= 1n;
    const askName = Number(v & 1n) === 1; v >>= 1n;
    const type = DT_TYPES[Number(v & 7n)] || 'mixed'; v >>= 3n;
    const count = Number(v & 127n); v >>= 7n;
    const all = allSubIdsInOrder();
    const subIds = all.filter((_, i) => ((v >> BigInt(i)) & 1n) === 1n);
    if (!subIds.length || !count) return null;
    return { subIds, count, type, askName, scoring, seed };
  } catch (_) { return null; }
}

// Slovesa testu — vždy ve stejném pořadí pro daný odkaz.
function dtBuildPool(cfg) {
  const sel = new Set(cfg.subIds);
  const all = flattenVerbs(state.data, sel);
  const rnd = mulberry32(cfg.seed);
  return shuffleWith(all, rnd).slice(0, Math.min(cfg.count, all.length));
}

// --- Kód o odevzdání ---
function dtMakeCode({ testCode, name, verified, score, total, attempt, wrong }) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  // Chybné odpovědi: "!3=speaked,7=writed|writen" (číslo otázky = pořadí v testu).
  // Správné se nepřenášejí — učitel je zná z klíče, kód tak zůstane krátký.
  const wrongStr = dtWrongToString(wrong);
  const base = [testCode, clean.toLowerCase(), verified ? '1' : '0', score, total, attempt, wrongStr].join('|');
  const sum = dtHash(base + DT_SALT);
  const who = clean ? `${clean}${verified ? ' ✓' : ''} · ` : '';
  const wrongPart = wrongStr ? `!${wrongStr} · ` : '';
  // Slovo "pokus" jde z TEXTS — kontrolní součet se počítá jen z `base`, takže
  // jazyk kódu jeho platnost neovlivní (učitel ověří i kód z jiné mutace).
  return `${who}${score}/${total} · ${t('dt_code_attempt', attempt)} · ${wrongPart}${sum}`;
}

// [{i, typed:[]}] → "3=speaked,7=writed|writen". Oddělovače z odpovědí vyházíme,
// aby nerozbily formát (žák může napsat cokoli).
function dtWrongToString(wrong) {
  if (!Array.isArray(wrong) || !wrong.length) return '';
  return wrong.map((w) => {
    const vals = (w.typed || []).map((x) => String(x).replace(/[,|=!·]/g, '').trim() || '—').join('|');
    return `${w.i}=${vals}`;
  }).join(',');
}

function dtWrongFromString(s) {
  if (!s) return [];
  return s.split(',').map((chunk) => {
    const m = /^(\d+)=(.*)$/.exec(chunk.trim());
    if (!m) return null;
    return { i: Number(m[1]), typed: m[2].split('|') };
  }).filter(Boolean);
}

// Rozebere řádek zpět. Jméno může obsahovat cokoli — bereme ho jako zbytek
// před posledními třemi částmi.
function dtParseCode(line) {
  let parts = String(line).split('·').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  // Volitelná sekce s chybami: část začínající "!" (může chybět u plného počtu)
  let wrongStr = '';
  const wIdx = parts.findIndex((p) => p.startsWith('!'));
  if (wIdx !== -1) {
    wrongStr = parts[wIdx].slice(1);
    parts = parts.filter((_, i) => i !== wIdx);
  }
  const sum = parts[parts.length - 1];
  // Číslo pokusu bereme odkudkoli z té části — formulace se liší podle jazyka
  // („1. pokus“, „1. próba“, …), číslo je jediné, co je společné.
  const attemptM = /(\d+)/.exec(parts[parts.length - 2]);
  const scoreM = /^(\d+)\s*\/\s*(\d+)$/.exec(parts[parts.length - 3]);
  if (!attemptM || !scoreM) return null;
  const nameRaw = parts.slice(0, parts.length - 3).join(' · ');
  const verified = /✓\s*$/.test(nameRaw);
  const name = nameRaw.replace(/✓\s*$/, '').trim();
  return {
    name, verified, sum, wrongStr, wrong: dtWrongFromString(wrongStr),
    score: Number(scoreM[1]), total: Number(scoreM[2]), attempt: Number(attemptM[1]),
  };
}

function dtVerifyCode(line, testCode) {
  const p = dtParseCode(line);
  if (!p) return null;
  const expected = dtMakeCode({ ...p, testCode });
  return { ...p, valid: dtParseCode(expected)?.sum === p.sum };
}

// --- Žákovská strana ---

// Kolikátý pokus to na tomhle zařízení je. Smazat úložiště jde, ale běžný
// žák to neudělá — učitel tak aspoň vidí opakované pokusy.
function dtAttemptsDone(testCode) {
  try {
    const map = JSON.parse(localStorage.getItem('dtAttempts') || '{}');
    return Number(map[testCode]) || 0;
  } catch (_) { return 0; }
}

function dtBumpAttempt(testCode) {
  const n = dtAttemptsDone(testCode) + 1;
  try {
    const map = JSON.parse(localStorage.getItem('dtAttempts') || '{}');
    map[testCode] = n;
    localStorage.setItem('dtAttempts', JSON.stringify(map));
  } catch (_) {}
  return n;
}

// Otevření odkazu #/test/<kód>
function dtOpen(code) {
  const cfg = dtDecode(code);
  if (!cfg) { toast(t('dt_bad_link'), 'error', 6000); setView('lesson'); return; }
  state.quiz.test = { ...cfg, code };
  setView('quiz');
  $('.quiz-setup').classList.add('hidden');
  $('.quiz-play').classList.add('hidden');
  $('.quiz-done').classList.add('hidden');
  const intro = $('#dt-intro');
  intro.classList.remove('hidden');
  const pool = dtBuildPool(cfg);
  $('#dt-intro-sub').textContent = t('dt_intro_sub', pool.length);
  const nameRow = $('#dt-name-row');
  nameRow.classList.toggle('hidden', !cfg.askName);
  if (cfg.askName) {
    const user = cloud.getCurrentUser();
    const input = $('#dt-name');
    if (user && user.displayName && !input.value) {
      input.value = user.displayName;
      input.dataset.fromAccount = user.displayName;
    }
    $('#dt-name-hint').classList.toggle('hidden', !input.dataset.fromAccount);
  }
  // Kolikátý pokus se právě chystá (dokončené + 1)
  const nextAttempt = dtAttemptsDone(code) + 1;
  $('#dt-attempt-note').textContent = nextAttempt > 1 ? t('dt_attempt_note', nextAttempt) : '';
  track('dt_test_opened', { verbs: String(pool.length) });
}

function dtStartTest() {
  const cfg = state.quiz.test;
  if (!cfg) return;
  if (cfg.askName && !$('#dt-name').value.trim()) {
    toast(t('dt_name_missing'), 'error');
    $('#dt-name').focus();
    return;
  }
  const pool = dtBuildPool(cfg);
  state.quiz.pool = pool;
  state.quiz.idx = 0;
  state.quiz.score = 0;
  state.quiz.maxScore = 0;
  state.quiz.scoring = cfg.scoring || 'verb';
  state.quiz.total = pool.length;
  state.quiz.type = cfg.type;
  state.quiz.review = [];
  state.quiz.attempt = dtBumpAttempt(cfg.code);
  $('#quiz-total').textContent = pool.length;
  $('#dt-intro').classList.add('hidden');
  $('.quiz-done').classList.add('hidden');
  $('.quiz-play').classList.remove('hidden');
  quizRender();
}

// Po dokončení: v zadaném testu připoj kód o odevzdání.
function dtRenderResult() {
  const box = $('#dt-result');
  if (!box) return;
  const cfg = state.quiz.test;
  if (!cfg) { box.classList.add('hidden'); return; }
  const input = $('#dt-name');
  const typed = cfg.askName ? input.value.trim() : '';
  const verified = !!(cfg.askName && input.dataset.fromAccount
    && input.dataset.fromAccount.trim() === typed);
  // Co žák vyplnil špatně — jen tyhle odpovědi jdou do kódu (viz dtMakeCode)
  const wrong = state.quiz.review
    .map((r, i) => (r.ok ? null : { i: i + 1, typed: r.typed || [] }))
    .filter(Boolean);
  const code = dtMakeCode({
    testCode: cfg.code,
    name: typed,
    verified,
    score: state.quiz.score,
    total: state.quiz.maxScore || state.quiz.total,
    attempt: state.quiz.attempt || 1,
    wrong,
  });
  $('#dt-code').textContent = code;
  box.classList.remove('hidden');
  $('#dt-copy-code').onclick = () => {
    navigator.clipboard.writeText(code)
      .then(() => toast(t('dt_code_copied'), 'success'))
      .catch(() => toast(t('dt_copy_fail'), 'error'));
  };
  track('dt_test_finished', { score: `${state.quiz.score}/${state.quiz.total}` });
}

// --- Učitelská strana ---

function dtCreateLink() {
  const subs = teacherSelectedSubs();
  if (!subs.length) { toast(t('teacher_none_selected'), 'error'); return; }
  // Premium brána: odkaz mimo skupiny zdarma smí vytvořit jen předplatitel.
  // Vytvořený odkaz pak funguje každému žákovi v plném rozsahu.
  if (!state.premium && subs.some((s) => !isFreeSub(s.id))) {
    toast(t('dt_premium_blocked'), 'error', 6000);
    showPaywall();
    return;
  }
  const s = teacherSettings();
  const cfg = {
    subIds: subs.map((x) => x.id),
    count: Math.min(s.count, subs.reduce((n, x) => n + x.verbs.length, 0)),
    // Digitální test respektuje typ zvolený výše pro papír.
    type: DT_TYPE_FROM_PAPER[s.type] || 'mixed',
    askName: $('#dt-ask-name').checked,
    scoring: s.scoring,
    seed: Math.floor(Math.random() * 0xffff),
  };
  const code = dtEncode(cfg);
  teacher.testCode = code;
  try { localStorage.setItem('dtLastTest', code); } catch (_) {}
  const url = `${location.origin}${location.pathname}#/test/${code}`;
  $('#dt-link-box').classList.remove('hidden');
  $('#dt-link').value = url;
  $('#dt-verify-test').value = code;
  track('dt_link_created', { verbs: String(cfg.count) });
}

function dtCopyLink() {
  const url = $('#dt-link').value;
  navigator.clipboard.writeText(url)
    .then(() => toast(t('dt_copied'), 'success'))
    .catch(() => toast(t('dt_copy_fail'), 'error'));
}

function dtRunVerify() {
  const testCode = $('#dt-verify-test').value.trim();
  const raw = $('#dt-verify-input').value.trim();
  const out = $('#dt-verify-out');
  if (!testCode) { toast(t('dt_verify_no_test'), 'error'); return; }
  if (!raw) { toast(t('dt_verify_empty'), 'error'); return; }
  const rows = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  let ok = 0;
  const body = rows.map((line) => {
    const r = dtVerifyCode(line, testCode);
    if (!r) {
      return `<tr class="dt-row-bad"><td colspan="4">${line}</td><td>${t('dt_verify_bad')}</td></tr>`;
    }
    if (r.valid) ok++;
    const wrongCells = (r.wrong || []).length
      ? r.wrong.map((w) => `<span class="dt-wrong-item"><b>${w.i}.</b> ${w.typed.join(' / ')}</span>`).join('')
      : `<span class="dt-all-ok">${t('dt_verify_no_mistakes')}</span>`;
    return `<tr class="${r.valid ? '' : 'dt-row-bad'}">
      <td>${r.name || '—'}${r.verified ? ` <span class="dt-verified" title="${t('dt_verify_verified')}">✓</span>` : ''}</td>
      <td>${r.score}/${r.total}</td>
      <td>${r.attempt}.</td>
      <td class="dt-wrong-cell">${wrongCells}</td>
      <td>${r.valid ? t('dt_verify_ok') : t('dt_verify_bad')}</td>
    </tr>`;
  }).join('');
  out.innerHTML = `
    <p class="dt-verify-summary">${t('dt_verify_summary', ok, rows.length)}</p>
    <table class="dt-verify-table">
      <thead><tr>
        <th>${t('dt_verify_col_name')}</th><th>${t('dt_verify_col_score')}</th>
        <th>${t('dt_verify_col_attempt')}</th><th>${t('dt_verify_col_wrong')}</th><th>${t('dt_verify_col_state')}</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  out.classList.remove('hidden');
}

// ============================================================
// Init
// ============================================================

async function init() {
  applyTheme();
  applyPremiumUI();
  state.data = await fetch('data/verbs.json').then((r) => r.json());
  localizeData(state.data); // jazyková mutace může přepsat překlady/patterny

  $('#verb-count').textContent = flattenVerbs(state.data).length;

  renderLessonPicker();
  renderBrowse();
  renderFlashcards();
  renderAutoSetup();
  renderTeacherSetup();
  renderSectionChips($('#quiz-filter'), state.quiz.selectedSections);
  renderStatsStrip();
  // Backfill: if a user upgrades to this build with an already-running streak,
  // mark every milestone they passed as pending so they can claim retroactively.
  checkStreakMilestones();
  updateStreakRewardBadge();

  // Cloud sync wiring
  cloud.setListeners({
    onUser: (user) => {
      const wasSignedIn = !!state.user;
      state.user = user || null;
      updateCloudUI(user);
      // Sign-out: revoke server-authoritative entitlements locally.
      // Progress / studyDays / streakRewards stay so the user doesn't lose
      // learning state by signing out and back in, but premium is gated on
      // the Stripe webhook → Firestore link, so it must drop immediately.
      if (wasSignedIn && !user) {
        state.premium = false;
        localStorage.setItem('premium', 'false');
        applyPremiumUI();
        updatePortalBtn();
        renderLessonPicker();
        renderBrowse();
        renderFlashcards();
      }
      // First-time signed-in user → ask preferred tone
      if (user && localStorage.getItem('styleAsked') !== 'true') {
        // Slight delay so it doesn't fight the sign-in popup teardown
        setTimeout(() => openToneModal(), 350);
      }
    },
    onSync: (status) => updateSyncStatus(status),
  });
  document.addEventListener('cloud-merged', () => {
    state.progress = JSON.parse(localStorage.getItem('progress') || '{}');
    state.premium = isPremiumActive();
    state.streakRewards = loadStreakRewards();
    updateStreakRewardBadge();
    applyPremiumUI();
    updatePortalBtn();
    // Resume card visibility depends on cloud-synced activeLesson — re-render below picks it up.
    // Reflect cloud-synced style preference in menu toggle + texts
    const syncedStyle = localStorage.getItem('style');
    if (syncedStyle === 'pro' || syncedStyle === 'student' || syncedStyle === 'hantec') {
      state.style = syncedStyle;
      $$('.menu-style-btn').forEach((b) => b.classList.toggle('active', b.dataset.style === state.style));
      applyStyleTexts();
    }
    renderLessonPicker();
    renderStatsStrip();
    renderBrowse();
    renderFlashcards();
  });
  $('#settings-portal')?.addEventListener('click', openCustomerPortal);
  $('#google-btn')?.addEventListener('click', () => {
    if (cloud.getCurrentUser()) {
      if (confirm(t('signout_confirm'))) cloud.signOutNow();
    } else {
      if (handleLoginInWebview('header_btn')) return;
      cloud.signIn().catch((e) => toast(t('login_failed') + (e?.message || e), 'error'));
    }
  });
  $('#cloud-btn').addEventListener('click', () => {
    if (cloud.getCurrentUser()) {
      if (confirm(t('signout_confirm'))) cloud.signOutNow();
    } else {
      if (handleLoginInWebview('menu_cloud')) return;
      cloud.signIn();
    }
  });

  // Menu
  $('#menu-btn').addEventListener('click', toggleMenu);
  $('#practice-menu-btn')?.addEventListener('click', toggleMenu);
  document.addEventListener('click', (e) => {
    // Treat the menu trigger(s) and the dropdown itself as "inside" — the
    // dropdown may be reparented to <body> while practicing on mobile.
    if (!e.target.closest('.menu-wrap') &&
        !e.target.closest('#menu-dropdown') &&
        !e.target.closest('#practice-menu-btn')) {
      $('#menu-dropdown').classList.remove('open');
      $('#menu-btn').setAttribute('aria-expanded', 'false');
      $('#practice-menu-btn')?.setAttribute('aria-expanded', 'false');
    }
  });
  // Keep the floating ☰ / header-menu chrome in sync with practice state and
  // viewport size (handles rotation / resize across the mobile breakpoint).
  new MutationObserver(syncPracticeChrome)
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  _mqMobile.addEventListener('change', syncPracticeChrome);
  syncPracticeChrome();
  // Only menu items with a data-view attribute should route to setView() —
  // other .menu-item buttons (theme toggle, sound toggle, cloud sign-in,
  // billing portal) handle their own action and would crash setView(undefined).
  $$('.menu-item[data-view]').forEach((b) => b.addEventListener('click', () => {
    // If audio session running, stop it before switching views
    if (autoSession && b.dataset.view !== 'auto') autoStop();
    // Premium gate: Car mode is Premium-only
    if (b.dataset.view === 'auto' && !state.premium) {
      showPaywall();
      return;
    }
    setView(b.dataset.view);
    if (b.dataset.view === 'auto') renderAutoSetup();
  }));
  $('#auto-start')?.addEventListener('click', autoStart);
  $('#auto-stop')?.addEventListener('click', autoStopOrExit);
  $('#auto-play')?.addEventListener('click', autoResume);
  $('#auto-shuffle')?.addEventListener('click', autoShuffleRemaining);
  // Style toggle (Pracující / Student)
  const reflectStyleBtns = () => {
    $$('.menu-style-btn').forEach((b) => b.classList.toggle('active', b.dataset.style === state.style));
  };
  reflectStyleBtns();
  applyStyleTexts();
  $$('.menu-style-btn').forEach((b) => b.addEventListener('click', () => {
    state.style = b.dataset.style;
    localStorage.setItem('style', state.style);
    localStorage.setItem('styleAsked', 'true');
    reflectStyleBtns();
    applyStyleTexts();
    try { cloud.pushSoon && cloud.pushSoon(); } catch (_) {}
  }));
  // Logo → return to home (lesson picker)
  $('#logo-home')?.addEventListener('click', () => {
    // Stop a running audio session if any
    if (autoSession) autoStop();
    // Whenever any lesson screen is showing (active flow OR results), tear it
    // down via exitLesson() so the picker re-appears and refreshes its stats.
    const resultsVisible = !$('.lesson-results').classList.contains('hidden');
    const activeVisible = !$('.lesson-active').classList.contains('hidden');
    if (state.lesson || resultsVisible || activeVisible) {
      exitLesson();
    }
    setView('lesson');
  });

  // Theme & dialect
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#theme-toggle-menu')?.addEventListener('click', toggleTheme);
  $('#sound-toggle-menu')?.addEventListener('click', toggleSoundEffects);
  applySoundEffectsUI();
  function applyDialectUI() {
    const sel = $('#dialect-select');
    if (sel) sel.value = state.dialect;
    const icon = $('#dialect-toggle-menu-icon');
    const label = $('#dialect-toggle-menu-label');
    if (state.dialect === 'AmE') {
      if (icon) icon.textContent = '🇺🇸';
      if (label) label.textContent = t('dialect_ame');
    } else {
      if (icon) icon.textContent = '🇬🇧';
      if (label) label.textContent = t('dialect_bre');
    }
  }
  function setDialect(value) {
    state.dialect = value === 'AmE' ? 'AmE' : 'BrE';
    localStorage.setItem('dialect', state.dialect);
    applyDialectUI();
    renderBrowse(); renderFlashcards(); renderLessonPicker();
  }
  applyDialectUI();
  $('#dialect-select').addEventListener('change', (e) => setDialect(e.target.value));
  $('#dialect-toggle-menu')?.addEventListener('click', () => {
    setDialect(state.dialect === 'AmE' ? 'BrE' : 'AmE');
  });
  $('#srm-close')?.addEventListener('click', closeStreakRewardModal);
  $('#streak-reward-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'streak-reward-modal') closeStreakRewardModal();
  });
  // Streak info modal — pill is re-rendered, so use delegation on document.
  document.addEventListener('click', (e) => {
    const pill = e.target.closest && e.target.closest('#streak-info-open');
    if (pill) openStreakInfoModal();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && document.activeElement?.id === 'streak-info-open') {
      e.preventDefault();
      openStreakInfoModal();
    }
  });
  // Mastery / groups pill — klik ukáže popis, o co jde (toast).
  function showStatInfo(id) {
    const s = computeMacroStats();
    if (id === 'mastery-info-open') toast(t('stat_verbs_info', s.mastered, s.total, s.inProgress), 'info', 5000);
    else if (id === 'groups-info-open') toast(t('stat_groups_info', s.masteredGroups, s.totalGroups), 'info', 5000);
  }
  document.addEventListener('click', (e) => {
    const pill = e.target.closest && e.target.closest('#mastery-info-open, #groups-info-open');
    if (pill) showStatInfo(pill.id);
  });
  document.addEventListener('keydown', (e) => {
    const id = document.activeElement?.id;
    if ((e.key === 'Enter' || e.key === ' ') && (id === 'mastery-info-open' || id === 'groups-info-open')) {
      e.preventDefault();
      showStatInfo(id);
    }
  });
  $('#sim-close')?.addEventListener('click', closeStreakInfoModal);
  $('#streak-info-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'streak-info-modal') closeStreakInfoModal();
  });
  $('#streak-reward-btn')?.addEventListener('click', () => {
    const sr = state.streakRewards || {};
    const next = (sr.pendingMilestones || [])[0];
    if (next) openStreakRewardModal(next);
  });
  $('#settings-btn')?.addEventListener('click', openSettingsModal);
  $('#settings-close')?.addEventListener('click', closeSettingsModal);
  $('#settings-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'settings-modal') closeSettingsModal();
  });
  $('#settings-reset')?.addEventListener('click', () => {
    closeSettingsModal();
    resetProgress();
  });

  // Lesson
  $('#lesson-exit').addEventListener('click', exitLesson);
  $('#stage-intro-start').addEventListener('click', stageIntroStart);
  $('#results-again').addEventListener('click', againOnlyProblem);
  $('#results-new').addEventListener('click', exitLesson);

  // Flashcards
  $('#fc-side').addEventListener('change', renderFlashcards);
  $('#fc-flip-all').addEventListener('click', fcFlipAll);

  // Quiz
  $('#quiz-start').addEventListener('click', quizStart);
  $('#quiz-restart').addEventListener('click', () => {
    $('.quiz-done').classList.add('hidden');
    // Zadaný test se opakuje znovu od úvodní obrazovky (počítá se další pokus),
    // volný kvíz se vrací do nastavení.
    if (state.quiz.test) dtOpen(state.quiz.test.code);
    else $('.quiz-setup').classList.remove('hidden');
  });
  $('#dt-start')?.addEventListener('click', dtStartTest);
  $('#dt-name')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') dtStartTest(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && state.currentView === 'quiz') {
      // V quiz-fill režimu má Enter řešit per-input handler (posun na další
      // pole); globální fallback se uplatní jen pro "Další →" mimo input.
      if (e.target && e.target.closest && e.target.closest('.quiz-fill-inputs')) return;
      const next = document.querySelector('#quiz-card #quiz-next');
      if (next && !next.classList.contains('hidden')) { e.preventDefault(); next.click(); }
    }
  });

  // Restore last visited view across reload (so refresh doesn't always dump
  // the user back to Lekce). Deep links and payment returns below can still
  // override by calling setView() themselves.
  try {
    const last = localStorage.getItem('lastView');
    if (last && last !== 'lesson' && RESTORABLE_VIEWS.has(last)) setView(last);
  } catch (_) {}

  // Handle Stripe Checkout return (?premium=success|cancel)
  handlePaymentReturn();

  // Deep link from SEO landing pages (/skupina/<id>/) into a specific lesson
  handleDeepLink();

  // Register service worker for PWA (offline)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
