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
  reviewerQuestion: string
  openingMove: string
  recommendedFlow: string[]
  evidenceUseRules: string[]
  antiPatterns: string[]
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

function buildReviewerQuestion(input: GrantPromptProfileInput): string {
  switch (input.grantSemantic) {
    case 'summary':
      return 'Why should this proposal be funded now, for whom, and with what expected payoff?'
    case 'problem_need':
      return 'Is this a real, specific, urgent problem that has not been adequately addressed, and is the applicant\'s angle meaningfully different from the other proposals the reviewer has seen today?'
    case 'objectives':
      return 'What exactly will this proposal achieve, and how will success be recognized?'
    case 'methodology':
      return 'What will be done, why is it credible, and how will execution risk be controlled?'
    case 'workplan':
      return 'What happens when, by whom, and with which milestones and dependencies?'
    case 'innovation':
      return 'What is genuinely differentiated here, and why does that difference matter for the call?'
    case 'evaluation':
      return 'How will success be measured, validated, and used for course correction?'
    case 'impact_outcomes':
      return 'What changes for beneficiaries, on what timeline, and with what evidence of impact?'
    case 'alignment':
      return 'How does this section satisfy the call priorities and reviewer scoring logic?'
    case 'sustainability':
      return 'How will value continue, scale, or institutionalize beyond the grant period?'
    case 'risk':
      return 'What can fail, how likely is it, and what is the mitigation plan?'
    default:
      break
  }

  switch (input.templateIntent) {
    case 'team':
      return 'Why is this team structurally capable of delivering the proposal?'
    case 'eligibility':
      return 'How does the applicant clearly satisfy fit and eligibility constraints?'
    default:
      return 'What does the reviewer need to believe after reading this section?'
  }
}

function buildOpeningMove(input: GrantPromptProfileInput): string {
  switch (input.grantSemantic) {
    case 'summary':
      return 'Open with the need, the intervention, and the expected outcome in one reviewer-facing move.'
    case 'problem_need':
      return 'Open with the concrete problem signal, the affected beneficiaries, and the cost of inaction.'
    case 'objectives':
      return 'Open with the proposal objective set in precise, measurable language.'
    case 'methodology':
      return 'Open with the proposed delivery model and why it is fit for purpose.'
    case 'workplan':
      return 'Open with the execution frame: phases, milestones, and ownership.'
    case 'innovation':
      return 'Open with the differentiating move, not generic importance language.'
    case 'evaluation':
      return 'Open with the evaluation logic and what will count as success.'
    case 'impact_outcomes':
      return 'Open with the intended beneficiary change and the mechanism that produces it.'
    case 'alignment':
      return 'Open with the call-fit statement using the funder\'s priorities explicitly.'
    case 'sustainability':
      return 'Open with the continuity model beyond the funded period.'
    case 'risk':
      return 'Open with the material risk posture and the mitigation stance.'
    default:
      break
  }

  switch (input.templateIntent) {
    case 'team':
      return 'Open with the delivery capability of the team rather than biography-style detail.'
    case 'eligibility':
      return 'Open with the fit claim and the specific constraint the applicant satisfies.'
    default:
      return 'Open with the reviewer-facing claim this section must establish.'
  }
}

function buildRecommendedFlow(input: GrantPromptProfileInput): string[] {
  switch (input.grantSemantic) {
    case 'summary':
      return ['Need and urgency', 'Intervention and delivery model', 'Expected outcomes and call fit']
    case 'problem_need':
      return ['Problem signal and stakes', 'Beneficiaries and unmet need', 'Why existing responses are insufficient', 'Why this proposal is justified now']
    case 'objectives':
      return ['Primary objective', 'Operational scope boundaries', 'Success criteria and measurable outcomes']
    case 'methodology':
      return ['Approach overview', 'Execution steps and work components', 'Validation or evaluation method', 'Risk controls and feasibility']
    case 'workplan':
      return ['Phases and milestones', 'Dependencies and sequencing', 'Ownership and governance', 'Monitoring checkpoints']
    case 'innovation':
      return ['What is differentiated', 'Why that difference matters', 'Why it is credible in this context']
    case 'evaluation':
      return ['Evaluation questions', 'Metrics and thresholds', 'Data sources and cadence', 'How learning will inform execution']
    case 'impact_outcomes':
      return ['Immediate outputs', 'Beneficiary outcomes', 'Adoption or deployment path', 'Longer-term value or scale']
    case 'alignment':
      return ['Relevant call priority', 'How the proposal directly addresses it', 'Why the fit is distinctive and credible']
    case 'sustainability':
      return ['Post-grant continuity model', 'Operational or financial support', 'Scale or institutionalization path']
    case 'risk':
      return ['Primary risks', 'Mitigation and contingency', 'Residual exposure and controls']
    default:
      break
  }

  switch (input.templateIntent) {
    case 'team':
      return ['Roles and ownership', 'Relevant expertise', 'Governance or coordination', 'Partnership contribution']
    case 'eligibility':
      return ['Applicable eligibility requirement', 'Applicant fit evidence', 'Institutional or scope fit', 'Any constraints or boundary notes']
    default:
      return ['Reviewer-facing claim', 'Supporting evidence or logic', 'Execution or fit implication']
  }
}

function buildEvidenceUseRules(input: GrantPromptProfileInput): string[] {
  const rules = [
    'Use authoritative section-mapped Grant Prep points as the factual backbone when they are provided.',
    'Use related-section awareness only to preserve coherence; do not turn it into new required claims.',
    'Prefer specific facts, beneficiaries, milestones, metrics, and feasibility signals over generic prose.',
    'Prefer one concrete statistic, comparison, or precedent over several vague background sentences.',
  ]

  if (input.citationMode === 'mapped_evidence') {
    rules.push('When mapped evidence is required, use only the allowed citation anchors and keep them attached to the claims they support.')
  } else if (input.citationMode === 'direct_draft') {
    rules.push('Draft directly from the section contract and prep evidence without inventing unsupported citation placeholders.')
  }

  return rules
}

function buildAntiPatterns(input: GrantPromptProfileInput): string[] {
  const base = [
    'Do not slip into journal-manuscript framing or literature-review throat clearing.',
    'Do not invent compliance, eligibility, evidence, or implementation detail that is not supported.',
    'Do not dump checklist items without narrative logic unless the section type explicitly requires it.',
    'Do not open with "X is a growing global challenge" or equivalent filler.',
    'Do not list broad impact areas when one measurable outcome would be stronger.',
    'Do not claim innovation without naming the comparison point or current practice.',
  ]

  switch (input.grantSemantic) {
    case 'summary':
      return [...base, 'Do not turn the summary into a method dump or background essay.']
    case 'problem_need':
      return [
        ...base,
        'Do not use vague importance language without stakes, affected beneficiaries, or concrete urgency signals.',
        'Do not spend the opening paragraph on generic textbook background.',
      ]
    case 'methodology':
      return [
        ...base,
        'Do not describe the approach abstractly without execution detail or credibility signals.',
        'Do not claim feasibility solely through confidence language such as "we are well positioned".',
      ]
    case 'impact_outcomes':
      return [...base, 'Do not list multiple high-level impacts without naming the lead measurable outcome.']
    case 'alignment':
      return [...base, 'Do not rely on generic mission statements instead of explicit call-fit language.']
    default:
      break
  }

  if (input.templateIntent === 'eligibility') {
    return [...base, 'Do not overstate compliance or claim eligibility that is not evidenced.']
  }

  return base
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
    reviewerQuestion: buildReviewerQuestion(input || {}),
    openingMove: buildOpeningMove(input || {}),
    recommendedFlow: buildRecommendedFlow(input || {}),
    evidenceUseRules: buildEvidenceUseRules(input || {}),
    antiPatterns: buildAntiPatterns(input || {}),
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
  const flowBlock = profile.recommendedFlow.length > 0
    ? `RECOMMENDED FLOW:\n${profile.recommendedFlow.map((step) => `- ${step}`).join('\n')}`
    : ''
  const evidenceBlock = profile.evidenceUseRules.length > 0
    ? `EVIDENCE USE RULES:\n${profile.evidenceUseRules.map((rule) => `- ${rule}`).join('\n')}`
    : ''
  const antiPatternBlock = profile.antiPatterns.length > 0
    ? `ANTI-PATTERNS:\n${profile.antiPatterns.map((rule) => `- ${rule}`).join('\n')}`
    : ''

  return [
    lines.length > 0 ? `GRANT SECTION PROFILE:\n${lines.map((line) => `- ${line}`).join('\n')}` : '',
    profile.reviewerQuestion ? `REVIEWER QUESTION:\n- ${profile.reviewerQuestion}` : '',
    profile.openingMove ? `OPENING MOVE:\n- ${profile.openingMove}` : '',
    flowBlock,
    evidenceBlock,
    antiPatternBlock,
    rulesBlock,
  ].filter(Boolean).join('\n\n')
}
