import type { FundingTemplateItem, GrantTemplateDocument } from './types'
import { normalizeGrantTemplate } from './utils'

export const STANDARD_GRANT_TEMPLATE_VERSION = 'standard_grant_application_v1'
export const STANDARD_GRANT_TEMPLATE_FALLBACK_WARNING =
  'Standard fallback template used because no funder-specific proposal template was provided.'

function item(input: {
  key: string
  label: string
  type?: FundingTemplateItem['type']
  wordLimit?: number
  guidance: string
  templateIntent: NonNullable<FundingTemplateItem['templateIntent']>
  templateIntentAlternates?: NonNullable<FundingTemplateItem['templateIntentAlternates']>
  draftingVsSubmission?: FundingTemplateItem['draftingVsSubmission']
  workflowMode?: FundingTemplateItem['workflowMode']
  supportLevel?: FundingTemplateItem['supportLevel']
}): FundingTemplateItem {
  return {
    key: input.key,
    label: input.label,
    type: input.type || 'section',
    workflowMode: input.workflowMode || 'app_draft',
    required: true,
    repeatable: false,
    visibleWhen: null,
    wordLimit: input.wordLimit || null,
    charLimit: null,
    options: [],
    schema: null,
    guidance: input.guidance,
    guidanceText: input.guidance,
    templateIntent: input.templateIntent,
    templateIntentAlternates: input.templateIntentAlternates || [],
    templateIntentConfidence: 0.95,
    requiredFacts: [input.guidance],
    reviewerGoal: input.guidance,
    forbiddenMoves: [],
    draftingVsSubmission: input.draftingVsSubmission || 'drafting',
    supportLevel: input.supportLevel || 'partial',
    confidence: 1,
    sourceAnchors: [],
  }
}

export function buildStandardGrantApplicationTemplate(): GrantTemplateDocument {
  return normalizeGrantTemplate({
    questions: [],
    sections: [
      item({
        key: 'project_summary',
        label: 'Project Summary / Abstract',
        wordLimit: 300,
        templateIntent: 'summary',
        guidance: 'Summarize the project, target problem, proposed solution, expected outcomes, and fit with the call.',
      }),
      item({
        key: 'problem_need',
        label: 'Problem, Need, and Rationale',
        wordLimit: 900,
        templateIntent: 'problem_need',
        guidance: 'Explain the problem, who is affected, the evidence of need, and why the work is timely.',
      }),
      item({
        key: 'objectives',
        label: 'Objectives and Specific Aims',
        wordLimit: 500,
        templateIntent: 'objectives',
        guidance: 'State clear objectives, aims, or research questions that the project will achieve.',
      }),
      item({
        key: 'funder_alignment',
        label: 'Fit with Funder Priorities',
        wordLimit: 500,
        templateIntent: 'alignment',
        guidance: 'Connect the project directly to the funder goals, call priorities, and eligibility expectations.',
      }),
      item({
        key: 'methodology',
        label: 'Approach / Methodology',
        wordLimit: 1200,
        templateIntent: 'methodology',
        guidance: 'Describe the activities, methods, design, participants, data, implementation approach, and feasibility.',
      }),
      item({
        key: 'workplan',
        label: 'Work Plan, Timeline, and Milestones',
        wordLimit: 800,
        templateIntent: 'workplan',
        guidance: 'Lay out major tasks, timeline, responsibilities, milestones, and deliverables.',
      }),
      item({
        key: 'innovation',
        label: 'Innovation / Differentiation',
        wordLimit: 500,
        templateIntent: 'innovation',
        guidance: 'Explain what is novel, improved, or meaningfully different from existing approaches.',
      }),
      item({
        key: 'evaluation',
        label: 'Evaluation and Success Metrics',
        wordLimit: 700,
        templateIntent: 'evaluation',
        guidance: 'Define outputs, outcomes, success metrics, monitoring methods, and learning or reporting plans.',
      }),
      item({
        key: 'impact_outcomes',
        label: 'Outcomes, Impact, and Dissemination',
        wordLimit: 800,
        templateIntent: 'impact_outcomes',
        guidance: 'Describe expected outcomes, broader impact, beneficiaries, dissemination, and value for the funder.',
      }),
      item({
        key: 'team_capacity',
        label: 'Team, Institutional Capacity, and Partnerships',
        wordLimit: 700,
        templateIntent: 'team',
        templateIntentAlternates: ['institutional'],
        guidance: 'Show that the team, institution, and partners have the expertise, capacity, and governance to deliver.',
      }),
      item({
        key: 'sustainability_risk',
        label: 'Sustainability, Scale, Risks, and Mitigation',
        wordLimit: 800,
        templateIntent: 'sustainability',
        templateIntentAlternates: ['risk'],
        guidance: 'Explain sustainability beyond the grant, scale potential, key risks, and mitigation plans.',
      }),
    ],
    budget: {
      required: true,
      yearWise: false,
      workflowMode: 'app_draft',
      columns: [
        { key: 'category', label: 'Category', kind: 'category', required: true, sourceAnchors: [] },
        { key: 'amount', label: 'Amount', kind: 'amount', required: true, sourceAnchors: [] },
        { key: 'justification', label: 'Justification', kind: 'justification', required: true, sourceAnchors: [] },
      ],
      categories: [],
      caps: null,
      justificationNotes: 'Provide requested costs and concise justification aligned with the work plan.',
      supportLevel: 'partial',
      confidence: 1,
      sourceAnchors: [],
    },
    attachments: [
      item({
        key: 'cv_biosketches',
        label: 'CVs / Biosketches',
        type: 'attachment',
        workflowMode: 'team_manual',
        templateIntent: 'attachments',
        draftingVsSubmission: 'submission',
        supportLevel: 'manual',
        guidance: 'Include required CVs, biosketches, or team profiles if the call requests them.',
      }),
      item({
        key: 'letters_of_support',
        label: 'Letters of Support',
        type: 'attachment',
        workflowMode: 'team_manual',
        templateIntent: 'attachments',
        draftingVsSubmission: 'submission',
        supportLevel: 'manual',
        guidance: 'Collect partner, institutional, or stakeholder letters when they strengthen eligibility or feasibility.',
      }),
      item({
        key: 'budget_attachments',
        label: 'Budget Attachments',
        type: 'attachment',
        workflowMode: 'team_manual',
        templateIntent: 'budget',
        draftingVsSubmission: 'submission',
        supportLevel: 'manual',
        guidance: 'Attach detailed budget forms, quotations, or budget justification files when required.',
      }),
    ],
    evaluationCriteria: [
      item({
        key: 'fit_to_call',
        label: 'Fit to Call',
        type: 'rubric',
        templateIntent: 'alignment',
        guidance: 'Reviewers should see a clear match between the project and the funding call priorities.',
      }),
      item({
        key: 'significance_need',
        label: 'Significance and Need',
        type: 'rubric',
        templateIntent: 'problem_need',
        guidance: 'Reviewers should see a well-evidenced problem and a compelling reason to fund the work now.',
      }),
      item({
        key: 'methodological_feasibility',
        label: 'Methodological Feasibility',
        type: 'rubric',
        templateIntent: 'methodology',
        guidance: 'Reviewers should see a credible approach, feasible timeline, and practical delivery plan.',
      }),
      item({
        key: 'impact_value',
        label: 'Impact and Value',
        type: 'rubric',
        templateIntent: 'impact_outcomes',
        guidance: 'Reviewers should see meaningful outcomes, benefits, and value for the funder or beneficiaries.',
      }),
      item({
        key: 'team_capacity',
        label: 'Team Capacity',
        type: 'rubric',
        templateIntent: 'team',
        guidance: 'Reviewers should see that the team and partners can execute the proposed project.',
      }),
      item({
        key: 'budget_realism',
        label: 'Budget Realism',
        type: 'rubric',
        templateIntent: 'budget',
        guidance: 'Reviewers should see a realistic budget that matches the work plan and funder limits.',
      }),
    ],
    submissionRules: {
      notes: 'This is a generic drafting scaffold. Always verify final formatting, portal, attachments, and limits against the official call.',
      items: [
        item({
          key: 'follow_call_guidelines',
          label: 'Follow the official call guidelines',
          type: 'rule',
          workflowMode: 'team_manual',
          templateIntent: 'submission',
          draftingVsSubmission: 'both',
          supportLevel: 'manual',
          guidance: 'Before submission, verify all sections, limits, forms, eligibility declarations, and portal requirements against the official call.',
        }),
        item({
          key: 'respect_limits',
          label: 'Respect word, page, and file limits',
          type: 'rule',
          workflowMode: 'team_manual',
          templateIntent: 'submission',
          draftingVsSubmission: 'submission',
          supportLevel: 'manual',
          guidance: 'Check final word limits, page limits, file types, naming rules, and required signatures.',
        }),
        item({
          key: 'include_required_attachments',
          label: 'Include required attachments',
          type: 'checklist',
          workflowMode: 'team_manual',
          templateIntent: 'attachments',
          draftingVsSubmission: 'submission',
          supportLevel: 'manual',
          guidance: 'Confirm all required attachments are present before final submission.',
        }),
      ],
      sourceAnchors: [],
    },
    sourceAnchors: [],
    mergeConflicts: [],
  })
}
