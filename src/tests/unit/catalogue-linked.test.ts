import { beforeEach,describe,expect,it,vi } from 'vitest'
import { NextRequest,NextResponse } from 'next/server'
const mocks=vi.hoisted(()=>({jwt:vi.fn(),prep:vi.fn(),grant:vi.fn(),source:vi.fn(),protect:vi.fn()}))
vi.mock('@/lib/auth',()=>({verifyJWT:mocks.jwt}))
vi.mock('@/lib/prisma',()=>({default:{grantPrepSession:{findUnique:mocks.prep,findFirst:mocks.grant},fundingCall:{findUnique:mocks.source}}}))
vi.mock('@/lib/catalogueProtection/guard',()=>({catalogueError:()=>NextResponse.json({error:'unavailable'},{status:503}),readBoundedCatalogueJson:async(r:NextRequest)=>r.clone().json(),withCatalogueProtection:mocks.protect}))
import { withCatalogueSourceProtection } from '@/lib/catalogueProtection/linked'
describe('source-bound workspaces',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.jwt.mockReturnValue({sub:'user'});mocks.prep.mockResolvedValue({funding_call_id:'call'});mocks.source.mockResolvedValue({source:'catalog-import:scientify',import_run_id:'run'});mocks.protect.mockImplementation(handler=>handler)})
 it('applies the shared guard with the original feature entitlement before current call text is read',async()=>{
  const handler=vi.fn(async()=>NextResponse.json({ok:true}));await withCatalogueSourceProtection(handler)(new NextRequest('http://localhost/api/grant-prep/sessions/prep/message',{headers:{authorization:'Bearer test'}}))
  expect(mocks.protect).toHaveBeenCalledWith(handler,'detail','GRANT_PREP',['call']);expect(handler).toHaveBeenCalledOnce()
 })
 it('keeps standalone work independent of catalogue restrictions',async()=>{
  mocks.prep.mockResolvedValue({funding_call_id:null});const handler=vi.fn(async()=>NextResponse.json({ok:true}));await withCatalogueSourceProtection(handler)(new NextRequest('http://localhost/api/grant-prep/sessions/prep/message',{headers:{authorization:'Bearer test'}}))
  expect(mocks.protect).not.toHaveBeenCalled();expect(handler).toHaveBeenCalledOnce()
 })
 it('leaves anonymous rejection to existing authentication without looking up source IDs',async()=>{
  mocks.jwt.mockReturnValue(null);const handler=vi.fn(async()=>NextResponse.json({error:'unauthorised'},{status:401}));const response=await withCatalogueSourceProtection(handler)(new NextRequest('http://localhost/api/grant-prep/sessions/prep'))
  expect(response.status).toBe(401);expect(mocks.prep).not.toHaveBeenCalled()
 })
 it('keeps the private default grant scaffold independent of catalogue restrictions',async()=>{
  mocks.source.mockResolvedValue({source:'default-grant-format',import_run_id:null});const handler=vi.fn(async()=>NextResponse.json({ok:true}));await withCatalogueSourceProtection(handler)(new NextRequest('http://localhost/api/grant-prep/sessions/prep',{headers:{authorization:'Bearer test'}}));expect(mocks.protect).not.toHaveBeenCalled();expect(handler).toHaveBeenCalledOnce()
 })
 it('fails closed if a source binding cannot be checked',async()=>{
  mocks.prep.mockRejectedValue(new Error('DB offline'));const handler=vi.fn();const response=await withCatalogueSourceProtection(handler)(new NextRequest('http://localhost/api/grant-prep/sessions/prep',{headers:{authorization:'Bearer test'}}))
  expect(response.status).toBe(503);expect(handler).not.toHaveBeenCalled()
 })
})
