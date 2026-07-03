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
import { retrieveIdeaEvidence } from '@/lib/ideaIntelligence/evidenceSources'
import type { PatentEvidence, PublicationEvidence, WebEvidence } from '@/lib/ideaIntelligence/evidenceSources'
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

function statusValue(status: FacetStatus) {
  return status === 'PRESENT' ? 1 : status === 'PARTIAL' ? 0.5 : status === 'ABSENT' ? 0 : null
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
  async createRun(input: { ideaText: string; title?: string; anchorPublicProjectId?: string }, actor: ActorContext) {
    const ideaText = normalizeText(input.ideaText, 12000)
    if (ideaText.length < 50) throw new Error('Describe the idea in at least 50 characters.')
    const title = normalizeText(input.title, 140) || ideaText.split(/[.!?]/)[0].slice(0, 120)
    const run = await prisma.$transaction(async (tx) => {
      const session = await tx.ideaIntelligenceSession.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          anchorPublicProjectId: input.anchorPublicProjectId || null,
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

  async generateRefinementCandidates(runId: string, input: { objective?: string; instructions?: string }, actor: ActorContext) {
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

    const objective = (normalizeText(input.objective, 80) || 'maximize_white_space') as RefinementObjective
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
- Treat absence of corpus evidence as a signal to verify, not proof of novelty.`,
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
            payloadJson: candidate.payload as Prisma.InputJsonValue,
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

      // Stage 1: retrieve real awards and live calls in parallel.
      const projectSearchPromise = (async () => {
        const primary = await publicProjectSearchService.search({
          query: structured.semanticQuery,
          limit: 15,
          tenantId: actor.tenantId,
          userId: actor.userId,
        })
        if (primary.results.length > 0) return primary

        const fallbackQuery = [structured.domain, ...structured.keywords.slice(0, 8)].filter(Boolean).join(' ')
        if (!fallbackQuery || fallbackQuery.toLowerCase() === structured.semanticQuery.toLowerCase()) return primary
        return publicProjectSearchService.search({
          query: fallbackQuery,
          limit: 15,
          tenantId: actor.tenantId,
          userId: actor.userId,
        })
      })()

      const [projectSearch, fundingSearch, evidenceSearch] = await Promise.all([
        projectSearchPromise,
        recommendationSearchService.search({
          inputMode: 'research_area',
          query: { researchArea: structured.semanticQuery },
          filters: { includeExpired: false, limit: 6 },
          access: actor.access,
          llmContext: { tenantId: actor.tenantId, userId: actor.userId },
        }),
        retrieveIdeaEvidence(structured.semanticQuery, { publicationLimit: 10, patentLimit: 10, webLimit: 8 }),
      ])
      const projects = projectSearch.results
      const fundingCalls = fundingSearch.rawResults.map((call) => ({
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
      const retrieval = {
        projects,
        fundingCalls,
        publications: evidenceSearch.publications,
        patents: evidenceSearch.patents,
        webResults: evidenceSearch.webResults,
        evidenceDiagnostics: evidenceSearch.diagnostics,
        degradedMode: projectSearch.degradedMode,
        query: structured.semanticQuery,
      }
      await prisma.ideaIntelligenceRun.update({
        where: { id: runId }, data: { retrievalResultsJson: retrieval as any, currentStage: 2 },
      })

      // Stage 2/3: compare only grounded source text. Missing evidence stays unassessed.
      await prisma.ideaIntelligenceRun.update({ where: { id: runId }, data: { currentStage: 3 } })
      const comparisonProjects = projects.slice(0, 8).map((project) => ({
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
      const comparisonResponse = await runFundingGatewayText({
        taskCode: IDEA_INTELLIGENCE_TASK_CODE,
        stageCode: IDEA_INTELLIGENCE_EVIDENCE_MAP_STAGE_CODE,
        context: { tenantId: actor.tenantId, userId: actor.userId },
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxTokensOut: 6500,
        metadata: { purpose: 'idea_intelligence_overlap', runId },
        prompt: `Compare an idea with funded-project, publication, patent, and web evidence.

IDEA FACETS:
${JSON.stringify(structured.facets)}

FUNDED PROJECTS:
${JSON.stringify(comparisonProjects)}

PUBLICATIONS:
${JSON.stringify(comparisonPublications)}

PATENTS:
${JSON.stringify(comparisonPatents)}

WEB RESULTS:
${JSON.stringify(comparisonWebResults)}

Return JSON only:
{"items":[{"projectId":"exact id","summary":"what this project actually addresses","facetAssessments":[{"facet":"exact idea facet","status":"PRESENT|PARTIAL|ABSENT|UNASSESSED","evidence":"short exact or faithful evidence from supplied text","reason":"brief comparison"}]}],"publicationItems":[{"evidenceId":"exact id","title":"source title","summary":"what this publication addresses","facetAssessments":[{"facet":"exact idea facet","status":"PRESENT|PARTIAL|ABSENT|UNASSESSED","evidence":"short faithful evidence","reason":"brief comparison"}]}],"patentItems":[{"evidenceId":"exact id","title":"source title","summary":"what this patent addresses","facetAssessments":[{"facet":"exact idea facet","status":"PRESENT|PARTIAL|ABSENT|UNASSESSED","evidence":"short faithful evidence","reason":"brief comparison"}]}],"webItems":[{"evidenceId":"exact id","title":"source title","summary":"what this web source says","facetAssessments":[{"facet":"exact idea facet","status":"PRESENT|PARTIAL|ABSENT|UNASSESSED","evidence":"short faithful evidence","reason":"brief comparison"}]}],"strongestOverlap":["..."],"whiteSpace":["..."],"cautions":["..."]}

Rules:
- Never infer capabilities not supported by supplied text.
- Use UNASSESSED when the abstract/summary does not contain enough evidence.
- ABSENT means the supplied evidence actively supports absence; missing text is UNASSESSED.
- Treat web snippets as weak supporting evidence only.
- Do not call anything novel or fundable.`,
      })
      const analysis = normalizeCrossCorpusAnalysis(
        comparisonResponse ? extractJsonObject(comparisonResponse.rawText) : {},
        projects,
        evidenceSearch,
        structured.facets
      )
      const scores = calculateLandscapeSignals(projects, analysis, evidenceSearch)
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

      // Stage 4/5/6: synthesize a positioning brief, keeping the descriptive-score limitation explicit.
      await prisma.ideaIntelligenceRun.update({ where: { id: runId }, data: { currentStage: 5 } })
      let report: Record<string, unknown>
      try {
        const reportResponse = await runFundingGatewayText({
          taskCode: IDEA_INTELLIGENCE_TASK_CODE,
          stageCode: IDEA_INTELLIGENCE_REPORT_STAGE_CODE,
          context: { tenantId: actor.tenantId, userId: actor.userId },
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxTokensOut: 3500,
          metadata: { purpose: 'idea_intelligence_report', runId },
          prompt: `Write a concise, decision-useful funding landscape positioning brief from the supplied evidence.

STRUCTURED IDEA: ${JSON.stringify(structured)}
LANDSCAPE SIGNALS: ${JSON.stringify(scores)}
OVERLAP ANALYSIS: ${JSON.stringify(analysis)}
MATCHING OPEN CALLS: ${JSON.stringify(fundingCalls)}
PUBLICATION EVIDENCE: ${JSON.stringify(evidenceSearch.publications.slice(0, 8))}
PATENT EVIDENCE: ${JSON.stringify(evidenceSearch.patents.slice(0, 8))}
WEB EVIDENCE: ${JSON.stringify(evidenceSearch.webResults.slice(0, 6))}

Return JSON only:
{"executiveVerdict":"2-3 sentences","landscapeSummary":"short evidence-grounded paragraph","differentiators":["up to 5"],"risks":["up to 5"],"positioningRecommendations":["up to 5 concrete changes"],"funderRationale":[{"fundingCallId":"exact id","rationale":"why it matches and what to verify"}],"nextSteps":["up to 5"],"evidenceDisclaimer":"..."}

Never predict funding success. Do not claim novelty. Distinguish absence of evidence from evidence of absence. Mention when the corpus or abstract coverage is limited.`,
        })
        report = reportResponse ? extractJsonObject(reportResponse.rawText) as Record<string, unknown> : {}
      } catch {
        report = {
          executiveVerdict: 'The available corpus provides an initial positioning view, but the evidence is not sufficient to predict funding success.',
          landscapeSummary: `${projects.length} related funded projects, ${evidenceSearch.publications.length} publications, ${evidenceSearch.patents.length} patent records, ${evidenceSearch.webResults.length} web sources, and ${fundingCalls.length} currently relevant calls were retrieved. Review the evidence matrix before using any differentiation claim.`,
          differentiators: analysis.whiteSpace,
          risks: analysis.cautions,
          positioningRecommendations: analysis.whiteSpace.map((item: string) => `Explain and validate this potential distinction: ${item}`),
          funderRationale: [],
          nextSteps: ['Validate the strongest differentiation claim with publications and subject-matter experts.', "Check every shortlisted call's current eligibility and deadline."],
          evidenceDisclaimer: 'This is a descriptive landscape analysis based on available records, not a prediction of funding success.',
        }
      }

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
