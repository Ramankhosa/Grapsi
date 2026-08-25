import { describe, expect, it } from 'vitest'

import { buildOpenAIChatRequest, DEFAULT_OPENAI_FALLBACK_MODEL } from '@/lib/openaiService'

const JSON_PROMPT = 'Return the analysis as JSON: { "score": 1 }'
const PLAIN_PROMPT = 'Summarise this section in two sentences.'

describe('buildOpenAIChatRequest', () => {
  it('uses max_completion_tokens and no sampling params for reasoning models', () => {
    for (const model of ['gpt-5.2', 'gpt-5-mini', 'o1', 'o3-mini']) {
      const request = buildOpenAIChatRequest(model, PLAIN_PROMPT, 'system')
      expect(request.max_completion_tokens).toBeGreaterThan(0)
      expect(request).not.toHaveProperty('max_tokens')
      expect(request).not.toHaveProperty('temperature')
      expect(request).not.toHaveProperty('top_p')
    }
  })

  it('keeps the legacy shape for non-reasoning models', () => {
    const request = buildOpenAIChatRequest('gpt-4o', PLAIN_PROMPT, 'system')
    expect(request.max_tokens).toBe(1500)
    expect(request.temperature).toBe(0.7)
    expect(request).not.toHaveProperty('max_completion_tokens')
  })

  it('honours the maxOutputTokens option', () => {
    expect(buildOpenAIChatRequest('gpt-5.2', PLAIN_PROMPT, 's', { maxOutputTokens: 8000 }).max_completion_tokens).toBe(8000)
    expect(buildOpenAIChatRequest('gpt-4o', PLAIN_PROMPT, 's', { maxOutputTokens: 2000 }).max_tokens).toBe(2000)
  })

  it('applies JSON response_format for gpt-5 and gpt-4 families on JSON prompts', () => {
    expect(buildOpenAIChatRequest('gpt-5.2', JSON_PROMPT, 's').response_format).toEqual({ type: 'json_object' })
    expect(buildOpenAIChatRequest('gpt-4o', JSON_PROMPT, 's').response_format).toEqual({ type: 'json_object' })
    expect(buildOpenAIChatRequest('gpt-5.2', 'no structured output here', 's')).not.toHaveProperty('response_format')
  })

  it('carries the system and user messages', () => {
    const request = buildOpenAIChatRequest('gpt-5.2', PLAIN_PROMPT, 'You are a reviewer.')
    expect(request.messages).toEqual([
      { role: 'system', content: 'You are a reviewer.' },
      { role: 'user', content: PLAIN_PROMPT },
    ])
  })

  it('defaults the fallback model to gpt-5.2 unless overridden by env', () => {
    if (!process.env.OPENAI_FALLBACK_MODEL) {
      expect(DEFAULT_OPENAI_FALLBACK_MODEL).toBe('gpt-5.2')
    } else {
      expect(DEFAULT_OPENAI_FALLBACK_MODEL).toBe(process.env.OPENAI_FALLBACK_MODEL)
    }
  })
})
