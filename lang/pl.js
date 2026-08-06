// ============================================================
// Polský jazykový pack — window.LANG_PACK (viz docs/i18n.md)
// Načítá se PŘED app.js (script tag v <head> polské mutace).
// Nepřeložený klíč tiše spadne na češtinu v TEXTS.
// ============================================================
(function () {
  'use strict';

  // Polska liczba mnoga: 1 → jeden, 2–4 (ale nie 12–14) → kilka, reszta → dopełniacz.
  function pl(n, one, few, many) {
    if (n === 1) return one;
    var d = n % 10, h = n % 100;
    if (d >= 2 && d <= 4 && !(h >= 12 && h <= 14)) return few;
    return many;
  }
  function plVerbs(n)  { return pl(n, 'czasownik', 'czasowniki', 'czasowników'); }
  function plGroups(n) { return pl(n, 'grupa', 'grupy', 'grup'); }

  // ---- Pooly hlášek (t() losuje z pole; {name} → křestní jméno) -------------
  var POS_PRO = [
    'Approved bez uwag! ✅',
    'Dowiezione w terminie i w top jakości. 📦',
    'KPI na dziś zaliczone. 📊',
    'Czysty win-win. 🤝',
    'Ktoś tu celuje w awans. 💼',
    'Dział HR bije brawo. 👏',
    'Native speakerzy na callu nie uwierzą. 🎧',
    'Lepsza inwestycja w siebie niż w krypto. 🪙',
    'Ten czasownik przeszedł audyt bez zastrzeżeń. 🕵️‍♂️',
    'No i o to chodzi, {name}! ⚽️',
    'Prawie tak dobre uczucie jak piątek o 15:00. 🍻',
  ];
  var NEG_PRO = [
    'Ten draft wymaga jeszcze rewizji. 📝',
    'Mały błąd w matriksie. Robimy re-work. 🔄',
    'Odrzucone przez dyrektora finansowego. Spróbuj jeszcze raz, lepiej. 🏦',
    'Workflow się gdzieś zaciął. 🚧',
    'Tego lepiej nie pokazuj na prezentacji przed zarządem. 🤫',
    'Chyba słaby zasięg na callu. Próbujemy jeszcze raz? 📞',
    'Ten task nie przeszedł QA. 🛠️',
    'Potrzebny jeszcze jeden łyk kawy. ☕',
    'Palce były szybsze niż myśl. 🏎️',
    'Po całym dniu pracy masz prawo do jednego faila. 🤝',
  ];
  var STREAK_PRO = [
    'To jest wynik na awans jeszcze przed oceną kwartalną! 📈',
    'Employee of the month! 🏆',
    'Miażdżysz to jak prezentację przed inwestorami. 💸',
    'Twój rozwój zawodowy właśnie nabrał rakietowego tempa. 🚀',
    'Z takim słownictwem na międzynarodowym callu możesz dyktować warunki. 🗣️',
  ];
  var POS_STUDENT = [
    'Clean! ✨',
    'Pure skill! 🧠',
    'Certified pro. 🤝',
    'Ez pz lemon squeezy. 🍋',
    'Big brain energy! ⚡',
    'Strzał w dziesiątkę. 🎯',
    'No cap, to było perfekcyjne. 🙌',
    'Slay! 💅',
    'Te czasowniki same wpadają. 🔥',
    'No i o to chodzi, {name}! ⚽️',
  ];
  var NEG_STUDENT = [
    'Auć, to trochę zabolało. 💀',
    'Ten czasownik cię wyautował. ❌',
    'Mały misclick, nie? 🎯',
    'Nie mów, że wierzysz w tę formę. 🤨',
    'Wasted. 🎮',
    'Skill issue. Ale da się wytrenować! 🛠️',
    'Ta forma dostała instant bana. 🚫',
    'Mission failed, we\'ll get \'em next time. 🎖️',
    'Nope. 🛑',
    'Bruh... serio? 💀',
    'Lagło ci, spróbuj jeszcze raz. 🌐',
    'Tuż obok, jak twój typ na sprawdzianie. 📉',
  ];
  var STREAK_STUDENT = [
    'Ale seria! 🐂',
    'Jesteś maszyną! 🚂',
    'Niech cię ktoś zatrzyma, płoniesz! ☄️',
    'God mode włączony. 👑',
    'Unstoppable! 🌪️',
    'Czysta robota, klaszczę na stojąco. 👏',
    'Masterclass z irregular verbs. 🎓',
    'Native speakerzy właśnie ci zazdroszczą. 🇬🇧',
    'Shakespeare uronił łzę szczęścia. 🥲',
    'Twoja anglistka is proud of you. 👩‍🏫',
    'Nawet twój telefon uznaje twoją dominację. 📱',
  ];

  window.LANG_PACK = {
    voice: 'pl-PL',
    // PLN ceník — live Stripe prices (ověřeno proti checkoutu 2026-07-12).
    stripePrices: {
      lifetime: { id: 'price_1TsQVcK1GA1fPMpO4R1U3f9r', mode: 'payment' },      // 89,99 zł
      yearly:   { id: 'price_1TsQULK1GA1fPMpO9h6Jglu4', mode: 'subscription' }, // 49,99 zł/rok
      monthly:  { id: 'price_1TsQTNK1GA1fPMpOiIhQTUEp', mode: 'subscription' }, // 9,99 zł/mies.
    },
    texts: {
      // Hero
      hero_h2: '106 czasowników i 24 grupy według wzorców. Załapiesz wzorzec → masz całą grupę.',
      hero_h2_html: '<span class="hero-facts">106 czasowników i 24 grupy według wzorców.</span><span class="hero-slogan">Załapiesz wzorzec <span class="hero-arrow">→</span> masz całą grupę.</span>',
      hero_lead: '',
      hero_foot: '',
      // Faza 1 (przeglądanie)
      s1_eyebrow: 'Spokojny przegląd',
      s1_title: 'Rzuć okiem na wszystkie czasowniki w grupie',
      s1_sub: 'Na razie bez pisania — po prostu patrz, klikaj 🔊 i zwróć uwagę, jak zmienia się samogłoska.',
      s1_intro_desc: 'Spokojnie przejrzyj wszystkie czasowniki w tej grupie.',
      s1_done_btn: 'Gotowe, idę pisać ✍️ →',
      // Międzyfaza
      mh_title: 'Hold your horses! / Chwileczkę! ✋',
      mh_sub: 'Które wyglądają podejrzanie? Zaznacz je — poświęcimy im potem więcej uwagi.',
      mh_intro_desc: 'Zaznacz czasowniki, które według ciebie sprawią ci największy problem.',
      mh_done_btn: 'Gotowe, jedziemy dalej →',
      // Faza 2
      s2_intro_title: 'Faza 2 — Piszemy formy ✍️',
      s2_intro_desc: 'Widzisz polskie słowo, wpisujesz 3 angielskie formy, zatwierdzasz Enterem. Jeśli pojawi się błąd, czasownik wraca na koniec kolejki i spotkacie się jeszcze raz. Do dzieła!',
      s2_finale_title: 'Wymieszane 🔀',
      s2_finale_desc: 'Wszystkie czasowniki w losowej kolejności. Wpisujesz wszystkie 3 formy naraz, wynik zobaczysz po Enterze — 1× bez błędu wystarczy, żeby czasownik wypadł z kolejki.',
      tip_atomic: '<kbd>Enter</kbd> = następne pole, sprawdzenie na końcu',
      tip_field: 'Po każdej formie naciśnij <kbd>Enter</kbd>',
      giveup_btn: 'Nie wiem 😭',
      giveup_confirm: 'Na pewno? Kliknij jeszcze raz 😭',
      // Feedback (pooly; hantec spada na pro)
      fb_pass_ok:      { pro: POS_PRO, student: POS_STUDENT },
      fb_pass_redo_ok: { pro: POS_PRO, student: POS_STUDENT },
      fb_pass_wrong:   { pro: NEG_PRO, student: NEG_STUDENT },
      fb_finale_ok:    { pro: POS_PRO, student: POS_STUDENT },
      fb_finale_wrong: { pro: NEG_PRO, student: NEG_STUDENT },
      fb_streak:       { pro: STREAK_PRO, student: STREAK_STUDENT },
      // Wyniki
      results_h2: 'Gotowe! 🎉',
      stat_green: 'opanowane',
      stat_yellow: 'prawie',
      stat_red: 'jeszcze walczy',
      res_again: 'Powtórz tylko te oporne',
      res_again_all: 'Poćwicz jeszcze raz',
      res_new: 'Nowa lekcja',
      res_back_all: 'Wróć do wszystkich grup',
      // Chip sekcji
      chip_default: 'Losowy mix 🎲',
      chip_mastered: 'Wielki test 🏆',
      // Modal grupy
      gsm_title: 'Jak chcesz ćwiczyć?',
      gsm_sub: 'Tę grupę już znasz — wybierz tryb.',
      gsm_all: 'Wszystkie czasowniki',
      gsm_problem: 'Tylko te oporne',
      // Streak — nagrody
      streak_title_h: 'Twoja nagroda — wybieraj!',
      streak_sub_h: function (days) { return 'Masz za sobą ' + days + ' dni z rzędu. 🔥 Wybrana grupa zostaje twoja na zawsze — nawet jeśli seria się kiedyś przerwie.'; },
      streak_foot_h: 'Tip: wybraną grupę możesz ćwiczyć od razu po wyborze.',
      // Popisky u serii: liczba dni jest renderowana osobno przy cyfrze
      // (plur_day), więc sam popisek jej NIE powtarza.
      streak_label_zero: '<span class="streak-lbl-d">🎁 jeszcze 3 dni z rzędu = nowa grupa za darmo</span><span class="streak-lbl-m">jeszcze 3 dni = nowa grupa</span>',
      streak_label_pending: '🎁 nieodebrana nagroda — wybierz',
      streak_label_grace: '<span class="streak-lbl-d">⏳ zdąż dziś, inaczej seria przepadnie</span><span class="streak-lbl-m">⏳ zdąż dziś!</span>',
      streak_label_maxed: '👑 wszystko opanowane',
      streak_label_progress: function (n, nWord, r, rWord) { return '🎁 jeszcze ' + r + ' ' + rWord + ' = nowa grupa'; },
      streak_label_premium: '🔥 tak trzymaj',
      srm_title: 'Wymieszana powtórka 🎲',
      srm_sub_some: 'Losowa przechadzka przez całą sekcję. Wybierz zakres.',
      srm_sub_clean: 'Cała sekcja na zielono — żadnych opornych czasowników. Możesz śmiało przejść wszystko jeszcze raz dla pewności.',
      // Paywall
      pw_title: 'Odblokuj wszystkie czasowniki 🔓',
      pw_sub: 'Za darmo masz 3 grupy (15 czasowników). Premium otwiera wszystkie <strong>106 czasowników</strong> w 24 grupach oraz <strong>🚗 Tryb samochodowy</strong> do ćwiczenia w aucie.',
      pw_plan1_note: 'jednorazowo, bez odnawiania',
      pw_plan2_note: '7 dni za darmo · potem 9,99 zł/mies. · anulujesz w każdej chwili',
      pw_plan_yearly_note: '7 dni za darmo · potem 49,99 zł/rok · oszczędzasz 58 %',
      // Toasty
      toast_resume: 'Wracamy tam, gdzie skończyłeś(-aś). 👍',
      toast_pay_ok: '🎉 Gotowe! Premium aktywuje się w kilka sekund. (Przy 7-dniowym okresie próbnym pierwsza płatność zejdzie dopiero za tydzień.)',
      toast_pay_cancel: 'Płatność anulowana. Możesz do niej wrócić w każdej chwili.',
      toast_no_problem: '🎉 Żadnych opornych czasowników — całą grupę masz opanowaną.',
      toast_login_fail: function (e) { return 'Logowanie się nie powiodło — ' + e; },
      // Menu
      menu_lesson: '🎓 Lekcje',
      menu_browse: '📚 Lista czasowników',
      menu_fc: '🃏 Fiszki',
      menu_quiz: '✅ Szybki quiz',
      // Webview banner
      wv_copied: '✓ Skopiowano',
      wv_copy: 'Skopiuj link',
      wv_copy_fail: '✗ Nie udało się',
      // Miejscownik — zdanie w banerze brzmi „Jesteś w …".
      wv_app_labels: { facebook: 'Facebooku', instagram: 'Instagramie', messenger: 'Messengerze', tiktok: 'TikToku', linkedin: 'LinkedInie', twitter: 'X/Twitterze', other: 'innej aplikacji' },
      // Trofea
      trophy_3: '3 dni z rzędu',
      trophy_7: '7 dni — cały tydzień',
      trophy_14: '14 dni — dwa tygodnie',
      trophy_30: '30 dni — miesiąc',
      trophy_100: '100 dni — setka',
      trophy_365: '365 dni — rok',
      style_names: function () { return { pro: 'Styl: 💼 Korpo-slang', student: 'Styl: 🎒 Szkolny klimat', hantec: 'Styl: 💼 Korpo-slang' }; },
      // TTS
      tts_missing: '🔊 Nie masz zainstalowanego angielskiego głosu — czasowniki są przez to czytane „po polsku". ',
      tts_android: 'Android: Ustawienia → Język → Syntezator mowy → Google → Pobierz English.',
      tts_ios: 'iOS: Ustawienia → Ogólne → Język i region → dodaj English.',
      tts_windows: 'Windows: Ustawienia → Czas i język → Język → Dodaj English.',
      tts_other: 'Zainstaluj w systemie angielski głos TTS.',
      // Liczba mnoga
      plur_verbs: function (n) { return plVerbs(n); },
      plur_groups: function (n) { return plGroups(n); },
      plur_days_row: function (n) { return n === 1 ? 'dzień z rzędu' : 'dni z rzędu'; },
      plur_day: function (n) { return n === 1 ? 'dzień' : 'dni'; },
      chip_title_mastered: function (n) { return 'Test zbiorczy całej sekcji — ' + n + ' ' + plVerbs(n) + ' w losowej kolejności'; },
      chip_title_default: function (n) { return 'Losowa przechadzka przez ' + n + ' ' + plVerbs(n) + ' z tej sekcji'; },
      medal_all: 'Wszystkie czasowniki opanowane!',
      medal_weak: 'Prawie! Jeden czasownik się wymknął — popraw go, a medal wróci.',
      lock_premium: 'Tylko w Premium',
      bonus_free_toast: '🎁 Ta grupa jest dla ciebie odblokowana za darmo!',
      sec_review_pattern: function (n) { return 'Test zbiorczy · ' + n + ' ' + plVerbs(n); },
      sec_review_label: 'Test zbiorczy',
      sec_review_title: 'Test zbiorczy sekcji',
      sec_review_desc: function (n) { return n + ' ' + plVerbs(n) + ' z tej sekcji w losowej kolejności. Wpisujesz wszystkie trzy formy, naciskasz Enter — 1× bez błędu wystarczy, żeby czasownik wypadł z kolejki. Do dzieła!'; },
      resume_stage1: 'Faza 1 · Zapoznanie',
      resume_stage15: 'Międzyfaza · Zaznacz trudne',
      resume_stage2: 'Faza 2 · Pisanie',
      resume_stage_generic: 'niedokończone ćwiczenie',
      resume_step1: 'po kolei',
      resume_step2: 'wymieszane',
      resume_filtered: function (n) { return ' · tylko oporne (' + n + ')'; },
      resume_dismiss_aria: 'Zamknij komunikat — zapomnij o niedokończonym ćwiczeniu',
      resume_dismiss_title: 'Zamknij — niedokończone ćwiczenie zostanie zapomniane',
      resume_title: 'Masz niedokończone ćwiczenie',
      resume_continue: 'Kontynuuj',
      resume_restart: 'Zacznij od nowa',
      s1_intro_title: 'Faza 1 — Zapoznanie',
      form_inf: 'bezokolicznik',
      form_past: 'past',
      form_past_full: 'past simple',
      form_pp: 'past participle',
      speak_all_title: 'Odtwórz wszystkie formy',
      speak_title: 'Odtwórz',
      step_pill_1: '1) nauka',
      step_pill_2: '2) po kolei',
      step_pill_3: '3) wymieszane',
      remaining_of: function (n, total) { return 'zostało ' + n + ' z ' + total; },
      remaining: function (n) { return 'zostało ' + n; },
      audio_title_on: 'Audio po odpowiedzi jest WŁĄCZONE — kliknij, aby wyłączyć',
      audio_title_off: 'Audio po odpowiedzi jest WYŁĄCZONE — kliknij, aby włączyć',
      check_btn: 'Sprawdź',
      next_btn: 'Dalej →',
      pick_btn: 'Wybierz',
      reset_confirm_cloud: 'Na pewno chcesz wyzerować cały postęp? Zostanie usunięty także z chmury (konto Google).\n\nTej operacji nie da się cofnąć.',
      reset_confirm: 'Na pewno chcesz wyzerować cały postęp?\n\nTej operacji nie da się cofnąć.',
      generic_fail: 'Coś poszło nie tak. Spróbuj jeszcze raz.',
      start_today: 'zacznij dziś',
      stats_mastered_verbs: 'czasowniki',
      stats_in_progress: function (n) { return ' · ' + n + ' w trakcie'; },
      stats_trophies_aria: 'Zdobyte trofea',
      streak_pill_aria: 'Seria — jak to działa',
      stats_mastered_groups: 'grupy',
      // Opisy po kliknięciu w kafelek statystyki (toast).
      // Konstrukcja „X z Y" — po „z" zawsze dopełniacz liczby mnogiej,
      // dzięki czemu forma jest poprawna dla każdej liczby (2, 5, 22…).
      stat_verbs_info: function (m, total, inp) {
        var base = 'Znasz perfekcyjnie ' + m + ' z ' + total + ' czasowników!';
        return inp ? base + ' (' + inp + ' w trakcie nauki)' : base;
      },
      stat_groups_info: function (m, total) {
        if (!m) return 'Opanuj całą grupę, a pojawi się tutaj. W sumie jest ich ' + total + '.';
        return m === 1
          ? 'Masz w całości opanowaną 1 grupę z ' + total + '!'
          : 'Masz w całości opanowane ' + m + ' z ' + total + ' grup!';
      },
      stat_verbs_aria: 'Opanowane czasowniki — co to znaczy',
      stat_groups_aria: 'Opanowane grupy — co to znaczy',
      next_weak_batch: 'Kolejna porcja słabych punktów →',
      slaba_icon: { pro: '🎯', student: '👾' },
      slaba_tile_title: { pro: 'Dzisiejszy target', student: 'Boss mode' },
      slaba_sub_mixed: {
        pro: function (w, r) { return w + ' ' + pl(w, 'oporny', 'oporne', 'opornych') + ' + ' + r + ' ' + pl(r, 'losowy', 'losowe', 'losowych'); },
        student: function (w, r) { return w + ' ' + pl(w, 'zfailowany', 'zfailowane', 'zfailowanych') + ' + ' + r + ' random'; },
      },
      slaba_sub_clean: {
        pro: function (n) { return n + ' ' + pl(n, 'losowy', 'losowe', 'losowych') + ' · retention check'; },
        student: function (n) { return n + ' random · spot check'; },
      },
      try_title: 'Zacznij ćwiczyć',
      try_sub: 'Zacznij od pierwszej grupy — wystarczy kliknąć',
      slaba_cold: 'Jeszcze za mało danych — zrób kilka lekcji i wróć. 🌱',
      slaba_title: 'Słabe punkty',
      slaba_pattern: function (n) { return 'Dzisiejsza porcja słabych punktów · ' + n + ' ' + plVerbs(n); },
      premium_badge: 'Premium',
      practice_cta: 'Poćwicz to!',
      flash_hint: 'kliknij, aby odwrócić',
      auto_pick_group: 'Wybierz przynajmniej jedną grupę czasowników.',
      auto_no_problem: 'Żadnych opornych czasowników — wszystko masz opanowane! 🎉',
      auto_empty: 'Wybrane grupy nie zawierają żadnych czasowników.',
      auto_exit_btn: '⏏️ Wyjdź',
      auto_exit_aria: 'Zakończ jazdę audio',
      auto_stop_btn: '⏸ Stop',
      auto_stop_aria: 'Wstrzymaj jazdę audio',
      auto_shuffled: '🔀 Wymieszane — zaczynamy 3 rundy od nowa.',
      auto_done: '🎉 Gotowe! 3 rundy ukończone.',
      auto_round_toast: function (r, total) { return 'Runda ' + r + ' / ' + total + ' 🚀'; },
      auto_progress: function (r, total, i, n) { return 'Runda ' + r + '/' + total + ' · ' + i + '/' + n; },
      auto_zero_groups: '0 grup',
      auto_selection: function (g, v) { return g + ' ' + plGroups(g) + ' · ' + v + ' ' + plVerbs(v); },
      quiz_all_chip: 'Wszystko',
      quiz_pick_correct: function (label) { return 'Wybierz poprawną formę (' + label + ')'; },
      quiz_fill_hint: function (cs) { return 'Uzupełnij past simple i past participle · <em>' + cs + '</em>'; },
      quiz_correct_is: 'Poprawnie:',
      theme_light: 'Tryb jasny',
      theme_dark: 'Tryb ciemny',
      sounds_on: 'Dźwięki odpowiedzi: włączone',
      sounds_off: 'Dźwięki odpowiedzi: wyłączone',
      backend_unavailable: 'Backend jest niedostępny.',
      login_first: 'Najpierw zaloguj się przez Google.',
      opening: 'Otwieram…',
      portal_no_customer: 'Twoja subskrypcja nie idzie przez Stripe (np. kod promocyjny). Nie ma czym zarządzać.',
      portal_error: 'Błąd podczas otwierania portalu: ',
      account_word: 'konto',
      sign_out_label: function (name) { return 'Wyloguj (' + name + ')'; },
      sign_in_google: 'Zaloguj się przez Google',
      signed_in_aria: function (name) { return 'Zalogowano jako ' + name + '. Kliknij, aby się wylogować.'; },
      signed_in_title: function (name) { return 'Zalogowano: ' + name + ' — kliknij, aby się wylogować'; },
      sign_in_short: 'Zaloguj',
      signing_in: 'Logowanie…',
      login_failed: 'Logowanie nie powiodło się: ',
      promo_errors: function () {
        return {
          not_found: 'Nie znamy tego kodu. Sprawdź literówki.',
          inactive: 'Kod jest dezaktywowany.',
          expired: 'Kod już wygasł.',
          exhausted: 'Kod został wyczerpany — wszystkie miejsca zajęte.',
          already_redeemed: 'Ten kod został już przez ciebie użyty.',
          invalid_code_format: 'Kod ma zły format.',
          no_user: 'Najpierw zaloguj się przez Google.',
          no_backend: 'Backend jest niedostępny. Spróbuj później.',
          network: 'Błąd sieci. Spróbuj za chwilę.',
        };
      },
      promo_enter: 'Wpisz kod.',
      promo_checking: 'Sprawdzam…',
      promo_error_prefix: 'Błąd: ',
      promo_ok_msg: 'Kod aktywowany! 🎉 Premium jest twoje.',
      promo_ok_toast: '🎉 Kod aktywowany — wszystkie grupy są twoje!',
      loading: 'Wczytuję…',
      backend_wait: 'Backend jest chwilowo niedostępny. Spróbuj za moment.',
      checkout_error: 'Błąd podczas rozpoczynania płatności: ',
      sync_titles: function () {
        return {
          idle: 'synchronizacja z chmurą wyłączona',
          'signing-in': 'logowanie…',
          syncing: 'synchronizacja…',
          synced: 'zsynchronizowano',
          error: 'błąd synchronizacji',
        };
      },
      signout_confirm: 'Na pewno chcesz się wylogować?',
      dialect_ame: 'Wariant: amerykański (AmE)',
      dialect_bre: 'Wariant: brytyjski (BrE)',

      // ---- Teacher mode (generator testów) ----------------------------------
      teacher_pick_all: 'zaznacz wszystko',
      teacher_pick_none: 'wyczyść',
      teacher_selected: function (n, g) {
        return 'Wybrano: ' + n + ' ' + plVerbs(n) + ' · ' + g + ' ' + plGroups(g);
      },
      teacher_none_selected: 'Wybierz co najmniej jedną grupę czasowników.',
      teacher_test_title: 'Czasowniki nieregularne — test',
      teacher_key_title: 'Czasowniki nieregularne — klucz dla nauczyciela',
      teacher_variant: function (v) { return 'Wariant ' + v; },
      // dvojtečky na konci: kód je pro tiskové boxy odřezává (.replace(/:$/,''))
      teacher_name: 'Imię i nazwisko:',
      teacher_class: 'Klasa:',
      teacher_date: 'Data:',
      teacher_score: 'Punkty:',
      teacher_grade: 'Ocena:',
      teacher_col_num: 'Nr',
      teacher_col_inf: 'Bezokolicznik',
      teacher_col_past: 'Past simple',
      teacher_col_pp: 'Past participle',
      teacher_col_cs: 'Po polsku',
      teacher_instr_inf2: 'Uzupełnij czas przeszły (past simple) i imiesłów bierny (past participle).',
      teacher_instr_cs3: 'Uzupełnij wszystkie trzy formy czasownika na podstawie polskiego tłumaczenia.',
      teacher_instr_missing: 'Uzupełnij brakującą formę w każdym wierszu.',
      teacher_instr_choice: 'Zakreśl poprawną parę form (past simple – past participle).',
      teacher_domain: 'czasowniki.pl',
      teacher_groups_label: 'Grupy: ',
      teacher_groups_mix: function (g) { return 'mieszanka z ' + g + ' grup'; },
      teacher_footer: 'czasowniki.pl — aplikacja, z którą twoja klasa nauczy się czasowników nieregularnych',
      teacher_key_correct: 'Poprawne odpowiedzi (przy czasownikach z kilkoma formami każda z podanych jest poprawna):',
      teacher_limit_print: function (txt) { return '⏱ limit czasu: ' + txt; },
      teacher_limit_print_word: function (txt) { return '⏱ ' + txt + ' na czasownik'; },

      quiz_cs3_hint: 'Uzupełnij wszystkie trzy formy po angielsku',

      // ---- Test cyfrowy (link + kod o oddaniu pracy) -------------------------
      dt_copied: 'Link skopiowany 📋',
      dt_copy_fail: 'Kopiowanie się nie udało — zaznacz link i skopiuj ręcznie.',
      dt_premium_blocked: 'Wybrane grupy wykraczają poza wersję bezpłatną — odblokuj Premium albo wybierz tylko darmowe grupy.',

      dt_intro_sub: function (n) {
        return n + ' ' + pl(n, 'pytanie', 'pytania', 'pytań') + ' · po ukończeniu dostaniesz kod dla nauczyciela';
      },
      dt_name_missing: 'Wpisz imię i nazwisko, żeby nauczyciel wiedział, czyja to praca.',
      // „próba" jest rodzaju żeńskiego → „twoja … próba"
      dt_attempt_note: function (n) {
        return n > 1 ? 'To twoja ' + n + '. próba — nauczyciel zobaczy to w kodzie.' : '';
      },

      // Idzie wprost do kodu o oddaniu pracy. Suma kontrolna liczy się tylko
      // z danych, a parser bierze stąd samą liczbę — język nie psuje weryfikacji.
      dt_code_attempt: function (n) { return n + '. próba'; },
      dt_code_copied: 'Kod skopiowany 📋',
      dt_bad_link: 'Link do testu jest uszkodzony albo już nieaktualny. Poproś nauczyciela o nowy.',

      dt_verify_col_name: 'Imię i nazwisko',
      dt_verify_col_score: 'Wynik',
      dt_verify_col_attempt: 'Próba',
      dt_verify_col_state: 'Status',
      dt_verify_col_wrong: 'Błędne odpowiedzi',
      dt_verify_timeout: 'Upłynął limit czasu — test został oddany automatycznie',
      dt_time_up: '⏱ Czas minął — test został oddany.',
      // Trvání se skládá zvlášť (dtDuration) a vkládá se i do tiskové hlavičky,
      // proto MIANOWNIK („1 minuta“, ne „1 minutę“) a věty s dvojtečkou —
      // vazba „masz…“ by u téhož řetězce vyžadovala biernik. Viz docs/i18n.md.
      dt_secs: function (s) { return s + ' ' + pl(s, 'sekunda', 'sekundy', 'sekund'); },
      dt_mins: function (m) { return m + ' ' + pl(m, 'minuta', 'minuty', 'minut'); },
      dt_limit_note_test: function (txt) { return '⏱ Limit na cały test: ' + txt + '.'; },
      dt_limit_note_word: function (txt) {
        return '⏱ Limit na każdy czasownik: ' + txt + ' — potem pytanie się zamknie.';
      },
      dt_verify_no_mistakes: 'bez błędu',
      dt_verify_ok: '✅ prawidłowy',
      dt_verify_bad: '❌ nie zgadza się',
      dt_verify_verified: 'imię z konta Google',
      dt_verify_empty: 'Wklej przynajmniej jeden kod.',
      dt_verify_no_test: 'Najpierw utwórz link do testu — kody sprawdzane są względem niego.',
      dt_verify_summary: function (ok, total) { return 'Prawidłowych ' + ok + ' z ' + total; },
    },

    // ---- Překlady dat (localizeData v app.js) -------------------------------
    data: {
      sections: {
        '1.0.0': 'Wszystkie 3 formy są różne',
        '2.0.0': 'Dwie formy są takie same',
        '3.0.0': 'Wszystkie 3 formy są takie same',
      },
      groups: {
        '1.1.0':  { pattern: 'I → A → U', rule: 'Litera I z bezokolicznika zmienia się w past simple na A, a w past participle na U.' },
        '1.2.1':  { pattern: 'OW → EW → OWN', rule: 'Końcówka –OW (–AW) z bezokolicznika zmienia się w past simple na –EW, a w past participle na –OWN (–AWN). Czasownik FLY ma inny bezokolicznik.' },
        '1.2.3':  { pattern: 'I → O → I+EN', rule: 'Bezokolicznikowe -I- zmienia się w past simple na -O-, a w past participle wraca do -I- i dochodzi końcówka –EN. Wymowa -I- w bezokoliczniku i w imiesłowie jest różna.' },
        '1.2.4a': { pattern: 'samogłoska → zmiana → bezok.+EN', rule: 'W past simple zmienia się samogłoska. W past participle samogłoska jest taka sama jak w bezokoliczniku, ale forma kończy się na –EN.' },
        '1.2.4b': { pattern: 'większe zmiany w past simple', rule: 'Zasady jak w poprzedniej grupie, ale w past simple zachodzą większe zmiany.' },
        '1.2.5':  { pattern: 'AKE → OOK → AKEN', rule: 'Końcowe –AKE z bezokolicznika zmienia się w past simple na –OOK, a w past participle na –AKEN.' },
        '1.2.6':  { pattern: 'E (O) → O → O+EN', rule: 'Czasowniki mają w past simple w środku -O-, a forma kończy się na –E. W past participle znów -O- w środku i końcówka –EN.' },
        '1.2.7':  { pattern: 'O w środku', rule: 'Czasowniki mają w past simple w środku -O-. W past participle znów -O- w środku i końcówka –EN. Imiesłów czytamy krótko.' },
        '1.2.8':  { pattern: 'I → <s>E</s> → I+EN', rule: 'Bezokolicznik ma w środku -I-, które zostaje we wszystkich formach. Końcowe –E znika w past simple. Past participle kończy się na –EN i podwaja literę w środku.' },
        '1.2.9':  { pattern: 'EAR → ORE → ORN', rule: 'Końcowe –EAR z bezokolicznika zmienia się w past simple na –ORE, a w past participle na –ORN.' },
        '1.2.10': { pattern: 'bez reguły', rule: 'Wszystkie trzy formy są różne i nie ma tu żadnych dalszych reguł.' },
        '2.1.1':  { pattern: 'EE/EA → E → T', rule: '-EE- (ewentualnie -EA-) z bezokolicznika zmienia się w past simple i past participle na -E-. Obie formy kończą się na –T.' },
        '2.1.2':  { pattern: 'EA zostaje, czytamy krótko → T', rule: '-EA- w pisowni się nie zmienia. W formach nieregularnych piszemy -EA-, ale czytamy krótko. Formy przeszłe kończą się na –T.' },
        '2.1.3':  { pattern: '→ OUGHT / AUGHT', rule: 'Formy nieregularne kończą się na –OUGHT lub –AUGHT.' },
        '2.1.4':  { pattern: 'D → T', rule: 'Końcowe –D z bezokolicznika zmienia się w formach nieregularnych na –T.' },
        '2.1.5':  { pattern: '→ T (często też regularne)', rule: 'Grupa czasowników, których formy nieregularne kończą się na –T. Często mogą być też regularne.' },
        '2.2.1':  { pattern: 'EED → ED', rule: 'Bezokolicznikowa końcówka –EED zmienia się na –ED.' },
        '2.2.2':  { pattern: 'AY → AID', rule: 'Końcówka –AY zmienia się na –AID. Wymowa jest regularna. Uwaga na wymowę SAID!' },
        '2.2.3':  { pattern: 'ELL → OLD', rule: 'Bezokolicznikowa końcówka –ELL zmienia się na –OLD.' },
        '2.2.4':  { pattern: '→ D (bez reguły)', rule: 'Grupa czasowników, których formy nieregularne kończą się na –D. Więcej reguł tu nie ma.' },
        '2.3.1':  { pattern: 'I → U', rule: '-I- z bezokolicznika zmienia się w formach nieregularnych na -U-.' },
        '2.3.2':  { pattern: 'zmiana samogłoski, bez reguły', rule: 'Kategoria „cała reszta". Past simple i past participle są takie same, zmienia się samogłoska. Niektóre czasowniki bywają też regularne.' },
        '2.4.0':  { pattern: 'bezok. = pp', rule: 'Ostatnia kategoria dwóch identycznych form. Zazwyczaj bezokolicznik i past participle.' },
        '3.0.0':  { pattern: 'bezok. = past = pp', rule: 'Wszystkie trzy formy są identyczne. Niektóre czasowniki mogą być też regularne.' },
      },
      verbs: {
        // 1.1.0
        begin: 'zaczynać', drink: 'pić', ring: 'dzwonić', sing: 'śpiewać',
        sink: 'tonąć, opadać', stink: 'śmierdzieć', swim: 'pływać',
        // 1.2.1
        blow: 'dmuchać, wiać', grow: 'rosnąć', know: 'znać, wiedzieć',
        throw: 'rzucać', draw: 'rysować, ciągnąć', fly: 'latać',
        // 1.2.3
        drive: 'prowadzić (auto)', ride: 'jeździć', rise: 'wznosić się', write: 'pisać',
        // 1.2.4a
        fall: 'padać, upadać', forgive: 'wybaczać', give: 'dawać',
        // 1.2.4b
        be: 'być', eat: 'jeść', see: 'widzieć',
        // 1.2.5
        shake: 'trząść, potrząsać', take: 'brać',
        // 1.2.6
        break: 'łamać, tłuc', choose: 'wybierać', freeze: 'zamarzać, mrozić',
        speak: 'mówić', steal: 'kraść', wake: 'budzić (się)',
        // 1.2.7 (get też w 2.3.2 — jeden klíč stačí)
        forget: 'zapominać', get: 'dostawać',
        // 1.2.8
        bite: 'gryźć', hide: 'ukrywać (się), chować',
        // 1.2.9
        swear: 'przysięgać, przeklinać', tear: 'rwać, drzeć', wear: 'nosić (ubranie)',
        // 1.2.10
        do: 'robić', go: 'iść, jechać', lie: 'leżeć',
        // 2.1.1
        feel: 'czuć (się)', keep: 'trzymać, zachowywać', leave: 'wychodzić, opuszczać',
        meet: 'spotykać', sleep: 'spać', sweep: 'zamiatać',
        // 2.1.2
        deal: 'rozdawać, zajmować się', mean: 'znaczyć, mieć na myśli',
        // 2.1.3
        bring: 'przynosić', buy: 'kupować', catch: 'łapać', fight: 'walczyć, kłócić się',
        seek: 'szukać', teach: 'uczyć (kogoś)', think: 'myśleć',
        // 2.1.4
        bend: 'zginać (się)', build: 'budować', lend: 'pożyczać (komuś)',
        send: 'wysyłać', spend: 'wydawać, spędzać',
        // 2.1.5
        burn: 'palić (się), płonąć', learn: 'uczyć się', lose: 'przegrywać, gubić',
        // 2.2.1
        bleed: 'krwawić', feed: 'karmić', lead: 'prowadzić',
        // 2.2.2
        lay: 'kłaść', pay: 'płacić', say: 'mówić, powiedzieć',
        // 2.2.3
        sell: 'sprzedawać', tell: 'mówić, opowiadać',
        // 2.2.4
        find: 'znajdować', have: 'mieć', hear: 'słyszeć', hold: 'trzymać',
        read: 'czytać (uwaga na wymowę!)', stand: 'stać', understand: 'rozumieć',
        // 2.3.1
        dig: 'kopać', spin: 'wirować, kręcić (się)', stick: 'wtykać, utknąć, przyklejać',
        sting: 'żądlić, kłuć',
        // 2.3.2
        hang: 'wisieć, wieszać', light: 'zapalać, oświetlać', make: 'robić, tworzyć',
        shoot: 'strzelać', sit: 'siadać, siedzieć', strike: 'uderzać',
        win: 'wygrywać, zwyciężać',
        // 2.4.0
        become: 'stawać się (kimś)', come: 'przychodzić, przyjeżdżać', run: 'biegać',
        // 3.0.0
        bet: 'zakładać się, obstawiać', cost: 'kosztować', cut: 'ciąć, kroić',
        hit: 'uderzać', hurt: 'ranić, boleć', let: 'pozwalać', put: 'kłaść, stawiać',
        quit: 'rzucać, kończyć', set: 'ustawiać, nastawiać', shut: 'zamykać',
        spread: 'rozprzestrzeniać, rozsmarowywać', upset: 'denerwować, martwić',
      },
    },
  };
})();
