#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
target="${1:?full release SHA required}"
expected="${2:?patch bundle checksum required}"
[[ "$target" =~ ^[a-f0-9]{40}$ && "$expected" =~ ^[a-f0-9]{64}$ ]]
root=/var/www/granter/Grapsi
run="$root/backups/source-watch-resilience-20261025-01"
stage="$run/checkout"
test "$(id -un)" = ramankhosa
exec 9>"$run/stage.lock"
flock 9
test -f "$run/BUILD_READY"
test "$(git -C "$root" rev-parse HEAD)" = 9de9c263dad92185665ab52b6cc58e29bc147abe
test "$(sha256sum /tmp/grapsi-resilience-final.bundle | cut -d' ' -f1)" = "$expected"
cd "$stage"
test -z "$(git status --porcelain --untracked-files=no)"
git fetch /tmp/grapsi-resilience-final.bundle HEAD
test "$(git rev-parse FETCH_HEAD)" = "$target"
git merge --ff-only FETCH_HEAD
mv "$run/BUILD_READY" "$run/BEFORE_FINAL_BUILD_READY"
NODE_OPTIONS=--max-old-space-size=4096 nice -n10 node node_modules/typescript/bin/tsc --noEmit --pretty false > "$run/typecheck-final.log" 2>&1
node node_modules/eslint/bin/eslint.js --no-eslintrc --config .eslintrc.json src/lib/monitor src/lib/metering/providers/gemini-provider.ts src/components/funding/monitor src/app/api/funding/monitor > "$run/lint-final.log" 2>&1
NEXT_TELEMETRY_DISABLED=1 NEXT_SKIP_CHECKS=1 NODE_OPTIONS=--max-old-space-size=4096 ionice -c2 -n6 nice -n10 npm run build:cached > "$run/build-final.log" 2>&1
git restore -- tsconfig.json
test -z "$(git status --porcelain --untracked-files=no)"
git rev-parse HEAD > "$run/ready-commit"
cp .next/BUILD_ID "$run/ready-build-id"
touch "$run/BUILD_READY"
echo FINAL_BUILD_READY
