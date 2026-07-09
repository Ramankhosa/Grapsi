/**
 * Product Module Registry — single source of truth for the five plan-gated
 * application modules. Used by:
 *  - the entitlements summary (`getTenantEntitlementSummary`) and the
 *    `/api/v1/me/entitlements` endpoint that drives UI show/hide,
 *  - the super-admin plans UI (feature grouping / labels),
 *  - and as documentation of which FeatureCode(s) back each module.
 *
 * A module is considered accessible when the tenant's active plan includes at
 * least one of the module's `featureCodes` (ANY semantics). Route-level
 * enforcement (org-access-service / enforceServiceAccess) remains the source of
 * truth for individual API calls; this registry is the presentation/grouping
 * layer on top of the same FeatureCodes.
 */

import type { FeatureCode } from '@prisma/client'

export type ProductModuleKey =
  | 'FUNDING_DIRECTORY'
  | 'FUNDING_CHAT'
  | 'FUNDING_INTELLIGENCE'
  | 'GRANT_STUDIO'
  | 'GRANT_REVIEW'

export type PlanTierKey = 'STARTER' | 'PRO' | 'ENTERPRISE'

export interface ProductModule {
  key: ProductModuleKey
  name: string
  description: string
  /** FeatureCode(s) that unlock this module. ANY-of unless `requireAll`. */
  featureCodes: FeatureCode[]
  requireAll?: boolean
  /** Primary entry route for the module (used by the product chooser). */
  entryRoute: string
  /** Lowest tier that includes this module (for upgrade messaging). */
  minTier: PlanTierKey
  icon: string
}

export const PRODUCT_MODULES: Record<ProductModuleKey, ProductModule> = {
  FUNDING_DIRECTORY: {
    key: 'FUNDING_DIRECTORY',
    name: 'Funding Directory',
    description: 'Browse and filter funding calls and grant opportunities.',
    featureCodes: ['FUNDING_DISCOVERY'],
    entryRoute: '/finder',
    minTier: 'STARTER',
    icon: 'search'
  },
  FUNDING_CHAT: {
    key: 'FUNDING_CHAT',
    name: 'AI Funding Chatbot',
    description: 'Conversational assistant that recommends funding calls and answers questions.',
    featureCodes: ['FUNDING_CHAT'],
    entryRoute: '/finder?tab=ai',
    minTier: 'PRO',
    icon: 'chat'
  },
  FUNDING_INTELLIGENCE: {
    key: 'FUNDING_INTELLIGENCE',
    name: 'Funding Intelligence',
    description: 'Deep call intelligence, document Q&A, and idea intelligence over the funding corpus.',
    featureCodes: ['FUNDING_INTELLIGENCE'],
    entryRoute: '/funding/intelligence',
    minTier: 'PRO',
    icon: 'sparkles'
  },
  GRANT_STUDIO: {
    key: 'GRANT_STUDIO',
    name: 'Grant Studio',
    description: 'Create grant projects, run guided grant prep, and draft sections from a blueprint.',
    featureCodes: ['GRANT_PREP', 'GRANT_DRAFTING'],
    entryRoute: '/projects',
    minTier: 'PRO',
    icon: 'document'
  },
  GRANT_REVIEW: {
    key: 'GRANT_REVIEW',
    name: 'AI Grant Review',
    description: 'AI-powered pre-submission review of grant applications against the call rubric.',
    featureCodes: ['GRANT_REVIEW'],
    entryRoute: '/reviewer',
    minTier: 'PRO',
    icon: 'clipboard-check'
  }
}

export const PRODUCT_MODULE_LIST: ProductModule[] = Object.values(PRODUCT_MODULES)

/** Every FeatureCode referenced by a product module. */
export const MODULE_FEATURE_CODES: FeatureCode[] = Array.from(
  new Set(PRODUCT_MODULE_LIST.flatMap((m) => m.featureCodes))
)

/** Human-friendly labels for the tiers (display names only; DB codes unchanged). */
export const PLAN_TIER_LABELS: Record<PlanTierKey, string> = {
  STARTER: 'Starter',
  PRO: 'Pro',
  ENTERPRISE: 'Enterprise'
}

/** Map a stored Plan.code to a display tier, for badge/label purposes. */
export function planCodeToTier(planCode?: string | null): PlanTierKey | null {
  switch ((planCode || '').toUpperCase()) {
    case 'FREE_PLAN':
      return 'STARTER'
    case 'PRO_PLAN':
      return 'PRO'
    case 'ENTERPRISE_PLAN':
      return 'ENTERPRISE'
    default:
      return null
  }
}

/**
 * Given the set of FeatureCodes an entitlement grants, decide whether a module
 * is unlocked.
 */
export function isModuleUnlocked(module: ProductModule, grantedFeatureCodes: Set<string>): boolean {
  if (module.requireAll) {
    return module.featureCodes.every((code) => grantedFeatureCodes.has(code))
  }
  return module.featureCodes.some((code) => grantedFeatureCodes.has(code))
}
