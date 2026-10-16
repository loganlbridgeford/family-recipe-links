#!/bin/bash
# Copy the website into www/ for the iPhone app. Does not change the Vercel files.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/www"

rm -rf "$DEST"
mkdir -p "$DEST/js" "$DEST/icons"

cp "$ROOT/index.html" "$ROOT/privacy.html" "$ROOT/support.html" \
  "$ROOT/manifest.webmanifest" "$ROOT/styles.css" "$ROOT/app.js" "$DEST/"
cp "$ROOT/js/config.js" "$ROOT/js/db.js" "$DEST/js/"
cp "$ROOT/icons/apple-touch-icon.png" "$ROOT/icons/icon.svg" "$DEST/icons/"

python3 - "$DEST" <<'PY'
import pathlib, sys
dest = pathlib.Path(sys.argv[1])
config = dest / "js" / "config.js"
text = config.read_text()
old = "API_BASE: '',"
new = "API_BASE: 'https://family-recipe-links.vercel.app',"
if old not in text:
    raise SystemExit("www config is missing API_BASE")
config.write_text(text.replace(old, new, 1))
for name in ("index.html", "privacy.html", "support.html"):
    path = dest / name
    html = path.read_text()
    html = html.replace('href="/privacy"', 'href="privacy.html"')
    html = html.replace('href="/support"', 'href="support.html"')
    html = html.replace('href="/"', 'href="index.html"')
    path.write_text(html)
PY

echo "www ready"
