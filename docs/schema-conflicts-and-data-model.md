# Schema Conflicts And Target Data Model

## Why Shared Runtime Migration Is Unsafe

GrantMentor and Papsi already conflict structurally:

- both map `users`
- both map `projects`
- GrantMentor expects NextAuth `accounts` and `sessions`
- Grapsi/Papsi expects JWT + `refresh_tokens`
- role models differ
- ID conventions differ
- tenant ownership exists in Grapsi but not in GrantMentor grant flows

Because of that, Grapsi must own the migrated schema independently.

## Immediate Schema Principles

- No reuse of GrantMentor table names by pointing both apps at one DB.
- New funding/grant models live only in Grapsi Prisma.
- Use Grapsi naming conventions with mapped snake_case columns.
- Do not preserve GrantMentor IDs as primary keys in v1.

## Required Existing-Model Fixes

### Project

Current risk:

- `Project` lacks explicit `tenantId`
- route handlers are inconsistent about owner/collaborator checks

Required fix:

- add `tenantId` to `Project`
- backfill existing projects from owner tenant
- centralize project membership/access checks

### Entitlements

Current risk:

- existing entitlement model is patent/paper-oriented
- grant features would drift if forced through `IDEATION`

Required fix:

- add dedicated grant/funding feature, service, and task enums
- update route-service mapping
- update quota and metering helpers

## New Funding Models

Planned models:

- `FundingCall`
- `FundingImportJob`
- `FundingImportExtraction`
- `FundingCallTemplate`
- `FundingCallTemplateRevision`
- `FundingCallTemplateAsset`
- `FundingCallTemplateRun`
- `FundingCallGuideline`
- `FundingCallGuidelineRevision`
- `FundingCallGuidelineRun`
- `FundingChatConversation`
- `FundingChatMessage`

Required ownership fields:

- `visibility`
- `ownerTenantId`
- `createdByUserId`
- `updatedByUserId`

Visibility values:

- `GLOBAL_PUBLISHED`
- `TENANT_PRIVATE`

## New Grant Models

Planned models:

- `GrantSession`
- `GrantPrepSession`
- `GrantPrepMessage`
- `GrantBlueprint`
- `GrantSectionDraft`
- `GrantStructuredFieldResponse`

Every grant entity should carry:

- `projectId`
- `tenantId`
- creator/updater user IDs

## Template Compiler Contract

Replace the old GrantMentor-specific `compiled_papsi_json` idea with a Grapsi-native compiled contract:

- `compiled_grant_template_json`

It should drive:

- blueprint generation
- section typing
- section ordering
- structured field rendering
- export assembly

## Section Types

First-class section types:

- `narrative`
- `short_answer`
- `checklist`
- `table`
- `budget_rows`

## Grant Prep Hardening Requirements

Port with fixes, not verbatim:

- sanitize marker payload field shapes before persistence
- auto-refresh prep sessions when approved template/guideline revisions change
- prevent dependency-invalid stage disables
- preserve per-stage selection source
- avoid weak fallback template evidence creating false stage enablement

## Verification Checklist

- Prisma migration adds grant/funding models without touching old GrantMentor DB.
- Project tenant ownership is explicit.
- Funding and grant records are tenant-safe.
- Blueprint compiler consumes `compiled_grant_template_json`.
- Structured sections persist without being forced into prose.
