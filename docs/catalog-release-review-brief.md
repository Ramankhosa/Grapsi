# Independent review brief — external catalogue release

For a second reviewer (Codex). Branch `feature/external-catalogue`, 40-odd
commits ahead of `main`, never pushed. Goal: decide whether it is safe to put on
the production VM, which holds real calls, assignments and proposals.

**Rules for the reviewer**

- Do not run anything that writes against the dev database `grapsi`. A scratch
  database `grapsi_rehearsal` exists for destructive checks; create your own
  with `createdb` if you want a clean one.
- Report findings as: file:line, what is wrong, a concrete failing scenario.
  Say "could not verify" rather than guessing.
- Everything below states what I (Claude) believe and how I checked it. Treat
  each as a claim to disprove.

---

## 1. The release script — highest priority, it has never run on a VM

`scripts/catalog-release/release.sh`, `lib/env.mjs`, `lib/check.mjs`,
`build-bundle.sh`, `README.md`.

I rehearsed it on a Windows Git Bash box against a database restored from the
pre-import dump, with `--skip-deploy --skip-embed`. I have **not** run it on
Linux, under PM2, with a real `deploy.sh`, or with the embedding phase.

Ask Codex to review for:

1. **Bash correctness under `set -Eeuo pipefail` + `trap … ERR`.** Commands in
   `$(…)`, `|| true`, pipelines into `tee`, `local`-less globals (`PGURL`,
   `DB_NAME`) set inside `phase_preflight`, functions called in conditions
   (where `set -e` is suspended). Anything that can fail silently or exit
   without the resume hint. Run `shellcheck release.sh build-bundle.sh`.
2. **The `exec > >(tee -a "$LOG") 2>&1` redirect combined with the ERR trap and
   the lock `trap … EXIT`:** does the lock directory always get removed, and
   does the final message always reach the terminal?
3. **`confirm()`** reads `/dev/tty`; `--yes` bypasses it and requires
   `--confirm-db`. Is there any path to a write phase (`migrate`, `deploy`,
   `import`, `release`, `embed`, `backfill`) that skips both?
4. **`phase_deploy`** runs `scripts/deploy.sh` under `env -i` with a short
   allow-list (`HOME PATH USER LOGNAME LANG PM2_HOME NVM_DIR`). On the VM does
   that drop anything `deploy.sh`, `npm`, `next build` or `pm2` needs
   (`NODE_OPTIONS`, `NODE_ENV`, `PORT`, `PM2_APP`, `XDG_*`, a sudo-installed
   Node)? Compare with how the team normally invokes it. `--skip-deploy`'s
   freshness test uses `stat -c %Y .next/BUILD_ID` against the commit time — GNU
   only, and does `deploy.sh`'s `.next` swap keep `BUILD_ID`?
5. **Database identity** (`lib/env.mjs`): `src/lib/prisma.ts` overwrites
   `DATABASE_URL` from `.env` then `.env.local`; Next layers `.env`,
   `.env.production`, `.env.local`, `.env.production.local`; the Prisma CLI
   does not override existing env. Is the script's claim that it refuses a
   split-brain setup correct for each combination? Is the `set -a; . file`
   load safe for values with `$`, backticks, quotes, `#`?
6. **`q()`/`psql` quoting:** the operator-email lookup escapes `'`; any other
   interpolation into SQL or shell?
7. **`lib/check.mjs code`** pins seed files by normalised-EOL sha256 and
   requires named migrations to exist. Can a checkout pass while differing in
   something that changes import behaviour (e.g. `src/lib/fundingCatalogImport`
   code, which is *not* pinned)? Should it pin the importer's `IMPORTER_VERSION`
   or a hash of that directory?
8. **`pg_dump` URL handling** (`check.mjs pgurl` drops params libpq rejects):
   safe for URLs with passwords containing `@ % :`?

Approve if: shellcheck is clean or every finding is justified, no path writes
without a typed database name, and `--from <phase>` resumes correctly after a
failure injected in each phase.

## 2. Data safety claims

Claim: the import, release and rollback never write a pre-existing call, never
notify anyone, and never expose an imported call to the funding department.

Verify by running, on a scratch database restored from a dump, with the
mutating script:

```
node node_modules/tsx/dist/cli.cjs scripts/verify-catalog-import.ts   # expect 32 passed
node node_modules/tsx/dist/cli.cjs scripts/check-additive-migration.ts # expect additive ×10
```

Then read, and try to break:

- `src/lib/fundingCatalogImport/safety.ts` — does the fingerprint really cover
  every pre-existing column that matters? `CATALOG_IMPORT_COLUMNS` and
  `DERIVED_COLUMNS` are exclusions; confirm each excluded column is genuinely
  new or derived.
- `release.ts` — the single `UPDATE … FROM old` guard
  (`STAGED`, `CLEAR`, `SUPPRESSED`, `GLOBAL_CATALOG`, `import_run_id IS NOT NULL`).
- `rollback.ts` — `callsWithAttachedWork` reads foreign keys from
  `pg_constraint`; confirm it also catches references that are *not* foreign
  keys (JSON ids, text columns holding a call id).
- Every raw-SQL reader of `funding_calls` outside `fundingDept/` still has a
  visibility predicate (I inspected 29; list them again independently:
  `grep -rln funding_calls src pages`).
- The five `verify` phase SQL invariants in `release.sh` — do they actually
  fail when the thing they guard breaks? Mutate data in a scratch DB to prove it.

## 3. Behaviour changes I made in this pass (commits 59cf15c, e163291, 324bb56)

| Change | Where | Challenge |
|---|---|---|
| Browse lists curated calls before imported ones | `recommendationSearchService.ts` `CURATED_FIRST_SQL` | Does it disturb pagination stability, the `deadline_soonest` sort, or the text-ranked listing? Is the first-key position right for `deadline_soonest`? |
| Calls the profile is explicitly excluded from sort last | `ineligibleDemotion`, `sortCandidates` | Applies only when the search applies the profile; check the `deadline_soonest` branch and that it cannot reorder a *page* already cut by SQL `LIMIT` (it sorts within the fetched page only — is that acceptable?) |
| Country filter honours `*_excluded_codes` | `importedDimensionCountryCondition` | Compare line by line to `evaluateDimension` in `lib/funding/eligibility.ts`. Cost: ~140 ms extra on 10k rows — is there a cheaper form? |
| Admin screens exclude `GLOBAL_CATALOG` | `super-admin/researcher-matching/route.ts`, `fundingCatalogService.ts` | Any other admin list/count I missed? |
| HNSW index names pinned in `schema.prisma` | `@@index(…, map:)` | Run `prisma migrate diff` against a migrated scratch DB: any remaining drift on `funding_calls`? |

## 4. The crosswalk — a judgement call that needs a second pair of eyes

`Seed/crosswalks/scientify-disciplines.csv`, rows 164 onward (381 rows, note
"added for the 21 Oct 2026 crawl"). I chose each mapping by reading the label
against the 49-area catalogue in `Seed/research-areas-default.csv`.

Ask Codex to (a) confirm mechanically that every label in
`storage/import-snapshots/scientify-2026-10-21T09-30-47-389Z/grants.jsonl`
resolves (`lookup()` in `src/lib/fundingCatalogImport/crosswalks.ts`), and
(b) review the **~40 highest-count labels** for sense (together they cover most
of the 7,565 uses). Ones I am least sure about: `Circular economy`,
`Disaster management`, `Built environment`, `Health sciences` (→ whole MED
group), `Business and Economics` (→ whole MGT group), `Area and Cultural
studies`, `Earth sciences`, `Engineering and Technology` (→ whole ENG group).

## 5. Things I could not verify — Codex cannot either without the VM, so list them as open

- Linux, PM2, the real `scripts/deploy.sh` run, the health gate and rollback.
- The embedding phase (provider/column on production; dev vectors are in
  `embedding_voyage_1024`).
- Disk and time on the VM; HNSW build time at production size.
- pgvector version on production (script requires ≥ 0.5, wants ≥ 0.8).
- That the VM's `main` is an ancestor of this branch (0 behind on this machine).
- The census migration `20261014100000` mutates match rows and sorts before the
  catalogue's; it must ship with its code (it does, same branch).

## 6. Known, intentional, not defects

- 7,543 of 10,031 imported calls were already closed; only ~2.1k are open.
- Description text is Scientify's editorial summary shown with attribution
  (`funding_source_registry`); enrichment from official pages is deferred.
- "Write grant" is hidden on catalogue calls until authoring is built.
- `gemini-service.test.ts` has two failures that pre-date this branch.
- `fundingCallsService.searchFundingCalls` has no visibility predicate but no
  reachable caller.

## 7. Suggested approval checklist (pass/fail)

- [ ] `shellcheck` on `release.sh` and `build-bundle.sh` clean or justified
- [ ] `bash -n`, `node --check` on the `.mjs` helpers
- [ ] `npx vitest run src/tests/unit` — only the two Gemini failures
- [ ] `npx tsc --noEmit` clean
- [ ] `verify-catalog-import.ts` 32/32 on current HEAD
- [ ] `check-additive-migration.ts` additive ×10
- [ ] Fresh scratch DB: full `release.sh` run succeeds; re-run of each phase is idempotent
- [ ] Failure injection in each phase leaves the DB consistent and prints a working `--from` hint
- [ ] Dry run reports 0 unmapped labels
- [ ] Post-release: 0 notifications/alerts for imported calls; 0 imported calls visible to `visibleCallSql`
- [ ] No finding rated blocking in sections 1–3
