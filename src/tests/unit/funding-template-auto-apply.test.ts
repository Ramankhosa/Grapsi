import { describe, expect, it } from 'vitest'

import { createEmptyGrantTemplate, hasTemplateItems, shouldAutoApplyExtraction } from '@/lib/fundingTemplates/utils'

function templateWith(block: string, value: unknown) {
  return { ...createEmptyGrantTemplate(), [block]: value }
}

const question = {
  key: 'q1',
  label: 'Project summary',
  type: 'field',
  workflowMode: 'app_draft',
}

describe('hasTemplateItems', () => {
  it('is false for empty or missing input', () => {
    expect(hasTemplateItems(createEmptyGrantTemplate())).toBe(false)
    expect(hasTemplateItems(null)).toBe(false)
    expect(hasTemplateItems(undefined)).toBe(false)
  })

  it('recognizes content in every block type', () => {
    expect(hasTemplateItems(templateWith('questions', [question]))).toBe(true)
    expect(hasTemplateItems(templateWith('sections', [{ ...question, type: 'section' }]))).toBe(true)
    expect(hasTemplateItems(templateWith('attachments', [{ ...question, type: 'attachment' }]))).toBe(true)
    expect(hasTemplateItems(templateWith('evaluationCriteria', [{ ...question, type: 'rubric' }]))).toBe(true)
    expect(
      hasTemplateItems(templateWith('submissionRules', { items: [{ ...question, type: 'rule' }] }))
    ).toBe(true)
    expect(
      hasTemplateItems(templateWith('budget', { required: true, yearWise: false, categories: [] }))
    ).toBe(true)
  })
})

describe('shouldAutoApplyExtraction', () => {
  const incoming = templateWith('questions', [question])

  it('auto-applies a non-empty run onto an empty current template', () => {
    expect(shouldAutoApplyExtraction(createEmptyGrantTemplate(), incoming)).toBe(true)
    expect(shouldAutoApplyExtraction(null, incoming)).toBe(true)
  })

  it('never auto-applies over an existing template with content', () => {
    const current = templateWith('sections', [{ ...question, type: 'section' }])
    expect(shouldAutoApplyExtraction(current, incoming)).toBe(false)
  })

  it('never auto-applies an empty run result', () => {
    expect(shouldAutoApplyExtraction(createEmptyGrantTemplate(), createEmptyGrantTemplate())).toBe(false)
    expect(shouldAutoApplyExtraction(null, null)).toBe(false)
  })
})
