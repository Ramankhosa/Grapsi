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
#   2. Rewrites the build-time distDir back to `.next` (see note below), then
#      swaps the new build in with two quick renames, keeping the old build as
#      `.next.prev` for instant rollback.
#   3. Restarts the PM2 process so it actually serves the new build.
#
# If the build FAILS, the live `.next` is left exactly as it was — zero impact.
#
# Why the distDir rewrite (step 2) is required
# --------------------------------------------
# `next build` bakes the distDir it built with into
# `.next/required-server-files.json` (config.distDir). If we build as
# `.next.incoming` and then serve that as `.next`, the running server keeps
# looking for assets under `.next.incoming` and fails with
# "Unable to locate stylesheet" and "Invariant: expected pageData to be a
# string, got undefined". So we rewrite config.distDir to `.next` before serving.
#
# A build change also always requires a real process restart — `next start`
# caches the build manifest in memory, so swapping files under it without a
# restart produces the same errors. This script restarts PM2 for you.
#
# Usage:
#   PM2_APP=grapsi bash scripts/safe-build.sh   # build + swap + restart grapsi
#   bash scripts/safe-build.sh                   # auto-detects the pm2 app; else warns
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

# ----- 0. auto-detect the PM2 app serving this repo (if not given) -----------
if [ -z "$PM2_APP" ] && command -v pm2 >/dev/null 2>&1; then
  PM2_APP="$(pm2 jlist 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const list = JSON.parse(s);
        const repo = process.argv[1];
        const hit = list.find(
          (p) => p.pm2_env && String(p.pm2_env.pm_cwd || "").indexOf(repo) === 0
        );
        if (hit) process.stdout.write(hit.name || "");
      } catch (e) {}
    });
  ' "$REPO_DIR" 2>/dev/null || true)"
  [ -n "$PM2_APP" ] && log "auto-detected pm2 app serving this repo: $PM2_APP"
fi

# ----- 1. clean any leftover incoming dir from a previous aborted run --------
rm -rf "$INCOMING"

# ----- 2. hand the incremental build cache over to the incoming build --------
# The webpack cache is the difference between a ~2 minute rebuild and a ~10
# minute one, so the incoming build must inherit it. This used to `cp -a` the
# whole directory, which on this repo is well over a GB of byte copying at the
# lowest IO priority, all of it before webpack even starts. A rename is
# instantaneous because both paths are on the same filesystem.
#
# Nothing the live server needs at request time lives in `cache/`: it is the
# webpack cache plus the on-demand image and fetch caches, all of which Next
# rebuilds by itself. If the build fails we move it straight back, so the only
# way to lose it is a hard kill mid-build, which costs one cold rebuild.
#
# Next keys its webpack cache on the Next version and the config, not on
# distDir, so a cache built as `.next` is still valid as `.next.incoming`.
CACHE_MOVED=0
restore_cache() {
  if [ "$CACHE_MOVED" = "1" ] && [ -d "$INCOMING/cache" ] && [ ! -d "$LIVE/cache" ]; then
    mkdir -p "$LIVE"
    mv "$INCOMING/cache" "$LIVE/cache" 2>/dev/null || true
    log "build did not complete; build cache returned to $LIVE/cache"
  fi
}
trap restore_cache EXIT INT TERM

if [ -d "$LIVE/cache" ]; then
  mkdir -p "$INCOMING"
  if mv "$LIVE/cache" "$INCOMING/cache" 2>/dev/null; then
    CACHE_MOVED=1
    log "moved the build cache into $INCOMING (incremental build)"
  else
    warn "could not move $LIVE/cache; falling back to a copy"
    cp -a "$LIVE/cache" "$INCOMING/cache" 2>/dev/null || true
  fi
fi

# ----- 3. build into the incoming dir (live .next stays up the whole time) ---
# NEXT_SKIP_CHECKS drops the in-build ESLint and TypeScript passes. They re-check
# ~1,750 files on a box whose only job is to produce a bundle; run them where the
# code is written instead:  npm run lint  &&  npx tsc --noEmit
# Set NEXT_SKIP_CHECKS=0 before this script to keep them.
export NEXT_SKIP_CHECKS="${NEXT_SKIP_CHECKS:-1}"
if [ "$NEXT_SKIP_CHECKS" = "1" ]; then
  warn "skipping in-build lint + typecheck (NEXT_SKIP_CHECKS=1)."
  warn "run them where the code is written:  npm run lint  &&  npx tsc --noEmit"
fi

log "building into $INCOMING - the live $LIVE keeps serving..."
BUILD_STARTED_AT=$(date +%s)
NEXT_TELEMETRY_DISABLED=1 NEXT_DIST_DIR="$INCOMING" npm run build:cached
log "build finished in $(( $(date +%s) - BUILD_STARTED_AT ))s"

# ----- 4. validate before swapping ------------------------------------------
[ -f "$INCOMING/BUILD_ID" ] \
  || die "build produced no $INCOMING/BUILD_ID — aborting. Live $LIVE is untouched."

# ----- 5. rewrite the baked distDir so it matches the served path (.next) ----
RSF="$INCOMING/required-server-files.json"
if [ -f "$RSF" ]; then
  node -e '
    const fs = require("fs");
    const f = process.argv[1];
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    if (j && j.config) j.config.distDir = ".next";
    fs.writeFileSync(f, JSON.stringify(j));
  ' "$RSF" || die "failed to rewrite distDir in $RSF"
  log "rewrote required-server-files distDir -> .next"
fi

# ----- 6. near-atomic swap, keeping the previous build for rollback ----------
CACHE_MOVED=0  # the cache now belongs to $INCOMING, which becomes the live build
log "swapping in the new build (previous kept as $PREV)…"
rm -rf "$PREV"
[ -e "$LIVE" ] && mv "$LIVE" "$PREV"
mv "$INCOMING" "$LIVE"

# ----- 7. restart the running app so it serves the new build -----------------
# Make sure NEXT_DIST_DIR doesn't leak into the served process (serve must use
# the default `.next`).
unset NEXT_DIST_DIR
if [ -n "$PM2_APP" ]; then
  command -v pm2 >/dev/null 2>&1 || die "pm2 not found on PATH but PM2_APP=$PM2_APP was set"
  log "pm2 restart $PM2_APP"
  pm2 restart "$PM2_APP" --update-env
else
  warn "ACTION REQUIRED: the new build is swapped in but the running server is now stale."
  warn "Restart it NOW or the site will error (missing stylesheet / pageData) until you do:"
  warn "    pm2 restart <app-name>"
fi

log "done. Rollback if needed:  rm -rf $LIVE && mv $PREV $LIVE && pm2 restart <app>"
