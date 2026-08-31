#!/bin/sh
# Sestaví polskou mutaci pro VLASTNÍ DOMÉNU (czasowniki.pl) do dist-pl/.
# Mutace v /pl/ na ucseslovesa.cz sdílí assety přes <base href="/">; na vlastní
# doméně žije polský web v rootu, takže build:
#   1. zkopíruje sdílené assety (app.js, styles, data/, lang/, ikony),
#   2. z pl/index.html odstraní <base> trik a přesměruje manifest na root,
#   3. z pl/manifest.json udělá root manifest (start_url/scope "/"),
#   4. upraví sw.js (bez /pl/ položek, vlastní jméno cache),
#   5. přidá CNAME a robots.txt.
# Nasazení: tools/deploy-pl.sh (push do repa PetrCh11/czasowniki-pl).
set -eu
cd "$(dirname "$0")/.."

rm -rf dist-pl
mkdir -p dist-pl

# 1) sdílené assety (ikony bere polské — pl/icon-*.png → root icon-*.png)
cp app.js cloud.js celebrate.js install.js styles.css dist-pl/
cp pl/icon-180.png pl/icon-192.png pl/icon-512.png dist-pl/
cp -R data lang dist-pl/
# PDF přehled (generuje tools/build-pdf.sh pl) — do rootu, ZÁMĚRNĚ mimo sw.js
# precache: ~1 MB, stahuje se živě stejně jako české PDF.
cp pl/czasowniki-nieregularne-lista.pdf dist-pl/
# Vstupní stránka pro učitele — ručně psaná, generátor ji nesahá (obdoba /pro-skoly/)
cp -R pl/dla-nauczycieli dist-pl/

# 2) index.html — pryč <base href="/"> (včetně vysvětlujícího komentáře),
#    manifest z pl/manifest.json na manifest.json
python3 - <<'PY'
import re
src = open('pl/index.html', encoding='utf-8').read()
src = re.sub(r'\n  <!-- Polská mutace žije v /pl/.*?<base href="/" />', '', src, flags=re.S)
src = src.replace('href="pl/manifest.json"', 'href="manifest.json"')
src = src.replace('pl/icon-', 'icon-')
open('dist-pl/index.html', 'w', encoding='utf-8').write(src)
PY

# 3) manifest — start_url/scope na root, ikony /pl/icon-* na /icon-*
sed 's|"/pl/|"/|g' pl/manifest.json > dist-pl/manifest.json

# 4) sw.js — bez /pl/ položek, jednoduchý fallback, vlastní jméno cache
python3 - <<'PY'
src = open('sw.js', encoding='utf-8').read()
src = src.replace("const CACHE = 'slovesa-", "const CACHE = 'slovesa-pl-")
for line in ["  // Polská mutace (docs/i18n.md) — ?v musí odpovídat script tagu v pl/index.html\n",
             "  './pl/',\n", "  './pl/index.html',\n", "  './pl/manifest.json',\n",
             "  './pl/icon-180.png',\n", "  './pl/icon-192.png',\n", "  './pl/icon-512.png',\n"]:
    assert line in src, 'sw.js se změnil, uprav build-pl.sh: ' + line.strip()
    src = src.replace(line, '')
old_fb = "caches.match(new URL(request.url).pathname.startsWith('/pl/') ? './pl/index.html' : './index.html')"
assert old_fb in src, 'sw.js fallback se změnil, uprav build-pl.sh'
src = src.replace(old_fb, "caches.match('./index.html')")
open('dist-pl/sw.js', 'w', encoding='utf-8').write(src)
PY

# 5) doména + SEO stránky (lista/, grupa/*, sitemap.xml, robots.txt)
printf 'czasowniki.pl\n' > dist-pl/CNAME
python3 tools/build-seo-pl.py

echo "OK: dist-pl/ sestaveno ($(find dist-pl -type f | wc -l | tr -d ' ') souborů)"
