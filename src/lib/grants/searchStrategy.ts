import type { SearchQueryCategory } from '@prisma/client'

import {
  extractGrantDimensionTargets,
  isGrantBackedPaperTypeCode,
} from '@/lib/grants/blueprintMetadata'
import {
  getGrantPersuasionSearchTerms,
  getGrantPersuasionYearWindow,
  inferGrantPersuasionRole,
  type GrantPersuasionRole,
} from '@/lib/grants/persuasionRoles'
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
    grantSemantic?: string | null
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
  bundle: Array<GrantBlueprintDimensionTarget & { persuasionRole: GrantPersuasionRole }>,
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
    bundle.flatMap((target) => tokenize(target.dimension).slice(0, target.persuasionRole === 'proves_need' ? 4 : 3))
  ).slice(0, 6)

  const persuasionTerms = dedupeStrings(
    bundle.flatMap((target) => getGrantPersuasionSearchTerms(target.persuasionRole))
  ).slice(0, 5)

  return dedupeStrings([...researchTerms, ...dimensionTerms, ...persuasionTerms]).slice(0, 11)
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

function dominantRole(
  bundle: Array<GrantBlueprintDimensionTarget & { persuasionRole: GrantPersuasionRole }>
): GrantPersuasionRole {
  const counts = bundle.reduce<Record<string, number>>((acc, item) => {
    acc[item.persuasionRole] = (acc[item.persuasionRole] || 0) + 1
    return acc
  }, {})

  return (
    Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0]
    || 'supports_feasibility'
  ) as GrantPersuasionRole
}

function dominantIntent(bundle: Array<GrantBlueprintDimensionTarget & { persuasionRole: GrantPersuasionRole }>): string {
  switch (dominantRole(bundle)) {
    case 'proves_need':
      return 'burden_statistics'
    case 'shows_gap':
      return 'limitations_gaps'
    case 'validates_approach':
      return 'method_validation'
    case 'supports_feasibility':
      return 'implementation_feasibility'
    case 'quantifies_impact':
      return 'outcome_metrics'
    case 'establishes_precedent':
      return 'comparison_baseline'
    case 'policy_alignment':
      return 'policy_alignment'
    default:
      return 'topic_coverage'
  }
}

function yearWindow(bundle: Array<GrantBlueprintDimensionTarget & { persuasionRole: GrantPersuasionRole }>) {
  return getGrantPersuasionYearWindow(dominantRole(bundle))
}

function describeBundle(bundle: Array<GrantBlueprintDimensionTarget & { persuasionRole: GrantPersuasionRole }>): string {
  const sectionKeys = dedupeStrings(bundle.map((item) => item.sectionKey)).slice(0, 3)
  const dimensions = bundle.map((item) => item.dimension).slice(0, 2)
  const roles = dedupeStrings(bundle.map((item) => dominantIntent([item]))).slice(0, 2)
  return `Targets ${sectionKeys.join(', ')} through ${roles.join(' and ')} evidence on ${dimensions.join(' and ')}.`
}

function bundleDimensions<T extends GrantBlueprintDimensionTarget>(targets: T[]): T[][] {
  if (targets.length === 0) return []
  const targetQueryCount = clamp(Math.ceil(targets.length / 4.5), 4, 12)
  const bundleSize = clamp(Math.ceil(targets.length / targetQueryCount), 3, 6)
  const bundles: T[][] = []

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

  const sectionSemanticByKey = new Map(
    (input.blueprint.sectionPlan || []).map((section) => [section.sectionKey, section.grantSemantic || null] as const)
  )
  const targets = extractGrantDimensionTargets(input.blueprint.sectionPlan || [])
    .map((target) => ({
      ...target,
      persuasionRole: inferGrantPersuasionRole({
        dimension: target.dimension,
        dimensionType: target.dimensionType,
        semantic: (sectionSemanticByKey.get(target.sectionKey) || null) as any,
      }),
    }))
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
