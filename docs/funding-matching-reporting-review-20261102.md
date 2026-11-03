# Funding recommendations, researcher matching and reporting review

Reviewed 2 November 2026 against local commit `d8806d6`. This review covers the current source and isolated behavior checks. It does not measure the frequency or accuracy of matches in production. Application code and user records were not changed; no alerts were sent and no paid models were called.

## Assessment

There are **four high-priority issues and five medium-priority issues** to address. The main remaining risk is that incomplete or differently scored evidence can become an authoritative-looking recommendation, count or “no suitable researcher” conclusion.

Several problems recorded in the 23 October audits have since been fixed. Publication/saved-interest evidence now reaches the researcher reranker; inactive users are excluded at retrieval; the main hub passes tenant match width; Pendency includes mapped calls with zero matches and allocated work; and ordinary publication has a durable routing worker. Earlier findings should not be copied forward without checking their current implementation.

## Current paths

| Surface | How it finds or counts relevance | Consequence |
|---|---|---|
| Finder/chat recommendations | Call vector and text retrieval, call reranking, weighted scoring and optional profile context | Scores are separate from researcher census scores. |
| Funding in my areas | Stored researcher/call vectors and phrase search; relative tiers | A “strong” suggestion here does not establish the same band in a department report. |
| Researcher search and alerts | Profile, saved-interest, publication and profile-text candidates; bounded reranking | Alerts receive a bounded search result, not the full census. |
| School mapping | Accepted call areas versus configured school/department areas and keywords; dated stored responsibilities | A school responsibility can legitimately exist with zero matched faculty. |
| Department reports and dossier | Stored call-to-people census, numeric score bands and shared count predicates | Consistency between these readers is improved, but still depends on census health and coverage. |

## Findings, in priority order

### 1. P1 — A retrieval outage can retire valid matches and save a fresh zero

**Evidence:** [researcher retrieval](C:/Users/raman/Documents/Grapsi/src/lib/services/researcherSearchService.ts:1048), [census replacement](C:/Users/raman/Documents/Grapsi/src/lib/fundingDept/callMatchCensus.ts:180).

Vector-query failures are collected with `Promise.allSettled`; a failed text query becomes an empty array. If all retrieval branches fail, the service returns an ordinary empty response. The census does not reject degraded or incomplete retrieval: it marks prior automatic matches non-current and saves a successful zero-result state. Partial failures can silently reduce counts too.

**Impact:** a temporary index/database/provider problem can remove faculty from reports and school discovery, even though the research evidence has not changed. The fresh state can then be reused by the cache described in finding 4.

**Validation:** synthetic probes reproduced both the all-branches-failed empty response and the subsequent retirement/state-write statements. No real database was used.

**Correction:** return branch health separately from hits. Preserve the last successful census on failed/incomplete retrieval; record pending/error state and retry. A successful zero must be distinguishable from a failed search.

### 2. P1 — Finder’s final scorer cannot downgrade a false positive

**Evidence:** [call reranking](C:/Users/raman/Documents/Grapsi/src/lib/services/recommendationSearchService.ts:2650), [weighted scoring](C:/Users/raman/Documents/Grapsi/src/lib/services/recommendationSearchService.ts:1452).

Finder replaces semantic similarity with `max(original similarity, reranker score)`. The two values represent different scoring stages and are not interchangeable. A poor call with a high first-stage similarity keeps that value even when the reranker rejects its relevance. Subsequent scoring uses the retained value.

**Example reproduced:** a candidate with vector similarity **0.90**, judged **0.01** by the reranker, retains **0.90**. A relevant candidate starting at **0.50**, judged **0.80**, receives **0.80**. With the other inputs equal, the rejected candidate keeps the larger semantic contribution.

**Correction:** preserve retrieval and reranker scores as separate fields; use the calibrated final score when reranking succeeds. Define an explicit fallback policy for missing/partial scores, including singleton results.

### 3. P1 — Eligibility conflicts are not preserved through the main census/report flow

**Evidence:** [limited eligibility reader](C:/Users/raman/Documents/Grapsi/src/lib/services/researcherSearchService.ts:721), [advisory flags](C:/Users/raman/Documents/Grapsi/src/lib/services/researcherSearchService.ts:745), [stored census row](C:/Users/raman/Documents/Grapsi/src/lib/fundingDept/callMatchCensus.ts:140), [dossier projection](C:/Users/raman/Documents/Grapsi/src/app/api/funding-dept/calls/[callId]/dossier/route.ts:398).

Researcher search only checks career stage and institution type, as advisory conflicts when both sides state a value. The census row and dossier projection omit those flags. Geographic residence/citizenship/applicant/host constraints are not assessed in this census path. Strong topical matches can therefore enter school counts without a surviving eligibility warning.

Alerts use the separate geographic eligibility engine to exclude explicit geographic conflicts, but do not use the career/institution advisory flags to exclude recipients. The routing preview is more candid: it explicitly marks eligibility as requiring review. That protection is not consistently present in the ordinary stored-match flow.

**Impact:** the organisation can count or approach people whose recorded facts already conflict with the call. “Matched faculty” remains a topical count, not an eligible-applicant count.

**Correction:** retain separate topic relevance and eligibility assessment, with reasons and evaluation version. Display known conflicts and missing facts; distinguish topical matches from eligible candidates. Reuse the geographic engine where applicable and add the supported non-geographic checks. Unknown facts must remain “needs check.”

**Validation:** source trace through search, census, shared count predicate, alert filtering and dossier. This was not a production eligibility reconciliation.

### 4. P1 — Restoring or changing the reranker does not invalidate a cached census

**Evidence:** [cache shortcut](C:/Users/raman/Documents/Grapsi/src/lib/fundingDept/callMatchCensus.ts:110), [fingerprint inputs](C:/Users/raman/Documents/Grapsi/src/lib/fundingDept/callMatchFingerprint.ts:9), [pair-score hash](C:/Users/raman/Documents/Grapsi/src/lib/services/researcherSearchService.ts:655).

An identical fingerprint returns the stored census and only advances its refresh timestamp. This also happens when its basis is `vector`. The fingerprint includes embedding settings and thresholds, but does not include reranker model/configuration availability. The lower-level pair cache includes the reranker model, but the census shortcut prevents that cache from being reached.

**Impact:** a census produced without the reranker, or from an incomplete rerank response, can remain on fallback scores after recovery. Switching reranker model can leave old scores in place indefinitely until another fingerprint input changes. The six-hour sweep alone does not force rescoring.

**Validation:** a synthetic cached vector census bypassed search despite a configured reranker and received a new refresh timestamp.

**Correction:** include scoring model/configuration identity in the census key, give degraded results a bounded retry lifetime, and distinguish “last checked” from “last successfully scored.” Do not hash secret credential values.

### 5. P2 — “Strong match” still means different things across paths

**Evidence:** [relative fallback tiers](C:/Users/raman/Documents/Grapsi/src/lib/services/researcherSearchService.ts:607), [singleton bypass](C:/Users/raman/Documents/Grapsi/src/lib/services/researcherSearchService.ts:1000), [department bands](C:/Users/raman/Documents/Grapsi/src/lib/fundingDept/matchBands.ts:111), [My Areas tiers](C:/Users/raman/Documents/Grapsi/src/lib/funding/myAreasService.ts:502).

Live researcher search skips reranking when there is only one candidate; census mode scores that same singleton. Without reranking, search derives tiers relative to the best result. Reports instead apply absolute cutoffs to the stored raw score without checking its basis. My Areas has another relative tier calculation.

**Example reproduced:** the sole candidate with a retrieval score of **0.34** is “strong” in live search, “possible” under the default report width, and absent from the census when its reranker score is **0.02**.

**Correction:** score singletons too. Store the scoring basis/model with each pair and calibrate fallback separately, or label it provisional. Reuse final pair scores where identical labels are intended; otherwise explain the different meaning in the product.

### 6. P2 — Bounded or failed matching is presented as complete

**Evidence:** [candidate ceilings](C:/Users/raman/Documents/Grapsi/src/lib/services/researcherSearchService.ts:35), [failed-call handling](C:/Users/raman/Documents/Grapsi/src/lib/fundingDept/currentMatches.ts:86), [school completeness](C:/Users/raman/Documents/Grapsi/src/lib/fundingDept/currentMatches.ts:118), [no-match conclusion](C:/Users/raman/Documents/Grapsi/src/lib/fundingDept/managementService.ts:257).

The census takes at most 2,000 people per branch and merges at most 4,000. It has no truncation indicator or continuation. A refresh pass normally attempts at most 25 calls; failed calls are caught. The school projection’s `complete` value depends only on its unprofiled list, rather than completed call coverage. Management then uses that school flag to report `COMPLETE` and “no matching researcher” gaps for individual calls.

The readiness query also has narrower semantics than its name: it begins from existing profiles, ignores summary-only research text, and can treat an unembedded saved-interest/publication row as sufficient readiness.

**Validation:** one probe supplied 8,000 distinct branch candidates and received 4,000 without a truncation field. Another made a call fail and still received `{ complete: true }` for its school.

**Correction:** separate profile readiness, evidence-source coverage, call scoring status, staleness and retrieval truncation. Do not conclude “no suitable researcher” for an unscored, failed or truncated call. Use pagination/exhaustive evaluation for authoritative institutional totals, or label the totals as bounded.

### 7. P2 — My Areas pagination cannot reach all calls in its own total

**Evidence:** [per-source cap](C:/Users/raman/Documents/Grapsi/src/lib/funding/myAreasService.ts:310), [pagination and counts](C:/Users/raman/Documents/Grapsi/src/lib/funding/myAreasService.ts:547), [API offset](C:/Users/raman/Documents/Grapsi/src/app/api/funding/my-areas/route.ts:40).

Every page refetches the same top 120 calls per source, merges them, and applies the requested offset in memory. The independent count query has no such cap. `hasNextPage` checks only the already-capped merged list.

**Example reproduced:** 150 active matches from one source; the page at offset 108 contains 12 calls and says there is no next page. Offset 120 returns no calls. Thirty matches counted in the total are unreachable through pagination.

**Correction:** paginate the complete deduplicated query, or expand retrieval sufficiently for the requested page and detect more results. The displayed total and pagination must use the same set.

### 8. P2 — My Areas still uses different imported-deadline rules from department reports

**Evidence:** [My Areas lifecycle](C:/Users/raman/Documents/Grapsi/src/lib/funding/myAreasService.ts:205), [displayed deadline](C:/Users/raman/Documents/Grapsi/src/lib/funding/myAreasService.ts:230), [shared department deadline](C:/Users/raman/Documents/Grapsi/src/lib/fundingDept/callSql.ts:54).

My Areas primarily uses legacy `close_date/deadlineAt`, with an additional check for a passed imported entry date or source closure. It does not use the department’s entry/final fallback and funder-timezone rule. It can therefore show a later displayed deadline than the entry deadline, use a different open/closed boundary, or treat an imported final-only record without legacy dates as undated/open.

**Impact:** a researcher’s suggestions and departmental work reports can disagree about the same call’s deadline or availability. Exposure depends on the imported field combinations; production incidence was not measured.

**Correction:** share effective entry deadline, source closure and deadline zone across discovery, filtering, urgency, alerts and reporting. Keep final-stage deadlines as separately labelled information.

**Validation:** current source comparison; no live record reconciliation or database timezone test was performed.

### 9. P2 — Match-width preview can count inactive or departed researchers

**Evidence:** [settings preview](C:/Users/raman/Documents/Grapsi/src/lib/fundingDept/callMatchCensus.ts:325), [actual report predicate](C:/Users/raman/Documents/Grapsi/src/lib/fundingDept/reportDefinitions.ts:382).

The preview reads current match rows without the shared active-user/current-tenant check. Normal counts exclude inactive users and people whose user account no longer belongs to that tenant. Until the census is rebuilt, the admin preview can promise more matching people/pairs than the chosen setting will show in actual reports.

**Validation:** a probe captured the preview SQL and confirmed the missing user fence; existing matched-faculty tests confirm that normal counts include it.

**Correction:** derive the preview from the same eligible population and count predicate as live reports, varying only the cutoffs.

## Deliberate limits and product gaps

- **Alert coverage is a ranked sample.** Alerts request at most 50 candidates per tenant; normal researcher search reranks the first 40 and gates out unscored results when reranking succeeds. There is no recipient continuation, and dispatch is then stamped complete. Saved alert keywords only rescue already-retrieved, already-gated weak candidates. They cannot independently find someone omitted by retrieval or below its gate. If the promise is to alert every relevant researcher or honor every saved keyword, this needs a separate exhaustive/multi-batch delivery design. See [candidate search](C:/Users/raman/Documents/Grapsi/src/lib/services/fundingAlertService.ts:299) and [keyword rescue](C:/Users/raman/Documents/Grapsi/src/lib/services/fundingAlertService.ts:482).
- **Unclassified calls do not auto-map by keyword.** The mapper returns before considering school keywords when accepted call areas are empty. This is an explicit routing policy, not a newly discovered implementation regression. The synthetic check confirmed it; preserve a visible central classification/review queue. See [mapping decision](C:/Users/raman/Documents/Grapsi/src/lib/fundingDept/callSchoolMapping.ts:61).
- **Mappings are add-only.** Narrowing a school’s areas does not automatically end past responsibilities. That protects accountability history but requires an explicit review/end workflow for mappings made obsolete by classification or profile corrections.
- **Calibration remains unmeasured.** Passing logic tests cannot establish recommendation quality. A labelled sample spanning disciplines, sparse/rich profiles, broad/specific calls, eligibility conflicts and missed positives is still needed to measure precision and recall for each width and fallback basis.

## Validation and recommended order

**Existing checks:** 26 suites, 205 tests passed, covering reporting integrity, access fences, matched lists, routing, snapshots, recommendations, areas and alerts. Some alert mocks logged missing snapshot-method warnings; their assertions passed. This is not production database verification.

**Additional checks:** 10 isolated characterization probes passed. These confirm current behavior, including defects; they are not regression tests proving those defects fixed. They cover failed retrieval/replacement, cached fallback reuse, a failed call marked complete, the census merge ceiling, singleton scoring, Finder downgrade failure, My Areas pagination, the width-preview population and the deliberate unclassified-keyword guard.

The probes and their isolated configuration are retained in [the review output folder](C:/Users/raman/Documents/Grapsi/outputs/funding-matching-audit-20261102/characterization.test.ts). They mock database access, embeddings, reranking and delivery dependencies and are excluded from the normal test run by the repository’s existing outputs exclusion. To rerun: `node ./node_modules/vitest/vitest.mjs run --config outputs/funding-matching-audit-20261102/vitest.config.ts`.

Recommended sequence:

1. Preserve successful matches on retrieval failure; make per-call failure/coverage visible.
2. Correct final-score handling and census cache invalidation; rerun affected open-call censuses after release.
3. Carry eligibility assessments and scoring basis into stored results and all consuming screens.
4. Correct completeness claims, pagination, shared deadlines and width preview.
5. Establish labelled quality evaluation and clarify whether alerts promise exhaustive delivery or a ranked sample.

The main reports have a stronger shared foundation now. Their remaining correctness depends on making the evidence’s scoring basis, coverage, eligibility and failure state as explicit as the counts themselves.
