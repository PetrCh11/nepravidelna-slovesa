#!/usr/bin/env python3
"""
Generate SEO landing pages for czasowniki.pl (Polish mutation).

Polish sibling of build-seo.py. Verb/group/section translations come from
lang/pl.js (single source of truth for Polish data — parsed, not duplicated).
Slugs live in tools/slugs-pl.json (shared with build-seo.py for hreflang).

Outputs (into dist-pl/ — run via tools/build-pl.sh AFTER assets are copied):
    lista/index.html               — full 106-verb table (jumbo page)
    lista/lista.css                — copy of seznam/seznam.css
    grupa/<slug>/index.html        — 24 per-group landing pages
    sitemap.xml                    — sitemap with all URLs + hreflang alternates
    robots.txt                     — robots policy
"""

import json
import html
import os
import re
import shutil
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist-pl')
DATA = json.load(open(os.path.join(ROOT, 'data', 'verbs.json'), encoding='utf-8'))
SLUGS = json.load(open(os.path.join(ROOT, 'tools', 'slugs-pl.json'), encoding='utf-8'))
SLUGS_CS = None  # lazy — only needed for hreflang; imported below

SITE = 'https://czasowniki.pl'
SITE_CS = 'https://ucseslovesa.cz'
TODAY = date.today().isoformat()

# ---------- Polish translations parsed from lang/pl.js ----------
def parse_pl_pack():
    src = open(os.path.join(ROOT, 'lang', 'pl.js'), encoding='utf-8').read()
    i_sec = src.index('sections: {')
    i_grp = src.index('groups: {')
    i_vrb = src.index('verbs: {')
    def unesc(s):
        return s.replace("\\'", "'").replace('\\\\', '\\')
    sections = {m.group(1): unesc(m.group(2)) for m in
                re.finditer(r"'([\w.]+)':\s*'((?:[^'\\]|\\.)*)'", src[i_sec:i_grp])}
    groups = {m.group(1): {'pattern': unesc(m.group(2)), 'rule': unesc(m.group(3))} for m in
              re.finditer(r"'([\w.]+)':\s*\{\s*pattern:\s*'((?:[^'\\]|\\.)*)',\s*rule:\s*'((?:[^'\\]|\\.)*)'", src[i_grp:i_vrb])}
    verbs = {m.group(1): unesc(m.group(2)) for m in
             re.finditer(r"(\w+):\s*'((?:[^'\\]|\\.)*)'", src[i_vrb:])}
    return sections, groups, verbs

PL_SECTIONS, PL_GROUPS, PL_VERBS = parse_pl_pack()

# Localize verbs.json in memory (mirror of localizeData() in app.js)
missing = []
for sec in DATA['sections']:
    sec['title'] = PL_SECTIONS.get(sec['id'], sec['title'])
    for sub in sec['subsections']:
        g = PL_GROUPS.get(sub['id'])
        if not g:
            missing.append('group ' + sub['id'])
        else:
            sub['pattern'] = g['pattern']
            sub['rule'] = g['rule']
        for v in sub['verbs']:
            if v['inf'] in PL_VERBS:
                v['cs'] = PL_VERBS[v['inf']]
            else:
                missing.append('verb ' + v['inf'])
if missing:
    raise SystemExit('Chybi polske preklady: ' + ', '.join(missing))

TOTAL = sum(len(sub['verbs']) for sec in DATA['sections'] for sub in sec['subsections'])
SUB_COUNT = sum(len(s['subsections']) for s in DATA['sections'])

def slug_for(sub_id):
    if sub_id not in SLUGS:
        raise KeyError(f'No PL slug for subsection {sub_id} — update tools/slugs-pl.json')
    return SLUGS[sub_id]

# CS slugs for hreflang pairing (same ids, from build-seo.py's table)
SLUGS_CS = {
    '1.1.0':  'i-a-u',    '1.2.1':  'ow-ew-own', '1.2.3': 'i-o-i-en',
    '1.2.4a': 'samohlaska-en', '1.2.4b': 'silne-zmeny-en', '1.2.5': 'ake-ook-aken',
    '1.2.6':  'e-o-o-en', '1.2.7':  'o-uprostred', '1.2.8': 'i-e-i-en',
    '1.2.9':  'ear-ore-orn', '1.2.10': 'bez-pravidla-tri-tvary',
    '2.1.1':  'ee-ea-e-t', '2.1.2': 'ea-kratke-t', '2.1.3': 'ought-aught',
    '2.1.4':  'd-na-t',   '2.1.5':  'casto-pravidelne-t', '2.2.1': 'eed-ed',
    '2.2.2':  'ay-aid',   '2.2.3':  'ell-old', '2.2.4': 'koncovka-d-bez-pravidla',
    '2.3.1':  'i-u',      '2.3.2':  'zmena-samohlasky', '2.4.0': 'inf-rovna-pp',
    '3.0.0':  'vsechny-tri-stejne',
}

ORDERED_SUBS = [sub for sec in DATA['sections'] for sub in sec['subsections']]

def esc(s):
    return html.escape(str(s or ''), quote=True)

def clean_pattern(p):
    return p.replace('<s>', '').replace('</s>', '').replace('<strong>', '').replace('</strong>', '')

def deeplink(sub_id):
    """App deep link — the app expects the group ID with dashes (see handleDeepLink in app.js)."""
    return '/#/skupina/' + sub_id.replace('.', '-')

def pl_czasownikow(n):
    """Polish plural: 1 czasownik, 2-4 czasowniki, 5+ czasowników (genitive for counts)."""
    if n == 1:
        return '1 czasownik'
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return f'{n} czasowniki'
    return f'{n} czasowników'

# Same Plausible script as pl/index.html — swap the pa-… id once czasowniki.pl
# gets its own Plausible site.
PLAUSIBLE_SNIPPET = '''
  <!-- Privacy-friendly analytics by Plausible -->
  <script async src="https://plausible.io/js/pa-NrtAvvEOU7AQy_bMCdI_S.js"></script>
  <script>
    window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};
    plausible.init()
  </script>'''

# ---------- Build the verb table rows by section (used by jumbo page) ----------
section_blocks = []
flat_items_for_schema = []
for sec in DATA['sections']:
    sub_blocks = []
    for sub in sec['subsections']:
        verb_rows = []
        for v in sub['verbs']:
            inf, past, pp, pl_tr = v['inf'], v['past'], v['pp'], v['cs']
            emoji = v.get('emoji') or '·'
            verb_rows.append(f'''
              <tr>
                <td class="emoji" aria-hidden="true">{esc(emoji)}</td>
                <td class="inf"><strong>{esc(inf)}</strong></td>
                <td class="past">{esc(past)}</td>
                <td class="pp">{esc(pp)}</td>
                <td class="cs">{esc(pl_tr)}</td>
              </tr>''')
            flat_items_for_schema.append(f'{inf} – {past} – {pp} ({pl_tr})')
        sub_slug = slug_for(sub['id'])
        sub_blocks.append(f'''
          <section class="verb-sub" id="sub-{esc(sub['id'])}">
            <h3>
              <span class="sub-id">{esc(sub['id'])}</span>
              <span class="sub-pattern">{esc(sub['pattern'])}</span>
              <span class="sub-count">{pl_czasownikow(len(sub['verbs']))}</span>
              <a class="sub-deep" href="/grupa/{sub_slug}/">Szczegóły grupy →</a>
            </h3>
            <div class="verb-table-wrap">
              <table class="verb-table">
                <caption class="sr-only">Tabela czasowników nieregularnych – grupa {esc(sub['id'])} ({esc(clean_pattern(sub['pattern']))})</caption>
                <thead>
                  <tr>
                    <th class="emoji" aria-hidden="true"></th>
                    <th>Bezokolicznik</th>
                    <th>Past simple</th>
                    <th>Past participle</th>
                    <th>Znaczenie</th>
                  </tr>
                </thead>
                <tbody>{''.join(verb_rows)}
                </tbody>
              </table>
            </div>
          </section>''')
    section_total = sum(len(sub['verbs']) for sub in sec['subsections'])
    section_blocks.append(f'''
      <section class="verb-section" id="sec-{esc(sec['id'])}">
        <h2>
          <span class="sec-id">{esc(sec['id'])}</span>
          <span class="sec-title">{esc(sec['title'])}</span>
          <span class="sec-count">{pl_czasownikow(section_total)}</span>
        </h2>
        {''.join(sub_blocks)}
      </section>''')

# ---------- Schema.org markup (FAQ + ItemList) for jumbo ----------
faqs = [
    ("Co to są czasowniki nieregularne w języku angielskim?",
     "Czasowniki nieregularne to te, których formy czasu przeszłego (past simple) i "
     "imiesłowu biernego (past participle) nie tworzy się przez dodanie -ed — zmienia się "
     "samogłoska albo cała forma. Przykład: <strong>go – went – gone</strong>."),
    ("Ile jest czasowników nieregularnych w angielskim?",
     "W praktyce używa się około 100–200 czasowników nieregularnych. Na czasowniki.pl "
     f"znajdziesz {TOTAL} najważniejszych, podzielonych na <strong>24 grupy według wzorców wymowy</strong>, "
     "w których zachowują się tak samo."),
    ("Jak szybko nauczyć się czasowników nieregularnych?",
     "Kluczem jest nauka <strong>według wzorców</strong>, a nie wkuwanie jednego po drugim. "
     "Czasowniki takie jak <em>begin – began – begun</em>, <em>drink – drank – drunk</em> "
     "czy <em>ring – rang – rung</em> dzielą ten sam wzorzec I → A → U — gdy załapiesz jeden, "
     "masz całą grupę. Nasz system przeprowadzi cię przez te grupy krok po kroku."),
    ("Jaka jest różnica między past simple a past participle?",
     "<strong>Past simple</strong> to druga forma, używana w czasie przeszłym: "
     "<em>I went to school</em>. <strong>Past participle</strong> to trzecia forma, "
     "używana w stronie biernej i czasie present perfect: <em>I have gone</em>, "
     "<em>the door was opened</em>."),
    ("Które czasowniki nieregularne są najważniejsze?",
     "Do najczęstszych należą <strong>be, have, do, say, go, get, make, know, "
     "see, take, come, think, give, find, tell</strong>. Wszystkie są na naszej "
     "liście — przejdziesz je po kolei według wzorców wymowy."),
    ("Czy wymowa różni się między brytyjskim a amerykańskim angielskim?",
     "Przy niektórych czasownikach tak (np. <em>learn → learnt</em> po brytyjsku vs. "
     "<em>learn → learned</em> po amerykańsku). W aplikacji możesz na górze przełączać "
     "między 🇬🇧 BrE i 🇺🇸 AmE — zawsze zobaczysz właściwe formy."),
]

faq_schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
        {
            "@type": "Question",
            "name": q,
            "acceptedAnswer": {
                "@type": "Answer",
                "text": a.replace('<strong>', '').replace('</strong>', '').replace('<em>', '').replace('</em>', ''),
            },
        }
        for q, a in faqs
    ],
}

list_schema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "Angielskie czasowniki nieregularne – pełna lista",
    "numberOfItems": TOTAL,
    "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": name}
        for i, name in enumerate(flat_items_for_schema)
    ],
}

faq_html = ''.join(
    f'<details class="faq-item"><summary>{esc(q)}</summary><p>{a}</p></details>'
    for q, a in faqs
)

# ---------- TOC ----------
toc_items = []
for sec in DATA['sections']:
    section_total = sum(len(sub['verbs']) for sub in sec['subsections'])
    toc_items.append(
        f'<li class="toc-section"><a href="#sec-{esc(sec["id"])}">'
        f'<span class="toc-num">{esc(sec["id"])}</span> {esc(sec["title"])} '
        f'<span class="toc-count">({section_total})</span></a></li>'
    )
    for sub in sec['subsections']:
        sub_slug = slug_for(sub['id'])
        pattern_clean = clean_pattern(sub['pattern'])
        toc_items.append(
            f'<li class="toc-sub"><a href="/grupa/{sub_slug}/">'
            f'<span class="toc-num">{esc(sub["id"])}</span> {esc(pattern_clean)} '
            f'<span class="toc-count">({len(sub["verbs"])})</span></a></li>'
        )
toc_html = '\n'.join(toc_items)

# ---------- Jumbo /lista/ page ----------
jumbo = f'''<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>Czasowniki nieregularne – tabela i pełna lista {TOTAL} czasowników | czasowniki.pl</title>
  <meta name="description" content="Pełna tabela {TOTAL} angielskich czasowników nieregularnych z polskim tłumaczeniem, podzielona na 24 grupy według wzorców wymowy. Past simple, past participle. Naucz się ich systematycznie, nie na pamięć." />
  <meta name="keywords" content="czasowniki nieregularne tabela, tabela czasowników nieregularnych, angielskie czasowniki nieregularne, czasowniki nieregularne, lista czasowników nieregularnych, past simple, past participle, irregular verbs po polsku, czasowniki angielski tabela" />
  <link rel="canonical" href="{SITE}/lista/" />
  <link rel="alternate" hreflang="pl" href="{SITE}/lista/" />
  <link rel="alternate" hreflang="cs" href="{SITE_CS}/seznam/" />
  <link rel="alternate" hreflang="x-default" href="{SITE_CS}/seznam/" />
  <meta name="theme-color" content="#5dc9bd" />

  <!-- Open Graph -->
  <meta property="og:type" content="article" />
  <meta property="og:title" content="Czasowniki nieregularne – tabela i pełna lista {TOTAL} czasowników" />
  <meta property="og:description" content="Tabela {TOTAL} czasowników w 24 grupach według wzorców wymowy. Past simple, past participle, polskie tłumaczenie." />
  <meta property="og:url" content="{SITE}/lista/" />
  <meta property="og:locale" content="pl_PL" />
  <meta property="og:site_name" content="Czasowniki nieregularne – raz na zawsze" />
  <meta property="og:image" content="{SITE}/icon-512.png" />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Czasowniki nieregularne – tabela i pełna lista" />
  <meta name="twitter:description" content="Tabela {TOTAL} czasowników w 24 grupach według wzorców wymowy." />

  <!-- Icons / PWA -->
  <link rel="icon" type="image/png" href="../icon-192.png" />
  <link rel="apple-touch-icon" href="../icon-180.png" />
{PLAUSIBLE_SNIPPET}

  <!-- Schema.org structured data -->
  <script type="application/ld+json">{json.dumps(faq_schema, ensure_ascii=False)}</script>
  <script type="application/ld+json">{json.dumps(list_schema, ensure_ascii=False)}</script>

  <link rel="stylesheet" href="lista.css" />
</head>
<body>
  <header class="seo-header">
    <div class="container">
      <a class="seo-logo" href="../">
        <img src="../icon-192.png" alt="" width="40" height="40" />
        <div class="seo-logo-text">
          <span class="seo-logo-name">Czasowniki nieregularne</span>
          <span class="seo-logo-sub">… raz na zawsze.</span>
        </div>
      </a>
      <a class="seo-cta seo-cta-header" href="../" data-track="cta_header">Uruchom aplikację →</a>
    </div>
  </header>

  <main class="container">
    <article>
      <h1>Angielskie czasowniki nieregularne – tabela i pełna lista</h1>
      <p class="lede">
        Przejrzysta <strong>tabela {TOTAL} najczęściej używanych czasowników nieregularnych</strong>
        w języku angielskim — podzielonych na <strong>24 grupy według wzorców wymowy</strong>,
        w których czasowniki zachowują się tak samo. Przy każdym czasowniku znajdziesz
        <em>bezokolicznik</em>, <em>past simple</em>, <em>past participle</em> i <em>polskie tłumaczenie</em>.
      </p>
      <p class="lede">
        Zamiast uczyć się 106 czasowników na pamięć jeden po drugim, nasza aplikacja przeprowadzi cię
        przez grupy: gdy tylko załapiesz jeden wzorzec (np. <em>I → A → U</em>:
        <em>begin – began – begun</em>, <em>drink – drank – drunk</em>, <em>ring – rang – rung</em>),
        opanujesz od razu całą grupę. <a href="../">Wypróbuj za darmo →</a>
      </p>

      <div class="seo-cta-banner">
        <div>
          <strong>Uczysz się systematycznie czy wkuwasz?</strong>
          <p>Nasza aplikacja przeprowadzi cię przez wszystkie {TOTAL} czasowników grupa po grupie. 3 grupy za darmo, potem Premium od 9,99 zł.</p>
        </div>
        <a class="seo-cta" href="../" data-track="cta_top">Otwórz aplikację</a>
      </div>

      <nav class="seo-toc" aria-label="Spis treści">
        <h2>Spis treści – 24 grupy</h2>
        <ol>{toc_html}</ol>
      </nav>

      <h2 id="lista">Lista czasowników według grup</h2>
      {''.join(section_blocks)}

      <section class="faq" id="faq">
        <h2>Najczęściej zadawane pytania</h2>
        {faq_html}
      </section>

      <div class="seo-cta-banner">
        <div>
          <strong>Naucz się {TOTAL} czasowników raz na zawsze</strong>
          <p>Uruchom interaktywną lekcję. Wpisujesz formy, dostajesz informację zwrotną, widzisz swoje postępy.</p>
        </div>
        <a class="seo-cta" href="../" data-track="cta_bottom">Uruchom aplikację →</a>
      </div>
    </article>
  </main>

  <footer class="seo-footer">
    <div class="container">
      <p>© czasowniki.pl · <a href="../">Aplikacja</a> · <a href="#lista">Lista</a> · <a href="#faq">FAQ</a> · <a href="mailto:hello@ucseslovesa.cz">✉️ kontakt</a></p>
      <p class="seo-foot-meta">Aktualizacja: {TODAY}</p>
    </div>
  </footer>
</body>
</html>'''

os.makedirs(os.path.join(OUT, 'lista'), exist_ok=True)
with open(os.path.join(OUT, 'lista', 'index.html'), 'w', encoding='utf-8') as f:
    f.write(jumbo)
shutil.copy(os.path.join(ROOT, 'seznam', 'seznam.css'), os.path.join(OUT, 'lista', 'lista.css'))
print(f'Wrote lista/index.html ({TOTAL} verbs across {SUB_COUNT} subgroups) + lista.css')

# ---------- Per-group landing pages ----------
def build_group_page(sub_idx, sub, parent_sec):
    sub_slug = slug_for(sub['id'])
    cs_slug = SLUGS_CS[sub['id']]
    pattern_clean = clean_pattern(sub['pattern'])
    n_verbs = len(sub['verbs'])
    n_str = pl_czasownikow(n_verbs)

    sample = sub['verbs'][:3]
    sample_str = ', '.join(f"{v['inf']}–{v['past']}–{v['pp']}" for v in sample)

    verb_rows = []
    schema_items = []
    for i, v in enumerate(sub['verbs']):
        inf, past, pp, pl_tr = v['inf'], v['past'], v['pp'], v['cs']
        emoji = v.get('emoji') or '·'
        verb_rows.append(f'''
            <tr>
              <td class="emoji" aria-hidden="true">{esc(emoji)}</td>
              <td class="inf"><strong>{esc(inf)}</strong></td>
              <td class="past">{esc(past)}</td>
              <td class="pp">{esc(pp)}</td>
              <td class="cs">{esc(pl_tr)}</td>
            </tr>''')
        schema_items.append({
            "@type": "ListItem",
            "position": i + 1,
            "name": f'{inf} – {past} – {pp} ({pl_tr})',
        })

    prev_sub = ORDERED_SUBS[sub_idx - 1] if sub_idx > 0 else None
    next_sub = ORDERED_SUBS[sub_idx + 1] if sub_idx < len(ORDERED_SUBS) - 1 else None
    related = []
    for s in (prev_sub, next_sub):
        if not s: continue
        s_slug = slug_for(s['id'])
        s_pattern = clean_pattern(s['pattern'])
        related.append(
            f'<li><a href="/grupa/{s_slug}/">'
            f'<span class="rel-id">{esc(s["id"])}</span> '
            f'<span class="rel-pattern">{esc(s_pattern)}</span> '
            f'<span class="rel-count">{pl_czasownikow(len(s["verbs"]))}</span></a></li>'
        )
    sibs = [x for x in parent_sec['subsections'] if x['id'] != sub['id'] and (not prev_sub or x['id'] != prev_sub['id']) and (not next_sub or x['id'] != next_sub['id'])]
    if sibs:
        s = sibs[0]
        s_slug = slug_for(s['id'])
        s_pattern = clean_pattern(s['pattern'])
        related.append(
            f'<li><a href="/grupa/{s_slug}/">'
            f'<span class="rel-id">{esc(s["id"])}</span> '
            f'<span class="rel-pattern">{esc(s_pattern)}</span> '
            f'<span class="rel-count">{pl_czasownikow(len(s["verbs"]))}</span></a></li>'
        )

    title = f'{pattern_clean} – czasowniki nieregularne: tabela ({n_verbs}) | czasowniki.pl'
    meta_desc = (
        f'Tabela {n_verbs} angielskich czasowników nieregularnych ze wzorcem {pattern_clean}: '
        f'{sample_str}. Reguła, wymowa, polskie tłumaczenie. '
        f'Naucz się całej grupy w 5 minut.'
    )[:300]

    breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Strona główna", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "Lista czasowników", "item": f"{SITE}/lista/"},
            {"@type": "ListItem", "position": 3, "name": pattern_clean, "item": f"{SITE}/grupa/{sub_slug}/"},
        ],
    }
    learning = {
        "@context": "https://schema.org",
        "@type": "LearningResource",
        "name": f'Czasowniki nieregularne – wzorzec {pattern_clean}',
        "description": f'{n_verbs} angielskich czasowników nieregularnych dzielących wzorzec {pattern_clean}.',
        "inLanguage": "pl",
        "learningResourceType": "Reference",
        "educationalLevel": "secondary",
        "audience": {"@type": "EducationalAudience", "educationalRole": "student"},
        "isPartOf": {"@type": "Course", "name": "Angielskie czasowniki nieregularne", "url": f"{SITE}/"},
        "url": f"{SITE}/grupa/{sub_slug}/",
    }
    item_list = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": f'Czasowniki ze wzorcem {pattern_clean}',
        "numberOfItems": n_verbs,
        "itemListElement": schema_items,
    }

    if len(sample) >= 2:
        teaser = ' Na przykład ' + ', '.join(
            f'<em>{v["inf"]} – {v["past"]} – {v["pp"]}</em>' for v in sample
        ) + '.'
    else:
        teaser = ''

    related_html = '\n'.join(related)
    app_link = deeplink(sub['id'])

    page = f'''<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(meta_desc)}" />
  <link rel="canonical" href="{SITE}/grupa/{sub_slug}/" />
  <link rel="alternate" hreflang="pl" href="{SITE}/grupa/{sub_slug}/" />
  <link rel="alternate" hreflang="cs" href="{SITE_CS}/skupina/{cs_slug}/" />
  <link rel="alternate" hreflang="x-default" href="{SITE_CS}/skupina/{cs_slug}/" />
  <meta name="theme-color" content="#5dc9bd" />

  <meta property="og:type" content="article" />
  <meta property="og:title" content="{esc(pattern_clean)} – czasowniki nieregularne ({n_verbs})" />
  <meta property="og:description" content="{esc(meta_desc)}" />
  <meta property="og:url" content="{SITE}/grupa/{sub_slug}/" />
  <meta property="og:locale" content="pl_PL" />
  <meta property="og:site_name" content="Czasowniki nieregularne – raz na zawsze" />
  <meta property="og:image" content="{SITE}/icon-512.png" />
  <meta name="twitter:card" content="summary" />

  <link rel="icon" type="image/png" href="/icon-192.png" />
  <link rel="apple-touch-icon" href="/icon-180.png" />
{PLAUSIBLE_SNIPPET}

  <script type="application/ld+json">{json.dumps(breadcrumb, ensure_ascii=False)}</script>
  <script type="application/ld+json">{json.dumps(learning, ensure_ascii=False)}</script>
  <script type="application/ld+json">{json.dumps(item_list, ensure_ascii=False)}</script>

  <link rel="stylesheet" href="/lista/lista.css" />
</head>
<body>
  <header class="seo-header">
    <div class="container">
      <a class="seo-logo" href="/">
        <img src="/icon-192.png" alt="" width="40" height="40" />
        <div class="seo-logo-text">
          <span class="seo-logo-name">Czasowniki nieregularne</span>
          <span class="seo-logo-sub">… raz na zawsze.</span>
        </div>
      </a>
      <a class="seo-cta seo-cta-header" href="{app_link}" data-track="cta_header">Uruchom aplikację →</a>
    </div>
  </header>

  <main class="container">
    <article>
      <nav class="breadcrumb" aria-label="Okruszki nawigacyjne">
        <a href="/">Strona główna</a> <span aria-hidden="true">›</span>
        <a href="/lista/">Lista czasowników</a> <span aria-hidden="true">›</span>
        <span aria-current="page">{esc(pattern_clean)}</span>
      </nav>

      <h1>Czasowniki nieregularne: wzorzec <span class="h1-pattern">{sub['pattern']}</span></h1>
      <p class="lede">
        Grupa zawiera {n_str} o tym samym wzorcu wymowy
        <strong>{esc(pattern_clean)}</strong>.{teaser}
        Gdy zapamiętasz jeden, znasz wszystkie.
      </p>

      <section class="rule-box">
        <h2>Reguła grupy</h2>
        <p>{sub.get('rule', '')}</p>
      </section>

      <div class="seo-cta-banner">
        <div>
          <strong>Naucz się całej grupy w 5 minut</strong>
          <p>Interaktywna lekcja — wpisujesz formy, dostajesz informację zwrotną. Ta grupa ({n_str}) czeka na ciebie w aplikacji zaraz po kliknięciu.</p>
        </div>
        <a class="seo-cta" href="{app_link}" data-track="cta_deep_{sub_slug}">Otwórz grupę w aplikacji →</a>
      </div>

      <section class="verb-sub" id="verbs">
        <h2>Tabela czasowników w tej grupie ({n_verbs})</h2>
        <div class="verb-table-wrap">
          <table class="verb-table">
            <caption class="sr-only">Tabela czasowników nieregularnych ze wzorcem {esc(pattern_clean)}</caption>
            <thead>
              <tr>
                <th class="emoji" aria-hidden="true"></th>
                <th>Bezokolicznik</th>
                <th>Past simple</th>
                <th>Past participle</th>
                <th>Znaczenie</th>
              </tr>
            </thead>
            <tbody>{''.join(verb_rows)}
            </tbody>
          </table>
        </div>
      </section>

      <section class="why-groups">
        <h2>Dlaczego warto uczyć się czasowników grupami?</h2>
        <p>
          Tradycyjne listy czasowników nieregularnych są alfabetyczne — obok siebie
          stoją <em>be</em>, <em>beat</em> i <em>become</em>, które nie mają ze sobą
          nic wspólnego. Ta strona idzie w drugą stronę: 106 czasowników podzieliliśmy
          na <strong>24 grupy według wzorców wymowy</strong>, w których czasowniki
          dzielą tę samą zmianę samogłoski lub końcówki.
        </p>
        <p>
          Zamiast wkuwać 106 niepowiązanych wierszy, łapiesz
          <strong>24 wzorce</strong> — a każdy odblokowuje ci 2–12 czasowników naraz.
          <a href="/lista/">Zobacz pełną listę ›</a>
        </p>
      </section>

      <section class="related">
        <h2>Przejdź do kolejnych grup</h2>
        <ul class="related-list">
          {related_html}
        </ul>
      </section>

      <div class="seo-cta-banner">
        <div>
          <strong>Wypróbuj tę grupę w aplikacji</strong>
          <p>3 grupy za darmo. Premium od 9,99 zł odblokowuje wszystkie {TOTAL} czasowników.</p>
        </div>
        <a class="seo-cta" href="{app_link}" data-track="cta_bottom_{sub_slug}">Uruchom lekcję →</a>
      </div>
    </article>
  </main>

  <footer class="seo-footer">
    <div class="container">
      <p>© czasowniki.pl · <a href="/">Aplikacja</a> · <a href="/lista/">Lista</a> · <a href="mailto:hello@ucseslovesa.cz">✉️ kontakt</a></p>
      <p class="seo-foot-meta">Aktualizacja: {TODAY}</p>
    </div>
  </footer>
</body>
</html>'''
    out_dir = os.path.join(OUT, 'grupa', sub_slug)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(page)

for sub_idx, sub in enumerate(ORDERED_SUBS):
    parent_sec = next(sec for sec in DATA['sections'] if sub in sec['subsections'])
    build_group_page(sub_idx, sub, parent_sec)
print(f'Wrote {len(ORDERED_SUBS)} grupa/<slug>/index.html pages')

# ---------- sitemap.xml (with hreflang alternates) ----------
def url_entry(loc_pl, loc_cs, cf, pr):
    lines = ['  <url>',
             f'    <loc>{loc_pl}</loc>',
             f'    <lastmod>{TODAY}</lastmod>',
             f'    <changefreq>{cf}</changefreq>',
             f'    <priority>{pr}</priority>',
             f'    <xhtml:link rel="alternate" hreflang="pl" href="{loc_pl}" />',
             f'    <xhtml:link rel="alternate" hreflang="cs" href="{loc_cs}" />',
             '  </url>']
    return lines

sitemap_lines = ['<?xml version="1.0" encoding="UTF-8"?>',
                 '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
                 '        xmlns:xhtml="http://www.w3.org/1999/xhtml">']
sitemap_lines += url_entry(f'{SITE}/', f'{SITE_CS}/', 'weekly', '1.0')
sitemap_lines += url_entry(f'{SITE}/lista/', f'{SITE_CS}/seznam/', 'monthly', '0.9')
for sub in ORDERED_SUBS:
    sitemap_lines += url_entry(
        f'{SITE}/grupa/{slug_for(sub["id"])}/',
        f'{SITE_CS}/skupina/{SLUGS_CS[sub["id"]]}/',
        'monthly', '0.8')
sitemap_lines.append('</urlset>')
sitemap_lines.append('')
with open(os.path.join(OUT, 'sitemap.xml'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(sitemap_lines))
print(f'Wrote sitemap.xml ({2 + len(ORDERED_SUBS)} URLs)')

# ---------- robots.txt ----------
with open(os.path.join(OUT, 'robots.txt'), 'w', encoding='utf-8') as f:
    f.write(f'User-agent: *\nAllow: /\n\nSitemap: {SITE}/sitemap.xml\n')
print('Wrote robots.txt')
