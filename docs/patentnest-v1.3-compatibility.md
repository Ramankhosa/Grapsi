# PatentNest / SpotIPR v1.3 compatibility

Contract checked against the SpotIPR implementation in the adjacent `spotipr`
checkout and the live `https://patentnest.ai/api/v1/openapi.json` (version 1.3.0).

Grapsi's Patent Search supports both existing semantic searches and structured
field/date searches. Use **By fields and dates** to search without a query, sort
all matches by publication, filing or grant date or title, and follow result pages.
With a structured query, text matches literal substrings in title or abstract.
The existing sidebar facets and semantic shortlist sorting apply to the current
page only; the form's corpus filters run upstream before results are selected.

Supported corpus filters: title, abstract, publication/application identifiers,
applicants, inventors, classification prefixes, and inclusive filing/publication/
grant date ranges. Filters combine with AND; alternatives within a field combine
with OR. Enter alternatives with `|` so applicant names can contain commas.
Office selection accepts comma-separated codes (e.g. `IN,US,EP`) or `*` for every
enabled office; availability depends on PatentNest configuration and client access.

The client accepts the complete v1.3 request, including `fields`, and selected
fields on detail lookup. Grapsi's authenticated search and lookup routes forward selected
fields; the UI requests full records for inspection and saving. PatentNest always
retains publication identity and source attribution on sparse responses.

Semantic search remains a ranked shortlist with a maximum of 50 results and no
paging. Structured search returns individual publications, with a maximum page
size of 50 and offsets through 10,000. Grapsi follows the server's `nextOffset`
and displays the browse cap separately from the end of results. Cache keys include
mode, filters, sort, selected fields, office scope and offset. Failed or malformed
pages never become cached empty results.

Recorded grant dates, family identifiers, family-match provenance, source licence
and attribution survive normalization, shortlisting, citations and CSV exports.
New CSV columns are appended after the existing columns. Existing saved records
remain readable. Grant dates are never inferred from publication dates or kind
codes. Coverage manifests display source counts, office scope and limitations.

Existing idea-intelligence and reviewer searches keep their India-only scope via
`searchIndianPatents`. API keys remain server-side. Search/lookup retain the existing
rate limits and caching; they do not invoke the paid AI-analysis endpoints.
Unavailable offices produce a correctable search error rather than a sign-in error.

`PATENTNEST_SEARCH_JURISDICTION_FILTER` now defaults to enabled. Set it to `false`
only for an older staging origin; explicit office restrictions then fail locally
instead of being silently discarded. See `.env.example` for deployment settings.

Verification:

```powershell
node node_modules/tsx/dist/cli.cjs scripts/verify-patentnest-v13.ts
node node_modules/vitest/vitest.mjs run src/tests/unit/patentnest-client.test.ts src/tests/unit/patentnest-v13.test.ts src/tests/unit/patent-intelligence-service.test.ts src/tests/unit/patent-intelligence-core.test.ts src/tests/unit/patent-intelligence-routes.test.ts src/tests/unit/patent-shortlist.test.ts src/tests/unit/patent-error-copy.test.ts src/tests/unit/reviewer-landscape.test.ts src/tests/unit/reviewer-landscape-budget.test.ts
```

The smoke check verifies the live OpenAPI contract and, when the local environment
has a key, runs read-only structured search, next-page and selected-field lookup
checks. The development mock also implements the v1.3 contract for offline UI QA.

Verified on 2026-11-03: all 116 focused tests passed, TypeScript passed, and the
changed code passed ESLint. Browser QA against the local mock passed filter-only
search, worldwide scope, next-page navigation, saved attribution, detail/back
navigation and mobile layout. The live OpenAPI check passed; authenticated live
checks could not complete because the configured local key returned HTTP 401.

Deployment hardening adds a 256 KB streamed-body limit, HTTPS-only upstream
origins (loopback HTTP for local development), disabled credential redirects,
private/no-store responses, shared search/lookup rate limits, and CSV formula
neutralization. Security patches update Next.js to 14.2.35, NextAuth to 4.24.15
and Undici to 7.30.1. The unused image optimizer is disabled at configuration
and middleware levels; ordinary image files remain available. The repository
contains no Server Actions. Existing unrelated dependency advisories require
separate assessment; these measures are not a claim of a vulnerability-free app.

The production credential was accepted on 2026-11-03: live Indian hybrid search,
selective structured search and selected-field lookup returned 200. A broad
unindexed title search hit PatentNest's 15-second database bound and returned
503; narrower identifier/date filters succeeded. The expanded local validation
passes 143 checks across eleven suites.
