#!/usr/bin/env bash
#
# Zero-downtime production deploy for the Grapsi Next.js app.
#
# Why this exists
# ---------------
# The old flow (`npm run build`) ran `clean-next.js`, which DELETES the live
# ~1.2 GB `.next` directory the running server is serving from, then rebuilds it
# in place. On a GCP persistent disk that burst of I/O saturated the disk and the
# running app stopped responding. This script never touches the live build:
#
#   1. Build a fresh standalone artifact in the repo checkout (the running app is
#      served from a SEPARATE `current/` directory, so its files are untouched).
#      The build runs under `nice`/`ionice` so it can't starve the live server of
#      CPU or disk I/O.
#   2. Assemble a small, self-contained release directory under `releases/<ts>/`.
#   3. Atomically repoint the `current` symlink at the new release and
#      `pm2 reload` (cluster mode → workers restart one at a time, zero downtime).
#   4. Health-check the new release. If it is unhealthy, automatically roll the
#      symlink back to the previous release and reload — the site never stays down.
#
# Old releases are KEPT (for instant rollback) unless you opt into pruning with
# RELEASES_TO_KEEP.
#
# Layout (all configurable via env):
#   /srv/grapsi/
#     releases/<timestamp>/   assembled standalone runtimes  (served)
#     current -> releases/<timestamp>   symlink PM2 runs from
#     shared/.env.production   secrets, symlinked into each release
#     shared/uploads/          persistent user uploads, symlinked into each release
#     logs/                    pm2 logs (outside releases, never pruned)
#
# Usage:
#   bash scripts/deploy.sh                 # build current checkout & deploy
#   GIT_PULL=1 bash scripts/deploy.sh      # git fetch+reset to $GIT_REF first
#   RELEASES_TO_KEEP=5 bash scripts/deploy.sh   # keep only the 5 newest releases
#
set -euo pipefail

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[deploy] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ----- configuration -------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"   # where the build runs

APP_ROOT="${APP_ROOT:-/srv/grapsi}"
RELEASES_DIR="${RELEASES_DIR:-$APP_ROOT/releases}"
CURRENT_LINK="${CURRENT_LINK:-$APP_ROOT/current}"
SHARED_DIR="${SHARED_DIR:-$APP_ROOT/shared}"

PORT="${PORT:-3010}"
HEALTH_PATH="${HEALTH_PATH:-/api/health}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"          # seconds to wait for healthy
RELEASES_TO_KEEP="${RELEASES_TO_KEEP:-0}"       # 0 = keep ALL old builds
PM2_APP="${PM2_APP:-grapsi}"
ECOSYSTEM="${ECOSYSTEM:-$REPO_DIR/ecosystem.config.js}"

# node_modules that are externalized from the bundle (webpack externals /
# serverComponentsExternalPackages) and must be copied into the standalone
# runtime because dependency tracing may not include them.
EXTRA_MODULES="${EXTRA_MODULES:-canvas pdf2text pdfjs-dist sharp}"

GIT_PULL="${GIT_PULL:-0}"
GIT_REF="${GIT_REF:-origin/main}"
INSTALL="${INSTALL:-auto}"                      # auto | 1 | 0
SKIP_PRISMA="${SKIP_PRISMA:-0}"

TS="$(date +%Y%m%d%H%M%S)"
RELEASE_DIR="$RELEASES_DIR/$TS"

# low-priority wrappers so the build never starves the live server
NICE=(nice -n 10)
IONICE=()
if command -v ionice >/dev/null 2>&1; then IONICE=(ionice -c2 -n7); fi

# ----- preflight -----------------------------------------------------------
command -v node >/dev/null 2>&1 || die "node not found on PATH"
command -v pm2  >/dev/null 2>&1 || die "pm2 not found. Install it: npm i -g pm2"
[ -f "$REPO_DIR/package.json" ] || die "no package.json in REPO_DIR=$REPO_DIR"
[ -f "$ECOSYSTEM" ] || die "ecosystem file not found: $ECOSYSTEM"
mkdir -p "$RELEASES_DIR" "$SHARED_DIR" "$APP_ROOT/logs"

log "repo:      $REPO_DIR"
log "release:   $RELEASE_DIR"
log "app root:  $APP_ROOT (port $PORT)"

cd "$REPO_DIR"

# ----- 1. optional source update ------------------------------------------
if [ "$GIT_PULL" = "1" ]; then
  log "git fetch + reset to $GIT_REF"
  git fetch --prune origin
  git reset --hard "$GIT_REF"
fi

# ----- 2. dependencies -----------------------------------------------------
if [ "$INSTALL" = "1" ] || { [ "$INSTALL" = "auto" ] && [ ! -d node_modules ]; }; then
  log "installing dependencies (npm ci)"
  "${IONICE[@]}" "${NICE[@]}" npm ci --no-audit --no-fund
else
  log "skipping npm ci (INSTALL=$INSTALL); using existing node_modules"
fi

# ----- 3. prisma client ----------------------------------------------------
if [ "$SKIP_PRISMA" != "1" ]; then
  log "generating prisma client"
  "${IONICE[@]}" "${NICE[@]}" npx prisma generate
fi

# ----- 4. build (incremental, low I/O priority, DOES NOT delete live build) -
log "building (next build, incremental) — this does not touch $CURRENT_LINK"
NEXT_TELEMETRY_DISABLED=1 "${IONICE[@]}" "${NICE[@]}" npm run build:cached

[ -f "$REPO_DIR/.next/standalone/server.js" ] \
  || die "standalone build missing (.next/standalone/server.js). Is output:'standalone' set in next.config.js?"

# ----- 5. assemble the release directory -----------------------------------
log "assembling release $TS"
mkdir -p "$RELEASE_DIR"
# standalone bundle (server.js + traced node_modules + server .next)
cp -a "$REPO_DIR/.next/standalone/." "$RELEASE_DIR/"
# static assets + public are NOT part of standalone; copy them in
mkdir -p "$RELEASE_DIR/.next"
cp -a "$REPO_DIR/.next/static" "$RELEASE_DIR/.next/static"
[ -d "$REPO_DIR/public" ] && cp -a "$REPO_DIR/public" "$RELEASE_DIR/public"

# Prisma generated client + query-engine binary (tracing often misses the .node)
if [ -d "$REPO_DIR/node_modules/.prisma" ]; then
  mkdir -p "$RELEASE_DIR/node_modules"
  cp -a "$REPO_DIR/node_modules/.prisma" "$RELEASE_DIR/node_modules/.prisma"
fi
[ -d "$REPO_DIR/node_modules/@prisma/client" ] && {
  mkdir -p "$RELEASE_DIR/node_modules/@prisma"
  cp -a "$REPO_DIR/node_modules/@prisma/client" "$RELEASE_DIR/node_modules/@prisma/client"
}

# Externalized / native modules that may not be traced into standalone.
for mod in $EXTRA_MODULES; do
  if [ -d "$REPO_DIR/node_modules/$mod" ] && [ ! -d "$RELEASE_DIR/node_modules/$mod" ]; then
    log "  + copying external module: $mod"
    mkdir -p "$RELEASE_DIR/node_modules/$(dirname "$mod")"
    cp -a "$REPO_DIR/node_modules/$mod" "$RELEASE_DIR/node_modules/$mod"
  fi
done

# ----- 6. link shared, persistent state ------------------------------------
[ -f "$SHARED_DIR/.env.production" ] \
  && ln -sfn "$SHARED_DIR/.env.production" "$RELEASE_DIR/.env.production" \
  || warn "no $SHARED_DIR/.env.production — the app must get its env from PM2/ecosystem"
[ -d "$SHARED_DIR/uploads" ] && ln -sfn "$SHARED_DIR/uploads" "$RELEASE_DIR/uploads"

# ----- 7. record the currently-live release for rollback -------------------
PREVIOUS_TARGET=""
if [ -L "$CURRENT_LINK" ]; then
  PREVIOUS_TARGET="$(readlink -f "$CURRENT_LINK" || true)"
fi

# ----- 8. atomic switch + graceful reload ----------------------------------
log "switching current -> releases/$TS"
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  log "pm2 reload $PM2_APP (zero-downtime)"
  # cluster reload: if the new workers fail to bind, pm2 keeps the old workers up
  pm2 reload "$ECOSYSTEM" --update-env
else
  log "first deploy — pm2 start"
  pm2 start "$ECOSYSTEM"
  pm2 save
fi

# ----- 9. health check (auto-rollback on failure) --------------------------
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
  if [ -n "$PREVIOUS_TARGET" ] && [ -d "$PREVIOUS_TARGET" ]; then
    warn "rolling back to $PREVIOUS_TARGET"
    ln -sfn "$PREVIOUS_TARGET" "$CURRENT_LINK"
    pm2 reload "$ECOSYSTEM" --update-env
    health_ok && warn "rolled back and healthy" || die "rollback still unhealthy — investigate immediately"
    die "deploy failed; rolled back to previous release. New (bad) build left at $RELEASE_DIR"
  fi
  die "deploy failed and no previous release to roll back to. Bad build at $RELEASE_DIR"
fi

pm2 save >/dev/null 2>&1 || true

# ----- 10. retention (default: keep everything) ----------------------------
if [ "$RELEASES_TO_KEEP" -gt 0 ] 2>/dev/null; then
  CURRENT_RESOLVED="$(readlink -f "$CURRENT_LINK" || true)"
  # newest first; skip the ones we keep; never delete the live one
  mapfile -t OLD < <(ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null | tail -n +$((RELEASES_TO_KEEP + 1)))
  for dir in "${OLD[@]:-}"; do
    [ -z "$dir" ] && continue
    if [ "$(readlink -f "$dir")" = "$CURRENT_RESOLVED" ]; then continue; fi
    log "pruning old release: $dir"
    rm -rf "$dir"
  done
else
  log "keeping all old releases (RELEASES_TO_KEEP=0). Set RELEASES_TO_KEEP=N to bound disk use."
fi

log "done. Live release: $(readlink -f "$CURRENT_LINK")"
