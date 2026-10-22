import { NextRequest,NextResponse } from 'next/server'
import { z } from 'zod'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { requireCatalogueAdmin } from '@/lib/catalogueProtection/admin'
import { canonicalAreasEnabled } from '@/lib/researchAreas/core'
import { acceptOrganisationProposal,generateOrganisationProposal,organisationReviewPage } from '@/lib/researchAreas/organisationReview'
export const runtime='nodejs'
export const dynamic = 'force-dynamic'
export const GET=withCatalogueProtection(async(request:NextRequest)=>{
 const auth=await requireCatalogueAdmin(request);if('response'in auth)return auth.response
 if(!canonicalAreasEnabled())return NextResponse.json({error:'Shared research areas are not enabled.'},{status:409})
 const page=Math.max(1,Math.min(10000,Number(request.nextUrl.searchParams.get('page'))||1))
 return NextResponse.json(await organisationReviewPage(page,(request.nextUrl.searchParams.get('tenantId')||'').slice(0,100)))
},'metadata')
export const POST=withCatalogueProtection(async(request:NextRequest)=>{
 const auth=await requireCatalogueAdmin(request,true);if('response'in auth)return auth.response
 if(!canonicalAreasEnabled())return NextResponse.json({error:'Shared research areas are not enabled.'},{status:409})
 const parsed=z.discriminatedUnion('action',[
  z.object({action:z.literal('generate'),unitId:z.string().min(1).max(100),acknowledgeCost:z.literal(true)}),
  z.object({action:z.literal('approve'),proposalIds:z.array(z.string().uuid()).min(1).max(5),confirmScope:z.literal(true)}),
 ]).safeParse(await request.json())
 if(!parsed.success)return NextResponse.json({error:'Choose units and acknowledge the displayed cost or scope review.'},{status:400})
 try{
  if(parsed.data.action==='generate')return NextResponse.json(await generateOrganisationProposal(parsed.data.unitId,auth.actor.id))
  const outcomes=[];for(const id of [...new Set(parsed.data.proposalIds)])try{outcomes.push({ok:true,...await acceptOrganisationProposal(id,auth.actor.id)})}catch(error){outcomes.push({id,ok:false,error:error instanceof Error?error.message:'Approval failed'})}
  return NextResponse.json({outcomes})
 }catch(error){console.error('Department area review failed',error);return NextResponse.json({error:'Department review could not finish. Settings may have changed or the model may be unavailable. Existing scope was preserved.'},{status:409})}
},'metadata','FUNDING_DISCOVERY',{generation:true})
