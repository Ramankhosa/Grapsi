#!/usr/bin/env bash
#
# Builds the one-file catalogue release for the production VM, on the dev box.
#
#   bash scripts/catalog-release/build-bundle.sh [--snapshot storage/import-snapshots/scientify-…]
#
# Output: storage/release-bundles/grapsi-catalog-release-<snapshot date>.tar.gz
# holding release.sh, its helpers, the operator README, the frozen snapshot
# (data only, no reports), bundle-manifest.json and SHA256SUMS.
#
# The manifest pins the seed files the import depends on (crosswalks, currency
# rates) by content, line endings normalised, plus the full migration list.
# release.sh refuses an app checkout that does not carry exactly those, so the
# data and the code it was checked against travel together. Rebuild the bundle
# after changing any of them.
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

SNAPSHOT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --snapshot) SNAPSHOT="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 64 ;;
  esac
done
if [ -z "$SNAPSHOT" ]; then
  SNAPSHOT="$(ls -d storage/import-snapshots/scientify-*/ 2>/dev/null | sort | tail -1)"
  SNAPSHOT="${SNAPSHOT%/}"
fi
[ -f "$SNAPSHOT/manifest.json" ] || { echo "no snapshot manifest at $SNAPSHOT" >&2; exit 1; }
SNAPSHOT_NAME="$(basename "$SNAPSHOT")"
STAMP="$(echo "$SNAPSHOT_NAME" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}')"
NAME="grapsi-catalog-release-$STAMP"
OUT="storage/release-bundles"
STAGE="$OUT/$NAME"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "warning: the working tree has uncommitted changes; the VM checkout must carry them too" >&2
fi

rm -rf "$STAGE" "$OUT/$NAME.tar.gz"
mkdir -p "$STAGE/lib" "$STAGE/snapshot/$SNAPSHOT_NAME"
cp scripts/catalog-release/release.sh "$STAGE/"
cp scripts/catalog-release/README.md "$STAGE/"
cp scripts/catalog-release/lib/*.mjs "$STAGE/lib/"
node -e '
  const fs = require("fs"), path = require("path");
  const [src, dst] = process.argv.slice(1);
  const manifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));
  for (const f of manifest.files) fs.copyFileSync(path.join(src, f.name), path.join(dst, f.name));
  fs.copyFileSync(path.join(src, "manifest.json"), path.join(dst, "manifest.json"));
' "$SNAPSHOT" "$STAGE/snapshot/$SNAPSHOT_NAME"

node -e '
  const fs = require("fs"), path = require("path"), crypto = require("crypto");
  const [stage, snapshot, commit] = process.argv.slice(1);
  const norm = (f) => crypto.createHash("sha256").update(fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n")).digest("hex");
  const seed = ["Seed/currency-rates.csv", ...fs.readdirSync("Seed/crosswalks").filter((f) => f.endsWith(".csv")).map((f) => "Seed/crosswalks/" + f)];
  const codeFiles = Object.fromEntries(seed.sort().map((f) => [f, norm(f)]));
  const migrations = fs.readdirSync("prisma/migrations").filter((d) => fs.existsSync(path.join("prisma/migrations", d, "migration.sql"))).sort();
  const snap = JSON.parse(fs.readFileSync(path.join(stage, "snapshot", snapshot, "manifest.json"), "utf8"));
  const manifest = { builtAt: new Date().toISOString(), gitCommit: commit, snapshot, snapshotFiles: snap.files, codeFiles, migrations };
  fs.writeFileSync(path.join(stage, "bundle-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
' "$STAGE" "$SNAPSHOT_NAME" "$(git rev-parse --short HEAD)"

( cd "$STAGE" && find . -type f ! -name SHA256SUMS | sed 's#^\./##' | sort | while read -r f; do sha256sum "$f"; done > SHA256SUMS )
chmod +x "$STAGE/release.sh"
tar -C "$OUT" -czf "$OUT/$NAME.tar.gz" "$NAME"
rm -rf "$STAGE"

echo "bundle: $REPO/$OUT/$NAME.tar.gz ($(du -h "$OUT/$NAME.tar.gz" | cut -f1))"
echo "sha256: $(sha256sum "$OUT/$NAME.tar.gz" | cut -d' ' -f1)"
echo "built against commit $(git rev-parse --short HEAD) with snapshot $SNAPSHOT_NAME"
