import { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'
import {
  IDEA_INTELLIGENCE_EVIDENCE_MAP_STAGE_CODE,
  IDEA_INTELLIGENCE_REFINE_STAGE_CODE,
  IDEA_INTELLIGENCE_REPORT_STAGE_CODE,
  IDEA_INTELLIGENCE_STRUCTURE_STAGE_CODE,
  IDEA_INTELLIGENCE_TASK_CODE,
  runFundingGatewayText,
} from '@/lib/funding/llmRouting'
import { extractJsonObject } from '@/lib/recommendations/conversationUtils'
import type { RecommendationAccessScope } from '@/lib/recommendations/types'
import { fundingDocumentRetrievalService } from '@/lib/fundingDocuments/retrieval'
import {
  calculateCallAlignments,
  statusValue,
  type FundingCallFacetAssessment as PureFundingCallFacetAssessment,
} from '@/lib/ideaIntelligence/callSignals'
import { VISIBLE_GRANT_PREP_STAGE_KEYS } from '@/lib/grantPrep/stageModel'
import { emptyIdeaEvidence, retrieveIdeaEvidence } from '@/lib/ideaIntelligence/evidenceSources'
import type { MultiSourceEvidence, PatentEvidence, PublicationEvidence, WebEvidence } from '@/lib/ideaIntelligence/evidenceSources'
import { IDEA_SOURCE_FLAGS, anyExternalEvidenceEnabled, type IdeaSourcesUsed } from '@/lib/ideaIntelligence/sourceFlags'
import {
  buildFacetCoverage,
  buildFundedPortfolio,
  formatBudget,
  projectStatus,
  rankAgencyRecommendations,
  type AgencyRecommendation,
  type FundedPortfolio,
  type OpenCallSummary,
  type ProjectDelivery,
} from '@/lib/ideaIntelligence/whitespace'
import {
  buildPriorWork,
  type PriorWork,
  type PriorWorkAwardExtras,
  type PriorWorkGap,
} from '@/lib/ideaIntelligence/priorWork'
import { publicProjectSearchService, type PublicProjectSearchItem } from '@/lib/publicProjects/searchService'
import { recommendationSearchService } from '@/lib/services/recommendationSearchService'

type ActorContext = {
  userId: string
  tenantId: string | null
  access: RecommendationAccessScope
}

export type StructuredIdea = {
  title: string
  problem: string
  approach: string
  intendedUsers: string
  domain: string
  trl: number | null
  facets: string[]
  keywords: string[]
  semanticQuery: string
}

type FacetStatus = 'PRESENT' | 'PARTIAL' | 'ABSENT' | 'UNASSESSED'

export type FacetAssessment = {
  facet: string
  status: FacetStatus
  evidence: string
  reason: string
}

export type ProjectAssessment = {
  projectId: string
  summary: string
  facetAssessments: FacetAssessment[]
}

type EvidenceSourceType = 'publication' | 'patent' | 'web'

export type EvidenceSourceAssessment = {
  sourceType: EvidenceSourceType
  evidenceId: string
  title: string
  summary: string
  facetAssessments: FacetAssessment[]
}

export type CrossCorpusFacetSignal = {
  facet: string
  funded: FacetStatus
  published: FacetStatus
  patented: FacetStatus
  web: FacetStatus
  signal: 'saturated' | 'translation_gap' | 'commercialization_prior_art' | 'white_space_candidate' | 'insufficient_evidence' | 'mixed'
  rationale: string
}

export type FundingCallFacetAssessment = PureFundingCallFacetAssessment

export type IdeaCallGap = {
  id: string
  kind: 'unaddressed_priority' | 'missing_methodology' | 'weak_differentiation' | 'scale_mismatch' | 'eligibility_risk' | 'missing_evidence'
  severity: 'critical' | 'major' | 'minor'
  title: string
  detail: string
  evidence: Array<{ sourceType: 'call' | 'funded_project' | 'publication' | 'patent' | 'web'; evidenceId: string; quote: string | null }>
  fixSuggestion: string
  grantPrepStageKey: string | null
}

export type IdeaReviewerObjection = {
  objection: string
  severity: 'critical' | 'major' | 'minor'
  basedOn: string
  preemption: string
  grantPrepStageKey: string | null
}

export type IdeaReviewerPersona = {
  persona: 'scientific_merit' | 'feasibility_budget' | 'societal_impact'
  personaLabel: string
  overallStance: string
  objections: IdeaReviewerObjection[]
}

export type WhitespaceEvidenceRef = {
  sourceType: 'funded_project' | 'publication' | 'patent' | 'web' | 'call'
  evidenceId: string
  quote: string | null
}

// The centrepiece output: a small number of concrete directions the sanctioned
// corpus has left open, each shown next to the work that is already funded.
export type WhitespaceDirection = {
  id: string
  title: string
  whyOpen: string
  alreadyCovered: string
  stillMissing: string
  example: {
    projectIdea: string
    whatYouWouldBuild: string
    firstProof: string
  }
  relatedFacets: string[]
  evidence: WhitespaceEvidenceRef[]
  confidence: 'strong' | 'moderate' | 'thin'
  bestFitAgency: string | null
  /**
   * Deterministic facts merged on from the prior-work pass: why the aspect
   * reads as open, what work at this size has historically cost, and how long
   * ago the neighbouring awards were sanctioned. Optional because runs made
   * before the prior-work pass existed do not carry them.
   */
  gap?: PriorWorkGap | null
}

export type FundedTheme = {
  theme: string
  projectCount: number
  agencies: string[]
  exampleProjectIds: string[]
}

type RefinementObjective = 'maximize_white_space' | 'target_funder' | 'reduce_risk'
type RefinementStrategy = 'narrow_scope' | 'pivot_facet' | 'combine_white_space' | 'funder_align' | 'de_risk'
type CitationSourceType = 'funded_project' | 'publication' | 'patent' | 'web'

type EvidenceReference = {
  sourceType: CitationSourceType
  evidenceId: string
  title: string
  text: string
}

type RefinementCitation = {
  sourceType: CitationSourceType
  evidenceId: string
  role: 'supports_gap' | 'shows_overlap' | 'shows_momentum' | 'funder_signal'
  quote: string | null
  quoteVerified: boolean
}

type RefinementCandidatePayload = {
  strategy: RefinementStrategy
  title: string
  ideaText: string
  facetChanges: Array<{
    facet: string
    change: 'kept' | 'modified' | 'dropped' | 'added'
    resultingFacet: string
  }>
  citations: RefinementCitation[]
  expectedImpact: {
    saturation: 'down' | 'flat' | 'up'
    whiteSpace: 'up' | 'flat' | 'down'
    rationale: string
    modelSaturation?: 'down' | 'flat' | 'up'
    modelWhiteSpace?: 'up' | 'flat' | 'down'
  }
  risks: string[]
  rationale: string
}

function normalizeText(value: unknown, maxLength = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function normalizeDirection(value: unknown, allowed: string[], fallback: string) {
  const normalized = String(value || '').toLowerCase().trim()
  return allowed.includes(normalized) ? normalized : fallback
}

function normalizeStrategy(value: unknown, fallback: RefinementStrategy): RefinementStrategy {
  return normalizeDirection(
    value,
    ['narrow_scope', 'pivot_facet', 'combine_white_space', 'funder_align', 'de_risk'],
    fallback
  ) as RefinementStrategy
}

function normalizeCitationSourceType(value: unknown): CitationSourceType | null {
  const normalized = String(value || '').toLowerCase().trim()
  return normalized === 'funded_project' || normalized === 'publication' || normalized === 'patent' || normalized === 'web'
    ? normalized
    : null
}

function normalizeCitationRole(value: unknown): RefinementCitation['role'] {
  return normalizeDirection(
    value,
    ['supports_gap', 'shows_overlap', 'shows_momentum', 'funder_signal'],
    'supports_gap'
  ) as RefinementCitation['role']
}

function normalizeQuoteText(value: unknown, maxLength = 260) {
  return normalizeText(value, maxLength).replace(/^["']|["']$/g, '').trim()
}

function quoteMatchesEvidence(quote: string, evidenceText: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  const normalizedQuote = normalize(quote)
  if (!normalizedQuote || normalizedQuote.length < 12) return false
  return normalize(evidenceText).includes(normalizedQuote)
}

function objectiveStrategies(objective: string): RefinementStrategy[] {
  switch (objective) {
    case 'target_funder':
      return ['funder_align', 'narrow_scope', 'combine_white_space']
    case 'reduce_risk':
      return ['de_risk', 'narrow_scope', 'pivot_facet']
    case 'maximize_white_space':
    default:
      return ['combine_white_space', 'pivot_facet', 'narrow_scope']
  }
}

function fallbackStructure(ideaText: string): StructuredIdea {
  const clean = normalizeText(ideaText, 8000)
  const phrases = clean
    .split(/[.;:\n]|\b(?:using|through|with|for|to)\b/i)
    .map((value) => normalizeText(value, 120))
    .filter((value) => value.length >= 12)
  const facets = Array.from(new Set(phrases)).slice(0, 5)
  if (facets.length < 3) {
    facets.push('Proposed technical approach', 'Target user and deployment context', 'Expected research outcome')
  }
  const keywords = Array.from(new Set((clean.toLowerCase().match(/[a-z][a-z-]{4,}/g) || []).filter((word) => !['research', 'using', 'based', 'project', 'develop'].includes(word)))).slice(0, 10)
  return {
    title: clean.split(/[.!?]/)[0].slice(0, 100) || 'Untitled research idea',
    problem: clean.slice(0, 500),
    approach: clean.slice(0, 500),
    intendedUsers: '',
    domain: keywords.slice(0, 3).join(', '),
    trl: null,
    facets: Array.from(new Set(facets)).slice(0, 7),
    keywords,
    semanticQuery: clean.slice(0, 500),
  }
}

function normalizeStructure(value: any, ideaText: string): StructuredIdea {
  const fallback = fallbackStructure(ideaText)
  const facets = Array.isArray(value?.facets)
    ? value.facets.map((item: unknown) => normalizeText(item, 180)).filter(Boolean).slice(0, 7)
    : fallback.facets
  const keywords = Array.isArray(value?.keywords)
    ? value.keywords.map((item: unknown) => normalizeText(item, 80)).filter(Boolean).slice(0, 12)
    : fallback.keywords
  return {
    title: normalizeText(value?.title, 140) || fallback.title,
    problem: normalizeText(value?.problem, 1200) || fallback.problem,
    approach: normalizeText(value?.approach, 1200) || fallback.approach,
    intendedUsers: normalizeText(value?.intendedUsers, 500),
    domain: normalizeText(value?.domain, 240) || fallback.domain,
    trl: Number.isFinite(Number(value?.trl)) ? Math.min(9, Math.max(1, Number(value.trl))) : null,
    facets: facets.length >= 3 ? facets : fallback.facets,
    keywords: keywords.length ? keywords : fallback.keywords,
    semanticQuery: normalizeText(value?.semanticQuery, 500) || fallback.semanticQuery,
  }
}

function normalizeStatus(value: unknown): FacetStatus {
  const status = String(value || '').toUpperCase()
  return status === 'PRESENT' || status === 'PARTIAL' || status === 'ABSENT' ? status : 'UNASSESSED'
}

function normalizeAnalysis(value: any, projects: PublicProjectSearchItem[], facets: string[]) {
  const projectIds = new Set(projects.map((project) => project.id))
  const rawItems = Array.isArray(value?.items) ? value.items : []
  const items: ProjectAssessment[] = rawItems
    .filter((item: any) => projectIds.has(String(item?.projectId || '')))
    .map((item: any) => ({
      projectId: String(item.projectId),
      summary: normalizeText(item.summary, 600),
      facetAssessments: facets.map((facet) => {
        const raw = Array.isArray(item.facetAssessments)
          ? item.facetAssessments.find((assessment: any) => normalizeText(assessment?.facet, 180).toLowerCase() === facet.toLowerCase())
          : null
        return {
          facet,
          status: normalizeStatus(raw?.status),
          evidence: normalizeText(raw?.evidence, 500),
          reason: normalizeText(raw?.reason, 500),
        }
      }),
    }))

  return {
    items,
    strongestOverlap: Array.isArray(value?.strongestOverlap) ? value.strongestOverlap.map((item: unknown) => normalizeText(item, 300)).filter(Boolean).slice(0, 5) : [],
    whiteSpace: Array.isArray(value?.whiteSpace) ? value.whiteSpace.map((item: unknown) => normalizeText(item, 300)).filter(Boolean).slice(0, 5) : [],
    cautions: Array.isArray(value?.cautions) ? value.cautions.map((item: unknown) => normalizeText(item, 300)).filter(Boolean).slice(0, 5) : [],
  }
}

function normalizeEvidenceItems(
  rawItems: unknown,
  sourceType: EvidenceSourceType,
  evidenceIds: Set<string>,
  facets: string[]
): EvidenceSourceAssessment[] {
  return (Array.isArray(rawItems) ? rawItems : [])
    .filter((item: any) => evidenceIds.has(String(item?.evidenceId || '')))
    .map((item: any) => ({
      sourceType,
      evidenceId: String(item.evidenceId),
      title: normalizeText(item.title, 300),
      summary: normalizeText(item.summary, 600),
      facetAssessments: facets.map((facet) => {
        const raw = Array.isArray(item.facetAssessments)
          ? item.facetAssessments.find((assessment: any) => normalizeText(assessment?.facet, 180).toLowerCase() === facet.toLowerCase())
          : null
        return {
          facet,
          status: normalizeStatus(raw?.status),
          evidence: normalizeText(raw?.evidence, 500),
          reason: normalizeText(raw?.reason, 500),
        }
      }),
    }))
}

function normalizeCrossCorpusAnalysis(
  value: any,
  projects: PublicProjectSearchItem[],
  evidence: Pick<Awaited<ReturnType<typeof retrieveIdeaEvidence>>, 'publications' | 'patents' | 'webResults'>,
  facets: string[]
) {
  const projectAnalysis = normalizeAnalysis(value, projects, facets)
  return {
    ...projectAnalysis,
    publicationItems: normalizeEvidenceItems(
      value?.publicationItems,
      'publication',
      new Set(evidence.publications.map((item) => item.id)),
      facets
    ),
    patentItems: normalizeEvidenceItems(
      value?.patentItems,
      'patent',
      new Set(evidence.patents.map((item) => item.id)),
      facets
    ),
    webItems: normalizeEvidenceItems(
      value?.webItems,
      'web',
      new Set(evidence.webResults.map((item) => item.id)),
      facets
    ),
  }
}

function fundingCallAccessWhere(access: RecommendationAccessScope): Prisma.FundingCallWhereInput {
  if (access?.isSuperAdmin) return {}
  return {
    OR: [
      {
        visibility: 'GLOBAL_PUBLISHED',
        is_active: { not: false },
        OR: [{ status: 'PUBLISHED' }, { catalog_status: 'PUBLISHED' }],
      },
      ...(access?.tenantId
        ? [{ visibility: 'TENANT_PRIVATE' as const, tenantId: access.tenantId }]
        : []),
    ],
  }
}

const ANCHORED_CALL_SELECT = {
  id: true,
  agency_name: true,
  agencyName: true,
  scheme_title: true,
  title: true,
  description: true,
  summary: true,
  eligibility_text: true,
  expected_deliverables_text: true,
  funding_kinds: true,
  disciplines: true,
  career_stages: true,
  institution_types: true,
  amount_min: true,
  amount_max: true,
  currency: true,
  close_date: true,
  is_rolling: true,
  project_duration_text: true,
  official_urls: true,
} satisfies Prisma.FundingCallSelect

export async function loadAnchoredFundingCall(callId: string, access: RecommendationAccessScope) {
  try {
    return await prisma.fundingCall.findFirst({
      where: { AND: [{ id: callId }, fundingCallAccessWhere(access)] },
      select: ANCHORED_CALL_SELECT,
    })
  } catch {
    return null
  }
}

async function loadAnchoredCallGuidelineChunks(callId: string, query: string, access: RecommendationAccessScope) {
  try {
    const chunks = await fundingDocumentRetrievalService.searchChunks({
      query,
      fundingCallId: callId,
      topK: 8,
      minSimilarity: 0.2,
      access: { tenantId: access.tenantId, isSuperAdmin: access.isSuperAdmin },
      callStatus: 'any',
    })
    return (Array.isArray(chunks) ? chunks : [])
      .map((chunk: any) => ({
        chunkId: String(chunk.chunkId || ''),
        sectionType: String(chunk.sectionType || 'other'),
        sectionTitle: chunk.sectionTitle ? String(chunk.sectionTitle) : null,
        pageStart: Number(chunk.pageStart || 0),
        pageEnd: Number(chunk.pageEnd || 0),
        text: normalizeText(chunk.chunkText, 900),
      }))
      .filter((chunk) => chunk.chunkId && chunk.text)
  } catch {
    // Document intelligence may be disabled or the call may have no embedded
    // documents; the comparison then falls back to catalog text only.
    return []
  }
}

function mapAnchoredCallForRetrieval(call: NonNullable<Awaited<ReturnType<typeof loadAnchoredFundingCall>>>) {
  return {
    id: call.id,
    agencyName: call.agency_name || call.agencyName || '',
    schemeTitle: call.scheme_title || call.title || '',
    shortDescription: normalizeText(call.description || call.summary, 600),
    closeDate: call.close_date ? call.close_date.toISOString() : null,
    isRolling: Boolean(call.is_rolling),
    amountMin: call.amount_min,
    amountMax: call.amount_max,
    currency: call.currency,
    eligibilitySummary: normalizeText(call.eligibility_text, 500),
    officialUrls: call.official_urls || [],
    score: 0,
    matchReasons: ['Anchored by you for this validation'],
  }
}

// The call text handed to the comparison model. An anchored call carries its
// full catalogue text plus retrieved guideline excerpts; any other call only has
// what the catalogue search returned.
type AnchoredCallContext = {
  id: string
  agencyName: string
  schemeTitle: string
  shortDescription?: string | null
  description?: string | null
  eligibilityText?: string | null
  deliverablesText?: string | null
  disciplines: string[]
  fundingKinds: string[]
  guidelineChunks: Array<{ sectionType: string; text: string }>
}

type ComparisonCallSource = {
  id: string
  agencyName?: string | null
  schemeTitle?: string | null
  shortDescription?: string | null
  eligibilitySummary?: string | null
}

// One call offered to the user during the funding-match step.
export type FundingMatchCall = {
  id: string
  agencyName: string
  schemeTitle: string
  shortDescription: string
  closeDate: string | null
  isRolling: boolean
  amountMin: number | null
  amountMax: number | null
  currency: string | null
  eligibilitySummary: string
  officialUrls: string[]
  score: number
  matchReasons: string[]
}

export type ComparisonCall = {
  fundingCallId: string
  role: 'anchored' | 'matched'
  agency: string | null
  scheme: string | null
  description: string | null
  eligibility: string | null
  deliverables: string | null
  disciplines: string[]
  fundingKinds: string[]
  guidelineExcerpts: Array<{ sectionType: string; text: string }>
}

function buildComparisonCallPayload(
  callId: string,
  role: 'anchored' | 'matched',
  anchoredCall: AnchoredCallContext | null,
  fundingCalls: ComparisonCallSource[]
): ComparisonCall {
  if (anchoredCall && anchoredCall.id === callId) {
    return {
      fundingCallId: callId,
      role,
      agency: anchoredCall.agencyName,
      scheme: anchoredCall.schemeTitle,
      description: anchoredCall.description || anchoredCall.shortDescription || null,
      eligibility: anchoredCall.eligibilityText || null,
      deliverables: anchoredCall.deliverablesText || null,
      disciplines: anchoredCall.disciplines.slice(0, 10),
      fundingKinds: anchoredCall.fundingKinds.slice(0, 6),
      guidelineExcerpts: anchoredCall.guidelineChunks.slice(0, 6).map((chunk) => ({
        sectionType: chunk.sectionType,
        text: chunk.text.slice(0, 700),
      })),
    }
  }
  const call = fundingCalls.find((item) => item.id === callId)
  return {
    fundingCallId: callId,
    role,
    agency: call?.agencyName || null,
    scheme: call?.schemeTitle || null,
    description: normalizeText(call?.shortDescription, 1200) || null,
    eligibility: normalizeText(call?.eligibilitySummary, 700) || null,
    deliverables: null,
    disciplines: [],
    fundingKinds: [],
    guidelineExcerpts: [],
  }
}

// Prompts must never describe a corpus that was not searched: an empty section
// invites the model to invent one, and the tokens are wasted either way.
function promptSections(sections: Array<[string, readonly unknown[]]>) {
  return sections
    .filter(([, payload]) => payload.length > 0)
    .map(([label, payload]) => `${label}:\n${JSON.stringify(payload)}`)
    .join('\n\n')
}

function promptLines(lines: Array<string | null | false>) {
  return lines.filter(Boolean).join('\n')
}

function jsonShape(parts: Array<string | null | false>) {
  return `{${parts.filter(Boolean).join(',')}}`
}

const EVIDENCE_MAP_SHAPE = {
  items: '"items":[{"projectId":"exact id","summary":"what this project actually addresses","facetAssessments":[{"facet":"exact idea facet","status":"PRESENT|PARTIAL|ABSENT|UNASSESSED","evidence":"short exact or faithful evidence from supplied text","reason":"brief comparison"}]}]',
  publicationItems: '"publicationItems":[{"evidenceId":"exact id","title":"source title","summary":"what this publication addresses","facetAssessments":[{"facet":"exact idea facet","status":"PRESENT|PARTIAL|ABSENT|UNASSESSED","evidence":"short faithful evidence","reason":"brief comparison"}]}]',
  patentItems: '"patentItems":[{"evidenceId":"exact id","title":"source title","summary":"what this patent addresses","facetAssessments":[{"facet":"exact idea facet","status":"PRESENT|PARTIAL|ABSENT|UNASSESSED","evidence":"short faithful evidence","reason":"brief comparison"}]}]',
  webItems: '"webItems":[{"evidenceId":"exact id","title":"source title","summary":"what this web source says","facetAssessments":[{"facet":"exact idea facet","status":"PRESENT|PARTIAL|ABSENT|UNASSESSED","evidence":"short faithful evidence","reason":"brief comparison"}]}]',
  callItems: '"callItems":[{"fundingCallId":"exact id","summary":"what this call seeks from applicants","callPriorities":["explicit priorities, themes, or requirements stated in the call text"],"facetAssessments":[{"facet":"exact idea facet","status":"PRESENT|PARTIAL|ABSENT|UNASSESSED","evidence":"short faithful quote or paraphrase from the call text","reason":"brief comparison"}]}]',
  tail: '"strongestOverlap":["..."],"whiteSpace":["..."],"cautions":["..."]',
} as const

const CALL_ITEM_RULES = [
  '- For callItems the statuses mean something different: PRESENT = the call text explicitly invites, prioritizes, or requires this facet; PARTIAL = the call invites something related but not this exact facet; ABSENT = the call text indicates this facet is out of scope or excluded; UNASSESSED = the supplied call text does not say.',
  '- callPriorities must come from the supplied call text, not from general knowledge about the agency.',
].join('\n')

function normalizeCallItems(
  rawItems: unknown,
  callRoles: Map<string, 'anchored' | 'matched'>,
  facets: string[]
): FundingCallFacetAssessment[] {
  return (Array.isArray(rawItems) ? rawItems : [])
    .filter((item: any) => callRoles.has(String(item?.fundingCallId || '')))
    .map((item: any) => ({
      fundingCallId: String(item.fundingCallId),
      role: callRoles.get(String(item.fundingCallId))!,
      summary: normalizeText(item.summary, 600),
      callPriorities: Array.isArray(item.callPriorities)
        ? item.callPriorities.map((priority: unknown) => normalizeText(priority, 220)).filter(Boolean).slice(0, 8)
        : [],
      facetAssessments: facets.map((facet) => {
        const raw = Array.isArray(item.facetAssessments)
          ? item.facetAssessments.find((assessment: any) => normalizeText(assessment?.facet, 180).toLowerCase() === facet.toLowerCase())
          : null
        return {
          facet,
          status: normalizeStatus(raw?.status),
          evidence: normalizeText(raw?.evidence, 500),
          reason: normalizeText(raw?.reason, 500),
        }
      }),
    }))
}

export { calculateCallAlignments }

const GAP_KINDS = ['unaddressed_priority', 'missing_methodology', 'weak_differentiation', 'scale_mismatch', 'eligibility_risk', 'missing_evidence'] as const
const GAP_SEVERITIES = ['critical', 'major', 'minor'] as const
const REVIEWER_PERSONA_KEYS = ['scientific_merit', 'feasibility_budget', 'societal_impact'] as const
const REVIEWER_PERSONA_LABELS: Record<(typeof REVIEWER_PERSONA_KEYS)[number], string> = {
  scientific_merit: 'Scientific merit reviewer',
  feasibility_budget: 'Feasibility and budget reviewer',
  societal_impact: 'Societal impact reviewer',
}

function normalizeGrantPrepStageKey(value: unknown): string | null {
  const key = String(value || '').toLowerCase().trim()
  return (VISIBLE_GRANT_PREP_STAGE_KEYS as string[]).includes(key) ? key : null
}

function normalizeCallGaps(raw: unknown, validEvidenceIds: Set<string>): IdeaCallGap[] {
  return (Array.isArray(raw) ? raw : [])
    .map((item: any, index: number): IdeaCallGap | null => {
      const title = normalizeText(item?.title, 180)
      const detail = normalizeText(item?.detail, 700)
      if (!title || !detail) return null
      const evidence = (Array.isArray(item?.evidence) ? item.evidence : [])
        .map((entry: any) => {
          const sourceType = normalizeDirection(entry?.sourceType, ['call', 'funded_project', 'publication', 'patent', 'web'], '')
          const evidenceId = normalizeText(entry?.evidenceId, 300)
          if (!sourceType || !evidenceId || !validEvidenceIds.has(evidenceId)) return null
          return {
            sourceType: sourceType as IdeaCallGap['evidence'][number]['sourceType'],
            evidenceId,
            quote: normalizeQuoteText(entry?.quote) || null,
          }
        })
        .filter((entry: IdeaCallGap['evidence'][number] | null): entry is IdeaCallGap['evidence'][number] => Boolean(entry))
        .slice(0, 4)
      return {
        id: `gap-${index + 1}`,
        kind: normalizeDirection(item?.kind, [...GAP_KINDS], 'missing_evidence') as IdeaCallGap['kind'],
        severity: normalizeDirection(item?.severity, [...GAP_SEVERITIES], 'major') as IdeaCallGap['severity'],
        title,
        detail,
        evidence,
        fixSuggestion: normalizeText(item?.fixSuggestion, 500),
        grantPrepStageKey: normalizeGrantPrepStageKey(item?.grantPrepStageKey),
      }
    })
    .filter((item): item is IdeaCallGap => Boolean(item))
    .slice(0, 8)
}

function normalizeReviewerPanel(raw: unknown): IdeaReviewerPersona[] {
  const seen = new Set<string>()
  return (Array.isArray(raw) ? raw : [])
    .map((item: any): IdeaReviewerPersona | null => {
      const persona = normalizeDirection(item?.persona, [...REVIEWER_PERSONA_KEYS], '')
      if (!persona || seen.has(persona)) return null
      seen.add(persona)
      const objections = (Array.isArray(item?.objections) ? item.objections : [])
        .map((objection: any): IdeaReviewerObjection | null => {
          const text = normalizeText(objection?.objection, 400)
          if (!text) return null
          return {
            objection: text,
            severity: normalizeDirection(objection?.severity, [...GAP_SEVERITIES], 'major') as IdeaReviewerObjection['severity'],
            basedOn: normalizeText(objection?.basedOn, 300),
            preemption: normalizeText(objection?.preemption, 400),
            grantPrepStageKey: normalizeGrantPrepStageKey(objection?.grantPrepStageKey),
          }
        })
        .filter((objection: IdeaReviewerObjection | null): objection is IdeaReviewerObjection => Boolean(objection))
        .slice(0, 4)
      if (!objections.length) return null
      return {
        persona: persona as IdeaReviewerPersona['persona'],
        personaLabel: REVIEWER_PERSONA_LABELS[persona as IdeaReviewerPersona['persona']],
        overallStance: normalizeText(item?.overallStance, 300),
        objections,
      }
    })
    .filter((item): item is IdeaReviewerPersona => Boolean(item))
    .slice(0, 3)
}

// Gap report + simulated review panel for one call the user has committed to.
// Shared by the anchored path in execute() and the user-driven call-fit step.
async function runCallGapAnalysis(input: {
  runId: string
  actor: ActorContext
  targetCallId: string
  structured: StructuredIdea
  targetComparison: ComparisonCall | null
  targetItems: FundingCallFacetAssessment | null
  overlap: { strongestOverlap: string[]; whiteSpace: string[]; cautions: string[] }
  comparisonProjects: unknown[]
  validEvidenceIds: Set<string>
}): Promise<{ callGaps: IdeaCallGap[]; reviewerPanel: IdeaReviewerPersona[] }> {
  const { runId, actor, targetCallId, structured, targetComparison, targetItems } = input
  let callGaps: IdeaCallGap[] = []
  let reviewerPanel: IdeaReviewerPersona[] = []

  try {
    const gapResponse = await runFundingGatewayText({
      taskCode: IDEA_INTELLIGENCE_TASK_CODE,
      stageCode: IDEA_INTELLIGENCE_REPORT_STAGE_CODE,
      context: { tenantId: actor.tenantId, userId: actor.userId },
      responseMimeType: 'application/json',
      temperature: 0.2,
      maxTokensOut: 3800,
      metadata: { purpose: 'idea_intelligence_call_gaps', runId, targetCallId },
      prompt: `Identify the concrete gaps between a research idea and a specific funding call, then simulate a fair but demanding review panel.

STRUCTURED IDEA: ${JSON.stringify(structured)}
TARGET FUNDING CALL: ${JSON.stringify(targetComparison)}
PER-FACET CALL FIT FOR THIS CALL: ${JSON.stringify(targetItems)}
FUNDED-NEIGHBOR OVERLAP: ${JSON.stringify(input.overlap)}
FUNDED PROJECT SUMMARIES: ${JSON.stringify(input.comparisonProjects.slice(0, 6))}

Return JSON only:
{"gaps":[{"kind":"unaddressed_priority|missing_methodology|weak_differentiation|scale_mismatch|eligibility_risk|missing_evidence","severity":"critical|major|minor","title":"<=180 chars naming the gap","detail":"what exactly is missing and why it matters for this call","evidence":[{"sourceType":"call|funded_project|publication|patent|web","evidenceId":"exact id from supplied data (use the target call id for call evidence)","quote":"short verbatim quote from supplied text, or null"}],"fixSuggestion":"one concrete change or addition the applicant can make","grantPrepStageKey":"ideation|problem_definition|root_cause|beneficiaries|fit_and_scope|methodology|team_and_partnerships|outcomes|evaluation|risk_and_ethics|budget_strategy|innovation or null"}],"reviewerPanel":[{"persona":"scientific_merit|feasibility_budget|societal_impact","overallStance":"one sentence on how this reviewer reads the idea against this call","objections":[{"objection":"the hardest fair question this reviewer would ask","severity":"critical|major|minor","basedOn":"which supplied call text or evidence motivates it","preemption":"how the applicant could pre-empt it in the proposal","grantPrepStageKey":"same stage enum or null"}]}]}

Rules:
- Ground every gap in the supplied call text, per-facet fit, or evidence. Do not invent call requirements that are not in the supplied text.
- Return 3 to 8 gaps ordered most severe first, and exactly 3 reviewer personas with 2-4 objections each.
- eligibility_risk gaps must quote the call text they are based on when it is available.
- If the supplied call text is too thin to assess something, make that a missing_evidence gap that tells the user what to verify, instead of guessing.
- Never predict funding success and never claim novelty.`,
    })
    const gapJson = gapResponse ? extractJsonObject(gapResponse.rawText) as any : {}
    callGaps = normalizeCallGaps(gapJson?.gaps, input.validEvidenceIds)
    reviewerPanel = normalizeReviewerPanel(gapJson?.reviewerPanel)
  } catch {
    callGaps = []
    reviewerPanel = []
  }

  // If the model returned nothing usable, the per-facet fit still yields honest
  // gaps: the facets the call text does not invite, or does not speak to at all.
  if (!callGaps.length && targetItems) {
    callGaps = targetItems.facetAssessments
      .filter((cell) => cell.status === 'ABSENT' || cell.status === 'UNASSESSED')
      .slice(0, 5)
      .map((cell, index): IdeaCallGap => ({
        id: `gap-${index + 1}`,
        kind: cell.status === 'ABSENT' ? 'unaddressed_priority' : 'missing_evidence',
        severity: cell.status === 'ABSENT' ? 'major' : 'minor',
        title: cell.status === 'ABSENT' ? `Call scope concern: ${cell.facet}` : `Unverified call fit: ${cell.facet}`,
        detail: cell.reason || cell.evidence || 'The supplied call text did not confirm that this facet fits what the call invites. Verify it against the full call document.',
        evidence: [{ sourceType: 'call', evidenceId: targetCallId, quote: null }],
        fixSuggestion: 'Check the official call document for this facet and adjust the idea framing or scope accordingly.',
        grantPrepStageKey: 'fit_and_scope',
      }))
  }

  return { callGaps, reviewerPanel }
}

// Three is the cap on purpose: the module's job is to hand back a few pursuable
// directions, not a menu the researcher has to triage.
const MAX_WHITESPACE_DIRECTIONS = 3

// The sanctioned corpus carries the analysis, so it is retrieved deeper than the
// per-facet comparison window: the extra rows still feed the funder ledger.
const SANCTIONED_PROJECT_RETRIEVAL_LIMIT = 30
const SANCTIONED_PROJECT_COMPARISON_LIMIT = 12

// If the report model fails or returns nothing usable, the open facets still
// produce honest directions — with the missing worked example named as missing
// rather than invented.
function buildFallbackDirections(
  coverage: ReturnType<typeof buildFacetCoverage>,
  portfolio: FundedPortfolio,
  projects: PublicProjectSearchItem[]
): WhitespaceDirection[] {
  const topAgency = portfolio.agencies[0]?.agencyName || null
  const source = coverage.open.length ? coverage.open : coverage.unknown
  return source.slice(0, MAX_WHITESPACE_DIRECTIONS).map((facet, index): WhitespaceDirection => ({
    id: `direction-${index + 1}`,
    title: facet,
    whyOpen: coverage.open.includes(facet)
      ? `None of the ${portfolio.projectCount} sanctioned projects retrieved for this idea showed evidence of this aspect.`
      : 'The retrieved records did not contain enough text to assess this aspect either way.',
    alreadyCovered: coverage.covered.length
      ? `Sanctioned work already covers: ${coverage.covered.slice(0, 3).join('; ')}.`
      : '',
    stillMissing: facet,
    example: {
      projectIdea: '',
      whatYouWouldBuild: '',
      firstProof: '',
    },
    relatedFacets: [facet],
    evidence: projects.slice(0, 2).map((project) => ({ sourceType: 'funded_project' as const, evidenceId: project.id, quote: null })),
    confidence: coverage.open.includes(facet) ? 'moderate' : 'thin',
    bestFitAgency: topAgency,
  }))
}

function countJsonEntries(value: unknown) {
  if (Array.isArray(value)) return value.length
  // Some connectors store a keyed object rather than a list; a non-empty object
  // still means the award reported something.
  if (value && typeof value === 'object') return Object.keys(value).length
  return 0
}

/**
 * The award fields the search projection does not carry: delivery status, and
 * the patents and publications each award reported. One query, no external API
 * call — and the patent counts are a direct record, never an inference about
 * which patent came from which award.
 */
async function loadProjectRecords(projectIds: string[], now = new Date()): Promise<{
  deliveries: ProjectDelivery[]
  extras: PriorWorkAwardExtras[]
}> {
  if (!projectIds.length) return { deliveries: [], extras: [] }
  const rows = await prisma.publicProject.findMany({
    where: { id: { in: projectIds } },
    select: {
      id: true, endDate: true, durationMonths: true, outputAchievedText: true,
      outcomes: true, patents: true, publications: true, sanctionYear: true,
    },
  })

  const deliveries = rows.map((row) => ({
    id: row.id,
    endDate: row.endDate ? row.endDate.toISOString() : null,
    durationMonths: row.durationMonths,
    hasReportedOutput: Boolean(
      (row.outputAchievedText && row.outputAchievedText.trim() && row.outputAchievedText.trim().toUpperCase() !== 'NA')
      || (Array.isArray(row.outcomes) && row.outcomes.length > 0)
    ),
  }))
  const deliveryById = new Map(deliveries.map((item) => [item.id, item]))

  return {
    deliveries,
    extras: rows.map((row): PriorWorkAwardExtras => ({
      id: row.id,
      durationMonths: row.durationMonths,
      hasReportedOutput: Boolean(deliveryById.get(row.id)?.hasReportedOutput),
      patentCount: countJsonEntries(row.patents),
      publicationCount: countJsonEntries(row.publications),
      status: projectStatus(deliveryById.get(row.id), row.sanctionYear, now),
    })),
  }
}

function normalizeWhitespaceDirections(
  raw: unknown,
  validEvidenceIds: Set<string>,
  knownFacets: string[],
  knownAgencies: string[]
): WhitespaceDirection[] {
  const facetLookup = new Map(knownFacets.map((facet) => [facet.toLowerCase(), facet]))
  const agencyLookup = new Map(knownAgencies.map((agency) => [agency.toLowerCase(), agency]))
  return (Array.isArray(raw) ? raw : [])
    .map((item: any, index: number): WhitespaceDirection | null => {
      // Hard caps, not suggestions: an unbounded prose field is an invitation to
      // pad, and padding is what made this report unreadable.
      const title = normalizeText(item?.title, 110)
      const stillMissing = normalizeText(item?.stillMissing, 240)
      if (!title || !stillMissing) return null
      const evidence = (Array.isArray(item?.evidence) ? item.evidence : [])
        .map((entry: any) => {
          const sourceType = normalizeDirection(entry?.sourceType, ['funded_project', 'publication', 'patent', 'web', 'call'], '')
          const evidenceId = normalizeText(entry?.evidenceId, 300)
          if (!sourceType || !evidenceId || !validEvidenceIds.has(evidenceId)) return null
          return {
            sourceType: sourceType as WhitespaceEvidenceRef['sourceType'],
            evidenceId,
            quote: normalizeQuoteText(entry?.quote) || null,
          }
        })
        .filter((entry: WhitespaceEvidenceRef | null): entry is WhitespaceEvidenceRef => Boolean(entry))
        .slice(0, 4)
      const relatedFacets = (Array.isArray(item?.relatedFacets) ? item.relatedFacets : [])
        .map((facet: unknown) => facetLookup.get(normalizeText(facet, 180).toLowerCase()) || null)
        .filter((facet: string | null): facet is string => Boolean(facet))
        .slice(0, 4)
      const rawAgency = normalizeText(item?.bestFitAgency, 160)
      // Evidence density decides confidence; the model does not get to inflate it.
      const claimed = normalizeDirection(item?.confidence, ['strong', 'moderate', 'thin'], 'moderate') as WhitespaceDirection['confidence']
      const ceiling: WhitespaceDirection['confidence'] = evidence.length >= 3 ? 'strong' : evidence.length >= 1 ? 'moderate' : 'thin'
      const order = { thin: 0, moderate: 1, strong: 2 } as const
      const confidence = order[claimed] <= order[ceiling] ? claimed : ceiling
      return {
        id: `direction-${index + 1}`,
        title,
        // Superseded by the deterministic gap reading, which is computed from
        // the records rather than narrated. Kept on the type so runs made before
        // the prior-work pass still render.
        whyOpen: '',
        alreadyCovered: '',
        stillMissing,
        example: {
          projectIdea: normalizeText(item?.example?.projectIdea, 300),
          whatYouWouldBuild: normalizeText(item?.example?.whatYouWouldBuild, 180),
          firstProof: normalizeText(item?.example?.firstProof, 220),
        },
        relatedFacets,
        evidence,
        confidence,
        bestFitAgency: agencyLookup.get(rawAgency.toLowerCase()) || rawAgency || null,
      }
    })
    .filter((item): item is WhitespaceDirection => Boolean(item))
    .slice(0, MAX_WHITESPACE_DIRECTIONS)
}

const GAP_READING_PRIORITY: Record<PriorWorkGap['reading'], number> = {
  blocked: 0,
  attempted_no_output: 1,
  unexplored: 2,
}

/**
 * Attaches each deterministic gap record to the direction that claims its facet,
 * then adds back any open aspect the model skipped — blocked ones first. An
 * aspect a live patent already claims must never quietly drop out of the report
 * just because the narration ran out of room.
 */
function withGapFacts(
  directions: WhitespaceDirection[],
  gaps: PriorWorkGap[],
  topAgency: string | null
): WhitespaceDirection[] {
  const byFacet = new Map(gaps.map((gap) => [gap.facet.toLowerCase(), gap]))
  const claimed = new Set<string>()
  const narrated = directions.map((direction) => {
    const gap = direction.relatedFacets
      .map((facet) => byFacet.get(facet.toLowerCase()))
      .find((entry): entry is PriorWorkGap => Boolean(entry)) || null
    if (gap) claimed.add(gap.facet.toLowerCase())
    return { ...direction, gap }
  })

  const skipped = gaps
    .filter((gap) => !claimed.has(gap.facet.toLowerCase()))
    .sort((a, b) => GAP_READING_PRIORITY[a.reading] - GAP_READING_PRIORITY[b.reading])
    .slice(0, 2)
    .map((gap): WhitespaceDirection => ({
      id: gap.id,
      title: gap.facet,
      whyOpen: '',
      alreadyCovered: '',
      stillMissing: gap.readingBasis,
      example: { projectIdea: '', whatYouWouldBuild: '', firstProof: '' },
      relatedFacets: [gap.facet],
      evidence: [],
      confidence: 'thin',
      bestFitAgency: topAgency,
      gap,
    }))

  return [...narrated, ...skipped]
}

function normalizeFundedThemes(raw: unknown, validProjectIds: Set<string>): FundedTheme[] {
  return (Array.isArray(raw) ? raw : [])
    .map((item: any): FundedTheme | null => {
      const theme = normalizeText(item?.theme, 220)
      if (!theme) return null
      const exampleProjectIds = (Array.isArray(item?.exampleProjectIds) ? item.exampleProjectIds : [])
        .map((id: unknown) => normalizeText(id, 300))
        .filter((id: string) => validProjectIds.has(id))
        .slice(0, 3)
      return {
        theme,
        projectCount: Math.max(exampleProjectIds.length, Math.min(200, Math.round(Number(item?.projectCount) || exampleProjectIds.length))),
        agencies: (Array.isArray(item?.agencies) ? item.agencies : [])
          .map((agency: unknown) => normalizeText(agency, 160))
          .filter(Boolean)
          .slice(0, 3),
        exampleProjectIds,
      }
    })
    .filter((item): item is FundedTheme => Boolean(item))
    .slice(0, 4)
}

// The ranking and the numbers stay deterministic; the model only supplies the
// one-line reason, and only for funders it was actually shown.
function applyAgencyNarratives(recommendations: AgencyRecommendation[], raw: unknown): AgencyRecommendation[] {
  const narrativeByAgency = new Map(
    (Array.isArray(raw) ? raw : [])
      .map((item: any) => [normalizeText(item?.agencyName, 160).toLowerCase(), normalizeText(item?.whyThisAgency, 400)] as const)
      .filter(([agency, why]) => agency && why)
  )
  return recommendations.map((item) => ({
    ...item,
    whyThisAgency: narrativeByAgency.get(item.agencyName.toLowerCase()) || item.whyThisAgency,
  }))
}

function normalizeCallFit(raw: unknown, callRoles: Map<string, 'anchored' | 'matched'>) {
  return (Array.isArray(raw) ? raw : [])
    .filter((item: any) => callRoles.has(String(item?.fundingCallId || '')))
    .map((item: any) => ({
      fundingCallId: String(item.fundingCallId),
      role: callRoles.get(String(item.fundingCallId))!,
      fitSummary: normalizeText(item?.fitSummary, 700),
      strengths: Array.isArray(item?.strengths) ? item.strengths.map((entry: unknown) => normalizeText(entry, 300)).filter(Boolean).slice(0, 5) : [],
      concerns: Array.isArray(item?.concerns) ? item.concerns.map((entry: unknown) => normalizeText(entry, 300)).filter(Boolean).slice(0, 5) : [],
      verifyBeforeApplying: Array.isArray(item?.verifyBeforeApplying) ? item.verifyBeforeApplying.map((entry: unknown) => normalizeText(entry, 300)).filter(Boolean).slice(0, 5) : [],
    }))
    .filter((item) => item.fitSummary)
    .slice(0, 6)
}


function aggregateFacetStatus(cells: FacetAssessment[]): FacetStatus {
  const assessed = cells.filter((cell) => cell.status !== 'UNASSESSED')
  if (!assessed.length) return 'UNASSESSED'
  if (assessed.some((cell) => cell.status === 'PRESENT')) return 'PRESENT'
  if (assessed.some((cell) => cell.status === 'PARTIAL')) return 'PARTIAL'
  return 'ABSENT'
}

function isOverlap(status: FacetStatus) {
  return status === 'PRESENT' || status === 'PARTIAL'
}

function buildCrossCorpusSignals(
  facets: string[],
  analysis: ReturnType<typeof normalizeCrossCorpusAnalysis>
): CrossCorpusFacetSignal[] {
  return facets.map((facet) => {
    const funded = aggregateFacetStatus(analysis.items.flatMap((item) => item.facetAssessments.filter((cell) => cell.facet === facet)))
    const published = aggregateFacetStatus(analysis.publicationItems.flatMap((item) => item.facetAssessments.filter((cell) => cell.facet === facet)))
    const patented = aggregateFacetStatus(analysis.patentItems.flatMap((item) => item.facetAssessments.filter((cell) => cell.facet === facet)))
    const web = aggregateFacetStatus(analysis.webItems.flatMap((item) => item.facetAssessments.filter((cell) => cell.facet === facet)))

    let signal: CrossCorpusFacetSignal['signal'] = 'mixed'
    let rationale = 'The evidence is mixed across funded, published, patented, and web sources.'
    if (isOverlap(funded) && (isOverlap(published) || isOverlap(patented))) {
      signal = 'saturated'
      rationale = 'This facet appears in funded work and is also supported by publication or patent evidence.'
    } else if (!isOverlap(funded) && isOverlap(published) && !isOverlap(patented)) {
      signal = 'translation_gap'
      rationale = 'Publication evidence exists, but funded-project and patent evidence do not show the same level of activity.'
    } else if (!isOverlap(funded) && isOverlap(patented)) {
      signal = 'commercialization_prior_art'
      rationale = 'Patent evidence suggests prior commercialization activity even where funded-project overlap is limited.'
    } else if ([funded, published, patented].every((status) => status === 'ABSENT')) {
      signal = 'white_space_candidate'
      rationale = 'Assessed funded, publication, and patent evidence indicates absence for this facet.'
    } else if ([funded, published, patented, web].every((status) => status === 'UNASSESSED')) {
      signal = 'insufficient_evidence'
      rationale = 'No source supplied enough evidence to assess this facet.'
    }

    return { facet, funded, published, patented, web, signal, rationale }
  })
}

function extractYear(value: string | null | undefined) {
  const match = String(value || '').match(/\b(19|20)\d{2}\b/)
  return match ? Number(match[0]) : null
}

function calculateEvidenceMomentum(
  projects: PublicProjectSearchItem[],
  publications: PublicationEvidence[] = [],
  patents: PatentEvidence[] = [],
  webResults: WebEvidence[] = []
) {
  const currentYear = new Date().getFullYear()
  const weightedYears: Array<{ year: number; weight: number }> = [
    ...projects
      .map((project) => typeof project.sanctionYear === 'number' ? { year: project.sanctionYear, weight: 1 } : null)
      .filter((item): item is { year: number; weight: number } => Boolean(item)),
    ...publications
      .map((publication) => typeof publication.year === 'number'
        ? { year: publication.year, weight: 0.8 + Math.log10((publication.citationCount || 0) + 1) * 0.35 }
        : null)
      .filter((item): item is { year: number; weight: number } => Boolean(item)),
    ...patents
      .map((patent) => {
        const year = extractYear(patent.publicationDate || patent.filingDate || patent.priorityDate)
        return year ? { year, weight: 1.15 } : null
      })
      .filter((item): item is { year: number; weight: number } => Boolean(item)),
    ...webResults
      .map((result) => {
        const year = extractYear(result.date)
        return year ? { year, weight: 0.35 } : null
      })
      .filter((item): item is { year: number; weight: number } => Boolean(item)),
  ].filter((item) => item.year >= 2000 && item.year <= currentYear + 1)

  if (!weightedYears.length) return 0
  const weightedMomentum = weightedYears.reduce((sum, item) => {
    const age = Math.max(0, currentYear - item.year)
    return sum + Math.exp(-age / 5) * item.weight
  }, 0)
  const totalWeight = weightedYears.reduce((sum, item) => sum + item.weight, 0)
  return totalWeight ? weightedMomentum / totalWeight : 0
}

export function calculateLandscapeSignals(
  projects: PublicProjectSearchItem[],
  analysis: ReturnType<typeof normalizeAnalysis> | ReturnType<typeof normalizeCrossCorpusAnalysis>,
  evidence: Partial<Pick<Awaited<ReturnType<typeof retrieveIdeaEvidence>>, 'publications' | 'patents' | 'webResults'>> = {}
) {
  const cells = analysis.items.flatMap((item) => item.facetAssessments).filter((item) => item.status !== 'UNASSESSED')
  const publicationItems = 'publicationItems' in analysis ? analysis.publicationItems : []
  const patentItems = 'patentItems' in analysis ? analysis.patentItems : []
  const webItems = 'webItems' in analysis ? analysis.webItems : []
  const weightedCells = [
    ...cells.map((cell) => ({ cell, weight: 1 })),
    ...publicationItems.flatMap((item) => item.facetAssessments.filter((cell) => cell.status !== 'UNASSESSED').map((cell) => ({ cell, weight: 0.8 }))),
    ...patentItems.flatMap((item) => item.facetAssessments.filter((cell) => cell.status !== 'UNASSESSED').map((cell) => ({ cell, weight: 0.9 }))),
    ...webItems.flatMap((item) => item.facetAssessments.filter((cell) => cell.status !== 'UNASSESSED').map((cell) => ({ cell, weight: 0.35 }))),
  ]
  const saturation = weightedCells.length
    ? weightedCells.reduce((sum, item) => sum + (statusValue(item.cell.status) || 0) * item.weight, 0) / weightedCells.reduce((sum, item) => sum + item.weight, 0)
    : 0
  const whiteSpace = cells.length ? cells.filter((item) => item.status === 'ABSENT').length / cells.length : 0
  const momentum = calculateEvidenceMomentum(projects, evidence.publications, evidence.patents, evidence.webResults)
  const detailedEvidence = projects.filter((project) => project.abstractText && project.abstractText.toUpperCase() !== 'NA').length
  const extraEvidenceCount = publicationItems.length + patentItems.length + webItems.length
  const evidenceConfidence = extraEvidenceCount > 0
    ? Math.min(1, (analysis.items.length / 8) * 0.25 + (detailedEvidence / 8) * 0.45 + (extraEvidenceCount / 16) * 0.3)
    : Math.min(1, (analysis.items.length / 8) * 0.35 + (detailedEvidence / 8) * 0.65)
  const sourceFamilies = [
    ...new Set(projects.map((project) => `project:${project.sourceKey}`)),
    publicationItems.length ? 'publications' : null,
    patentItems.length ? 'patents' : null,
    webItems.length ? 'web' : null,
  ].filter(Boolean)
  const diversity = sourceFamilies.length ? Math.min(1, sourceFamilies.length / 6) : 0
  const balance = Math.max(0, 1 - Math.abs(saturation - 0.55) / 0.55)
  const landscapePositioning = 100 * (0.35 * evidenceConfidence + 0.25 * momentum + 0.2 * diversity + 0.2 * balance)
  const facets = Array.from(new Set([
    ...analysis.items.flatMap((item) => item.facetAssessments.map((cell) => cell.facet)),
    ...publicationItems.flatMap((item) => item.facetAssessments.map((cell) => cell.facet)),
    ...patentItems.flatMap((item) => item.facetAssessments.map((cell) => cell.facet)),
    ...webItems.flatMap((item) => item.facetAssessments.map((cell) => cell.facet)),
  ]))

  return {
    landscapePositioning: Math.round(landscapePositioning),
    saturation: Math.round(saturation * 100),
    whiteSpace: Math.round(whiteSpace * 100),
    momentum: Math.round(momentum * 100),
    evidenceConfidence: Math.round(evidenceConfidence * 100),
    evidenceProjects: analysis.items.length,
    evidencePublications: publicationItems.length,
    evidencePatents: patentItems.length,
    evidenceWeb: webItems.length,
    crossCorpusFacets: 'publicationItems' in analysis ? buildCrossCorpusSignals(facets, analysis) : [],
    methodology: 'Descriptive cross-corpus landscape signals, not a prediction of funding success.',
  }
}

function publicRun(run: any) {
  return {
    id: run.id,
    sessionId: run.sessionId,
    versionId: run.versionId,
    versionNumber: run.version?.versionNumber ?? null,
    title: run.title,
    ideaText: run.ideaText,
    anchorPublicProjectId: run.anchorPublicProjectId,
    anchorFundingCallId: run.anchorFundingCallId ?? run.session?.anchorFundingCallId ?? null,
    linkedGrantPrepSessionId: run.session?.linkedGrantPrepSessionId || null,
    linkedProjectId: run.session?.projectId || null,
    status: run.status,
    currentStage: run.currentStage,
    structuredIdea: run.structuredIdeaJson,
    retrievalResults: run.retrievalResultsJson,
    analysis: run.analysisJson,
    scores: run.scoresJson,
    report: run.reportJson,
    errorMessage: run.errorMessage,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    versions: run.session?.versions?.map((version: any) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      title: version.title,
      ideaText: version.ideaText,
      parentVersionId: version.parentVersionId,
      refinementObjective: version.refinementObjective,
      refinementRationale: version.refinementRationale,
      scoreDelta: version.scoreDeltaJson,
      createdAt: version.createdAt,
      runId: version.runs?.[0]?.id || null,
      runStatus: version.runs?.[0]?.status || null,
    })) || [],
    refinementCandidates: (run.refinementCandidates || []).map(publicCandidate),
  }
}

function refinementObjectiveLabel(value: string) {
  switch (value) {
    case 'maximize_white_space':
      return 'Maximize whitespace and differentiation'
    case 'target_funder':
      return 'Target a stronger funder fit'
    case 'reduce_risk':
      return 'Reduce evidence and reviewer risk'
    default:
      return 'Refine the research idea'
  }
}

function numericScore(value: any, key: string) {
  const parsed = Number(value?.[key])
  return Number.isFinite(parsed) ? parsed : null
}

function buildScoreDelta(currentScores: any, parentScores: any) {
  const keys = [
    'landscapePositioning',
    'saturation',
    'whiteSpace',
    'momentum',
    'evidenceConfidence',
    'evidenceProjects',
    'evidencePublications',
    'evidencePatents',
    'evidenceWeb',
  ]
  return keys.reduce<Record<string, { previous: number | null; current: number | null; delta: number | null }>>((delta, key) => {
    const current = numericScore(currentScores, key)
    const previous = numericScore(parentScores, key)
    delta[key] = {
      previous,
      current,
      delta: current !== null && previous !== null ? current - previous : null,
    }
    return delta
  }, {})
}

function buildRunEvidenceReferences(retrieval: any): EvidenceReference[] {
  const refs: EvidenceReference[] = []
  for (const project of Array.isArray(retrieval?.projects) ? retrieval.projects : []) {
    const evidenceId = normalizeText(project?.id, 180)
    const title = normalizeText(project?.title, 320)
    const text = [
      title,
      project?.abstractText && String(project.abstractText).toUpperCase() !== 'NA' ? project.abstractText : null,
      project?.executiveSummary,
      project?.schemeName,
      project?.sourceKey,
    ].map((value) => normalizeText(value, 1400)).filter(Boolean).join(' ')
    if (evidenceId && title && text) refs.push({ sourceType: 'funded_project', evidenceId, title, text: text.slice(0, 2600) })
  }
  for (const publication of Array.isArray(retrieval?.publications) ? retrieval.publications : []) {
    const evidenceId = normalizeText(publication?.id, 220)
    const title = normalizeText(publication?.title, 320)
    const text = [title, publication?.abstract, publication?.venue, publication?.doi].map((value) => normalizeText(value, 1600)).filter(Boolean).join(' ')
    if (evidenceId && title && text) refs.push({ sourceType: 'publication', evidenceId, title, text: text.slice(0, 2600) })
  }
  for (const patent of Array.isArray(retrieval?.patents) ? retrieval.patents : []) {
    const evidenceId = normalizeText(patent?.id, 220)
    const title = normalizeText(patent?.title, 320)
    const text = [title, patent?.abstract, patent?.publicationNumber, patent?.assignee].map((value) => normalizeText(value, 1600)).filter(Boolean).join(' ')
    if (evidenceId && title && text) refs.push({ sourceType: 'patent', evidenceId, title, text: text.slice(0, 2400) })
  }
  for (const web of Array.isArray(retrieval?.webResults) ? retrieval.webResults : []) {
    const evidenceId = normalizeText(web?.id, 300)
    const title = normalizeText(web?.title, 320)
    const text = [title, web?.snippet, web?.source, web?.url].map((value) => normalizeText(value, 1200)).filter(Boolean).join(' ')
    if (evidenceId && title && text) refs.push({ sourceType: 'web', evidenceId, title, text: text.slice(0, 1800) })
  }
  return refs
}

function compactEvidenceForPrompt(refs: EvidenceReference[]) {
  return refs.slice(0, 26).map((ref) => ({
    sourceType: ref.sourceType,
    evidenceId: ref.evidenceId,
    title: ref.title,
    excerpt: ref.text.slice(0, 900),
  }))
}

function normalizeFacetChanges(rawChanges: unknown, structured: StructuredIdea | null): RefinementCandidatePayload['facetChanges'] {
  const changes = (Array.isArray(rawChanges) ? rawChanges : [])
    .map((raw: any) => {
      const facet = normalizeText(raw?.facet, 220)
      const change = normalizeDirection(raw?.change, ['kept', 'modified', 'dropped', 'added'], 'modified') as RefinementCandidatePayload['facetChanges'][number]['change']
      const resultingFacet = normalizeText(raw?.resultingFacet, 260) || (change === 'dropped' ? '' : facet)
      return facet || resultingFacet ? { facet: facet || resultingFacet, change, resultingFacet } : null
    })
    .filter((item): item is RefinementCandidatePayload['facetChanges'][number] => Boolean(item))
    .slice(0, 8)

  if (changes.length) return changes
  return (structured?.facets || ['Core technical approach']).slice(0, 4).map((facet, index) => ({
    facet,
    change: index === 0 ? 'modified' : 'kept',
    resultingFacet: facet,
  }))
}

function aggregateSignalStatus(signal: CrossCorpusFacetSignal | undefined) {
  if (!signal) return 'UNASSESSED' as FacetStatus
  if ([signal.funded, signal.published, signal.patented, signal.web].some((status) => status === 'PRESENT')) return 'PRESENT'
  if ([signal.funded, signal.published, signal.patented, signal.web].some((status) => status === 'PARTIAL')) return 'PARTIAL'
  if ([signal.funded, signal.published, signal.patented].every((status) => status === 'ABSENT')) return 'ABSENT'
  return 'UNASSESSED'
}

function estimateExpectedImpact(
  facetChanges: RefinementCandidatePayload['facetChanges'],
  scores: any,
  rawExpectedImpact: any
): RefinementCandidatePayload['expectedImpact'] {
  const signals = Array.isArray(scores?.crossCorpusFacets) ? scores.crossCorpusFacets as CrossCorpusFacetSignal[] : []
  let saturationDown = false
  let whiteSpaceUp = false
  let riskUp = false

  for (const change of facetChanges) {
    const signal = signals.find((item) => item.facet.toLowerCase() === change.facet.toLowerCase())
    const status = aggregateSignalStatus(signal)
    if ((change.change === 'modified' || change.change === 'dropped') && (status === 'PRESENT' || status === 'PARTIAL')) {
      saturationDown = true
    }
    if ((change.change === 'added' || change.change === 'modified') && (status === 'ABSENT' || signal?.signal === 'white_space_candidate' || signal?.signal === 'translation_gap')) {
      whiteSpaceUp = true
    }
    if (change.change === 'added' && status === 'UNASSESSED') {
      riskUp = true
    }
  }

  const modelSaturation = normalizeDirection(rawExpectedImpact?.saturation, ['down', 'flat', 'up'], 'flat') as 'down' | 'flat' | 'up'
  const modelWhiteSpace = normalizeDirection(rawExpectedImpact?.whiteSpace, ['up', 'flat', 'down'], 'flat') as 'up' | 'flat' | 'down'
  return {
    saturation: saturationDown ? 'down' : riskUp ? 'up' : 'flat',
    whiteSpace: whiteSpaceUp ? 'up' : riskUp ? 'down' : 'flat',
    rationale: normalizeText(rawExpectedImpact?.rationale, 600)
      || 'Estimated from how the suggested facet changes interact with the current cross-corpus matrix.',
    modelSaturation,
    modelWhiteSpace,
  }
}

function sanitizeIdeaClaims(text: string) {
  return text
    .replace(/\bguaranteed funding\b/gi, 'stronger funding positioning')
    .replace(/\bcertainly novel\b/gi, 'potentially differentiated')
    .replace(/\bwill be funded\b/gi, 'may be positioned for relevant calls')
}

function normalizeRefinementCandidate(
  raw: any,
  index: number,
  sourceRun: any,
  objective: RefinementObjective,
  evidenceRefs: EvidenceReference[],
  structured: StructuredIdea | null
): { payload: RefinementCandidatePayload; groundednessScore: number } {
  const allowedStrategies = objectiveStrategies(objective)
  const fallbackStrategy = allowedStrategies[(index - 1) % allowedStrategies.length]
  const rawStrategy = normalizeStrategy(raw?.strategy, fallbackStrategy)
  const strategy = allowedStrategies.includes(rawStrategy) ? rawStrategy : fallbackStrategy
  const title = normalizeText(raw?.title, 140) || `${sourceRun.title} refinement ${index}`
  let ideaText = sanitizeIdeaClaims(normalizeText(raw?.ideaText, 12000))
  if (ideaText.length < 80) {
    ideaText = `${sourceRun.ideaText}\n\nRefinement direction: ${title}. ${normalizeText(raw?.rationale, 900)}`
  }

  const evidenceById = new Map(evidenceRefs.map((ref) => [ref.evidenceId, ref]))
  const rawCitations = Array.isArray(raw?.citations) ? raw.citations : []
  const citations: RefinementCitation[] = rawCitations
    .map((citation: any): RefinementCitation | null => {
      const evidenceId = normalizeText(citation?.evidenceId, 300)
      const sourceType = normalizeCitationSourceType(citation?.sourceType)
      if (!evidenceId || !sourceType) return null
      const evidence = evidenceById.get(evidenceId)
      if (!evidence || evidence.sourceType !== sourceType) return null
      const quote = normalizeQuoteText(citation?.quote)
      const quoteVerified = quote ? quoteMatchesEvidence(quote, evidence.text) : false
      return {
        sourceType,
        evidenceId,
        role: normalizeCitationRole(citation?.role),
        quote: quoteVerified ? quote : null,
        quoteVerified,
      }
    })
    .filter((item: RefinementCitation | null): item is RefinementCitation => Boolean(item))
    .slice(0, 8)

  const fallbackCitation: RefinementCitation[] = !citations.length && evidenceRefs[index - 1]
    ? [{
        sourceType: evidenceRefs[index - 1].sourceType,
        evidenceId: evidenceRefs[index - 1].evidenceId,
        role: 'supports_gap' as const,
        quote: null,
        quoteVerified: false,
      }]
    : []

  const facetChanges = normalizeFacetChanges(raw?.facetChanges, structured)
  const finalCitations = citations.length ? citations : fallbackCitation
  const groundednessScore = finalCitations.length
    ? finalCitations.reduce((score, citation) => score + (citation.quoteVerified ? 1 : 0.5), 0) / finalCitations.length
    : 0

  return {
    groundednessScore: Number(groundednessScore.toFixed(2)),
    payload: {
      strategy,
      title,
      ideaText,
      facetChanges,
      citations: finalCitations,
      expectedImpact: estimateExpectedImpact(facetChanges, sourceRun.scoresJson, raw?.expectedImpact),
      risks: Array.isArray(raw?.risks) ? raw.risks.map((risk: unknown) => normalizeText(risk, 260)).filter(Boolean).slice(0, 5) : [],
      rationale: normalizeText(raw?.rationale, 1200) || refinementObjectiveLabel(objective),
    },
  }
}

function fallbackRefinementCandidates(sourceRun: any, objective: RefinementObjective, evidenceRefs: EvidenceReference[], structured: StructuredIdea | null) {
  const signals = Array.isArray(sourceRun.scoresJson?.crossCorpusFacets)
    ? sourceRun.scoresJson.crossCorpusFacets as CrossCorpusFacetSignal[]
    : []
  const saturatedFacet = signals.find((signal) => signal.signal === 'saturated' || aggregateSignalStatus(signal) === 'PRESENT')?.facet
  const whiteSpaceFacet = signals.find((signal) => signal.signal === 'white_space_candidate' || signal.signal === 'translation_gap')?.facet
  const baseFacet = saturatedFacet || structured?.facets?.[0] || 'core research approach'
  const gapFacet = whiteSpaceFacet || structured?.facets?.[1] || 'unaddressed application context'
  const strategies = objectiveStrategies(objective)
  return strategies.map((strategy, index) => ({
    strategy,
    title: `${sourceRun.title} - ${strategy.replace(/_/g, ' ')}`.slice(0, 140),
    ideaText: `${sourceRun.ideaText}\n\nRefined direction: emphasize ${gapFacet} while narrowing or repositioning ${baseFacet}. This keeps the original problem intent but makes the proposal easier to compare against the current funded-project and cross-corpus evidence.`,
    facetChanges: [
      { facet: baseFacet, change: index === 0 ? 'modified' : 'kept', resultingFacet: baseFacet },
      { facet: gapFacet, change: index === 1 ? 'added' : 'modified', resultingFacet: gapFacet },
    ],
    citations: evidenceRefs[index]
      ? [{ sourceType: evidenceRefs[index].sourceType, evidenceId: evidenceRefs[index].evidenceId, role: index === 2 ? 'funder_signal' : 'supports_gap', quote: null }]
      : [],
    expectedImpact: { saturation: index === 2 ? 'flat' : 'down', whiteSpace: index === 2 ? 'flat' : 'up', rationale: 'Fallback direction estimated from the current matrix.' },
    risks: ['Validate the positioning with subject-matter evidence before using it in a proposal.'],
    rationale: 'Fallback refinement generated from the current landscape matrix because model output was unavailable or invalid.',
  }))
}

function extractCandidateArray(value: any) {
  if (Array.isArray(value?.candidates)) return value.candidates
  if (Array.isArray(value)) return value
  return []
}

function publicCandidate(candidate: any) {
  return {
    id: candidate.id,
    runId: candidate.runId,
    sessionId: candidate.sessionId,
    candidateIndex: candidate.candidateIndex,
    objective: candidate.objective,
    strategy: candidate.strategy,
    title: candidate.title,
    ideaText: candidate.ideaText,
    payload: candidate.payloadJson,
    groundednessScore: candidate.groundednessScore,
    status: candidate.status,
    selectedVersionId: candidate.selectedVersionId,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  }
}

export class IdeaIntelligenceService {
  async createRun(input: { ideaText: string; title?: string; anchorPublicProjectId?: string; anchorFundingCallId?: string }, actor: ActorContext) {
    const ideaText = normalizeText(input.ideaText, 12000)
    if (ideaText.length < 50) throw new Error('Describe the idea in at least 50 characters.')
    const title = normalizeText(input.title, 140) || ideaText.split(/[.!?]/)[0].slice(0, 120)
    let anchorFundingCallId: string | null = null
    if (input.anchorFundingCallId) {
      const anchoredCall = await loadAnchoredFundingCall(input.anchorFundingCallId, actor.access)
      if (!anchoredCall) throw new Error('The selected funding call was not found or is not accessible.')
      anchorFundingCallId = anchoredCall.id
    }
    const run = await prisma.$transaction(async (tx) => {
      const session = await tx.ideaIntelligenceSession.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          anchorPublicProjectId: input.anchorPublicProjectId || null,
          anchorFundingCallId,
          title,
        },
      })
      const version = await tx.ideaIntelligenceVersion.create({
        data: {
          sessionId: session.id,
          versionNumber: 1,
          title,
          ideaText,
        },
      })
      await tx.ideaIntelligenceSession.update({
        where: { id: session.id },
        data: { currentVersionId: version.id },
      })
      return tx.ideaIntelligenceRun.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          sessionId: session.id,
          versionId: version.id,
          anchorPublicProjectId: input.anchorPublicProjectId || null,
          anchorFundingCallId,
          title,
          ideaText,
        },
        include: {
          version: true,
          session: { include: { versions: { include: { runs: true }, orderBy: { versionNumber: 'asc' } } } },
          refinementCandidates: { orderBy: { candidateIndex: 'asc' } },
        },
      })
    })
    return publicRun(run)
  }

  async getRun(runId: string, userId: string) {
    const run = await prisma.ideaIntelligenceRun.findFirst({
      where: { id: runId, userId },
      include: {
        version: true,
        session: { include: { versions: { include: { runs: true }, orderBy: { versionNumber: 'asc' } } } },
        refinementCandidates: { orderBy: { candidateIndex: 'asc' } },
      },
    })
    return run ? publicRun(run) : null
  }

  async listRuns(userId: string, limit = 20) {
    const runs = await prisma.ideaIntelligenceRun.findMany({
      where: { userId }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 50),
      include: { version: true },
    })
    return runs.map(publicRun)
  }

  // ---------------------------------------------------------------------------
  // Funding match. A completed review says nothing about any funding call. Two
  // steps follow it: which calls the catalogue currently holds for this idea,
  // and how the idea reads against the one call the researcher picked.
  // ---------------------------------------------------------------------------

  /**
   * The open calls in the catalogue that match this idea, ranked against the
   * idea itself. Deliberately reads the FundingCall table rather than deriving
   * funders from the sanctioned-award ledger: a historical funder may have
   * nothing open, and an agency that never appears in the ledger may still be
   * the one advertising the right call today.
   */
  async matchCallsForIdea(runId: string, actor: ActorContext) {
    const run = await this.requireCompletedRun(runId, actor.userId)
    const structured = run.structuredIdeaJson as StructuredIdea | null
    if (!structured?.semanticQuery) throw new Error('This analysis has no structured idea to match against.')

    let rankedSemantically = true
    let lowConfidence = false
    let calls: FundingMatchCall[] = []

    try {
      const search = await recommendationSearchService.search({
        inputMode: 'research_area',
        query: { researchArea: structured.semanticQuery },
        filters: { includeExpired: false, limit: 20 },
        access: actor.access,
        llmContext: { tenantId: actor.tenantId, userId: actor.userId },
      })
      lowConfidence = Boolean(search?.lowConfidence)
      calls = (search?.rawResults || []).map((call) => ({
        id: call.id,
        agencyName: call.agencyName || '',
        schemeTitle: call.schemeTitle || '',
        shortDescription: normalizeText(call.shortDescription || call.description, 600),
        closeDate: call.closeDate ? String(call.closeDate) : null,
        isRolling: Boolean(call.isRolling),
        amountMin: call.amountMin ?? null,
        amountMax: call.amountMax ?? null,
        currency: call.currency ?? null,
        eligibilitySummary: normalizeText(call.eligibilitySummary, 500),
        officialUrls: Array.isArray(call.officialUrls) ? call.officialUrls : [],
        score: typeof call.score === 'number' ? call.score : 0,
        matchReasons: Array.isArray(call.matchReasons) ? call.matchReasons : [],
      }))
    } catch (error) {
      console.warn('[IdeaIntelligence] call search failed:', error instanceof Error ? error.message : error)
      calls = []
    }

    if (!calls.length) {
      // The semantic pass found nothing. Rather than show an empty drawer, list
      // what the catalogue actually has open, soonest deadline first, clearly
      // labelled as not ranked against the idea so the user judges the fit.
      rankedSemantically = false
      const fallback = await prisma.fundingCall.findMany({
        where: {
          AND: [
            fundingCallAccessWhere(actor.access),
            { OR: [{ close_date: null }, { close_date: { gte: new Date() } }] },
          ],
        },
        select: {
          id: true, agency_name: true, agencyName: true, scheme_title: true, title: true,
          description: true, summary: true, close_date: true, is_rolling: true,
          amount_min: true, amount_max: true, currency: true, eligibility_text: true, official_urls: true,
        },
        orderBy: [{ close_date: 'asc' }],
        take: 12,
      })
      calls = fallback.map((call) => ({
        id: call.id,
        agencyName: call.agency_name || call.agencyName || '',
        schemeTitle: call.scheme_title || call.title || '',
        shortDescription: normalizeText(call.description || call.summary, 600),
        closeDate: call.close_date ? call.close_date.toISOString() : null,
        isRolling: Boolean(call.is_rolling),
        amountMin: call.amount_min ?? null,
        amountMax: call.amount_max ?? null,
        currency: call.currency ?? null,
        eligibilitySummary: normalizeText(call.eligibility_text, 500),
        officialUrls: Array.isArray(call.official_urls) ? call.official_urls : [],
        score: 0,
        matchReasons: ['Open in the catalogue — not ranked against your idea'],
      }))
    }

    const report = (run.reportJson || {}) as Record<string, any>
    const fundingMatch = { calls, rankedSemantically, lowConfidence, matchedAt: new Date().toISOString() }
    await prisma.ideaIntelligenceRun.update({
      where: { id: runId },
      data: { reportJson: { ...report, fundingMatch } as any },
    })
    return { fundingMatch, selectedFundingCallId: normalizeText(report.targetFundingCallId, 80) || null }
  }

  /**
   * Step 3: read the idea against the one call the user picked — per-facet call
   * fit, the gap report, and the simulated review panel. This is the only step
   * that writes a target call onto the run.
   */
  async evaluateAgainstCall(runId: string, fundingCallIdInput: string, actor: ActorContext) {
    const fundingCallId = normalizeText(fundingCallIdInput, 80)
    if (!fundingCallId) throw new Error('Pick a funding call first.')
    const run = await this.requireCompletedRun(runId, actor.userId)
    const structured = run.structuredIdeaJson as StructuredIdea | null
    if (!structured?.facets?.length) throw new Error('This analysis has no structured idea to compare.')

    const callRecord = await loadAnchoredFundingCall(fundingCallId, actor.access)
    if (!callRecord) throw new Error('The selected funding call was not found or is not accessible.')
    const guidelineChunks = await loadAnchoredCallGuidelineChunks(callRecord.id, structured.semanticQuery, actor.access).catch(() => [])

    const anchoredCall = {
      ...mapAnchoredCallForRetrieval(callRecord),
      description: normalizeText(callRecord.description || callRecord.summary, 2400),
      eligibilityText: normalizeText(callRecord.eligibility_text, 2000),
      deliverablesText: normalizeText(callRecord.expected_deliverables_text, 1200),
      fundingKinds: callRecord.funding_kinds || [],
      disciplines: callRecord.disciplines || [],
      careerStages: callRecord.career_stages || [],
      institutionTypes: callRecord.institution_types || [],
      projectDurationText: callRecord.project_duration_text || null,
      guidelineChunks,
    }

    const retrieval = (run.retrievalResultsJson || {}) as Record<string, any>
    const analysis = (run.analysisJson || {}) as Record<string, any>
    const projects: Array<{ id: string }> = Array.isArray(retrieval.projects) ? retrieval.projects : []
    const comparisonProjects = projects.slice(0, SANCTIONED_PROJECT_COMPARISON_LIMIT).map((project: any) => ({
      projectId: project.id,
      title: project.title,
      year: project.sanctionYear,
      funder: project.sourceKey,
      scheme: project.schemeName,
      abstract: project.abstractText && String(project.abstractText).toUpperCase() !== 'NA' ? String(project.abstractText).slice(0, 1800) : null,
      summary: project.executiveSummary ? String(project.executiveSummary).slice(0, 1200) : null,
    }))

    const callRoles = new Map<string, 'anchored' | 'matched'>([[fundingCallId, 'anchored']])
    const comparisonCall = buildComparisonCallPayload(fundingCallId, 'anchored', anchoredCall, [])

    // Per-facet fit against this call's own text only. The rest of the report
    // (whitespace, funded ledger) was settled during the review pass.
    let callItems: FundingCallFacetAssessment[] = []
    try {
      const response = await runFundingGatewayText({
        taskCode: IDEA_INTELLIGENCE_TASK_CODE,
        stageCode: IDEA_INTELLIGENCE_EVIDENCE_MAP_STAGE_CODE,
        context: { tenantId: actor.tenantId, userId: actor.userId },
        responseMimeType: 'application/json',
        temperature: 0.1,
        // Reasoning models spend part of this budget thinking, so a tight cap
        // truncates the JSON mid-object and the whole fit is lost.
        maxTokensOut: 6000,
        metadata: { purpose: 'idea_intelligence_call_fit', runId, fundingCallId },
        prompt: `Assess how a research idea's facets line up against what one funding call actually invites.

IDEA FACETS:
${JSON.stringify(structured.facets)}

FUNDING CALL (what it invites or requires):
${JSON.stringify(comparisonCall)}

Return JSON only:
${jsonShape([EVIDENCE_MAP_SHAPE.callItems])}

Rules:
${CALL_ITEM_RULES}
- Judge only against the supplied call text. Never use general knowledge about the agency.
- Do not call anything novel or fundable, and never predict funding success.`,
      })
      const json = response ? extractJsonObject(response.rawText) as any : {}
      callItems = normalizeCallItems(json?.callItems, callRoles, structured.facets)
    } catch (error) {
      console.warn('[IdeaIntelligence] call fit failed:', error instanceof Error ? error.message : error)
      callItems = []
    }

    if (!callItems.length) {
      // The comparison did not come back. Show the call with every facet marked
      // unassessed rather than dropping the section — silently omitting it would
      // read as "this call was never chosen".
      callItems = [{
        fundingCallId,
        role: 'anchored',
        summary: '',
        callPriorities: [],
        facetAssessments: structured.facets.map((facet) => ({
          facet,
          status: 'UNASSESSED' as const,
          evidence: '',
          reason: 'The fit check did not complete for this facet. Re-run it, or read the call document directly.',
        })),
      }]
    }

    const targetItems = callItems.find((item) => item.fundingCallId === fundingCallId) || null
    const gapResult = await runCallGapAnalysis({
      runId,
      actor,
      targetCallId: fundingCallId,
      structured,
      targetComparison: comparisonCall,
      targetItems,
      overlap: {
        strongestOverlap: Array.isArray(analysis.strongestOverlap) ? analysis.strongestOverlap : [],
        whiteSpace: Array.isArray(analysis.whiteSpace) ? analysis.whiteSpace : [],
        cautions: Array.isArray(analysis.cautions) ? analysis.cautions : [],
      },
      comparisonProjects,
      validEvidenceIds: new Set<string>([fundingCallId, ...projects.map((project) => project.id)]),
    })

    // Re-running with a different call replaces the previous call block rather
    // than accumulating fits for calls the user has moved on from.
    const scores = { ...(run.scoresJson as Record<string, unknown> || {}), callAlignments: calculateCallAlignments(callItems) }
    const report = {
      ...(run.reportJson as Record<string, unknown> || {}),
      callFit: [],
      callGaps: gapResult.callGaps,
      reviewerPanel: gapResult.reviewerPanel,
      targetFundingCallId: fundingCallId,
    }
    const existingCalls: Array<{ id: string }> = Array.isArray(retrieval.fundingCalls) ? retrieval.fundingCalls : []
    const nextRetrieval = {
      ...retrieval,
      fundingCalls: existingCalls.some((call) => call.id === fundingCallId)
        ? existingCalls
        : [mapAnchoredCallForRetrieval(callRecord), ...existingCalls],
      sourcesUsed: { ...(retrieval.sourcesUsed || {}), calls: true },
    }
    const nextAnalysis = { ...analysis, callItems }

    const updated = await prisma.ideaIntelligenceRun.update({
      where: { id: runId },
      data: {
        analysisJson: nextAnalysis as any,
        scoresJson: scores as any,
        reportJson: report as any,
        retrievalResultsJson: nextRetrieval as any,
      },
      include: {
        version: true,
        session: { include: { versions: { include: { runs: true }, orderBy: { versionNumber: 'asc' } } } },
        refinementCandidates: { orderBy: { candidateIndex: 'asc' } },
      },
    })
    return publicRun(updated)
  }

  private async requireCompletedRun(runId: string, userId: string) {
    const run = await prisma.ideaIntelligenceRun.findFirst({ where: { id: runId, userId } })
    if (!run) throw new Error('Idea analysis not found')
    if (run.status !== 'COMPLETED') throw new Error('Finding funding opportunities is available after the analysis completes.')
    return run
  }

  async refineRun(runId: string, input: { objective?: string; instructions?: string; candidateId?: string; editedIdeaText?: string }, actor: ActorContext) {
    const sourceRun = await prisma.ideaIntelligenceRun.findFirst({
      where: { id: runId, userId: actor.userId },
      include: {
        version: true,
        session: { include: { versions: { orderBy: { versionNumber: 'asc' } } } },
      },
    })
    if (!sourceRun) throw new Error('Idea analysis not found')
    if (sourceRun.status !== 'COMPLETED') throw new Error('Refinement is available after the analysis completes.')

    let objective = (normalizeText(input.objective, 80) || 'maximize_white_space') as RefinementObjective
    const instructions = normalizeText(input.instructions, 1500)
    let refined: { title: string; ideaText: string; rationale: string }
    let selectedCandidateId: string | null = null

    if (input.candidateId) {
      const candidate = await prisma.ideaRefinementCandidate.findFirst({
        where: { id: input.candidateId, runId: sourceRun.id },
      })
      if (!candidate) throw new Error('Refinement candidate not found')
      if (candidate.status === 'SELECTED' && candidate.selectedVersionId) {
        throw new Error('This refinement candidate has already been used.')
      }
      if (candidate.status === 'DISMISSED') throw new Error('This refinement candidate was dismissed.')
      const payload = candidate.payloadJson as any as RefinementCandidatePayload
      objective = (normalizeText(candidate.objective, 80) || objective) as RefinementObjective
      refined = {
        title: normalizeText(payload?.title || candidate.title, 140) || `${sourceRun.title} - refined`,
        ideaText: sanitizeIdeaClaims(normalizeText(input.editedIdeaText, 12000) || normalizeText(payload?.ideaText || candidate.ideaText, 12000) || sourceRun.ideaText),
        rationale: normalizeText(payload?.rationale, 1200) || refinementObjectiveLabel(objective),
      }
      selectedCandidateId = candidate.id
    } else {
      // Backward-compatible path for clients that have not moved to candidate selection yet.
      objective = objective || 'maximize_white_space'

      try {
        const response = await runFundingGatewayText({
          taskCode: IDEA_INTELLIGENCE_TASK_CODE,
          stageCode: IDEA_INTELLIGENCE_REFINE_STAGE_CODE,
          context: { tenantId: actor.tenantId, userId: actor.userId },
          responseMimeType: 'application/json',
          temperature: 0.25,
          maxTokensOut: 2200,
          metadata: { purpose: 'idea_intelligence_refinement', runId, objective },
          prompt: `Refine this research idea using the completed funding landscape analysis.

OBJECTIVE: ${refinementObjectiveLabel(objective)}
USER INSTRUCTIONS: ${instructions || 'None'}
CURRENT IDEA:
${sourceRun.ideaText}

STRUCTURED IDEA: ${JSON.stringify(sourceRun.structuredIdeaJson || {})}
LANDSCAPE SCORES: ${JSON.stringify(sourceRun.scoresJson || {})}
ANALYSIS: ${JSON.stringify(sourceRun.analysisJson || {})}
REPORT: ${JSON.stringify(sourceRun.reportJson || {})}

Return JSON only:
{"title":"short refined title","ideaText":"a complete refined idea description of at least 80 words","rationale":"what changed and why"}

Rules:
- Do not invent fabricated evidence.
- Preserve the user's core intent unless the requested objective requires narrowing.
- Make the refined idea more grant-ready and evidence-aware.`,
        })
        const json = response ? extractJsonObject(response.rawText) : {}
        refined = {
          title: normalizeText((json as any)?.title, 140) || `${sourceRun.title} - refined`,
          ideaText: sanitizeIdeaClaims(normalizeText((json as any)?.ideaText, 12000) || sourceRun.ideaText),
          rationale: normalizeText((json as any)?.rationale, 1200) || refinementObjectiveLabel(objective),
        }
      } catch {
        refined = {
          title: `${sourceRun.title} - refined`.slice(0, 140),
          ideaText: `${sourceRun.ideaText}\n\nRefinement focus: ${refinementObjectiveLabel(objective)}.${instructions ? ` ${instructions}` : ''}`,
          rationale: 'Created a new version using the selected refinement focus. Re-run analysis to calculate updated evidence signals.',
        }
      }
    }

    if (refined.ideaText.length < 50) {
      refined.ideaText = `${sourceRun.ideaText}\n\nRefinement focus: ${refinementObjectiveLabel(objective)}.`
    }

    const created = await prisma.$transaction(async (tx) => {
      let sessionId = sourceRun.sessionId
      let parentVersionId = sourceRun.versionId
      let nextVersionNumber = (sourceRun.session?.versions?.length || 0) + 1

      if (!sessionId) {
        const session = await tx.ideaIntelligenceSession.create({
          data: {
            tenantId: sourceRun.tenantId,
            userId: sourceRun.userId,
            anchorPublicProjectId: sourceRun.anchorPublicProjectId,
            anchorFundingCallId: sourceRun.anchorFundingCallId,
            title: sourceRun.title,
          },
        })
        const baseVersion = await tx.ideaIntelligenceVersion.create({
          data: {
            sessionId: session.id,
            versionNumber: 1,
            title: sourceRun.title,
            ideaText: sourceRun.ideaText,
            structuredIdeaJson: sourceRun.structuredIdeaJson as Prisma.InputJsonValue,
          },
        })
        await tx.ideaIntelligenceRun.update({
          where: { id: sourceRun.id },
          data: { sessionId: session.id, versionId: baseVersion.id },
        })
        sessionId = session.id
        parentVersionId = baseVersion.id
        nextVersionNumber = 2
      }

      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`idea-intelligence-session:${sessionId!}`}))
      `
      const versionNumber = await tx.ideaIntelligenceVersion.count({ where: { sessionId: sessionId! } }) + 1
      const version = await tx.ideaIntelligenceVersion.create({
        data: {
          sessionId: sessionId!,
          versionNumber: versionNumber || nextVersionNumber,
          title: refined.title,
          ideaText: refined.ideaText,
          parentVersionId,
          refinementObjective: objective,
          refinementRationale: refined.rationale,
        },
      })
      await tx.ideaIntelligenceSession.update({
        where: { id: sessionId! },
        data: { currentVersionId: version.id, title: refined.title },
      })
      if (selectedCandidateId) {
        await tx.ideaRefinementCandidate.update({
          where: { id: selectedCandidateId },
          data: { status: 'SELECTED', selectedVersionId: version.id },
        })
        await tx.ideaRefinementCandidate.updateMany({
          where: { runId: sourceRun.id, id: { not: selectedCandidateId }, status: 'PROPOSED' },
          data: { status: 'DISMISSED' },
        })
      }
      return tx.ideaIntelligenceRun.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          sessionId: sessionId!,
          versionId: version.id,
          anchorPublicProjectId: sourceRun.anchorPublicProjectId,
          anchorFundingCallId: sourceRun.anchorFundingCallId,
          title: refined.title,
          ideaText: refined.ideaText,
        },
        include: {
          version: true,
          session: { include: { versions: { include: { runs: true }, orderBy: { versionNumber: 'asc' } } } },
          refinementCandidates: { orderBy: { candidateIndex: 'asc' } },
        },
      })
    })

    return publicRun(created)
  }

  async generateRefinementCandidates(runId: string, input: { objective?: string; instructions?: string; targetGapId?: string }, actor: ActorContext) {
    const sourceRun = await prisma.ideaIntelligenceRun.findFirst({
      where: { id: runId, userId: actor.userId },
      include: {
        version: true,
        session: { include: { versions: { orderBy: { versionNumber: 'asc' } } } },
        refinementCandidates: { orderBy: { candidateIndex: 'asc' } },
      },
    })
    if (!sourceRun) throw new Error('Idea analysis not found')
    if (sourceRun.status !== 'COMPLETED') throw new Error('Refinement suggestions are available after the analysis completes.')

    let targetGap: IdeaCallGap | null = null
    let targetDirection: WhitespaceDirection | null = null
    if (input.targetGapId) {
      const report = (sourceRun.reportJson || {}) as any
      const gaps = Array.isArray(report.callGaps) ? report.callGaps : []
      targetGap = gaps.find((gap: any) => gap?.id === input.targetGapId) || null
      if (!targetGap) {
        // The same field also carries whitespace direction ids, so "pursue this
        // direction" reuses the gap-targeted refinement path without a new route.
        const directions = Array.isArray(report.whitespaceDirections) ? report.whitespaceDirections : []
        targetDirection = directions.find((direction: any) => direction?.id === input.targetGapId) || null
      }
      if (!targetGap && !targetDirection) {
        throw new Error('That direction is no longer part of this analysis. Re-run the analysis and try again.')
      }
    }
    const objective = (normalizeText(input.objective, 80)
      || (targetDirection ? 'maximize_white_space' : targetGap ? 'target_funder' : 'maximize_white_space')) as RefinementObjective
    const instructions = normalizeText(input.instructions, 1500)
    const structured = sourceRun.structuredIdeaJson as StructuredIdea | null
    const evidenceRefs = buildRunEvidenceReferences(sourceRun.retrievalResultsJson)
    if (!evidenceRefs.length) {
      throw new Error('No retrieved evidence is available to ground refinement suggestions.')
    }

    let rawCandidates: any[] = []
    try {
      const response = await runFundingGatewayText({
        taskCode: IDEA_INTELLIGENCE_TASK_CODE,
        stageCode: IDEA_INTELLIGENCE_REFINE_STAGE_CODE,
        context: { tenantId: actor.tenantId, userId: actor.userId },
        responseMimeType: 'application/json',
        temperature: 0.25,
        maxTokensOut: 4200,
        metadata: { purpose: 'idea_intelligence_refinement_candidates', runId, objective },
        prompt: `Generate three distinct, evidence-grounded refinement candidates for a research idea.

OBJECTIVE: ${refinementObjectiveLabel(objective)}
USER INSTRUCTIONS: ${instructions || 'None'}
${targetGap ? `\nTARGET GAP TO CLOSE (every candidate must directly address this specific gap):\n${JSON.stringify(targetGap)}\n` : ''}${targetDirection ? `\nTARGET WHITESPACE DIRECTION (every candidate must move the idea into this specific opening, keeping the researcher's core intent):\n${JSON.stringify(targetDirection)}\n` : ''}
CURRENT IDEA:
${sourceRun.ideaText}

STRUCTURED IDEA:
${JSON.stringify(sourceRun.structuredIdeaJson || {})}

CROSS-CORPUS MATRIX AND SCORES:
${JSON.stringify(sourceRun.scoresJson || {})}

ANALYSIS:
${JSON.stringify(sourceRun.analysisJson || {})}

REPORT:
${JSON.stringify(sourceRun.reportJson || {})}

ALLOWED EVIDENCE IDS:
${JSON.stringify(compactEvidenceForPrompt(evidenceRefs))}

Return JSON only:
{"candidates":[{"strategy":"narrow_scope|pivot_facet|combine_white_space|funder_align|de_risk","title":"<=140 chars","ideaText":"complete refined idea >=80 words","facetChanges":[{"facet":"existing or new facet","change":"kept|modified|dropped|added","resultingFacet":"facet after refinement"}],"citations":[{"sourceType":"funded_project|publication|patent|web","evidenceId":"exact allowed evidenceId","role":"supports_gap|shows_overlap|shows_momentum|funder_signal","quote":"short verbatim quote from allowed evidence text, or null"}],"expectedImpact":{"saturation":"down|flat|up","whiteSpace":"up|flat|down","rationale":"why these arrows are expected"},"risks":["..."],"rationale":"what changed and why"}]}

Rules:
- Return exactly 3 candidates.
- Each candidate must use a different strategy suited to the objective.
- Cite only evidence IDs from ALLOWED EVIDENCE IDS.
- Quotes must be verbatim substrings of the supplied evidence excerpts.
- Do not claim the idea is novel, patentable, or likely to be funded.
- Treat absence of corpus evidence as a signal to verify, not proof of novelty.${targetGap ? '\n- Every candidate must directly close the TARGET GAP while preserving the idea\'s core intent; say in the rationale how the gap is closed.' : ''}`,
      })
      rawCandidates = extractCandidateArray(response ? extractJsonObject(response.rawText) : {})
    } catch {
      rawCandidates = []
    }

    if (rawCandidates.length < 3) {
      rawCandidates = fallbackRefinementCandidates(sourceRun, objective, evidenceRefs, structured)
    }

    const normalized = rawCandidates
      .slice(0, 3)
      .map((candidate, index) => normalizeRefinementCandidate(candidate, index + 1, sourceRun, objective, evidenceRefs, structured))

    const created = await prisma.$transaction(async (tx) => {
      await tx.ideaRefinementCandidate.deleteMany({
        where: { runId: sourceRun.id, status: 'PROPOSED' },
      })
      const rows = []
      for (const [index, candidate] of normalized.entries()) {
        rows.push(await tx.ideaRefinementCandidate.create({
          data: {
            runId: sourceRun.id,
            sessionId: sourceRun.sessionId,
            candidateIndex: index + 1,
            objective,
            strategy: candidate.payload.strategy,
            title: candidate.payload.title,
            ideaText: candidate.payload.ideaText,
            payloadJson: { ...candidate.payload, targetGapId: targetGap?.id || null } as unknown as Prisma.InputJsonValue,
            groundednessScore: candidate.groundednessScore,
            status: 'PROPOSED',
          },
        }))
      }
      return rows
    })

    return created.map(publicCandidate)
  }

  async execute(runId: string, actor: ActorContext) {
    const existing = await prisma.ideaIntelligenceRun.findFirst({
      where: { id: runId, userId: actor.userId },
      include: {
        version: true,
        session: { include: { versions: { include: { runs: true }, orderBy: { versionNumber: 'asc' } } } },
        refinementCandidates: { orderBy: { candidateIndex: 'asc' } },
      },
    })
    if (!existing) throw new Error('Idea analysis not found')
    if (existing.status === 'COMPLETED') return publicRun(existing)
    if (existing.status === 'PROCESSING' && existing.updatedAt.getTime() > Date.now() - 10 * 60 * 1000) {
      return publicRun(existing)
    }

    await prisma.ideaIntelligenceRun.update({
      where: { id: runId },
      data: { status: 'PROCESSING', errorMessage: null, startedAt: existing.startedAt || new Date() },
    })

    try {
      // Stage 0: convert free-form text into stable search and comparison facets.
      await prisma.ideaIntelligenceRun.update({ where: { id: runId }, data: { currentStage: 0 } })
      let structured = existing.structuredIdeaJson as StructuredIdea | null
      if (!structured) {
        const response = await runFundingGatewayText({
          taskCode: IDEA_INTELLIGENCE_TASK_CODE,
          stageCode: IDEA_INTELLIGENCE_STRUCTURE_STAGE_CODE,
          context: { tenantId: actor.tenantId, userId: actor.userId },
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxTokensOut: 1600,
          metadata: { purpose: 'idea_intelligence_structure', runId },
          prompt: `Structure the following research idea for evidence-based funding-landscape search.

IDEA:
${existing.ideaText}

Return JSON only with:
{"title":"...","problem":"...","approach":"...","intendedUsers":"...","domain":"...","trl":1,"facets":["3 to 7 discrete testable aspects"],"keywords":["up to 12"],"semanticQuery":"one dense retrieval query under 60 words"}

Do not claim novelty or funding likelihood. Facets must be specific enough to compare against project abstracts.`,
        })
        structured = normalizeStructure(response ? extractJsonObject(response.rawText) : {}, existing.ideaText)
        await prisma.ideaIntelligenceRun.update({
          where: { id: runId },
          data: { title: structured.title, structuredIdeaJson: structured as any, currentStage: 1 },
        })
      }

      // Stage 1: retrieve real awards and live calls in parallel. The sanctioned
      // corpus is the base of the whitespace read, so it is retrieved deep.
      const projectSearchPromise = (async () => {
        const primary = await publicProjectSearchService.search({
          query: structured.semanticQuery,
          limit: SANCTIONED_PROJECT_RETRIEVAL_LIMIT,
          tenantId: actor.tenantId,
          userId: actor.userId,
        })
        if (primary.results.length > 0) return primary

        const fallbackQuery = [structured.domain, ...structured.keywords.slice(0, 8)].filter(Boolean).join(' ')
        if (!fallbackQuery || fallbackQuery.toLowerCase() === structured.semanticQuery.toLowerCase()) return primary
        return publicProjectSearchService.search({
          query: fallbackQuery,
          limit: SANCTIONED_PROJECT_RETRIEVAL_LIMIT,
          tenantId: actor.tenantId,
          userId: actor.userId,
        })
      })()

      const anchorFundingCallId = existing.anchorFundingCallId || null
      // The review pass reads the sanctioned corpus only. Calls are searched here
      // just to give an anchored call its neighbours; otherwise they arrive later,
      // through the user-driven funding-match step, so the report can never grade
      // the idea against a call the user did not pick.
      const searchCallsInReview = IDEA_SOURCE_FLAGS.callsDuringReview || Boolean(anchorFundingCallId)
      const externalEvidenceEnabled = anyExternalEvidenceEnabled()
      const settled = await Promise.allSettled([
        projectSearchPromise,
        searchCallsInReview
          ? recommendationSearchService.search({
              inputMode: 'research_area',
              query: { researchArea: structured.semanticQuery },
              filters: { includeExpired: false, limit: 6 },
              access: actor.access,
              llmContext: { tenantId: actor.tenantId, userId: actor.userId },
            })
          : Promise.resolve(null),
        externalEvidenceEnabled
          ? retrieveIdeaEvidence(structured.semanticQuery, { publicationLimit: 10, patentLimit: 10, webLimit: 8 })
          : Promise.resolve(emptyIdeaEvidence(['publications', 'patents', 'web'])),
        anchorFundingCallId
          ? loadAnchoredFundingCall(anchorFundingCallId, actor.access)
          : Promise.resolve(null),
      ])
      for (const s of settled) {
        if (s.status === 'rejected') console.warn('[IdeaIntelligence] source skipped:', s.reason?.message || s.reason)
      }
      const projectSearch = settled[0].status === 'fulfilled' ? settled[0].value : null
      const fundingSearch = settled[1].status === 'fulfilled' ? settled[1].value : null
      const evidenceSearch: MultiSourceEvidence = settled[2].status === 'fulfilled'
        ? settled[2].value
        : { publications: [], patents: [], webResults: [], diagnostics: { publicationSources: [], patentnestConfigured: false, patentnestStatus: 'not_configured' } }
      const anchoredCallRecord = settled[3].status === 'fulfilled' ? settled[3].value : null
      const anchoredCallChunks = anchoredCallRecord
        ? await loadAnchoredCallGuidelineChunks(anchoredCallRecord.id, structured.semanticQuery, actor.access).catch(() => [])
        : []
      const projects = projectSearch?.results ?? []
      let fundingCalls = (fundingSearch?.rawResults || []).map((call) => ({
        id: call.id,
        agencyName: call.agencyName,
        schemeTitle: call.schemeTitle,
        shortDescription: call.shortDescription || call.description,
        closeDate: call.closeDate,
        isRolling: call.isRolling,
        amountMin: call.amountMin,
        amountMax: call.amountMax,
        currency: call.currency,
        eligibilitySummary: call.eligibilitySummary,
        officialUrls: call.officialUrls,
        score: call.score,
        matchReasons: call.matchReasons,
      }))
      if (anchoredCallRecord && !fundingCalls.some((call) => call.id === anchoredCallRecord.id)) {
        fundingCalls = [mapAnchoredCallForRetrieval(anchoredCallRecord), ...fundingCalls]
      }
      const anchoredCall = anchoredCallRecord
        ? {
            ...mapAnchoredCallForRetrieval(anchoredCallRecord),
            description: normalizeText(anchoredCallRecord.description || anchoredCallRecord.summary, 2400),
            eligibilityText: normalizeText(anchoredCallRecord.eligibility_text, 2000),
            deliverablesText: normalizeText(anchoredCallRecord.expected_deliverables_text, 1200),
            fundingKinds: anchoredCallRecord.funding_kinds || [],
            disciplines: anchoredCallRecord.disciplines || [],
            careerStages: anchoredCallRecord.career_stages || [],
            institutionTypes: anchoredCallRecord.institution_types || [],
            projectDurationText: anchoredCallRecord.project_duration_text || null,
            guidelineChunks: anchoredCallChunks,
          }
        : null
      // Recorded so the workspace can hide the tabs and matrix columns for corpora
      // that were never searched, without breaking runs made before this existed.
      const sourcesUsed: IdeaSourcesUsed = {
        projects: true,
        publications: IDEA_SOURCE_FLAGS.publications,
        patents: IDEA_SOURCE_FLAGS.patents,
        web: IDEA_SOURCE_FLAGS.web,
        calls: searchCallsInReview,
      }
      const retrieval = {
        projects,
        fundingCalls,
        anchoredCall,
        publications: evidenceSearch.publications,
        patents: evidenceSearch.patents,
        webResults: evidenceSearch.webResults,
        evidenceDiagnostics: evidenceSearch.diagnostics,
        sourcesUsed,
        degradedMode: projectSearch?.degradedMode ?? null,
        query: structured.semanticQuery,
      }
      await prisma.ideaIntelligenceRun.update({
        where: { id: runId }, data: { retrievalResultsJson: retrieval as any, currentStage: 2 },
      })

      // Stage 2/3: compare only grounded source text. Missing evidence stays unassessed.
      await prisma.ideaIntelligenceRun.update({ where: { id: runId }, data: { currentStage: 3 } })
      const comparisonProjects = projects.slice(0, SANCTIONED_PROJECT_COMPARISON_LIMIT).map((project) => ({
        projectId: project.id,
        title: project.title,
        year: project.sanctionYear,
        funder: project.sourceKey,
        scheme: project.schemeName,
        abstract: project.abstractText && project.abstractText.toUpperCase() !== 'NA' ? project.abstractText.slice(0, 1800) : null,
        summary: project.executiveSummary?.slice(0, 1200) || null,
      }))
      const comparisonPublications = evidenceSearch.publications.slice(0, 8).map((item) => ({
        evidenceId: item.id,
        title: item.title,
        year: item.year,
        venue: item.venue,
        citationCount: item.citationCount,
        abstract: item.abstract?.slice(0, 1400) || null,
      }))
      const comparisonPatents = evidenceSearch.patents.slice(0, 8).map((item) => ({
        evidenceId: item.id,
        title: item.title,
        publicationNumber: item.publicationNumber,
        assignee: item.assignee,
        date: item.publicationDate || item.filingDate || item.priorityDate,
        abstract: item.abstract?.slice(0, 1200) || null,
      }))
      const comparisonWebResults = evidenceSearch.webResults.slice(0, 6).map((item) => ({
        evidenceId: item.id,
        title: item.title,
        source: item.source,
        date: item.date,
        snippet: item.snippet?.slice(0, 900) || null,
      }))
      // Only a call the user deliberately anchored is compared here. Nearest-match
      // calls used to be promoted to role 'matched' automatically, which is how an
      // unrelated call ended up graded against an idea nobody attached it to.
      const callRoles = new Map<string, 'anchored' | 'matched'>()
      if (anchoredCall) callRoles.set(anchoredCall.id, 'anchored')
      const comparisonCalls = Array.from(callRoles.entries()).map(([callId, role]) =>
        buildComparisonCallPayload(callId, role, anchoredCall, fundingCalls)
      )
      const comparisonResponse = await runFundingGatewayText({
        taskCode: IDEA_INTELLIGENCE_TASK_CODE,
        stageCode: IDEA_INTELLIGENCE_EVIDENCE_MAP_STAGE_CODE,
        context: { tenantId: actor.tenantId, userId: actor.userId },
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxTokensOut: 7500,
        metadata: { purpose: 'idea_intelligence_overlap', runId },
        prompt: `Compare an idea with the supplied evidence. Only the sections present below were searched — say nothing about any other corpus.

IDEA FACETS:
${JSON.stringify(structured.facets)}

${promptSections([
  ['FUNDED PROJECTS', comparisonProjects],
  ['PUBLICATIONS', comparisonPublications],
  ['PATENTS', comparisonPatents],
  ['WEB RESULTS', comparisonWebResults],
  ['FUNDING CALLS (what each call invites or requires)', comparisonCalls],
])}

Return JSON only:
${jsonShape([
  EVIDENCE_MAP_SHAPE.items,
  comparisonPublications.length > 0 && EVIDENCE_MAP_SHAPE.publicationItems,
  comparisonPatents.length > 0 && EVIDENCE_MAP_SHAPE.patentItems,
  comparisonWebResults.length > 0 && EVIDENCE_MAP_SHAPE.webItems,
  comparisonCalls.length > 0 && EVIDENCE_MAP_SHAPE.callItems,
  EVIDENCE_MAP_SHAPE.tail,
])}

Rules:
${promptLines([
  '- Never infer capabilities not supported by supplied text.',
  '- Use UNASSESSED when the abstract/summary does not contain enough evidence.',
  '- ABSENT means the supplied evidence actively supports absence; missing text is UNASSESSED.',
  comparisonWebResults.length > 0 && '- Treat web snippets as weak supporting evidence only.',
  comparisonCalls.length > 0 && CALL_ITEM_RULES,
  '- Do not call anything novel or fundable.',
])}`,
      })
      const comparisonJson = comparisonResponse ? extractJsonObject(comparisonResponse.rawText) as any : {}
      const analysis = {
        ...normalizeCrossCorpusAnalysis(comparisonJson, projects, evidenceSearch, structured.facets),
        callItems: normalizeCallItems(comparisonJson?.callItems, callRoles, structured.facets),
      }
      const landscapeSignals = calculateLandscapeSignals(projects, analysis, evidenceSearch)

      // Deterministic ledger of what the sanctioned corpus already funded, who
      // funded it, and how much of it is still running. The report narrates this;
      // it never produces its own counts.
      const projectRecords = await loadProjectRecords(projects.map((project) => project.id))
        .catch(() => ({ deliveries: [] as ProjectDelivery[], extras: [] as PriorWorkAwardExtras[] }))
      const deliveries = projectRecords.deliveries
      const fundedPortfolio: FundedPortfolio = buildFundedPortfolio(
        projects.map((project) => ({
          id: project.id,
          title: project.title,
          fundingAgency: project.fundingAgency,
          sourceName: project.sourceName,
          sourceKey: project.sourceKey,
          schemeName: project.schemeName,
          sanctionYear: project.sanctionYear,
          budgetAmount: project.budgetAmount,
          budgetCurrency: project.budgetCurrency,
          primaryInstitutionName: project.primaryInstitutionName,
          state: project.state,
        })),
        deliveries
      )
      const facetCoverage = buildFacetCoverage(landscapeSignals.crossCorpusFacets)
      // One ranked list of "someone already did this" across both corpora, the
      // facet-by-facet coverage the openings are read off, and why each opening
      // is open. All deterministic — the report only narrates it.
      const priorWork: PriorWork = buildPriorWork({
        awards: projects.map((project) => ({
          id: project.id,
          title: project.title,
          abstract: project.abstractText && project.abstractText.toUpperCase() !== 'NA' ? project.abstractText : null,
          fundingAgency: project.fundingAgency,
          sourceName: project.sourceName,
          sourceKey: project.sourceKey,
          schemeName: project.schemeName,
          sanctionYear: project.sanctionYear,
          budgetAmount: project.budgetAmount,
          budgetCurrency: project.budgetCurrency,
          primaryInstitutionName: project.primaryInstitutionName,
          state: project.state,
          relevanceScore: project.relevanceScore,
        })),
        awardExtras: projectRecords.extras,
        patents: evidenceSearch.patents,
        awardAssessments: analysis.items.map((item) => ({ id: item.projectId, facetAssessments: item.facetAssessments })),
        patentAssessments: analysis.patentItems.map((item) => ({ id: item.evidenceId, facetAssessments: item.facetAssessments })),
        signals: landscapeSignals.crossCorpusFacets,
      })
      const openCallSummaries: OpenCallSummary[] = fundingCalls.map((call) => ({
        id: call.id,
        agencyName: call.agencyName,
        schemeTitle: call.schemeTitle,
        closeDate: call.closeDate ? String(call.closeDate) : null,
        isRolling: Boolean(call.isRolling),
      }))
      // Funder ranking stays on the sanctioned record. When calls were not searched
      // the evidence basis has to say so rather than imply nothing matched.
      const agencyRecommendations = rankAgencyRecommendations(fundedPortfolio, openCallSummaries, 4, {
        openCallsSearched: searchCallsInReview,
      })

      const scores = {
        ...landscapeSignals,
        callAlignments: calculateCallAlignments(analysis.callItems),
        fundedPortfolio,
        facetCoverage,
        agencyRecommendations,
        priorWork,
      }
      await prisma.ideaIntelligenceRun.update({
        where: { id: runId }, data: { analysisJson: analysis as any, scoresJson: scores as any, currentStage: 4 },
      })
      if (existing.version?.parentVersionId && existing.versionId) {
        const parentRun = await prisma.ideaIntelligenceRun.findFirst({
          where: { versionId: existing.version.parentVersionId, status: 'COMPLETED' },
          select: { scoresJson: true },
          orderBy: [{ completedAt: 'desc' }, { updatedAt: 'desc' }],
        })
        if (parentRun?.scoresJson) {
          await prisma.ideaIntelligenceVersion.update({
            where: { id: existing.versionId },
            data: { scoreDeltaJson: buildScoreDelta(scores, parentRun.scoresJson) as Prisma.InputJsonValue },
          })
        }
      }

      // Stage 5: the whitespace read. What the sanctioned corpus already covers,
      // the few directions it leaves open, and which funder pays for that work.
      await prisma.ideaIntelligenceRun.update({ where: { id: runId }, data: { currentStage: 5 } })
      const whitespaceEvidenceIds = new Set<string>([
        ...projects.map((project) => project.id),
        ...evidenceSearch.publications.map((item) => item.id),
        ...evidenceSearch.patents.map((item) => item.id),
        ...evidenceSearch.webResults.map((item) => item.id),
        ...fundingCalls.map((call) => call.id),
      ])
      const projectIdSet = new Set(projects.map((project) => project.id))
      const knownAgencies = fundedPortfolio.agencies.map((agency) => agency.agencyName)
      const portfolioForPrompt = {
        projectsRetrieved: fundedPortfolio.projectCount,
        completed: fundedPortfolio.completedCount,
        stillRunning: fundedPortfolio.ongoingCount,
        yearsCovered: fundedPortfolio.firstYear && fundedPortfolio.lastYear ? `${fundedPortfolio.firstYear}-${fundedPortfolio.lastYear}` : null,
        typicalAward: formatBudget(fundedPortfolio.medianBudget, fundedPortfolio.budgetCurrency),
        funders: fundedPortfolio.agencies.slice(0, 6).map((agency) => ({
          agencyName: agency.agencyName,
          projectCount: agency.projectCount,
          stillRunning: agency.ongoingCount,
          schemes: agency.schemes,
          years: agency.firstYear && agency.lastYear ? `${agency.firstYear}-${agency.lastYear}` : null,
          typicalAward: formatBudget(agency.medianBudget, agency.budgetCurrency),
          exampleProjectIds: agency.exampleProjectIds,
        })),
      }

      let report: Record<string, unknown>
      let rawReport: Record<string, any> = {}
      try {
        const reportResponse = await runFundingGatewayText({
          taskCode: IDEA_INTELLIGENCE_TASK_CODE,
          stageCode: IDEA_INTELLIGENCE_REPORT_STAGE_CODE,
          context: { tenantId: actor.tenantId, userId: actor.userId },
          responseMimeType: 'application/json',
          temperature: 0.25,
          maxTokensOut: 4200,
          metadata: { purpose: 'idea_intelligence_whitespace_report', runId },
          prompt: `You are advising a researcher on where the genuinely open research space is, judged against work that has ALREADY BEEN SANCTIONED by funding agencies. Write plainly, for a busy researcher, not for a committee.

THE RESEARCHER'S IDEA: ${JSON.stringify(structured)}

WHAT HAS ALREADY BEEN SANCTIONED (deterministic ledger — reuse these numbers, never invent your own):
${JSON.stringify(portfolioForPrompt)}

SANCTIONED PROJECT DETAIL:
${JSON.stringify(comparisonProjects.map((project) => ({
  ...project,
  abstract: project.abstract ? project.abstract.slice(0, 600) : null,
  summary: project.summary ? project.summary.slice(0, 400) : null,
})))}

FACET COVERAGE FROM THE SANCTIONED CORPUS (already funded vs still open):
${JSON.stringify(facetCoverage)}

FACET-BY-FACET CROSS-CORPUS SIGNAL:
${JSON.stringify(landscapeSignals.crossCorpusFacets)}

WHY EACH OPEN ASPECT IS OPEN (already decided deterministically — do not re-explain, contradict, or re-derive):
${JSON.stringify(priorWork.gaps.map((gap) => ({
  facet: gap.facet,
  reading: gap.reading,
  basis: gap.readingBasis,
  typicalAward: formatBudget(gap.effort?.medianBudget ?? null, gap.effort?.budgetCurrency ?? null),
  typicalDurationMonths: gap.effort?.medianDurationMonths ?? null,
  latestNeighbouringAward: gap.latestActivityYear,
  looksStale: gap.stale,
})))}

${promptSections([
  ['PUBLICATION EVIDENCE', evidenceSearch.publications.slice(0, 8)],
  ['PATENT EVIDENCE', evidenceSearch.patents.slice(0, 8)],
  ['WEB EVIDENCE', evidenceSearch.webResults.slice(0, 6)],
  ['CURRENTLY OPEN CALLS (secondary — routing only, not the point of this report)', fundingCalls.slice(0, 6)],
])}

RANKED FUNDERS (ranking and numbers are already decided — you only supply the one-line reason):
${JSON.stringify(agencyRecommendations.map((item) => ({ agencyName: item.agencyName, fundedNearbyCount: item.fundedNearbyCount, activeYears: item.activeYears, schemes: item.schemes })))}

Return JSON only:
{"headline":"2 sentences a researcher can act on: what the sanctioned corpus already covers, and where the opening is","alreadyDoneSummary":"one short paragraph on what agencies have already funded in this space, using the ledger numbers","fundedThemes":[{"theme":"a theme agencies have already funded, in plain words","projectCount":0,"agencies":["agency names from the ledger"],"exampleProjectIds":["exact sanctioned project ids"]}],"whitespaceDirections":[{"title":"a specific, pursuable direction in plain words (<=12 words)","stillMissing":"exactly what nobody has been funded to do yet (<=30 words)","example":{"projectIdea":"a concrete worked example — name the setting, the population or system (<=35 words)","whatYouWouldBuild":"the deliverable or artefact (<=20 words)","firstProof":"the first result that would show it works, achievable in 6-12 months (<=25 words)"},"relatedFacets":["exact facets from the coverage lists"],"evidence":[{"sourceType":"${['funded_project', evidenceSearch.publications.length > 0 && 'publication', evidenceSearch.patents.length > 0 && 'patent', evidenceSearch.webResults.length > 0 && 'web', fundingCalls.length > 0 && 'call'].filter(Boolean).join('|')}","evidenceId":"exact id from supplied data","quote":"short verbatim quote from supplied text, or null"}],"confidence":"${externalEvidenceEnabled ? 'strong|moderate|thin' : 'moderate|thin'}","bestFitAgency":"exact agency name from the ledger, or null"}],"agencyNarratives":[{"agencyName":"exact agency name from RANKED FUNDERS","whyThisAgency":"one sentence tying this funder's own sanctioned record to the idea and the open direction"}],"nextSteps":["at most 3 concrete actions"],"evidenceDisclaimer":"one sentence on what this analysis can and cannot tell them"}

Rules:
${promptLines([
  `- Return AT MOST ${MAX_WHITESPACE_DIRECTIONS} whitespace directions. Fewer is better than padding. Each must be materially different from the others.`,
  '- Whitespace means: the sanctioned corpus shows this has NOT been funded. Absence of evidence is not evidence of absence — if the corpus is thin, say so and mark confidence "thin".',
  !externalEvidenceEnabled && '- Only the sanctioned-project corpus was searched. No literature, patent, or web check was run, so confidence can never be "strong" and the disclaimer must say the read is based on sanctioned awards alone.',
  !fundingCalls.length && '- No funding call was searched. Do not name, imply, or invent a specific call, scheme deadline, or application route.',
  '- Every direction must include a concrete worked example. Vague directions like "explore AI applications" are useless; name the setting, the users, and the artefact.',
  priorWork.gaps.length > 0 && '- Prefer directions that map onto an aspect listed in WHY EACH OPEN ASPECT IS OPEN, and put that exact facet in relatedFacets. Its reading and basis are already written — do not restate them in your own words.',
  priorWork.gaps.some((gap) => gap.reading === 'blocked') && '- Where the reading is "blocked", the direction must be a way around the patent, not a restatement of the blocked aspect.',
  '- Reuse the ledger\'s counts, years, and award sizes verbatim. Never state a count you were not given.',
  '- Never predict funding success, never claim novelty, never claim something is "first of its kind".',
  '- exampleProjectIds and evidenceIds must be exact ids from the supplied data.',
  '- Obey every stated word limit. Every sentence must carry a number, a name, a date or a quote; drop any sentence that carries none.',
])}`,
        })
        rawReport = reportResponse ? extractJsonObject(reportResponse.rawText) as Record<string, any> : {}
      } catch {
        rawReport = {}
      }

      const whitespaceDirections = normalizeWhitespaceDirections(
        rawReport.whitespaceDirections,
        whitespaceEvidenceIds,
        [...facetCoverage.open, ...facetCoverage.partial, ...facetCoverage.covered, ...facetCoverage.unknown],
        knownAgencies
      ).map((direction) => (
        // Without a literature or patent check, buildFacetCoverage can no longer
        // downgrade an unfunded facet to "partial", so more facets read as open.
        // "Strong" would be overclaiming on a single corpus.
        externalEvidenceEnabled || direction.confidence !== 'strong'
          ? direction
          : { ...direction, confidence: 'moderate' as const }
      ))
      const directionsWithGaps = withGapFacts(
        whitespaceDirections,
        priorWork.gaps,
        agencyRecommendations[0]?.agencyName || null
      )
      const fundedThemes = normalizeFundedThemes(rawReport.fundedThemes, projectIdSet)
      const headline = normalizeText(rawReport.headline, 700)
        || `${fundedPortfolio.projectCount} comparable sanctioned project${fundedPortfolio.projectCount === 1 ? '' : 's'} were retrieved for this idea. Review the facet coverage below before claiming any part of it is unaddressed.`

      report = {
        headline,
        // Kept as an alias so the Grant Prep handoff briefing keeps working.
        executiveVerdict: headline,
        alreadyDoneSummary: normalizeText(rawReport.alreadyDoneSummary, 1200),
        fundedThemes,
        whitespaceDirections: directionsWithGaps.length
          ? directionsWithGaps
          : buildFallbackDirections(facetCoverage, fundedPortfolio, projects),
        agencyRecommendations: applyAgencyNarratives(agencyRecommendations, rawReport.agencyNarratives),
        nextSteps: (Array.isArray(rawReport.nextSteps) ? rawReport.nextSteps : [])
          .map((item: unknown) => normalizeText(item, 300)).filter(Boolean).slice(0, 3),
        evidenceDisclaimer: [
          normalizeText(rawReport.evidenceDisclaimer, 400)
            || 'This describes what the retrieved sanctioned-project records show and do not show. It is not a prediction of funding success.',
          externalEvidenceEnabled
            ? null
            : 'Only the sanctioned-project corpus was searched for this read — no literature, patent, or web check was run.',
        ].filter(Boolean).join(' '),
        callFit: normalizeCallFit(rawReport.callFit, callRoles),
      }

      // Call-specific gap analysis + reviewer simulation runs ONLY when the user
      // deliberately anchored a call. Without an anchor the module stays on the
      // whitespace question instead of grading the idea against a call nobody chose.
      const targetCallId = anchoredCall?.id || null
      const gapResult = targetCallId
        ? await runCallGapAnalysis({
            runId,
            actor,
            targetCallId,
            structured,
            targetComparison: comparisonCalls.find((call) => call.fundingCallId === targetCallId) || null,
            targetItems: analysis.callItems.find((item) => item.fundingCallId === targetCallId) || null,
            overlap: { strongestOverlap: analysis.strongestOverlap, whiteSpace: analysis.whiteSpace, cautions: analysis.cautions },
            comparisonProjects,
            validEvidenceIds: new Set<string>([
              targetCallId,
              ...projects.map((project) => project.id),
              ...evidenceSearch.publications.map((item) => item.id),
              ...evidenceSearch.patents.map((item) => item.id),
              ...evidenceSearch.webResults.map((item) => item.id),
            ]),
          })
        : { callGaps: [] as IdeaCallGap[], reviewerPanel: [] as IdeaReviewerPersona[] }
      report.callGaps = gapResult.callGaps
      report.reviewerPanel = gapResult.reviewerPanel
      report.targetFundingCallId = targetCallId

      await prisma.ideaIntelligenceRun.update({
        where: { id: runId },
        data: {
          status: 'COMPLETED', currentStage: 6, reportJson: report as any,
          errorMessage: null, completedAt: new Date(),
        },
      })
      const completed = await prisma.ideaIntelligenceRun.findUniqueOrThrow({
        where: { id: runId },
        include: {
          version: true,
          session: { include: { versions: { include: { runs: true }, orderBy: { versionNumber: 'asc' } } } },
          refinementCandidates: { orderBy: { candidateIndex: 'asc' } },
        },
      })
      return publicRun(completed)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Idea analysis failed'
      await prisma.ideaIntelligenceRun.update({
        where: { id: runId }, data: { status: 'FAILED', errorMessage: message },
      })
      throw error
    }
  }
}

export const ideaIntelligenceService = new IdeaIntelligenceService()
