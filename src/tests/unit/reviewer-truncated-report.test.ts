import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/reviewer/auxLlm', () => ({ runReviewerAuxiliaryText: vi.fn() }))
vi.mock('../../../lib/openaiService', () => ({
  generateFromOpenAI: vi.fn(),
  DEFAULT_OPENAI_FALLBACK_MODEL: 'gpt-5.2',
}))
vi.mock('../../../lib/geminiService', () => ({
  generateFromGemini: vi.fn(),
  generateFromGeminiWithFiles: vi.fn(),
}))

import { runReviewerAuxiliaryText } from '@/lib/reviewer/auxLlm'
import { ReviewerService } from '../../../lib/services/reviewerService'

const model = runReviewerAuxiliaryText as ReturnType<typeof vi.fn>

function modelReplies(...outputs: string[]) {
  model.mockReset()
  for (const output of outputs) model.mockResolvedValueOnce(output)
}

const sectionSummaries = [
  {
    title: 'Methodology',
    version: 2,
    content: 'Forty biosensors across six clinics.',
    review_json: { score: 7, summary: 'Now specific.', weaknesses: ['Recruitment rate assumed'] },
  },
]

const generate = () => new ReviewerService().generateOverallReview(
  'Portable biosensors',
  'Rural diagnostics call.',
  sectionSummaries as any,
  'G',
  { owner: { tenantId: 't1', userId: 'u1' } }
)

beforeEach(() => {
  model.mockReset()
})

describe('panel report recovering a cut-off reply', () => {
  it('keeps the verdict when the reply is cut off inside priority_actions', async () => {
    modelReplies(`{
      "overall_score": 7.2,
      "funding_recommendation": {
        "decision": "fund_with_revisions",
        "competitiveness": "competitive",
        "rationale": "Strong method, thin costing."
      },
      "executive_summary": "A focused rural diagnostics proposal.",
      "major_strengths": ["Named sites"],
      "major_weaknesses": ["Recruitment rate assumed"],
      "priority_actions": [
        {"rank": 1, "section": "Methodology", "issue": "Recruitment rate", "action": "State it", "impact": "high", "effort": "quick"},
        {"rank": 2, "section": "Budget", "issue": "Consumables are a single line", "action": "Break the line`)

    const report = await generate()

    expect(model).toHaveBeenCalledTimes(1)
    expect(report.overall_score).toBe(7.2)
    expect(report.funding_recommendation.decision).toBe('fund_with_revisions')
    expect(report.executive_summary).toContain('rural diagnostics')
    expect(report.priority_actions.length).toBeGreaterThanOrEqual(1)
  })

  it('re-asks once when nothing survives, rather than failing the regeneration', async () => {
    modelReplies(
      'I have reviewed the sections and my overall judgement is',
      '{"overall_score": 6.5, "executive_summary": "Adequate but costly."}'
    )

    const report = await generate()

    expect(model).toHaveBeenCalledTimes(2)
    expect(report.overall_score).toBe(6.5)
    expect(String(model.mock.calls[1][0].prompt)).toContain('YOUR PREVIOUS ANSWER WAS CUT OFF')
  })

  it('refuses a salvage that lost the verdict, so a blank report is never stored', async () => {
    modelReplies(
      '{"criterion_scorecard": [{"criterion": "Excellence", "weight": 30',
      '{"overall_score": 5, "executive_summary": "Borderline."}'
    )

    const report = await generate()

    expect(model).toHaveBeenCalledTimes(2)
    expect(report.overall_score).toBe(5)
  })

  it('says the model ran out of room when both attempts were cut short', async () => {
    modelReplies('{"overall_score": 7, "executive', '{"overall_score": 7, "executive')

    await expect(generate()).rejects.toThrow(/ran out of room/i)
    expect(model).toHaveBeenCalledTimes(2)
  })
})
