# Research Discovery dashboard

## Product plan — recorded before implementation

One dashboard entry, **Research Discovery**, opens four task views:

| Task | Input | Result |
| --- | --- | --- |
| Calls by area | Standard research areas or a topic in your own words | Accessible calls, deadlines and reasons; open call or find aligned people |
| People by area | Standard areas or a research description | Active researchers in permitted schools, with expertise and match evidence |
| Person → research areas | Name, email or employee ID | Distinct people, school/department, profile areas, saved interests and available standard-area links |
| Call → people | Search and select an accessible call | Ranked people, research evidence and eligibility caveats; existing matching workspace for allocation |

## Search rules

- Use the live canonical discipline vocabulary (currently 528 areas), not a hardcoded copy or invented hierarchy. Standard selections match **any** selected area. Selected standard IDs are validated server-side.
- Standard calls use the existing directory and its area precedence and lifecycle handling. Standard people use canonical saved-interest links or an exact normalized profile-area label. State which evidence matched. School areas do not imply every faculty member works in that area.
- Own-words searches use existing hybrid vector/text retrieval and reranking. Calls use a paper-metadata topic request to avoid automatic topic expansion by a generative model. Never silently turn a standard-area filter into a fuzzy search.
- Person lookup is ordinary paginated identity search, independent of embeddings and similarity thresholds. Include sparse profiles; distinguish missing expertise from no matching identity.
- Call alignment is a bounded ranked suggestion set, not the complete school census and not an eligibility decision. Do not update DSR match counts, allocate, circulate or notify during discovery.
- Expand school filters to descendants, clamp to the authenticated tenant's managed scope, and exclude inactive accounts before retrieval. Calls include accessible released imports. Unreleased call visibility follows existing catalogue policy.
- Directory/identity results have exact filtered totals and pagination; semantic results say **top suggestions**, reveal the 50-result ceiling and degraded retrieval. Never claim an exhaustive count from a bounded candidate search.

## UI and interaction

Task-first navigation, one primary action, visible field labels, generous spacing, responsive filter/results layout, searchable area checkboxes with removable chips, explicit standard/own-words choice, school/department filters only for people, and call lifecycle/sort controls only for calls. Search runs on submit; changing context clears stale results. Requests are cancelled/ignored when superseded. Result cards show source labels and explain the next action. Loading, denied access, errors, empty results and index gaps are distinct states.

Use native form controls and buttons with visible keyboard focus. Task tabs follow WAI-ARIA keyboard and panel semantics: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/. Announce loading/result counts without moving focus unexpectedly. Avoid color-only status communication.

Keep tasks connected: a call can open call-to-people; a person can open their profile; their declared areas can seed call discovery. Provide a copyable search link and manually saved searches on this browser, scoped to the signed-in user. Never persist returned faculty records in browser saved searches.

## Permissions and implementation boundaries

Funding discovery retains its existing entitlement, catalogue metering, anti-export guard and call visibility. Researcher discovery retains the existing admin/manager/funding-department managed-scope boundary. Ordinary users can search calls; the hub explains why restricted people views are unavailable instead of silently widening access. Reuse the existing faculty drawer and matching workspace for operational actions. No schema migration is needed.

## Validation

Test authentication, cross-tenant denial, school subtree/intersection, active users, canonical-ID validation, person pagination and literal identity searching; ensure ordinary searches do not invoke embeddings. Test semantic requests with service mocks, accessible-call validation before scoring, explicit result bounds and no DSR writes. Test UI navigation, validation, stale requests, empty/error states and cross-view actions. Run focused lint and type checks and inspect the rendered desktop/mobile dashboard when local preview permits.

## Future needs and extension points

Institution-wide collaboration discovery needs an explicit privacy/consent policy before broadening profile access. Server-synced saved searches, opt-in alerts, team shortlists, comparisons, eligibility-qualified counts, export permissions, taxonomy-version history and feedback-driven ranking can follow behind the same typed search boundary. They are not silently enabled in the first release. Evaluate relevance using expert-reviewed examples across schools and publication-only profiles. Existing DSR matching audit issues remain separate unless directly needed for this dashboard.

## Implementation and validation record

- Implemented `/discovery`, a dashboard product card and a workspace navigation entry; existing specialist pages remain available.
- Added protected call and people discovery APIs with canonical-ID validation and the existing tenant/managed-school fence. People lookup includes sparse profiles for tenant-wide callers; unplaced people cannot be attributed to a scoped school.
- Preserved DSR counts by making semantic exploration read-only (`recordRun: false`). Standard results are paginated at 12; semantic suggestions are capped at 50 and labelled as bounded. Imported calls that require release show that state before an allocation workflow is offered.
- Included retrieved publication and saved-interest evidence in researcher reranking, added active-user retrieval filtering, and versioned the census fingerprint for these scoring inputs.
- Saved searches are browser-local and account-scoped. Shared links contain query context, not result records, and never grant permission.
- Validated with 69 focused unit checks, including the catalogue guard/manifest, plus a PostgreSQL read-only CTE probe confirming generated directory SQL, tenant/school isolation, inactive-user exclusion, literal lookup and sparse-profile handling.
- Verified the four tasks, person-to-calls transition, school selection, stale-response cancellation, keyboard tabs and mobile overflow in Chromium with synthetic API fixtures. No live search provider calls or production writes were used. Screenshots are in `outputs/research-discovery/`.
- The browser verification script expects a local preview on port 3065 (override `DISCOVERY_PREVIEW_URL`) and Playwright (`PLAYWRIGHT_MODULE` can point to an available package). All API responses are intercepted with fixtures.
- Full type checking currently has the pre-existing `organisationReview.ts:27` / `proposeResearchAreas` argument-count failure from the existing `ai.ts` edit. Do not silently undo that unrelated edit. Production deployment has not been performed for this feature.
