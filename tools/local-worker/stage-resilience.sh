#!/usr/bin/env bash
# Isolated build only. Does not activate code, migrate live data or restart apps.
set -Eeuo pipefail
umask 077
target="${1:?full release SHA required}"
expected="${2:?bundle checksum required}"
[[ "$target" =~ ^[a-f0-9]{40}$ && "$expected" =~ ^[a-f0-9]{64}$ ]]
root=/var/www/granter/Grapsi
run="$root/backups/source-watch-resilience-20261025-01"
stage="$run/checkout"
test "$(id -un)" = ramankhosa
mkdir -p "$run"
exec 9>"$run/stage.lock"
flock -n 9
cd "$root"
test "$(git rev-parse HEAD)" = 9de9c263dad92185665ab52b6cc58e29bc147abe
test -z "$(git status --porcelain --untracked-files=no)"
test "$(sha256sum /tmp/grapsi-resilience.bundle | cut -d' ' -f1)" = "$expected"
git rev-parse HEAD > "$run/before-commit"
cp .next/BUILD_ID "$run/before-build-id"
cp /tmp/grapsi-resilience.bundle "$run/source.bundle"
git bundle verify "$run/source.bundle"
git fetch "$run/source.bundle" HEAD
test "$(git rev-parse FETCH_HEAD)" = "$target"
test ! -d "$stage"
git worktree add --detach "$stage" FETCH_HEAD
for file in .env .env.local .env.production .env.production.local; do
  if [ -f "$root/$file" ]; then cp -p "$root/$file" "$stage/$file"; cp -p "$root/$file" "$run/before-${file#.}"; fi
done
cd "$stage"
echo INSTALLING_ISOLATED_DEPENDENCIES
nice -n10 npm ci --ignore-scripts --no-audit --no-fund > "$run/install.log" 2>&1
node node_modules/prisma/build/index.js generate > "$run/generate.log" 2>&1
echo CHECKING_RELEASE
NODE_OPTIONS=--max-old-space-size=4096 nice -n10 node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false > "$run/typecheck.log" 2>&1
node node_modules/eslint/bin/eslint.js --no-eslintrc --config .eslintrc.json src/lib/monitor src/lib/metering/providers/gemini-provider.ts src/components/funding/monitor src/app/api/funding/monitor > "$run/lint.log" 2>&1
echo BUILDING_ISOLATED_RELEASE
NEXT_TELEMETRY_DISABLED=1 NEXT_SKIP_CHECKS=1 NODE_OPTIONS=--max-old-space-size=4096 ionice -c2 -n6 nice -n10 npm run build:cached > "$run/build.log" 2>&1
git restore -- tsconfig.json
test -f .next/BUILD_ID
test -z "$(git status --porcelain --untracked-files=no)"
git rev-parse HEAD > "$run/ready-commit"
cp .next/BUILD_ID "$run/ready-build-id"
touch "$run/BUILD_READY"
echo BUILD_READY
