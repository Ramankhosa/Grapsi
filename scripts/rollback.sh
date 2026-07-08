#!/usr/bin/env bash
#
# Instant rollback to a previous release (no rebuild).
#
# Because every deploy keeps the old build directories, rolling back is just
# repointing the `current` symlink at an earlier release and reloading PM2.
#
# Usage:
#   bash scripts/rollback.sh              # roll back to the previous release
#   bash scripts/rollback.sh 20260708_1200xx   # roll back to a specific release
#   bash scripts/rollback.sh --list      # list available releases
#
set -euo pipefail

log()  { printf '\033[1;34m[rollback]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[rollback]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[rollback] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
APP_ROOT="${APP_ROOT:-/srv/grapsi}"
RELEASES_DIR="${RELEASES_DIR:-$APP_ROOT/releases}"
CURRENT_LINK="${CURRENT_LINK:-$APP_ROOT/current}"
PORT="${PORT:-3010}"
HEALTH_PATH="${HEALTH_PATH:-/api/health}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
PM2_APP="${PM2_APP:-grapsi}"
ECOSYSTEM="${ECOSYSTEM:-$REPO_DIR/ecosystem.config.js}"

command -v pm2 >/dev/null 2>&1 || die "pm2 not found"

# newest first
mapfile -t RELEASES < <(ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null | sed 's:/*$::')
[ "${#RELEASES[@]}" -gt 0 ] || die "no releases found in $RELEASES_DIR"

if [ "${1:-}" = "--list" ]; then
  CURRENT_RESOLVED="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  for r in "${RELEASES[@]}"; do
    marker=""; [ "$(readlink -f "$r")" = "$CURRENT_RESOLVED" ] && marker="  <- current"
    echo "$(basename "$r")$marker"
  done
  exit 0
fi

CURRENT_RESOLVED="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"

if [ -n "${1:-}" ]; then
  TARGET="$RELEASES_DIR/$1"
else
  # first release that is not the current one
  TARGET=""
  for r in "${RELEASES[@]}"; do
    if [ "$(readlink -f "$r")" != "$CURRENT_RESOLVED" ]; then TARGET="$r"; break; fi
  done
fi

[ -n "$TARGET" ] && [ -d "$TARGET" ] || die "target release not found (use --list to see options)"
[ -f "$TARGET/server.js" ] || die "target $TARGET has no server.js — not a valid release"

log "rolling back current -> $(basename "$TARGET")"
ln -sfn "$TARGET" "$CURRENT_LINK"
pm2 reload "$ECOSYSTEM" --update-env

deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if curl -fsS --max-time 5 "http://127.0.0.1:${PORT}${HEALTH_PATH}" >/dev/null 2>&1; then
    log "healthy on $(basename "$TARGET")"
    pm2 save >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 2
done
die "rolled back but health check failed — investigate immediately"
