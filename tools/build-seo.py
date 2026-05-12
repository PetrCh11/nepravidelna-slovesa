#!/usr/bin/env python3
"""
Generate seznam/index.html — a fully static, SEO-optimized landing page
listing all 106 irregular verbs grouped by pronunciation pattern.

Run after any changes to data/verbs.json:
    python3 tools/build-seo.py

Outputs:
    seznam/index.html  — the landing page
    sitemap.xml        — updated sitemap
    robots.txt         — robots policy
"""

import json
import html
import os
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = json.load(open(os.path.join(ROOT, 'data', 'verbs.json'), encoding='utf-8'))

SITE = 'https://ucseslovesa.cz'

TOTAL = sum(len(sub['verbs']) for sec in DATA['sections'] for sub in sec['subsections'])

# ---------- HTML escaping helpers ----------
def esc(s):
    return html.escape(str(s or ''), quote=True)

# ---------- Build the verb table rows by section ----------
section_blocks = []
flat_items_for_schema = []
for sec in DATA['sections']:
    sub_blocks = []
    for sub in sec['subsections']:
        verb_rows = []
        for v in sub['verbs']:
            inf  = v['inf']
            past = v['past']
            pp   = v['pp']
            cs   = v['cs']
            emoji = v.get('emoji') or '·'
            verb_rows.append(f'''
              <tr>
                <td class="emoji" aria-hidden="true">{esc(emoji)}</td>
                <td class="inf"><strong>{esc(inf)}</strong></td>
                <td class="past">{esc(past)}</td>
                <td class="pp">{esc(pp)}</td>
                <td class="cs">{esc(cs)}</td>
              </tr>''')
            flat_items_for_schema.append(f'{inf} – {past} – {pp} ({cs})')
        sub_blocks.append(f'''
          <section class="verb-sub" id="sub-{esc(sub['id'])}">
            <h3>
              <span class="sub-id">{esc(sub['id'])}</span>
              <span class="sub-pattern">{esc(sub['pattern'])}</span>
              <span class="sub-count">{len(sub['verbs'])} sloves</span>
            </h3>
            <div class="verb-table-wrap">
              <table class="verb-table">
                <thead>
                  <tr>
                    <th class="emoji" aria-hidden="true"></th>
                    <th>Infinitiv</th>
                    <th>Past simple</th>
                    <th>Past participle</th>
                    <th>Význam</th>
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
          <span class="sec-count">{section_total} sloves</span>
        </h2>
        {''.join(sub_blocks)}
      </section>''')

# ---------- Schema.org markup (FAQ + ItemList) ----------
faqs = [
    ("Co jsou nepravidelná slovesa v angličtině?",
     "Nepravidelná slovesa jsou ta, jejichž tvary minulého času (past simple) a "
     "trpného příčestí (past participle) se netvoří přidáním -ed, ale mění se "
     "samohláska nebo celý tvar. Příklad: <strong>go – went – gone</strong>."),
    ("Kolik je nepravidelných sloves v angličtině?",
     "Běžně se používá zhruba 100–200 nepravidelných sloves. Na ucseslovesa.cz "
     f"najdeš {TOTAL} nejdůležitějších rozdělených do <strong>24 výslovnostních skupin</strong>, "
     "ve kterých se chovají stejně."),
    ("Jak se naučit nepravidelná slovesa rychle?",
     "Klíčem je naučit se je <strong>podle vzorců</strong>, ne nazpaměť jeden po druhém. "
     "Slovesa jako <em>begin – began – begun</em>, <em>drink – drank – drunk</em> "
     "nebo <em>ring – rang – rung</em> sdílí stejný vzorec I → A → U — když chytneš jeden, "
     "máš celou skupinu. Náš systém tě těmihle skupinami provede krok za krokem."),
    ("Co je rozdíl mezi past simple a past participle?",
     "<strong>Past simple</strong> je druhý tvar a používá se v minulém čase: "
     "<em>I went to school</em>. <strong>Past participle</strong> je třetí tvar a "
     "používá se pro trpný rod a předpřítomný čas: <em>I have gone</em>, "
     "<em>the door was opened</em>."),
    ("Která jsou nejdůležitější nepravidelná slovesa?",
     "Mezi nejčastější patří <strong>be, have, do, say, go, get, make, know, "
     "see, take, come, think, give, find, tell</strong>. Všechna jsou v našem "
     "seznamu — postupně si je projdeš podle výslovnostních vzorců."),
    ("Liší se výslovnost mezi britskou a americkou angličtinou?",
     "U některých sloves ano (např. <em>learn → learnt</em> v britské vs. "
     "<em>learn → learned</em> v americké). V appce si můžeš nahoře přepnout "
     "mezi 🇬🇧 BrE a 🇺🇸 AmE — vždy se ti zobrazí správné tvary."),
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
    "name": "Anglická nepravidelná slovesa – kompletní seznam",
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

# ---------- TOC (anchor links to each section) ----------
toc_items = []
for sec in DATA['sections']:
    section_total = sum(len(sub['verbs']) for sub in sec['subsections'])
    toc_items.append(
        f'<li><a href="#sec-{esc(sec["id"])}">'
        f'<span class="toc-num">{esc(sec["id"])}</span> {esc(sec["title"])} '
        f'<span class="toc-count">({section_total})</span></a></li>'
    )
toc_html = '\n'.join(toc_items)

# ---------- Full page ----------
today = date.today().isoformat()
page = f'''<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>Anglická nepravidelná slovesa – kompletní seznam {TOTAL} sloves po skupinách | ucseslovesa.cz</title>
  <meta name="description" content="Kompletní přehled {TOTAL} anglických nepravidelných sloves rozdělených do 24 výslovnostních skupin. Past simple, past participle, český překlad. Naučte se je systematicky, ne biflováním." />
  <meta name="keywords" content="nepravidelná slovesa, anglická nepravidelná slovesa, past simple, past participle, seznam nepravidelných sloves, irregular verbs česky, slovesa angličtina" />
  <link rel="canonical" href="{SITE}/seznam/" />
  <link rel="alternate" hreflang="cs" href="{SITE}/seznam/" />
  <meta name="theme-color" content="#5dc9bd" />

  <!-- Open Graph -->
  <meta property="og:type" content="article" />
  <meta property="og:title" content="Anglická nepravidelná slovesa – kompletní seznam {TOTAL} sloves" />
  <meta property="og:description" content="{TOTAL} sloves ve 24 výslovnostních skupinách. Past simple, past participle, český překlad." />
  <meta property="og:url" content="{SITE}/seznam/" />
  <meta property="og:locale" content="cs_CZ" />
  <meta property="og:site_name" content="Nepravidelná slovesa – jednou a provždy" />
  <meta property="og:image" content="{SITE}/icon-512.png" />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Anglická nepravidelná slovesa – kompletní seznam" />
  <meta name="twitter:description" content="{TOTAL} sloves ve 24 výslovnostních skupinách." />

  <!-- Icons / PWA -->
  <link rel="icon" type="image/png" href="../icon-192.png" />
  <link rel="apple-touch-icon" href="../icon-180.png" />

  <!-- Privacy-friendly analytics by Plausible -->
  <script async src="https://plausible.io/js/pa-NrtAvvEOU7AQy_bMCdI_S.js"></script>
  <script>
    window.plausible=window.plausible||function(){{(plausible.q=plausible.q||[]).push(arguments)}},plausible.init=plausible.init||function(i){{plausible.o=i||{{}}}};
    plausible.init()
  </script>

  <!-- Schema.org structured data -->
  <script type="application/ld+json">{json.dumps(faq_schema, ensure_ascii=False)}</script>
  <script type="application/ld+json">{json.dumps(list_schema, ensure_ascii=False)}</script>

  <link rel="stylesheet" href="seznam.css" />
</head>
<body>
  <header class="seo-header">
    <div class="container">
      <a class="seo-logo" href="../">
        <img src="../icon-192.png" alt="" width="40" height="40" />
        <div class="seo-logo-text">
          <span class="seo-logo-name">Nepravidelná slovesa</span>
          <span class="seo-logo-sub">… jednou a provždy.</span>
        </div>
      </a>
      <a class="seo-cta seo-cta-header" href="../" data-track="cta_header">Spustit aplikaci →</a>
    </div>
  </header>

  <main class="container">
    <article>
      <h1>Anglická nepravidelná slovesa – kompletní seznam</h1>
      <p class="lede">
        Tady najdeš všech <strong>{TOTAL} nejpoužívanějších nepravidelných sloves</strong>
        v angličtině — přehledně rozdělených do <strong>24 výslovnostních skupin</strong>,
        ve kterých se slovesa chovají stejně. U každého slovesa najdeš
        <em>infinitiv</em>, <em>past simple</em>, <em>past participle</em> a <em>český překlad</em>.
      </p>
      <p class="lede">
        Místo aby ses učil/a 106 sloves nazpaměť jeden po druhém, naše appka tě provede
        skupinami: jakmile chytneš jeden vzorec (např. <em>I → A → U</em>:
        <em>begin – began – begun</em>, <em>drink – drank – drunk</em>, <em>ring – rang – rung</em>),
        zvládneš najednou celou skupinu. <a href="../">Vyzkoušej zdarma →</a>
      </p>

      <div class="seo-cta-banner">
        <div>
          <strong>Učíš se systematicky nebo biflováním?</strong>
          <p>Naše appka tě provede všemi {TOTAL} slovesy po skupinách. 3 skupiny zdarma, pak Premium od 49 Kč.</p>
        </div>
        <a class="seo-cta" href="../" data-track="cta_top">Otevřít appku</a>
      </div>

      <nav class="seo-toc" aria-label="Obsah">
        <h2>Obsah</h2>
        <ol>{toc_html}</ol>
      </nav>

      <h2 id="seznam">Seznam sloves po skupinách</h2>
      {''.join(section_blocks)}

      <section class="faq" id="faq">
        <h2>Často kladené otázky</h2>
        {faq_html}
      </section>

      <div class="seo-cta-banner">
        <div>
          <strong>Naučit se {TOTAL} sloves jednou a provždy</strong>
          <p>Spusť interaktivní lekci. Píšeš tvary, dostaneš zpětnou vazbu, vidíš svůj pokrok.</p>
        </div>
        <a class="seo-cta" href="../" data-track="cta_bottom">Spustit aplikaci →</a>
      </div>
    </article>
  </main>

  <footer class="seo-footer">
    <div class="container">
      <p>© ucseslovesa.cz · <a href="../">Aplikace</a> · <a href="#seznam">Seznam</a> · <a href="#faq">FAQ</a></p>
      <p class="seo-foot-meta">Aktualizováno: {today}</p>
    </div>
  </footer>
</body>
</html>'''

os.makedirs(os.path.join(ROOT, 'seznam'), exist_ok=True)
with open(os.path.join(ROOT, 'seznam', 'index.html'), 'w', encoding='utf-8') as f:
    f.write(page)
print(f'Wrote seznam/index.html ({TOTAL} verbs across {sum(len(s["subsections"]) for s in DATA["sections"])} subgroups)')

# ---------- sitemap.xml ----------
sitemap = f'''<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>{SITE}/</loc>
    <lastmod>{today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>{SITE}/seznam/</loc>
    <lastmod>{today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.9</priority>
  </url>
</urlset>
'''
with open(os.path.join(ROOT, 'sitemap.xml'), 'w', encoding='utf-8') as f:
    f.write(sitemap)
print('Wrote sitemap.xml')

# ---------- robots.txt ----------
robots = f'''User-agent: *
Allow: /

Sitemap: {SITE}/sitemap.xml
'''
with open(os.path.join(ROOT, 'robots.txt'), 'w', encoding='utf-8') as f:
    f.write(robots)
print('Wrote robots.txt')
