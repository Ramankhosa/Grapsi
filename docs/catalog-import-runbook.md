# External catalogue import — production runbook

The ScientifyResearch crawl (10,031 opportunities, 1,847 funders) is imported as
a separate **discovery catalogue**. This runbook moves it to production without
touching existing data. Every step stops on a failed check.

## What the import does and does not do

- **Inserts only.** New calls, funders, source records, deadline rows, crosswalk
  research-area rows and review items. No existing `funding_calls` row is
  written — the import, review and release only ever update rows that have an
  `import_run_id`.
- **Invisible until released.** Calls are written `catalog_status = STAGED`,
  `is_active = false`, `visibility = GLOBAL_CATALOG`.
- **Never notifies.** `notification_policy = SUPPRESSED` is checked inside the
  alert dispatcher, the hourly alert sweep and the officer-notice service;
  release never calls `publishFundingCall`.
- **Stays out of the funding department.** Every DSR query reads
  `GLOBAL_PUBLISHED`; released imports are `GLOBAL_CATALOG`, so queues, census,
  backlog and reminders ignore them. Researcher discovery (finder, chat, call
  page) opts in explicitly.
- **Duplicates are review items, never merges.** "Same as an existing call"
  sets the imported copy aside and links its source to the existing call; the
  existing call is not written.

## Code that must ship first

- The catalogue-import code (this change set).
- The match-census work in the same working tree (`callMatchCensus.ts`,
  migration `20261014100000_call_people_match_census`). `migrate deploy`
  applies migrations in order and that one sorts before ours; it mutates match
  rows, so it must ship *with* its code, not ahead of it. Decide this before
  step 4.

## Steps

All commands run on the production server from the app directory, as the app
user. `npx tsx` = `node ./node_modules/tsx/dist/cli.cjs`.

1. **Inventory (read-only).**
   `npx tsx scripts/inventory-existing-calls.ts --out ~/inventory-before`
   Review it: unfinished migrations, published calls without an alert stamp,
   status-column disagreements, tenants (confirm their countries), possible
   seeded/demo calls, existing duplicate pairs.
2. **Backup #1 and a restore test.**
   `pg_dump "$DATABASE_URL" -Fc -f ~/grapsi-before-catalog-import.dump`, then
   restore it into a scratch database and run the inventory against it.
3. **Rehearse** steps 4–8 on the restored copy (or on the dev machine with the
   dump restored locally). Everything below must pass there first.
4. **Migrate.**
   `psql "$DATABASE_URL" -Atc "SELECT extversion FROM pg_extension WHERE extname = 'vector'"`
   — the HNSW migration (`20261016100000`) needs pgvector >= 0.5 and the
   query-time iterative scan needs >= 0.8 (see `docs/vector-index-benchmark.md`).
   `npx tsx scripts/check-additive-migration.ts` (must print `additive` ×7)
   `npx tsx scripts/catalog-safety-check.ts capture --out ~/safety-0.json`
   `npx prisma migrate status` → `npx prisma migrate deploy`
   `npx tsx scripts/catalog-safety-check.ts compare --before ~/safety-0.json`
   Migrations take a 5-second lock timeout; if one times out, re-run deploy.
   The HNSW migration blocks writes to `funding_calls` while it builds (a few
   seconds at today's size) — not during an intake or import run.
5. **Deploy the code** (deploy.sh). No STAGED row exists yet, so a code rollback
   is still safe. After step 7 a code rollback must be preceded by an import
   rollback (old builds cannot read STAGED / GLOBAL_CATALOG values).
6. **Seed rates:** `npx tsx scripts/seed-currency-rates.ts` (approximate
   reference rates dated 2025-06-01 — refresh `Seed/currency-rates.csv` first if
   you want current estimates).
7. **Import.** Copy the snapshot directory from the dev machine
   (`storage/import-snapshots/scientify-…`, ~126 MB incl. manifest) to the server.
   `npx tsx scripts/catalog-safety-check.ts capture --out ~/safety-1.json`
   `npx tsx scripts/import-funding-catalog.ts dry-run --snapshot <dir>` — the
   snapshot checksums are re-verified; read the report.
   `pg_dump` backup #2.
   `npx tsx scripts/import-funding-catalog.ts apply --snapshot <dir> --confirm-target <db name> --operator-email <super admin> --full-snapshot`
   `npx tsx scripts/catalog-safety-check.ts compare --before ~/safety-1.json` → must PASS.
8. **Review and release.** Curators work `/admin/funding/import-review`
   (listing variants can be resolved in bulk). Release from the page (2,000
   per click) or `npx tsx scripts/import-funding-catalog.ts release --source scientify --apply`
   (by source: picks up every STAGED + CLEAR call, whichever run created it).
   Re-run the safety compare after each release batch.
9. **Embed the released calls.**
   `npx tsx scripts/embed-catalog-calls.ts --dry-run` prints the provider,
   column and token estimate (dev: 8,356 calls, ~3.3M tokens with Voyage
   voyage-4-large, 111 s). Then run it without `--dry-run`. It writes only the
   vector column and embedding metadata of imported rows, never `updatedAt`,
   and is resumable: re-run after a provider error. Re-run it after every
   re-import or release; it re-embeds only calls whose text changed.
   Search text needs no step here: the import runs after migration
   `20261016110000`, so the trigger already indexes the imported fields. Only
   if calls were imported *before* that migration, run
   `npx tsx scripts/refresh-catalog-search-text.ts --apply` (imported rows only).
   `npx tsx scripts/benchmark-call-text-search.ts` must report `0 differing`
   (the finder's UNION text match against the old OR-EXISTS form);
   `FINDER_FTS_UNION=0` switches back to the old form without a deploy.

## Existing-call backfill (only after the match-census work is live)

Gives curated calls the facts imported calls carry (applicant eligibility,
deadline rows, currency + USD estimates, funder links, provenance) and widens
their search text with their summary. New columns only, `updatedAt` kept,
every value logged under a BACKFILL run and reversible. Any write changes a
call's `xmin`, which the census treats as a change and re-scores, so do not
run it before the census ships.

1. `npx tsx scripts/backfill-existing-calls.ts --out ~/backfill-plan.json` —
   read the per-call notes: country names recovered from intake, names that
   did not resolve (stored as UNSPECIFIED = "check eligibility", never as a
   shorter list), currencies without a rate, funders linked vs created.
2. `pg_dump` backup.
3. `npx tsx scripts/catalog-safety-check.ts capture --out ~/safety-bf.json`
   and `npx tsx scripts/finder-parity.ts capture --out ~/parity-bf.json`
4. `npx tsx scripts/backfill-existing-calls.ts --apply --confirm-target <db> --operator-email <you>`
5. `catalog-safety-check.ts compare --before ~/safety-bf.json` must PASS
   (0 silent changes; new facts are covered by the BACKFILL change log), and
   `finder-parity.ts compare --before ~/parity-bf.json` must PASS (no legacy
   call drops out of a text match, filter totals and My areas unchanged;
   text matches may grow).
6. Undo if anything looks wrong:
   `npx tsx scripts/backfill-existing-calls.ts --undo <runId> --confirm-target <db>`
   (restores every value it wrote unless someone has changed it since; on dev
   the legacy search-text hash returned to its original value byte for byte).

After it, curated calls' stated country eligibility also gates alerts and
shows badges, and the funder filter matches them by funder link.

## Behaviour changes to announce

- **Funding alerts reach more institutions.** A global call used to be matched
  in one platform-wide search, and with the reranker on only its top 40 people
  could clear the relevance gate, across all tenants. Each tenant with
  researchers and the FUNDING_ALERTS feature is now searched separately and
  gets its own best matches (up to 50). Expect more alerts per curated call
  on a multi-tenant deployment, and alerts in tenants that previously got
  none. These searches are not recorded as DSR matching runs.
- **Alerts respect stated country eligibility.** A researcher whose profile
  countries a call explicitly rules out is no longer alerted. Calls without
  evaluated eligibility (every curated call until the backfill) and profiles
  without a country behave as before.
- **Badges.** Catalogue calls carry a "Global catalogue" badge. When a search
  uses the researcher's profile, calls that state country eligibility show
  Eligible / Check eligibility / Not eligible for your profile; the call page
  shows the same for the viewer. On dev, for an India-based profile most top
  catalogue matches were "Not eligible" (17 of 25 for "cancer research").
- **`FINDER_RANK_CURATED_FIRST=1`** (off by default) breaks near-ties (same
  hundredth of a score) in favour of curated, then eligible, calls. On the
  dev sample it moved 0-3 of the top 8 results.
- **"My areas" lists the external catalogue** (open/closed by the imported
  lifecycle as well as the deadline), and its ranking now keeps the closest
  calls rather than the lowest ids.

## Stop conditions and rollback

Stop on: any `silent change` or `missing row` in the safety compare, any
invariant violation, any new notification/alert for an imported call, or a rise
in error rates.

- Import: `npx tsx scripts/import-funding-catalog.ts rollback --run <runId> --confirm-target <db>`
  (dry run without `--confirm-target`). Deletes only calls the run created that
  nothing else references; anything with attached work is archived instead.
- Schema: the migrations are additive and harmless to leave in place; restore
  backup #1 only if something outside the import went wrong.

## Not part of this release (deliberately)

- Backfilling new columns on **existing** calls (country codes, deadline rows,
  funder links). Any write to an existing row changes its `xmin`, which the
  match census treats as a change. Do it later, after the census work is live.
- Funding-department access to imported calls, tenant currency /
  timezone (Release 3), fetching official guidelines (Release 4).
- Starting the production scheduler is its own decision: it also starts alert,
  reminder and monitor jobs that have never run there (see the inventory's
  "published calls with no alert stamp").
