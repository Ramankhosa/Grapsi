import type { GrantTemplateIntent } from '@/types/grant'

/**
 * The reviewer's canonical section vocabulary. Every rule, every drafted
 * section, and every extracted requirement is folded into one of these buckets
 * so that template-backed, guideline-backed, and URL-extracted calls all score
 * against the same structure.
 */
export const BUCKET_LABELS: Record<string, string> = {
  summary: 'Summary / Abstract',
  problem_need: 'Problem, Need & Call Fit',
  objectives: 'Objectives & Specific Aims',
  methodology: 'Methodology / Approach',
  workplan: 'Workplan & Timeline',
  budget: 'Budget & Justification',
  evaluation: 'Evaluation Plan',
  impact_outcomes: 'Impact & Outcomes',
  team: 'Team & Capability',
  sustainability_risk: 'Sustainability, Risk & Mitigation',
  attachments_submission: 'Attachments & Submission Requirements',
  other: 'Other Proposal Material',
}

export const BUCKET_ORDER: string[] = [
  'summary',
  'problem_need',
  'objectives',
  'methodology',
  'workplan',
  'budget',
  'evaluation',
  'impact_outcomes',
  'team',
  'sustainability_risk',
  'attachments_submission',
  'other',
]

export function bucketLabel(bucketKey: string): string {
  return BUCKET_LABELS[bucketKey] || BUCKET_LABELS.other
}

export function normalizeBucketKey(value: string): string {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!key) return 'other'
  if (BUCKET_LABELS[key]) return key
  return 'other'
}

export function bucketFromText(value: string): string {
  const text = String(value || '').toLowerCase()
  if (/\b(abstract|summary|overview|synopsis)\b/.test(text)) return 'summary'
  if (/\b(problem|need|background|significance|alignment|fit|rationale|innovation)\b/.test(text)) return 'problem_need'
  if (/\b(objective|aim|goal|hypothesis)\b/.test(text)) return 'objectives'
  if (/\b(method|approach|research plan|design|experiment|implementation)\b/.test(text)) return 'methodology'
  if (/\b(workplan|work plan|timeline|milestone|schedule|gantt|deliverable)\b/.test(text)) return 'workplan'
  if (/\b(budget|cost|justification|finance|financial)\b/.test(text)) return 'budget'
  if (/\b(evaluation|monitoring|metric|assessment|measure)\b/.test(text)) return 'evaluation'
  if (/\b(impact|outcome|benefit|result|dissemination)\b/.test(text)) return 'impact_outcomes'
  if (/\b(team|expertise|cv|investigator|personnel|institution)\b/.test(text)) return 'team'
  if (/\b(sustainability|risk|mitigation|contingency)\b/.test(text)) return 'sustainability_risk'
  if (/\b(attachment|appendix|annexure|submission|eligibility|compliance|checklist)\b/.test(text)) return 'attachments_submission'
  return 'other'
}

export function bucketFromIntent(intent?: GrantTemplateIntent | string | null, fallbackText = ''): string {
  const normalized = String(intent || '').trim().toLowerCase()
  switch (normalized) {
    case 'summary':
      return 'summary'
    case 'problem_need':
    case 'alignment':
    case 'innovation':
      return 'problem_need'
    case 'objectives':
      return 'objectives'
    case 'methodology':
      return 'methodology'
    case 'workplan':
      return 'workplan'
    case 'budget':
      return 'budget'
    case 'evaluation':
      return 'evaluation'
    case 'impact_outcomes':
      return 'impact_outcomes'
    case 'team':
    case 'institutional':
      return 'team'
    case 'sustainability':
    case 'risk':
      return 'sustainability_risk'
    case 'attachments':
    case 'submission':
    case 'eligibility':
      return 'attachments_submission'
    default:
      return bucketFromText(fallbackText)
  }
}

export function dedupeRuleText(values: unknown[], limit?: number): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const value of values) {
    const normalized = String(value ?? '').trim().replace(/\s+/g, ' ')
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    next.push(normalized)
    if (limit && next.length >= limit) break
  }
  return next
}
