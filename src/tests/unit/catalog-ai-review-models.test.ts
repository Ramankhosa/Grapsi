import { describe, expect, it } from 'vitest'
import { DEFAULT_REVIEW_MODEL, openAiReviewRequest, reviewModel, strictReviewSchema } from '@/lib/fundingCatalogImport/aiReviewModels'
import { estimateReview } from '@/lib/fundingCatalogImport/aiReview'
describe('review model selection', () => {
  it('defaults to GPT-5.4 mini and permits the economy model without arbitrary endpoints', () => {
    expect(DEFAULT_REVIEW_MODEL).toBe('gpt-5.4-mini')
    expect(reviewModel('gpt-5-mini').inputRate).toBe(.25)
    expect(() => reviewModel('https://arbitrary.example')).toThrow()
    expect(() => reviewModel('unsupported-model')).toThrow()
  })
  it('uses strict schemas with every object closed to extra properties', () => {
    const schema = strictReviewSchema()
    expect(schema.type).toBe('object')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.evidence.items.additionalProperties).toBe(false)
    expect(schema.properties.suggestedFacts.items.additionalProperties).toBe(false)
    expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort())
  })
  it('pins the requested model and budgets reasoning tokens without unsupported temperature', () => {
    const request = openAiReviewRequest('gpt-5-mini', { subject: 'untrusted text' }, 'unsupported quote')
    expect(request.model).toBe('gpt-5-mini')
    expect(request.reasoning_effort).toBe('medium')
    expect(request.max_completion_tokens).toBe(8192)
    expect(request).not.toHaveProperty('temperature')
    expect(request.messages[1].content).toContain('unsupported quote')
    expect(request.response_format.json_schema.strict).toBe(true)
  })
  it('updates estimates for the selected model', () => {
    const rows = [{ id: 'r', reason: 'READINESS_FAILED', subject_call_id: 'c', subject_call: { id: 'c', title: 'Call', disciplines: [] } }]
    expect(estimateReview(rows, 'gpt-5.4-mini').estimatedCostUsd).toBeGreaterThan(estimateReview(rows, 'gpt-5-mini').estimatedCostUsd)
  })
})
