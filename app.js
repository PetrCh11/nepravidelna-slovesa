// ============================================================
// Irregular Verbs App — guided lesson + browse/flashcards/quiz
// ============================================================

import * as cloud from './cloud.js';

// Subsections free without premium. Premium unlocks all 106 verbs across all groups.
const FREE_SUB_IDS = new Set(['1.1.0', '1.2.1', '1.2.5']);

// Stripe / backend config — backend URL set after Railway deploy
const BACKEND_URL = 'https://nepravidelna-slovesa-production.up.railway.app'; // backend stays on Railway
const STRIPE_PRICES = {
  lifetime: { id: 'price_1TTHfv2OnsjUwFrwzP8rr2uF', mode: 'payment' },     // 149 Kč one-time
  monthly:  { id: 'price_1TTHgw2OnsjUwFrwF1uEsLFO', mode: 'subscription' }, // 49 Kč/mo
};

const state = {
  data: null,
  dialect: localStorage.getItem('dialect') || 'BrE',
  theme: localStorage.getItem('theme') || 'light',
  currentView: 'lesson',
  lesson: null, // lesson state when active
  quiz: { pool: [], idx: 0, score: 0, total: 0, type: 'mixed', selectedSections: new Set(), review: [] },
  progress: JSON.parse(localStorage.getItem('progress') || '{}'), // { inf: {status, lastSeen, attempts} }
  premium: localStorage.getItem('premium') === 'true',
};

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

function allAcceptableForms(verb, which, dialect) {
  const set = new Set();
  if (which === 'inf') {
    verb.inf.split('/').forEach((f) => set.add(f.trim().toLowerCase()));
    return set;
  }
  const preferred = pickForm(verb, which, dialect);
  preferred.split('/').forEach((f) => set.add(f.trim().toLowerCase()));
  [verb.past, verb.pastAm, verb.pastAlt, verb.pp, verb.ppAm, verb.ppAlt]
    .filter(Boolean)
    .forEach((f) => {
      if (which === 'past' && (f === verb.past || f === verb.pastAm || f === verb.pastAlt)) {
        f.split('/').forEach((x) => set.add(x.trim().toLowerCase()));
      }
      if (which === 'pp' && (f === verb.pp || f === verb.ppAm || f === verb.ppAlt)) {
        f.split('/').forEach((x) => set.add(x.trim().toLowerCase()));
      }
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

function speak(text, dialect) {
  if (!('speechSynthesis' in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = dialect === 'AmE' ? 'en-US' : 'en-GB';
  utter.rate = 0.9;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

function highlightVowel(word, vowelSet) {
  if (!word) return '';
  const lower = word.toLowerCase();
  let html = '';
  let highlighted = false;
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    if (!highlighted && vowelSet.has(lower[i])) {
      html += `<span class="vowel">${ch}</span>`;
      highlighted = true;
    } else html += ch;
  }
  return html;
}

function inferVowels(verb) {
  const pick = (w) => new Set([...(w || '').toLowerCase()].filter((c) => 'aeiou'.includes(c)));
  return { infV: pick(verb.inf), pastV: pick(verb.past), ppV: pick(verb.pp) };
}

// ---------- View switching ----------
function setView(view) {
  state.currentView = view;
  $$('.view').forEach((v) => v.classList.remove('active'));
  $(`#view-${view}`).classList.add('active');
  $('#menu-dropdown').classList.remove('open');
  $('#menu-btn').setAttribute('aria-expanded', 'false');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ============================================================
// LESSON (guided 3-stage flow)
// ============================================================

function renderLessonPicker() {
  renderResumeCard();
  const c = $('#lesson-groups');
  c.innerHTML = '';
  let subIdx = 0;
  const totalSubs = state.data.sections.reduce((n, s) => n + s.subsections.length, 0);
  const sectionEmojis = { '1.0.0': '🎯', '2.0.0': '🌀', '3.0.0': '⚡' };
  state.data.sections.forEach((sec) => {
    const h = document.createElement('h3');
    h.className = 'lesson-sec-title';
    const emoji = sectionEmojis[sec.id] || '📚';
    h.innerHTML = `
      <span class="lesson-sec-emoji">${emoji}</span>
      <span class="lesson-sec-num">${sec.id}</span>
      <span class="lesson-sec-name">${sec.title}</span>
    `;
    c.appendChild(h);
    sec.subsections.forEach((sub) => {
      const hue = Math.round((subIdx / totalSubs) * 360);
      subIdx++;
      const card = document.createElement('button');
      card.className = 'group-card';
      card.type = 'button';
      card.style.setProperty('--sub-hue', hue);
      const progress = subProgress(sub);
      const allMastered = sub.verbs.every((v) => state.progress[v.inf]?.status === 'green');
      if (allMastered) card.classList.add('group-card-mastered');
      const isLocked = !state.premium && !FREE_SUB_IDS.has(sub.id);
      if (isLocked) card.classList.add('group-card-locked');
      const previewVerbs = sub.verbs.slice(0, 8);
      const previewHtml = previewVerbs.map((v) => `
        <span class="group-preview-verb">
          <span class="group-preview-emoji">${v.emoji || '·'}</span>
          <span class="group-preview-inf">${v.inf}</span>
        </span>
      `).join('');
      card.innerHTML = `
        ${allMastered ? '<span class="group-medal" title="Všechna slovesa zvládnuta!">🏅</span>' : ''}
        ${isLocked ? '<span class="group-lock" title="Pouze pro Premium">🔒</span>' : ''}
        <div class="group-card-top">
          <span class="subsection-id">${sub.id}</span>
          <span class="subsection-pattern">${sub.pattern}</span>
        </div>
        <div class="group-preview" aria-hidden="true">${previewHtml}</div>
        <div class="group-card-meta">
          <span>${sub.verbs.length} sloves</span>
          ${progress.green ? `<span class="dot green" title="zvládnuto: ${progress.green}"></span>${progress.green}` : ''}
          ${progress.yellow ? `<span class="dot yellow" title="v procesu: ${progress.yellow}"></span>${progress.yellow}` : ''}
          ${progress.red ? `<span class="dot red" title="bojuje: ${progress.red}"></span>${progress.red}` : ''}
        </div>
      `;
      card.addEventListener('click', () => {
        if (isLocked) showPaywall(sub);
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

function startLesson(sub) {
  const verbs = sub.verbs.map((v) => ({ ...v, subId: sub.id }));
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
  $('#lesson-group-label').innerHTML = `<span class="subsection-id" style="background:hsl(${hueOf(sub.id)} 65% 45%)">${sub.id}</span> ${sub.pattern}`;
  document.querySelector('.lesson-active').style.setProperty('--sub-hue', hueOf(sub.id));
  showStageIntro(1);
}

// ============================================================
// Resume / persistence of in-progress lesson
// ============================================================
const ACTIVE_LESSON_KEY = 'activeLesson';

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
  const data = {
    subId: L.sub.id,
    subPattern: L.sub.pattern,
    stage: L.stage,
    stage2Step: L.stage2Step || null,
    stage2Q: (L.stage2Q || []).map((v) => v.inf),
    markedHard: Array.from(L.markedHard || []),
    perVerb,
    updatedAt: Date.now(),
  };
  try { localStorage.setItem(ACTIVE_LESSON_KEY, JSON.stringify(data)); } catch {}
}

function clearActiveLesson() {
  try { localStorage.removeItem(ACTIVE_LESSON_KEY); } catch {}
}

function getActiveLesson() {
  try {
    const raw = localStorage.getItem(ACTIVE_LESSON_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
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

function renderResumeCard() {
  const picker = document.querySelector('.lesson-picker');
  if (!picker) return;
  const old = picker.querySelector('.resume-card');
  if (old) old.remove();
  const saved = getActiveLesson();
  if (!saved) return;
  const sub = findSubById(saved.subId);
  if (!sub) { clearActiveLesson(); return; }
  const isLocked = !state.premium && !FREE_SUB_IDS.has(sub.id);
  const stageLabels = { 1: 'Fáze 1 · Seznámení', 1.5: 'Mezifáze · Označ obtížná', 2: 'Fáze 2 · Psaní' };
  const stageLabel = stageLabels[saved.stage] || 'rozdělané cvičení';
  const stepLabels = { 1: '1. krok – v pořadí', 2: '2. krok – oprav chyby', 3: '3. krok – zamícháno' };
  const stepLabel = saved.stage === 2 && saved.stage2Step ? ` · ${stepLabels[saved.stage2Step]}` : '';
  const card = document.createElement('div');
  card.className = 'resume-card';
  card.style.setProperty('--sub-hue', hueOf(sub.id));
  card.innerHTML = `
    <div class="resume-icon">⏯️</div>
    <div class="resume-text">
      <div class="resume-title">Máš rozdělané cvičení</div>
      <div class="resume-meta">
        <span class="subsection-id">${sub.id}</span>
        <span class="resume-pattern">${sub.pattern}</span>
      </div>
      <div class="resume-stage">${stageLabel}${stepLabel}</div>
    </div>
    <div class="resume-actions">
      <button class="btn btn-primary" id="resume-continue">Pokračovat</button>
      <button class="btn btn-secondary" id="resume-restart">Začít znovu</button>
    </div>
  `;
  // Insert after stats-strip (or at top of picker)
  const statsStrip = picker.querySelector('#stats-strip');
  if (statsStrip && statsStrip.nextSibling) {
    picker.insertBefore(card, statsStrip.nextSibling);
  } else {
    picker.appendChild(card);
  }
  card.querySelector('#resume-continue').addEventListener('click', () => {
    if (isLocked) { showPaywall(sub); return; }
    resumeLesson(saved);
  });
  card.querySelector('#resume-restart').addEventListener('click', () => {
    if (isLocked) { showPaywall(sub); return; }
    clearActiveLesson();
    startLesson(sub);
  });
}

function resumeLesson(saved) {
  const sub = findSubById(saved.subId);
  if (!sub) { clearActiveLesson(); return; }
  const verbs = sub.verbs.map((v) => ({ ...v, subId: sub.id }));
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
      if (saved.stage2Step === 1) stage2AdvanceToStep2();
      else if (saved.stage2Step === 2) stage2AdvanceToStep3();
      else if (saved.stage2Step === 3) stage2Finish();
    } else {
      stage2Next();
    }
  }
  updateStageDots();
  updateLessonBar();
  toast('Pokračujeme tam, kde jsi skončil(a). 👍', 'info', 2500);
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

function showStageIntro(stage) {
  const intros = {
    1:   { emoji: '👀', title: 'Fáze 1 — Seznámení', desc: 'V klidu si projdi všechna slovesa v této skupině.' },
    1.5: { emoji: '✋', title: 'Hold your horses! / Zadrž!', desc: 'Označ slovesa, u kterých si myslíš, že ti budou dělat největší problém.' },
    2:   { emoji: '✍️', title: 'Fáze 2 — Psaní tvarů', desc: 'Uvidíš český překlad a napíšeš všechny 3 tvary + Enter. 3, 2, 1 ...aaaaand... GO!' },
  };
  const i = intros[stage];
  $('#stage-intro-emoji').textContent = i.emoji;
  $('#stage-intro-title').textContent = i.title;
  $('#stage-intro-desc').textContent = i.desc;
  $('#lesson-question').innerHTML = '';
  $('#lesson-stage-intro').classList.remove('hidden');
  updateStageDots();
  updateLessonBar();
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
  const stageTitles = { 1: 'Fáze 1 · Seznámení', 1.5: 'Mezifáze · Označ obtížná', 2: 'Fáze 2 · Psaní' };
  $('#lesson-stage-title').textContent = stageTitles[L.stage];
  if (L.stage === 1) {
    $('#lesson-remaining').textContent = `${total} sloves k prohlédnutí`;
  } else if (L.stage === 1.5) {
    const n = L.markedHard.size;
    $('#lesson-remaining').textContent = n === 0 ? 'označ těžká slovesa' : `označeno: ${n}`;
  } else if (L.stage === 2) {
    const stepLabels = { 1: '1. krok · v pořadí', 2: '2. krok · chyby', 3: '3. krok · zamícháno' };
    const lbl = stepLabels[L.stage2Step] || '1. krok';
    const remaining = (L.stage2Q || []).length;
    $('#lesson-remaining').textContent = `${lbl} · zbývá ${remaining} sloves`;
  }
  $('#lesson-bar-fill').style.width = `${Math.round((done / total) * 100)}%`;
}

// ---------- Stage 1: Study view — read all verbs in the group ----------
function stage1Study() {
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
            <span class="study-form-label">infinitiv</span>
            <span class="study-form-word">${highlightVowel(v.inf, infV)}</span>
          </span>
          <span class="study-arrow">→</span>
          <span class="study-form" data-speak="${past}">
            <span class="study-form-label">past</span>
            <span class="study-form-word">${highlightVowel(past, pastV)}</span>
          </span>
          <span class="study-arrow">→</span>
          <span class="study-form" data-speak="${pp}">
            <span class="study-form-label">past participle</span>
            <span class="study-form-word">${highlightVowel(pp, ppV)}</span>
          </span>
        </div>
        <button class="speak-btn study-speak" data-speak="${v.inf}, ${past}, ${pp}" title="Přehrát všechny tvary">🔊</button>
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
          <div class="study-hero-eyebrow">Fáze 1 · Seznámení</div>
          <div class="study-hero-title">Projdi si všechna slovesa</div>
          <div class="study-hero-sub">Přečti si význam, poslechni výslovnost 🔊 a všimni si, jak se mění <span class="study-hero-vowel">samohláska</span>.</div>
        </div>
        <div class="study-hero-count">${L.verbs.length}<span>sloves</span></div>
      </div>
      <div class="study-list">${rowsHtml}</div>
      <div class="study-actions">
        <button class="btn btn-primary study-done-btn" id="study-done">Hotovo, jdu psát ✍️ →</button>
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
  });
  updateStageDots();
  updateLessonBar();
}

// ---------- Mezifáze: Mark verbs the student thinks will be hardest ----------
function stage1Mark() {
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
          <div class="mark-hero-title">Hold your horses! / Zadrž!</div>
          <div class="mark-hero-sub">Označ slovesa, u kterých si myslíš, že ti budou dělat největší problém.</div>
        </div>
        <div class="mark-counter" id="mark-counter">${L.markedHard.size}</div>
      </div>
      <div class="study-list mark-list">${rowsHtml}</div>
      <div class="study-actions">
        <button class="btn btn-primary study-done-btn" id="mark-done">Pokračovat na psaní ✍️ →</button>
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
    renderStepPills(1);
    persistActiveLesson();
  });
  updateStageDots();
  updateLessonBar();
}

// ---------- Stage 2: Type all 3 forms — 3 steps ----------
// Step 1: every verb in original order, per-field Enter check.
// Step 2: only verbs that errored in step 1, per-field Enter check, fields with prior errors get a soft blue aura.
//         Each verb must be answered correctly 2× in a row to leave the queue.
// Step 3: all verbs shuffled, atomic check (type all 3 then evaluate). Each verb 2× in a row to leave;
//         exception: if step 1 was perfect AND first attempt in step 3 is perfect → done immediately.

function stage2InitStep1() {
  const L = state.lesson;
  L.stage2Step = 1;
  L.stage2Q = L.verbs.slice();
  L.currentInf = null;
  L.lastCleared = null;
  L.verbs.forEach((v) => {
    const p = L.perVerb.get(v.inf);
    p.step1Wrong = new Set();
    p.step1Perfect = false;
    p.step2Streak = 0;
    p.step2Cleared = false;
    p.step3Streak = 0;
    p.step3Attempts = 0;
    p.step3Cleared = false;
  });
}

function renderStepPills(activeStep) {
  const c = $('#step-pills');
  if (!c) return;
  const L = state.lesson;
  if (!L || L.stage !== 2) { c.innerHTML = ''; return; }
  const labels = { 1: '1) doplň', 2: '2) oprav chyby', 3: '3) zamíchat' };
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
  if (!L || L.stage !== 2) { c.innerHTML = ''; return; }
  const justInf = L.lastCleared;
  L.lastCleared = null;
  c.innerHTML = L.verbs.map((v) => {
    const p = L.perVerb.get(v.inf);
    let cls = 'verb-chip';
    if (p.step3Cleared) cls += ' done';
    else if (p.step2Cleared) cls += ' good';
    else if (p.step1Perfect) cls += ' good';
    else if (p.step1Wrong && p.step1Wrong.size > 0) cls += ' warn';
    else cls += ' pending';
    if (v.inf === L.currentInf) cls += ' current';
    if (v.inf === justInf) cls += ' just-cleared';
    const title = `${v.inf} – ${v.cs}`.replace(/"/g, '&quot;');
    return `<span class="${cls}" title="${title}">${v.emoji || '·'}</span>`;
  }).join('');
}

function stage2Next() {
  $('#lesson-stage-intro').classList.add('hidden');
  const L = state.lesson;
  if (L.stage2Step === 1) {
    if (L.stage2Q.length === 0) return stage2AdvanceToStep2();
    return askStage2Verb(L.stage2Q.shift(), 1);
  }
  if (L.stage2Step === 2) {
    if (L.stage2Q.length === 0) return stage2AdvanceToStep3();
    return askStage2Verb(L.stage2Q[0], 2);
  }
  if (L.stage2Step === 3) {
    if (L.stage2Q.length === 0) return stage2Finish();
    return askStage2Verb(L.stage2Q[0], 3);
  }
}

function stage2AdvanceToStep2() {
  const L = state.lesson;
  const errored = L.verbs.filter((v) => !L.perVerb.get(v.inf).step1Perfect);
  if (errored.length === 0) return stage2AdvanceToStep3();
  L.stage2Step = 2;
  L.stage2Q = errored.slice();
  L.verbs.forEach((v) => { L.perVerb.get(v.inf).step2Streak = 0; });
  $('#lesson-stage-intro').classList.remove('hidden');
  $('#stage-intro-emoji').textContent = '🔍';
  $('#stage-intro-title').textContent = '2. krok — chyby pod lupou';
  const word = errored.length === 1 ? 'sloveso' : (errored.length < 5 ? 'slovesa' : 'sloves');
  $('#stage-intro-desc').textContent = `Projdeme jen ${errored.length} ${word}, kde se chyby objevily. Políčka, ve kterých to bylo, mají jemnou modrou auru. Každé sloveso musíš napsat 2× za sebou bez chyby, aby z fronty vypadlo.`;
  $('#lesson-question').innerHTML = '';
  updateStageDots();
  updateLessonBar();
  renderVerbChips();
  renderStepPills(2);
  persistActiveLesson();
}

function stage2AdvanceToStep3() {
  const L = state.lesson;
  L.stage2Step = 3;
  L.stage2Q = shuffle(L.verbs.slice());
  L.verbs.forEach((v) => {
    const p = L.perVerb.get(v.inf);
    p.step3Streak = 0;
    p.step3Attempts = 0;
    p.step3HadError = false;
  });
  $('#lesson-stage-intro').classList.remove('hidden');
  $('#stage-intro-emoji').textContent = '🔀';
  $('#stage-intro-title').textContent = '3. krok — finále, zamícháno';
  $('#stage-intro-desc').textContent = 'Všechna slovesa v náhodném pořadí. Napiš nejdřív všechny tři tvary, pak teprve uvidíš výsledek. Každé sloveso musíš napsat 2× za sebou bez chyby — kromě těch, která jsi měl(a) bezchybně už v 1. kroku a napíšeš je správně i napoprvé teď.';
  $('#lesson-question').innerHTML = '';
  updateStageDots();
  updateLessonBar();
  renderVerbChips();
  renderStepPills(3);
  persistActiveLesson();
}

function stage2Finish() {
  const L = state.lesson;
  L.verbs.forEach((v) => {
    const p = L.perVerb.get(v.inf);
    // Green = sloveso vyřešeno bez chyby ve fázi 3 (fast-track NEBO čistý 2× streak).
    // Yellow = sloveso sice nakonec zvládnuto, ale s chybou cestou.
    p.status = p.step3HadError ? 'yellow' : 'green';
  });
  finishLesson();
}

function askStage2Verb(verb, step) {
  $('#lesson-stage-intro').classList.add('hidden');
  const L = state.lesson;
  const p = L.perVerb.get(verb.inf);
  L.currentInf = verb.inf;
  renderVerbChips();
  renderStepPills(step);
  const past = pickForm(verb, 'past', state.dialect);
  const pp = pickForm(verb, 'pp', state.dialect);
  const hue = hueOf(verb.subId);
  const isAtomicCheck = step === 3; // step 3 evaluates after all 3 forms
  const auraSet = step === 2 ? (p.step1Wrong || new Set()) : new Set();

  let progressText;
  if (step === 1) {
    const total = L.verbs.length;
    const done = total - L.stage2Q.length; // current already shifted
    progressText = `${done}/${total}`;
  } else if (step === 2) {
    progressText = `zbývá ${L.stage2Q.length} · sloveso ${p.step2Streak}/2`;
  } else {
    const streakLabel = (p.step1Perfect && p.step3Attempts === 0) ? '1×' : `${p.step3Streak}/2`;
    progressText = `zbývá ${L.stage2Q.length} · sloveso ${streakLabel}`;
  }

  const tipText = isAtomicCheck
    ? '<kbd>Enter</kbd> = další pole, vyhodnotí se na konci'
    : 'Po každém tvaru zmáčkni <kbd>Enter</kbd>';

  const fieldHtml = (key, placeholder) => {
    const auraCls = auraSet.has(key) ? ' has-aura' : '';
    return `
      <div class="fill-row${auraCls}">
        <input data-form="${key}" placeholder="${placeholder}" autocomplete="off" spellcheck="false" autocapitalize="none" />
        <span class="field-indicator"></span>
      </div>`;
  };

  const q = $('#lesson-question');
  q.innerHTML = `
    <div class="q-card" style="--sub-hue:${hue}">
      <div class="q-emoji">${verb.emoji || '❓'}</div>
      <div class="q-prompt">${verb.cs}</div>
      <div class="q-sub">${progressText}</div>
      <div class="enter-tip">${tipText}</div>
      <div class="quiz-fill-inputs">
        ${fieldHtml('inf', 'infinitiv')}
        ${fieldHtml('past', 'past simple')}
        ${fieldHtml('pp', 'past participle')}
      </div>
      <div class="q-feedback"></div>
      <div class="q-actions">${isAtomicCheck ? '<button class="btn btn-primary" id="s2-check">Zkontrolovat</button>' : ''}</div>
      <button type="button" class="give-up-btn" id="give-up-btn">Nevím 😭</button>
    </div>
  `;

  const inputs = Array.from(q.querySelectorAll('.quiz-fill-inputs input'));
  const fieldResults = {};
  let finalized = false;
  const giveUpBtn = q.querySelector('#give-up-btn');

  const markField = (inp) => {
    const key = inp.dataset.form;
    if (key in fieldResults) return;
    const accepted = allAcceptableForms(verb, key, state.dialect);
    const good = accepted.has(inp.value.trim().toLowerCase());
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
      p.step1Wrong = new Set();
      Object.entries(fieldResults).forEach(([k, v]) => { if (!v) p.step1Wrong.add(k); });
      p.step1Perfect = allRight;
      if (allRight) {
        p.stage2Correct = (p.stage2Correct || 0) + 1;
        L.lastCleared = verb.inf;
      }
      msg = allRight ? '✅ Bezvadně!' : '🔍 Tohle si v 2. kroku probereme detailněji.';
    } else if (step === 2) {
      if (allRight) {
        p.step2Streak++;
        if (p.step2Streak >= 2) {
          L.stage2Q.shift();
          p.step2Cleared = true;
          L.lastCleared = verb.inf;
          msg = '✅ 2× po sobě bez chyby — sloveso máš!';
        } else {
          L.stage2Q.push(L.stage2Q.shift());
          msg = `✅ Správně (${p.step2Streak}/2). Ještě jednou…`;
        }
      } else {
        p.step2Streak = 0;
        L.stage2Q.push(L.stage2Q.shift());
        msg = '❌ Streak vynulován. Zkusíme znovu.';
      }
    } else if (step === 3) {
      const isFirstAttempt = p.step3Attempts === 0;
      p.step3Attempts++;
      if (allRight) {
        if (p.step1Perfect && isFirstAttempt) {
          L.stage2Q.shift();
          p.step3Cleared = true;
          L.lastCleared = verb.inf;
          msg = '✅ Hotovo! V 1. kroku jsi byl(a) bezchybný(á), tak nemusíš dvakrát.';
        } else {
          p.step3Streak++;
          if (p.step3Streak >= 2) {
            L.stage2Q.shift();
            p.step3Cleared = true;
            L.lastCleared = verb.inf;
            msg = '✅ 2× po sobě — sloveso je hotové!';
          } else {
            L.stage2Q.push(L.stage2Q.shift());
            msg = `✅ Správně (${p.step3Streak}/2). Ještě jednou…`;
          }
        }
      } else {
        p.step3Streak = 0;
        p.step3HadError = true;
        L.stage2Q.push(L.stage2Q.shift());
        msg = '❌ Streak vynulován. Zkusíme později znovu.';
      }
    }

    const fb = q.querySelector('.q-feedback');
    fb.innerHTML = msg;
    fb.className = `q-feedback ${allRight ? 'correct' : 'wrong'}`;
    persistProgress();
    persistActiveLesson();
    L.currentInf = null;
    renderVerbChips();
    const checkBtn = q.querySelector('#s2-check');
    if (checkBtn) checkBtn.classList.add('hidden');
    const next = document.createElement('button');
    next.className = 'next-btn-corner';
    next.textContent = 'Další →';
    next.addEventListener('click', stage2Next, { once: true });
    q.querySelector('.q-card').appendChild(next);
    next.focus();
    updateLessonBar();
  };

  inputs.forEach((inp, idx) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!isAtomicCheck) {
        markField(inp);
        const nextEmpty = inputs.find((x) => !(x.dataset.form in fieldResults));
        if (nextEmpty) nextEmpty.focus();
        else finalize();
      } else {
        if (idx < inputs.length - 1) inputs[idx + 1].focus();
        else finalize();
      }
    });
  });

  if (isAtomicCheck) {
    q.querySelector('#s2-check').addEventListener('click', finalize);
  }

  // Give-up: requires double-tap to prevent accidental triggers (especially on mobile)
  let giveUpArmed = false;
  let giveUpResetTimer = null;
  giveUpBtn?.addEventListener('click', () => {
    if (finalized) return;
    if (!giveUpArmed) {
      giveUpArmed = true;
      const orig = giveUpBtn.textContent;
      giveUpBtn.textContent = 'Opravdu? Klikni znovu 😭';
      giveUpBtn.classList.add('armed');
      giveUpResetTimer = setTimeout(() => {
        giveUpArmed = false;
        giveUpBtn.textContent = orig;
        giveUpBtn.classList.remove('armed');
      }, 2500);
      return;
    }
    if (giveUpResetTimer) clearTimeout(giveUpResetTimer);
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
  const L = state.lesson;
  L.done = true;
  clearActiveLesson(); // lesson finished — no resume needed
  // Save to progress
  L.perVerb.forEach((p, inf) => {
    state.progress[inf] = { status: p.status, lastSeen: Date.now() };
  });
  persistProgress();
  markStudyToday();

  $('.lesson-active').classList.add('hidden');
  $('.lesson-results').classList.remove('hidden');
  const counts = { green: 0, yellow: 0, red: 0 };
  L.perVerb.forEach((p) => { counts[p.status] = (counts[p.status] || 0) + 1; });
  $('#results-summary').innerHTML = `
    <div class="stat stat-green"><div class="stat-num">${counts.green || 0}</div><div class="stat-label">zvládnuto</div></div>
    <div class="stat stat-yellow"><div class="stat-num">${counts.yellow || 0}</div><div class="stat-label">v procesu</div></div>
    <div class="stat stat-red"><div class="stat-num">${counts.red || 0}</div><div class="stat-label">bojuje</div></div>
  `;
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
  cloud.pushSoon();
}
function computeStreak() {
  const days = loadStudyDays();
  let streak = 0;
  const cur = new Date();
  // Streak = consecutive days back from today; if today missing, streak = 0.
  while (true) {
    const y = cur.getFullYear(), m = String(cur.getMonth() + 1).padStart(2, '0'), d = String(cur.getDate()).padStart(2, '0');
    const k = `${y}-${m}-${d}`;
    if (days.has(k)) {
      streak++;
      cur.setDate(cur.getDate() - 1);
    } else break;
  }
  return streak;
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
function plurDays(n) {
  if (n === 1) return 'den v řadě';
  if (n >= 2 && n <= 4) return 'dny v řadě';
  return 'dní v řadě';
}
function renderStatsStrip() {
  const c = $('#stats-strip');
  if (!c || !state.data) return;
  const s = computeMacroStats();
  const pct = s.total ? Math.round((s.mastered / s.total) * 100) : 0;
  const groupPct = s.totalGroups ? Math.round((s.masteredGroups / s.totalGroups) * 100) : 0;
  const streakBig = s.streak >= 3 ? ' is-hot' : '';
  c.innerHTML = `
    <div class="stat-pill stat-pill-mastery">
      <div class="stat-pill-head">
        <span class="stat-pill-icon">🎯</span>
        <span class="stat-pill-num">${s.mastered}<span class="stat-pill-of"> / ${s.total}</span></span>
      </div>
      <div class="stat-pill-label">zvládnutých sloves${s.inProgress ? ` · ${s.inProgress} v procesu` : ''}</div>
      <div class="stat-pill-bar"><div class="stat-pill-bar-fill" style="width:${pct}%"></div></div>
    </div>
    <div class="stat-pill stat-pill-streak${streakBig}">
      <div class="stat-pill-head">
        <span class="stat-pill-icon">🔥</span>
        <span class="stat-pill-num">${s.streak}</span>
      </div>
      <div class="stat-pill-label">${s.streak === 0 ? 'začni dnes!' : plurDays(s.streak)}</div>
    </div>
    <div class="stat-pill stat-pill-groups">
      <div class="stat-pill-head">
        <span class="stat-pill-icon">🏅</span>
        <span class="stat-pill-num">${s.masteredGroups}<span class="stat-pill-of"> / ${s.totalGroups}</span></span>
      </div>
      <div class="stat-pill-label">zvládnutých skupin</div>
      <div class="stat-pill-bar"><div class="stat-pill-bar-fill" style="width:${groupPct}%"></div></div>
    </div>
  `;
}

function exitLesson() {
  state.lesson = null;
  $('.lesson-active').classList.add('hidden');
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
    toast('🎉 Skvělé! Žádná problematická slovesa — celou skupinu máš zvládnutou.', 'success');
    return;
  }
  const pseudoSub = { ...L.sub, verbs: keep };
  startLesson(pseudoSub);
}

// ============================================================
// BROWSE view
// ============================================================

function renderBrowse() {
  const container = $('#sections-list');
  container.innerHTML = '';
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
      div.innerHTML = `
        <div class="subsection-head">
          <span class="subsection-id">${sub.id}</span>
          <span class="subsection-pattern">${sub.pattern}</span>
        </div>
        <p class="subsection-rule">${sub.rule}</p>
        <div class="verb-grid"></div>
      `;
      const grid = div.querySelector('.verb-grid');
      sub.verbs.forEach((v) => grid.appendChild(renderVerbCard(v)));
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
    <span class="verb-form" data-speak="${past}">${highlightVowel(past, pastV)}</span>
    <span class="verb-form" data-speak="${pp}">${highlightVowel(pp, ppV)}</span>
    <button class="speak-btn" data-speak="${verb.inf}, ${past}, ${pp}" title="Přehrát všechny tvary">🔊</button>
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
      subWrap.innerHTML = `
        <div class="fc-sub-head">
          <span class="subsection-id">${sub.id}</span>
          <span class="subsection-pattern">${sub.pattern}</span>
          <span class="fc-sub-rule">${sub.rule}</span>
        </div>
        <div class="fc-grid"></div>
      `;
      const grid = subWrap.querySelector('.fc-grid');
      sub.verbs.forEach((v) => grid.appendChild(renderFlashCard(v, side)));
      secWrap.appendChild(subWrap);
    });
    container.appendChild(secWrap);
  });
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
        <div class="flash-hint">klikni pro otočení</div>
      </div>
      <div class="flash-face flash-back">
        <div class="flash-forms">
          <span>${highlightVowel(verb.inf, infV)}</span>
          <span>${highlightVowel(past, pastV)}</span>
          <span>${highlightVowel(pp, ppV)}</span>
        </div>
        <button class="speak-btn flash-speak" data-speak="${verb.inf}, ${past}, ${pp}" title="Přehrát">🔊</button>
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
  allChip.textContent = 'Vše';
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
  const all = flattenVerbs(state.data, state.quiz.selectedSections);
  if (all.length === 0) return;
  const countSel = parseInt($('#quiz-count').value, 10);
  const n = countSel === 0 ? all.length : Math.min(countSel, all.length);
  state.quiz.pool = shuffle(all).slice(0, n);
  state.quiz.idx = 0;
  state.quiz.score = 0;
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
  $('#quiz-current').textContent = state.quiz.idx + 1;
  $('#quiz-score').textContent = state.quiz.score;
  $('#quiz-bar-fill').style.width = `${(state.quiz.idx / state.quiz.total) * 100}%`;
  let mode = state.quiz.type;
  if (mode === 'mixed') mode = Math.random() < 0.5 ? 'mc' : 'fill';
  const card = $('#quiz-card');
  card.innerHTML = '';
  if (mode === 'mc') {
    const ask = Math.random() < 0.5 ? 'past' : 'pp';
    const askLabel = ask === 'past' ? 'past simple' : 'past participle';
    const correct = pickForm(verb, ask, state.dialect);
    const distractors = shuffle(allVerbs.filter((v) => v.inf !== verb.inf).map((v) => pickForm(v, ask, state.dialect))).slice(0, 3);
    const options = shuffle([correct, ...distractors]);
    card.innerHTML = `
      <div class="q-emoji">${verb.emoji || '❓'}</div>
      <div class="q-prompt">${verb.inf} <button class="speak-btn" data-speak="${verb.inf}">🔊</button></div>
      <div class="q-hint">Vyber správný tvar (${askLabel})</div>
      <div class="quiz-options-list"></div>
      <div class="quiz-feedback"></div>
      <div class="quiz-next-row"><button class="btn btn-primary hidden" id="quiz-next">Další →</button></div>
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
        handleQuizAnswer(ok, verb, `${verb.inf} (${askLabel})`, correct);
      });
      list.appendChild(b);
    });
  } else {
    const past = pickForm(verb, 'past', state.dialect);
    const pp = pickForm(verb, 'pp', state.dialect);
    card.innerHTML = `
      <div class="q-emoji">${verb.emoji || '❓'}</div>
      <div class="q-prompt">${verb.inf} <button class="speak-btn" data-speak="${verb.inf}">🔊</button></div>
      <div class="q-hint">Doplň past simple a past participle · <em>${verb.cs}</em></div>
      <div class="quiz-fill-inputs">
        <input data-form="past" placeholder="past simple" autocomplete="off" spellcheck="false" autocapitalize="none" />
        <input data-form="pp" placeholder="past participle" autocomplete="off" spellcheck="false" autocapitalize="none" />
      </div>
      <div class="quiz-feedback"></div>
      <div class="quiz-next-row"><button class="btn btn-primary" id="quiz-check">Zkontrolovat</button><button class="btn btn-primary hidden" id="quiz-next">Další →</button></div>
    `;
    card.querySelector('#quiz-check').addEventListener('click', () => {
      const inputs = Array.from(card.querySelectorAll('.quiz-fill-inputs input'));
      let ok = true;
      inputs.forEach((inp) => {
        const key = inp.dataset.form;
        const accepted = allAcceptableForms(verb, key, state.dialect);
        const good = accepted.has(inp.value.trim().toLowerCase());
        inp.classList.add(good ? 'correct' : 'wrong');
        inp.disabled = true;
        if (!good) ok = false;
      });
      handleQuizAnswer(ok, verb, verb.inf, `${past} – ${pp}`);
      card.querySelector('#quiz-check').classList.add('hidden');
    });
    setTimeout(() => card.querySelector('input')?.focus(), 50);
  }
  card.querySelectorAll('[data-speak]').forEach((el) =>
    el.addEventListener('click', (e) => { e.stopPropagation(); speak(el.dataset.speak, state.dialect); })
  );
}

function handleQuizAnswer(ok, verb, qText, aText) {
  const fb = $('#quiz-card .quiz-feedback');
  const past = pickForm(verb, 'past', state.dialect);
  const pp = pickForm(verb, 'pp', state.dialect);
  if (ok) {
    state.quiz.score++;
    fb.textContent = '✅ Správně!';
    fb.className = 'quiz-feedback correct';
  } else {
    fb.innerHTML = `❌ Správně: <strong>${verb.inf} – ${past} – ${pp}</strong>`;
    fb.className = 'quiz-feedback wrong';
  }
  state.quiz.review.push({ ok, q: qText, a: aText, verb });
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
  const pct = Math.round((state.quiz.score / state.quiz.total) * 100);
  $('#quiz-final').textContent = `${state.quiz.score} / ${state.quiz.total} (${pct} %)`;
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
  $('#theme-toggle').textContent = state.theme === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', state.theme);
  applyTheme();
}
function toggleMenu() {
  const d = $('#menu-dropdown');
  const btn = $('#menu-btn');
  const open = d.classList.toggle('open');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// ============================================================
// Cloud sync UI helpers
// ============================================================

function updateCloudUI(user) {
  const label = $('#cloud-label');
  const btn = $('#cloud-btn');
  if (!label || !btn) return;
  if (user) {
    const name = user.displayName || user.email || 'účet';
    label.textContent = `Odhlásit (${name})`;
    btn.classList.add('signed-in');
  } else {
    label.textContent = 'Přihlásit se přes Google';
    btn.classList.remove('signed-in');
  }
}

function showPaywall(sub) {
  const m = $('#paywall');
  m.classList.remove('hidden');
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
    signBtn.disabled = true;
    signBtn.textContent = 'Přihlašuji…';
    try {
      await cloud.signIn();
      refreshSignInState();
    } catch (e) {
      toast('Přihlášení selhalo: ' + (e?.message || e), 'error');
    } finally {
      signBtn.disabled = false;
      signBtn.textContent = 'Přihlásit se přes Google';
    }
  };
  m.querySelectorAll('.paywall-option').forEach((btn) => {
    btn.onclick = () => startCheckout(btn.dataset.plan, btn);
  });
  m.querySelector('#paywall-close').onclick = () => m.classList.add('hidden');
  m.onclick = (e) => { if (e.target === m) m.classList.add('hidden'); };
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
  if (!BACKEND_URL) {
    toast('Backend zatím není dostupný. Zkus to prosím za chvíli.', 'error');
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
  if (btn) { btn.disabled = true; btn.innerHTML = 'Načítám…'; }
  try {
    const resp = await fetch(`${BACKEND_URL}/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        priceId: price.id,
        uid: user.uid,
        mode: price.mode,
        returnUrl: window.location.origin + window.location.pathname,
        email: user.email,
      }),
    });
    const data = await resp.json();
    if (data.url) window.location.href = data.url;
    else throw new Error(data.error || 'unknown error');
  } catch (e) {
    toast('Chyba při zahájení platby: ' + e.message, 'error');
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
    setTimeout(() => toast('🎉 Platba proběhla! Premium se aktivuje během několika sekund.', 'success', 6000), 300);
  } else if (status === 'cancel') {
    setTimeout(() => toast('Platba zrušena. Můžeš se k ní kdykoli vrátit.', 'info'), 300);
  }
}

function updateSyncStatus(status) {
  const dot = $('#cloud-status');
  if (!dot) return;
  dot.dataset.status = status;
  const titles = {
    idle: 'cloud sync vypnutý',
    'signing-in': 'přihlašování…',
    syncing: 'synchronizace…',
    synced: 'synchronizováno',
    error: 'chyba synchronizace',
  };
  dot.title = titles[status] || status;
}

// ============================================================
// Init
// ============================================================

async function init() {
  applyTheme();
  state.data = await fetch('data/verbs.json').then((r) => r.json());

  $('#verb-count').textContent = flattenVerbs(state.data).length;

  renderLessonPicker();
  renderBrowse();
  renderFlashcards();
  renderSectionChips($('#quiz-filter'), state.quiz.selectedSections);
  renderStatsStrip();

  // Cloud sync wiring
  cloud.setListeners({
    onUser: (user) => updateCloudUI(user),
    onSync: (status) => updateSyncStatus(status),
  });
  document.addEventListener('cloud-merged', () => {
    state.progress = JSON.parse(localStorage.getItem('progress') || '{}');
    state.premium = localStorage.getItem('premium') === 'true';
    renderLessonPicker();
    renderStatsStrip();
  });
  $('#cloud-btn').addEventListener('click', () => {
    if (cloud.getCurrentUser()) cloud.signOutNow();
    else cloud.signIn();
  });

  // Menu
  $('#menu-btn').addEventListener('click', toggleMenu);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-wrap')) {
      $('#menu-dropdown').classList.remove('open');
      $('#menu-btn').setAttribute('aria-expanded', 'false');
    }
  });
  $$('.menu-item').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  // Theme & dialect
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#dialect-select').value = state.dialect;
  $('#dialect-select').addEventListener('change', (e) => {
    state.dialect = e.target.value;
    localStorage.setItem('dialect', state.dialect);
    renderBrowse(); renderFlashcards(); renderLessonPicker();
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
    $('.quiz-setup').classList.remove('hidden');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && state.currentView === 'quiz') {
      const check = document.querySelector('#quiz-card #quiz-check');
      const next = document.querySelector('#quiz-card #quiz-next');
      if (check && !check.classList.contains('hidden')) { e.preventDefault(); check.click(); }
      else if (next && !next.classList.contains('hidden')) { e.preventDefault(); next.click(); }
    }
  });

  // Handle Stripe Checkout return (?premium=success|cancel)
  handlePaymentReturn();

  // Register service worker for PWA (offline)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
