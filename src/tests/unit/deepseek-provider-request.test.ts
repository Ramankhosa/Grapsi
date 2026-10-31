import { describe, expect, it } from 'vitest'
import { DeepSeekProvider } from '@/lib/metering/providers/deepseek-provider'
import { outputTokensFor } from '@/lib/monitor/paidCall'

function sent(parameters: Record<string, unknown>, model = 'deepseek-v4-flash') {
  const provider = new DeepSeekProvider({ apiKey: 'test-key' } as never)
  let body: Record<string, unknown> = {}
  ;(provider as unknown as { client: unknown }).client = { chat: { completions: { create: async (params: Record<string, unknown>) => {
    body = params
    return { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
  } } } }
  return provider.execute({ modelClass: model, prompt: 'p', parameters } as never, { allowed: true, maxTokensOut: 100 } as never).then(() => body)
}

describe('DeepSeek request shape (30 Oct 2026)', () => {
  it('sends the thinking switch at the top level, where the API reads it', async () => {
    const on = await sent({})
    expect(on.thinking).toEqual({ type: 'enabled' })
    expect(on).not.toHaveProperty('extra_body')
    expect((await sent({ reasoning_effort: 'none' }, 'deepseek-v4-pro')).thinking).toEqual({ type: 'disabled' })
    expect(await sent({}, 'deepseek-v4-pro')).not.toHaveProperty('thinking')
  })
  it('asks for plain JSON instead of the json_schema mode the API refuses', async () => {
    expect((await sent({ response_format: { type: 'json_schema', json_schema: { name: 'x', schema: {} } } })).response_format).toEqual({ type: 'json_object' })
    expect((await sent({ response_format: { type: 'json_object' } })).response_format).toEqual({ type: 'json_object' })
  })
  it('gives V4 Flash room to think and leaves other models at the caller\'s limit', () => {
    expect(outputTokensFor('deepseek-v4-flash', 6000)).toBe(16000)
    expect(outputTokensFor('gpt-5.2', 6000)).toBe(6000)
  })
})
