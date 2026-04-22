import type {
  GrantCitationMode,
  GrantSectionSemantic,
  GrantTemplateIntent,
} from '@/types/grant'

export interface GrantPromptProfileInput {
  sectionType?: string | null
  reviewerIntent?: string | null
  citationMode?: GrantCitationMode | null
  grantSemantic?: GrantSectionSemantic | null
  templateIntent?: GrantTemplateIntent | null
}

export interface GrantPromptProfile {
  task: string
  sectionTypeRules: string[]
  grantSemantic: GrantSectionSemantic | null
  templateIntent: GrantTemplateIntent | null
  citationMode: GrantCitationMode | null
}

function labelize(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim()
  return normalized ? normalized.replace(/_/g, ' ') : null
}

function buildTask(input: GrantPromptProfileInput): string {
  switch (input.grantSemantic) {
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
      break
  }

  switch (input.templateIntent) {
    case 'team':
      return 'Describe the team roles, expertise, governance, and partnership contributions needed to deliver the proposal.'
    case 'eligibility':
      return 'Show applicant and institutional fit with the call scope and eligibility constraints without overstating compliance.'
    default:
      return 'Write a grant proposal section that is reviewer-oriented, concrete, and evidence grounded.'
  }
}

function buildSectionTypeRules(sectionType: string | null | undefined): string[] {
  switch (sectionType) {
    case 'narrative':
      return [
        'Write reviewer-facing prose rather than a journal manuscript section.',
        'Use paragraphs first; add headings only when they improve scanability.',
        'Sequence the narrative around the section task and required points, not a checklist dump.',
      ]
    case 'short_answer':
      return [
        'Lead with the direct answer in the first sentence.',
        'Default to one compact response block unless the template clearly requires bullets.',
        'Do not add gratuitous headings, framing, or essay-style buildup.',
        'Stay tightly inside any word or character limit.',
      ]
    case 'checklist':
    case 'table':
    case 'budget_rows':
      return [
        'This section type is normally handled outside AI drafting.',
        'If it reaches this prompt, stay literal to the section requirements and do not invent unsupported structure.',
      ]
    default:
      return ['Write with grant-review clarity and keep the response tightly scoped to the section task.']
  }
}

export function buildGrantPromptProfile(input?: GrantPromptProfileInput | null): GrantPromptProfile {
  const sectionType = String(input?.sectionType || '').trim() || null
  return {
    task: buildTask(input || {}),
    sectionTypeRules: buildSectionTypeRules(sectionType),
    grantSemantic: input?.grantSemantic || null,
    templateIntent: input?.templateIntent || null,
    citationMode: input?.citationMode || null,
  }
}

export function formatGrantPromptProfileForPrompt(profile: GrantPromptProfile): string {
  const lines = [
    profile.grantSemantic ? `Grant semantic: ${labelize(profile.grantSemantic)}` : '',
    profile.templateIntent ? `Template intent: ${labelize(profile.templateIntent)}` : '',
    profile.citationMode ? `Citation mode: ${labelize(profile.citationMode)}` : '',
  ].filter(Boolean)

  const rulesBlock = profile.sectionTypeRules.length > 0
    ? `SECTION-TYPE RULES:\n${profile.sectionTypeRules.map((rule) => `- ${rule}`).join('\n')}`
    : ''

  return [
    lines.length > 0 ? `GRANT SECTION PROFILE:\n${lines.map((line) => `- ${line}`).join('\n')}` : '',
    rulesBlock,
  ].filter(Boolean).join('\n\n')
}
