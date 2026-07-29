#!/usr/bin/env bash
#
# Production deploy for the Grapsi Next.js app.
#
# Layout this targets
# -------------------
# The app is a plain checkout that PM2 serves in place:
#
#   /var/www/granter/Grapsi        the git checkout (built here, served from here)
#   pm2 app "grantmentor"          runs `npm start` -> `next start -p 3010`, fork mode
#
# There is no releases/ directory and no `current` symlink. `next start` serves
# `.next` out of the checkout, so "deploying" means: get a new `.next` in place
# without breaking the server that is currently reading from it, then restart.
#
# The hazard, and how this avoids it
# ----------------------------------
# `next build` overwrites `.next` in place. Because `next start` serves from that
# same directory, a naive rebuild pulls the live build out from under the running
# server and the site errors for the whole multi-minute build.
#
# So the actual build/swap is delegated to scripts/safe-build.sh, which:
#   1. builds into `.next.incoming` (live `.next` keeps serving throughout),
#   2. rewrites the distDir baked into required-server-files.json back to `.next`
#      (otherwise the served process hunts for assets under `.next.incoming`),
#   3. swaps with two renames, keeping the old build as `.next.prev`,
#   4. restarts PM2 (mandatory — `next start` caches the build manifest in memory).
#
# This script adds what safe-build.sh deliberately leaves out: optional git pull,
# dependency install, prisma generate, a health gate, and automatic rollback to
# `.next.prev` if the new build comes up unhealthy.
#
# Usage:
#   bash scripts/deploy.sh                    # build current checkout & deploy
#   GIT_PULL=1 bash scripts/deploy.sh         # git fetch+reset to $GIT_REF first
#   INSTALL=1 bash scripts/deploy.sh          # force npm ci (after a lockfile change)
#   SKIP_PRISMA=1 bash scripts/deploy.sh      # skip prisma generate (no schema change)
#   PM2_APP=other PORT=3011 bash scripts/deploy.sh    # different app on this box
#
# Rollback by hand (any time after a deploy):
#   cd /var/www/granter/Grapsi
#   rm -rf .next && mv .next.prev .next && pm2 restart grantmentor
#
set -euo pipefail

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[deploy] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ----- configuration -------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

PM2_APP="${PM2_APP:-grantmentor}"
PORT="${PORT:-3010}"
HEALTH_PATH="${HEALTH_PATH:-/api/health}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"     # seconds to wait for the app to answer

GIT_PULL="${GIT_PULL:-0}"
GIT_REF="${GIT_REF:-origin/main}"
INSTALL="${INSTALL:-auto}"                 # auto | 1 | 0
SKIP_PRISMA="${SKIP_PRISMA:-0}"

LIVE="$REPO_DIR/.next"
PREV="$REPO_DIR/.next.prev"

# Keep the build polite: on a shared box a full `next build` can otherwise
# starve the live server (and the sibling patentnest app) of CPU and disk I/O.
NICE=(); IONICE=()
command -v nice   >/dev/null 2>&1 && NICE=(nice -n 10)
command -v ionice >/dev/null 2>&1 && IONICE=(ionice -c2 -n7)

cd "$REPO_DIR"

log "repo:    $REPO_DIR"
log "pm2 app: $PM2_APP (port $PORT)"

command -v pm2 >/dev/null 2>&1 || die "pm2 not found on PATH"
pm2 describe "$PM2_APP" >/dev/null 2>&1 \
  || die "pm2 app '$PM2_APP' not found. Run 'pm2 list' and pass the right one: PM2_APP=<name> bash scripts/deploy.sh"

# ----- 1. optional source update -------------------------------------------
if [ "$GIT_PULL" = "1" ]; then
  log "git fetch + reset to $GIT_REF"
  git fetch --prune origin
  git reset --hard "$GIT_REF"
fi
log "deploying commit: $(git log -1 --format='%h %s' 2>/dev/null || echo 'unknown')"

# ----- 2. dependencies ------------------------------------------------------
if [ "$INSTALL" = "1" ] || { [ "$INSTALL" = "auto" ] && [ ! -d node_modules ]; }; then
  log "installing dependencies (npm ci)"
  "${IONICE[@]}" "${NICE[@]}" npm ci --no-audit --no-fund
else
  log "skipping npm ci (INSTALL=$INSTALL); using existing node_modules"
fi

# ----- 3. prisma client -----------------------------------------------------
# Note: this only regenerates the client. Schema changes still need an explicit
# `npx prisma migrate deploy` — deliberately not automated here, so a deploy can
# never silently alter the production database.
if [ "$SKIP_PRISMA" != "1" ]; then
  log "generating prisma client"
  "${IONICE[@]}" "${NICE[@]}" npx prisma generate
fi

# ----- 4. build + swap + restart (delegated to safe-build.sh) ---------------
# safe-build.sh keeps the live .next serving for the whole build, fixes the
# baked distDir, swaps atomically, saves the old build to .next.prev, and
# restarts PM2. If the build fails it exits non-zero with .next untouched.
[ -f "$SCRIPT_DIR/safe-build.sh" ] || die "missing $SCRIPT_DIR/safe-build.sh"

log "building (live site keeps serving the old build throughout)…"
PM2_APP="$PM2_APP" "${IONICE[@]}" "${NICE[@]}" bash "$SCRIPT_DIR/safe-build.sh"

[ -f "$LIVE/BUILD_ID" ] || die "no $LIVE/BUILD_ID after build — aborting"
log "now serving build: $(cat "$LIVE/BUILD_ID")"

# ----- 5. health gate (auto-rollback on failure) ----------------------------
health_ok() {
  local deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -fsS --max-time 5 "http://127.0.0.1:${PORT}${HEALTH_PATH}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

if health_ok; then
  log "health check passed on ${HEALTH_PATH}"
else
  warn "health check FAILED after ${HEALTH_TIMEOUT}s"
  if [ -d "$PREV" ]; then
    warn "rolling back to the previous build ($PREV)"
    rm -rf "$LIVE"
    mv "$PREV" "$LIVE"
    pm2 restart "$PM2_APP" --update-env
    if health_ok; then
      die "deploy failed; rolled back and the site is healthy again. Investigate the new build before retrying."
    fi
    die "rollback is ALSO unhealthy — investigate immediately (pm2 logs $PM2_APP)."
  fi
  die "deploy failed and there is no $PREV to roll back to. Check: pm2 logs $PM2_APP"
fi

pm2 save >/dev/null 2>&1 || true

cat <<EOF

$(printf '\033[1;32m[deploy] done.\033[0m')

  commit    $(git log -1 --format='%h %s' 2>/dev/null || echo unknown)
  build id  $(cat "$LIVE/BUILD_ID" 2>/dev/null || echo unknown)
  previous  $PREV  (kept for rollback)

  Verify:   pm2 logs $PM2_APP --lines 50
  Rollback: rm -rf $LIVE && mv $PREV $LIVE && pm2 restart $PM2_APP

  Hard-refresh the browser (Ctrl+Shift+R) — the old JS bundle is cached client-side.
EOF
