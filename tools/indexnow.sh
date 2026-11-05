#!/bin/sh
# Ohlásí všechny URL ze sitemap obou webů přes IndexNow (Bing, Seznam, Yandex…).
# Klíč = jediný soubor <hex>.txt v rootu repa (na CZ webu je v rootu; build-pl.sh
# ho kopíruje i do dist-pl). Spouštěj po deployi s novým/změněným obsahem:
#   sh tools/indexnow.sh            # oba weby
#   sh tools/indexnow.sh czasowniki.pl
set -eu
cd "$(dirname "$0")/.."
KEYFILE=$(ls | grep -E '^[0-9a-f]{32}\.txt$' | head -1)
KEY=${KEYFILE%.txt}
HOSTS=${1:-"ucseslovesa.cz czasowniki.pl"}
for HOST in $HOSTS; do
  URLS=$(curl -fsS "https://$HOST/sitemap.xml" | grep -o '<loc>[^<]*</loc>' | sed 's/<[^>]*>//g' | grep "^https://$HOST/")
  JSON=$(printf '%s\n' "$URLS" | python3 -c "import sys,json;u=[l.strip() for l in sys.stdin if l.strip()];print(json.dumps({'host':'$HOST','key':'$KEY','keyLocation':'https://$HOST/$KEYFILE','urlList':u}))")
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json; charset=utf-8' -d "$JSON" https://api.indexnow.org/indexnow)
  echo "$HOST: $(printf '%s\n' "$URLS" | wc -l | tr -d ' ') URL → HTTP $CODE (200/202 = přijato)"
done
