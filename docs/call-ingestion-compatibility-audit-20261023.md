# Call ingestion compatibility audit — 23 October 2026

**Verdict: partially compatible.** Normal intake has been connected to the shared research-area classifier, but it has not been fully upgraded to the richer facts model introduced for imported calls. Updates and some alternate lifecycle paths can leave facts, classifications and routing inconsistent.

This is a review of local checkout `fc02ec3` on `codex/catalog-production-safety`. It is not a fresh production-data census. The production rollout document records the successful shared-area deployment; this audit examines remaining code paths beyond that smoke test. No production database, provider call, notification or deployment was used. Application code was not changed. The pre-existing change in `scripts/catalogue-origin-protection.sh` was left untouched.

## What is already supported

- URL, text, PDF, JSON, CSV and bulk CSV intake converge on the normal intake/draft flow. JSON and CSV can also carry guidelines, application templates and document URLs.
- With `CANONICAL_RESEARCH_AREAS_ENABLED=true`, normal draft creation invokes the shared classifier. Publication invokes it again and then maps schools and notifies covering officers.
- The classifier reuses the imported discipline vocabulary and cached Voyage vectors, validates evidence through the reviewer, supports multiple areas and All disciplines, and preserves accepted human decisions. Unchanged research can reuse its accepted decision after publication.
- The shared effective-area view gives accepted decisions precedence over old discipline links. Imported broad subjects stay separate.
- Imported calls are blocked from the normal publication path and retain their separate release/promotion and notification controls. These differences are intentional.

Evidence: `src/lib/fundingIntake/service.ts:1037–1146`, `src/lib/funding/disciplineClassifier.ts:212–235`, `src/lib/researchAreas/store.ts:68–90`, `src/lib/services/fundingCatalogService.ts:826–978`, and `prisma/migrations/20261022123000_canonical_research_areas/migration.sql:41–61`.

## Findings, impact and fixes

### 1. High: editing facts leaves the newer structured facts stale

`FundingCatalogService.updateFundingCall` uses `buildCallWriteData`, which changes `close_date`, `eligible_countries`, `currency`, amounts and agency text. It does not synchronize the corresponding newer deadline dates/rows, eligibility dimensions, currency estimates or funder link. This affects imported calls edited through this service and curated calls that previously received the facts backfill.

Confirmed with the actual service against a mocked database:

- Extending `close_date` from 1 October to 1 December leaves `entry_closes_at` and `final_deadline_at` on 1 October. The shared lifecycle helper still returns CLOSED on 23 October because it prefers those structured dates.
- Changing the eligible list from India to United States leaves `applicant_country_codes=['IN']`. The eligibility helper still returns ELIGIBLE for India and INELIGIBLE for the United States.
- Changing USD 100,000 to EUR 200,000 retains `currency_code='USD'` and the old USD 100,000 estimate. Amount filtering prefers the structured currency and estimates.
- Changing the agency leaves the old `funder_id`. The funder-name fallback only applies where `funder_id` is null.

The imported-field provenance map even names some derived deadline columns as curator-owned without the writer updating them.

**Fix:** add a shared facts normalizer/writer used by create, update and publish. Atomically synchronize dependent facts and their provenance. Preserve independent residence/citizenship/host constraints and separate deadline stages; a legacy text edit must not flatten them. If a change makes a derived value uncertain, clear/mark that value for review rather than retain an obsolete assertion. Recompute currency estimates from a stored rate, recording the rate/date, or clear unavailable estimates. Resolve the funder again when its identity changes.

Evidence: `src/lib/services/fundingCatalogService.ts:378–440,726–823`; consumers in `src/lib/fundingCatalogImport/lifecycle.ts:39`, `src/lib/funding/eligibility.ts:120`, `src/lib/services/recommendationSearchService.ts:186–238`; ownership map in `src/lib/fundingCatalogImport/provenance.ts:51–82`.

### 2. High: new intake does not populate structured geographic eligibility

Normal intake saves the old country/region lists and free-text citizenship/residency requirements. It does not write `applicant_*`, `residence_*`, `citizenship_*` or `host_*` dimensions. The imported-call writer does.

The shared verdict helper returns NOT_EVALUATED for a call containing only `eligible_countries=['United States']`, even for an India-based applicant. The alert service explicitly skips its country-exclusion check when no structured dimensions exist. Some directory country filtering still works through legacy list matching, so this is inconsistent behavior rather than complete loss of geography support. Global/region-only calls also lack the richer evaluated path.

**Fix:** extract and normalize residence, citizenship and host separately, including exclusions and unknown values. Use the legacy combined applicant dimension only when the source actually supports that interpretation. Persist those facts before publication and alert dispatch. Keep uncertain eligibility visibly unresolved; do not guess that citizenship and residence are interchangeable. Reuse the existing shared eligibility evaluator.

Evidence: `src/lib/fundingIntake/types.ts:92–124`, `src/lib/fundingIntake/service.ts:1037–1136`, `src/lib/fundingCatalogImport/service.ts:181–217`, `src/lib/services/fundingAlertService.ts:354–377`.

### 3. High: research edits do not refresh accepted area classifications

`updateFundingCall` regenerates a stored embedding when enabled but never invokes classification or school mapping. The classifier contains changed-input detection, but that logic only helps when the classifier is called. The effective-area view continues to expose an accepted revision until it is revoked; it does not compare its hash with the current call.

Consequently, changing a published call from hematology to agricultural research can retain the hematology filters and area-based matching explanation until another explicit classification action occurs. A direct probe confirmed that a description edit schedules neither classification nor mapping.

**Fix:** after a committed title/purpose/topic change, enqueue classification against the new research hash. Mark an old automatic decision stale while the replacement is reviewed; keep its history and distinguish provisional from current information. Preserve manual decisions, but flag substantive research changes for human reconfirmation. Remap newly relevant schools after an accepted revision, preserving existing assignments and responsibilities.

Evidence: `src/lib/services/fundingCatalogService.ts:726–823`, `src/lib/funding/disciplineClassifier.ts:219–234`, `prisma/migrations/20261022123000_canonical_research_areas/migration.sql:41–61`.

### 4. High: a pending intake decision can be approved without finishing school routing

The area-review POST accepts a proposal and returns. Neither it nor `acceptCallAreaProposal` calls the school mapper. In comparison, the separate manual-area editor explicitly maps schools after saving.

If an intake classification is pending when publication maps schools, later approval changes the current labels but does not itself create the newly relevant stored school mappings. Operational school queues rely on those mappings. This is a code-path finding; no live affected-record count was obtained.

**Fix:** record the proposal's workflow/purpose and use a shared post-accept handler. For normal intake, idempotently add newly relevant school mappings and complete any explicitly authorized notice step. Historical classification maintenance must retain its existing no-allocation/no-notification behavior. Do not turn every historical approval into a new-call publication event.

Evidence: `src/app/api/admin/funding/research-area-review/route.ts:34`, `src/lib/researchAreas/store.ts:68–90`, `src/app/api/admin/funding/calls/[id]/research-area-taxonomy/route.ts:58`, `src/lib/fundingDept/callSchoolMapping.ts:1–23,220–226`.

### 5. High for entry deadlines; medium for other fields: the intake contract is still narrower than the imported facts model

The extraction schema, `FundingDraftValues`, upload aliases and editor definitions support a single open date/close date and simple amounts. They do not support operational storage of:

- Letter-of-intent/preproposal/full-application stages, stage-required state, deadline timezone, entry closing date and explicit source closure.
- Raw award wording, annual/monthly and recipient bases, indirect costs and FX estimates.
- Funder entity selection/normalization, nomination rules, qualifications, membership, work-rights restrictions, benefits, SDGs, programme framework and native title/content language.
- Explicit standard-area IDs or the separate imported broad-subject dimension. New intake gets discipline links through AI/manual classification, not an uploaded ID contract. Broad subjects must not be inferred as a parent hierarchy.

A JSON probe supplied structured residence, deadlines, annual award basis, nomination, SDGs and standard-area IDs. They were omitted from the prepared operational fields without an unsupported-field warning. Original JSON can remain in intake source text; the gap is that these facts never reach their operational columns.

Without deadline stages, a call can appear open until the final application deadline even though the mandatory entry stage has passed. Without normalized amounts/funder links, same-currency and exact-name fallback paths can work, while cross-currency comparison and funder facets remain incomplete. The existing backfill is an operator-run, fill-empty process; it is not a live ingestion synchronizer and cannot reliably repair subsequent edits.

**Fix:** version the intake contract and extend extraction, JSON/CSV adapters, validation, review controls and persistence together. Prioritize deadline stages and eligibility, then awards/funder identity, then optional discovery fields. Use the existing lifecycle, money, country and eligibility modules where appropriate. Preserve evidence, unknowns and original text. Report unsupported upload fields and schema versions instead of silently implying full support.

Evidence: `src/lib/fundingIntake/schemas.ts:42–75`, `src/lib/fundingIntake/types.ts:92–124`, `src/lib/fundingIntake/jsonIngestion.ts:386–403`, `src/lib/fundingCatalogImport/service.ts:145–217`, `src/lib/fundingCatalogImport/backfill.ts:1–31,155–227`.

### 6. Medium: publication readiness checks free-text tags rather than accepted research areas

`buildPublishReadiness` requires a nonempty `disciplines` array and never consults effective area links or pending/failed classification state. An arbitrary topic string can satisfy the check without an accepted area; conversely a call with accepted canonical areas but an empty old tag list fails the area requirement.

**Fix:** distinguish source topic hints from controlled classification. Derive readiness/status from the shared effective areas and visible classification state. If publishing with unresolved areas is allowed, make it an explicit policy with queued follow-up work. An accepted canonical selection should satisfy the research-area requirement without duplicate free-text tags.

Evidence: `src/lib/services/fundingCatalogService.ts:171–194,682–723,846–855`. The free-text readiness behavior was directly reproduced.

### 7. Medium: a still-exposed older publish route bypasses the current pipeline

`/api/super-admin/funding/calls/[callId]/publish` invokes `publishGlobalFundingCall` in the older ingestion service. That function updates publication flags and dispatches researcher alerts. It does not run the current readiness check, generate the normal embedding, classify research areas, map schools or issue covering-officer notices. Its imported-call guard is present, so this is a parity problem for non-imported calls rather than an import-release bypass.

**Fix:** delegate this endpoint to the shared publication service with the same permissions and result handling, or deliberately retire it and migrate callers. Keep the imported release/promotion boundary intact. Review the old import retry path as part of retirement; it can still construct the older call shape.

Evidence: `src/app/api/super-admin/funding/calls/[callId]/publish/route.ts:19`, `src/lib/funding/ingestion-service.ts:600–637,1053–1091`.

### 8. Medium: classification and routing work is not durable

Draft classification and the publish classification→mapping→notice chain run as unawaited work in the application process. Classification failure is logged; a thrown error exits the publish chain before mapping/notices. Pending decisions return without an accepted area. The draft wrapper does attempt mapping in `finally`, but the publish chain lacks that fallback. No persistent classification retry queue is wired into these call sites.

**Fix:** persist an idempotent job/outbox entry with the call write. Track PENDING/REVIEW/FAILED/ACCEPTED state, attempts and last error. Retry transient failures with bounded cost and deduplicate by research hash. Record classification, mapping and notice completion separately so recovery neither loses work nor resends notifications. Keep classification failure from blocking unrelated, valid origin responsibility mapping.

Evidence: `src/lib/fundingIntake/service.ts:1141–1146`, `src/lib/funding/disciplineClassifier.ts:323–340`, `src/lib/services/fundingCatalogService.ts:925–949`.

## Recommended implementation order

1. Fix synchronization on updates and populate new-intake eligibility before alerts. These are the clearest correctness risks.
2. Connect research edits and intake review approval to a durable, workflow-aware classification/routing lifecycle. Preserve manual choices and historical responsibilities.
3. Unify publication entry points and correct readiness semantics.
4. Upgrade the intake contract for staged deadlines, award/funder normalization and optional imported discovery fields. Apply one normalization boundary to every source type.
5. After those changes, prepare a read-only production discrepancy inventory, then a reviewed repair plan. Do not blindly rerun the fill-empty backfill: it leaves already-populated stale values alone. Classifications and facts repair must not republish historical calls or resend notices.

## Verification performed and required follow-up

**Performed:** 12 existing focused suites passed, **115 tests**, covering shared-area safety, consumer coverage, intake utilities/adapters, CSV/bulk ingestion, import normalization, facts filters, promotion and document routing. Seven additional local audit probes confirmed unsupported rich JSON facts, unevaluated legacy-only eligibility, stale deadline/country/currency/funder writes, missing edit reclassification and free-text readiness. The probes used mocked database/embedding access; no network or model calls occurred. Temporary probe source was removed after verification.

**Required after implementation:** integration tests on an isolated database for each input type through create→review→publish→edit, not just individual helpers. Include a passed mandatory LOI with future final deadline; mixed residence/citizenship constraints; an extended backfilled deadline; changed country/currency/funder; canonical-only areas; changed research purpose; manual classifications; review approval after publication; classifier timeout/retry and process restart; repeated jobs without duplicate notices; broad subjects staying separate; and imported release/promotion suppression. This audit makes no claim about how many production rows currently exhibit the gaps.
