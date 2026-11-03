# Research Discovery dashboard

## Current design — 3 November 2026

One dashboard entry, **Research Discovery**, opens three connected tabs in the existing cobalt workspace style.

| Tab | Input | Result and next action |
| --- | --- | --- |
| Calls | Directory text or a research description, with the Finder's complete filter set | Funding cards, deadlines and awards; read details in place or find aligned people |
| People | Name/email, standard areas, an expertise description, or a selected call; optional unit, designation and career-stage filters | Individual research evidence, colleague profiles and publications; find calls in that person's areas |
| Organisation | Searchable schools/departments tree, with direct and descendant counts | Unit heads, unit research areas and paginated people; browse subunits, inspect profiles or find calls for unit areas |

The former four-task interface (`calls`, `people`, `person`, `alignment`) maps into these tabs. Existing shared links and browser-local saved searches continue to open the equivalent view.

## Search rules

- Calls reuse `useFundingDirectory`, `directoryUrl` and `FundingDirectoryPanel`. Filter chips, facet controls, pagination and shared links describe the same search as Finder. Citizenship, residence and application language are available beside the other applicant filters.
- A research description uses the existing hybrid vector/text retrieval and reranking, with a paper-metadata topic request to avoid generative query expansion. All selected directory filters also apply to these suggestions. Facets describe the directory under the selected filters, rather than treating the research description as a literal directory query.
- Standard people searches use live standard-area IDs, validated server-side. They match any selected area through saved-interest links or an exact normalized profile-area label. Unit research areas never imply that every person works in that area.
- Name/email lookup and organisation browsing are ordinary paginated queries, independent of embeddings or similarity thresholds. They include active colleagues with sparse or absent researcher profiles. Identity searches include employee IDs only for privileged readers.
- Unit selections expand to active descendants unless “Include departments below this unit” is cleared. Unknown or foreign units produce an impossible filter, never an unfiltered organisation search. Colleagues with no active unit have a separate “Without an active unit” entry.
- Designation and career stage can narrow all people modes. Career-stage options are literal stored profile values; semantic retrieval preserves these exact values instead of converting an option such as `SENIOR` into a different vocabulary.
- Directory, identity and standard people results have exact filtered totals. People browsing pages contain 24 entries; identity/standard pages contain 12. The call picker is paginated at 12 rather than silently stopping at its first page.
- Semantic and call-alignment results are bounded suggestions, capped at 50 and explicitly labelled as non-exhaustive. Retrieval outages and low-confidence results remain visible. Research fit and eligibility appear as separate evidence; conflicts and missing eligibility facts are shown beside call-aligned people.
- Discovery never records a DSR matching run, allocates a call or sends notifications. Imported calls requiring release say so before an operational matching link is offered.

## Access and implementation boundaries

**Every authenticated organisation member can browse active colleagues throughout their own organisation.** This replaces the original admin/manager/funding-department browsing restriction. Tenant boundaries remain enforced server-side in people results, unit expansion, organisation counts, heads and profile reads. Inactive people and `SUPER_ADMIN`, `SUPER_ADMIN_VIEWER` and `PLATFORM_STAFF` accounts are excluded from discovery.

Reading a colleague does not grant management rights. The API returns distinct action capabilities. Employee IDs remain available to administrators, authorised heads and funding-department staff. Ordinary members cannot search by those IDs, receive them in profile payloads or see assignment controls. The existing matching workspace and allocation endpoints retain their managed-unit permissions. The department profile drawer keeps its existing default appearance and allocation behaviour.

Funding discovery retains existing entitlements, call visibility, catalogue metering and export protection. The organisation and colleague-profile endpoints are registered with catalogue protection. Profile responses are private and not cached. No schema migration is required.

## Interface and saved context

- Calls, People and Organisation are keyboard-operable ARIA tabs with arrow, Home and End navigation.
- The Calls tab uses the shared Finder filters, with a filter sheet on phones. Call details and colleague profiles open in right-hand sheets with Escape dismissal, contained keyboard focus and focus returned to the opening control.
- People cards distinguish standard links, declared profile areas and saved interests. Missing research data is labelled. Match reasons and eligibility checks do not imply availability or confirmed eligibility.
- Organisation shows arbitrary-depth active units, heads, direct/rollup counts, research areas and people. Active units under inactive parents surface as roots. Unknown shared unit links show an unavailable state.
- Searches have distinct loading, error/retry, empty and initial states. Superseded responses are cancelled or ignored. Result counts are announced without moving focus unexpectedly.
- Searches can be copied or saved in this browser, scoped to the signed-in account. Saved records contain only `{ name, link }`, never returned faculty records. Legacy `{ name, state }` entries migrate on read. Opening a link always checks the current reader's access.

## Validation record

- Discovery query/API/profile/org tests cover ordinary-member browsing, tenant and active-user fences, platform-staff exclusion, employee-ID protection, sparse profiles, unit descendants and direct-unit searches, unplaced people, literal stage filters, pagination, area validation, call visibility, semantic filter preservation, eligibility evidence and read-only matching.
- All **148 tests across 18 focused suites** passed, including Finder, search-service, catalogue-protection, eligibility and managed-scope regressions. Full TypeScript checking and focused ESLint passed without errors or warnings in the changed files.
- An isolated production build completed successfully, including its type/lint checks and static generation. Existing lint warnings elsewhere in the application remain. The normal `.next` output was not replaced.
- `scripts/verify-research-discovery-ui.cjs` runs Chromium at **1280px and 375px** with every API intercepted by synthetic fixtures. It checks filters and pagination, saved-search migration, semantic searches, profile/call sheets and keyboard focus, ordinary-member capabilities, call picking, organisation/unplaced browsing, people filters, empty/error states, stale responses, keyboard tabs and horizontal overflow.
- Preview defaults to `http://127.0.0.1:3065` (`DISCOVERY_PREVIEW_URL` may override it). `PLAYWRIGHT_MODULE` can select another installed Playwright package. Screenshots are written to `outputs/research-discovery/`. The browser script does not authenticate to a live service, write production data or invoke paid search providers.
- The earlier handoff reported 27 failures in `scripts/verify-directory-filters.ts`, including an expected 1,747 calls versus 1,601 returned after catalogue changes. That independent verifier has not been modified or treated as passing by this redesign.
- No production deployment is part of this completion.

## Future extensions

Server-synced saved searches, opt-in alerts, team shortlists, comparisons, exports, taxonomy-version history and relevance feedback can follow behind the same typed search boundary. None is enabled implicitly by member-wide browsing. Use expert-reviewed examples across schools and publication-only profiles to evaluate relevance.
