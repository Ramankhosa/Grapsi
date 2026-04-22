import type {
  GrantCitationMode,
  GrantSectionComplianceContract,
  GrantPrepContextBlock,
  GrantPrepPromptBundle,
  GrantRuleProfile,
  GrantSectionSemantic,
  GrantTemplateIntent,
} from '@/types/grant'
import { formatGrantComplianceContractForPrompt } from '@/lib/grants/compliance'
import {
  buildGrantPromptProfile,
  formatGrantPromptProfileForPrompt,
} from '@/lib/grants/promptProfile'

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
  templateIntent?: GrantTemplateIntent | null
  prepContextBlock?: GrantPrepContextBlock | null
  authoritativePrepBundle?: GrantPrepPromptBundle | null
  relatedPrepAwareness?: GrantPrepPromptBundle | null
  grantRuleProfile?: GrantRuleProfile | null
  grantSectionComplianceContract?: GrantSectionComplianceContract | null
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
  return buildGrantPromptProfile({ grantSemantic: semantic }).task
}

export function buildGrantBackedBasePrompt(
  sectionKey: string,
  context?: SharedGrantPromptContext
): string {
  const sectionTitle = context?.displayLabel || formatSectionLabel(sectionKey)
  const profile = buildGrantPromptProfile({
    sectionType: context?.sectionType,
    reviewerIntent: context?.reviewerIntent,
    citationMode: context?.citationMode,
    grantSemantic: context?.grantSemantic,
    templateIntent: context?.templateIntent,
  })

  return [
    'You are writing a grant proposal section inside Grapsi.',
    'Write for grant reviewers, not for a journal manuscript audience.',
    'Use the grant section contract and mapped evidence below as the governing source of truth.',
    `Section key: ${sectionKey}`,
    `Section title: ${sectionTitle}`,
    `Section task: ${profile.task}`,
    context?.sectionType ? `Section type: ${context.sectionType}` : '',
    context?.templateIntent ? `Template intent: ${context.templateIntent}` : '',
    context?.reviewerIntent ? `Reviewer intent: ${context.reviewerIntent}` : '',
    context?.citationMode ? `Citation mode: ${context.citationMode}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildGrantPromptOverlay(context?: SharedGrantPromptContext): string {
  if (!context) return ''

  const grantSummaryLines = context.grantContextSummary?.freezeSummary || []
  const authoritativePrepBundle = context.authoritativePrepBundle || context.prepContextBlock || null
  const awarenessBundle = context.relatedPrepAwareness || null
  const grantRules = context.grantRuleProfile
  const grantContractBlock = formatGrantComplianceContractForPrompt(context.grantSectionComplianceContract)
  const grantProfileBlock = formatGrantPromptProfileForPrompt(buildGrantPromptProfile({
    sectionType: context.sectionType,
    reviewerIntent: context.reviewerIntent,
    citationMode: context.citationMode,
    grantSemantic: context.grantSemantic,
    templateIntent: context.templateIntent,
  }))

  const blocks = [
    grantSummaryLines.length > 0
      ? `GRANT CONTEXT:\n${grantSummaryLines.map((line) => `- ${line}`).join('\n')}`
      : '',
    grantProfileBlock,
    grantContractBlock,
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
    authoritativePrepBundle && (
      authoritativePrepBundle.bullets.length > 0
      || authoritativePrepBundle.keywords.length > 0
    )
      ? [
          'AUTHORITATIVE SECTION PREP POINTS:',
          '- Treat these as the factual backbone for this section.',
          authoritativePrepBundle.bullets.length > 0
            ? authoritativePrepBundle.bullets.map((item) => `- ${item}`).join('\n')
            : '',
          authoritativePrepBundle.keywords.length > 0
            ? `Keywords: ${authoritativePrepBundle.keywords.join(', ')}`
            : '',
        ].filter(Boolean).join('\n')
      : '',
    awarenessBundle && (
      awarenessBundle.bullets.length > 0
      || awarenessBundle.keywords.length > 0
    )
      ? [
          'RELATED SECTION AWARENESS:',
          '- Awareness only; do not turn these into new required claims.',
          awarenessBundle.bullets.length > 0
            ? awarenessBundle.bullets.map((item) => `- ${item}`).join('\n')
            : '',
          awarenessBundle.keywords.length > 0
            ? `Keywords: ${awarenessBundle.keywords.join(', ')}`
            : '',
        ].filter(Boolean).join('\n')
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
