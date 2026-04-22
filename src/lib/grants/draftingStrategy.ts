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

const TWO_PASS_SEMANTICS = new Set<GrantSectionSemantic>([
  'problem_need',
  'methodology',
  'workplan',
  'evaluation',
  'impact_outcomes',
  'sustainability',
  'risk',
])

const ONE_PASS_TEMPLATE_INTENTS = new Set<GrantTemplateIntent>(['team', 'eligibility'])

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

  if (sectionType === 'short_answer') {
    return { mode: 'one_pass', reason: 'short_answer sections stay one-pass.' }
  }

  if (grantSemantic === 'summary') {
    return { mode: 'one_pass', reason: 'summary sections stay one-pass.' }
  }

  if (ONE_PASS_TEMPLATE_INTENTS.has(templateIntent as GrantTemplateIntent)) {
    return {
      mode: 'one_pass',
      reason: `${templateIntent} sections default to one-pass reviewer drafting.`,
    }
  }

  if (characterLimit && characterLimit <= 1500) {
    return { mode: 'one_pass', reason: 'tight character limit favors one-pass drafting.' }
  }

  if (wordBudget && wordBudget <= 250) {
    return { mode: 'one_pass', reason: 'short word budget favors one-pass drafting.' }
  }

  if (requiredPointCount > 0 && requiredPointCount <= 2 && authoritativePrepPointCount <= 2) {
    return {
      mode: 'one_pass',
      reason: 'limited required points and limited authoritative prep support one-pass drafting.',
    }
  }

  if (sectionType === 'narrative' && TWO_PASS_SEMANTICS.has(grantSemantic as GrantSectionSemantic)) {
    return {
      mode: 'two_pass',
      reason: `${grantSemantic} narrative sections benefit from draft-then-reviewer-polish.`,
    }
  }

  if (wordBudget && wordBudget >= 350) {
    return { mode: 'two_pass', reason: 'longer section budget benefits from two-pass drafting.' }
  }

  if (requiredPointCount >= 3) {
    return { mode: 'two_pass', reason: 'multiple required points benefit from two-pass drafting.' }
  }

  if (authoritativePrepPointCount >= 3) {
    return { mode: 'two_pass', reason: 'dense authoritative prep support benefits from two-pass drafting.' }
  }

  if (evidenceLoad >= 4) {
    return { mode: 'two_pass', reason: 'higher evidence load benefits from two-pass drafting.' }
  }

  return { mode: 'one_pass', reason: 'defaulting to one-pass drafting for compact grant sections.' }
}
