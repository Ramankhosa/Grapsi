#!/usr/bin/env bash
#
# Non-destructive in-place production build for the "build + `next start` from
# the same folder" setup (no release dirs).
#
# The problem this solves
# -----------------------
# `npm run build` runs `next build`, which overwrites `.next` in place. Because
# `next start` serves from that SAME `.next`, every rebuild removes the live
# build out from under the running server — the app breaks for the whole length
# of the build.
#
# What this does instead
# ----------------------
#   1. Builds into a SEPARATE dir (`.next.incoming`) via NEXT_DIST_DIR. The live
#      `.next` is never touched, so the running app keeps serving the old build
#      for the entire (multi-minute) build.
#   2. Only after the build succeeds, swaps the new build in with two quick
#      renames, keeping the old build as `.next.prev` for instant rollback.
#   3. Optionally reloads PM2 so the new build is actually served.
#
# If the build FAILS, the live `.next` is left exactly as it was — zero impact.
#
# Usage:
#   bash scripts/safe-build.sh                    # build + swap, then restart manually
#   PM2_APP=grapsi bash scripts/safe-build.sh     # build + swap + `pm2 reload grapsi`
#
# Rollback (if a bad build got swapped in):
#   rm -rf .next && mv .next.prev .next && pm2 restart <app>
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

LIVE=".next"
INCOMING=".next.incoming"
PREV=".next.prev"
PM2_APP="${PM2_APP:-}"

log()  { printf '\033[1;34m[safe-build]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[safe-build]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[safe-build] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ----- 1. clean any leftover incoming dir from a previous aborted run --------
rm -rf "$INCOMING"

# ----- 2. warm the build cache so the incremental build stays fast -----------
# A fresh distDir has no build cache, which would force a full rebuild. Seed it
# from the live build's cache so `next build` can reuse compilation results.
if [ -d "$LIVE/cache" ]; then
  mkdir -p "$INCOMING"
  cp -a "$LIVE/cache" "$INCOMING/cache" 2>/dev/null || true
fi

# ----- 3. build into the incoming dir (live .next stays up the whole time) ---
log "building into $INCOMING — the live $LIVE keeps serving…"
NEXT_TELEMETRY_DISABLED=1 NEXT_DIST_DIR="$INCOMING" npm run build:cached

# ----- 4. validate before swapping ------------------------------------------
[ -f "$INCOMING/BUILD_ID" ] \
  || die "build produced no $INCOMING/BUILD_ID — aborting. Live $LIVE is untouched."

# ----- 5. near-atomic swap, keeping the previous build for rollback ----------
log "swapping in the new build (previous kept as $PREV)…"
rm -rf "$PREV"
[ -e "$LIVE" ] && mv "$LIVE" "$PREV"
mv "$INCOMING" "$LIVE"

# ----- 6. reload the running app so it serves the new build ------------------
if [ -n "$PM2_APP" ]; then
  command -v pm2 >/dev/null 2>&1 || die "pm2 not found on PATH but PM2_APP=$PM2_APP was set"
  log "pm2 reload $PM2_APP"
  pm2 reload "$PM2_APP" 2>/dev/null || pm2 restart "$PM2_APP"
else
  warn "new build swapped in but NOT yet served — restart the app to pick it up:"
  warn "    pm2 restart <app-name>   (or set PM2_APP=<app-name> next time)"
fi

log "done. Rollback if needed:  rm -rf $LIVE && mv $PREV $LIVE && pm2 restart <app>"
