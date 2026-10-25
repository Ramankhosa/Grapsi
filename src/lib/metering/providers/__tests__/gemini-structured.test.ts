import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiProvider } from '../gemini-provider'
import { EXTRACTION_SCHEMA } from '@/lib/monitor/extractionContract'
import type { LLMRequest } from '../../types'
const request:LLMRequest={taskCode:'FUNDING_CALL_INGEST',prompt:'Synthetic evidence',modelClass:'gemini-3.1-flash',parameters:{responseJsonSchema:EXTRACTION_SCHEMA,responseMimeType:'application/json',thinking_level:'low'},metadata:{executionPolicy:{maxProviderAttempts:1}}}
const provider=()=>new GeminiProvider({apiKey:'test-key',baseURL:'https://gemini.invalid',model:'gemini-3.1-flash'})
afterEach(()=>vi.unstubAllGlobals())
describe('Gemini extraction transport',()=>{
  it('sends a fully typed schema and thinking config inside generationConfig, omitting reasoning parts',async()=>{
    let body:Record<string,any>={}
    vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{body=JSON.parse(init.body);return new Response(JSON.stringify({candidates:[{content:{parts:[{thought:true,text:'private reasoning'},{text:'{"fields":{}}'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:8,thoughtsTokenCount:3}}),{status:200})}))
    const result=await provider().execute(request,{allowed:true,maxTokensOut:6000})
    expect(body.thinking_level).toBeUndefined();expect(body.generationConfig.thinkingConfig).toEqual({thinkingLevel:'low'})
    const fields=body.generationConfig.responseJsonSchema.properties.fields.properties
    for(const field of Object.values(fields) as any[])expect(field.properties.value.type).toBeDefined()
    expect(result.output).toBe('{"fields":{}}');expect(result.metadata?.thoughtTokens).toBe(3)
  })
  it('preserves definitive HTTP rejection and request id without a hidden retry',async()=>{
    const fetch=vi.fn(async()=>new Response(JSON.stringify({error:{status:'INVALID_ARGUMENT',message:'bad request'}}),{status:400,headers:{'x-request-id':'request-test'}}));vi.stubGlobal('fetch',fetch)
    await expect(provider().execute(request,{allowed:true})).rejects.toMatchObject({status:400,code:'INVALID_ARGUMENT',requestId:'request-test'})
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('retains billable usage for an empty output',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[]}}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:0,thoughtsTokenCount:30}}),{status:200})))
    await expect(provider().execute(request,{allowed:true})).rejects.toMatchObject({code:'EMPTY_RESPONSE',billableUsage:{inputTokens:20,thoughtTokens:30}})
  })
})
