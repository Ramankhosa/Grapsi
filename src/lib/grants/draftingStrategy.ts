import type {
  GrantSectionSemantic,
  GrantTemplateIntent,
} from '@/types/grant'

export type GrantDraftingMode = 'one_pass' | 'two_pass'

export interface ResolveGrantDraftingStrategyInput {
  sectionKey?: string | null
  sectionType?: string | null
  grantSemantic?: GrantSectionSemantic | string | null
  templateIntent?: GrantTemplateIntent | string | null
  characterLimit?: number | null
  wordBudget?: number | null
  requiredPointCount?: number | null
  authoritativePrepPointCount?: number | null
  evidenceLoad?: number | null
}

interface GrantDraftingStrategyBundleLike {
  bullets?: string[] | null
}

export interface BuildGrantDraftingStrategyInputSource {
  sectionKey?: string | null
  sectionType?: string | null
  grantSemantic?: GrantSectionSemantic | string | null
  templateIntent?: GrantTemplateIntent | string | null
  characterLimit?: number | null
  wordBudget?: number | null
  mustCover?: string[] | null
  requiredPointCount?: number | null
  authoritativePrepBundle?: GrantDraftingStrategyBundleLike | null
  prepContextBlock?: GrantDraftingStrategyBundleLike | null
  authoritativePrepPointCount?: number | null
  suggestedCitationCount?: number | null
  observedEvidenceCount?: number | null
  evidenceLoad?: number | null
}

export interface GrantDraftingStrategyResolution {
  mode: GrantDraftingMode
  reason: string
}

function normalizePositiveNumber(value: unknown): number | null {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return numeric
}

export function buildGrantDraftingStrategyInput(
  input: BuildGrantDraftingStrategyInputSource
): ResolveGrantDraftingStrategyInput {
  const requiredPointCount = normalizePositiveNumber(input.requiredPointCount)
    ?? (Array.isArray(input.mustCover) ? input.mustCover.length : 0)
  const authoritativePrepPointCount = normalizePositiveNumber(input.authoritativePrepPointCount)
    ?? input.authoritativePrepBundle?.bullets?.length
    ?? input.prepContextBlock?.bullets?.length
    ?? 0
  const evidenceLoad = normalizePositiveNumber(input.evidenceLoad)
    ?? Math.max(
      normalizePositiveNumber(input.observedEvidenceCount) || 0,
      normalizePositiveNumber(input.suggestedCitationCount) || 0
    )

  return {
    sectionKey: input.sectionKey,
    sectionType: input.sectionType,
    grantSemantic: input.grantSemantic,
    templateIntent: input.templateIntent,
    characterLimit: input.characterLimit,
    wordBudget: input.wordBudget,
    requiredPointCount,
    authoritativePrepPointCount,
    evidenceLoad,
  }
}

export function resolveGrantDraftingStrategy(
  input: ResolveGrantDraftingStrategyInput
): GrantDraftingStrategyResolution {
  const sectionType = String(input.sectionType || '').trim().toLowerCase()
  const grantSemantic = String(input.grantSemantic || '').trim().toLowerCase() as GrantSectionSemantic | ''
  const templateIntent = String(input.templateIntent || '').trim().toLowerCase() as GrantTemplateIntent | ''
  const characterLimit = normalizePositiveNumber(input.characterLimit)
  const wordBudget = normalizePositiveNumber(input.wordBudget)
  const requiredPointCount = normalizePositiveNumber(input.requiredPointCount) || 0
  const authoritativePrepPointCount = normalizePositiveNumber(input.authoritativePrepPointCount) || 0
  const evidenceLoad = normalizePositiveNumber(input.evidenceLoad) || 0

  const reasons = [
    sectionType ? `sectionType=${sectionType}` : '',
    grantSemantic ? `semantic=${grantSemantic}` : '',
    templateIntent ? `intent=${templateIntent}` : '',
    characterLimit ? `characterLimit=${characterLimit}` : '',
    wordBudget ? `wordBudget=${wordBudget}` : '',
    requiredPointCount > 0 ? `requiredPoints=${requiredPointCount}` : '',
    authoritativePrepPointCount > 0 ? `prepPoints=${authoritativePrepPointCount}` : '',
    evidenceLoad > 0 ? `evidenceLoad=${evidenceLoad}` : '',
  ].filter(Boolean)

  return {
    mode: 'one_pass',
    reason: reasons.length > 0
      ? `grant drafting uses one-pass generation for all sections (${reasons.join(', ')}).`
      : 'grant drafting uses one-pass generation for all sections.',
  }
}
