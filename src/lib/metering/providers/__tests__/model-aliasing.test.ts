import { describe, expect, it } from 'vitest'
import { OpenAIProvider } from '../openai-provider'
import { GeminiProvider } from '../gemini-provider'
import { getProviderFromModelCode } from '../llm-provider'

describe('Provider model aliasing', () => {
  it('OpenAIProvider normalizes *-thinking to base model', () => {
    const p = new OpenAIProvider({
      apiKey: 'x',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-5.2-thinking'
    })

    expect(p.getTokenLimits('gpt-5.2-thinking')).toEqual(p.getTokenLimits('gpt-5.2'))
    expect(p.getCostPerToken('gpt-5.2-thinking')).toEqual(p.getCostPerToken('gpt-5.2'))
  })

  it('GeminiProvider maps gemini-3-pro-preview-thinking to gemini-3-pro-preview for limits/costs', () => {
    const p = new GeminiProvider({
      apiKey: 'x',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-3-pro-preview-thinking'
    })

    expect(p.getTokenLimits('gemini-3-pro-preview-thinking')).toEqual(p.getTokenLimits('gemini-3-pro-preview'))
    expect(p.getCostPerToken('gemini-3-pro-preview-thinking')).toEqual(p.getCostPerToken('gemini-3-pro-preview'))
  })

  it('GeminiProvider maps gemini-3.1-flash-image to the preview API model for limits/costs', () => {
    const p = new GeminiProvider({
      apiKey: 'x',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-3.1-flash-image'
    })

    expect(p.getTokenLimits('gemini-3.1-flash-image')).toEqual(p.getTokenLimits('gemini-3.1-flash-image-preview'))
    expect(p.getCostPerToken('gemini-3.1-flash-image')).toEqual(p.getCostPerToken('gemini-3.1-flash-image-preview'))
  })

  it('routes new model codes to the expected providers', () => {
    expect(getProviderFromModelCode('claude-opus-4.5')).toBe('anthropic')
    expect(getProviderFromModelCode('claude-opus-4.6')).toBe('anthropic')
    expect(getProviderFromModelCode('glm-5')).toBe('zhipu')
    expect(getProviderFromModelCode('glm-4.5v')).toBe('zhipu')
    expect(getProviderFromModelCode('qwen2.5-72b-instruct')).toBe('qwen')
    expect(getProviderFromModelCode('gemini-3.1-flash-image')).toBe('gemini')
  })
})
