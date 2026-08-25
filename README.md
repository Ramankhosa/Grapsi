# Grapsi

Grapsi is the new implementation repo for the Papsi-based grant platform cutover.

Current repo state:

- bootstrapped from a full copy of Papsi
- detached from the old `papsi.git` remote
- being extended with the funding and grant domain from GrantMentor
- standardizing on Grapsi/Papsi auth, tenancy, and service access

## Migration Direction

Grapsi will absorb these product areas:

- funding directory
- funding chatbot
- funding call ingestion
- templates and guidelines
- grant ideation and grant prep
- grant blueprint and grant drafting

GrantMentor is a logic reference during migration, not the runtime host for migrated features.

## Planning Docs

See:

- `docs/grant-migration-master-plan.md`
- `docs/auth-cutover-and-route-override.md`
- `docs/schema-conflicts-and-data-model.md`

## Current Base App

The copied base app already contains:

- Papsi authentication and tenant model
- project and drafting infrastructure
- ideation and blueprint interaction patterns
- quota and service access controls

The next implementation phase is to add the funding/grant vertical on top of that base.

## Funding Document Intelligence

The funding-call document intelligence layer is controlled by `FEATURE_FUNDING_DOC_INTELLIGENCE` and is off by default. Related optional environment variables:

- `FUNDING_DOCUMENTS_UPLOAD_PATH`: local storage root for uploaded funding-call PDF/DOCX files. Defaults to `public/uploads/funding-documents`.
- `FUNDING_DOC_MAX_BYTES`: maximum upload size. Defaults to 20 MB.
- `FUNDING_DOC_CHUNK_TOKENS`: target section-aware chunk size. Defaults to 512 estimated tokens.
- `FUNDING_DOC_CHUNK_OVERLAP`: within-section chunk overlap. Defaults to 64 estimated tokens.

Document embeddings use the existing `EMBEDDING_PROVIDER`, `VOYAGE_*`, and Google embedding variables through `EmbeddingService`.

## PatentNest Indian Patent Corpus

Idea Intelligence uses PatentNest as its primary Indian-patent source and keeps the existing SerpAPI/Google Patents search as a fallback and supplementary global source. If no PatentNest key is configured, Idea Intelligence continues through SerpAPI.

The integration uses the server-only client in `src/lib/patentnest/client.ts`. Generate a `pn_live_...` key and add it to `.env.local` for development or the server's secret manager for production:

```dotenv
PATENTNEST_API_KEY=pn_live_replace_with_your_key
```

Do not use a `NEXT_PUBLIC_` variable for this credential. Restart the Next.js server after configuring it.

### Patent Search UI

Grant writers can search the PatentNest corpus directly at `/funding/intelligence/patents` (Funding Intelligence module, `FUNDING_INTELLIGENCE` entitlement): semantic search with client-side facets, a detail page per publication number, and a per-user shortlist (`patent_shortlist_items`) that exports as Markdown citations or CSV for the proposal's prior-art section. Searches are deliberately **not** metered in the usage ledger; a per-user limiter (`PATENT_SEARCH_RATE_LIMIT_PER_MIN`, default 20/min), a global bucket (`PATENT_SEARCH_GLOBAL_RATE_LIMIT_PER_MIN`, default 25/min) and a short result cache (`PATENT_SEARCH_CACHE_MS`) protect the shared PatentNest key instead. `PATENTNEST_API_BASE_URL` overrides the origin for staging; `PATENTNEST_SEARCH_JURISDICTION_FILTER` must stay `false` until the public API accepts a `jurisdictions` request field.

To exercise the UI without a real key, run `node scripts/dev/patentnest-mock-server.js` (port 4010) and start the app with `PATENTNEST_API_KEY=pn_live_mock PATENTNEST_API_BASE_URL=http://localhost:4010` (the `grapsi-dev-patentmock` entry in `.claude/launch.json` does exactly this).
