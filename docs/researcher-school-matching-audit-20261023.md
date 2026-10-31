# Funding-call researcher and school matching audit

Reviewed 23 October 2026. Scope: current workspace source, focused unit tests and mocked characterization probes. This is a logic audit, not a measurement of production accuracy. No production records were changed, paid models invoked, or matching code modified.

## How the mapping works

1. **School relevance:** `loadSchoolProfiles` unions the configured areas and keywords of each active school and its active descendant units. It does not infer a school's official scope from its faculty's interests. Calls use the canonical accepted-area reader, with an explicit legacy crosswalk for existing school selections.
2. **School responsibility:** `mappingDecision` maps exact area overlap, an All-disciplines call, or an exact source-discipline/keyword overlap. Broad legacy group overlap is optional and defaults off. Origin schools are retained independently. A school without configured scope receives no automatic mapping. Mappings are add-only; a head explicitly ends responsibilities. These are deliberate workflow rules, not evidence that faculty have matched.
3. **Faculty retrieval:** a call's title, description, effective area labels, funding kinds and eligibility prose form the query. Searches retrieve profile vectors, alert-enabled saved-interest vectors, tagged own-publication vectors, and profile full text. Candidates are deduplicated by user. A researcher needs a `researcher_profiles` row even for publication retrieval.
4. **Faculty scoring:** a reranker scores shortlisted profile documents; an absolute gate admits results. Without usable reranking, scores and tiers come from retrieval. Census mode uses larger retrieval windows and batches reranking.
5. **Placement and reporting:** the tenant-wide call census assigns each person to their profile's organisation unit and `path[1]` school, stores current matches, and preserves prior rows as history. People without a school are omitted from school totals. Reports derive strong/good/possible bands from stored numeric scores and the institution's width setting. Possible matches can route work but are not counted as matched faculty. Manual allocations are excluded from automatic-match counts.
6. **Faculty's own discovery:** `myAreasService` is a separate, inexpensive person-to-calls pipeline. It uses stored vectors and term retrieval with relative tiering, not the DSR census reranker. Consequently it does not guarantee the same label for the same call/person pair.

## Confirmed flaws and fixes

### 1. High: publication and saved-interest evidence disappear at final scoring

Evidence: `src/lib/services/researcherSearchService.ts:659`, `:925`, `:992`.

The first stage can find a person through an excellent publication or saved interest, but `buildRerankDocument` includes only the general profile fields. It omits the evidence snippets and publication titles. A specialist with a sparse profile can therefore be rejected by the final scorer. The rerank cache hash uses this same incomplete document: changing only publication evidence leaves the cached score key unchanged.

Fix: construct a bounded evidence document containing the strongest retrieved publications and saved interests alongside the profile. Preserve provenance, prioritize relevant evidence within the length budget, and hash exactly what is scored. Version the scorer and refresh affected censuses.

Validation: mocked probes verified that a distinctive retrieved publication was absent from the submitted document, and changing that evidence did not change the cache key.

### 2. High: retrieval failure can overwrite valid matches with an empty census

Evidence: `researcherSearchService.ts:1046–1065`; `src/lib/fundingDept/callMatchCensus.ts`, `census` transaction.

Vector branches use `Promise.allSettled`; the text branch catches errors and substitutes an empty list. When all retrieval fails, search still returns an ordinary empty result with `degradedMode: text_only`. The census does not check that mode or branch success before marking every prior automatic match non-current and recording a fresh zero-result state. Partial branch failures can also silently undercount. Reranking exceptions are handled differently and may abort rather than reach this path.

Fix: distinguish successful zero hits from failed or incomplete retrieval. Keep the last successful census on failure, record degraded/error state, and retry through a durable job. Only replace a complete census after required branches succeed, or explicitly identify a partial result without replacing authoritative counts.

Validation: a mocked search with every retrieval branch failing returned zero results instead of throwing. The destructive replacement consequence follows directly from the census transaction; no database mutation was performed in this audit.

### 3. High: topic match is being reported without an adequate eligibility assessment

Evidence: `researcherSearchService.ts:717`, `:741`, `:1090`; `callMatchCensus.ts` stored row shape; dossier route's construction of `matched`.

Only career stage and institution type are checked, and only as advisory flags when both sides contain a value. Imported residence, citizenship, applicant and host-country constraints are not evaluated here. Unknown profile facts receive no flag. Neither the stored census nor the dossier's live mapping preserves these flags, so even the two implemented warnings are lost in that workflow. An ineligible person can still contribute to a school's matched-faculty total.

Fix: keep topic relevance and eligibility as separate explicit outputs. Reuse the existing `src/lib/funding/eligibility` engine used by funding alerts, store/display ELIGIBLE / INELIGIBLE / NEEDS_CHECK plus reasons and rules version, and distinguish topic-match counts from eligible-candidate counts. Avoid treating missing facts as eligible or applying unsupported restrictions as absolute exclusions.

### 4. High: fallback scoring and separate discovery paths give conflicting labels

Evidence: `researcherSearchService.ts:605`, `:992`; `src/lib/fundingDept/matchBands.ts`; `callMatchCensus.ts` `storedCallMatches`; `src/lib/funding/myAreasService.ts:502`.

Retrieval fallback labels the best result strong relative to its neighbours. DSR then re-bands the raw score against absolute reranker-style cutoffs, ignoring score basis. The same score of 0.34 can be strong in search and possible in the report. A live search with only one candidate skips the configured reranker, whereas census mode reranks even one candidate. Faculty discovery also uses its own relative scores and labels. Raw full-text rank and cosine similarity are additionally combined with `max`, despite differing scales.

Fix: score singleton results too; retain per-row scoring basis/model/version; calibrate fallback bands separately or show uncalibrated relevance pending scoring. Use rank fusion for initial heterogeneous retrieval. Reuse a common final pair score across DSR and faculty discovery where identical labels are intended; otherwise clearly explain that discovery suggestions are provisional.

Validation: probes confirmed the singleton bypass and the strong-to-possible label change for a 0.34 fallback score.

### 5. Medium: inactive users enter retrieval and can occupy candidate windows

Evidence: `researcherSearchService.ts:285`, `:795–917`; `callMatchCensus.ts` placements versus `storedCallMatches`.

The shared researcher filter and retrieval queries do not require `u.status = 'ACTIVE'`. DSR requests correctly set tenantOnly, but inactive accounts can still consume retrieval/rerank capacity and be written into the census. The stored list later filters ACTIVE users, producing inconsistent populations and wasted work. Eligibility for assignment is checked separately.

Fix: apply an active-user predicate before retrieval, plus tenant-valid active organisation placement where school-scoped matching requires it. Make any historical or cross-institution search an explicit separate mode. Use consistent active/current-placement rules in lists and counts.

Validation: a probe inspected generated profile-retrieval SQL and confirmed there was no user-status predicate.

### 6. Medium: a census has a hard size ceiling without reporting truncation

Evidence: `researcherSearchService.ts:34`, `:35`, `:1063`; `currentMatches.ts` `writeSchoolProjections`.

Each census branch retrieves at most 2,000 candidates and the merged set at most 4,000. These limits are not pagination. Beyond them, otherwise qualified faculty can disappear from institution/school counts. `totalCandidates` is the bounded merged size, not population size. Projection `complete` means no detected profile gaps, not all calls scored or retrieval exhaustive; it can be true after only a 25-call refresh pass or with failed calls remaining.

Fix: paginate candidate retrieval or label bounded results explicitly. Track retrieval truncation, eligible population, calls pending/failed, and profile readiness as separate fields. Only state matching complete when the relevant coverage is actually complete.

### 7. Medium: school keywords cannot map an unclassified call

Evidence: `callSchoolMapping.ts:58–75`.

`mappingDecision` returns before checking keywords whenever callAreas is empty. A configured school keyword exactly equal to a source discipline therefore cannot route an unclassified call. For classified calls, keywords match only whole legacy `disciplines` entries, not the title, description or accepted canonical labels. This is consistent with the documented unclassified queue rule, but limits what a user would reasonably expect keyword mapping to cover.

Fix: decide explicitly whether verified keyword evidence may route unclassified calls. If allowed, evaluate it independently and label its lower-confidence source. Normalize canonical labels and synonyms; do not rely on unrestricted substring matching. Keep genuinely unresolved calls in the central review queue.

### 8. Medium: corrected classifications do not reliably reconcile existing responsibility

Evidence: `callSchoolMapping.ts` `writeMappings`; `src/lib/researchAreas/organisationReview.ts` `acceptOrganisationProposal`; `src/app/api/admin/funding/department-area-review/route.ts`.

The canonical reader correctly prevents an accepted correction from inheriting obsolete legacy call tags. However, previously stored school mappings remain active by design. Also, the department-area proposal acceptance path changes effective organisation areas without invoking the remapper that the normal organisation editor invokes. This can leave both obsolete responsibilities and missing new ones after migration/review.

Fix: enqueue a durable reconciliation after every accepted call/organisation revision. Preserve manual ownership and work history, but show automatic mappings whose supporting evidence is obsolete and offer head-reviewed closure; add newly supported mappings. Make current relevance distinct from historical responsibility. Do not simply delete workflow history.

### 9. Medium: freshness does not mean inputs are current

Evidence: `callMatchCensus.ts` `callFingerprint`, `callMatchStates`, `staleCallIds`; dossier route around line 400; `callUnitRelevance.ts` `actionableSchoolCallWhereSql`.

Fingerprint comparison runs when a census is requested, while most read freshness checks use a six-hour timestamp and accepted call-area changes. Profile edits, school movement and call text changes can remain stale until the scheduled refresh. The dossier reads any existing census, even when stale, then queues refresh. The fingerprint also omits the reranker model/configuration, so a cached census may survive a scorer change even though individual pair-cache hashes include model name. Separately, faculty-match-only routing depends on a school projection timestamp less than five minutes old, so it can temporarily hide a call until refresh; active stored mappings or recorded work avoid that path.

Fix: invalidate affected call/school states on input edits, include scorer/model and document versions, and use durable jobs. Use the current profile placement for current school scope. Show stale results explicitly. Base routing on valid match evidence rather than a short-lived readiness timestamp.

### 10. Medium: DSR visibility differs from the researcher catalogue

Evidence: `src/lib/fundingDept/callSql.ts` `visibleCallSql`; `myAreasService.ts:178`; `callSchoolMapping.ts` `tenantsForCall`.

DSR intentionally considers released GLOBAL_PUBLISHED calls, not unpromoted GLOBAL_CATALOG imports. Thus a faculty member may discover an imported call before it is released to school workflows; this is a lifecycle policy, not necessarily broken linkage. However, DSR's shared visibility fragment lacks an `is_active` check, unlike the researcher library. Census scheduling and mapping planners use that fragment, allowing deactivated-but-published calls to be considered.

Fix: preserve an explicit import-to-release lifecycle, expose its status to admins, and standardize active/published/tenant checks through shared SQL/Prisma policy definitions. Keep unpromoted catalogue access an explicit option rather than accidentally exposing every import to every school.

## Migration validation and limitations

- Exact canonical call-to-school area IDs and retained legacy crosswalk rows are read through shared boundaries, rather than arbitrary stale call tags. Existing canonical consumer-coverage tests passed.
- Canonical areas do not invent legacy broad groups: their group fields are empty. Broad mapping is therefore useful only where a valid legacy crosswalk supplies a group. Treat this as a supported-scope limitation unless an explicit canonical hierarchy is added.
- School scope aggregates descendant settings correctly; faculty placement comes from the profile's organisation unit, not matching text such as department names. Unplaced faculty do not belong to any school's numbers.
- Mapping a call to a school, finding topical faculty, confirming eligibility, and manually allocating work are distinct operations. A mapped school with zero counted faculty is possible by design.
- No labeled production benchmark was available in this audit. Precision/recall, actual false-positive frequency and the number of affected live records remain unmeasured. Validate these with expert-reviewed examples across schools, sparse profiles, publications-only expertise, imported eligibility restrictions and corrected classifications before claiming accuracy.

## Validation performed

41 checks passed: 35 existing tests covering canonical-area boundaries, relevance rules, match bands, candidate access and nonblocking report reads, plus six temporary mocked characterization probes described above. The probes were removed after validation. No paid embeddings/reranking or live-data writes were used.

## Recommended implementation order

1. Preserve good census data on retrieval failure; enforce active population; add explicit degraded/coverage state.
2. Include retrieved evidence in final scoring; version documents/caches; unify scoring-basis handling and score singleton searches.
3. Integrate eligibility assessments and surface reasons in the school dossier and eligible-candidate totals.
4. Add durable invalidation/reconciliation for accepted classifications, profile movement and scorer changes; distinguish current relevance from retained responsibility.
5. Remove silent census caps, standardize visibility and clarify keyword/unclassified and imported-call release policy.
6. Measure results against an expert-reviewed benchmark, then tune thresholds by observed precision/recall rather than labels alone.
