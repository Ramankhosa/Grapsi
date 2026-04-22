import type { GrantPrepStageKey } from '@/lib/grantPrep/types'
import { normalizeGrantWorkflowMode } from '@/lib/grants/workflowMode'
import type {
  CompiledGrantTemplateSectionType,
  GrantSectionSemantic,
  GrantTemplateIntent,
} from '@/types/grant'
import { GRANT_TEMPLATE_INTENTS } from '@/types/grant'

const TEMPLATE_INTENT_SET = new Set<string>(GRANT_TEMPLATE_INTENTS)
const DRAFTABLE_SECTION_TYPES = new Set<CompiledGrantTemplateSectionType>(['narrative', 'short_answer'])

export const MAX_TEMPLATE_INTENT_ALTERNATES = 2
export const MAX_TRUSTED_TEMPLATE_INTENT_ALTERNATES = 1
export const TEMPLATE_INTENT_TRUST_THRESHOLD = 0.75

export const PREP_STAGE_KEYS_BY_GRANT_SEMANTIC: Record<GrantSectionSemantic, GrantPrepStageKey[]> = {
  summary: ['final_pitch', 'thrust_alignment', 'fit_and_scope', 'outcomes'],
  problem_need: ['problem_definition', 'root_cause', 'beneficiaries', 'fit_and_scope'],
  objectives: ['problem_definition', 'fit_and_scope', 'thrust_alignment', 'outcomes'],
  methodology: ['methodology', 'innovation', 'evaluation', 'risk_and_ethics'],
  workplan: ['workplan', 'methodology', 'budget_strategy', 'risk_and_ethics'],
  innovation: ['innovation', 'methodology', 'thrust_alignment'],
  evaluation: ['evaluation', 'methodology', 'outcomes'],
  impact_outcomes: ['outcomes', 'evaluation', 'sustainability_and_scale', 'beneficiaries'],
  alignment: ['fit_and_scope', 'thrust_alignment', 'final_pitch'],
  sustainability: ['sustainability_and_scale', 'outcomes', 'budget_strategy'],
  risk: ['risk_and_ethics', 'methodology', 'workplan'],
  default: ['problem_definition', 'methodology', 'outcomes'],
}

function isDraftingTemplateIntent(intent: GrantTemplateIntent | null | undefined): boolean {
  return Boolean(templateIntentToGrantSemantic(intent))
}

export function normalizeGrantTemplateIntent(value: unknown): GrantTemplateIntent | null {
  const normalized = String(value || '').trim().toLowerCase()
  return TEMPLATE_INTENT_SET.has(normalized) ? (normalized as GrantTemplateIntent) : null
}

export function normalizeGrantTemplateIntentList(
  value: unknown,
  limit = MAX_TEMPLATE_INTENT_ALTERNATES
): GrantTemplateIntent[] {
  const source = Array.isArray(value) ? value : value ? [value] : []
  const seen = new Set<string>()
  const next: GrantTemplateIntent[] = []
  for (const item of source) {
    const normalized = normalizeGrantTemplateIntent(item)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    next.push(normalized)
    if (next.length >= limit) break
  }
  return next
}

export function normalizeGrantTemplateIntentConfidence(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.max(0, Math.min(1, numeric))
}

export function templateIntentToGrantSemantic(
  intent: GrantTemplateIntent | null | undefined
): GrantSectionSemantic | null {
  switch (intent) {
    case 'summary':
    case 'problem_need':
    case 'objectives':
    case 'methodology':
    case 'workplan':
    case 'innovation':
    case 'evaluation':
    case 'impact_outcomes':
    case 'alignment':
    case 'sustainability':
    case 'risk':
      return intent
    default:
      return null
  }
}

export function isTemplateIntentCompatible(input: {
  intent: GrantTemplateIntent | null | undefined
  workflowMode?: unknown
  sectionType?: unknown
}): boolean {
  const intent = normalizeGrantTemplateIntent(input.intent)
  if (!intent || intent === 'default') return false

  const workflowMode = normalizeGrantWorkflowMode(input.workflowMode)
  const sectionType = String(input.sectionType || '').trim().toLowerCase() as CompiledGrantTemplateSectionType | ''
  const isDraftableType = DRAFTABLE_SECTION_TYPES.has(sectionType as CompiledGrantTemplateSectionType)

  if (intent === 'budget') {
    return sectionType === 'budget_rows' || workflowMode === 'app_support'
  }

  if (intent === 'attachments') {
    return sectionType === 'checklist' || workflowMode === 'team_manual'
  }

  if (intent === 'submission' || intent === 'institutional') {
    return workflowMode !== 'app_draft' || sectionType === 'checklist' || sectionType === 'table'
  }

  if (intent === 'team') {
    return workflowMode === 'team_manual' || isDraftableType
  }

  if (intent === 'eligibility') {
    return sectionType !== 'budget_rows'
  }

  if (isDraftingTemplateIntent(intent)) {
    return workflowMode === 'app_draft' && isDraftableType
  }

  return isDraftableType
}

export function shouldTrustTemplateIntent(input: {
  intent: GrantTemplateIntent | null | undefined
  confidence?: number | null
  alternates?: GrantTemplateIntent[] | null
  workflowMode?: unknown
  sectionType?: unknown
}): boolean {
  const intent = normalizeGrantTemplateIntent(input.intent)
  if (!intent || intent === 'default') return false
  if (!isTemplateIntentCompatible(input)) return false

  const confidence = normalizeGrantTemplateIntentConfidence(input.confidence)
  if (confidence === null || confidence < TEMPLATE_INTENT_TRUST_THRESHOLD) return false

  const alternates = normalizeGrantTemplateIntentList(input.alternates || [], MAX_TEMPLATE_INTENT_ALTERNATES)
    .filter((alternate) => alternate !== intent)
  // Two alternates means "multiple plausible readings", so keep the signal
  // for audit/debug but treat the intent as too ambiguous to trust.
  return alternates.length <= MAX_TRUSTED_TEMPLATE_INTENT_ALTERNATES
}

export function getPrepStageKeysForGrantSemantic(
  semantic: GrantSectionSemantic | null | undefined
): GrantPrepStageKey[] {
  if (!semantic) return PREP_STAGE_KEYS_BY_GRANT_SEMANTIC.default
  return PREP_STAGE_KEYS_BY_GRANT_SEMANTIC[semantic] || PREP_STAGE_KEYS_BY_GRANT_SEMANTIC.default
}

export function getPrepStageKeysForTemplateIntent(
  intent: GrantTemplateIntent | null | undefined
): GrantPrepStageKey[] {
  const normalized = normalizeGrantTemplateIntent(intent)
  const semantic = templateIntentToGrantSemantic(normalized)
  if (semantic) {
    return getPrepStageKeysForGrantSemantic(semantic)
  }

  switch (normalized) {
    case 'team':
      return ['team_and_partnerships']
    case 'eligibility':
      return ['fit_and_scope']
    case 'budget':
      return ['budget_strategy']
    default:
      return []
  }
}
