#!/usr/bin/env bash
# Assembles public/index.html from src/ and syntax-checks it.
set -euo pipefail
cd "$(dirname "$0")"
cat src/shell.html src/top.js src/diag.js src/engine_a.js src/engine_b.js src/engine_3d.js src/engine_hdr.js src/engine_c.js src/ui.js > public/index.html
node -e "
const s=require('fs').readFileSync('public/index.html','utf8');
const m=[...s.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].pop();
require('fs').writeFileSync('/tmp/filefit-check.js', m[1]);"
node --check /tmp/filefit-check.js
if command -v php >/dev/null; then php -l public/diag/log.php >/dev/null; fi
echo "Built public/index.html ($(wc -c < public/index.html) bytes)"
