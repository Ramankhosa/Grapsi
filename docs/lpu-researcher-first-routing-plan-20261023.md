# LPU researcher-based call routing: implementation and faculty intake plan

Prepared 23 October 2026 (India time). The next faculty dataset is expected from the user on 24 October; no automatic import, scheduled run or reminder has been created. Status: read-only preview, shared policy and roster preflight implemented locally; automatic routing is not activated or deployed. See `lpu-routing-groundwork-20261023.md` for delivered scope and checks.

## Agreed direction

Primary routing is call research purpose -> qualifying individual researchers -> their actual LPU departments/schools -> the available DSR coordinator. Confirmed institutional area mappings provide supplementary review coverage. Completing a manual 528-by-school mapping is not a prerequisite.

This changes the execution priority of `lpu-unified-area-mapping-plan-20261023.md`: that document's live audit, common IDs, evidence quality findings and exception requirements still apply, while this plan is the controlling implementation sequence. The existing 130 department proposals must not be bulk accepted as a preliminary step.

Maintain three separate concepts: research relevance, investigator eligibility, and allocated work. Matching creates a suggestion or school responsibility according to the policy below; it never automatically allocates a proposal to a person.

## Starting point and known dependencies

The live DSRLPU audit found 768 researcher profiles, 615 with valid placement and 153 without a unit; 32 schools and 138 active units; all 768 profiles have Voyage vectors. The 528 standard areas also have cached vectors. These are point-in-time counts from 23 October, not promised counts after the next import. The additional approximately 500 records may contain existing people, updated details or placement corrections; do not assume they are all new or predict the final headcount before reconciliation.

Reuse `researcherSearchService`, `callMatchCensus`, `funding_opportunity_matches`, organisation paths, existing per-pair rerank cache and current DSR coordinator/coverage logic. The existing census already searches tenant-wide before splitting results by school. Standard 528-area IDs support search, explanations and supplementary coverage; individual semantic matching can operate without confirmed standard-area selections.

The earlier DSR queue/report/reliability fixes remain an independent, undeployed working change set. Integrate and validate against them without overwriting the unrelated local drafts. Do not treat this plan as evidence that those fixes or this new routing policy are live.

## Faculty file for 24 October

One row per person in Excel or CSV. Use the prepared `docs/templates/lpu-additional-faculty-template.csv` header. Columns:

| Column | Use |
| --- | --- |
| Name | Required by the existing importer; display identity |
| Email | Required by the importer; real institutional/current address, no invented placeholders |
| Employee ID | Strongly recommended for reconciling existing faculty and changed addresses |
| Unit Path | Optional exact hierarchy, e.g. existing school > department; takes precedence in the importer |
| School | Needed for reliable school routing, unless Unit Path supplies it |
| Department | Prefer the actual LPU department, not an inferred research group |
| Designation | Optional; retain as supplied |
| Research Areas | Free-text specialities are accepted; no need to preselect the 528 labels |
| Keywords | Optional detail supporting research matching |
| Research Summary | A short evidence-based account of what the person researches |

Separate multiple values in Research Areas and Keywords with semicolons. If publication titles, DOI/ORCID links or other supporting research records are available, provide them in a separate sheet/file associated by Email or Employee ID; the basic roster importer does not automatically ingest an arbitrary publications sheet. Preserve research provenance and avoid assuming every linked paper is an authored publication. School/Department placement gaps can be submitted for reconciliation but cannot silently be guessed for school routing. Blank research evidence remains explicitly incomplete.

Omit Role, Head Of and other access-control columns for this research-data batch unless there is a separate explicit role-change instruction. Do not change accounts, notification preferences or access merely to enrich research profiles.

## Phase 1: reconcile the roster before writes

1. Scope every lookup to tenant `cmshc97c3005t6piv0y5c9c5n` (DSRLPU). Do not select a similarly named tenant.
2. Normalise email whitespace/case and employee IDs; identify duplicates within the file and collisions with the existing roster. Match identity through existing verified records. A changed email plus the same employee ID needs explicit identity reconciliation: the current importer primarily upserts by email and can reject a duplicate employee ID, so do not blindly import it as a new person.
3. Resolve School/Department aliases to existing unit IDs and their parent paths. Identical department names under different schools must remain distinct. Do not auto-create duplicate units for spelling variations.
4. Produce a dry-run summary of new people, changed people, unchanged people, duplicate/conflicting identities, school moves, unmatched units and records needing research evidence. Include proposed corrections to the existing 153 unplaced profiles if the new data supports them.
5. Preserve accepted manual research corrections and existing work. Treat missing columns and deliberately empty fields differently so a partial update does not erase good summaries or placement. Capture a before-state sufficient to reverse the specific batch, avoiding full-database restore over subsequent work.
6. Import in bounded idempotent batches. An identical retry must create no duplicate user, profile or hierarchy unit. New/changed profile content queues only the necessary embeddings. Track missing/failed embeddings and source provenance.

Output: reconciled faculty inventory, batch change report, remaining identity/placement exceptions and embedding coverage report. Current staff and new staff enter the same pipeline.

## Phase 2: matching and relevance policy

- Build the call query from actual funded research, methods, outputs and constraints. Keep incidental wording and administration from dominating research fit. Retain accepted call corrections and the original documents.
- Search the eligible active LPU researcher population tenant-wide. Never restrict candidates to schools selected by a possibly incomplete area crosswalk. Retrieve profile, saved-interest and attributable publication evidence, deduplicate by user ID and retain evidence sources.
- Rerank candidates with the existing Voyage pipeline. Use LLM adjudication for ambiguous cross-disciplinary cases and concise evidence-grounded explanations, rather than running a fresh LLM over every call/person pair. Clinical lead authority must not be inferred from a medical-AI interest.
- Calibrate the existing match-width/score policy against a reviewed sample of real LPU calls. Scores are relevance signals, not probabilities. Do not introduce an arbitrary new cutoff or use one weak nearest-neighbour hit as automatic school responsibility.
- Produce research fit and eligibility separately: potential lead when requirements are supported; potential collaborator when expertise fits but lead requirements do not; unresolved when facts are missing; explicit failure when a known mandatory condition fails. Team/programme requirements may require a team-level check rather than one person.
- For reporting, preserve one durable qualifying result set with run ID, source fingerprint, scoring policy, eligibility interpretation and coverage state. Routing, list, count and export must agree. A bounded interactive top-50 search is not the source of a complete school count.
- Existing census branch/merge caps (2,000 and 4,000) and retrieval floors need explicit coverage checks as the roster grows. A cap or failed evidence branch cannot be labelled a complete zero; use batching/exhaustive profile scoring when required and report remaining incomplete evidence. Reuse unchanged per-pair scores after imports.

Output: calibrated matching policy with reviewed positive and negative examples, evidence-bearing results and explicit completeness status.

## Phase 3: turn individual matches into school review work

Proposed starting rules, subject to calibration:

| Evidence | Operational treatment |
| --- | --- |
| Qualifying validated researcher match with supported placement | Create/update one call-school responsibility; show the exact qualifying people and evidence |
| Relevant computing or other contributor whose lead eligibility is not established | Label collaboration/eligibility review; do not describe them as an eligible PI |
| Only borderline/weak similarities | Central DSR review suggestion; no automatic new school workload |
| Confirmed institutional scope but no qualifying researcher | Supplementary school review, labelled institutional relevance and zero matched people |
| Relevant researcher lacks placement | Central unplaced-researcher queue; keep person discoverable institution-wide, do not invent a school |
| No demonstrated researcher or institutional fit | Central unassigned review/explicit no-current-fit decision; do not broadcast to every school |
| Incomplete matching or unavailable provider | Processing/retry/partial status; preserve the last successful result with an age label |

Resolve available call-specific transfer owner, primary coordinator or deputy using shared coverage logic. If none is available, record the coverage exception. Create school responsibility once per tenant/call/school and notifications once per applicable delivery event. A matched faculty member receives no automatic allocation.

School responsibility needs explicit provenance for researcher-derived routes versus institutional scope/manual/origin routes. Retire unsupported *current automatic* routing only through an auditable reconciliation policy; preserve officer decisions, manual routes, already allocated work and historical deadline accountability. A staff move changes current placement and future routing without rewriting who was accountable before the move.

GLOBAL_CATALOG calls remain discovery-only until explicitly released into LPU operational workflows. Their researcher fit can be previewed; it must not generate DSR pendency or officer messages by itself. Closed calls do not enter fresh open-call work.

## Phase 4: user interface

In Incoming Calls and the call's school panel, display the routing reason, qualifying researcher count, last successful match time and current processing/coverage state. Distinguish researcher fit, institutional review and human-added responsibility.

The researcher list opens the very rows counted by that badge, supports all results through pagination, and displays relevant evidence plus any eligibility uncertainty. A separate directory/roster action may show everyone in the school; it must never be presented as the matching list.

Expose central queues for unplaced researchers, incomplete profiles, calls without confirmed fit, uncertain eligibility, mapping conflicts, missing coordinators and job failures. Keep these visible even when a school has zero matched researchers. Use plain explanations such as “2 researchers match; 1 needs eligibility review”.

Retain the Discovery dashboard's standard-area and own-word modes. Add the shared effective-person-area reader described in the earlier plan so accepted PROFILE classifications, saved-area links and declared text are not inconsistently interpreted by different screens. Institutional expertise discovery and personal alert opt-ins remain distinct.

## Phase 5: durable processing and updates

Publication or institutional release, changed research content, changed researcher evidence, placement moves, unit changes and scoring-policy changes enqueue dependent work with deduplicated generation IDs. Do not recalculate all historical calls after every imported row; finish a batch, prioritise open released calls approaching entry deadlines, and process bounded jobs.

Use retry/lease handling, provider cost/concurrency limits and result fingerprint checks. An older worker cannot overwrite a newer roster/call generation. Atomic persistence keeps badges and detail lists on the same result set. No duplicate notifications on retry. Apply new matching counts even when historical actions retain their original evidence.

## Validation and staged activation

Validate the existing 768-profile population first and then the combined reconciled roster. Required examples:

- AI crop-disease call reaches relevant plant and AI researchers in different schools.
- Eight qualifying Biotech people produces eight displayed people, despite the larger roster.
- Medical-image-analysis researchers are not automatically labelled eligible clinical investigators.
- Unplaced relevant faculty remain visible in the central queue.
- One weak similarity does not create a school workload.
- Zero-fit, partial indexing and provider failure have different states.
- Partial rerank/evidence failure cannot silently replace a good complete snapshot.
- Profile/area corrections, staff moves and inactive accounts update current matching without changing historical ownership.
- Repeated imports and job retries do not duplicate users, mappings, responsibilities or notices.
- All page totals, detail lists and exports reconcile; selected tenant/school permissions are respected.
- Catalogue-only calls do not create operational work until released.

Run in preview against existing open released calls with notifications disabled. Compare current and proposed routing, inspect additional/lost schools and calibration examples, and separate data-quality issues from scoring errors. Activate in bounded batches, retaining prior policy configuration and result versions for behavioural rollback. No deployment or live batch application is part of this planning request.

## Work that can proceed before the new data arrives

The design, import requirements, coverage audit, routing policy, exception UI specification and validation cases are now recorded. Implementation can use the current roster; the final identity reconciliation, placement corrections and combined-roster calibration depend on the user's next dataset. A school remapping of all 528 areas is not on the critical path.
