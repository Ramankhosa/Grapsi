import type {
  GrantCitationMode,
  GrantPrepContextBlock,
  GrantRuleProfile,
  GrantSectionSemantic,
} from '@/types/grant'

export interface GrantPromptSummary {
  projectTitle?: string | null
  fundingCallTitle?: string | null
  agencyName?: string | null
  freezeSummary?: string[]
}

export interface SharedGrantPromptContext {
  displayLabel?: string
  reviewerIntent?: string | null
  sectionType?: string | null
  grantSemantic?: GrantSectionSemantic | null
  prepContextBlock?: GrantPrepContextBlock | null
  grantRuleProfile?: GrantRuleProfile | null
  grantContextSummary?: GrantPromptSummary | null
  citationMode?: GrantCitationMode | null
}

export function summarizeGrantFreezePayload(value: unknown): string[] {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const project = record.project && typeof record.project === 'object' && !Array.isArray(record.project)
    ? record.project as Record<string, unknown>
    : {}
  const fundingCall = record.fundingCall && typeof record.fundingCall === 'object' && !Array.isArray(record.fundingCall)
    ? record.fundingCall as Record<string, unknown>
    : {}
  const globalKeywords = Array.isArray(record.globalKeywords)
    ? record.globalKeywords.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
    : []

  return [
    String(project.title || '').trim() ? `Project: ${String(project.title).trim()}` : '',
    String(fundingCall.title || '').trim() ? `Funding call: ${String(fundingCall.title).trim()}` : '',
    String(fundingCall.agencyName || '').trim() ? `Agency: ${String(fundingCall.agencyName).trim()}` : '',
    globalKeywords.length > 0 ? `Prep keywords: ${globalKeywords.join(', ')}` : '',
  ].filter(Boolean)
}

export function buildGrantPromptTask(semantic: GrantSectionSemantic | null | undefined): string {
  switch (semantic) {
    case 'summary':
      return 'Write a concise proposal summary that integrates need, approach, outcomes, and funding-call fit.'
    case 'problem_need':
      return 'Establish the problem, urgency, beneficiary need, and why the proposed intervention is justified now.'
    case 'objectives':
      return 'State precise objectives, scope boundaries, and measurable success targets.'
    case 'methodology':
      return 'Explain the technical or programmatic approach, why it is credible, and how it will be executed.'
    case 'workplan':
      return 'Describe the work packages, milestones, dependencies, governance, and delivery sequencing.'
    case 'innovation':
      return 'Explain the novelty, differentiation, and why the innovation matters for the call.'
    case 'evaluation':
      return 'Describe how success will be measured, validated, and monitored.'
    case 'impact_outcomes':
      return 'Explain expected outcomes, beneficiaries, adoption, and measurable impact pathways.'
    case 'alignment':
      return 'Show explicit alignment with the funder priorities, call themes, and reviewer expectations.'
    case 'sustainability':
      return 'Explain continuity, scale-up, and sustainability beyond the grant period.'
    case 'risk':
      return 'Identify material risks and explain mitigation and contingency measures.'
    default:
      return 'Write a grant proposal section that is reviewer-oriented, concrete, and evidence grounded.'
  }
}

export function buildGrantBackedBasePrompt(
  sectionKey: string,
  context?: SharedGrantPromptContext
): string {
  const sectionTitle = context?.displayLabel || formatSectionLabel(sectionKey)
  const semantic = context?.grantSemantic || 'default'

  return [
    'You are writing a grant proposal section inside Grapsi.',
    'Write for grant reviewers, not for a journal manuscript audience.',
    'Use the grant section contract and mapped evidence below as the governing source of truth.',
    `Section key: ${sectionKey}`,
    `Section title: ${sectionTitle}`,
    `Section task: ${buildGrantPromptTask(semantic)}`,
    context?.sectionType ? `Section type: ${context.sectionType}` : '',
    context?.reviewerIntent ? `Reviewer intent: ${context.reviewerIntent}` : '',
    context?.citationMode ? `Citation mode: ${context.citationMode}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildGrantPromptOverlay(context?: SharedGrantPromptContext): string {
  if (!context) return ''

  const grantSummaryLines = context.grantContextSummary?.freezeSummary || []
  const prepBullets = context.prepContextBlock?.bullets || []
  const prepKeywords = context.prepContextBlock?.keywords || []
  const grantRules = context.grantRuleProfile

  const blocks = [
    grantSummaryLines.length > 0
      ? `GRANT CONTEXT:\n${grantSummaryLines.map((line) => `- ${line}`).join('\n')}`
      : '',
    context.grantSemantic
      ? `GRANT SEMANTIC PROFILE:\n- ${context.grantSemantic.replace(/_/g, ' ')}`
      : '',
    context.citationMode
      ? `SECTION CITATION MODE:\n- ${context.citationMode.replace(/_/g, ' ')}`
      : '',
    grantRules && (
      grantRules.requiredPoints.length > 0
      || grantRules.evaluationFocus.length > 0
      || grantRules.reviewerSignals.length > 0
      || grantRules.avoidRules.length > 0
      || grantRules.formatConstraints.length > 0
      || grantRules.narrativeConstraints.length > 0
    )
      ? [
          'GRANT RULES:',
          grantRules.requiredPoints.length > 0
            ? `Required points:\n${grantRules.requiredPoints.map((item) => `- ${item}`).join('\n')}`
            : '',
          grantRules.evaluationFocus.length > 0
            ? `Evaluation focus:\n${grantRules.evaluationFocus.map((item) => `- ${item}`).join('\n')}`
            : '',
          grantRules.reviewerSignals.length > 0
            ? `Reviewer signals:\n${grantRules.reviewerSignals.map((item) => `- ${item}`).join('\n')}`
            : '',
          grantRules.avoidRules.length > 0
            ? `Avoid:\n${grantRules.avoidRules.map((item) => `- ${item}`).join('\n')}`
            : '',
          grantRules.formatConstraints.length > 0
            ? `Format constraints:\n${grantRules.formatConstraints.map((item) => `- ${item}`).join('\n')}`
            : '',
          grantRules.narrativeConstraints.length > 0
            ? `Narrative constraints:\n${grantRules.narrativeConstraints.map((item) => `- ${item}`).join('\n')}`
            : '',
        ].filter(Boolean).join('\n\n')
      : '',
    prepBullets.length > 0
      ? `GRANT PREP SIGNALS:\n${prepBullets.map((item) => `- ${item}`).join('\n')}`
      : '',
    prepKeywords.length > 0
      ? `SECTION-SCOPED PREP KEYWORDS: ${prepKeywords.join(', ')}`
      : '',
  ].filter(Boolean)

  return blocks.length > 0 ? `\n\n${blocks.join('\n\n')}` : ''
}

export function formatGrantMustCoverItems(
  mustCover: string[],
  mustCoverTyping?: Record<string, string> | null
): string[] {
  return mustCover.map((item) => {
    const type = mustCoverTyping?.[item]
    return type ? `[${type}] ${item}` : item
  })
}

function formatSectionLabel(sectionKey: string): string {
  return String(sectionKey || '')
    .trim()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
