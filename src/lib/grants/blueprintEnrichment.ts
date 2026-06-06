import type {
  FundingGuidelineRuleItem,
  GuidelinePackDocument,
} from '@/lib/fundingGuidelines/types'
import type {
  GrantPrepStageStates,
} from '@/lib/grantPrep/types'
import { buildGrantThematicBlueprint } from '@/lib/grants/blueprintMetadata'
import {
  buildReviewerReadinessReport,
} from '@/lib/grants/compliance'
import { normalizeGrantCitationMode } from '@/lib/grants/citationMode'
import {
  getPrepStageKeysForGrantSemantic,
  getPrepStageKeysForTemplateIntent,
  shouldTrustTemplateIntent,
  templateIntentToGrantSemantic,
} from '@/lib/grants/templateIntent'
import {
  getGrantSemanticRoleOrder,
  inferGrantPersuasionRole,
  persuasionRoleToDimensionType,
  type GrantPersuasionRole,
} from '@/lib/grants/persuasionRoles'
import { isGrantSectionAutoDraftable } from '@/lib/grants/workflowMode'
import type {
  GrantComplianceReport,
  GrantBlueprintDimensionType,
  GrantBlueprintPlanSection,
  GrantCitationMode,
  GrantPrepEvidenceItem,
  GrantPrepContextBlock,
  GrantPrepPromptBundle,
  GrantRuleProfile,
  GrantSectionComplianceCheck,
  GrantSectionComplianceContract,
  GrantSectionSemantic,
  GrantTemplateGuidanceProfile,
  GrantThematicBlueprint,
  ReviewerReadinessReport,
} from '@/types/grant'

export interface GeneratedGrantProposalFoundation {
  thesisStatement: string
  centralObjective: string
  keyContributions: string[]
}

export interface GrantBlueprintEnrichmentContext {
  projectTitle?: string | null
  projectDescription?: string | null
  fundingCallTitle?: string | null
  agencyName?: string | null
  globalKeywords?: string[]
  globalCaptureSummary?: string[]
  focusAreas?: string[]
  capturedKeywords?: string[]
  prepEvidence?: GrantPrepEvidenceItem[]
  prepEvidenceBySection?: Record<string, GrantPrepEvidenceItem[]>
  stageStates?: GrantPrepStageStates | null
  guidelinePack?: GuidelinePackDocument | null
}

type CitationEvidenceNeed = 'none' | 'light' | 'medium' | 'heavy'
type SectionLengthTier = 'short' | 'medium' | 'long'

const EDITORIAL_WORDS = new Set(['overview', 'summary', 'discussion', 'coverage', 'introduction'])
const LEADING_IMPERATIVES = /^(provide|describe|explain|discuss|outline|summarize|detail|highlight|state|mention|write|prepare|include|list)\s+/i
const SECTION_LABEL_SPLIT = /[;,/]| and /i
const OPERATIONAL_RULE_PATTERN = /\b(portal|upload|attachment|annexure|signature|submit|submission|deadline|deadline extension|certificate|proof|letter of intent|loi|application form)\b/i
const CITATION_SECTION_PATTERN = /\b(introduction|intro|background|rationale|literature review|review of literature|related work|prior work|research landscape|evidence landscape|state of the art|status of the art|problem definition|problem statement|need statement|methodology|methods?|research design|study design|technical approach)\b/i
const EVIDENCE_SIGNAL_PATTERN = /\b(evidence|evidence base|literature|research|prior work|state of the art|status of the art|benchmark|baseline|gap|burden|prevalence|incidence|validation|validated|feasibility evidence|comparison|comparative|empirical|data|statistics?|published|peer-reviewed|citations?|references?|justify|justification|substantiate|substantiation)\b/i
const STRONG_EVIDENCE_SIGNAL_PATTERN = /\b(literature|research landscape|evidence landscape|prior work|state of the art|status of the art|benchmark|baseline|validation|validated|comparison|comparative|burden|prevalence|incidence|empirical|statistics?|peer-reviewed|citations?|references?)\b/i
const OPERATIONAL_SECTION_PATTERN = /\b(objective|goal|aim|target|timeline|milestone|deliverable|work package|task breakdown|staffing|governance|management structure|committee|oversight|implementation schedule)\b/i
const NARRATIVE_PROMPT_PATTERN = /\b(detailed|description|project plan|work ?plan|deliverable|timeline|functioning|implementation|approach|methodology|impact|outcome|innovation)\b/i
const READY_MADE_PILLAR_PATTERN = /^(role|effect|effects|impact|association|relationship|current state|state of the art|prevalence|burden|evidence landscape|research landscape)\b/i
const GENERIC_PILLAR_ANCHOR_PATTERN = /\b(section|proposal|project|program|reviewer|requested response|provide|describe|explain|summarize|overview|details?|approach|plan|model|expected outcomes?)\b/i

const SEMANTIC_HINTS: Record<GrantSectionSemantic, string[]> = {
  summary: ['summary', 'executive', 'synopsis', 'abstract', 'proposal overview', 'project overview', 'overview'],
  problem_need: ['problem', 'need', 'need statement', 'background', 'rationale', 'justification', 'introduction', 'literature review', 'literature', 'state of the art', 'prior work'],
  objectives: ['objective', 'aim', 'goal', 'target'],
  methodology: ['methodology', 'approach', 'technical approach', 'technical plan', 'implementation approach'],
  workplan: ['workplan', 'work plan', 'timeline', 'deliverable', 'milestone', 'execution plan'],
  innovation: ['innovation', 'novelty', 'differentiation', 'uniqueness'],
  evaluation: ['evaluation', 'assessment', 'monitoring', 'metrics', 'validation'],
  impact_outcomes: ['impact', 'outcome', 'benefit', 'results', 'beneficiaries'],
  alignment: ['alignment', 'fit', 'relevance', 'priority', 'mission'],
  sustainability: ['sustainability', 'scale', 'scale-up', 'continuity', 'translation', 'commercialization'],
  risk: ['risk', 'mitigation', 'challenge', 'ethics', 'contingency'],
  default: [],
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const item of items) {
    const normalized = item.trim().replace(/\s+/g, ' ').toLowerCase()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    output.push(item.trim().replace(/\s+/g, ' '))
  }
  return output
}

function tokenize(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
}

function sentenceCase(value: string): string {
  const text = value.trim().replace(/\s+/g, ' ')
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function cleanGrantClaimAnchor(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/[.:;]+$/g, '')
    .replace(LEADING_IMPERATIVES, '')
    .replace(/\b(this section|the proposal|the project|this proposal|our project|our proposal)\b/gi, '')
    .replace(/\b(clearly|explicitly|directly|carefully|strongly)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return null

  const lowered = cleaned.toLowerCase()
  if (EDITORIAL_WORDS.has(lowered)) return null
  if (lowered.length < 10) return null
  if (/^(section|proposal|project|grant|response)$/i.test(cleaned)) return null

  return cleaned
}

function collectClaimAnchorsFromText(value: string): string[] {
  return dedupeStrings(
    String(value || '')
      .split(SECTION_LABEL_SPLIT)
      .map((item) => cleanGrantClaimAnchor(item))
      .filter(Boolean) as string[]
  )
}

function collectPrepClaimAnchors(
  section: GrantBlueprintPlanSection,
  context: GrantBlueprintEnrichmentContext
): string[] {
  const prepEvidence = collectMappedPrepEvidence(section, context)
  const factAnchors = prepEvidence.flatMap((item) => [
    item.label,
    ...item.factBullets,
    ...item.keywords.map((keyword) => `${item.label}: ${keyword}`),
    ...item.thrustLinkage.map((keyword) => `${item.label}: ${keyword}`),
  ])

  return dedupeStrings(
    factAnchors
      .map((item) => cleanGrantClaimAnchor(item))
      .filter(Boolean) as string[]
  )
}

function scoreAnchorForRole(anchor: string, role: GrantPersuasionRole): number {
  const lowered = anchor.toLowerCase()
  const specificityBonus = Math.min(18, Math.floor(anchor.length / 8))
  const numericBonus = /\b\d/.test(lowered) ? 12 : 0
  const keywordBonus = (() => {
    switch (role) {
      case 'proves_need':
        return /(prevalence|incidence|burden|cost|baseline|urgency|affected|population|demand|need|malnutrition|undernutrition|stunting|wasting|morbidity|mortality)/.test(lowered) ? 16 : 0
      case 'shows_gap':
        return /(gap|limitation|barrier|challenge|insufficient|constraint|unmet|shortfall|state of art|state of the art|evidence landscape|research landscape)/.test(lowered) ? 18 : 0
      case 'validates_approach':
        return /(validation|validated|evaluation|measure|metric|indicator|protocol|benchmark|reliability)/.test(lowered) ? 18 : 0
      case 'supports_feasibility':
        return /(feasib|implementation|pilot|deployment|operational|delivery|readiness|adoption)/.test(lowered) ? 18 : 0
      case 'quantifies_impact':
        return /(impact|outcome|improvement|effect|reduction|increase|benefit|result|performance|development|growth|cognitive|cognition|physical)/.test(lowered) ? 18 : 0
      case 'establishes_precedent':
        return /(compar|precedent|baseline|current practice|alternative|benchmark|advantage)/.test(lowered) ? 18 : 0
      case 'policy_alignment':
        return /(policy|strategy|framework|priority|roadmap|mission|scheme|alignment)/.test(lowered) ? 18 : 0
      default:
        return 0
    }
  })()
  const genericPenalty = /(important|relevant|overview|discussion|description|details?)$/.test(lowered) ? 10 : 0
  return specificityBonus + numericBonus + keywordBonus - genericPenalty
}

function hasMeaningfulTokenOverlap(left: string, right: string): boolean {
  const leftTokens = new Set(tokenize(left))
  if (leftTokens.size === 0) return false
  return tokenize(right).some((token) => leftTokens.has(token))
}

function primaryTopicFromAnchor(topicAnchor: string): string {
  return topicAnchor
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)[0]
    || topicAnchor.trim()
    || 'the proposed program'
}

function normalizeLiteraturePillarAnchor(anchor: string, topicAnchor: string): string {
  const colonParts = anchor.split(':').map((part) => part.trim()).filter(Boolean)
  const colonAnchor = colonParts.length > 1 && tokenize(colonParts[0]).length <= 4
    ? colonParts[colonParts.length - 1]
    : anchor
  const cleaned = colonAnchor
    .replace(/\b(the proposal|this proposal|the project|this project|the program|this program|our project|our proposal|proposed)\b/gi, '')
    .replace(/\b(evidence for|evidence on|discussion of|description of|overview of)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.:;]+$/g, '')
  const fallback = primaryTopicFromAnchor(topicAnchor)

  if (!cleaned || cleaned.length < 8) return fallback
  if (GENERIC_PILLAR_ANCHOR_PATTERN.test(cleaned) && !hasMeaningfulTokenOverlap(cleaned, fallback)) {
    return fallback
  }
  return cleaned
}

function buildSemanticFallbackAnchor(
  role: GrantPersuasionRole,
  semantic: GrantSectionSemantic,
  topicAnchor: string,
  callAnchor: string
): string {
  switch (role) {
    case 'proves_need':
      return semantic === 'problem_need'
        ? `burden and prevalence of ${topicAnchor}`
        : `need and baseline conditions for ${topicAnchor}`
    case 'shows_gap':
      return `current state of art and unresolved gaps in ${topicAnchor}`
    case 'validates_approach':
      return semantic === 'evaluation'
        ? `measurement and validation methods for ${topicAnchor}`
        : `methods and benchmarks for ${topicAnchor}`
    case 'supports_feasibility':
      return `implementation feasibility of ${topicAnchor}`
    case 'quantifies_impact':
      return `outcomes associated with ${topicAnchor}`
    case 'establishes_precedent':
      return semantic === 'innovation'
        ? `current practice and comparable innovations in ${topicAnchor}`
        : `related interventions relevant to ${topicAnchor}`
    case 'policy_alignment':
      return `${topicAnchor} and ${callAnchor}`
    default:
      return topicAnchor
  }
}

function buildGrantEvidencePillar(input: {
  role: GrantPersuasionRole
  anchor: string
  topicAnchor: string
  callAnchor: string
  semantic: GrantSectionSemantic
}): string {
  const anchor = normalizeLiteraturePillarAnchor(input.anchor, input.topicAnchor)
  const primaryTopic = primaryTopicFromAnchor(input.topicAnchor)
  if (READY_MADE_PILLAR_PATTERN.test(anchor)) {
    return sentenceCase(anchor)
  }

  switch (input.role) {
    case 'proves_need':
      return sentenceCase(`Burden, prevalence, and current state of ${anchor}`)
    case 'shows_gap':
      return sentenceCase(`Current state of art and unresolved gaps in ${anchor}`)
    case 'validates_approach':
      return sentenceCase(`Validation methods and benchmarks for ${anchor}`)
    case 'supports_feasibility':
      return sentenceCase(`Implementation feasibility and adoption evidence for ${anchor}`)
    case 'quantifies_impact':
      if (!hasMeaningfulTokenOverlap(anchor, primaryTopic)) {
        return sentenceCase(`Role of ${primaryTopic} in ${anchor}`)
      }
      return sentenceCase(`Outcome evidence associated with ${anchor}`)
    case 'establishes_precedent':
      return sentenceCase(`Comparable interventions and precedent for ${anchor}`)
    case 'policy_alignment':
      return sentenceCase(
        input.semantic === 'alignment'
          ? `Policy and program fit between ${anchor} and ${input.callAnchor}`
          : `Policy and program evidence linking ${anchor} with ${input.callAnchor}`
      )
    default:
      return sentenceCase(anchor)
  }
}

function inferDimensionType(
  value: string,
  semantic?: GrantSectionSemantic | null,
  fallback?: GrantBlueprintDimensionType | null
): GrantBlueprintDimensionType {
  return fallback
    || persuasionRoleToDimensionType(
      inferGrantPersuasionRole({
        dimension: value,
        semantic,
      })
    )
}

function buildDimensionTyping(
  dimensions: string[],
  semantic: GrantSectionSemantic,
  existing?: Record<string, GrantBlueprintDimensionType>
): Record<string, GrantBlueprintDimensionType> | undefined {
  if (dimensions.length === 0) return undefined

  return Object.fromEntries(
    dimensions.map((dimension) => [
      dimension,
      existing?.[dimension] || inferDimensionType(dimension, semantic),
    ] as const)
  )
}

function buildSectionText(section: GrantBlueprintPlanSection): string {
  return [
    section.label,
    section.purpose,
    section.reviewerIntent || '',
    ...(section.dimensions || []),
    section.mustCover.join(' '),
  ]
    .join(' ')
    .toLowerCase()
}

function resolveSectionLengthTier(section: GrantBlueprintPlanSection): SectionLengthTier {
  const wordBudget = typeof section.wordBudget === 'number' ? section.wordBudget : 0
  const characterLimit = typeof section.characterLimit === 'number' ? section.characterLimit : 0

  if (wordBudget >= 700 || characterLimit >= 4500) return 'long'
  if (wordBudget >= 250 || characterLimit >= 1800) return 'medium'
  return 'short'
}

function inferCitationEvidenceNeed(
  section: GrantBlueprintPlanSection,
  semantic: GrantSectionSemantic
): CitationEvidenceNeed {
  const text = buildSectionText(section)
  const lengthTier = resolveSectionLengthTier(section)
  const shortAnswer = section.sectionType === 'short_answer'
  const veryTight = (typeof section.wordBudget === 'number' && section.wordBudget > 0 && section.wordBudget <= 120)
    || (typeof section.characterLimit === 'number' && section.characterLimit > 0 && section.characterLimit <= 900)
  const citationSection = CITATION_SECTION_PATTERN.test(text)
  const evidenceSignal = EVIDENCE_SIGNAL_PATTERN.test(text)
  const strongEvidenceSignal = STRONG_EVIDENCE_SIGNAL_PATTERN.test(text)
  const operationalSignal = OPERATIONAL_SECTION_PATTERN.test(text)
  const callFitOnly = /(alignment|mission|priority|fit|relevance)/.test(text)
    && !/(gap|need|baseline|benchmark|compar|evidence|literature|research)/.test(text)

  if (veryTight && !citationSection && !strongEvidenceSignal) return 'none'

  switch (semantic) {
    case 'problem_need':
      return lengthTier === 'long' || strongEvidenceSignal || citationSection ? 'heavy' : 'medium'
    case 'methodology':
      if (operationalSignal && !evidenceSignal && /(timeline|milestone|deliverable|work package)/.test(text)) {
        return citationSection && !shortAnswer ? 'medium' : 'none'
      }
      return lengthTier === 'long' || strongEvidenceSignal ? 'heavy' : 'medium'
    case 'innovation':
      return strongEvidenceSignal || /\b(current practice|comparison|comparative|benchmark|prior work|substantiat)/.test(text)
        ? (lengthTier === 'short' ? 'light' : 'medium')
        : 'none'
    case 'evaluation':
      return strongEvidenceSignal || /\b(validation|validated|benchmark|indicator reliability|measurement validity|evaluation evidence)\b/.test(text)
        ? (lengthTier === 'long' ? 'medium' : 'light')
        : 'none'
    case 'impact_outcomes':
      return strongEvidenceSignal || /\b(outcome evidence|impact evidence|effect size|baseline|quantif|statistics?)\b/.test(text)
        ? (lengthTier === 'long' ? 'medium' : 'light')
        : 'none'
    case 'summary':
      if (citationSection) return strongEvidenceSignal || lengthTier === 'long' ? 'medium' : 'light'
      return strongEvidenceSignal ? 'light' : 'none'
    case 'objectives':
      return evidenceSignal ? 'light' : 'none'
    case 'alignment':
      if (callFitOnly) return 'none'
      return evidenceSignal ? 'light' : 'none'
    case 'workplan':
      if (!evidenceSignal || operationalSignal) return 'none'
      return shortAnswer ? 'none' : 'light'
    case 'sustainability':
      return strongEvidenceSignal ? 'light' : 'none'
    case 'risk':
      return evidenceSignal ? 'light' : 'none'
    default:
      if (citationSection) return lengthTier === 'long' || strongEvidenceSignal ? 'medium' : 'light'
      if (evidenceSignal) return shortAnswer ? 'light' : 'medium'
      return 'none'
  }
}

export function isGrantBlueprintSectionCitationWorthy(section: GrantBlueprintPlanSection): boolean {
  if (!isGrantSectionAutoDraftable(section)) return false
  const semantic = resolveGrantSectionSemantic(section)
  return inferCitationEvidenceNeed(section, semantic) !== 'none'
}

function classifyGrantSectionSemantic(section: GrantBlueprintPlanSection): GrantSectionSemantic {
  const text = buildSectionText(section)
  const scores = new Map<GrantSectionSemantic, number>(
    (Object.keys(SEMANTIC_HINTS) as GrantSectionSemantic[]).map((semantic) => [semantic, 0])
  )

  for (const semantic of Object.keys(SEMANTIC_HINTS) as GrantSectionSemantic[]) {
    if (semantic === 'default') continue
    for (const hint of SEMANTIC_HINTS[semantic]) {
      if (!hint || !text.includes(hint)) continue
      const weight = hint.includes(' ') ? 4 : 2
      scores.set(semantic, (scores.get(semantic) || 0) + weight)
    }
  }

  if (/(summary|synopsis|abstract|executive)/.test(text)) {
    scores.set('summary', (scores.get('summary') || 0) + 5)
  }
  if (/\b(project|proposal|program|executive)?\s*(summary|synopsis|abstract)\b/.test(section.label.toLowerCase())) {
    scores.set('summary', (scores.get('summary') || 0) + 8)
  }
  if (/(overview|proposal overview|project overview|program overview|high level overview)/.test(text)) {
    scores.set('summary', (scores.get('summary') || 0) + 4)
  }
  if (/(problem statement|need statement|unmet need|root cause|pain point|challenge landscape)/.test(text)) {
    scores.set('problem_need', (scores.get('problem_need') || 0) + 5)
  }
  if (/(literature review|state of the art|prior work|research landscape|evidence landscape)/.test(text)) {
    scores.set('problem_need', (scores.get('problem_need') || 0) + 5)
  }
  if (/(objective|aim|goal|target)/.test(text)) {
    scores.set('objectives', (scores.get('objectives') || 0) + 4)
  }
  if (/(evaluation|assessment|monitoring|metric|validation)/.test(text)) {
    scores.set('evaluation', (scores.get('evaluation') || 0) + 4)
  }
  if (/(innovat|novel|differentiation)/.test(text)) {
    scores.set('innovation', (scores.get('innovation') || 0) + 6)
  }
  if (/(method|methodology|approach|technical plan|technical approach)/.test(text)) {
    scores.set('methodology', (scores.get('methodology') || 0) + 4)
  }
  if (/(work plan|workplan|timeline|deliverable|milestone|implementation plan|execution plan)/.test(text)) {
    scores.set('workplan', (scores.get('workplan') || 0) + 4)
  }
  if (/(impact|outcome|benefit|result|beneficiar)/.test(text)) {
    scores.set('impact_outcomes', (scores.get('impact_outcomes') || 0) + 4)
  }
  if (/(alignment|mission|priority|fit|relevance)/.test(text)) {
    scores.set('alignment', (scores.get('alignment') || 0) + 4)
  }
  if (/(sustainab|scale|translation|commercial|continuity)/.test(text)) {
    scores.set('sustainability', (scores.get('sustainability') || 0) + 4)
  }
  if (/(risk|challenge|mitigation|contingency|ethics)/.test(text)) {
    scores.set('risk', (scores.get('risk') || 0) + 4)
  }

  if (/(introduction|background|rationale)/.test(text)) {
    if (/(overview|summary|scope|delivery model|expected impact|key outcomes|project snapshot|program snapshot)/.test(text)) {
      scores.set('summary', (scores.get('summary') || 0) + 4)
    }
    if (/(problem|need|beneficiar|gap|justification|root cause|challenge|baseline|demand)/.test(text)) {
      scores.set('problem_need', (scores.get('problem_need') || 0) + 4)
    }
  }

  const rankedSemantics = (Object.keys(SEMANTIC_HINTS) as GrantSectionSemantic[])
    .filter((semantic) => semantic !== 'default')
    .sort((left, right) =>
      (scores.get(right) || 0) - (scores.get(left) || 0)
      || left.localeCompare(right)
    )

  const bestSemantic = rankedSemantics[0]
  if (bestSemantic && (scores.get(bestSemantic) || 0) > 0) {
    return bestSemantic
  }

  return 'default'
}

function resolveGrantSectionSemantic(section: GrantBlueprintPlanSection): GrantSectionSemantic {
  const trustedTemplateSemantic = shouldTrustTemplateIntent({
    intent: section.templateIntent,
    confidence: section.templateIntentConfidence,
    alternates: section.templateIntentAlternates,
    workflowMode: section.workflowMode,
    sectionType: section.sectionType,
  })
    ? templateIntentToGrantSemantic(section.templateIntent)
    : null

  return trustedTemplateSemantic || section.grantSemantic || classifyGrantSectionSemantic(section)
}

function buildTopicAnchor(context: GrantBlueprintEnrichmentContext): string {
  const keywordAnchor = dedupeStrings([
    ...(context.focusAreas || []),
    ...(context.globalKeywords || []),
    ...(context.capturedKeywords || []),
  ]).slice(0, 3)
  if (keywordAnchor.length > 0) {
    return keywordAnchor.join(', ')
  }

  if (context.projectTitle?.trim()) {
    return context.projectTitle.trim()
  }

  if (context.fundingCallTitle?.trim()) {
    return context.fundingCallTitle.trim()
  }

  return 'the proposed program'
}

function buildCallAnchor(context: GrantBlueprintEnrichmentContext): string {
  if (context.fundingCallTitle?.trim()) return context.fundingCallTitle.trim()
  if (context.agencyName?.trim()) return `${context.agencyName.trim()} priorities`
  return 'the funding call priorities'
}

function buildSeedDimensions(
  section: GrantBlueprintPlanSection,
  context: GrantBlueprintEnrichmentContext,
  semantic: GrantSectionSemantic,
  evaluationCriteria: string[] = []
): Array<{ dimension: string; type: GrantBlueprintDimensionType }> {
  const topicAnchor = buildTopicAnchor(context)
  const callAnchor = buildCallAnchor(context)
  const rolePlan = getGrantSemanticRoleOrder(semantic)
  const anchorCandidates = dedupeStrings([
    ...collectPrepClaimAnchors(section, context),
    ...section.mustCover.flatMap((item) => collectClaimAnchorsFromText(item)),
    ...collectClaimAnchorsFromText(section.label),
    ...collectClaimAnchorsFromText(section.purpose),
    ...collectClaimAnchorsFromText(section.reviewerIntent || ''),
    ...evaluationCriteria.flatMap((item) => collectClaimAnchorsFromText(item)),
  ])

  const usedAnchors = new Set<string>()
  const candidates: Array<{ dimension: string; type: GrantBlueprintDimensionType }> = []

  for (const role of rolePlan) {
    const anchor = anchorCandidates
      .filter((candidate) => !usedAnchors.has(candidate.toLowerCase()))
      .sort((left, right) =>
        scoreAnchorForRole(right, role) - scoreAnchorForRole(left, role)
        || right.length - left.length
        || left.localeCompare(right)
      )[0]
      || buildSemanticFallbackAnchor(role, semantic, topicAnchor, callAnchor)

    usedAnchors.add(anchor.toLowerCase())
    const dimension = buildGrantEvidencePillar({
      role,
      anchor,
      topicAnchor,
      callAnchor,
      semantic,
    })
    candidates.push({
      dimension,
      type: persuasionRoleToDimensionType(role),
    })
  }

  for (const anchor of anchorCandidates) {
    if (candidates.length >= 6) break
    const role = inferGrantPersuasionRole({
      dimension: anchor,
      semantic,
    })
    const dimension = buildGrantEvidencePillar({
      role,
      anchor,
      topicAnchor,
      callAnchor,
      semantic,
    })
    if (candidates.some((candidate) => candidate.dimension.toLowerCase() === dimension.toLowerCase())) {
      continue
    }
    candidates.push({
      dimension,
      type: inferDimensionType(dimension, semantic, persuasionRoleToDimensionType(role)),
    })
  }

  return dedupeStrings(candidates.map((candidate) => candidate.dimension))
    .map((dimension) => ({
      dimension,
      type:
        candidates.find((candidate) => candidate.dimension.toLowerCase() === dimension.toLowerCase())?.type
        || inferDimensionType(dimension, semantic),
    }))
}

function targetDimensionCount(
  section: GrantBlueprintPlanSection,
  evidenceNeed: CitationEvidenceNeed
): number {
  if (evidenceNeed === 'none') return 0

  const lengthTier = resolveSectionLengthTier(section)
  const narrativePromptSignal = NARRATIVE_PROMPT_PATTERN.test(buildSectionText(section))
  if (section.sectionType === 'short_answer') {
    if (evidenceNeed === 'light') return narrativePromptSignal ? 2 : 1
    if (evidenceNeed === 'medium') return lengthTier === 'long' ? 3 : 2
    return lengthTier === 'short' ? 2 : 3
  }

  if (evidenceNeed === 'light') {
    return lengthTier === 'short' ? 1 : 2
  }
  if (evidenceNeed === 'medium') {
    if (lengthTier === 'short') return 2
    return 3
  }

  if (lengthTier === 'short') return 3
  return 4
}

function suggestCitationCount(
  section: GrantBlueprintPlanSection,
  dimensions: Array<{ dimension: string; type: GrantBlueprintDimensionType }>,
  evidenceNeed: CitationEvidenceNeed,
  semantic: GrantSectionSemantic
): number | undefined {
  if (!isGrantSectionAutoDraftable(section)) return undefined
  if (evidenceNeed === 'none' || dimensions.length === 0) return 0

  const lengthTier = resolveSectionLengthTier(section)
  const densityBonus = semantic === 'problem_need' && dimensions.some((item) => item.type === 'gap' || item.type === 'comparative') ? 1 : 0
  const evidenceBonus = evidenceNeed === 'heavy' ? 1 : 0
  const lengthBonus = lengthTier === 'long' ? 1 : 0
  const shortAnswerPenalty = section.sectionType === 'short_answer' ? 1 : 0
  const rawCount = dimensions.length + densityBonus + evidenceBonus + lengthBonus - shortAnswerPenalty
  const minCount = section.sectionType === 'short_answer' ? 1 : 2
  const maxCount = section.sectionType === 'short_answer' ? 3 : 7
  return Math.max(minCount, Math.min(maxCount, rawCount))
}

function resolveCitationModeForEnrichedSection(input: {
  section: GrantBlueprintPlanSection
  evidenceNeed: CitationEvidenceNeed
  dimensions: string[]
  suggestedCitationCount?: number | null
}): GrantCitationMode {
  const section = input.section
  if (!isGrantSectionAutoDraftable(section)) {
    return 'no_citations'
  }

  const currentMode = normalizeGrantCitationMode(section.citationMode, {
    sectionType: section.sectionType,
    workflowMode: section.workflowMode,
    suggestedCitationCount: input.suggestedCitationCount,
  })
  if (currentMode === 'no_citations') {
    return 'no_citations'
  }

  if (currentMode === 'mapped_evidence') {
    return 'mapped_evidence'
  }

  if (
    input.evidenceNeed !== 'none'
    && input.dimensions.length > 0
    && (input.suggestedCitationCount || 0) > 0
  ) {
    return 'mapped_evidence'
  }

  return 'direct_draft'
}

function shouldRegenerateDimensions(section: GrantBlueprintPlanSection): boolean {
  if (!isGrantSectionAutoDraftable(section)) return false
  if ((section.dimensions || []).length > 0) return false
  if (section.dimensionTyping && Object.keys(section.dimensionTyping).length > 0) return false
  if (typeof section.suggestedCitationCount === 'number') return false
  if (section.thematicBlueprint && typeof section.thematicBlueprint === 'object') return false
  return true
}

function filterPromptablePrepEvidence(items: GrantPrepEvidenceItem[]): GrantPrepEvidenceItem[] {
  return items.filter((item) => item.status === 'covered')
}

function prepEvidenceKey(item: GrantPrepEvidenceItem): string {
  return `${item.stageKey}:${item.pointKey}`.toLowerCase()
}

function prepEvidenceText(item: GrantPrepEvidenceItem): string {
  return [
    item.label,
    ...(item.factBullets || []),
    ...(item.keywords || []),
    ...(item.thrustLinkage || []),
    ...(item.ruleNotes || []),
  ].join(' ')
}

function getAllPromptablePrepEvidence(context: GrantBlueprintEnrichmentContext): GrantPrepEvidenceItem[] {
  return dedupePrepEvidence(
    filterPromptablePrepEvidence(
      [
        ...(context.prepEvidence || []),
        ...Object.values(context.prepEvidenceBySection || {}).flatMap((items) => items || []),
      ]
    )
  )
}

function shouldPromotePrepEvidence(
  section: GrantBlueprintPlanSection,
  semantic: GrantSectionSemantic
): boolean {
  const text = [
    section.sectionKey,
    section.label,
    section.purpose,
    section.templateIntent || '',
  ].join(' ').toLowerCase()

  if (semantic === 'summary' || semantic === 'sustainability') return true

  return /\b(title|keywords?|subject area|summary|synopsis|abstract|sustainab|revenue|replication|scale|scale-up|any other|additional information)\b/.test(text)
}

function scorePrepEvidenceForSection(
  item: GrantPrepEvidenceItem,
  section: GrantBlueprintPlanSection,
  semantic: GrantSectionSemantic,
  relevantStageKeys: Set<string>
): number {
  let score = 0
  if (relevantStageKeys.has(item.stageKey)) score += 8
  if ((item.confidence || 0) >= 0.85) score += 2
  else if ((item.confidence || 0) >= 0.7) score += 1

  const sectionTokens = new Set(tokenize(buildSectionText(section)))
  const evidenceTokens = new Set(tokenize(prepEvidenceText(item)))
  for (const token of evidenceTokens) {
    if (sectionTokens.has(token)) score += 1
  }

  if (semantic === 'summary' && ['final_pitch', 'thrust_alignment', 'fit_and_scope', 'outcomes'].includes(item.stageKey)) {
    score += 3
  }
  if (semantic === 'sustainability' && ['sustainability_and_scale', 'outcomes', 'budget_strategy'].includes(item.stageKey)) {
    score += 3
  }

  return score
}

function collectPromotedPrepEvidence(
  section: GrantBlueprintPlanSection,
  context: GrantBlueprintEnrichmentContext,
  semantic: GrantSectionSemantic
): GrantPrepEvidenceItem[] {
  const relevantStageKeys = new Set(resolveRelevantPrepStageKeys(section, semantic))
  if (relevantStageKeys.size === 0) return []

  const allowBroadPromotion = shouldPromotePrepEvidence(section, semantic)
  const scored = getAllPromptablePrepEvidence(context)
    .filter((item) =>
      allowBroadPromotion ||
      !Array.isArray(item.sectionKeys) ||
      item.sectionKeys.length === 0
    )
    .map((item) => ({
      item,
      score: scorePrepEvidenceForSection(item, section, semantic, relevantStageKeys),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) =>
      right.score - left.score
      || (right.item.confidence || 0) - (left.item.confidence || 0)
      || prepEvidenceText(right.item).length - prepEvidenceText(left.item).length
      || prepEvidenceKey(left.item).localeCompare(prepEvidenceKey(right.item))
    )

  const limit = semantic === 'summary' ? 4 : 3
  return dedupePrepEvidence(scored.map((entry) => entry.item)).slice(0, limit)
}

function collectMappedPrepEvidence(
  section: GrantBlueprintPlanSection,
  context: GrantBlueprintEnrichmentContext,
  semantic?: GrantSectionSemantic
): GrantPrepEvidenceItem[] {
  const directEvidence = dedupePrepEvidence(filterPromptablePrepEvidence([
    ...(context.prepEvidenceBySection?.[section.sectionKey] || []),
    ...(section.sourceTemplatePointer ? context.prepEvidenceBySection?.[section.sourceTemplatePointer] || [] : []),
  ]))

  if (directEvidence.length > 0 || !semantic) return directEvidence

  return collectPromotedPrepEvidence(section, context, semantic)
}

function formatPrepEvidenceBundle(
  evidence: GrantPrepEvidenceItem[],
  options?: {
    bulletLimit?: number
    keywordLimit?: number
  }
): GrantPrepPromptBundle | null {
  if (evidence.length === 0) return null

  const bullets = dedupeStrings(
    evidence.map((item) => {
      const facts = item.factBullets.length > 0
        ? item.factBullets.slice(0, 2).join(' ; ')
        : item.keywords.slice(0, 6).join(', ')
      const thrust = item.thrustLinkage.length > 0 ? `Thrust linkage: ${item.thrustLinkage.join(', ')}` : null
      const notes = item.ruleNotes.length > 0 ? `Rule note: ${item.ruleNotes.join(' ; ')}` : null
      return [item.label, facts || 'covered in prep', thrust, notes].filter(Boolean).join(' | ')
    })
  )
    .filter((item) => !OPERATIONAL_RULE_PATTERN.test(item))
    .slice(0, options?.bulletLimit || 6)

  const keywords = dedupeStrings(
    evidence.flatMap((item) => [...item.keywords, ...item.thrustLinkage])
  ).slice(0, options?.keywordLimit || 12)

  if (bullets.length === 0 && keywords.length === 0) return null

  return {
    stageKeys: dedupeStrings(evidence.map((item) => item.stageKey)),
    bullets,
    keywords,
  }
}

function resolveRelevantPrepStageKeys(
  section: GrantBlueprintPlanSection,
  semantic: GrantSectionSemantic
): string[] {
  return dedupeStrings([
    ...getPrepStageKeysForGrantSemantic(semantic),
    ...getPrepStageKeysForTemplateIntent(section.templateIntent),
  ])
}

function buildRelatedPrepAwareness(
  section: GrantBlueprintPlanSection,
  context: GrantBlueprintEnrichmentContext,
  semantic: GrantSectionSemantic,
  authoritativeEvidence: GrantPrepEvidenceItem[] = []
): GrantPrepPromptBundle | null {
  const excludedKeys = new Set(
    dedupeStrings([section.sectionKey, section.sourceTemplatePointer || '']).map((key) => key.toLowerCase())
  )
  const authoritativeEvidenceKeys = new Set(authoritativeEvidence.map(prepEvidenceKey))
  const relevantStageKeys = new Set(resolveRelevantPrepStageKeys(section, semantic))

  if (relevantStageKeys.size === 0) return null

  const relatedEvidence = dedupePrepEvidence(
    filterPromptablePrepEvidence(
      getAllPromptablePrepEvidence(context).filter((item) => {
        const itemSectionKeys = item.sectionKeys || []
        if (itemSectionKeys.some((key) => excludedKeys.has(String(key || '').trim().toLowerCase()))) {
          return false
        }
        return (
          relevantStageKeys.has(item.stageKey)
          && !authoritativeEvidenceKeys.has(prepEvidenceKey(item))
        )
      })
    )
  )

  return formatPrepEvidenceBundle(relatedEvidence, { bulletLimit: 4, keywordLimit: 8 })
}

function buildPrepContextBlock(
  section: GrantBlueprintPlanSection,
  context: GrantBlueprintEnrichmentContext,
  semantic: GrantSectionSemantic
): GrantPrepContextBlock | null {
  return formatPrepEvidenceBundle(collectMappedPrepEvidence(section, context, semantic))
}

function scoreRuleForSection(
  rule: FundingGuidelineRuleItem,
  section: GrantBlueprintPlanSection,
  semantic: GrantSectionSemantic
): number {
  const ruleTokens = tokenize(rule.text)
  if (ruleTokens.length === 0) return 0

  const sectionTokens = new Set(tokenize(buildSectionText(section)))
  const semanticTokens = new Set(SEMANTIC_HINTS[semantic].flatMap((hint) => tokenize(hint)))
  let score = 0

  for (const token of ruleTokens) {
    if (sectionTokens.has(token)) score += 2
    if (semanticTokens.has(token)) score += 1
  }

  if (rule.importance === 'high') score += 2
  if (rule.importance === 'medium') score += 1
  if (section.reviewerIntent && rule.text.toLowerCase().includes(section.reviewerIntent.toLowerCase())) {
    score += 3
  }

  return score
}

function normalizeRoutingToken(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function routingAliases(value: unknown): string[] {
  const raw = String(value || '').trim()
  if (!raw) return []

  return dedupeStrings([
    normalizeRoutingToken(raw),
    ...raw.split(/[.\s/_-]+/g).map((part) => normalizeRoutingToken(part)),
  ]).filter(Boolean)
}

function normalizeRuleRoutingList(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : []

  return dedupeStrings(source.flatMap((item) => routingAliases(item)))
}

function buildSectionRoutingTokens(
  section: GrantBlueprintPlanSection,
  semantic: GrantSectionSemantic
): Set<string> {
  const tokens = new Set<string>()
  const add = (value: unknown) => {
    for (const alias of routingAliases(value)) {
      tokens.add(alias)
    }
  }

  add('all')
  add(semantic)
  add(section.sectionKey)
  add(section.label)
  add(section.sourceTemplatePointer)
  add(section.templateIntent)
  for (const alternate of section.templateIntentAlternates || []) add(alternate)
  for (const stageKey of getPrepStageKeysForGrantSemantic(semantic)) add(stageKey)
  for (const stageKey of getPrepStageKeysForTemplateIntent(section.templateIntent)) add(stageKey)
  for (const hint of SEMANTIC_HINTS[semantic] || []) add(hint)

  return tokens
}

function ruleRoutingScore(
  rule: FundingGuidelineRuleItem,
  section: GrantBlueprintPlanSection,
  semantic: GrantSectionSemantic
): { applies: boolean; hasSpecificRouting: boolean; score: number } {
  const sectionTokens = buildSectionRoutingTokens(section, semantic)
  const ruleWithLegacyStages = rule as FundingGuidelineRuleItem & { draftingStages?: unknown }
  const appliesTo = normalizeRuleRoutingList(rule.appliesTo)
  const draftingStages = dedupeStrings([
    ...normalizeRuleRoutingList(rule.draftingStage),
    ...normalizeRuleRoutingList(ruleWithLegacyStages.draftingStages),
  ])

  const scopedAppliesTo = appliesTo.filter((item) => item !== 'all')
  const scopedDraftingStages = draftingStages.filter((item) => item !== 'all')
  const appliesToMatches = scopedAppliesTo.filter((item) => sectionTokens.has(item))
  const draftingStageMatches = scopedDraftingStages.filter((item) => sectionTokens.has(item))
  const hasSpecificRouting = scopedAppliesTo.length > 0 || scopedDraftingStages.length > 0

  if (scopedAppliesTo.length > 0 && appliesToMatches.length === 0) {
    return { applies: false, hasSpecificRouting, score: 0 }
  }
  if (scopedDraftingStages.length > 0 && draftingStageMatches.length === 0) {
    return { applies: false, hasSpecificRouting, score: 0 }
  }

  let score = 0
  if (appliesTo.includes('all')) score += 4
  if (draftingStages.includes('all')) score += 3
  score += appliesToMatches.length * 30
  score += draftingStageMatches.length * 20
  if (rule.enforcementLevel === 'hard') score += 5
  if (rule.draftingVsSubmission === 'drafting') score += 3
  if (rule.draftingVsSubmission === 'both') score += 1

  return { applies: true, hasSpecificRouting, score }
}

function ruleAppliesToSection(
  rule: FundingGuidelineRuleItem,
  section: GrantBlueprintPlanSection,
  semantic: GrantSectionSemantic
): boolean {
  return ruleRoutingScore(rule, section, semantic).applies
}

function pickTopRuleTexts(
  rules: FundingGuidelineRuleItem[],
  section: GrantBlueprintPlanSection,
  semantic: GrantSectionSemantic,
  limit: number,
  options?: { includeOperational?: boolean }
) {
  return rules
    .filter((rule) => options?.includeOperational
      ? true
      : rule.draftingVsSubmission !== 'submission' && !OPERATIONAL_RULE_PATTERN.test(rule.text))
    .map((rule) => {
      const routing = ruleRoutingScore(rule, section, semantic)
      if (!routing.applies) return null
      const semanticScore = scoreRuleForSection(rule, section, semantic)
      return {
        text: sentenceCase(rule.text.replace(/\s+/g, ' ').trim()),
        score: routing.score + semanticScore,
        semanticScore,
        hasSpecificRouting: routing.hasSpecificRouting,
        importance: rule.importance,
        enforcementLevel: rule.enforcementLevel,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .filter((entry) =>
      entry.text.length > 0
      && (
        entry.hasSpecificRouting
        || entry.semanticScore > 0
        || entry.importance === 'high'
        || entry.enforcementLevel === 'hard'
      )
    )
    .sort((left, right) => right.score - left.score || left.text.localeCompare(right.text))
    .slice(0, limit)
    .map((entry) => entry.text)
}

function buildGrantRuleProfile(
  section: GrantBlueprintPlanSection,
  context: GrantBlueprintEnrichmentContext,
  semantic: GrantSectionSemantic
): GrantRuleProfile | null {
  const guidelinePack = context.guidelinePack
  const hardFormatConstraints = dedupeStrings([
    typeof section.wordBudget === 'number' && section.wordBudget > 0
      ? `Target approximately ${section.wordBudget} words.`
      : '',
    typeof section.characterLimit === 'number' && section.characterLimit > 0
      ? `Do not exceed ${section.characterLimit} characters.`
      : '',
  ].filter(Boolean))

  const requiredPoints = dedupeStrings([
    ...pickTopRuleTexts(guidelinePack?.mustAddress || [], section, semantic, 4),
    ...pickTopRuleTexts(guidelinePack?.deliverableRules || [], section, semantic, semantic === 'workplan' ? 3 : 2),
  ]).slice(0, 5)

  const evaluationFocus = pickTopRuleTexts(
    guidelinePack?.evaluationCriteria || [],
    section,
    semantic,
    4
  )

  const reviewerSignals = dedupeStrings([
    ...pickTopRuleTexts(guidelinePack?.reviewerSignals || [], section, semantic, 3),
    ...pickTopRuleTexts(guidelinePack?.priorities || [], section, semantic, 2),
  ]).slice(0, 4)

  const avoidRules = dedupeStrings([
    ...pickTopRuleTexts(guidelinePack?.avoid || [], section, semantic, 4),
    ...section.mustAvoid.map((rule) => sentenceCase(rule)),
  ]).slice(0, 5)

  const formatConstraints = dedupeStrings([
    ...hardFormatConstraints,
    ...pickTopRuleTexts(guidelinePack?.formatRules || [], section, semantic, 3),
    ...pickTopRuleTexts(guidelinePack?.durationRules || [], section, semantic, semantic === 'workplan' ? 2 : 1),
  ]).slice(0, 5)

  const narrativeConstraints = dedupeStrings([
    section.reviewerIntent ? sentenceCase(section.reviewerIntent) : '',
    ...pickTopRuleTexts(guidelinePack?.priorities || [], section, semantic, 3),
  ].filter(Boolean)).slice(0, 4)

  if (
    requiredPoints.length === 0
    && evaluationFocus.length === 0
    && reviewerSignals.length === 0
    && avoidRules.length === 0
    && formatConstraints.length === 0
    && narrativeConstraints.length === 0
  ) {
    return null
  }

  return {
    requiredPoints,
    evaluationFocus,
    reviewerSignals,
    avoidRules,
    formatConstraints,
    narrativeConstraints,
  }
}

function dedupePrepEvidence(items: GrantPrepEvidenceItem[]): GrantPrepEvidenceItem[] {
  const seen = new Set<string>()
  const next: GrantPrepEvidenceItem[] = []
  for (const item of items) {
    const key = prepEvidenceKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    next.push(item)
  }
  return next
}

function buildTemplateGuidanceProfile(section: GrantBlueprintPlanSection): GrantTemplateGuidanceProfile {
  if (section.grantTemplateGuidance) {
    return section.grantTemplateGuidance
  }

  return {
    pointer: section.sourceTemplatePointer || null,
    guidanceText: dedupeStrings([section.purpose, section.reviewerIntent || ''].filter(Boolean)),
    requiredFacts: dedupeStrings(section.mustCover),
    reviewerGoal: section.reviewerIntent || null,
    forbiddenMoves: dedupeStrings(section.mustAvoid),
    draftingVsSubmission: section.sectionType === 'checklist' || section.sectionType === 'budget_rows'
      ? 'both'
      : 'drafting',
  }
}

function collectBudgetPrepEvidence(
  section: GrantBlueprintPlanSection,
  context: GrantBlueprintEnrichmentContext
): GrantPrepEvidenceItem[] {
  return dedupePrepEvidence(filterPromptablePrepEvidence([
    ...(context.prepEvidenceBySection?.[section.sectionKey] || []),
    ...(section.sourceTemplatePointer ? context.prepEvidenceBySection?.[section.sourceTemplatePointer] || [] : []),
    ...(context.prepEvidence || []).filter((item) => item.stageKey === 'budget_strategy'),
  ]))
}

function enrichBudgetSection(
  section: GrantBlueprintPlanSection,
  context: GrantBlueprintEnrichmentContext
): GrantBlueprintPlanSection {
  const budgetEvidence = collectBudgetPrepEvidence(section, context)
  const budgetBundle = formatPrepEvidenceBundle(budgetEvidence, {
    bulletLimit: 8,
    keywordLimit: 12,
  })

  return {
    ...section,
    citationMode: 'no_citations',
    grantSemantic: null,
    prepContextBlock: budgetBundle,
    authoritativePrepBundle: budgetBundle,
    relatedPrepAwareness: null,
    grantRuleProfile: null,
    grantTemplateGuidance: buildTemplateGuidanceProfile(section),
    grantSectionComplianceContract: null,
    grantComplianceReport: null,
    reviewerReadinessReport: null,
    dimensions: [],
    dimensionTyping: undefined,
    mustCoverTyping: undefined,
    suggestedCitationCount: 0,
    thematicBlueprint: null,
  }
}

function buildSectionPrepEvidence(
  section: GrantBlueprintPlanSection,
  context: GrantBlueprintEnrichmentContext,
  semantic: GrantSectionSemantic
): GrantPrepEvidenceItem[] {
  return collectMappedPrepEvidence(section, context, semantic)
}

function toComplianceCheck(input: {
  key: string
  label: string
  ruleText: string
  ruleClass: GrantSectionComplianceCheck['ruleClass']
  enforcementLevel: GrantSectionComplianceCheck['enforcementLevel']
  draftingVsSubmission: GrantSectionComplianceCheck['draftingVsSubmission']
  detectorHints?: string[]
  source: GrantSectionComplianceCheck['source']
}): GrantSectionComplianceCheck {
  return {
    key: input.key,
    label: input.label,
    ruleText: input.ruleText,
    ruleClass: input.ruleClass,
    enforcementLevel: input.enforcementLevel,
    draftingVsSubmission: input.draftingVsSubmission,
    detectorHints: dedupeStrings(input.detectorHints || []),
    source: input.source,
  }
}

function buildGrantSectionComplianceContract(
  section: GrantBlueprintPlanSection,
  context: GrantBlueprintEnrichmentContext,
  semantic: GrantSectionSemantic,
  grantRuleProfile: GrantRuleProfile | null,
  prepEvidence: GrantPrepEvidenceItem[]
): GrantSectionComplianceContract {
  const templateGuidance = buildTemplateGuidanceProfile(section)
  const guidelinePack = context.guidelinePack
  const fundingCallSummary = dedupeStrings([
    context.projectTitle ? `Project: ${context.projectTitle}` : '',
    context.fundingCallTitle ? `Funding call: ${context.fundingCallTitle}` : '',
    context.agencyName ? `Agency: ${context.agencyName}` : '',
    ...(context.globalCaptureSummary || []).slice(0, 4),
    ...(context.focusAreas || []).slice(0, 4).map((item) => `Focus area: ${item}`),
  ].filter(Boolean))

  const requiredPoints = dedupeStrings([
    ...templateGuidance.requiredFacts,
    ...(grantRuleProfile?.requiredPoints || []),
    ...section.mustCover,
  ])

  const evaluationFocus = dedupeStrings([
    ...(grantRuleProfile?.evaluationFocus || []),
  ])

  const reviewerSignals = dedupeStrings([
    ...(templateGuidance.reviewerGoal ? [templateGuidance.reviewerGoal] : []),
    ...(grantRuleProfile?.reviewerSignals || []),
  ])

  const avoidRules = dedupeStrings([
    ...templateGuidance.forbiddenMoves,
    ...(grantRuleProfile?.avoidRules || []),
    ...section.mustAvoid,
  ])

  const formatConstraints = dedupeStrings([
    ...(grantRuleProfile?.formatConstraints || []),
  ])

  const narrativeConstraints = dedupeStrings([
    ...templateGuidance.guidanceText,
    ...(templateGuidance.reviewerGoal ? [templateGuidance.reviewerGoal] : []),
    ...(grantRuleProfile?.narrativeConstraints || []),
  ])

  const submissionChecklist = dedupeStrings([
    ...pickTopRuleTexts(guidelinePack?.submissionRules || [], section, semantic, 6, { includeOperational: true }),
    ...(templateGuidance.draftingVsSubmission !== 'drafting'
      ? [...templateGuidance.requiredFacts, ...templateGuidance.guidanceText]
      : []),
  ])

  const hardGuidelineChecks = dedupeStrings(
    [
      ...(guidelinePack?.mustAddress || [])
        .filter((rule) =>
          rule.enforcementLevel === 'hard'
          && rule.draftingVsSubmission !== 'submission'
          && ruleAppliesToSection(rule, section, semantic)
        )
        .map((rule) => rule.text),
      ...(guidelinePack?.formatRules || [])
        .filter((rule) => rule.enforcementLevel === 'hard' && ruleAppliesToSection(rule, section, semantic))
        .map((rule) => rule.text),
      ...(guidelinePack?.durationRules || [])
        .filter((rule) => rule.enforcementLevel === 'hard' && ruleAppliesToSection(rule, section, semantic))
        .map((rule) => rule.text),
      ...(guidelinePack?.deliverableRules || [])
        .filter((rule) => rule.enforcementLevel === 'hard' && ruleAppliesToSection(rule, section, semantic))
        .map((rule) => rule.text),
    ]
  )

  const hardChecks: GrantSectionComplianceCheck[] = [
    ...hardGuidelineChecks.map((ruleText, index) =>
      toComplianceCheck({
        key: `hard_guideline_${index + 1}`,
        label: `Guideline hard rule ${index + 1}`,
        ruleText,
        ruleClass: 'must_address',
        enforcementLevel: 'hard',
        draftingVsSubmission: 'drafting',
        source: 'guideline',
      })
    ),
    ...templateGuidance.requiredFacts.map((ruleText, index) =>
      toComplianceCheck({
        key: `template_required_fact_${index + 1}`,
        label: `Template required fact ${index + 1}`,
        ruleText,
        ruleClass: 'template_required_fact',
        enforcementLevel: 'hard',
        draftingVsSubmission: templateGuidance.draftingVsSubmission === 'submission' ? 'both' : templateGuidance.draftingVsSubmission,
        source: 'template',
      })
    ),
    ...templateGuidance.forbiddenMoves.map((ruleText, index) =>
      toComplianceCheck({
        key: `template_forbidden_move_${index + 1}`,
        label: `Template forbidden move ${index + 1}`,
        ruleText,
        ruleClass: 'template_forbidden_move',
        enforcementLevel: 'hard',
        draftingVsSubmission: 'drafting',
        source: 'template',
      })
    ),
    ...(typeof section.wordBudget === 'number' && section.wordBudget > 0
      ? [
          toComplianceCheck({
            key: 'word_budget',
            label: 'Section word budget',
            ruleText: `Do not exceed ${section.wordBudget} words.`,
            ruleClass: 'format',
            enforcementLevel: 'hard',
            draftingVsSubmission: 'drafting',
            detectorHints: ['word_limit'],
            source: 'system',
          }),
        ]
      : []),
    ...(typeof section.characterLimit === 'number' && section.characterLimit > 0
      ? [
          toComplianceCheck({
            key: 'character_limit',
            label: 'Section character limit',
            ruleText: `Do not exceed ${section.characterLimit} characters.`,
            ruleClass: 'format',
            enforcementLevel: 'hard',
            draftingVsSubmission: 'drafting',
            detectorHints: ['character_limit'],
            source: 'system',
          }),
        ]
      : []),
  ]

  const softChecks: GrantSectionComplianceCheck[] = [
    ...evaluationFocus.map((ruleText, index) =>
      toComplianceCheck({
        key: `evaluation_focus_${index + 1}`,
        label: `Evaluation focus ${index + 1}`,
        ruleText,
        ruleClass: 'evaluation',
        enforcementLevel: 'soft',
        draftingVsSubmission: 'drafting',
        source: 'guideline',
      })
    ),
    ...reviewerSignals.map((ruleText, index) =>
      toComplianceCheck({
        key: `reviewer_signal_${index + 1}`,
        label: `Reviewer signal ${index + 1}`,
        ruleText,
        ruleClass: 'reviewer_signal',
        enforcementLevel: 'soft',
        draftingVsSubmission: 'drafting',
        source: 'guideline',
      })
    ),
    ...narrativeConstraints.map((ruleText, index) =>
      toComplianceCheck({
        key: `narrative_constraint_${index + 1}`,
        label: `Narrative constraint ${index + 1}`,
        ruleText,
        ruleClass: 'template_guidance',
        enforcementLevel: 'soft',
        draftingVsSubmission: 'drafting',
        source: 'template',
      })
    ),
  ]

  return {
    requiredPoints,
    evaluationFocus,
    reviewerSignals,
    avoidRules,
    formatConstraints,
    narrativeConstraints,
    prepEvidence,
    templateGuidance,
    fundingCallSummary,
    submissionChecklist,
    hardChecks,
    softChecks,
  }
}

function buildBlueprintGrantComplianceReport(
  contract: GrantSectionComplianceContract
): GrantComplianceReport {
  const hardFailures: GrantComplianceReport['hardFailures'] = []
  const softWarnings: GrantComplianceReport['softWarnings'] = []

  if (contract.requiredPoints.length === 0) {
    hardFailures.push({
      key: 'missing_required_points',
      message: 'No section-level required points were mapped into the compliance contract.',
      source: 'system',
      ruleText: null,
    })
  }

  if (
    contract.reviewerSignals.length === 0
    && contract.evaluationFocus.length === 0
    && contract.narrativeConstraints.length === 0
  ) {
    hardFailures.push({
      key: 'missing_reviewer_guidance',
      message: 'No reviewer-facing guidance was mapped into the compliance contract.',
      source: 'system',
      ruleText: null,
    })
  }

  if (contract.prepEvidence.length === 0) {
    softWarnings.push({
      key: 'missing_prep_evidence',
      message: 'No section-scoped Grant Prep evidence was mapped into the compliance contract.',
      source: 'prep',
      ruleText: null,
    })
  }

  return {
    stage: 'blueprint',
    passed: hardFailures.length === 0,
    coveredRequiredPoints: [],
    unmetRequiredPoints: contract.requiredPoints.length === 0 ? ['Section-level required points were not mapped.'] : [],
    violatedAvoidRules: [],
    missingEvidence: contract.prepEvidence.length === 0 ? ['Section has no preserved Grant Prep evidence.'] : [],
    hardFailures,
    softWarnings,
    usedPrepEvidence: [],
    generatedAt: new Date().toISOString(),
  }
}

function enrichOneSection(
  section: GrantBlueprintPlanSection,
  context: GrantBlueprintEnrichmentContext,
  mode: 'generate' | 'hydrate'
): GrantBlueprintPlanSection {
  if (section.sectionType === 'budget_rows') {
    return enrichBudgetSection(section, context)
  }

  if (!isGrantSectionAutoDraftable(section)) {
    return {
      ...section,
      citationMode: 'no_citations',
      grantSemantic: null,
      prepContextBlock: null,
      authoritativePrepBundle: null,
      relatedPrepAwareness: null,
      grantRuleProfile: null,
      grantTemplateGuidance: null,
      grantSectionComplianceContract: null,
      grantComplianceReport: null,
      reviewerReadinessReport: null,
      dimensions: undefined,
      dimensionTyping: undefined,
      mustCoverTyping: undefined,
      suggestedCitationCount: null,
      thematicBlueprint: null,
    }
  }

  const semantic = resolveGrantSectionSemantic(section)
  const grantRuleProfile = buildGrantRuleProfile(section, context, semantic)
  const prepEvidence = buildSectionPrepEvidence(section, context, semantic)
  const authoritativePrepBundle = buildPrepContextBlock(section, context, semantic)
  const relatedPrepAwareness = buildRelatedPrepAwareness(section, context, semantic, prepEvidence)
  const prepContextBlock = authoritativePrepBundle
  const grantSectionComplianceContract = buildGrantSectionComplianceContract(
    section,
    context,
    semantic,
    grantRuleProfile,
    prepEvidence
  )
  const grantComplianceReport = buildBlueprintGrantComplianceReport(grantSectionComplianceContract)
  const reviewerReadinessReport: ReviewerReadinessReport = buildReviewerReadinessReport({
    contract: grantSectionComplianceContract,
    report: grantComplianceReport,
  })
  const regenerate = mode === 'generate' || shouldRegenerateDimensions(section)
  const evidenceNeed = inferCitationEvidenceNeed(section, semantic)
  const currentCitationMode = normalizeGrantCitationMode(section.citationMode, {
    sectionType: section.sectionType,
    workflowMode: section.workflowMode,
    suggestedCitationCount: section.suggestedCitationCount,
  })
  const citationDisabled = currentCitationMode === 'no_citations'
  const citationForced = currentCitationMode === 'mapped_evidence'
  const effectiveEvidenceNeed = citationForced && evidenceNeed === 'none'
    ? 'light'
    : evidenceNeed
  const generatedDimensions = effectiveEvidenceNeed === 'none' || citationDisabled
    ? []
    : buildSeedDimensions({
        ...section,
        mustCover: grantSectionComplianceContract.requiredPoints.length > 0
          ? grantSectionComplianceContract.requiredPoints
          : section.mustCover,
      }, context, semantic, grantRuleProfile?.evaluationFocus || []).slice(0, targetDimensionCount(section, effectiveEvidenceNeed))

  const mustCover = dedupeStrings(section.mustCover)
  const dimensions = regenerate
    ? generatedDimensions.map((item) => item.dimension)
    : effectiveEvidenceNeed === 'none' || citationDisabled
      ? []
      : dedupeStrings(section.dimensions || [])
  const dimensionTyping = regenerate
    ? Object.fromEntries(generatedDimensions.map((item) => [item.dimension, item.type] as const))
    : buildDimensionTyping(
        dimensions,
        semantic,
        section.dimensionTyping || section.thematicBlueprint?.dimensionTyping
      )
  const suggestedCitationCount = regenerate
    ? (
        citationForced
        && typeof section.suggestedCitationCount === 'number'
        && section.suggestedCitationCount > 0
          ? section.suggestedCitationCount
          : suggestCitationCount(section, generatedDimensions, effectiveEvidenceNeed, semantic)
      )
    : effectiveEvidenceNeed === 'none' || citationDisabled
      ? 0
      : section.suggestedCitationCount ?? section.thematicBlueprint?.suggestedCitationCount
  const citationMode = resolveCitationModeForEnrichedSection({
    section,
    evidenceNeed: effectiveEvidenceNeed,
    dimensions,
    suggestedCitationCount,
  })

  const thematicBlueprint: GrantThematicBlueprint = buildGrantThematicBlueprint({
    mustCover,
    mustAvoid: dedupeStrings(section.mustAvoid),
    dimensions,
    dimensionTyping: dimensionTyping || undefined,
    suggestedCitationCount,
  })

  return {
    ...section,
    citationMode,
    mustCover,
    mustAvoid: thematicBlueprint.mustAvoid,
    dimensions,
    ...(dimensionTyping ? { dimensionTyping } : { dimensionTyping: undefined }),
    mustCoverTyping: undefined,
    suggestedCitationCount: suggestedCitationCount ?? null,
    thematicBlueprint,
    grantSemantic: semantic,
    prepContextBlock,
    authoritativePrepBundle,
    relatedPrepAwareness,
    grantRuleProfile,
    grantTemplateGuidance: grantSectionComplianceContract.templateGuidance,
    grantSectionComplianceContract,
    grantComplianceReport,
    reviewerReadinessReport,
  }
}

export function enrichGrantBlueprintSections(
  sections: GrantBlueprintPlanSection[],
  context: GrantBlueprintEnrichmentContext,
  mode: 'generate' | 'hydrate' = 'generate'
): GrantBlueprintPlanSection[] {
  return sections.map((section) => enrichOneSection(section, context, mode))
}

export function shouldBackfillProposalFoundation(input?: Partial<GeneratedGrantProposalFoundation> | null): boolean {
  const thesisLength = String(input?.thesisStatement || '').trim().length
  const objectiveLength = String(input?.centralObjective || '').trim().length
  const contributions = (input?.keyContributions || []).map((item) => String(item || '').trim()).filter(Boolean)
  return thesisLength < 20 || objectiveLength < 20 || contributions.length < 2
}

export function buildGeneratedGrantProposalFoundation(
  sections: GrantBlueprintPlanSection[],
  context: GrantBlueprintEnrichmentContext
): GeneratedGrantProposalFoundation {
  const draftableSections = sections.filter((section) => isGrantSectionAutoDraftable(section))
  const topicAnchor = buildTopicAnchor(context)
  const callAnchor = buildCallAnchor(context)

  const summarySection = draftableSections.find((section) => resolveGrantSectionSemantic(section) === 'summary') || draftableSections[0]
  const objectiveSection = draftableSections.find((section) =>
    ['objectives', 'problem_need', 'alignment'].includes(resolveGrantSectionSemantic(section))
  ) || summarySection || draftableSections[0]

  const contributionSeeds = dedupeStrings(
    draftableSections
      .flatMap((section) => [...section.mustCover, ...(section.dimensions || [])].slice(0, 2))
      .slice(0, 6)
      .map((dimension) => cleanGrantClaimAnchor(dimension) || dimension)
      .filter(Boolean) as string[]
  )

  const keyContributions = dedupeStrings(
    contributionSeeds.map((dimension) => sentenceCase(dimension))
  )
    .slice(0, 3)
    .map((dimension) => `${dimension}.`)

  const safeContributions = keyContributions.length >= 2
    ? keyContributions
    : [
        `Build a proposal grounded in evidence for ${topicAnchor}.`,
        `Show execution feasibility, measurable outcomes, and alignment with ${callAnchor}.`,
      ]

  return {
    thesisStatement: sentenceCase(
      `The proposal establishes a fundable program for ${topicAnchor} by combining a credible delivery model, measurable outcomes, and clear alignment with ${callAnchor}.`
    ),
    centralObjective: sentenceCase(
      objectiveSection?.purpose
        ? objectiveSection.purpose
        : `Define how the proposed program will address ${topicAnchor} with executable work packages and defensible impact claims.`
    ),
    keyContributions: safeContributions,
  }
}

export function collectGrantCapturedKeywords(stageStates: unknown): string[] {
  if (!stageStates || typeof stageStates !== 'object') return []
  const stages = Object.values(stageStates as Record<string, unknown>)
  const keywords: string[] = []

  for (const stage of stages) {
    if (!stage || typeof stage !== 'object') continue
    const points = Array.isArray((stage as { points?: unknown[] }).points)
      ? ((stage as { points?: unknown[] }).points as unknown[])
      : []
    for (const point of points) {
      if (!point || typeof point !== 'object') continue
      const captureKeywords = Array.isArray((point as { capture?: { keywords?: unknown[] } }).capture?.keywords)
        ? ((point as { capture?: { keywords?: unknown[] } }).capture?.keywords as unknown[])
        : []
      for (const keyword of captureKeywords) {
        const value = String(keyword || '').trim()
        if (value) {
          keywords.push(value)
        }
      }
    }
  }

  return dedupeStrings(keywords)
}
