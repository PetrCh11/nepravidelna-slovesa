#!/bin/sh
# Nasadí polskou mutaci na czasowniki.pl: build + force-push dist-pl/
# do repa PetrCh11/czasowniki-pl (GitHub Pages, branch main, root).
# Předpoklad: repo existuje a máš k němu push práva (git credentials).
set -eu
cd "$(dirname "$0")/.."

SHA=$(git rev-parse --short HEAD)
sh tools/build-pl.sh

cd dist-pl
git init -q -b main
git add -A
git commit -q -m "deploy czasowniki.pl z nepravidelna-slovesa@${SHA}"
git push -f https://github.com/PetrCh11/czasowniki-pl.git main
cd ..
rm -rf dist-pl/.git
echo "OK: nasazeno (commit ${SHA})"
