#!/usr/bin/env bash
#
# Grapsi external-catalogue release: schema, code, seed data and the
# ScientifyResearch catalogue, onto the production VM, in one supervised run.
#
# Run it from the unpacked release bundle on the VM:
#
#   bash release.sh --app-dir /var/www/granter/Grapsi --operator-email you@inst.edu
#
# What it does, in order (each phase stops the run on any failed check):
#
#   preflight  bundle checksums, app checkout matches the bundle, one database
#              for app and scripts, pgvector version, operator account exists
#   backup     pg_dump -Fc of the whole database (backup #1)
#   migrate    additive check, safety capture, prisma migrate deploy, safety
#              compare (no pre-existing call may change)
#   deploy     scripts/deploy.sh: build, swap, pm2 restart, health gate,
#              automatic rollback (skip with --skip-deploy)
#   seed       currency rates (Seed/currency-rates.csv)
#   dryrun     importer dry run on the frozen snapshot; you read the counts
#   import     backup #2, safety capture, apply (STAGED, inactive, suppressed),
#              safety compare
#   release    publish every CLEAR imported call to researcher discovery,
#              silently (no alerts, no notices, never GLOBAL_PUBLISHED)
#   embed      vectors for the released calls with the app's own provider
#   verify     text-search parity, isolation and notification invariants
#   backfill   OPT-IN (--with-backfill): facts for curated calls + profile
#              country codes, inside a safety + finder-parity window
#
# Every phase is safe to re-run. After a failure, fix the cause and resume
# with --from <phase>. Nothing here deletes data; the way back is
#   node node_modules/tsx/dist/cli.cjs scripts/import-funding-catalog.ts rollback --run <runId> --confirm-target <db>
# (or pg_restore of the backup, for anything the import did not do).
#
# Options
#   --app-dir DIR          the deployed checkout (default /var/www/granter/Grapsi)
#   --operator-email EMAIL an existing super-admin account; recorded on every row
#   --env-file FILE        extra env file layered after the app's .env files
#                          (repeatable; e.g. /srv/grapsi/shared/.env.production)
#   --git-ref REF          fetch and reset the app checkout to REF first
#                          (refuses a checkout with local changes)
#   --from PHASE           start at PHASE (preflight always runs)
#   --only PHASE           run just PHASE (after preflight)
#   --yes                  no prompts; requires --confirm-db
#   --confirm-db NAME      the database name, for --yes
#   --skip-deploy          do not build or restart; the live build is checked
#                          for being newer than the checkout instead
#   --no-build-check       with --skip-deploy: trust that the live app is current
#   --skip-embed           leave embedding for later (calls are text-searchable)
#   --with-backfill        run the backfill phase at the end of `all`
#   --backup-dir DIR       where dumps, reports and the log go
#                          (default <bundle>/run/<timestamp>)
#
set -Eeuo pipefail

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PHASES=(preflight backup migrate deploy seed dryrun import release embed verify backfill)

APP_DIR="/var/www/granter/Grapsi"
OPERATOR_EMAIL=""
ENV_FILES=()
GIT_REF=""
FROM=""
ONLY=""
ASSUME_YES=0
CONFIRM_DB=""
SKIP_DEPLOY=0
BUILD_CHECK=1
SKIP_EMBED=0
WITH_BACKFILL=0
RUN_DIR=""

c_blue=$'\033[1;34m'; c_yel=$'\033[1;33m'; c_red=$'\033[1;31m'; c_grn=$'\033[1;32m'; c_off=$'\033[0m'
log()  { printf '%s[release]%s %s\n' "$c_blue" "$c_off" "$*"; }
ok()   { printf '%s[release]%s %s\n' "$c_grn" "$c_off" "$*"; }
warn() { printf '%s[release]%s %s\n' "$c_yel" "$c_off" "$*" >&2; }
die()  {
  printf '%s[release] STOPPED:%s %s\n' "$c_red" "$c_off" "$*" >&2
  printf 'After investigating, resume with the same options and --from %s\n' "${CURRENT_PHASE:-preflight}" >&2
  exit 1
}
trap 'die "a command failed at line $LINENO (see the log). Fix the cause and resume with --from ${CURRENT_PHASE:-preflight}."' ERR

while [ $# -gt 0 ]; do
  case "$1" in
    --app-dir|--operator-email|--env-file|--git-ref|--from|--only|--confirm-db|--backup-dir)
      if [ $# -lt 2 ] || [ -z "$2" ]; then die "$1 needs a value"; fi ;;
  esac
  case "$1" in
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --operator-email) OPERATOR_EMAIL="$2"; shift 2 ;;
    --env-file) ENV_FILES+=("$2"); shift 2 ;;
    --git-ref) GIT_REF="$2"; shift 2 ;;
    --from) FROM="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --yes) ASSUME_YES=1; shift ;;
    --confirm-db) CONFIRM_DB="$2"; shift 2 ;;
    --skip-deploy) SKIP_DEPLOY=1; shift ;;
    --no-build-check) BUILD_CHECK=0; shift ;;
    --skip-embed) SKIP_EMBED=1; shift ;;
    --with-backfill) WITH_BACKFILL=1; shift ;;
    --backup-dir) RUN_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,62p' "$0"; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done

valid_phase() { local p; for p in "${PHASES[@]}"; do [ "$p" = "$1" ] && return 0; done; return 1; }
[ -z "$FROM" ] || valid_phase "$FROM" || die "unknown phase for --from: $FROM"
[ -z "$ONLY" ] || valid_phase "$ONLY" || die "unknown phase for --only: $ONLY"
[ "$ASSUME_YES" = 0 ] || [ -n "$CONFIRM_DB" ] || die "--yes needs --confirm-db <database name>"

APP_DIR="$(cd "$APP_DIR" 2>/dev/null && pwd)" || die "app dir not found"
RUN_DIR="${RUN_DIR:-$BUNDLE_DIR/run/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$RUN_DIR"
LOG="$RUN_DIR/release.log"
exec > >(tee -a "$LOG") 2>&1

LOCK="$BUNDLE_DIR/.release.lock"
mkdir "$LOCK" 2>/dev/null || die "another release run holds $LOCK (remove it if that run is dead)"
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

MANIFEST="$BUNDLE_DIR/bundle-manifest.json"
SNAPSHOT_NAME="$(node -e "console.log(require(process.argv[1]).snapshot)" "$MANIFEST")"
SNAPSHOT_DIR="$BUNDLE_DIR/snapshot/$SNAPSHOT_NAME"
TSX=(node "$APP_DIR/node_modules/tsx/dist/cli.cjs")
PRISMA=(node "$APP_DIR/node_modules/prisma/build/index.js")

# Runs a repo script from the app checkout, so its .env and tsconfig apply.
app() { (cd "$APP_DIR" && "$@"); }
q() { psql "$PGURL" -v ON_ERROR_STOP=1 -AtXq -c "$1"; }

confirm() {
  # $1 = what is about to happen. Typing the database name is the go-ahead.
  if [ "$ASSUME_YES" = 1 ]; then log "--yes: $1"; return 0; fi
  local answer
  printf '\n%s\n  Type the database name (%s) to continue, anything else stops: ' "$1" "$DB_NAME" > /dev/tty
  read -r answer < /dev/tty
  [ "$answer" = "$DB_NAME" ] || die "not confirmed; nothing further was done. Resume with --from ${CURRENT_PHASE}."
}

# A bulk load leaves the planner's statistics describing the table as it was
# before: on the rehearsal database the finder's text search ran at p95 ~2,000 ms
# straight after the release and 25 ms after this. Autovacuum gets there
# eventually; people use the finder in the meantime. Plain ANALYZE: no lock
# that blocks reads or writes, seconds at this size.
refresh_stats() {
  log "refreshing planner statistics"
  psql "$PGURL" -v ON_ERROR_STOP=1 -q \
    -c 'ANALYZE funding_calls' \
    -c 'ANALYZE funding_call_research_area_taxonomies' \
    -c 'ANALYZE funding_call_deadlines' \
    -c 'ANALYZE external_source_records' \
    -c 'ANALYZE funders' \
    -c 'ANALYZE funding_import_candidates'
}

safety_capture() { app "${TSX[@]}" scripts/catalog-safety-check.ts capture --out "$RUN_DIR/safety-$1.json"; }
safety_compare() {
  app "${TSX[@]}" scripts/catalog-safety-check.ts compare --before "$RUN_DIR/safety-$1.json" \
    || die "safety compare '$1' failed: a pre-existing call changed or an invariant broke. Read the output above before going on."
}

dump() {
  local file="$RUN_DIR/$1.dump"
  log "pg_dump → $file"
  pg_dump --format=custom --no-owner --file="$file" "$PGURL"
  ok "backup written ($(du -h "$file" | cut -f1))"
}

latest_report() {
  node -e '
    const fs = require("fs"), path = require("path");
    const [dir, kind] = process.argv.slice(1);
    const files = fs.readdirSync(dir).filter(f => f.startsWith("report-" + kind + "-") && f.endsWith(".md"));
    files.sort((a,b) => fs.statSync(path.join(dir,b)).mtimeMs - fs.statSync(path.join(dir,a)).mtimeMs || a.localeCompare(b));
    if (!files.length) throw new Error("No " + kind + " report found");
    process.stdout.write(path.join(dir, files[0]));
  ' "$SNAPSHOT_DIR" "$1"
}

# ------------------------------------------------------------------ phases

phase_preflight() {
  log "bundle: $BUNDLE_DIR"
  log "app:    $APP_DIR"
  for tool in node psql pg_dump git; do command -v "$tool" >/dev/null || die "$tool is not installed or not on PATH"; done
  node "$BUNDLE_DIR/lib/check.mjs" bundle "$BUNDLE_DIR" || die "the bundle is damaged or incomplete; copy it again"

  if [ -n "$GIT_REF" ]; then
    [ -z "$(git -C "$APP_DIR" status --porcelain --untracked-files=no)" ] \
      || die "the app checkout has local changes; commit or stash them before --git-ref"
    log "checkout: fetch + reset to $GIT_REF"
    git -C "$APP_DIR" fetch --prune origin
    git -C "$APP_DIR" reset --hard "$GIT_REF"
  fi
  log "checkout at $(git -C "$APP_DIR" log -1 --format='%h %s')"
  [ -f "$APP_DIR/node_modules/tsx/dist/cli.cjs" ] || die "tsx is missing in $APP_DIR/node_modules (install dev dependencies: npm ci)"
  [ -f "$APP_DIR/node_modules/prisma/build/index.js" ] || die "prisma CLI is missing in $APP_DIR/node_modules (npm ci)"
  node "$BUNDLE_DIR/lib/check.mjs" code "$BUNDLE_DIR" "$APP_DIR" \
    || die "the app checkout is not the code this bundle was built for: deploy that commit first (or pass --git-ref)"

  local envfile="$RUN_DIR/.env.release"
  node "$BUNDLE_DIR/lib/env.mjs" "$APP_DIR" "$envfile" "${ENV_FILES[@]}" || die "could not settle on one database (see above)"
  # Generated shell-quoted assignments, checked by env.mjs.
  set -a
  # shellcheck disable=SC1090
  . "$envfile"
  set +a
  PGURL="$(node "$BUNDLE_DIR/lib/check.mjs" pgurl "$DATABASE_URL")"
  DB_NAME="$(q 'select current_database()')"
  log "database: $DB_NAME on $(q "select coalesce(host(inet_server_addr()),'local socket')||':'||current_setting('port')") · $(q 'show server_version')"
  [ -z "$CONFIRM_DB" ] || [ "$CONFIRM_DB" = "$DB_NAME" ] || die "--confirm-db $CONFIRM_DB but the app's database is $DB_NAME"

  local vec; vec="$(q "select coalesce((select extversion from pg_extension where extname='vector'),'none')")"
  case "$vec" in
    none) die "pgvector is not installed in $DB_NAME" ;;
    0.[0-4].*) die "pgvector $vec has no HNSW; the release needs >= 0.5 (0.8+ recommended)" ;;
    0.[5-7].*) warn "pgvector $vec: HNSW works, but filtered vector search is fuller on >= 0.8 (iterative scan)" ;;
    *) log "pgvector $vec" ;;
  esac
  local pgd; pgd="$(pg_dump --version | sed -nE 's/^[^0-9]*([0-9]+).*/\1/p')"
  local srv; srv="$(q "select current_setting('server_version_num')::int / 10000")"
  [ "$pgd" -ge "$srv" ] || die "pg_dump $pgd is older than the server ($srv); install a matching postgresql-client"

  if [ -n "$OPERATOR_EMAIL" ]; then
    local found; found="$(q "select count(*) from users where lower(email) = lower('${OPERATOR_EMAIL//\'/\'\'}')")"
    [ "$found" = "1" ] || die "no user with email $OPERATOR_EMAIL in $DB_NAME"
  fi
  local migrated; migrated="$(q "select count(*) from information_schema.tables where table_name = 'funding_import_runs'")"
  if [ "$migrated" = "1" ]; then
    log "catalogue tables exist; imported calls now: $(q "select count(*) from funding_calls where import_run_id is not null")"
  else
    log "catalogue tables not created yet (the migrate phase does it)"
  fi
  ok "preflight passed"
}

phase_backup() { dump "backup-1-before-release"; }

phase_migrate() {
  app "${TSX[@]}" scripts/check-additive-migration.ts || die "a catalogue migration is not additive; do not deploy this checkout"
  safety_capture migrate
  log "migrate status:"
  app "${PRISMA[@]}" migrate status || true
  confirm "About to apply pending migrations to $DB_NAME (additive; HNSW index builds lock writes to funding_calls for seconds)."
  app "${PRISMA[@]}" migrate deploy
  safety_compare migrate
  ok "schema is current"
}

phase_deploy() {
  if [ "$SKIP_DEPLOY" = 1 ]; then
    if [ "$BUILD_CHECK" = 1 ]; then
      local built="$APP_DIR/.next/BUILD_ID"
      [ -f "$built" ] || die "no $built: build and restart the app (scripts/deploy.sh), or pass --no-build-check if it is served from elsewhere"
      local head_time; head_time="$(git -C "$APP_DIR" log -1 --format=%ct)"
      [ "$(stat -c %Y "$built")" -ge "$head_time" ] \
        || die "the live build is older than the checkout. Old builds cannot read STAGED/GLOBAL_CATALOG rows: deploy first (drop --skip-deploy)"
    fi
    log "deploy skipped; live build accepted"
    return 0
  fi
  confirm "About to build and restart the app with scripts/deploy.sh (auto-rollback if unhealthy)."
  # A clean environment, as when deploy.sh is run by hand: the app reads its
  # own env files at start, and none of this run's exports leak into the build.
  local -a deploy_env=(HOME="$HOME" PATH="$PATH" USER="${USER:-}" LOGNAME="${LOGNAME:-}" LANG="${LANG:-C.UTF-8}" SKIP_PRISMA=0)
  local key
  for key in PM2_HOME NVM_DIR PM2_APP PORT NODE_OPTIONS HEALTH_PATH HEALTH_TIMEOUT INSTALL BUILD_NICE BUILD_IONICE XDG_CONFIG_HOME XDG_DATA_HOME; do
    [ -z "${!key:-}" ] || deploy_env+=("$key=${!key}")
  done
  ( cd "$APP_DIR" && env -i "${deploy_env[@]}" bash scripts/deploy.sh )
  ok "app rebuilt and healthy"
}

phase_seed() {
  confirm "About to update currency rates in $DB_NAME."
  app "${TSX[@]}" scripts/seed-currency-rates.ts
  ok "currency rates: $(q "select count(*)||' rows, latest '||max(as_of) from currency_rates")"
}

phase_dryrun() {
  app "${TSX[@]}" scripts/import-funding-catalog.ts dry-run --snapshot "$SNAPSHOT_DIR" | tee "$RUN_DIR/dry-run.txt"
  local report; report="$(latest_report dry-run)"
  cp "$report" "$RUN_DIR/"
  log "full report: $RUN_DIR/$(basename "$report")"
  # This is JavaScript, not a shell expression.
  # shellcheck disable=SC2016
  node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const un = (r.unmappedLabels || []).length;
    console.log(`  records ${r.counts.records} · releasable ${r.reviewQueue.releasableCalls} · held ${r.counts.heldForReview} · unmapped labels ${un}`);
    console.log(`  duplicates of existing calls: ${JSON.stringify(r.duplicates.importedVsExisting)}`);
    if (un > 0) { console.error(`  ${un} source labels have no crosswalk row; the bundle was built with none`); process.exit(5) }
  ' "${report%.md}.json" || die "the dry run found unmapped labels: this checkout's Seed/crosswalks do not match the bundle"
}

phase_import() {
  [ -n "$OPERATOR_EMAIL" ] || die "--operator-email is required to import"
  confirm "About to import the catalogue into $DB_NAME (calls arrive STAGED, invisible, notifications suppressed)."
  dump "backup-2-before-import"
  safety_capture import
  app "${TSX[@]}" scripts/import-funding-catalog.ts apply --snapshot "$SNAPSHOT_DIR" \
    --confirm-target "$DB_NAME" --operator-email "$OPERATOR_EMAIL" --full-snapshot | tee "$RUN_DIR/apply.txt"
  cp "$(latest_report apply)" "$RUN_DIR/"
  safety_compare import
  refresh_stats
  ok "imported: $(q "select count(*) from funding_calls where import_run_id is not null") catalogue calls ($(q "select count(*) from funding_calls where catalog_status::text='STAGED'") staged)"
}

phase_release() {
  confirm "About to refresh catalogue review status and prepare the release in $DB_NAME."
  app "${TSX[@]}" scripts/import-funding-catalog.ts release --source scientify | tee "$RUN_DIR/release-plan.txt"
  confirm "About to publish every CLEAR imported call to researcher discovery (silently; held calls stay staged)."
  safety_capture release
  app "${TSX[@]}" scripts/import-funding-catalog.ts release --source scientify --apply | tee "$RUN_DIR/release.txt"
  safety_compare release
  refresh_stats
  ok "released: $(q "select count(*) from funding_calls where import_run_id is not null and catalog_status::text='PUBLISHED'") · held for review: $(q "select count(*) from funding_calls where catalog_status::text='STAGED'") (work them at /admin/funding/import-review)"
}

phase_embed() {
  if [ "$SKIP_EMBED" = 1 ]; then warn "embedding skipped (--skip-embed); released calls are text-searchable but not semantic until it runs"; return 0; fi
  app "${TSX[@]}" scripts/embed-catalog-calls.ts --dry-run | tee "$RUN_DIR/embed-plan.txt"
  grep -q '^Provider ' "$RUN_DIR/embed-plan.txt" || die "the embed dry run did not report a provider"
  confirm "About to embed with the provider above (the same one the app's finder searches with; paid API calls)."
  app "${TSX[@]}" scripts/embed-catalog-calls.ts | tee "$RUN_DIR/embed.txt"
  ok "embedding done"
}

phase_verify() {
  local bad=0 n
  check() {  # $1 label, $2 SQL that must return 0
    n="$(q "$2")"
    if [ "$n" = "0" ]; then ok "  ✓ $1"; else warn "  ✗ $1 ($n rows)"; bad=1; fi
  }
  log "invariants:"
  check "every imported call has notifications suppressed" \
    "select count(*) from funding_calls where import_run_id is not null and coalesce(notification_policy,'') <> 'SUPPRESSED'"
  check "no imported call is in funding-department scope" \
    "select count(*) from funding_calls where import_run_id is not null and visibility::text <> 'GLOBAL_CATALOG'"
  check "no pre-existing call carries a catalogue marker" \
    "select count(*) from funding_calls where import_run_id is null and (visibility::text = 'GLOBAL_CATALOG' or catalog_status::text = 'STAGED' or notification_policy is not null)"
  check "no researcher alert was raised for an imported call" \
    "select count(*) from funding_call_alerts a join funding_calls c on c.id = a.funding_call_id where c.import_run_id is not null"
  check "no held call was published" \
    "select count(*) from funding_calls where import_run_id is not null and catalog_status::text = 'PUBLISHED' and review_status IS DISTINCT FROM 'CLEAR'"
  log "text search (finder UNION form against the old OR-EXISTS form):"
  app "${TSX[@]}" scripts/benchmark-call-text-search.ts | tail -3 || bad=1
  log "catalogue now:"
  q "select '  '||visibility::text||' / '||catalog_status::text||': '||count(*) from funding_calls group by visibility, catalog_status order by count(*) desc"
  log "released calls with a vector: $(q "select count(*) filter (where embedding_voyage_1024 is not null or embedding is not null)||' of '||count(*) from funding_calls where import_run_id is not null and catalog_status::text='PUBLISHED'")"
  [ "$bad" = 0 ] || die "a verification failed (✗ above)"
  ok "verified"
}

phase_backfill() {
  [ -n "$OPERATOR_EMAIL" ] || die "--operator-email is required for the backfill"
  app "${TSX[@]}" scripts/backfill-existing-calls.ts --out "$RUN_DIR/backfill-plan.json" | tail -15
  app "${TSX[@]}" scripts/backfill-profile-country-codes.ts | tail -10
  confirm "About to backfill facts onto curated calls and country codes onto profiles (new columns only, reversible; the match census re-scores touched rows)."
  dump "backup-3-before-backfill"
  safety_capture backfill
  app "${TSX[@]}" scripts/finder-parity.ts capture --out "$RUN_DIR/parity-backfill.json"
  app "${TSX[@]}" scripts/backfill-existing-calls.ts --apply --confirm-target "$DB_NAME" --operator-email "$OPERATOR_EMAIL" | tee "$RUN_DIR/backfill.txt"
  safety_compare backfill
  app "${TSX[@]}" scripts/finder-parity.ts compare --before "$RUN_DIR/parity-backfill.json" \
    || die "finder parity failed after the backfill: undo it with scripts/backfill-existing-calls.ts --undo <runId> --confirm-target $DB_NAME"
  app "${TSX[@]}" scripts/backfill-profile-country-codes.ts --apply | tail -5
  ok "backfill done"
}

# ------------------------------------------------------------------ driver

log "release run $(basename "$RUN_DIR") · log $LOG"
CURRENT_PHASE=preflight
phase_preflight

selected=()
if [ -n "$ONLY" ]; then
  selected=("$ONLY")
else
  started=0
  { [ -z "$FROM" ] || [ "$FROM" = preflight ]; } && started=1
  for p in "${PHASES[@]:1}"; do
    [ "$p" = "$FROM" ] && started=1
    [ "$started" = 1 ] || continue
    [ "$p" = backfill ] && [ "$WITH_BACKFILL" = 0 ] && continue
    selected+=("$p")
  done
fi
[ "${#selected[@]}" -gt 0 ] || [ "$ONLY" = preflight ] || die "nothing to run"
[ "$ONLY" = preflight ] && { ok "preflight only: done"; exit 0; }

for p in "${selected[@]}"; do
  CURRENT_PHASE="$p"
  printf '\n%s== %s ==%s\n' "$c_blue" "$p" "$c_off"
  "phase_$p"
done

printf '\n'
ok "release complete · artefacts and log in $RUN_DIR"
log "next: work the held calls at /admin/funding/import-review; the catalogue release notes are docs/catalog-import-runbook.md"
