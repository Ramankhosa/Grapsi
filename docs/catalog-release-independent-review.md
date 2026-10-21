# Catalogue release safety review — 21 October 2026

Reviewed original checkout `510ff3c`; repairs are on
`codex/catalog-production-safety`. Production started at `4c24f96`.

## Findings reproduced and repaired

- **Safety fingerprint collision:** changing an existing description from SQL
  NULL to the literal `<null>` passed. Fingerprints now serialize typed field
  boundaries with `row_to_json(ROW(...))` rather than concatenate sentinel text.
- **Timestamp bypass:** changing content and `updatedAt` passed as an assumed
  application edit. Any existing-call change now stops release for review;
  changes in attached-row counts and database identity also fail.
- **Rollback missed non-FK links:** an intake duplicate pointed to an imported
  call, but rollback deleted that call. Explicit links in intake duplicates,
  reviewer calls, monitored changes, and idea intelligence sessions/runs now
  supplement foreign-key discovery. Rollback now archives all of the run's
  calls instead of physically deleting them, so JSON-only references and work
  attached concurrently cannot be cascade-deleted. A JSON-only reference is
  covered by the adversarial probe. Promoted calls are excluded at write time.
- **Confirmation gaps:** currency seeding and release-plan review-status
  refresh now require database confirmation before writing.
- **Resume failures:** explicit failures now print a resume phase; resuming
  from `preflight` selects the remaining phases correctly. Missing argument
  values have explicit errors. Avoided `ls | head` under `pipefail`.
- **Deployment configuration:** preserve supported PM2, port, health-check,
  Node memory and build-priority settings across the cleared environment.
- **Environment quoting:** literal quotes, dollar signs, command substitutions,
  spaces, hashes and backslashes survive sourcing without shell execution.
- **Bundle identity:** pin executable source, scripts and migration contents,
  not just crosswalk/seed files and migration directory names.
- **Eligibility ordering:** apply demotion in SQL before pagination, including
  deadline browsing; add a unique ID tie-break. Country filtering now retains
  unknown dimensions, including empty COUNTRIES lists, as the evaluator does.
- **Verification SQL:** a published call with NULL review status now fails the
  held-call invariant (`IS DISTINCT FROM 'CLEAR'`).

## Checks completed locally

- ShellCheck 0.10.0: clean on both release scripts. Narrow documented
  suppressions cover a generated environment source, JavaScript interpolation,
  and the checksum file explicitly excluded from its own file list.
- Bash syntax and JavaScript helper syntax checks passed.
- Import lifecycle: **52 passed, 0 failed**, on a disposable schema clone.
- Adversarial SQL probes: NULL-sentinel and timestamp bypasses rejected;
  all five invalid release guards update zero rows; valid release updates one.
- Thirty scope/list/exclusion cases: SQL filtering and SQL demotion agree with
  `evaluateDimension`. SQL pagination test places the eligible later-deadline
  call ahead of an ineligible earlier-deadline call before LIMIT.
- All eleven actual release phase functions stop with a phase resume hint when
  an external command fails. These use mocked external commands and do not
  prove every possible mid-phase database failure is atomic.
- Full unit suite after repair: **1,705 passed, 2 failed**, both in the existing
  Gemini suite. Gemini implementation/tests are unchanged from `main`.
  An initial password-reset timing failure passed on rerun and in the final suite.
- Typecheck passed. All ten catalogue migrations pass the additive checker.
- Prisma diff of a migrated disposable clone: no ALTER/CREATE/DROP drift on
  `funding_calls` or its indexes. Other pre-existing schema drift remains;
  never apply this diff wholesale or use `db push` to deploy it.

## Crosswalk

The 21 October frozen snapshot has **10,120 calls**, **528 distinct discipline
labels**, and **39,196 discipline-label uses**. All labels resolve through the
production lookup for the five controlled taxonomy categories checked. Every
discipline target code exists in the area catalogue. Blank mappings for broad
labels are explicit mappings, not unresolved labels.

The top forty discipline labels account for 27,158 uses (about 69%). Their
mappings are reasonable against the supplied area catalogue. Whole-group
ENG/MED/MGT mappings are coarse fallbacks, not evidence for every subfield.
Earth sciences → PHY.04 and Built environment → DES.01|ENG.03 fit directly.
Circular economy → LIF.04 is supported by an explicit area alias; ENG.04 is a
conditional process-engineering interpretation. Disaster management could also
include PHY.04 (natural hazards/disaster risk); the current ENG.03|SOC.01 covers
infrastructure and social response. These judgement calls were not silently
rewritten.

## Production controls

Target: `patentnest-production-20251121-051811`, zone `asia-south2-b`, application
`/var/www/granter/Grapsi`, PM2 app `grantmentor`, operating user `ramankhosa`.
The app and scripts resolve to `localhost:5432/grapsi`. PostgreSQL is 17.7,
pgvector 0.8.0. No other application's database is a deployment target.

One full 1.4 GB custom-format backup has been taken and restored successfully.
The restored copy contains 238 intake calls, 74 assignments, 250 call-school
mappings, 11 follow-ups, 412 DSR events, 856 users and 10 tenants. The pending
migrations passed on that copy; the preservation check confirms those captured
records are unchanged. A dry run reports 8,390 releasable calls, 1,730 held for
review and zero unmapped labels. The actual Linux/PM2 rehearsal must finish
before production migration/import.
The rehearsal is isolated in `grapsi_catalog_rehearsal_20261021_101626` and a
separate application checkout. Production remains unchanged at this checkpoint.
