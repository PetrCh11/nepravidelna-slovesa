#!/bin/zsh
# Vygeneruje PDF přehled sloves z tools/prehled.html.
#   ./tools/build-pdf.sh        → Nepravidelna-slovesa-prehled.pdf (česky)
#   ./tools/build-pdf.sh pl     → pl/czasowniki-nieregularne-lista.pdf
# Polská varianta bere překlady z lang/pl.js (viz L10N v prehled.html).
# Spusť po jakékoli změně dat; polské PDF do dist-pl kopíruje tools/build-pl.sh.
#
# Postup: spustí lokální server v kořeni repa, vyrenderuje stránku
# přes headless Chrome (--print-to-pdf) a server zase zhasne.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LANG_CODE="${1:-cs}"
if [ "$LANG_CODE" = "cs" ]; then
  OUT="$ROOT/Nepravidelna-slovesa-prehled.pdf"
  PAGE="/tools/prehled.html"
else
  OUT="$ROOT/$LANG_CODE/czasowniki-nieregularne-lista.pdf"
  PAGE="/tools/prehled.html?lang=$LANG_CODE"
fi
PORT="${PORT:-8766}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

# 1) Lokální server (python http.server v kořeni repa)
python3 - "$ROOT" "$PORT" >/tmp/prehled-serve.log 2>&1 <<'PY' &
import sys, os, http.server, socketserver
os.chdir(sys.argv[1])
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", int(sys.argv[2])), http.server.SimpleHTTPRequestHandler) as h:
    h.serve_forever()
PY
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

# počkej, až server naběhne
for i in $(seq 1 20); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/data/verbs.json"; then break; fi
  sleep 0.2
done

# 2) Render do PDF
"$CHROME" --headless --disable-gpu --no-sandbox \
  --no-pdf-header-footer \
  --virtual-time-budget=8000 \
  --print-to-pdf="$OUT" \
  "http://127.0.0.1:$PORT$PAGE" 2>/dev/null

echo "Hotovo: $OUT"
