# DSR reporting and funding workspace improvements

Implemented locally on 31 October 2026 following the DSR reporting audit and the request to modernize Funding Discovery and Funding Intelligence. No production deployment, schema migration, real notification, or working-record update was performed during this implementation.

## Resulting experience

- A shared funding navigation and visual treatment connects Discovery, Intelligence, idea analysis and the DSR workspace. Light surfaces, comfortable typography, consistent actions and restrained status colors replace the dark hero panels and compact dashboard styling on these views.
- Discovery shows opportunity actions without requiring expansion. Cards surface funding, entry deadlines, geography and urgency; grid/list controls support comparison. Mobile filters use an accessible drawer and the mobile header is compact.
- Intelligence places search and research results ahead of analysis history. Selected filters are removable, long facet lists are searchable, sorting is available on mobile, and overlapping requests cannot overwrite newer results. Filter selection updates immediately while URL state catches up.
- Patent search, project evidence, new idea analysis and the analysis workspace share the same navigation and visual direction. Research relevance is labeled as a relative score rather than an eligibility or funding-success estimate. Copy describes potential gaps in the available evidence instead of promising that an idea is globally unfunded.

## DSR controls and accountability

| Audit issue | Implemented behavior |
| --- | --- |
| Future/invalid submission dates | Server validation covers creation of a submission claim and later date-only edits. Contact-log submission recording validates before starting its transaction. |
| Unexplained cancellation | A reason is required server-side. The cancellation and explanation are written in one transaction. |
| Reopening inactive or closed work | Reactivation checks active faculty, canonical call availability and effective entry closure. A confirmed extension must be recorded before reopening a closed call. |
| Claimed versus verified submissions | The daily allocation report shows claims, attached current evidence and verified evidence distinctly. The current-month total also shows how many were verified. Heads/admins have an evidence-review action and an awaiting-verification filter. |
| Backdated claims clearing missed deadlines | A late-entered change to the submission date cannot clear the deadline miss unless that date was already recorded before closing or the current evidence has been reviewed. Legacy baselines without change history retain their previous interpretation. |
| Stale verification | SQL report readers compare verification against the same fingerprint as the application: submission date, reference, URL and sorted current document IDs. Editing evidence invalidates its previous verification without erasing the audit history. |
| Internal notes masking no-contact work | Faculty contact alerts use calls, emails and meetings addressed to faculty. Administrative entries and reminders retain their activity counts but do not clear contact alerts. |
| Historical workload moving to a replacement | Past follow-up weeks use recorded ownership at week end. Current-week work follows operational coverage. Activity remains credited to its author. Missing ownership history remains unassigned. |

## Reporting and workflow

- Report data is tied to the request that produced it. Failed scope changes remove the previous actionable rows and provide Retry.
- Reports refresh on return to the page and expose a visible timestamp and Refresh action.
- Scoped report snapshots hold the record set for pagination and export, with a 15-minute lifetime. Snapshot reads repeat current access checks and bind the snapshot to the tenant, viewer, scope and filters. An expired or changed-scope snapshot requires refresh.
- Exports carry the actual reporting basis, period where applicable, timezone, as-of timestamp and snapshot ID. Duplicate export requests are blocked while a file is being prepared.
- Hub pagination and filters persist in the URL. Management views, their filters and the call-register page also persist. Users can save up to ten named report views in their own browser storage, scoped to their account and institution.
- Follow-up logs have independent pagination and links back to allocations. The application no longer requires an export to inspect entry 51.
- Pendency exposes next action, task owner, due date, waiting party, blocker and time in the current action/review stage. Stage filters include review, allocation, submission and missing next action. Actions depend on the work remaining: allocated work leads to follow-up/submission, unowned work to coverage, and unallocated work to review/allocation.
- A recorded DSR review is labeled separately from application progress. Outstanding application work remains visible beside a recorded review. Active and closed allocation links open their respective record sets.
- Allocation dialogs and mobile filter drawers use a focus-managed dialog primitive. DSR and Finder tabs support arrow keys, Home/End and associated panels. Detailed DSR allocation and pendency tables become labeled records on mobile; filters collapse to preserve working space.

## Validation

Final checks passed: **2,336 application tests across 288 files**, **43 native worker tests**, full TypeScript checking, targeted lint, read-only SQL fixtures, both browser verification flows, and the optimized production build. The native worker CJS tests were run with Node’s test runner and excluded from the Vitest invocation. Browser verification also passed against the optimized build.

Validation results and synthetic desktop/mobile screenshots are stored in `outputs/funding-workspace-20261031/`. The browser verifier intercepts every API request; its names, calls, amounts and activity are synthetic.

- Unit regressions: `src/lib/fundingDept/__tests__/reporting-integrity.test.ts` and `hub-snapshots.test.ts`, plus existing DSR, allocation and Finder tests.
- Database behavior: `scripts/verify-dsr-workflow-readonly.ts` executes the real report SQL in a read-only transaction with synthetic table-shadowing fixtures. It covers unverified backdating, reviewed corrections and fingerprint parity, including Unicode references and sorted proof documents.
- Browser behavior: `scripts/verify-funding-workspace-ui.cjs` covers Discovery, Intelligence, idea/patent entry points and the DSR hub; it checks mobile layout, filter dialogs/focus, selected filters, state-specific actions, stale-data protection, saved views, verification, drill-down context and keyboard tabs.
- The older DSR browser verifier retains the overview/register reconciliation and routing-retry checks, with its review-outcome controls updated to the new wording.

## Rollout and interpretation

This change adds no database migration. It relies on the existing DSR management/reporting tables and the previously required `20261023110000_dsr_workflow_reliability` migration. Deploy using the normal application release process; the existing routing/reminder sweep requirements remain unchanged.

Newly protected reports can retain a missed item while its late-entered claim awaits evidence review. This is expected. A verified correction updates the interpreted outcome while the original application events and verification event remain inspectable.

Historical reconstruction remains limited by recorded ownership and activity history. Old, unrecorded changes and leave-cover history cannot be invented. Date-only deadlines retain their stated calendar date; call-entry rules continue to use the funder's recorded timezone where present.

Snapshots materialize the scoped report on the initial request, then reuse it for subsequent pages and exports. The follow-up contact aggregation no longer repeatedly scans all entries for each allocation. Production-scale latency and very large 26-week portfolios still require measurement; no production performance improvement is claimed from the synthetic checks.
