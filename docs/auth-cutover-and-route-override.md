# Auth Cutover And Route Override

## Decision

Grapsi uses the Papsi auth model only:

- JWT access token
- refresh token cookie
- tenant/platform scope
- Papsi social-login linking

GrantMentor NextAuth is out of scope for migrated features.

## Rules

- Every migrated API authenticates through Grapsi JWT only.
- No migrated route trusts GrantMentor cookies, NextAuth session state, or GrantMentor OAuth callbacks.
- Same-email users across old apps are treated as Grapsi users only in v1.
- Legacy GrantMentor grant/funding pages must eventually redirect into Grapsi or show read-only deprecation state.

## Required Changes

### Auth

- Keep existing Grapsi login and social login flow.
- Do not implement a GrantMentor-to-Grapsi session bridge.
- Ensure migrated pages fail closed when no Grapsi auth token is present.

### Access Control

Add dedicated grant-related product access:

- `FeatureCode.FUNDING_DISCOVERY`
- `FeatureCode.GRANT_PREP`
- `FeatureCode.GRANT_DRAFTING`

- `ServiceType.FUNDING_DISCOVERY`
- `ServiceType.GRANT_PREP`
- `ServiceType.GRANT_DRAFTING`

Add grant-related task codes for metering/model policy:

- `FUNDING_CHAT`
- `FUNDING_TEMPLATE_EXTRACT`
- `FUNDING_GUIDELINE_EXTRACT`
- `GRANT_PREP_CHAT`
- `GRANT_BLUEPRINT_GENERATE`
- `GRANT_SECTION_GENERATE`

### Routes

Canonical Grapsi pages:

- `/funding`
- `/projects/[projectId]/grants/[grantId]/prep`
- `/projects/[projectId]/grants/[grantId]/blueprint`
- `/projects/[projectId]/grants/[grantId]/draft`

Legacy GrantMentor routes, once ported, should redirect here rather than serving independent logic.

## Failure Cases To Prevent

- User authenticated in GrantMentor but not in Grapsi can access migrated routes.
- Tenant with no entitlement can still hit funding/grant APIs.
- Platform admin bypasses tenant project context and drafts against tenant data directly.
- Collaborator access is checked by email only instead of stable project membership.

## Verification

- Logged-out user is redirected to Grapsi login.
- Grapsi password user can enter migrated routes.
- Grapsi social-login user can enter migrated routes.
- Tenant without grant/funding entitlement is rejected at route/API level.
- Project owner and collaborator checks work under the same tenant only.
