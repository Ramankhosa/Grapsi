import { describe, expect, it } from 'vitest'

import {
  buildStandardGrantApplicationTemplate,
  STANDARD_GRANT_TEMPLATE_FALLBACK_WARNING,
  STANDARD_GRANT_TEMPLATE_VERSION,
} from '@/lib/fundingTemplates/standardGrantTemplate'
import { buildCompatibilitySummary } from '@/lib/fundingTemplates/utils'
import { determineGrantPrepMode } from '@/lib/grantPrep/sessionState'
import { buildGrantPrepStageMapping } from '@/lib/grantPrep/templateMapper'

describe('standard grant application fallback template', () => {
  it('builds a normalized grant template with core proposal sections and budget support', () => {
    const template = buildStandardGrantApplicationTemplate()
    const sectionKeys = template.sections.map((section) => section.key)

    expect(sectionKeys).toEqual([
      'project_summary',
      'problem_need',
      'objectives',
      'funder_alignment',
      'methodology',
      'workplan',
      'innovation',
      'evaluation',
      'impact_outcomes',
      'team_capacity',
      'sustainability_risk',
    ])
    expect(template.budget?.required).toBe(true)
    expect(template.budget?.columns?.map((column) => column.key)).toEqual([
      'category',
      'amount',
      'justification',
    ])
    expect(template.attachments.map((attachment) => attachment.key)).toContain('cv_biosketches')
    expect(template.submissionRules.items.map((rule) => rule.key)).toContain('follow_call_guidelines')
  })

  it('carries fallback compatibility metadata and maps into Grant Prep stages', () => {
    const template = buildStandardGrantApplicationTemplate()
    const compatibility = buildCompatibilitySummary(template, [
      STANDARD_GRANT_TEMPLATE_FALLBACK_WARNING,
      `fallback_template_version:${STANDARD_GRANT_TEMPLATE_VERSION}`,
    ])
    const mapping = buildGrantPrepStageMapping(template)

    expect(compatibility.warnings).toContain(STANDARD_GRANT_TEMPLATE_FALLBACK_WARNING)
    expect(compatibility.warnings).toContain(`fallback_template_version:${STANDARD_GRANT_TEMPLATE_VERSION}`)
    expect(mapping.problem_definition.discussionPoints.some((point) => point.sourceTemplatePointer)).toBe(true)
    expect(mapping.methodology.discussionPoints.some((point) => point.sourceTemplatePointer)).toBe(true)
    expect(mapping.workplan.discussionPoints.some((point) => point.sourceTemplatePointer)).toBe(true)
    expect(mapping.budget_strategy.discussionPoints.some((point) => point.sourceTemplatePointer)).toBe(true)
  })

  it('puts funded calls with fallback template and guidelines on the template-driven path', () => {
    expect(determineGrantPrepMode({
      hasFundingCall: true,
      hasApprovedTemplate: true,
      hasApprovedGuidelines: true,
    })).toBe('template_driven')
  })
})
