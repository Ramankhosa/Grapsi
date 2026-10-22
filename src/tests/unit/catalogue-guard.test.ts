import { beforeEach,describe,expect,it,vi } from 'vitest'
import { NextRequest,NextResponse } from 'next/server'
const mocks=vi.hoisted(()=>({auth:vi.fn(),jwt:vi.fn(),begin:vi.fn(),check:vi.fn(),reserve:vi.fn(),commit:vi.fn(),end:vi.fn(),find:vi.fn()}))
vi.mock('@/lib/auth',()=>({verifyJWT:mocks.jwt}))
vi.mock('@/lib/funding/access',()=>({requireFundingActor:mocks.auth}))
vi.mock('@/lib/fundingIntake/routeAuth',()=>({buildFundingCallAccessWhere:()=>({}),actorCanSeeTenantDrafts:async()=>false}))
vi.mock('@/lib/prisma',()=>({default:{fundingCall:{findMany:mocks.find}}}))
vi.mock('@/lib/catalogueProtection/store',()=>({beginCatalogueRequest:mocks.begin,checkCatalogueSession:mocks.check,reserveCatalogueExposure:mocks.reserve,commitCatalogueExposure:mocks.commit,endCatalogueRequest:mocks.end}))
import { protectCatalogueAiContext,withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { CatalogueAccessError } from '@/lib/catalogueProtection/policy'
const request=()=>new NextRequest('http://localhost/api/recommendations/manual-search',{method:'POST',headers:{authorization:'Bearer fake','content-type':'application/json'},body:'{}'})
describe('catalogue guard boundary',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({actor:{id:'user',tenantId:'tenant'}});mocks.jwt.mockReturnValue({sub:'user',catalog_session:'session'});mocks.begin.mockResolvedValue('lease');mocks.check.mockResolvedValue({});mocks.reserve.mockResolvedValue(undefined);mocks.commit.mockResolvedValue(undefined);mocks.end.mockResolvedValue(undefined);mocks.find.mockResolvedValue([{id:'call'}])})
 it('honours entitlement denial before session/quota work',async()=>{
  mocks.auth.mockResolvedValue({response:NextResponse.json({error:'Entitlement required'},{status:403})});const handler=vi.fn()
  expect((await withCatalogueProtection(handler)(request())).status).toBe(403);expect(handler).not.toHaveBeenCalled();expect(mocks.begin).not.toHaveBeenCalled()
  expect(mocks.auth).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({strictEntitlement:true}))
 })
 it('requires a server-tracked login rather than accepting a legacy bearer token',async()=>{
  mocks.jwt.mockReturnValue({sub:'user'});const handler=vi.fn();const response=await withCatalogueProtection(handler)(request())
  expect(response.status).toBe(401);expect((await response.json()).code).toBe('REAUTH_REQUIRED');expect(handler).not.toHaveBeenCalled()
 })
 it('reserves record exposure and strips hidden full text before responding',async()=>{
  const handler=vi.fn(async()=>NextResponse.json({results:[{id:'call',schemeTitle:'Title',description:'a'.repeat(900),metadata:{secret:true},fullDescription:'hidden'}]}))
  const response=await withCatalogueProtection(handler)(request());expect(response.status).toBe(200)
  const result=await response.json();expect(result.results[0].description).toHaveLength(320);expect(JSON.stringify(result)).not.toContain('hidden');expect(mocks.reserve).toHaveBeenCalledWith({userId:'user',sessionId:'session'},'lease',['call'],'summary');expect(response.headers.get('cache-control')).toBe('private, no-store');expect(mocks.end).toHaveBeenCalledWith('lease')
 })
 it('rejects cross-scope record IDs before data leaves the boundary',async()=>{
  mocks.find.mockResolvedValue([]);const response=await withCatalogueProtection(async()=>NextResponse.json({results:[{id:'call',schemeTitle:'private'}]}))(request())
  expect(response.status).toBe(404);expect(mocks.commit).not.toHaveBeenCalled()
 })
 it('fails closed on unavailable quota storage without leaking SQL errors',async()=>{
  mocks.begin.mockRejectedValue(new Error('SELECT secret FROM db'));const handler=vi.fn();const response=await withCatalogueProtection(handler)(request())
  expect(response.status).toBe(503);expect(await response.text()).not.toContain('SELECT');expect(handler).not.toHaveBeenCalled()
 })
 it('does not start handler work after an exhausted shared allowance',async()=>{
  mocks.begin.mockRejectedValue(new CatalogueAccessError('REQUEST_LIMIT','Please wait.'));const handler=vi.fn()
  const response=await withCatalogueProtection(handler)(request());expect(response.status).toBe(429);expect(handler).not.toHaveBeenCalled();expect(response.headers.get('retry-after')).toBeTruthy()
 })
 it('stops an SSE response when its session is revoked',async()=>{
  mocks.check.mockRejectedValue(new CatalogueAccessError('REAUTH_REQUIRED','Revoked',401))
  const encoder=new TextEncoder();const handler=async()=>new Response(new ReadableStream({start(c){c.enqueue(encoder.encode('event: token\ndata: {"token":"never release this"}\n\n'));c.close()}}),{headers:{'content-type':'text/event-stream'}})
  const response=await withCatalogueProtection(handler,'ai')(request());const text=await response.text()
  expect(text).not.toContain('never release this');expect(text).toContain('REAUTH_REQUIRED');expect(mocks.end).toHaveBeenCalled()
 })
 it('does not expose call text or database diagnostics through an error response',async()=>{
  const response=await withCatalogueProtection(async()=>NextResponse.json({message:'Prisma SELECT secret FROM users',call:{id:'call',schemeTitle:'Title',fullDescription:'PRIVATE'}},{status:400}))(request())
  const text=await response.text();expect(text).not.toContain('SELECT');expect(text).not.toContain('PRIVATE');expect(mocks.commit).not.toHaveBeenCalled();expect(mocks.end).toHaveBeenCalledWith('lease')
 })
 it.each([new CatalogueAccessError('DETAIL_1_DAY_LIMIT','Viewing allowance reached.'),new Error('private PostgreSQL connection details')])('cannot swallow an internal AI retrieval policy failure and return a fallback',async error=>{
  mocks.reserve.mockRejectedValueOnce(error)
  const response=await withCatalogueProtection(async()=>{try{await protectCatalogueAiContext(['call'])}catch{/* A business fallback must not override a security failure. */}return NextResponse.json({answer:'do not release this'})},'ai')(request())
  expect(response.status).toBe(error instanceof CatalogueAccessError?429:503);const text=await response.text();expect(text).not.toContain('do not release this');expect(text).not.toContain('PostgreSQL');expect(mocks.commit).not.toHaveBeenCalled()
 })
})
