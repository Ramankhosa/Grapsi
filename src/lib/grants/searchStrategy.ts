import type { SearchQueryCategory } from '@prisma/client'

import {
  extractGrantDimensionTargets,
  isGrantBackedPaperTypeCode,
} from '@/lib/grants/blueprintMetadata'
import type { GrantBlueprintDimensionTarget } from '@/types/grant'

type ResearchTopicLike = {
  title?: string | null
  researchQuestion?: string | null
  keywords?: string[] | null
}

type BlueprintLike = {
  paperTypeCode?: string | null
  sectionPlan?: Array<{
    sectionKey: string
    mustCover?: string[] | null
    mustCoverTyping?: Record<string, unknown> | null
    suggestedCitationCount?: number | null
    thematicBlueprint?: unknown
  }> | null
}

export interface GrantBackedGeneratedQuery {
  queryText: string
  category: SearchQueryCategory
  description: string
  priority: number
  suggestedSources: string[]
  suggestedYearFrom?: number
  suggestedYearTo?: number
  searchIntent: string
  dimensionTargets: GrantBlueprintDimensionTarget[]
}

const STOP_WORDS = new Set([
  'and', 'the', 'for', 'with', 'that', 'this', 'into', 'from', 'across', 'through',
  'proposal', 'proposed', 'program', 'project', 'evidence', 'expected', 'measurable',
  'relevance', 'alignment', 'strategy', 'model', 'pathway', 'pathways', 'delivery',
  'supporting', 'supports', 'within', 'under', 'beyond', 'between', 'using', 'based',
])

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const item of items) {
    const normalized = item.trim().toLowerCase()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    output.push(item.trim())
  }
  return output
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && token.length > 2 && !STOP_WORDS.has(token))
}

function deriveQueryTerms(
  bundle: GrantBlueprintDimensionTarget[],
  researchTopic: ResearchTopicLike
): string[] {
  const researchTerms = dedupeStrings(
    [
      ...(researchTopic.keywords || []),
      ...tokenize(researchTopic.title || '').slice(0, 3),
      ...tokenize(researchTopic.researchQuestion || '').slice(0, 3),
    ]
  ).slice(0, 3)

  const dimensionTerms = dedupeStrings(
    bundle.flatMap((target) => tokenize(target.dimension).slice(0, 3))
  ).slice(0, 5)

  return dedupeStrings([...researchTerms, ...dimensionTerms]).slice(0, 7)
}

function dominantCategory(bundle: GrantBlueprintDimensionTarget[]): SearchQueryCategory {
  const counts = bundle.reduce<Record<string, number>>((acc, item) => {
    const key = item.dimensionType || 'empirical'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const dominant = Object.entries(counts).sort((left, right) => right[1] - left[1])[0]?.[0] || 'empirical'

  switch (dominant) {
    case 'foundational':
      return 'THEORETICAL_FOUNDATION'
    case 'methodological':
      return 'METHODOLOGY'
    case 'comparative':
      return 'COMPETING_APPROACHES'
    case 'gap':
      return 'GAP_IDENTIFICATION'
    default:
      return 'CORE_CONCEPTS'
  }
}

function dominantIntent(bundle: GrantBlueprintDimensionTarget[]): string {
  const category = dominantCategory(bundle)
  switch (category) {
    case 'THEORETICAL_FOUNDATION':
      return 'historical_foundational'
    case 'METHODOLOGY':
      return 'methodological'
    case 'COMPETING_APPROACHES':
      return 'comparison_baseline'
    case 'GAP_IDENTIFICATION':
      return 'limitations_gaps'
    default:
      return 'topic_coverage'
  }
}

function yearWindow(bundle: GrantBlueprintDimensionTarget[]) {
  const dominantIntent = bundle.some((item) => item.dimensionType === 'foundational')
    ? 'foundational'
    : bundle.some((item) => item.dimensionType === 'gap' || item.dimensionType === 'comparative')
      ? 'recent'
      : bundle.some((item) => item.dimensionType === 'methodological')
        ? 'methods'
        : 'default'

  const currentYear = new Date().getUTCFullYear()

  switch (dominantIntent) {
    case 'foundational':
      return {}
    case 'recent':
      return { suggestedYearFrom: currentYear - 6, suggestedYearTo: currentYear }
    case 'methods':
      return { suggestedYearFrom: currentYear - 8, suggestedYearTo: currentYear }
    default:
      return { suggestedYearFrom: currentYear - 10, suggestedYearTo: currentYear }
  }
}

function describeBundle(bundle: GrantBlueprintDimensionTarget[]): string {
  const sectionKeys = dedupeStrings(bundle.map((item) => item.sectionKey)).slice(0, 3)
  const dimensions = bundle.map((item) => item.dimension).slice(0, 2)
  return `Targets ${sectionKeys.join(', ')} through evidence on ${dimensions.join(' and ')}.`
}

function bundleDimensions(targets: GrantBlueprintDimensionTarget[]): GrantBlueprintDimensionTarget[][] {
  if (targets.length === 0) return []
  const targetQueryCount = clamp(Math.ceil(targets.length / 4.5), 4, 12)
  const bundleSize = clamp(Math.ceil(targets.length / targetQueryCount), 3, 6)
  const bundles: GrantBlueprintDimensionTarget[][] = []

  for (let index = 0; index < targets.length; index += bundleSize) {
    bundles.push(targets.slice(index, index + bundleSize))
  }

  return bundles
}

export function buildGrantBackedSearchStrategy(input: {
  researchTopic: ResearchTopicLike
  blueprint: BlueprintLike
}): { summary: string; estimatedPapers: number; queries: GrantBackedGeneratedQuery[] } | null {
  if (!isGrantBackedPaperTypeCode(input.blueprint.paperTypeCode)) {
    return null
  }

  const targets = extractGrantDimensionTargets(input.blueprint.sectionPlan || [])
  if (targets.length === 0) {
    return null
  }

  const bundles = bundleDimensions(targets)
  const queries = bundles.map((bundle, index) => {
    const queryTerms = deriveQueryTerms(bundle, input.researchTopic)
    const category = dominantCategory(bundle)
    return {
      queryText: queryTerms.join(' '),
      category,
      description: describeBundle(bundle),
      priority: index + 1,
      suggestedSources: ['semantic_scholar', 'openalex', 'crossref'],
      searchIntent: dominantIntent(bundle),
      dimensionTargets: bundle,
      ...yearWindow(bundle),
    } satisfies GrantBackedGeneratedQuery
  })

  return {
    summary: `Grant-aware literature strategy covering ${targets.length} blueprint dimensions across ${queries.length} bundled searches.`,
    estimatedPapers: Math.max(queries.length * 12, targets.length * 2),
    queries,
  }
}
