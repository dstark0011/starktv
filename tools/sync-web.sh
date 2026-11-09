#!/usr/bin/env bash
# The page code is shared: app/src/main/assets/web/{app.js,style.css} is the master copy.
# Windows uses the same two files; index.html is NOT shared (the PC one loads hls.js/mpegts.js, the TV one loads
# tv-shim.js + tv-nav.js) – edit both index.html files when adding page elements.
set -e
cd "$(dirname "$0")/.."
cp app/src/main/assets/web/app.js app/src/main/assets/web/style.css windows/app/
echo "synced app.js + style.css → windows/app/"
diff -q <(grep -o 'id="[a-zA-Z]*"' app/src/main/assets/web/index.html | sort -u) <(grep -o 'id="[a-zA-Z]*"' windows/app/index.html | sort -u) >/dev/null \
  || echo "note: the two index.html files have different element ids – check nothing new is missing from one of them"
