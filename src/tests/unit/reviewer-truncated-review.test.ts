import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }))
vi.mock('@/lib/metering/gateway', () => ({ llmGateway: { executeLLMOperation: vi.fn() } }))
vi.mock('../../../lib/openaiService', () => ({
  generateFromOpenAI: vi.fn(),
  DEFAULT_OPENAI_FALLBACK_MODEL: 'gpt-5.2',
}))
vi.mock('../../../lib/geminiService', () => ({
  generateFromGemini: vi.fn(),
  generateFromGeminiWithFiles: vi.fn(),
  isGeminiRateLimitErrorLike: vi.fn(() => false),
  getGeminiRetryAfterMs: vi.fn(() => null),
}))

import { llmGateway } from '@/lib/metering/gateway'
import { reviewSection } from '../../../lib/reviewerService'

const gateway = llmGateway.executeLLMOperation as ReturnType<typeof vi.fn>

/** Queue the replies the model will give, in order. */
function modelReplies(...outputs: string[]) {
  gateway.mockReset()
  for (const output of outputs) {
    gateway.mockResolvedValueOnce({ success: true, response: { output } })
  }
}

const section = {
  id: 'sec-2',
  section_title: 'Methodology',
  user_input: 'We will deploy forty biosensors across six rural clinics.',
  version: 2,
  status: 'draft',
  previous_section_id: 'sec-1',
}

const previousSection = {
  id: 'sec-1',
  section_title: 'Methodology',
  user_input: 'We will deploy biosensors.',
  version: 1,
  status: 'reviewed',
  ai_review_json: {
    score: 5,
    weaknesses: ['No sample size', 'No site selection criteria'],
    suggestions: ['State the power calculation'],
  },
}

const callData = { project_title: 'Portable biosensors', description: 'Rural diagnostics call.' }

const review = (input: Record<string, unknown>) => reviewSection({
  section,
  previousSection,
  callData,
  modelType: 'G',
  callId: 'call-1',
  tenantContext: { tenantId: 't1', userId: 'u1' },
  ...input,
} as any)

beforeEach(() => {
  gateway.mockReset()
})

describe('reviewSection recovering a cut-off revision review', () => {
  it('keeps what the model finished saying instead of failing the whole call', async () => {
    // A revision review that ran into the stage's output ceiling while listing
    // the previous review's points — the shape users hit most often, because a
    // revision has to answer every earlier remark on top of a full review.
    modelReplies(`{
      "score": 7.5,
      "summary": "The revision names the clinics and adds a sample size.",
      "strengths": ["Sites are now named"],
      "weaknesses": ["Recruitment rate is still assumed"],
      "suggestions": ["State the expected recruitment rate"],
      "addressed_previous_points": [
        {"point": "No sample size", "status": "addressed", "evidence": "Section 3.2 gives n=240"},
        {"point": "No site selection criteria", "status": "partially", "evidence": "Six clinics are named but the`)

    const result = await review({})

    expect(gateway).toHaveBeenCalledTimes(1)
    expect(result.review.score).toBe(7.5)
    expect(result.review.summary).toContain('names the clinics')
    const addressed = (result.review as any).addressed_previous_points
    expect(addressed).toHaveLength(2)
    expect(addressed[0].status).toBe('addressed')
  })

  it('re-asks once for a compact answer when nothing survives the cut', async () => {
    modelReplies(
      'Here is my assessment of the revised methodology. The candidate has',
      '{"score": 6, "summary": "Adequate.", "strengths": [], "weaknesses": ["Thin analysis plan"], "suggestions": []}'
    )

    const result = await review({})

    expect(gateway).toHaveBeenCalledTimes(2)
    expect(result.review.score).toBe(6)
    expect(result.review.weaknesses).toEqual(['Thin analysis plan'])
  })

  it('tells the retry that the previous answer was cut off', async () => {
    modelReplies(
      'no json here',
      '{"score": 6, "summary": "Adequate."}'
    )

    await review({})

    const retryPrompt = String(gateway.mock.calls[1][1].prompt)
    expect(retryPrompt).toContain('YOUR PREVIOUS ANSWER WAS CUT OFF')
  })

  it('gives up after one retry rather than looping on the user money', async () => {
    modelReplies('still not json', 'and still not json')

    await expect(review({})).rejects.toThrow(/reviewer model/i)
    expect(gateway).toHaveBeenCalledTimes(2)
  })

  it('does not accept a salvage with no score and no summary', async () => {
    // Cut off inside the very first string: the repair yields `{}`, which would
    // otherwise be stored as a real review of score 0.
    modelReplies(
      '{"summary": "The revised methodology sets out a staged rollout that',
      '{"score": 5, "summary": "Adequate."}'
    )

    const result = await review({})

    expect(gateway).toHaveBeenCalledTimes(2)
    expect(result.review.score).toBe(5)
  })
})
