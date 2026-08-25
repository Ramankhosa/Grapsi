// Research & Patent Landscape for the reviewer's final report.
//
// Builds a reference-only listing of similar already-funded projects (local
// sanctioned-project corpus) and similar Indian patents (PatentNest only — by
// deliberate decision no SerpAPI / Google Patents lookup happens here), each
// tagged with which facets of the proposal it touches.
//
// Design rules, in order:
// - Never blocks or fails the final report: buildReviewerLandscape never
//   throws; every failure degrades to a persisted status the UI can explain.
// - Never influences the score: nothing produced here is passed to the panel
//   model. The report generator merges the result after the panel call.
// - The LLM only names facets and tags items; every list, count and status is
//   computed deterministically (landscapeCore.ts + buildPriorWork).

import { extractJsonObject } from '@/lib/recommendations/conversationUtils'
import {
  retrievePatentnestPatents,
  type PatentEvidence,
  type PatentnestSearchOutcome,
} from '@/lib/ideaIntelligence/evidenceSources'
import { loadProjectRecords } from '@/lib/ideaIntelligence/projectRecords'
import { buildPriorWork, type PriorWorkAwardInput } from '@/lib/ideaIntelligence/priorWork'
import { publicProjectSearchService, type PublicProjectSearchItem } from '@/lib/publicProjects/searchService'
import { extractMeaningfulText } from '@/lib/reviewer/content'
import {
  assembleLandscape,
  buildFallbackDistillation,
  deriveFacetSignals,
  normalizeDistillation,
  normalizeFacetMap,
  type LandscapeDistillation,
  type ReviewerLandscape,
} from '@/lib/reviewer/landscapeCore'
import { resolveReviewerCallOwner } from '@/lib/reviewer/usage'

export const REVIEWER_LANDSCAPE_PROJECT_RETRIEVAL_LIMIT = 20
export const REVIEWER_LANDSCAPE_PROJECT_COMPARISON_LIMIT = 12
export const REVIEWER_LANDSCAPE_PATENT_LIMIT = 10
// Soft budget for the whole step. The panel model usually takes 30–60s, so the
// landscape running alongside it inside this budget adds no wall-clock time.
export const REVIEWER_LANDSCAPE_BUDGET_MS = 75_000

const LANDSCAPE_DISTILL_STAGE_CODE = 'GRANT_REVIEWER_LANDSCAPE_DISTILL'
const LANDSCAPE_FACET_MAP_STAGE_CODE = 'GRANT_REVIEWER_LANDSCAPE_FACET_MAP'

const SECTION_DIGEST_CHARS = 1200
const TOTAL_DIGEST_CHARS = 12_000
const AWARD_ABSTRACT_CHARS = 1500
const PATENT_ABSTRACT_CHARS = 1200

export function reviewerLandscapeEnabled(): boolean {
  // enabled-unless-disabled: the landscape ships on by default and
  // REVIEWER_LANDSCAPE_ENABLED=false is the kill switch.
  return String(process.env.REVIEWER_LANDSCAPE_ENABLED || '').toLowerCase() !== 'false'
}

export interface ReviewerLandscapeInput {
  callId: string
  projectTitle: string
  /** ReviewerCallContext (parsed_json) — read defensively, it varies by era. */
  parsedContext: Record<string, any> | null
  /** The call's chosen provider family, so fallbacks respect the user's pick. */
  modelType: 'O' | 'G'
  sections: Array<{ title: string; contextSummary: string | null; userInput: string }>
}

// The aux LLM ladder lives in auxLlm.ts; re-exported here so novelty.ts and
// older imports keep working.
export { runReviewerAuxiliaryText, type OwnerContext } from '@/lib/reviewer/auxLlm'
import { runReviewerAuxiliaryText, type OwnerContext } from '@/lib/reviewer/auxLlm'

function normalizeText(value: unknown, maxLength: number) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

export function buildSectionDigests(sections: ReviewerLandscapeInput['sections']) {
  const digests: Array<{ title: string; text: string }> = []
  let total = 0
  for (const section of sections) {
    if (total >= TOTAL_DIGEST_CHARS) break
    const summary = normalizeText(section.contextSummary, SECTION_DIGEST_CHARS)
    const text = summary || normalizeText(extractMeaningfulText(section.userInput), SECTION_DIGEST_CHARS)
    if (!text) continue
    digests.push({ title: normalizeText(section.title, 160) || 'Untitled section', text })
    total += text.length
  }
  return digests
}

async function distillProposal(input: {
  projectTitle: string
  callDescription: string
  sectionDigests: Array<{ title: string; text: string }>
  owner: OwnerContext
  modelType: 'O' | 'G'
}): Promise<LandscapeDistillation> {
  const fallback = buildFallbackDistillation(input)
  const prompt = `Distill this grant proposal into search facets for a funded-projects and Indian-patents landscape scan.

PROPOSAL TITLE: ${input.projectTitle || 'Untitled proposal'}
${input.callDescription ? `FUNDING CALL CONTEXT: ${normalizeText(input.callDescription, 1500)}\n` : ''}
SECTIONS:
${input.sectionDigests.map((digest) => `${digest.title}: ${digest.text}`).join('\n')}

Return JSON only:
{"facets":["3 to 7 discrete technical aspects of THIS proposal, specific enough to compare against project abstracts"],"keywords":["up to 10 short search keywords"],"semanticQuery":"one dense retrieval query under 60 words"}

Do not judge quality, novelty, or fundability.`

  const rawText = await runReviewerAuxiliaryText({
    stageCode: LANDSCAPE_DISTILL_STAGE_CODE,
    prompt,
    systemPrompt: 'You prepare a grant proposal for prior-work search. Return JSON only.',
    owner: input.owner,
    modelType: input.modelType,
    maxTokensOut: 800,
  })
  if (!rawText) return fallback
  try {
    return normalizeDistillation(extractJsonObject(rawText), fallback)
  } catch {
    return fallback
  }
}

async function mapFacets(input: {
  facets: string[]
  projects: PublicProjectSearchItem[]
  patents: PatentEvidence[]
  owner: OwnerContext
  modelType: 'O' | 'G'
}) {
  const comparisonProjects = input.projects
    .slice(0, REVIEWER_LANDSCAPE_PROJECT_COMPARISON_LIMIT)
    .map((project) => ({
      projectId: project.id,
      title: project.title,
      year: project.sanctionYear,
      funder: project.sourceKey,
      scheme: project.schemeName,
      abstract:
        (project.abstractText && project.abstractText.toUpperCase() !== 'NA'
          ? normalizeText(project.abstractText, AWARD_ABSTRACT_CHARS)
          : null) || normalizeText(project.executiveSummary, PATENT_ABSTRACT_CHARS) || null,
    }))
  const comparisonPatents = input.patents.map((patent) => ({
    evidenceId: patent.id,
    title: patent.title,
    publicationNumber: patent.publicationNumber,
    assignee: patent.assignee,
    date: patent.publicationDate || patent.filingDate || patent.priorityDate,
    abstract: patent.abstract ? normalizeText(patent.abstract, PATENT_ABSTRACT_CHARS) : null,
  }))
  const empty = { awardAssessments: [], patentAssessments: [], assessed: false }
  if (!comparisonProjects.length && !comparisonPatents.length) return empty

  const prompt = `Tag each retrieved record with which facets of the proposal it touches. Only the sections below were searched.

PROPOSAL FACETS:
${JSON.stringify(input.facets)}

FUNDED PROJECTS:
${JSON.stringify(comparisonProjects)}

INDIAN PATENTS:
${JSON.stringify(comparisonPatents)}

Return JSON only:
{"items":[{"projectId":"exact id","facetAssessments":[{"facet":"exact proposal facet","status":"PRESENT|PARTIAL|ABSENT|UNASSESSED"}]}],
 "patentItems":[{"evidenceId":"exact id","facetAssessments":[{"facet":"exact proposal facet","status":"PRESENT|PARTIAL|ABSENT|UNASSESSED"}]}]}

Rules:
- Never infer capabilities not supported by the supplied text.
- Use UNASSESSED when the abstract does not contain enough evidence; ABSENT only when the text actively supports absence.
- Do not call anything novel, blocking, or fundable.`

  const rawText = await runReviewerAuxiliaryText({
    stageCode: LANDSCAPE_FACET_MAP_STAGE_CODE,
    prompt,
    systemPrompt: 'You compare a proposal against retrieved prior-work records. Return JSON only.',
    owner: input.owner,
    modelType: input.modelType,
    maxTokensOut: 4000,
  })
  if (!rawText) return empty
  try {
    return normalizeFacetMap(extractJsonObject(rawText), {
      projectIds: comparisonProjects.map((project) => project.projectId),
      patentIds: comparisonPatents.map((patent) => patent.evidenceId),
      facets: input.facets,
    })
  } catch {
    return empty
  }
}

async function searchProjects(distillation: LandscapeDistillation, owner: OwnerContext) {
  const primary = await publicProjectSearchService.search({
    query: distillation.semanticQuery,
    limit: REVIEWER_LANDSCAPE_PROJECT_RETRIEVAL_LIMIT,
    tenantId: owner.tenantId,
    userId: owner.userId,
  })
  if (primary.results.length > 0 || !distillation.keywords.length) return primary

  const fallbackQuery = distillation.keywords.join(' ')
  if (fallbackQuery.toLowerCase() === distillation.semanticQuery.toLowerCase()) return primary
  return publicProjectSearchService.search({
    query: fallbackQuery,
    limit: REVIEWER_LANDSCAPE_PROJECT_RETRIEVAL_LIMIT,
    tenantId: owner.tenantId,
    userId: owner.userId,
  })
}

function emptyErrorLandscape(distillation: LandscapeDistillation, message: string): ReviewerLandscape {
  return assembleLandscape({
    priorWork: buildPriorWork({
      awards: [], awardExtras: [], patents: [], awardAssessments: [], patentAssessments: [], signals: [],
    }),
    distillation,
    assessmentSource: 'fallback',
    sources: {
      projects: { searched: false, count: 0, degradedMode: null },
      patents: { searched: false, status: 'error', count: 0 },
    },
    now: new Date(),
    error: message,
  })
}

async function buildLandscapeInner(input: ReviewerLandscapeInput): Promise<ReviewerLandscape> {
  const owner = await resolveReviewerCallOwner(input.callId)
  const parsedContext = input.parsedContext && typeof input.parsedContext === 'object' ? input.parsedContext : {}
  const callDescription = normalizeText(
    parsedContext.reviewer_context_text || parsedContext.description || parsedContext.call_summary || '',
    2000
  )
  const sectionDigests = buildSectionDigests(input.sections)

  const distillation = await distillProposal({
    projectTitle: input.projectTitle,
    callDescription,
    sectionDigests,
    owner,
    modelType: input.modelType,
  })

  const [projectSettled, patentSettled] = await Promise.allSettled([
    searchProjects(distillation, owner),
    retrievePatentnestPatents(distillation.semanticQuery, REVIEWER_LANDSCAPE_PATENT_LIMIT),
  ])

  const projectSearch = projectSettled.status === 'fulfilled' ? projectSettled.value : null
  const patentSearch: PatentnestSearchOutcome = patentSettled.status === 'fulfilled'
    ? patentSettled.value
    : { results: [], status: 'error', error: patentSettled.reason instanceof Error ? patentSettled.reason.message : 'PatentNest search failed' }
  const projects = projectSearch?.results ?? []
  const patents = patentSearch.results

  const facetMap = await mapFacets({
    facets: distillation.facets,
    projects,
    patents,
    owner,
    modelType: input.modelType,
  })

  const awardExtras = await loadProjectRecords(projects.map((project) => project.id))
    .then((records) => records.extras)
    .catch(() => [])

  const priorWork = buildPriorWork({
    awards: projects.map((project): PriorWorkAwardInput => ({
      id: project.id,
      title: project.title,
      // Abstracts are capped here to bound the persisted report JSON.
      abstract: project.abstractText && project.abstractText.toUpperCase() !== 'NA'
        ? normalizeText(project.abstractText, AWARD_ABSTRACT_CHARS)
        : null,
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
    awardExtras,
    patents,
    awardAssessments: facetMap.awardAssessments,
    patentAssessments: facetMap.patentAssessments,
    signals: deriveFacetSignals(distillation.facets, facetMap.awardAssessments, facetMap.patentAssessments),
  })

  return assembleLandscape({
    priorWork,
    distillation,
    assessmentSource: facetMap.assessed ? 'llm' : 'fallback',
    sources: {
      projects: {
        searched: projectSettled.status === 'fulfilled',
        count: projects.length,
        degradedMode: projectSearch?.degradedMode ?? null,
        ...(projectSettled.status === 'rejected'
          ? { error: projectSettled.reason instanceof Error ? projectSettled.reason.message : 'Project search failed' }
          : {}),
      },
      patents: {
        searched: patentSearch.status === 'ok',
        status: patentSearch.status,
        count: patents.length,
        ...(patentSearch.error ? { error: normalizeText(patentSearch.error, 300) } : {}),
      },
    },
    now: new Date(),
  })
}

/**
 * Build the landscape for one reviewer call. Returns null only when the kill
 * switch is off; otherwise always resolves with a persistable object — a
 * failure inside becomes `status: 'error'`, never a thrown exception, so the
 * final report can ship regardless of what happened here.
 */
export async function buildReviewerLandscape(input: ReviewerLandscapeInput): Promise<ReviewerLandscape | null> {
  if (!reviewerLandscapeEnabled()) return null

  let budgetTimer: NodeJS.Timeout | undefined
  const budget = new Promise<ReviewerLandscape>((resolve) => {
    budgetTimer = setTimeout(() => {
      resolve(emptyErrorLandscape(
        buildFallbackDistillation({ projectTitle: input.projectTitle, callDescription: '', sectionDigests: [] }),
        `Landscape step exceeded its ${Math.round(REVIEWER_LANDSCAPE_BUDGET_MS / 1000)}s budget`
      ))
    }, REVIEWER_LANDSCAPE_BUDGET_MS)
  })

  try {
    return await Promise.race([buildLandscapeInner(input), budget])
  } catch (error) {
    console.error('[ReviewerLandscape] build failed:', error)
    return emptyErrorLandscape(
      buildFallbackDistillation({ projectTitle: input.projectTitle, callDescription: '', sectionDigests: [] }),
      error instanceof Error ? error.message : 'Landscape build failed'
    )
  } finally {
    if (budgetTimer) clearTimeout(budgetTimer)
  }
}
