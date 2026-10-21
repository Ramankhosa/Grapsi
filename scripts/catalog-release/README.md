# Grapsi catalogue release — operator guide

This bundle puts the ScientifyResearch funding catalogue (the 21 Oct 2026
crawl: 10,120 calls, 1,866 funders) and the schema it needs onto the
production VM, without changing any existing call. `release.sh` does all of it
in one supervised run and stops at the first failed check.

## Before you start

1. **The code must be on the VM.** The bundle carries data, not code. Push the
   commit it was built from (see `gitCommit` in `bundle-manifest.json`) to
   GitHub — merged into `main` if you deploy `main` — so the VM checkout can
   reach it. `release.sh --git-ref origin/main` fetches and checks it out for
   you; without `--git-ref` it uses the checkout as it stands. Either way it
   refuses a checkout whose source code, scripts, crosswalks, currency rates or migrations differ
   from what the bundle was built and tested with.
2. **Dev dependencies installed** in the app checkout (`npm ci`): the run uses
   `tsx` and the `prisma` CLI from `node_modules`.
3. **`psql` and `pg_dump`** at least as new as the database server
   (`sudo apt-get install postgresql-client-17` for a 17.x server).
4. **An operator account:** the email of an existing super admin. It is
   recorded as creator on every imported row.
5. **Disk:** room for two `pg_dump` backups of the database, plus ~260 MB for
   the unpacked bundle.
6. **A quiet window:** the vector-index migration blocks writes to
   `funding_calls` for a few seconds, and `scripts/deploy.sh` restarts the app.

## Run it

```bash
# on your machine
gcloud compute scp grapsi-catalog-release-2026-10-21.tar.gz <vm>:~/

# on the VM
sha256sum grapsi-catalog-release-2026-10-21.tar.gz     # compare with the value you were given
tar -xzf grapsi-catalog-release-2026-10-21.tar.gz
cd grapsi-catalog-release-2026-10-21
bash release.sh --app-dir /var/www/granter/Grapsi --operator-email you@institution.edu
```

It asks for the database name before every step that writes. To run unattended
add `--yes --confirm-db <database name>`.

If PM2 injects env from a file outside the checkout (an ecosystem's
`shared/.env.production`), pass it with `--env-file <path>`. The run refuses to
start if the app and the scripts would resolve different databases.

## What it does

| phase | what happens | writes |
|---|---|---|
| preflight | bundle checksums, checkout matches the bundle, one database, pgvector ≥ 0.5, pg_dump version, operator exists | nothing |
| backup | `pg_dump` of the whole database | a file in `run/<ts>/` |
| migrate | additive check, safety snapshot, `prisma migrate deploy`, safety compare | schema |
| deploy | `scripts/deploy.sh`: build, swap, PM2 restart, health check, auto-rollback | the app build |
| seed | currency rates for "≈ USD" amounts | `currency_rates` |
| dryrun | importer dry run; stops if any source label has no research-area mapping | nothing |
| import | second backup, safety snapshot, import, safety compare | new rows only, all STAGED and invisible |
| release | publishes every call with no open review item (duplicates stay held) | status of imported rows |
| embed | search vectors with the app's own embedding provider (paid API calls) | vectors on imported rows |
| verify | isolation and no-notification invariants, text-search parity, counts | nothing |
| backfill | only with `--with-backfill`: facts for curated calls and profile country codes, in a safety + finder-parity window | new columns only, reversible |

Imported calls never go to the funding department (queues, census, reminders)
and never alert anyone: they are `GLOBAL_CATALOG` with notifications
suppressed, and `verify` checks both.

## If it stops

Every phase is safe to re-run. Read the message, fix the cause, then resume:

```bash
bash release.sh --app-dir … --operator-email … --from <phase>
```

The log, both dumps, the safety snapshots and the importer's reports are in
`run/<timestamp>/`.

## Undo

- **The import** (archives the run's calls and keeps their records, links and
  provenance; promoted department calls are left alone):
  `node node_modules/tsx/dist/cli.cjs scripts/import-funding-catalog.ts rollback --run <runId> --confirm-target <db>`
  The run id is printed by the import phase and kept in `run/<ts>/apply.txt`.
  Roll the import back **before** rolling the code back: older builds cannot
  read the catalogue's new status values.
- **The backfill:** `scripts/backfill-existing-calls.ts --undo <runId> --confirm-target <db>`.
- **The schema:** the migrations are additive and harmless to leave in place.
- **Full recovery:** restore the backup into a separate database first and
  verify it. Do not restore over the live database: doing so would discard
  members' work recorded after the backup. Reconcile that work before any
  deliberate recovery cutover.

## After the release

- Work the held calls (suspected duplicates, missing facts) at
  `/admin/funding/import-review`, then release them from that page.
- Re-run `scripts/embed-catalog-calls.ts` after any later import or release;
  it only embeds what changed.
- `docs/catalog-import-runbook.md` and `docs/catalog-release-verification.md`
  in the repository have the full background and the behaviour changes to
  announce.
