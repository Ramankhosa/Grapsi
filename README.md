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
