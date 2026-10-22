import {beforeEach,describe,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const mocks=vi.hoisted(()=>({authenticate:vi.fn(),entitlement:vi.fn(),enforce:vi.fn(),permissions:vi.fn()}))
vi.mock('@/lib/auth-middleware',()=>({authenticateUser:mocks.authenticate}))
vi.mock('@/lib/entitlement-service',()=>({getActiveTenantEntitlement:mocks.entitlement}))
vi.mock('@/lib/service-access-middleware',()=>({enforceServiceAccess:mocks.enforce}))
vi.mock('@/lib/services/platformTeamRoleService',()=>({getUserPlatformPermissionCodes:mocks.permissions}))
import {requireFundingActor} from '@/lib/funding/access'
describe('strict catalogue entitlement',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.authenticate.mockResolvedValue({user:{id:'user',email:'researcher@example.invalid',roles:['ANALYST'],tenantId:'institution',tenant:{atiId:'LPU'}}});mocks.permissions.mockResolvedValue([]);mocks.enforce.mockResolvedValue({allowed:true})})
 const request=()=>new NextRequest('http://localhost/api/recommendations/manual-search')
 it.each(['missing','expired'])('rejects a %s current entitlement before legacy tolerance or automatic provisioning',async()=>{
  mocks.entitlement.mockResolvedValue(null);const result=await requireFundingActor(request(),{allowPlatform:true,strictEntitlement:true})
  expect('response'in result&&result.response.status).toBe(403);expect(mocks.enforce).not.toHaveBeenCalled()
 })
 it('rejects an active plan without the requested module',async()=>{
  mocks.entitlement.mockResolvedValue({plan:{planFeatures:[{feature:{code:'FUNDING_DISCOVERY'}}]}})
  const result=await requireFundingActor(request(),{allowPlatform:true,strictEntitlement:true,requiredServiceType:'FUNDING_CHAT'})
  expect('response'in result&&result.response.status).toBe(403)
 })
 it('preserves approved institutional access and still checks its service controls',async()=>{
  mocks.entitlement.mockResolvedValue({plan:{planFeatures:[{feature:{code:'FUNDING_DISCOVERY'}}]}})
  const result=await requireFundingActor(request(),{allowPlatform:true,strictEntitlement:true})
  expect('actor'in result).toBe(true);expect(mocks.enforce).toHaveBeenCalledWith('user','institution','FUNDING_DISCOVERY')
 })
 it('keeps the existing platform operator entitlement policy',async()=>{
  mocks.authenticate.mockResolvedValue({user:{id:'operator',roles:['SUPER_ADMIN'],tenantId:null}})
  expect('actor'in await requireFundingActor(request(),{allowPlatform:true,strictEntitlement:true})).toBe(true);expect(mocks.entitlement).not.toHaveBeenCalled()
 })
 it('preserves grant preparation bundled with institutional discovery access',async()=>{
  mocks.entitlement.mockResolvedValue({plan:{planFeatures:[{feature:{code:'FUNDING_DISCOVERY'}}]}})
  expect('actor'in await requireFundingActor(request(),{allowPlatform:true,strictEntitlement:true,requiredServiceType:'GRANT_PREP'})).toBe(true)
  expect(mocks.enforce).toHaveBeenCalledWith('user','institution','GRANT_PREP')
 })
})
