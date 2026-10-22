import { describe,it,expect,vi } from 'vitest'
vi.mock('@/lib/funding/llmRouting',()=>({FUNDING_CHAT_TASK_CODE:'chat',FUNDING_CHAT_ORCHESTRATOR_STAGE_CODE:'parser',FUNDING_CHAT_NARRATIVE_STAGE_CODE:'narrative',runFundingGatewayText:vi.fn()}))
import { RecommendationConversationService } from '@/lib/services/recommendationConversationService'
import { conversationMessageFilterSchema } from '@/lib/recommendations/messageSchema'
import { createDefaultFilters } from '@/lib/recommendations/conversationUtils'
describe('chat filters follow the catalogue field contract',()=>{
 const area='scientify:discipline:known'
 const china="People's Republic of China"
 it('round trips new and existing controlled fields through the client schema',()=>{
  const filters={importedAreaIds:[area],lifecycleStatuses:['ROLLING'],funderIds:['funder123'],sdgGoals:['3'],programmeFrameworks:['Horizon Europe'],amountCurrency:'USD',includeUnknownAmount:true,noMembershipNeeded:true,eligibleCountries:['India']}
  expect(conversationMessageFilterSchema.parse(filters)).toEqual(filters)
  expect(conversationMessageFilterSchema.safeParse({lifecycleStatuses:['ACTIVE']}).success).toBe(false)
 })
 it('cleans automatic suggestions without discarding newer fields',()=>{
  const service=new RecommendationConversationService() as any
  const clean=service.cleanFilterPatch({importedAreaIds:[area,'invented'],lifecycleStatuses:['OPEN','nonsense'],funderIds:['funder123'],sdgGoals:['3','18'],programmeFrameworks:['Horizon Europe'],amountCurrency:'USD',includeUnknownAmount:true},'find funding')
  expect(clean.importedAreaIds).toEqual([area]);expect(clean.lifecycleStatuses).toEqual(['OPEN']);expect(clean.sdgGoals).toEqual(['3']);expect(clean.funderIds).toEqual(['funder123']);expect(clean.amountCurrency).toBe('USD');expect(clean.includeUnknownAmount).toBe(true)
 })
 it('does not accept invented imported IDs from a model response',()=>{
  const service=new RecommendationConversationService() as any
  const turn=service.processOrchestratorOutput({intent:'new_search',queryRewrite:'digital health',filterSuggestions:{importedAreaIds:[area,'scientify:discipline:invented'],lifecycleStatuses:['OPEN']}},{message:'digital health funding',state:{inputMode:'research_area',query:{researchArea:'digital health'},filters:createDefaultFilters(),filterMode:'auto'}},[{id:area,label:'Digital health'}])
  expect(turn.nextState.filters.importedAreaIds).toEqual([area])
 })
 it('uses consistent defaults and handles explicit closed/rolling requests',()=>{
  const filters=createDefaultFilters();expect(filters.lifecycleStatuses).toEqual(['OPEN','ROLLING'])
  const service=new RecommendationConversationService() as any
  expect(service.cleanFilterPatch({includeExpired:true},'include closed calls').lifecycleStatuses).toEqual([])
  expect(service.cleanFilterPatch({rollingOnly:true},'rolling calls only').lifecycleStatuses).toEqual(['ROLLING'])
 })
 it('empty model placeholders preserve active filters and the default lifecycle',()=>{
  const service=new RecommendationConversationService() as any
  const filters={...createDefaultFilters(),importedAreaIds:[area],eligibleCountries:['India']}
  const turn=service.processOrchestratorOutput({intent:'refine_filters',filterSuggestions:{importedAreaIds:[],eligibleCountries:[],lifecycleStatuses:[],funderIds:['invented']}},{message:'refine this search',state:{inputMode:'research_area',query:{researchArea:'health'},filters,filterMode:'auto'}})
  expect(turn.nextState.filters.importedAreaIds).toEqual([area]);expect(turn.nextState.filters.eligibleCountries).toEqual(['India']);expect(turn.nextState.filters.lifecycleStatuses).toEqual(['OPEN','ROLLING']);expect(turn.nextState.filters.funderIds).toEqual([])
 })
 const countryState=()=>({inputMode:'research_area',query:{researchArea:'digital health'},filters:{...createDefaultFilters(),eligibleCountries:['India'],fundingKinds:['Fellowship'],importedAreaIds:[area]},filterMode:'auto'})
 it.each(['now show calls for Chinese researchers','switch from India to China','replace India with China','Chinese researchers instead of Indian researchers','not India but China'])('replaces the previous audience and keeps the research topic: %s',message=>{
  const service=new RecommendationConversationService() as any
  const turn=service.parseTurnHeuristically({message,state:countryState(),latestRun:{id:'run',results:[]}})
  expect(turn.intent).toBe('refine_filters');expect(turn.nextState.filters.eligibleCountries).toEqual([china]);expect(turn.nextState.query).toEqual({researchArea:'digital health'});expect(turn.nextState.filters.importedAreaIds).toEqual([area]);expect(turn.nextState.filters.fundingKinds).toEqual(['Fellowship'])
 })
 it('adds an additional audience only when requested, and keeps host and applicant roles separate',()=>{
  const service=new RecommendationConversationService() as any
  expect(service.parseTurnHeuristically({message:'also include China',state:countryState(),latestRun:{id:'run',results:[]}}).nextState.filters.eligibleCountries).toEqual(['India',china])
  const turn=service.parseTurnHeuristically({message:'host in China',state:countryState(),latestRun:{id:'run',results:[]}})
  expect(turn.nextState.filters.eligibleCountries).toEqual(['India']);expect(turn.nextState.filters.hostCountries).toEqual([china])
  expect(service.parseTurnHeuristically({message:'Indian researchers hosted in Germany',state:countryState(),latestRun:{id:'run',results:[]}})).toBeNull()
 })
 it('overrides stale country suggestions from the model when the user explicitly switches audience',()=>{
  const service=new RecommendationConversationService() as any
  const turn=service.processOrchestratorOutput({intent:'refine_filters',filterSuggestions:{eligibleCountries:['India','China']}},{message:'now for Chinese researchers',state:countryState()})
  expect(turn.nextState.filters.eligibleCountries).toEqual([china])
 })
})
