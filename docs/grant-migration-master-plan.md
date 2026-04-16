# Grapsi Grant Migration Master Plan

## Objective

Use the copied Papsi app as the base and migrate the funding and grant vertical from GrantMentor into Grapsi. Papsi auth, tenancy, quotas, and App Router conventions become the source of truth. GrantMentor is treated as a legacy reference, not a live runtime dependency.

## Core Decisions

- Grapsi is the implementation repo.
- Papsi login fully overrides GrantMentor auth for migrated features.
- No GrantMentor user/session/account merge in v1.
- No shared database or dual-write period.
- Fresh-start migration only.
- Grant prep is optional but preferred as a blueprint seed.
- Funding catalog has two visibility classes:
  - `GLOBAL_PUBLISHED`
  - `TENANT_PRIVATE`

## Delivery Order

1. Auth and route cutover
2. Funding and grant schema foundation
3. Service entitlements and metering
4. Funding directory, ingestion, templates, and guidelines
5. Funding chatbot
6. Grant prep port
7. Grant blueprint and section drafting
8. Legacy GrantMentor redirects/read-only shutdown

## Product Boundaries

Move into Grapsi:

- funding directory
- funding call ingestion
- template extraction and revisioning
- guideline extraction and revisioning
- funding chatbot/finder
- grant ideation and grant prep
- grant blueprint
- grant drafting/export

Do not move in v1:

- non-grant GrantMentor features
- GrantMentor auth/session system
- historical GrantMentor user/project/grant data
- external submission portal automation

## Target Routes

- `/funding`
- `/funding/calls/[callId]`
- `/funding/imports`
- `/projects/[projectId]/grants`
- `/projects/[projectId]/grants/[grantId]/prep`
- `/projects/[projectId]/grants/[grantId]/blueprint`
- `/projects/[projectId]/grants/[grantId]/draft`

## New Capability Areas

- Funding catalog and ingestion
- Funding template and guideline compiler
- Grant prep session engine
- Grant blueprint compiler
- Grant drafting pipeline
- Export assembly in template order

## Immediate Implementation Steps

1. Add new funding/grant entitlements to Prisma enums and access-control services.
2. Add tenant ownership to Papsi `Project` and centralize project access checks.
3. Add funding and grant models to Prisma in Grapsi.
4. Port GrantMentor funding/template/guideline logic into Grapsi-native services.
5. Port grant-prep stage selection, state, prompt, and mapping logic with hardening fixes.
6. Add grant-specific blueprint and drafting services instead of reusing paper persistence.

## Acceptance Criteria

- A Papsi-authenticated user with entitlement can enter funding and grant routes in Grapsi.
- Tenant-private funding data remains tenant-isolated.
- Global funding data is visible only when enabled by entitlement.
- Grant prep can seed a grant blueprint from funding templates and captured stage outputs.
- Blueprint-driven drafting produces template-ordered grant content.
- No GrantMentor session is required anywhere in the migrated flow.
