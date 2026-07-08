import { describe, expect, it } from 'vitest'

import { summarizeJsonArtifacts } from '@/lib/fundingIntake/jsonArtifactPreview'

describe('summarizeJsonArtifacts', () => {
  it('counts guideline rules and template items parked on the job metadata', () => {
    const preview = summarizeJsonArtifacts({
      json_artifacts: {
        guideline_pack_json: {
          priorities: [{ key: 'p1', text: 'Priority one' }],
          mustAddress: [
            { key: 'm1', text: 'Must one' },
            { key: 'm2', text: 'Must two' },
          ],
        },
        grant_template_json: {
          questions: [
            { key: 'q1', label: 'Question one', type: 'field', workflowMode: 'app_draft' },
            { key: 'q2', label: 'Question two', type: 'field', workflowMode: 'app_draft' },
          ],
        },
      },
    })

    expect(preview.guidelineRuleCount).toBe(3)
    expect(preview.templateItemCount).toBe(2)
    expect(preview.hasGuidelines).toBe(true)
    expect(preview.hasTemplate).toBe(true)
  })

  it('returns zeros for missing artifacts, empty objects, and null input', () => {
    expect(summarizeJsonArtifacts(null)).toEqual({
      guidelineRuleCount: 0,
      templateItemCount: 0,
      hasGuidelines: false,
      hasTemplate: false,
    })
    expect(summarizeJsonArtifacts({}).hasGuidelines).toBe(false)
    expect(summarizeJsonArtifacts({ json_artifacts: {} }).hasGuidelines).toBe(false)
    expect(summarizeJsonArtifacts('garbage').guidelineRuleCount).toBe(0)
  })

  it('tolerates malformed artifact payloads without throwing', () => {
    const preview = summarizeJsonArtifacts({
      json_artifacts: {
        guideline_pack_json: 'not a pack',
        grant_template_json: 42,
      },
    })
    expect(preview.guidelineRuleCount).toBe(0)
    expect(preview.templateItemCount).toBe(0)
  })
})
