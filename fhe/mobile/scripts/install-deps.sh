#!/bin/sh
# Installs node_modules OUTSIDE this directory (the project SSD is nearly full) and symlinks it here.
# Override the location with FHISH_MOBILE_DEPS=/some/dir.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEPS="${FHISH_MOBILE_DEPS:-$HOME/.fhish-pay-mobile}"
mkdir -p "$DEPS"
cp "$HERE/package.json" "$DEPS/package.json"
[ -f "$HERE/package-lock.json" ] && cp "$HERE/package-lock.json" "$DEPS/package-lock.json"
(cd "$DEPS" && npm install --no-audit --no-fund --cache "$DEPS/npm-cache" "$@")
cp "$DEPS/package-lock.json" "$HERE/package-lock.json"
[ -L "$HERE/node_modules" ] || { rm -rf "$HERE/node_modules"; ln -s "$DEPS/node_modules" "$HERE/node_modules"; }
node "$HERE/scripts/build-tfhe-webview.mjs"
