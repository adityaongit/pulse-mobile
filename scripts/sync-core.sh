#!/usr/bin/env bash
# Copies pulse's pure code into this repo byte for byte, then runs the checks. Never edit the copies here.
# Usage: scripts/sync-core.sh [path to a pulse checkout, default ../pulse]
set -euo pipefail

# The src/lib files the app uses, plus every src/lib file they import. Each one's .test.ts comes along when it exists.
LIB=(format url bands reasons behaviors dashboard extraMetrics log calendar charts collapse timeZone trend features)

pulse="$(cd "${1:-../pulse}" && pwd)"
cd "$(dirname "$0")/.."
[ -d "$pulse/src/core" ] || { echo "no src/core in $pulse" >&2; exit 1; }

rm -rf src/core && cp -R "$pulse/src/core" src/core
mkdir -p src/lib
for name in "${LIB[@]}"; do
  for f in "src/lib/$name.ts" "src/lib/$name.test.ts"; do
    if [ -e "$pulse/$f" ]; then cp "$pulse/$f" "$f"; else rm -f "$f"; fi
  done
done

# time.ts is byte-identical too; it sits at src/time.ts so ported ../time imports match pulse's src/server layout.
cp "$pulse/src/server/time.ts" src/time.ts
cp "$pulse/src/server/time.test.ts" src/time.test.ts

git status --short src/core src/lib src/time.ts src/time.test.ts
pnpm typecheck && pnpm test
