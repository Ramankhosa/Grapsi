import { describe, expect, it, vi } from 'vitest'

const create = vi.fn(async (_params: unknown) => ({ name: 'batches/fixture' }))
const get = vi.fn(async (_params: unknown) => ({ state: 'JOB_STATE_SUCCEEDED', dest: { inlinedResponses: [
  { response: { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: '{"items":[]}' }] } }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 8, thoughtsTokenCount: 40 } } },
  { error: { message: 'quota' } },
] } }))
vi.mock('@google/genai', () => ({ GoogleGenAI: class { batches = { create, get, cancel: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/metering/providers/gemini-provider', () => ({ GEMINI_MODEL_ALIASES: { 'gemini-3.1-flash': 'gemini-3-flash-preview' }, GeminiProvider: class {} }))

import { geminiBatchClient } from '@/lib/monitor/paidBatch'

/** Gemini batch client (29 Oct 2026): the batch service ignores responseJsonSchema; responseSchema is enforced. */
describe('geminiBatchClient', () => {
  it('sends the schema as responseSchema, under the API model name, with low thinking', async () => {
    const schema = { type: 'object', properties: { items: { type: 'array' } }, required: ['items'] }
    await geminiBatchClient('fixture-key').create('gemini-3.1-flash', [{ prompt: 'Screen', schema, maxOutputTokens: 4800, members: [] }], 'label')
    const params = create.mock.calls[0][0] as { model: string; src: Array<{ config: Record<string, unknown> }> }
    expect(params.model).toBe('gemini-3-flash-preview')
    expect(params.src[0].config).toMatchObject({ responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: 4800, thinkingConfig: { thinkingLevel: 'LOW' } })
    expect(params.src[0].config).not.toHaveProperty('responseJsonSchema')
  })

  it('reads answers in request order, skipping thought parts and keeping per-request errors', async () => {
    const view = await geminiBatchClient('fixture-key').get('batches/fixture')
    expect(view.state).toBe('SUCCEEDED')
    expect(view.answers[0]).toEqual({ text: '{"items":[]}', usage: { inputTokens: 120, outputTokens: 8, thoughtTokens: 40 }, error: null })
    expect(view.answers[1]).toMatchObject({ text: null, error: 'quota' })
  })
})
