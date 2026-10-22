# Plan: complete shared research areas across Grapsi

Status: approved for implementation by the user on 22 October 2026. This
document records the accepted scope; execution and rollout evidence are tracked
separately. Production preservation remains mandatory.

## Intended outcome

The 528 imported discipline areas are the single current controlled vocabulary
throughout Grapsi. A label has the same identity and meaning in directory,
chatbot, profiles, call editors, intake, department configuration, DSR lists,
queues, counts and matching explanations. Imported broad subjects remain a
separate dimension; no subject/discipline hierarchy is inferred.

Users retain their own research descriptions and keywords. These support
Voyage semantic matching and optional confirmed area suggestions; they are not
new controlled classifications. Existing records and human decisions are
preserved. Closed/expired historical calls are not reclassified or deleted.

## 1. Inventory and shared read/write boundary

Inventory all current readers, writers, selectors, request types, profile/chat
snapshots, background classification jobs and caches. Distinguish current
classification from source descriptions, legacy imports and historical audit
data. Descriptions and researcher free text must not be rewritten merely to
remove older wording.

Build on the existing researchAreas service and effective views. Centralise:

- Current call labels and source precedence: accepted revision first, original
  imported classifications next, explicitly reviewed compatibility as fallback.
- Current selected department areas, inherited school scope and compatibility
  routing. Derived compatibility targets are not extra explicit selections.
- Current researcher interest areas, including all selected IDs, not only one.
- Classified/unclassified state and distinct-record area counts.
- Label/ID validation, multiple selections, All disciplines and Unknown rules.

No live feature should directly choose classification from a legacy table.
Legacy reads remain only in explicitly documented compatibility/history/import
code. Coverage tests must fail when another live reader bypasses the boundary.

## 2. DSR filtering, queues and organisation counts

Replace the old classification joins in:

- `src/app/api/funding-dept/calls/route.ts`: area filter, school relevance and
  facets/counts. Apply canonical filters before pagination and counting.
- `src/lib/fundingDept/mappingRegister.ts`: unclassified queue and routing-gap
  counts.
- `src/lib/fundingDept/schoolFunnelService.ts`: unclassified headline totals.
- `src/app/api/tenant-admin/org-units/research-area-counts/route.ts`: organisation
  badges must count selected current areas, not historical/derived links.

Align the relevance predicate, reason text and operational mapping decision.
Test exact overlap, configured keywords, institution-controlled broad matching,
All disciplines, unmapped schools and genuinely unclassified calls. A synthetic
flat picker section must never act as a broad group matching every discipline.
Explicit historical DSR allocations and manual overrides remain authoritative.

Preserve tenant visibility, promotion eligibility, assignments and notification
policies. Selecting an area is not authority to view another tenant's calls.

## 3. One visible vocabulary in directory, chatbot and administration

Offer one standard area selector across relevant screens, with consistent
labels and searchable multi-selection. Remove the ordinary Previous Grapsi
areas picker once its existing selections can be handled safely.

Resolve old saved URLs, filters and conversation area IDs at the boundary.
Only exact reviewed translations can become canonical selections silently.
Ambiguous legacy selections retain a clearly identified compatibility state;
do not discard them, expand a broad area to unrelated leaves or show misleading
zero results. New selections always use canonical IDs.

Update facet/search/chip labels and legacy filter branches together. Search,
results, facets and statistics must use the same effective associations.

The taxonomy administration page must show the authoritative 528-area source
and version. Disable the old upload action from silently replacing or archiving
the taxonomy that compatibility depends on. Retain deliberate legacy mapping
management as a separate administrative/history operation.

Expose pending area-review work from the funding administration navigation.

## 4. Profiles, AI context and matching

Carry all canonical areas through saved interests, request validation, profile
snapshots, selected-topic branches, filter chips and AI tool arguments. The
current single taxonomyAreaId compatibility field must not silently reduce a
multi-area interest to its first selection.

Use the shared resolver for manual and automatic research filters. When a user
changes research topic mid-conversation, replace stale inferred topic filters;
retain manual choices unless the user's instruction changes them. Keep country
and eligibility conditions independent and continue their existing change rules.

Do not require a standard area for a custom research description. Preserve
existing research text, Voyage vectors, alert preferences and semantic matching
in My Areas, funding alerts, researcher matching, intelligence and grant tools.
Those features may continue semantic search; they must not introduce another
controlled area vocabulary or stale area explanations.

## 5. Intake and classification lifecycle

Ensure new intake, publish/update, manual editing and imported-call promotion
all obtain current labels through the shared service.

Separate the active-only historical backfill rule from the normal intake
classification lifecycle. A new draft needs classification when sufficient
research-purpose text is available; the historical batch's published/open
restriction must not silently skip it forever. Recheck changed inputs and
preserve accepted human decisions. Ambiguous proposals remain pending.

Reuse the 528 cached Voyage vectors and existing GPT review pipeline. Do not
regenerate imported call embeddings or reclassify closed historical records.
Promotion remains an explicit DSR action with its existing notification policy.

## 6. Existing department settings and saved preferences

Retain all 215 original organisation-area links as history and rollback data.
Generate a dry-run conversion report for active units using current confirmed
areas, unit name, position in the organisation and sufficient supporting scope
information. Faculty interests are supporting evidence, not a basis for
narrowing a whole department to one researcher's speciality.

Automatically translate only unambiguous exact reviewed matches. For ambiguous
old broad areas, use Voyage to shortlist standard labels and GPT to propose
supported selections with evidence. Do not reverse the original many-to-one
crosswalk or expand every child of an old category automatically.

Persist new selections as versioned revisions, with an audited batch preview
and before/after scope comparison. Retain compatibility routing until a
replacement is confirmed. Any unresolved unit must be visibly pending; it must
not become silently unmapped or be labelled All disciplines without evidence.
Apply the same safe treatment to the remaining old saved-interest references.

Present record counts, projected scope changes and an AI usage estimate before
running any paid conversion batch. No AI calls are needed for planning or for
most code changes.

## 7. Verification

Use an isolated restored database and meaningful integration/browser tests:

- The corrected blood-research example appears under Hematology consistently
  in Finder, AI retrieval, DSR filters, facets and counts. Its retained old
  engineering row cannot make it an engineering match again.
- Canonical-only calls are classified in both queues and headline totals;
  Unknown calls remain unclassified and broad-subject-only tags do not count as
  a discipline classification.
- Multiple profile areas survive editing, snapshots, chat and retrieval.
- All disciplines, configured broad rules, inherited department scope,
  unmapped schools, manual overrides and cross-tenant access behave uniformly.
- New intake is classified at the intended lifecycle stage and changed input
  cannot reuse a stale decision.
- Old links/conversations remain understandable; new UI choices are canonical.
- Department counts do not include derived compatibility targets or archived
  links. Planned conversion does not silently broaden/narrow responsibilities.
- Sorting/filtering happens on the full eligible set before pagination.
- Mobile selectors and review controls work without browser/API errors.
- Route access guards, shared quotas and Voyage-only enforcement still hold.

Run typecheck, lint, relevant integration tests and the full unit suite. Track
the two known Gemini failures separately; accept no additional failures. Check
additive migrations and funding_calls schema drift if a migration is required.

## 8. Guarded rollout and acceptance

Take a fresh focused backup and verify a restore. Capture preservation
fingerprints including funding/import data, department structure and links,
saved preferences, DSR work, notification settings and classification history.
If reviewed revisions are applied, compare their explicitly planned changes
separately from all records that must remain identical.

Rehearse migration and code on the copy, including after-deployment runtime
checks. Measure relevant queries against the full dataset. Prefer reusing the
existing additive revision tables/views; add an additive migration only if the
implementation requires it.

Build separately at low priority, retain the verified backup and prior build,
and restart only grantmentor. Leave other apps/databases/Nginx unchanged.
Restore application behaviour through its feature flag or prior build if
needed; do not restore a database backup over newer production work.

Clean only the dedicated rehearsal resources after verification. Produce a
report of deployed code, tested routes, consistent counts, preservation checks,
applied revisions and explicitly unresolved conversions.

Acceptance requires: one current selectable vocabulary; all live classification
readers/writers through the shared boundary; consistent results/counts/reasons;
working historical links; no unintended changes to production work; and no
hidden unresolved departmental conversion presented as completed.
