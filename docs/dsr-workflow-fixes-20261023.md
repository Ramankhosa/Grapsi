# DSR workflow and reporting fixes

Implemented following `dsr-workflow-reporting-audit-20261023.md`. Production has not been changed by this work. Apply the additive migration before deploying the new application code.

## Resulting behavior

| Area | Correction |
|---|---|
| Officer notices | Private calls are fenced to their own tenant at both responsibility lookup and delivery. Notices follow stored mappings, valid transfers and available primary/deputy coverage. Promotion previews use the same mapping planner. |
| Delivery reliability | Publication transactionally queues routing. A leased worker classifies, maps, then notifies; mapping failures cannot proceed to notification. Failed/stuck jobs are retried by the existing reminder sweep. Notice claims and inbox writes are atomic and idempotent. |
| Routing recovery | Heads see pending/running/failed jobs and can retry them in the Mapping register. The call’s Schools panel also offers “Retry school mapping,” including for older calls without a job. Existing ended mappings remain ended. |
| Full backlog | Pendency includes mapped responsibilities even with zero faculty matches and retains allocated work awaiting submission. Independent drafts do not count as successful handling. A checkbox preserves the narrower matched/unallocated view. |
| Missed deadlines | Entry deadline facts are evaluated at closing. Late allocations, submissions and completion marks do not erase an earlier miss. A later change from “work recorded” to a closure outcome cannot backdate closure: historical completion events determine the deadline outcome. |
| Historical ownership | Missed records use dated transfers/coverage history. A retired owner remains drillable by recorded user ID. Missing historical ownership remains unassigned rather than being automatically blamed on today’s replacement. Open work follows available operational coverage. |
| Matching | Incoming and Pendency receive the tenant’s match width. Management counts use the same score/active-faculty predicate as the call window. Last successful matches remain visible while refresh runs; the five-minute routing gate is removed. Missing school projections no longer produce a misleading complete refresh timestamp. |
| Imported dates | Shared entry-deadline rules handle LOI/entry vs final dates, funder timezone and explicit source closure. Incoming, Pendency, Register, legacy ledgers, allocation options and allocation writes use the effective dates. Internal proposal deadlines remain separate. |
| Overview drill-down | “Missed” includes both missed categories and preserves the school row’s period. Overdue-review and closing-unallocated counts share their exact predicates with register rows and exports. Unique calls and school responsibilities remain explicitly separate units. |
| Member work | Personal contribution counts include distinct calls with recorded activity, allocations made and submissions recorded. Owned school workload remains separately labeled. Legacy efficiency calculations include untouched mappings, count allocation/action creation as first touch and avoid crediting deputies with primary ownership totals. |
| Older call funnel | Alert recipients and allocations are tenant- and unit-scoped. The UI calls historical alerts “Alert recipients.” Local unassigned calls are no longer suppressed by another institution’s allocation. School filters also reach detail lists, with stale school-detail responses discarded. |
| Allocation guards | Both automatic-match and manual requests require an ACTIVE recipient. A closed entry stage is rejected server-side, even if the final application date is later. |
| Completion | The member must provide an explanation and choose an outcome. “Work recorded” does not itself close an outstanding application; explicit reasoned no-allocation closures are separate. |

## Validation

Final results: **203 tests passed across 24 targeted suites**; the read-only PostgreSQL fixtures, desktop/mobile browser fixtures, release type check, optimized production build and Prisma schema validation passed. Full lint completed with existing repository warnings; the changed workflow files passed targeted lint without warnings. No production migration, deployment, model request or real notification was performed.

- Targeted tests cover existing report/access rules plus private/global notices, deduplication, routing failures/leases, member scope, historical owner drill-down, individual contributions and allocation write guards.
- `scripts/verify-dsr-workflow-readonly.ts` evaluates the actual Register and Pendency SQL in a READ ONLY transaction. CTE fixtures shadow every operational table: no real records or notifications are written.
- SQL cases cover zero matches, untouched work, allocated/no submission, independent drafts, late submissions, late closure edits, on-time closure/submission, imported LOI/source closure, inactive/foreign calls, global calls retaining an originating tenant, WIDE matching, transfer ownership, replacement of a historical owner, deputy leave cover and both missed categories.
- `scripts/verify-dsr-workflow-ui.cjs` uses only intercepted synthetic APIs against a local preview. It checks overview filters, historical member drill-down, reasoned completion, routing retry and mobile layout.
- Final check results and local screenshots are recorded in `outputs/dsr-workflow/`.
- The local validation build is `1z6aJskgAqbiHckQ-XHHM`. Its dependency junction uses a validation-only Prisma wrapper resolving to the shared physical client, avoiding duplicate TypeScript module identities on Windows. This temporary checkout is not a deployable Linux release bundle.

## Release requirements

1. Deploy migration `20261023110000_dsr_workflow_reliability` before application activation. It adds completion outcomes, routing jobs, notification-delivery claims, an ownership-history index and the publication queue trigger. Legacy officer notices are copied into delivery claims; this sends no messages.
2. Regenerate the Prisma client as part of the normal schema release. Routing/report tables use raw SQL like the existing DSR supplemental tables.
3. Build and activate the application. Keep the existing authenticated reminder sweep scheduled: it now also processes a bounded routing batch. The ordinary publish path starts its queued job immediately; the sweep recovers failures/process exits. After eight failed attempts a head must explicitly retry.
4. Review older unclassified/unmapped calls in the Mapping register and retry school mapping from the call page where appropriate. Migration deliberately does not enqueue or notify the entire historical catalogue.

## Interpretation and retained limits

- Pending/missed totals can increase because omitted responsibilities now appear. This is expected, not new missed work created by the change.
- “Calls worked on” is distinct calls with recorded individual activity during the selected period. Owned school workload and faculty allocations are different measures. The Pendency member table supplies deadline-based missed ownership; the Member performance school workload describes the currently owned portfolio.
- Historical reconstruction can only use recorded dates/history. Unknown dates, missing old ownership history, and legacy completion marks without a specific closure outcome are not invented or silently credited as successful handling. Legacy records may need evidence-based review.
- Reasoned no-allocation closures remain an auditable coordinator decision; this release does not introduce an additional approval role or automatic eligibility confirmation.
- School mapping remains add-only. A head must end obsolete mappings explicitly, preserving the decision and reason.
- The original release validation excluded unrelated local drafts. During the 31 October commit review, the incompatible research-area classifier draft was archived and the existing compatible implementation retained. Root-checkout type checking now passes. See `uncommitted-work-review-20261031.md` for current validation and artifact locations.
