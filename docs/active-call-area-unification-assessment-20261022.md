# Active-call classification assessment — 22 October 2026

## Scope and evidence

Assess only existing, published, active calls whose directory lifecycle is OPEN
or ROLLING. Exclude closed, forthcoming, unknown, draft and archived records
from the proposed classification batch. Imported classifications remain the
existing source of the 528 standard research-area labels.

The production connection failed at Google API DNS resolution, before the
remote inspection ran. Findings below come from the verified local Grapsi
backup captured on 22 October 2026 before the protection deployment. They are
snapshot findings, not a fresh live status check. The backup SHA-256 is
`53b521cbb29464ffd61d431a439bb73629fe8846fc7432c9aaa551719078fbb2`.

The archive was decoded locally with `pg_restore --file=-`; its SQL was never
executed. No database restore, production write, migration, service restart,
model API call or notification was performed for this assessment. Other
applications and their databases were not accessed.

## Size of the narrowed task

The lifecycle calculation was reproduced from
`src/lib/catalogueProtection/areas.ts`, using 22 October 2026 as its UTC date,
and combined with the directory's published/active checks.

| Snapshot measure | Count |
| --- | ---: |
| Existing calls marked OPEN or ROLLING, published and active | 62 |
| OPEN | 32 |
| ROLLING | 30 |
| Existing legacy research-area classifications | 55 calls |
| No legacy classification | 7 calls |
| Human-entered legacy classifications | 2 calls |
| Existing Voyage vectors | All 62 |
| Usable description or summary | All 62 |

All 62 have GLOBAL_PUBLISHED visibility. This inspection does not change their
visibility or promote imported calls into institutional/DSR pipelines.

Four of the 30 ROLLING calls also have a past effective deadline. The current
lifecycle expression gives the rolling flag precedence over the deadline:

| Record | Stored effective deadline |
| --- | --- |
| Great Lakes NASMEI Marketing Conference proposal competition | 5 October 2026 |
| ISBM AI-Powered Marketing research competition | 30 September 2026 |
| DBT microbiome therapeutic/translational call | 15 October 2026 |
| NLnet Open Call / Funding Programme | 3 October 2026 |

These four require status verification before joining an active-only backfill.
A recurring programme may have a genuine rolling intake and an old cycle
deadline, so neither automatic closure nor automatic deletion is appropriate.
The other 58 have no such stored-date conflict; that is not independent
verification that each official source is currently accepting applications.
The live candidate set must be checked again immediately before any later
application, including deadlines that expire during the review.

## Active sample: what the content shows

The proposed labels below exist in the actual 528-label vocabulary. They are
inspection examples, not saved or model-validated decisions.

| Existing call | Current classification issue | Proposed approach |
| --- | --- | --- |
| NSE Research Initiative 2.0 | Finance-market research also has Architecture Planning & Design, despite no architectural funding purpose in the inspected description. | Retrieve Economics and Business and Economics candidates; validate against the financial-market objectives. Do not treat the phrase market design as architectural design. |
| DKMS John Hansen Research Grant 2027 | Blood-cancer, transplantation and cell-therapy research also has Mechanical & Manufacturing Engineering. | Retrieve Hematopoietic stem cell transplantation, Hematology and Immunology candidates. Cell manufacturing alone does not establish a mechanical-engineering research remit. |
| Dr. D. S. Kothari Research Grant | The description says it is open across disciplines, but its only legacy area is Computer & Information Sciences. The disciplines field contains a complete description paragraph. | Consider the existing All disciplines label after validating that scope. Treat the malformed tag field as prose evidence, not a curated subject list. |
| CEPF biodiversity conservation grants | Conservation is mixed with Management & Entrepreneurship. This is a programme listing with hotspot-specific application windows. | Retrieve Biodiversity, Conservation and Ecology. Preserve regional/application constraints separately and flag programme-level availability for verification. |
| Translational Biotechnology Research Networks | A coherent Biotechnology & Bioengineering legacy area and substantive biotechnology description. | Biotechnology is a straightforward candidate; retain the original evidence and verify that no additional specific area is required. |
| Sports research assistance scheme | Supports multiple sports-related subjects, including medicine and psychology. | Permit multiple supported labels such as Sports medicine and Psychology rather than forcing a single nearest area. |
| COST Open Call 2026 | The inspected description says open to all research fields, while the legacy mapping only names Engineering & Technology. | Validate an All disciplines scope, so specific area filters do not hide this opportunity from otherwise eligible researchers. |

The two human-classified active records must retain their original decisions.
One is in the four-record date-conflict group. Converting either to new area IDs
requires an explicit reviewed proposal; an automated job must not silently
replace human classifications.

## Recommended uniform system

1. **One shared vocabulary.** Reuse the 528 stable IDs already in
   `catalogue_areas` throughout directory, chatbot, profile selection, intake,
   call administration and department selection. Keep the nine imported broad
   subjects separate; do not manufacture a parent-child hierarchy.
2. **Keep the user's own words.** Preserve custom research descriptions and
   keywords. Add zero or more canonical area links. A user can save an interest
   even when the system cannot confidently classify it; the current saved-area
   service's mandatory old-taxonomy selection must change.
3. **One classification service.** Use Voyage embeddings of the call's funding
   objectives/title/description and of contextualised area definitions to
   retrieve candidates. Existing tags and legacy areas supply additional
   evidence, not unquestioned truth. Permit multiple areas and no reliable
   match. Validate candidates against the actual funded research; use a
   bounded verifier for ambiguous cases. Test thresholds against reviewed
   examples, rather than presenting cosine similarity as accuracy.
4. **Shared decisions, separate evidence.** Directory, AI filters, recommendations,
   intake and department matching should read the same effective area links.
   Persist source, input hash, model/version, evidence, reviewer and decision
   status. Keep original source assignments and legacy mappings available for
   audit. A reviewed canonical decision must become authoritative for that
   record; blindly OR-ing its obsolete legacy bridge back into search would
   reintroduce corrected mistakes.
5. **Broad calls remain discoverable.** Define how the existing All disciplines
   label affects specific-area filters and counts. A general call should be
   counted once per result/category, not materialised as 528 assignments.
   Interdisciplinary does not mean open to every subject. Eligibility and
   country restrictions continue to apply independently.
6. **Preserve semantic discovery.** Custom research text should continue to match
   call content directly through Voyage, with canonical area matches improving
   relevance. In personalised recommendations, uncertain area mappings should
   not hide an otherwise relevant call. Explicit directory area selections
   should have defined, consistent filter behaviour before pagination.
7. **Update all consumers before switching.** Several existing school/profile
   services still join old taxonomy IDs and broad group codes. The present
   taxonomy upload service archives the previous active vocabulary. Simply
   uploading 528 replacement rows now could make old links stop matching.
   Introduce the shared provider and compatibility reads first. Stable
   department structure IDs, assigned DSR work, promotion gates, human triage,
   tenant permissions and notification preferences remain independent.

The backup contains 819 profiles with custom research areas and 158 saved
research interests; only three saved interests have old taxonomy links. All
158 saved interests have Voyage vectors. Therefore profile migration should
primarily map the original text to the new vocabulary, not depend on reversing
the old taxonomy. A later read-only live check found 215 department-to-old-area
links across 138 departments. This table was not included in the focused
backup: absent exported rows did not establish that departments were unmapped.
Include these mappings in the new backup and preservation checks. The original
reviewed new-label-to-old-area import crosswalk can preserve their matching
scope without inferring an inverse old-to-many-new mapping.

## Safe implementation sequence

1. Re-establish read-only production access. Recount the current OPEN/ROLLING
   existing-call set and verify the four deadline conflicts. Build a dated,
   fixed candidate manifest and exclude uncertain status records until resolved.
2. Develop the shared vocabulary service and additive assignment/decision
   storage locally. Preserve every legacy identifier and original record.
3. Generate preview-only proposals for a small, varied sample from the current
   active set. Include clean, ambiguous, broad and human-classified examples.
   Do not run the live ingestion/publish pipeline to perform maintenance.
4. Validate against the sample and then create proposals for the remaining
   in-scope existing calls. Leave imported source classifications untouched;
   never regenerate the entire imported catalogue for this task.
5. Test area filtering and statistics across directory, chatbot, My Areas,
   profiles, new intake and school relevance. Check manual decisions, unknown
   mappings, broad calls, country exclusions and pre-pagination behaviour.
6. Rehearse additive storage and accepted mappings on an isolated copy. Verify
   preservation of calls, descriptions, vectors, users, DSR work, notification
   history/settings and other applications. A classification backfill must not
   send new-call notifications or auto-promote calls.
7. Before a later production application, take a focused verified backup and
   capture preservation baselines. Apply only reviewed links for the still-open
   manifest with exact-database and input-hash checks. Keep a revision that can
   be deactivated to roll back this classification change without restoring a
   full database backup over newer user work.

Closed/expired record deletion is a separate future task. It is not performed
or required by this assessment or by classification unification.
