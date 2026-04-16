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
