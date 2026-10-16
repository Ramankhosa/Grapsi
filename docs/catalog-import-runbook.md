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
   `npx tsx scripts/check-additive-migration.ts` (must print `additive` ×5)
   `npx tsx scripts/catalog-safety-check.ts capture --out ~/safety-0.json`
   `npx prisma migrate status` → `npx prisma migrate deploy`
   `npx tsx scripts/catalog-safety-check.ts compare --before ~/safety-0.json`
   Migrations take a 5-second lock timeout; if one times out, re-run deploy.
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
   (listing variants can be resolved in bulk). Release from the page or
   `npx tsx scripts/import-funding-catalog.ts release --run <runId> --apply`.
   Re-run the safety compare after each release batch.

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
- Embeddings for imported calls (Release 2: they are found by full-text search
  until then), funding-department access to imported calls, tenant currency /
  timezone (Release 3), fetching official guidelines (Release 4).
- Starting the production scheduler is its own decision: it also starts alert,
  reminder and monitor jobs that have never run there (see the inventory's
  "published calls with no alert stamp").
