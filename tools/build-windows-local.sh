#!/usr/bin/env bash
# Build the Windows app locally (Linux/macOS/Windows with Node 20). GitHub does this automatically on every build;
# use this only to hand someone a zip directly. Output: windows/dist/StarkTV-Windows-<ver>.zip
set -e
cd "$(dirname "$0")/../windows"
V=$(node -p "require('./package.json').version.split('.').slice(0,2).join('.')")
npm install --no-audit --no-fund
mkdir -p app/vendor && cp node_modules/hls.js/dist/hls.min.js node_modules/mpegts.js/dist/mpegts.js app/vendor/
rm -rf dist && npx @electron/packager . "StarkTV v$V" --platform=win32 --arch=x64 --out=dist --overwrite \
  --ignore="^/dist" --ignore="^/README.txt"
cd dist && mv "StarkTV v$V-win32-x64" StarkTV
# exe icon + version info without Wine
(cd StarkTV && npx -y resedit-cli --in "StarkTV v$V.exe" --out x.exe --icon 1,../../starktv.ico --product-name StarkTV \
  --file-description StarkTV --product-version "$V.0.0" --file-version "$V.0.0" && mv -f x.exe "StarkTV v$V.exe")
zip -qr -9 "StarkTV-Windows-$V.zip" StarkTV && ls -la "StarkTV-Windows-$V.zip"
