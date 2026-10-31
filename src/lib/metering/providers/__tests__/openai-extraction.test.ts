import {afterEach,describe,expect,it,vi} from 'vitest'
import {OpenAIProvider} from '../openai-provider'
import {EXTRACTION_SCHEMA} from '@/lib/monitor/extractionContract'
afterEach(()=>vi.unstubAllGlobals())
describe('GPT-5.2 evidence extraction request',()=>{
 it('sends strict structured output with nullable fields, no reasoning and a bounded completion allowance',async()=>{
  let body:any
  vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{body=JSON.parse(init.body);return new Response(JSON.stringify({choices:[{message:{content:'{"fields":{}}'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:8,total_tokens:28}}),{status:200})}))
  const provider=new OpenAIProvider({apiKey:'test-key',baseURL:'https://api.openai.com/v1',model:'gpt-5.2'})
  await provider.execute({taskCode:'FUNDING_CALL_INGEST',prompt:'Extract cited source facts',modelClass:'gpt-5.2',parameters:{reasoning_effort:'none',response_format:{type:'json_schema',json_schema:{name:'funding_source_extraction',strict:true,schema:EXTRACTION_SCHEMA}}}},{allowed:true,maxTokensOut:6000})
  expect(body.model).toBe('gpt-5.2');expect(body.reasoning_effort).toBe('none');expect(body.max_completion_tokens).toBe(6000);expect(body.temperature).toBeUndefined();expect(body.response_format.json_schema.schema).toEqual(EXTRACTION_SCHEMA)
 })
})
