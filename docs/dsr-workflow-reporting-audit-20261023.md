# DSR incoming calls, allocation and accountability review

Reviewed 23 October 2026 against local HEAD `5352094e65988a237a8cfbe9136f3cec0964d00a` (the release deployed earlier today). This is a source and behavior audit, not a reconciliation of live institution counts. All numerical examples below are illustrative. Application code and production data were not changed during this review.

## How calls currently reach DSR

1. An intake/import job produces or links a funding call. An arrival event is not necessarily a newly created call: duplicates and failed extraction attempts are separate intake events.
2. Ordinary publication starts background research-area classification, school mapping and officer notification. The department mapper reads effective research-area data and the school’s whole active subtree, including department areas and keywords.
3. School mapping records a dated `(tenant, call, school)` responsibility. Exact area matches and matching discipline keywords qualify; a broad discipline match qualifies only when `mapBroadTier` is enabled. An unclassified call normally reaches only its origin school and otherwise needs head review. Schools without an area/keyword profile receive no automatic mapping. Re-running is add-only: it preserves history and does not automatically end obsolete mappings.
4. Bulk catalogue import intentionally stops at `GLOBAL_CATALOG`: these entries do not automatically become DSR work or generate officer notices. A curator must promote a call to `GLOBAL_PUBLISHED`; promotion creates school mappings and can notify officers. This is separate from enriching its guidelines/templates for proposal review.
5. Faculty matching is a separate background census. A school responsibility can exist with zero matched faculty. A match is a suggestion, not a formal allocation.
6. An authorized assigner creates a formal faculty allocation. The endpoint checks tenant membership and the assigner’s organizational reach, records who assigned it and the faculty’s organizational unit, and supports a justified manual allocation. Manual allocation creates/reopens a school mapping and is excluded from automatic-match counts.
7. Review, candidate selection, allocation, follow-ups, named actions, submission and the coordinator’s manual completion mark are separate facts. In Incoming Calls, only the manual mark produces “Action completed”; any recorded human activity produces “In progress.” A multi-school call rolls up to its least advanced school.

Relevant implementation: `src/lib/services/fundingCatalogService.ts:929`, `src/lib/fundingDept/callSchoolMapping.ts:1`, `src/lib/fundingCatalogImport/promote.ts:365`, `src/app/api/assignments/route.ts:152`, `src/lib/fundingDept/reportDefinitions.ts:254`.

## What the different screens actually count

| Screen/service | Unit and purpose | Important limit |
|---|---|---|
| DSR Reports → Incoming Calls | Unique calls, grouping mapped school responsibilities and current qualifying faculty matches | Open calls by default; member and width discrepancies below |
| DSR Reports → Assigned Calls | Formal allocations to faculty | One call can have several allocations; this is not a count of unique calls |
| DSR Reports → Pendency | Call-school pairs with direct qualifying faculty matches and no taken-up allocation/independent application | Not the complete department backlog or all missed calls |
| Opportunity management → Overview / Call Register | Stored school responsibilities, review state, allocations and submissions | Strongest current base for the complete mapped-call backlog; deadline and drill-down problems below still apply |
| Opportunity management → My Actions | Outstanding operational actions | Routing settings and ownership/leave rules affect inclusion |
| Opportunity management → Member performance | Owned workload plus separately attributed contributions | Ownership totals do not mean that member personally performed every action |
| Intake arrival report (`incomingReport.ts`) | Import/upload events, including repeats and extraction failures | These totals should not equal unique calls or school responsibilities; legacy Incoming UI redirects to the register |
| Older Calls funnel | Alert-recipient and allocation aggregates | Its “matched” count is not the current faculty census |

For example, one call imported twice, mapped to three schools and assigned to four faculty can legitimately mean **2 arrivals, 1 unique call, 3 responsibilities and 4 allocations**. Different units need labels and reconciled drill-downs, not forced equal totals.

## Confirmed findings and recommended fixes

### 1. High: private-call officer notifications lack a tenant fence

`newCallNoticeService.ts:113–179` loads a call without selecting its tenant and calls `coveredSchoolsForCall(call.id)` without tenant restrictions. Coverage therefore spans institutions. The relevance SQL at lines 99–102 checks call ID and research relevance, without call visibility or tenant access. The resulting notification includes the private call’s title, agency and deadline.

**Example:** a private call belonging to institution A matches a biotech school in institution B. B’s officer can receive the title/details even if the call page later denies access.

**Validation:** a mock-only test exercised the real notification service with a private A call and B coverage. It attempted a notification to B, and the captured queries contained no tenant/visibility fence. No live notifications were sent; this is not evidence that a production disclosure has occurred.

**Fix:** select call ownership, constrain private-call coverage to that tenant, and enforce shared visibility inside the relevance query. Preview and sending must use the same authorized mapped responsibilities. Add private/global/suppressed-call tests.

### 2. High: older Call funnel aggregates alert counts across tenants

`src/app/api/funding-dept/calls/route.ts:247–274` aggregates `funding_call_alerts` by call IDs without joining recipients to the current tenant. The assignment aggregate immediately below is tenant-scoped. The detail route correctly scopes alerts through the recipient’s tenant, so summary and detail can disagree.

**Example:** a global call has 8 alert recipients in this institution and 30 elsewhere. The local summary can say 38 “matched” while its local detail contains 8. A school filter also does not restrict the alert-recipient aggregate to that school.

**Fix:** tenant- and school-scope the recipient query. Label historical recipients as “Alert recipients”; obtain “Matched faculty” from the shared current census. Test a global call shared by two tenants and two schools.

### 3. High for accountability: Pendency does not cover all unhandled or missed calls

`pendencyReport.ts:67–95` starts exclusively from automatic faculty-match rows. `reportDefinitions.ts:297` excludes pairs with zero qualifying matches, any taken-up allocation, any independent application or a recorded dismissal.

**Examples:**

- A call mapped to Biotech but never reviewed and with no qualifying match is absent.
- A call allocated to a faculty member but never submitted is absent, even after its deadline.
- An independent draft application suppresses the row: its status/submission is not checked by the independent-application subquery.

These exclusions are explicit design choices for a *matched, unallocated* report. The gap is using its “Missed” number as a complete department/member performance measure.

**Fix:** make the stored call-school responsibility the complete workload denominator. Show separate queues for not reviewed, reviewed but unallocated, no owner, matching incomplete/no matches, allocated but not submitted, and valid closure. Retain the narrower matched-unallocated view as a clearly named subset. A draft/withdrawn independent application must not imply successful handling.

### 4. High: matching counts differ by screen and can disappear after five minutes

The call’s Schools and Dossier endpoints load the tenant’s configured match width. The Reports hub builder (`hubHandler.ts:35–42`) does not pass it to Incoming, which defaults to NARROW (`incomingCalls.ts:66`). Pendency also explicitly uses the default width (`pendencyReport.ts:95`).

The older management reader uses stored `match_tier` and only schools with a fresh projection (`managementService.ts:121–122`). `currentMatches.ts:23–40` makes that projection stale after five minutes and queues a refresh. Incoming retains current matches and queues refresh after six hours (`incomingCalls.ts:191–200`); the census freshness window is also six hours. The older reader lacks the shared active-faculty predicate.

**Example:** with WIDE configured, a score of 0.40 counts in a call’s faculty list but not in Incoming/Pendency. Existing management matches can disappear on the first read after five minutes while refresh is pending.

**Validation:** pure behavior checks confirmed 0.40 qualifies at WIDE and fails at the default NARROW width.

**Fix:** pass one tenant width and use the shared score/active-faculty predicate everywhere. Preserve the last successful census during refresh, with an explicit age/completeness indicator. Freshness must not turn a known result into zero.

### 5. High for imported calls: work queues and reports use different deadlines

`callSql.ts:56–86` knows imported calls’ entry/LOI deadline, final deadline, source-closed marker and funder timezone. Incoming uses that helper to determine whether a call is open, but displays and calculates urgency from legacy `close_date/deadlineAt` (`incomingCalls.ts:68–86`). Pendency (`pendencyReport.ts:63`) and the Call Register (`callRegister.ts:66`) also use the legacy deadline for missed/closing-soon status.

**Example:** required LOI entry closes 1 November, final application closes 1 December. The call can stop appearing in the open queue after 1 November while a reporting screen still treats it as having a month remaining. A source-closed call with no legacy date can remain “no deadline.” Exact impact depends on the imported values populated for the call.

**Fix:** use one effective entry deadline, source-closed state and timezone for inclusion, display, urgency, allocation options and exports. Show subsequent stage deadlines separately. Test LOI/final dates, no legacy date, date-only values and funder timezones.

### 6. Medium/high: overview numbers do not open the records they count

Three concrete mismatches in `RegisterViews.tsx`:

- School “Missed”: the server counts both missed states (`callRegister.ts:264`), but the click filters only `MISSED_NEVER_ALLOCATED` and switches from the selected period to all time (`RegisterViews.tsx:122`).
- “Closing soon, not allocated”: the total requires a not-reviewed/reviewed-unallocated state (`callRegister.ts:251`), but the click passes only `CLOSING_SOON` (`RegisterViews.tsx:90`), allowing already allocated calls into the detail list.
- “Reviews overdue”: the total applies the untouched-age threshold (`callRegister.ts:254`), but the click passes only `NOT_REVIEWED` (`RegisterViews.tsx:89`), including newly mapped reviews that are not overdue.

**Example:** 3 unallocated misses plus 2 allocated-but-unsubmitted misses produces a school total of 5; clicking can show only 3 in that period, or unrelated older rows after the all-time switch.

**Fix:** use named shared filter predicates for the aggregate, list and export, preserve the cohort/time period, and distinguish unique calls from responsibility rows. Test every clickable headline against its detail IDs.

### 7. Medium/high: member filtering and operational ownership disagree

`hubScope.ts:67–80` narrows a selected member to their primary schools. Incoming and Assigned use this school list (`hubHandler.ts:38,47`), while Pendency deliberately uses the wider accessible school list and the per-call coordinator (`hubHandler.ts:70–73`). Follow-ups uses yet another, contribution-based, member filter.

**Example:** member A is Biotech’s primary coordinator, but a call is transferred to member B who has school coverage. Pendency attributes it to B; Incoming filtered to A still includes it, while B’s Incoming filter can omit it when B is not the primary. An Assigned “member” filter represents school portfolio, not necessarily who made the allocation.

Leave handling also differs: the management report selects available deputy cover, coordinator SQL falls back to the active primary without checking leave, and notification routing selects a deputy without checking the deputy’s leave.

**Fix:** distinguish accountable school owner, current operational call owner and performed-by actor in labels and filters. Share transfer/leave/coverage resolution across queues, notices and reports. Offer separate member filters for “Responsible for” and “Work performed by.” Historical performance should use dated ownership, not silently reassign old missed work to today’s coordinator.

### 8. Medium: a late manual closure can improve a historical missed total

`reportDefinitions.ts:299` returns `COMPLETED_NO_ALLOCATION` before evaluating an expired deadline. Default Pendency totals exclude that completed state. The action-status endpoint allows a completion mark with an optional note (`src/app/api/funding-dept/calls/[callId]/action-status/route.ts:27–31`), including after the deadline. The change is audited, but the current missed number changes.

**Example:** an unallocated matched call was missed yesterday; today its coordinator marks “Action completed” without an explanation. It leaves the default missed total despite no allocation or submission.

**Fix:** require a closure outcome and reason for no-allocation completion; define which outcomes need head review. Preserve “state at deadline” separately from current resolution. Existing event history and report snapshots help trace changes but are not a permanent deadline-performance metric.

### 9. Medium: publication-to-school routing is not durable and notices can disagree with mapping

The ordinary publish path starts an unawaited in-process classification/mapping/notice task (`fundingCatalogService.ts:929–950`). Errors are logged; there is no durable delivery/retry state in that chain. Mapping errors are caught and the officer-notice step can still continue. Classification also invokes quiet mapping, so the chain has overlapping triggers.

Notices independently calculate relevance with broad matching enabled by default (`newCallNoticeService.ts:102`, `callUnitRelevance.ts:144–148`), while stored mapping defaults broad matching off (`settings.ts:96`). Notices are not derived from the actual mapping register or the per-call transferred owner.

**Example:** an officer gets a broad-area notice but the call has no corresponding stored school mapping, or a published call loses its routing task during a process restart. A published/processed flag does not establish that routing succeeded.

**Fix:** use a durable, idempotent classify → map → notify job/outbox, with visible failed/awaiting-routing states and retry controls. Notify the resolved operational owner of the actual authorized responsibility. Reconcile unpublished/unmapped and newly changed school profiles explicitly, preserving ended mapping history.

### 10. Medium: visibility and allocation enforcement need consolidation

The raw report predicate (`callSql.ts:30–36`) omits `is_active` and differs from the canonical call visibility reader. A deactivated call can remain in raw-SQL reports while its canonical detail endpoint rejects access. Private-draft/release lifecycle predicates should also be kept aligned.

The allocation POST (`src/app/api/assignments/route.ts:172–196`) enforces ACTIVE faculty only for manual allocations and does not check the call’s closing state. The newer search UI hides inactive candidates, but stale/direct allocation requests still need server enforcement. Backdated/late administrative allocations may be legitimate; their reason and effect on accountability need an explicit policy.

**Fix:** share the canonical visibility/active predicate in SQL and ORM readers. Validate ACTIVE recipients on every allocation method. Check effective call closure server-side; support an explicit audited late-allocation exception if required, preserving the missed-at-deadline record.

## Additional legacy reporting concern

`efficiencyService.ts:155–218` defines “arrived” calls only through pre-existing triage, follow-up or assignment records, not the stored mapping ledger. A mapped call never touched or escalated can be absent from its denominator. Its first-touch calculation omits assignment creation, so assignment-only work can still appear never touched. It dates arrival from call publication/creation rather than school mapping. Its per-member rollup credits school totals to everyone with coverage reach, including deputies, rather than measuring each actor’s work.

The efficiency API and component remain in the codebase, but I found no current import mounting `EfficiencyTab`; treat this as an existing endpoint/legacy-screen risk rather than evidence that the main Member performance screen uses this calculation. Retire it or rebuild it on the shared responsibility and activity ledger before reusing it.

## What is already sound

- Stored mappings preserve mapping reasons, dates and end-history; this is the right foundation for complete responsibility tracking.
- Manual faculty allocations are explicitly distinguished from automatic match evidence.
- Allocation permission checks include tenant and organizational reach.
- Proposal submission through the normal proposal lifecycle synchronizes the linked assignment via the shared submission helper (`src/lib/proposals/statusService.ts:155` onward). Different reader predicates are a maintenance risk, but I did **not** find that a normal linked proposal submission necessarily leaves the assignment unsubmitted.
- The Call Register already distinguishes “Missed, never allocated” from “Missed, allocated but not submitted.” This should become the shared definition for the other screens, with imported-deadline corrections.
- Ownership and performed-by contributions are partly separated already. That distinction should remain explicit rather than collapsing everything into a single “worked” count.

## How to see the backlog today

Use **Opportunity management & accountability → Call Register**, select **All periods** and the relevant school/member scope:

- **Not reviewed**: mapped responsibilities awaiting a recorded review.
- **Reviewed, allocation pending** or **No allocation**: the unallocated queue, with different review stages.
- **Missed, never allocated** and **Missed, allocated but not submitted**: inspect both separately.
- **Mapping register / school coverage**: responsibilities with no coordinator and unclassified/unmapped routing gaps.
- **Member performance**: compare owned workload with the separate performed-action/contact measures; do not read a school’s total as personal work.

DSR Reports → Incoming Calls → **Not started** is useful for day-to-day open calls. Include expired calls when reviewing older work. Pendency remains useful for its narrower matched-but-unallocated subset. Until the drill-down bugs are fixed, set the desired filters directly rather than assuming every headline click preserves its exact definition.

## Recommended implementation order

1. Close notification/alert tenant-isolation gaps and add cross-tenant regression tests.
2. Align effective deadlines, active visibility, match width and last-good census reads.
3. Reconcile every overview/detail/export filter and use one responsibility-based workload denominator.
4. Unify operational ownership, transfer/leave routing and actor-based contribution filters.
5. Introduce reasoned closure, permanent state-at-deadline metrics and durable routing retries.
6. Consolidate the two reporting experiences around the Call Register. Keep clear, separate counts for unique calls, school responsibilities, faculty allocations, submissions and actions.

## Validation performed

Eight selected test files passed: **90 tests**, including 7 temporary mock/pure characterization probes. The probes reproduced private-call notice fan-out, the Pendency exclusion rules, post-deadline completion reclassification, width inconsistency and canonical submission recognition. Existing suites covered report definitions/routes/snapshots, responsibility, hub definitions, manual-allocation mappings and accountability access clamps.

No real database mutation, model call, email, notification, deployment or application-code change was performed for this audit. The temporary characterization test was removed after recording its results. Live counts and whether a tenant has enabled optional routing/WIDE matching were not measured; setting-dependent findings are conditional as described above.
