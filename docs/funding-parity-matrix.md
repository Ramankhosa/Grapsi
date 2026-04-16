# Funding Parity Matrix

This tracks GrantMentor funding-domain modules migrated into Grapsi and how they are wired.

## Canonical copied service blocks

| GrantMentor source | Grapsi target | Status | Notes |
| --- | --- | --- | --- |
| `lib/fundingIntake/*` | `src/lib/fundingIntake/*` | active | Grapsi auth/storage/schema compatibility applied |
| `lib/fundingTemplates/*` | `src/lib/fundingTemplates/*` | active | Admin App Router routes added |
| `lib/fundingGuidelines/*` | `src/lib/fundingGuidelines/*` | active | Admin App Router routes added |
| `lib/services/fundingCatalogService.ts` | `src/lib/services/fundingCatalogService.ts` | active | `catalog_status` compatibility applied |
| `lib/services/recommendationSearchService.ts` | `src/lib/services/recommendationSearchService.ts` | active | Prisma/runtime compatibility applied |
| `lib/services/recommendationConversationService.ts` | `src/lib/services/recommendationConversationService.ts` | active | App Router routes added |
| `lib/services/researcherProfileService.ts` | `src/lib/services/researcherProfileService.ts` | active | App Router routes added |
| `lib/services/fundingAdvisorService.ts` | `src/lib/services/fundingAdvisorService.ts` | active | Legacy chatbot wrapper added |
| `lib/services/fundingCallsService.ts` | `src/lib/services/fundingCallsService.ts` | active | `catalog_status` compatibility applied |
| `lib/services/sqlToLLMConnector.ts` | `src/lib/services/sqlToLLMConnector.ts` | active | copied |
| `lib/services/responseFormattingService.ts` | `src/lib/services/responseFormattingService.ts` | active | copied |
| `lib/services/fallbackSearchService.ts` | `src/lib/services/fallbackSearchService.ts` | active | copied |
| `lib/services/resultRankingService.ts` | `src/lib/services/resultRankingService.ts` | active | TS compatibility applied |
| `lib/recommendations/*` | `src/lib/recommendations/*` | active | copied |
| `lib/researcherProfile/*` | `src/lib/researcherProfile/*` | active | copied |

## API surfaces

| GrantMentor source | Grapsi target | Status |
| --- | --- | --- |
| `pages/api/admin/funding/intake/**/*` | `src/app/api/admin/funding/intake/**/*` | active |
| `pages/api/admin/funding/calls/**/*` | `src/app/api/admin/funding/calls/**/*` | active |
| `pages/api/funding/**/*` | `src/app/api/funding/**/*` | active |
| `pages/api/recommendations/**/*` | `src/app/api/recommendations/**/*` | active |
| `pages/api/researcher/**/*` | `src/app/api/researcher/**/*` | active |
| `pages/api/chatbot/index.ts` | `src/app/api/chatbot/route.ts` | active |
| `pages/api/chatbot/funding-advisor.ts` | `src/app/api/chatbot/funding-advisor/route.ts` | active |
| `pages/api/chatbot/funding-advisor-fallback.ts` | `src/app/api/chatbot/funding-advisor-fallback/route.ts` | active |
| `pages/api/chatbot/funding-search.ts` | `src/app/api/chatbot/funding-search/route.ts` | active |
| `pages/api/chatbot/funding-detailed-analysis.ts` | `src/app/api/chatbot/funding-detailed-analysis/route.ts` | active |

## Pages and components

| GrantMentor source | Grapsi target | Status | Notes |
| --- | --- | --- | --- |
| `pages/finder.tsx` | `pages/finder.tsx` | active | NextAuth removed |
| `pages/finder/calls/[id].tsx` | `pages/finder/calls/[id].tsx` | compatibility replacement | Client-side API fetch replaces server session path |
| `pages/profile/researcher.tsx` | `pages/profile/researcher.tsx` | active | NextAuth removed |
| `pages/profile/research-areas.tsx` | `pages/profile/research-areas.tsx` | active | NextAuth removed |
| `pages/admin/funding/**/*` | `pages/admin/funding/**/*` | active | NextAuth removed, Pages auth bridge used |
| Finder/Funding/Researcher components | `src/components/*` | active | copied and wired |

## Explicit non-migrated scope

Patent-origin modules remain untouched. They are outside the funding-domain parity contract.
