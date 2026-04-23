import type {
  GrantBlueprintDimensionType,
  GrantSectionSemantic,
} from '@/types/grant'

export const GRANT_PERSUASION_ROLES = [
  'proves_need',
  'shows_gap',
  'validates_approach',
  'supports_feasibility',
  'quantifies_impact',
  'establishes_precedent',
  'policy_alignment',
] as const

export type GrantPersuasionRole = typeof GRANT_PERSUASION_ROLES[number]
export type GrantEvidenceRole = GrantPersuasionRole

function normalizeText(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

const ROLE_SEARCH_TERMS: Record<GrantPersuasionRole, string[]> = {
  proves_need: ['prevalence', 'incidence', 'burden', 'cost', 'baseline', 'population affected'],
  shows_gap: ['limitation', 'barrier', 'challenge', 'unmet need', 'gap', 'insufficient'],
  validates_approach: ['validation', 'benchmark', 'reliability', 'evaluation', 'method validation'],
  supports_feasibility: ['implementation', 'pilot', 'feasibility', 'deployment', 'adoption'],
  quantifies_impact: ['outcome', 'effect size', 'improvement', 'impact', 'success rate'],
  establishes_precedent: ['comparative', 'precedent', 'benchmark', 'baseline', 'current practice'],
  policy_alignment: ['policy', 'strategy', 'framework', 'priority', 'roadmap'],
}

const ROLE_DIGEST_TAGS: Record<GrantPersuasionRole, string> = {
  proves_need: 'prove burden',
  shows_gap: 'show gap',
  validates_approach: 'validate approach',
  supports_feasibility: 'prove feasibility',
  quantifies_impact: 'quantify impact',
  establishes_precedent: 'establish precedent',
  policy_alignment: 'show policy fit',
}

const ROLE_USAGE_HINTS: Record<GrantPersuasionRole, string> = {
  proves_need: 'Attach this citation to the exact burden statistic or urgency fact.',
  shows_gap: 'Use this citation to name the limitation, barrier, or unmet need.',
  validates_approach: 'Use this citation to validate the chosen method or measurement logic.',
  supports_feasibility: 'Use this citation to show a comparable implementation worked.',
  quantifies_impact: 'Use this citation with the concrete outcome metric or effect size.',
  establishes_precedent: 'Use this citation to compare against current practice or precedent.',
  policy_alignment: 'Use this citation to anchor the proposal in a named strategy or framework.',
}

const ROLE_DIMENSION_TYPE: Record<GrantPersuasionRole, GrantBlueprintDimensionType> = {
  proves_need: 'foundational',
  shows_gap: 'gap',
  validates_approach: 'methodological',
  supports_feasibility: 'empirical',
  quantifies_impact: 'empirical',
  establishes_precedent: 'comparative',
  policy_alignment: 'comparative',
}

const SEMANTIC_ROLE_ORDER: Record<GrantSectionSemantic, GrantPersuasionRole[]> = {
  summary: ['proves_need', 'supports_feasibility', 'quantifies_impact', 'policy_alignment'],
  problem_need: ['proves_need', 'shows_gap', 'policy_alignment'],
  objectives: ['shows_gap', 'quantifies_impact', 'policy_alignment'],
  methodology: ['supports_feasibility', 'validates_approach', 'establishes_precedent'],
  workplan: ['supports_feasibility', 'validates_approach', 'establishes_precedent'],
  innovation: ['establishes_precedent', 'shows_gap', 'validates_approach'],
  evaluation: ['validates_approach', 'quantifies_impact', 'supports_feasibility'],
  impact_outcomes: ['quantifies_impact', 'establishes_precedent', 'supports_feasibility'],
  alignment: ['policy_alignment', 'proves_need', 'establishes_precedent'],
  sustainability: ['establishes_precedent', 'supports_feasibility', 'quantifies_impact'],
  risk: ['shows_gap', 'supports_feasibility', 'validates_approach'],
  default: ['proves_need', 'supports_feasibility', 'quantifies_impact'],
}

export function persuasionRoleToDimensionType(role: GrantPersuasionRole): GrantBlueprintDimensionType {
  return ROLE_DIMENSION_TYPE[role]
}

export function getGrantSemanticRoleOrder(semantic: GrantSectionSemantic | null | undefined): GrantPersuasionRole[] {
  return SEMANTIC_ROLE_ORDER[semantic || 'default'] || SEMANTIC_ROLE_ORDER.default
}

export function getGrantPersuasionSearchTerms(role: GrantPersuasionRole): string[] {
  return ROLE_SEARCH_TERMS[role]
}

export function getGrantEvidenceDigestTag(role: GrantPersuasionRole): string {
  return ROLE_DIGEST_TAGS[role]
}

export function getGrantEvidenceUsageHint(role: GrantPersuasionRole): string {
  return ROLE_USAGE_HINTS[role]
}

export function getGrantPersuasionYearWindow(
  role: GrantPersuasionRole,
  currentYear = new Date().getUTCFullYear()
): { suggestedYearFrom?: number; suggestedYearTo?: number } {
  switch (role) {
    case 'proves_need':
    case 'policy_alignment':
      return { suggestedYearFrom: currentYear - 12, suggestedYearTo: currentYear }
    case 'shows_gap':
    case 'supports_feasibility':
    case 'quantifies_impact':
    case 'establishes_precedent':
      return { suggestedYearFrom: currentYear - 6, suggestedYearTo: currentYear }
    case 'validates_approach':
      return { suggestedYearFrom: currentYear - 8, suggestedYearTo: currentYear }
    default:
      return { suggestedYearFrom: currentYear - 10, suggestedYearTo: currentYear }
  }
}

export function inferGrantPersuasionRole(input: {
  dimension: string
  semantic?: GrantSectionSemantic | null
  dimensionType?: GrantBlueprintDimensionType | null
}): GrantPersuasionRole {
  const text = normalizeText(input.dimension)
  const semantic = input.semantic || 'default'

  if (/(policy|strategy|framework|priority|mission|roadmap|scheme|call alignment|strategic fit)/.test(text)) {
    return 'policy_alignment'
  }
  if (/(gap|limitation|barrier|challenge|constraint|unmet|insufficient|shortfall|bottleneck)/.test(text)) {
    return 'shows_gap'
  }
  if (/(prevalence|incidence|burden|mortality|morbidity|cost|baseline|urgency|affected|demand|population)/.test(text)) {
    return 'proves_need'
  }
  if (/(feasib|implementation|pilot|deployment|operational readiness|delivery readiness|adoption|uptake)/.test(text)) {
    return 'supports_feasibility'
  }
  if (/(outcome|impact|effect size|improvement|reduction|increase|success rate|result metric)/.test(text)) {
    return 'quantifies_impact'
  }
  if (/(validation|validated|reliability|benchmark|measurement|indicator|protocol|evaluation design)/.test(text)) {
    return 'validates_approach'
  }
  if (/(comparison|comparative|precedent|current practice|alternative|benchmark against|advantage)/.test(text)) {
    return 'establishes_precedent'
  }

  if (input.dimensionType === 'gap') return 'shows_gap'
  if (input.dimensionType === 'methodological') return 'validates_approach'
  if (input.dimensionType === 'comparative') {
    return semantic === 'alignment' ? 'policy_alignment' : 'establishes_precedent'
  }
  if (input.dimensionType === 'foundational') return 'proves_need'

  switch (semantic) {
    case 'problem_need':
    case 'summary':
      return 'proves_need'
    case 'innovation':
      return 'establishes_precedent'
    case 'methodology':
    case 'workplan':
      return 'supports_feasibility'
    case 'evaluation':
      return 'validates_approach'
    case 'impact_outcomes':
      return 'quantifies_impact'
    case 'alignment':
      return 'policy_alignment'
    case 'sustainability':
      return 'establishes_precedent'
    case 'risk':
      return 'shows_gap'
    default:
      return 'supports_feasibility'
  }
}
