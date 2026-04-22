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
import {
  getPrepStageKeysForGrantSemantic,
  getPrepStageKeysForTemplateIntent,
  shouldTrustTemplateIntent,
  templateIntentToGrantSemantic,
} from '@/lib/grants/templateIntent'
import { isGrantSectionAutoDraftable } from '@/lib/grants/workflowMode'
import type {
  GrantComplianceReport,
  GrantBlueprintDimensionType,
  GrantBlueprintPlanSection,
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
const EVIDENCE_SIGNAL_PATTERN = /\b(evidence|literature|research|prior work|state of the art|benchmark|baseline|gap|need|burden|demand|validation|feasibility|comparison|comparative|impact|outcome|adoption|evaluation|novel|innovation|problem|challenge|beneficiar)\b/i
const STRONG_EVIDENCE_SIGNAL_PATTERN = /\b(literature|research|prior work|state of the art|benchmark|baseline|validation|comparison|comparative|burden|prevalence|evaluation)\b/i
const OPERATIONAL_SECTION_PATTERN = /\b(objective|goal|aim|target|timeline|milestone|deliverable|work package|task breakdown|staffing|governance|management structure|committee|oversight|implementation schedule)\b/i
const NARRATIVE_PROMPT_PATTERN = /\b(detailed|description|project plan|work ?plan|deliverable|timeline|functioning|implementation|approach|methodology|impact|outcome|innovation)\b/i

const SEMANTIC_HINTS: Record<GrantSectionSemantic, string[]> = {
  summary: ['summary', 'executive', 'synopsis', 'abstract', 'proposal overview', 'project overview', 'overview'],
  problem_need: ['problem', 'need', 'need statement', 'background', 'rationale', 'justification', 'introduction'],
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

function normalizeDimensionPhrase(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/[.:;]+$/g, '')
    .replace(LEADING_IMPERATIVES, '')
    .replace(/\b(this section|the proposal|the project)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return null

  const lowered = cleaned.toLowerCase()
  if (EDITORIAL_WORDS.has(lowered)) return null
  if (lowered.length < 12) return null

  if (
    !/(evidence|need|gap|method|approach|feasibility|impact|outcome|alignment|risk|deliverable|milestone|evaluation|validation|capacity|adoption|readiness|beneficiar|sustainab|scalab|benchmark|baseline|justification|governance|ecosystem|translation|innovation)/i.test(lowered)
  ) {
    return sentenceCase(`evidence for ${lowered}`)
  }

  return sentenceCase(lowered)
}

function inferDimensionType(value: string): GrantBlueprintDimensionType {
  const lowered = value.toLowerCase()
  if (/(risk|gap|limitation|barrier|challenge|constraint|unmet|bottleneck)/.test(lowered)) {
    return 'gap'
  }
  if (/(method|approach|protocol|evaluation|validation|work package|milestone|implementation|execution|deliverable|timeline|governance|operations)/.test(lowered)) {
    return 'methodological'
  }
  if (/(comparison|baseline|alternative|benchmark|alignment|positioning|fit with)/.test(lowered)) {
    return 'comparative'
  }
  if (/(impact|outcome|demand|beneficiar|feasibility|performance|adoption|readiness|evidence|capacity|translation|sustainab|scale|innovation)/.test(lowered)) {
    return 'empirical'
  }
  return 'foundational'
}

function buildSectionText(section: GrantBlueprintPlanSection): string {
  return [
    section.label,
    section.purpose,
    section.reviewerIntent || '',
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
  const evidenceSignal = EVIDENCE_SIGNAL_PATTERN.test(text)
  const strongEvidenceSignal = STRONG_EVIDENCE_SIGNAL_PATTERN.test(text)
  const operationalSignal = OPERATIONAL_SECTION_PATTERN.test(text)
  const narrativePromptSignal = NARRATIVE_PROMPT_PATTERN.test(text)
  const callFitOnly = /(alignment|mission|priority|fit|relevance)/.test(text)
    && !/(gap|need|baseline|benchmark|compar|evidence|literature|research)/.test(text)

  switch (semantic) {
    case 'problem_need':
      return lengthTier === 'long' || strongEvidenceSignal ? 'heavy' : 'medium'
    case 'methodology':
      if (operationalSignal && !evidenceSignal && /(timeline|milestone|deliverable|work package)/.test(text)) {
        return shortAnswer ? 'none' : 'light'
      }
      return lengthTier === 'long' || strongEvidenceSignal ? 'heavy' : 'medium'
    case 'innovation':
      return strongEvidenceSignal || lengthTier !== 'short' ? 'heavy' : 'medium'
    case 'evaluation':
      return strongEvidenceSignal ? 'medium' : 'light'
    case 'impact_outcomes':
      return strongEvidenceSignal || lengthTier !== 'short' ? 'medium' : 'light'
    case 'summary':
      if (veryTight) return 'none'
      if (shortAnswer && narrativePromptSignal) return 'light'
      return strongEvidenceSignal ? 'medium' : 'light'
    case 'objectives':
      if (veryTight || (shortAnswer && !evidenceSignal)) return 'none'
      return evidenceSignal ? 'light' : 'none'
    case 'alignment':
      if (callFitOnly && !narrativePromptSignal) return 'none'
      if (shortAnswer && narrativePromptSignal) return 'light'
      return evidenceSignal ? 'light' : 'none'
    case 'workplan':
      if (!evidenceSignal && operationalSignal && !narrativePromptSignal) return 'none'
      if (shortAnswer && narrativePromptSignal) return 'light'
      return shortAnswer ? 'none' : 'light'
    case 'sustainability':
      return strongEvidenceSignal ? 'medium' : 'light'
    case 'risk':
      return evidenceSignal ? 'light' : 'none'
    default:
      if (veryTight && !evidenceSignal) return 'none'
      if (shortAnswer && narrativePromptSignal) return 'light'
      if (evidenceSignal) return shortAnswer ? 'light' : 'medium'
      return shortAnswer ? 'none' : 'light'
  }
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
  if (/(overview|proposal overview|project overview|program overview|high level overview)/.test(text)) {
    scores.set('summary', (scores.get('summary') || 0) + 4)
  }
  if (/(problem statement|need statement|unmet need|root cause|pain point|challenge landscape)/.test(text)) {
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
  semantic: GrantSectionSemantic
): Array<{ dimension: string; type: GrantBlueprintDimensionType }> {
  const topicAnchor = buildTopicAnchor(context)
  const callAnchor = buildCallAnchor(context)
  const candidates: Array<{ dimension: string; type: GrantBlueprintDimensionType }> = []

  const seedPhrases = dedupeStrings(
    [
      ...section.mustCover,
      ...section.label.split(SECTION_LABEL_SPLIT).map((item) => item.trim()),
      ...section.purpose.split(SECTION_LABEL_SPLIT).map((item) => item.trim()),
      ...String(section.reviewerIntent || '').split(SECTION_LABEL_SPLIT).map((item) => item.trim()),
    ].filter(Boolean)
  )

  for (const seed of seedPhrases) {
    const normalized = normalizeDimensionPhrase(seed)
    if (!normalized) continue
    candidates.push({
      dimension: normalized,
      type: inferDimensionType(normalized),
    })
  }

  const defaultsBySemantic: Record<GrantSectionSemantic, Array<{ dimension: string; type: GrantBlueprintDimensionType }>> = {
    summary: [
      { dimension: `Problem landscape and strategic need for ${topicAnchor}`, type: 'foundational' },
      { dimension: `Evidence base supporting the proposed intervention model for ${topicAnchor}`, type: 'empirical' },
      { dimension: 'Execution readiness and delivery feasibility of the proposed program', type: 'methodological' },
      { dimension: 'Expected outcomes, beneficiaries, and measurable impact pathways', type: 'empirical' },
      { dimension: `Fit of the proposed program with ${callAnchor}`, type: 'comparative' },
    ],
    problem_need: [
      { dimension: `Problem severity, demand, or opportunity landscape for ${topicAnchor}`, type: 'foundational' },
      { dimension: 'Evidence that the proposed beneficiaries face a material unmet need', type: 'empirical' },
      { dimension: 'Baseline or gap showing why current efforts remain insufficient', type: 'gap' },
      { dimension: `Alignment of the identified need with ${callAnchor}`, type: 'comparative' },
    ],
    objectives: [
      { dimension: `Unmet need or opportunity the proposal addresses in ${topicAnchor}`, type: 'gap' },
      { dimension: 'Measurable objectives and success indicators for the proposed program', type: 'empirical' },
      { dimension: 'Scope boundaries and prioritization choices for the proposed program', type: 'comparative' },
      { dimension: 'Ecosystem demand and stakeholder relevance for the proposed program', type: 'empirical' },
    ],
    methodology: [
      { dimension: 'Rationale for the proposed methodology and execution model', type: 'methodological' },
      { dimension: 'Validation and evaluation strategy for proposed outputs', type: 'methodological' },
      { dimension: 'Infrastructure, data, or partnership readiness required for execution', type: 'empirical' },
      { dimension: 'Comparative justification for the chosen technical approach', type: 'comparative' },
      { dimension: 'Delivery risks and mitigation pathways for implementation', type: 'gap' },
    ],
    workplan: [
      { dimension: 'Work package sequencing, milestones, and delivery dependencies', type: 'methodological' },
      { dimension: 'Feasibility of timelines, staffing, and resource allocation', type: 'empirical' },
      { dimension: 'Monitoring, evaluation, and governance checkpoints across execution', type: 'methodological' },
      { dimension: 'Critical risks, contingencies, and fallback pathways', type: 'gap' },
    ],
    innovation: [
      { dimension: `Distinctive innovation value relative to current practice in ${topicAnchor}`, type: 'comparative' },
      { dimension: 'Evidence that the proposed novelty is technically and operationally credible', type: 'empirical' },
      { dimension: `Strategic relevance of the innovation for ${callAnchor}`, type: 'comparative' },
    ],
    evaluation: [
      { dimension: 'Evaluation metrics and success thresholds for the proposed program', type: 'methodological' },
      { dimension: 'Evidence that the evaluation design can verify meaningful outcomes', type: 'empirical' },
      { dimension: 'Baseline or benchmark needed to interpret performance', type: 'comparative' },
    ],
    impact_outcomes: [
      { dimension: 'Expected technical, economic, or societal impact of the proposed program', type: 'empirical' },
      { dimension: 'Adoption, translation, or deployment pathway for the proposed outputs', type: 'empirical' },
      { dimension: `Contribution of the proposal to ${callAnchor}`, type: 'comparative' },
      { dimension: 'Measurable outcomes and long-term value creation', type: 'empirical' },
    ],
    alignment: [
      { dimension: `Strategic alignment of the proposal with ${callAnchor}`, type: 'comparative' },
      { dimension: 'Evidence that the proposed program addresses identified ecosystem needs', type: 'empirical' },
      { dimension: 'Distinctive positioning of the proposal relative to existing initiatives', type: 'comparative' },
    ],
    sustainability: [
      { dimension: 'Operational and financial sustainability model beyond the grant period', type: 'empirical' },
      { dimension: 'Scale-up, replication, or institutionalization pathway for proposed outputs', type: 'empirical' },
      { dimension: 'Partnership and governance structures supporting continuity', type: 'methodological' },
    ],
    risk: [
      { dimension: 'Principal technical, operational, and partnership risks', type: 'gap' },
      { dimension: 'Mitigation, contingency, and recovery pathways for critical risks', type: 'methodological' },
      { dimension: 'Evidence supporting feasibility under anticipated constraints', type: 'empirical' },
    ],
    default: [
      { dimension: `Problem context and urgency for ${topicAnchor}`, type: 'foundational' },
      { dimension: 'Evidence supporting the proposed approach and delivery model', type: 'empirical' },
      { dimension: 'Execution feasibility, dependencies, and operational readiness', type: 'methodological' },
      { dimension: 'Expected outcomes and impact measurement strategy', type: 'empirical' },
    ],
  }

  candidates.push(...defaultsBySemantic[semantic])

  return dedupeStrings(candidates.map((candidate) => candidate.dimension))
    .map((dimension) => ({
      dimension,
      type:
        candidates.find((candidate) => candidate.dimension.toLowerCase() === dimension.toLowerCase())?.type
        || inferDimensionType(dimension),
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
    return lengthTier === 'long' ? 3 : 2
  }
  if (evidenceNeed === 'medium') {
    if (lengthTier === 'short') return 2
    if (lengthTier === 'medium') return 3
    return 4
  }

  if (lengthTier === 'short') return 3
  if (lengthTier === 'medium') return 4
  return 5
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
  const densityBonus = dimensions.some((item) => item.type === 'gap' || item.type === 'comparative') ? 1 : 0
  const evidenceBonus = evidenceNeed === 'heavy' ? 2 : evidenceNeed === 'medium' ? 1 : 0
  const lengthBonus = lengthTier === 'long' ? 2 : lengthTier === 'medium' ? 1 : 0
  const semanticBonus = ['problem_need', 'methodology', 'innovation'].includes(semantic) ? 1 : 0
  const shortAnswerPenalty = section.sectionType === 'short_answer' ? 1 : 0
  const rawCount = dimensions.length + densityBonus + evidenceBonus + lengthBonus + semanticBonus - shortAnswerPenalty
  const minCount = section.sectionType === 'short_answer' ? 1 : 2
  const maxCount = section.sectionType === 'short_answer' ? 4 : 10
  return Math.max(minCount, Math.min(maxCount, rawCount))
}

function shouldRegenerateDimensions(section: GrantBlueprintPlanSection): boolean {
  if (!isGrantSectionAutoDraftable(section)) return false
  if (section.mustCoverTyping && Object.keys(section.mustCoverTyping).length > 0) return false
  if (typeof section.suggestedCitationCount === 'number') return false
  if (section.thematicBlueprint && typeof section.thematicBlueprint === 'object') return false
  return true
}

function filterPromptablePrepEvidence(items: GrantPrepEvidenceItem[]): GrantPrepEvidenceItem[] {
  return items.filter((item) => item.status === 'covered')
}

function collectMappedPrepEvidence(
  section: GrantBlueprintPlanSection,
  context: GrantBlueprintEnrichmentContext
): GrantPrepEvidenceItem[] {
  return dedupePrepEvidence(filterPromptablePrepEvidence([
    ...(context.prepEvidenceBySection?.[section.sectionKey] || []),
    ...(section.sourceTemplatePointer ? context.prepEvidenceBySection?.[section.sourceTemplatePointer] || [] : []),
  ]))
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
  semantic: GrantSectionSemantic
): GrantPrepPromptBundle | null {
  const prepEvidenceBySection = context.prepEvidenceBySection || {}
  const excludedKeys = new Set(
    dedupeStrings([section.sectionKey, section.sourceTemplatePointer || '']).map((key) => key.toLowerCase())
  )
  const relevantStageKeys = new Set(resolveRelevantPrepStageKeys(section, semantic))

  if (relevantStageKeys.size === 0) return null

  const relatedEvidence = dedupePrepEvidence(
    filterPromptablePrepEvidence(
      Object.entries(prepEvidenceBySection).flatMap(([key, items]) => {
        if (excludedKeys.has(String(key || '').trim().toLowerCase())) return []
        return items.filter((item) => relevantStageKeys.has(item.stageKey))
      })
    )
  )

  return formatPrepEvidenceBundle(relatedEvidence, { bulletLimit: 4, keywordLimit: 8 })
}

function buildPrepContextBlock(
  section: GrantBlueprintPlanSection,
  context: GrantBlueprintEnrichmentContext
): GrantPrepContextBlock | null {
  return formatPrepEvidenceBundle(collectMappedPrepEvidence(section, context))
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

function pickTopRuleTexts(
  rules: FundingGuidelineRuleItem[],
  section: GrantBlueprintPlanSection,
  semantic: GrantSectionSemantic,
  limit: number,
  options?: { includeOperational?: boolean }
) {
  return rules
    .filter((rule) => options?.includeOperational ? true : !OPERATIONAL_RULE_PATTERN.test(rule.text))
    .map((rule) => ({
      text: sentenceCase(rule.text.replace(/\s+/g, ' ').trim()),
      score: scoreRuleForSection(rule, section, semantic),
    }))
    .filter((entry) => entry.text.length > 0)
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
    const key = `${item.stageKey}:${item.pointKey}`.toLowerCase()
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

function buildSectionPrepEvidence(
  section: GrantBlueprintPlanSection,
  context: GrantBlueprintEnrichmentContext,
  _semantic: GrantSectionSemantic
): GrantPrepEvidenceItem[] {
  return collectMappedPrepEvidence(section, context)
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
          && (
            (rule.appliesTo || []).includes('all')
            || (rule.appliesTo || []).includes(semantic)
          )
        )
        .map((rule) => rule.text),
      ...(guidelinePack?.formatRules || [])
        .filter((rule) => rule.enforcementLevel === 'hard')
        .map((rule) => rule.text),
      ...(guidelinePack?.durationRules || [])
        .filter((rule) => rule.enforcementLevel === 'hard')
        .map((rule) => rule.text),
      ...(guidelinePack?.deliverableRules || [])
        .filter((rule) => rule.enforcementLevel === 'hard')
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
  if (!isGrantSectionAutoDraftable(section)) {
    return {
      ...section,
      grantSemantic: null,
      prepContextBlock: null,
      authoritativePrepBundle: null,
      relatedPrepAwareness: null,
      grantRuleProfile: null,
      grantTemplateGuidance: null,
      grantSectionComplianceContract: null,
      grantComplianceReport: null,
      reviewerReadinessReport: null,
      mustCoverTyping: undefined,
      suggestedCitationCount: null,
      thematicBlueprint: null,
    }
  }

  const semantic = resolveGrantSectionSemantic(section)
  const grantRuleProfile = buildGrantRuleProfile(section, context, semantic)
  const prepEvidence = buildSectionPrepEvidence(section, context, semantic)
  const authoritativePrepBundle = buildPrepContextBlock(section, context)
  const relatedPrepAwareness = buildRelatedPrepAwareness(section, context, semantic)
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
  const generated = evidenceNeed === 'none'
    ? []
    : buildSeedDimensions({
        ...section,
        mustCover: grantSectionComplianceContract.requiredPoints.length > 0
          ? grantSectionComplianceContract.requiredPoints
          : section.mustCover,
      }, context, semantic).slice(0, targetDimensionCount(section, evidenceNeed))

  const mustCover = regenerate
    ? generated.map((item) => item.dimension)
    : dedupeStrings(section.mustCover)
  const mustCoverTyping = regenerate
    ? Object.fromEntries(generated.map((item) => [item.dimension, item.type] as const))
    : section.mustCoverTyping
  const suggestedCitationCount = regenerate
    ? suggestCitationCount(section, generated, evidenceNeed, semantic)
    : section.suggestedCitationCount ?? section.thematicBlueprint?.suggestedCitationCount

  const thematicBlueprint: GrantThematicBlueprint = buildGrantThematicBlueprint({
    mustCover,
    mustAvoid: dedupeStrings(section.mustAvoid),
    mustCoverTyping: mustCoverTyping || undefined,
    suggestedCitationCount,
  })

  return {
    ...section,
    mustCover,
    mustAvoid: thematicBlueprint.mustAvoid,
    ...(mustCoverTyping ? { mustCoverTyping } : { mustCoverTyping: undefined }),
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
      .flatMap((section) => section.mustCover.slice(0, 2))
      .slice(0, 6)
      .map((dimension) => normalizeDimensionPhrase(dimension) || dimension)
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
