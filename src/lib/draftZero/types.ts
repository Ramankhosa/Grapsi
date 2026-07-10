import type {
  GrantPrepPointConversationRole,
  GrantPrepStageKey,
  PointPriority,
} from '@/lib/grantPrep/types'

export const DRAFT_ZERO_STATE_VERSION = 'draft_zero_v1'
export const DRAFT_ZERO_PROMPT_VERSION = 'draft-zero-extract-v1'
export const DRAFT_ZERO_AI_FILL_PROMPT_VERSION = 'draft-zero-ai-fill-v1'

/** Max characters of pasted seed material forwarded to the extraction prompt. */
export const DRAFT_ZERO_SEED_MAX_CHARS = 60000

/** Seed excerpt forwarded to the AI-fill prompt for grounding (already mined once by extraction). */
export const DRAFT_ZERO_AI_FILL_SEED_MAX_CHARS = 8000

export type DraftZeroProvenance = 'quoted' | 'inferred' | 'ai_generated'

export type DraftZeroClaimStatus = 'unconfirmed' | 'confirmed' | 'edited' | 'rejected'

export interface DraftZeroSeed {
  kind: 'paste' | 'none'
  text: string
  charCount: number
  submittedAt: string
}

export interface DraftZeroClaim {
  id: string // `${stageKey}.${pointKey}`
  stageKey: GrantPrepStageKey
  pointKey: string
  pointLabel: string
  priority: PointPriority
  conversationRole: GrantPrepPointConversationRole | null
  claimText: string
  factBullets: string[]
  keywords: string[]
  provenance: DraftZeroProvenance
  sourceQuote: string | null
  confidence: number
  spotCheck: string | null
  status: DraftZeroClaimStatus
  decidedAt: string | null
  /** Present on ai_generated claims when the AI had to assume a specific (figure, role, commitment) the researcher must verify. */
  assumption?: string | null
}

export interface DraftZeroGap {
  id: string // `${stageKey}.${pointKey}`
  stageKey: GrantPrepStageKey
  pointKey: string
  pointLabel: string
  priority: PointPriority
  ask: string
  status: 'open' | 'filled'
}

export interface DraftZeroGenerationMeta {
  clientRequestId: string
  generatedAt: string
  promptVersion: string
  seedCharCount: number
  claimCount: number
  gapCount: number
  ideaTitle: string
  ideaSummary: string
  anchorCompilationSource: 'llm' | 'deterministic_fallback'
  warnings: string[]
}

export interface DraftZeroState {
  version: typeof DRAFT_ZERO_STATE_VERSION
  seed: DraftZeroSeed
  claims: DraftZeroClaim[]
  gaps: DraftZeroGap[]
  generation: DraftZeroGenerationMeta
}

/** One entry of the point catalog handed to the extraction prompt. */
export interface DraftZeroCatalogPoint {
  stageKey: GrantPrepStageKey
  stageTitle: string
  pointKey: string
  label: string
  priority: PointPriority
  conversationRole: GrantPrepPointConversationRole | null
  helpText: string
}

/** Shape the extraction LLM is asked to return (before validation). */
export interface DraftZeroExtractionOutput {
  idea: {
    title: string
    summary: string
    problem: string
    approach: string
    beneficiaries: string
  }
  claims: Array<{
    point: string // `${stageKey}.${pointKey}`
    claim: string
    facts: string[]
    keywords: string[]
    provenance: DraftZeroProvenance
    sourceQuote: string | null
    confidence: number
    spotCheck: string | null
  }>
  gaps: Array<{
    point: string
    ask: string
  }>
}

/** Shape the AI-fill LLM is asked to return (before validation). */
export interface DraftZeroAiFillOutput {
  answers: Array<{
    point: string // `${stageKey}.${pointKey}`
    answer: string
    facts: string[]
    keywords: string[]
    confidence: number
    assumption: string | null
  }>
}

export function normalizeDraftZeroState(value: unknown): DraftZeroState | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<DraftZeroState>
  if (candidate.version !== DRAFT_ZERO_STATE_VERSION) return null
  if (!candidate.generation || !Array.isArray(candidate.claims) || !Array.isArray(candidate.gaps)) return null
  return candidate as DraftZeroState
}
