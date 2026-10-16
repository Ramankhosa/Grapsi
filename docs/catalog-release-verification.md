# External catalogue release — verification checklist

What the app must still do once the ScientifyResearch catalogue (10,031 calls,
1,847 funders) sits beside our own curated calls, how each item was checked,
and what it said. Run it as the pre-release gate; `docs/catalog-import-runbook.md`
is the deploy procedure itself.

**Verified against** the dev database as it stands after the dev import —
10,031 imported calls (8,356 released, 1,674 staged, 1 rejected) against 17
curated calls, 1,813 funders, pgvector 0.8.0 — plus
`scripts/verify-catalog-import.ts` (32 checks on a disposable database),
`scripts/check-additive-migration.ts`, `scripts/benchmark-call-text-search.ts`,
the unit suite and `tsc --noEmit`.

Legend: **PASS** verified; **FIXED** a gap this pass found and closed (file
named); **OPEN** a decision or a cost that is not a code defect.

---

## A. The funding department must not see imported calls

| # | Must be true | Verified | |
|---|---|---|---|
| A1 | Every DSR read tests `visibility = 'GLOBAL_PUBLISHED'` | all 29 readers of `funding_calls` inspected: `visibleCallSql` plus its four private copies (queue route, `accountabilityService`, `dashboardService` ×2) all carry it | PASS |
| A2 | Queues, census, school mapping, triage, backlog, pendency, reminders, escalations, reports and exports ignore them | every one goes through `visibleCallSql`; `verify-catalog-import` asserts "funding-department scope still sees no imported call" | PASS |
| A3 | A catalogue call cannot be assigned or allocated | `tenantVisibleCallWhere` → `visibleFundingCallWhere` without `includeCatalog` (`/api/assignments`, `/bulk`, `allocationOptions`) | PASS |
| A4 | Officer "new call" notices never fire for them | `newCallNoticeService` returns early on `notification_policy = SUPPRESSED` **or** `GLOBAL_CATALOG` | PASS |
| A5 | The reviewer workspace picker stays curated | `pages/api/reviewer/funding-calls.ts` filters `GLOBAL_PUBLISHED` or own tenant | PASS |
| A6 | Intake pickers, duplicate-merge targets, bulk publish and global publish refuse them | explicit `NOT GLOBAL_CATALOG` / `import_run_id IS NULL` guards in `fundingIntake/service`, `funding/calls`, `fundingCatalogService`, `ingestion-service` | PASS |
| A7 | The super-admin researcher-matching picker and its "funding calls" tile stay curated | they were `where: { status: 'PUBLISHED' }` ordered by `updatedAt`, `take: 50` — after release the picker would have listed **only** catalogue calls and the tile would have read ~8,371 | **FIXED** `src/app/api/super-admin/researcher-matching/route.ts` |

## B. Researcher discovery must stay useful

| # | Must be true | Verified | |
|---|---|---|---|
| B1 | Finder search, chat, doc Q&A, the call page and "My areas" opt in deliberately | `includeCatalog` / `GLOBAL_CATALOG` branches in `callVisibility`, `callAccess`, `myAreasService`, `fundingDocuments/retrieval`, `recommendationSearchService` | PASS |
| B2 | A STAGED call is invisible everywhere until released | written `READY_FOR_REVIEW` + `catalog_status STAGED` + `is_active = false`; every reader needs PUBLISHED (either column) | PASS |
| B3 | Imported calls are labelled, and eligibility is labelled against the viewer's profile | "Global catalogue" badge on both cards; Eligible / Check eligibility / Not eligible from `lib/funding/eligibility` | PASS |
| B4 | Authoring is not offered on a facts-only call | "Write grant" and "Validate an idea" hidden (`authoringReady`); `canUserUseFundingCall` refuses a catalogue call that is not `ENRICHED` | PASS |
| B5 | Browsing still reaches the institution's own calls | **it did not**: all 10,031 rows are inserted in one run, so they share that day's `updatedAt`; ordered by recency the first curated call was row **2,096 of 2,104** open calls — page 105 | **FIXED** curated-first sort key, `recommendationSearchService` (`CURATED_FIRST_SQL`); browse page 1 is now 9 curated + 1 catalogue |
| B6 | Results are calls the researcher could actually apply for | an India-based profile searching "cancer research" got 17 "Not eligible" calls in its top 25 | **FIXED** calls whose stated eligibility explicitly excludes the profile's countries now sort last when the search applies the profile (`FINDER_DEMOTE_INELIGIBLE=0` to disable); "Check eligibility" never moves |
| B7 | A country filter must not return a call that rules that country out | the imported-dimension filter read the allow list only, so "worldwide except X" matched a filter for X and the card then said "Not eligible" | **FIXED** `importedDimensionCountryCondition` mirrors `evaluateDimension`; identical results on today's data (662 = 662 calls for India) |
| B8 | Open/closed agrees between the finder, My areas, the call page and DSR | `importedLifecycleGuard`, `importedClosedSql`, `callClosingDaySql` all read `source_closed_at` + `entry_closes_at`; `close_date` mirrors `final_deadline_at` on all 10,031 rows (0 mismatches) | PASS |
| B9 | Text search still returns every call it used to, faster | `benchmark-call-text-search`: 60 query runs, 17,295 matches, **0 differing**; p50 248 ms → 3.6 ms (`FINDER_FTS_UNION=0` reverts) | PASS |
| B10 | Semantic search keeps its recall at 10k vectors | HNSW + `ef_search` 100 + iterative scan: 292 ms → 52 ms for a filtered top-60; all 8,356 released calls hold a vector in the active column | PASS |
| B11 | Filters/facets cover the new fields in one pass | 12 facet dimensions populate (funder, programme, SDG added), one statement, 58 ms | PASS |
| B12 | The chat says which filters are narrowing the results | funder, programme, SDG, amount-currency and unknown-amount filters set in the sidebar were invisible in the chat's "searching with" line | **FIXED** `recommendationConversationService` |

## C. Nothing may notify anyone about an imported call

| # | Must be true | Verified | |
|---|---|---|---|
| C1 | No alert in any path: inline dispatch, hourly sweep, daily/weekly digest, officer notice | `notification_policy = SUPPRESSED` on all 10,031 rows plus an `alerts_dispatched_at` stamp; dispatch refuses before anything else **even with `force`**; the sweep SQL excludes SUPPRESSED (dev sweep candidates: 6, all curated) | PASS |
| C2 | Release never runs the publish hooks | `releaseImportedCalls` flips columns in SQL; no `publishFundingCall`, no embedding, classification, school mapping, notice or alert | PASS |
| C3 | The new country gate drops only an explicit INELIGIBLE | a call with no evaluated dimension and a profile with no country behave exactly as before | PASS |
| C4 | Per-tenant alert fan-out does not appear as DSR matching work | `recordRun: false` on those searches | PASS |
| C5 | Fan-out cost | one embedding + rerank search **per entitled tenant per call**; the sweep takes ≤25 calls per run | OPEN (see K4) |

## D. Review, release, rollback

| # | Must be true | Verified | |
|---|---|---|---|
| D1 | A blocking review item holds a call back | 1,674 staged dev calls are all `NEEDS_REVIEW`; release re-checks CLEAR + SUPPRESSED + GLOBAL_CATALOG inside the updating transaction | PASS |
| D2 | No resolution ever writes an existing call | `setAside` refuses a call without `import_run_id`; "same as existing" only re-points the provenance row | PASS |
| D3 | Duplicate chains stay honest (A~B~C) | `verify-catalog-import` checks the chain end to end | PASS |
| D4 | Release is batched, resumable and fully logged | 2,000 per request, by source (a crashed run's calls included), all four changed columns logged | PASS |
| D5 | Rollback/unrelease never deletes work | referencing tables read from `pg_constraint`, so a call with an assignment, grant session or DSR row is archived instead | PASS |
| D6 | Rollback removes the provenance and funders it created | and leaves funders that other calls still reference | PASS |
| D7 | A re-import is idempotent and conflicts become review items | content hash + three-way merge against `imported_values`; derived-only changes keep `updatedAt` | PASS |
| D8 | The importer refuses the wrong database and a concurrent run | `--confirm-target`, plus a 6-hour RUNNING-run lock | PASS |

## E. Our own existing data must come through untouched

| # | Must be true | Verified | |
|---|---|---|---|
| E1 | Every pre-existing row is byte-identical through import, release and rollback | `catalog-safety-check` fingerprints only pre-migration columns; `verify-catalog-import` asserts it end to end | PASS |
| E2 | No pre-existing call carries a catalogue marker, and no new fact column is set on one outside a reversible BACKFILL run | both invariants are in the safety capture | PASS |
| E3 | The existing-call backfill writes new columns only, keeps `updatedAt`, and undoes exactly what it wrote | code review + `existing-call-backfill.test.ts`; **not yet run on prod** (it must follow the census) | PASS (unrun) |
| E4 | A full catalog wipe cannot destroy the import unnoticed | it deletes imported calls too and no import rollback can bring them back; the confirmation screen did not say so | **FIXED** impact now reports `importedCalls` and the screen warns |
| E5 | The embedding-coverage card stays actionable | it counted the catalogue, so it would have reported ~8.4k calls permanently "missing an embedding" that the repair path deliberately refuses to touch | **FIXED** `fundingCatalogService.getEmbeddingCoverageSummary` (bulk script owns them) |

## F. Migrations and schema

| # | Must be true | Verified | |
|---|---|---|---|
| F1 | Every migration is additive | `check-additive-migration.ts`: `additive` for all ten | PASS |
| F2 | New enum values are added alone (they cannot be used in the adding transaction) | STAGED and GLOBAL_CATALOG each in their own file | PASS |
| F3 | The visibility/tenant CHECK is widened, not dropped | one statement, same name, strictly wider; no row read or rewritten | PASS |
| F4 | HNSW is safe on an older pgvector and cannot hang | guarded on ≥ 0.5 with a NOTICE, `lock_timeout 5s`; dev is 0.8.0 | PASS |
| F5 | Prisma's view of the vector indexes matches the database | it did not: `@@index([embedding])` would have renamed the HNSW indexes back to the IVFFlat names on the next `migrate dev`, and that migration's own `DROP INDEX … _embedding_idx` would then have dropped them, silently unindexing vector search | **FIXED** names pinned with `map:` in `prisma/schema.prisma`; drift now clean |
| F6 | Dropping the one-active-document index is restorable | the `CREATE UNIQUE INDEX` in `20260702110000` restores it; re-uploads still deduplicated by checksum and version | PASS |

## G. What the data actually says (dev snapshot)

| # | Measure | Value |
|---|---|---|
| G1 | Deadlines | 11,990 stage rows over 9,497 calls; `close_date` = `final_deadline_at` on every row |
| G2 | Money | 7,593 calls with a currency, 7,592 with amounts, **0** missing a USD estimate, **0** currencies without a stored rate (61 rates, latest 2026-10-15) |
| G3 | Eligibility | 5,087 "any citizenship, residence in listed countries"; 2,807 open to any; 1,412 regional; **0** regions with an empty member list; **0** explicit exclusions today (B7 covers them when they appear) |
| G4 | Classification | all 10,031 mapped into the 49-area discipline catalogue; 0 with empty disciplines |
| G5 | Lifecycle | 7,543 CLOSED · 1,712 OPEN · 572 ROLLING · 200 FORTHCOMING · 4 UNKNOWN — of the 8,356 released, **2,095 are open today**, so discovery gains ~2.1k live calls, not 8.4k |
| G6 | Funders | 1,813 (Horizon Europe 501 calls, NIH 330, CDMRP 156) |
| G7 | Review queue | 4,718 open items, **1,454 of them blocking** (428 likely + 1,026 possible duplicates), 12 readiness failures, 48 unparsed amounts, 4 source-unavailable, 4 enrichment reviews |
| G8 | Attribution | `funding_source_registry` row present: ScientifyResearch, FULL_TEXT, basis `informal-permission-unverified` |

## H. Enrichment (official guidelines)

| # | Must be true | Verified | |
|---|---|---|---|
| H1 | Polite fetching | robots.txt honoured, one request per funder host every 6 s, 20 s timeout, HTTPS only, SSRF-guarded | PASS |
| H2 | Only this call's own documents | same registrable host, PDF/DOCX only, call-looking link text, footer/nav/legal and corporate reports excluded, ≤4 per call | PASS |
| H3 | A failed gate keeps nothing | documents, guidelines and the extraction run created by the attempt are deleted and the call stays LITE with an `ENRICHMENT_REVIEW` item | PASS |
| H4 | A re-import cannot overwrite official text | description owned by `official_page` in `field_provenance` | PASS |
| H5 | Cost is the platform's, per run, reversible | logged to the PLATFORM tenant, cost report per run, `--rollback <runId>` | PASS |
| H6 | Only released, GLOBAL_CATALOG, LITE calls are written | re-checked after the fetch, before the write | PASS |
| H7 | The cost projection | the first dev sample (USD 0.0044/call) ran while a unique index rejected every linked PDF, so it measured page text only | OPEN — re-sample before the full batch |

## I. Authorisation

| # | Must be true | Verified | |
|---|---|---|---|
| I1 | Import review: read = funding read operator, resolve = operator/publisher, release = publisher | route guards | PASS |
| I2 | Regional settings: tenant owner/admin for their own; full SUPER_ADMIN for another tenant's (viewers read-only) | `requireTenantRole`, `requirePlatformScope` | PASS |
| I3 | Match width: tenant admin roles only | `requireTenantRoles(TENANT_ADMIN_ROLES)` | PASS |
| I4 | Funder typeahead leaks nothing | counts only calls the caller can see, ILIKE wildcards escaped, ids regex-checked, ≤15 results | PASS |

## J. Performance (dev, 10,031 calls)

Visible-call count 63 ms · facets (12 dimensions) 58 ms · text match 53 ms ·
browse page 47 ms · filtered vector top-60 52 ms. Country filters cost ~140 ms
more than before because exclusions are now evaluated per row (B7).

## K. Open decisions — not code defects

1. **The catalogue decays without a re-import cadence.** 7,543 of 10,031 calls
   were already closed when imported, and a source closing a call only reaches
   us on the next import. Nothing schedules one yet.
2. **The production scheduler has never run.** Starting it also starts alert,
   reminder and monitor jobs; the 6 curated calls that carry no alert stamp
   would all dispatch at once. Decide separately from this release (the
   inventory step lists them).
3. **Full enrichment cost is still unmeasured** (H7).
4. **Alert fan-out spend.** A global curated call now runs one embedding +
   rerank search per entitled tenant instead of one platform-wide search.
   Expect reranker spend per call to scale with the number of paying tenants.
5. **The embedding provider must match.** All 8,356 dev vectors are in
   `embedding_voyage_1024` and none in `embedding`. If production resolves a
   different provider, the catalogue embeds into the other column and simply
   never appears in semantic search — `embed-catalog-calls.ts --dry-run`
   prints provider, model and column; check it before the batch.
6. **Legacy dead code.** `fundingCallsService.searchFundingCalls` filters
   published + active with no visibility test. Its only entry point gates
   access first and `fallbackSearchService` has no callers, so nothing reaches
   it today; it should not be revived as-is.
