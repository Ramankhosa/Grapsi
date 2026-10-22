import { NextRequest,NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { withCatalogueProtection,protectCatalogueAiContext } from '@/lib/catalogueProtection/guard'
import { requireCatalogueAdmin } from '@/lib/catalogueProtection/admin'
import { acceptCallAreaProposal } from '@/lib/researchAreas/store'
import { canonicalAreasEnabled } from '@/lib/researchAreas/core'
export const dynamic = 'force-dynamic'
export const runtime='nodejs'
export const GET=withCatalogueProtection(async(request:NextRequest)=>{
 const auth=await requireCatalogueAdmin(request);if('response'in auth)return auth.response
 if(!canonicalAreasEnabled())return NextResponse.json({error:'Research-area review is not enabled.'},{status:409})
 const page=Math.max(1,Math.min(1000,Number(request.nextUrl.searchParams.get('page'))||1))
 const rows=await prisma.$queryRaw<Array<{id:string;callId:string;title:string;scope:string;evidence:any;areas:any;hasManual:boolean}>>`
  SELECT d.id,d.entity_id AS "callId",coalesce(nullif(f.scheme_title,''),f.title) title,d.scope,d.evidence,
   coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'label',a.label)) FROM research_area_classification_links l JOIN catalogue_areas a ON a.id=l.area_id WHERE l.classification_id=d.id),'[]'::jsonb) areas,
   EXISTS(SELECT 1 FROM funding_call_research_area_taxonomies n WHERE n.funding_call_id=f.id AND n.source='manual') AS "hasManual"
  FROM research_area_classifications d JOIN funding_calls f ON f.id=d.entity_id
  WHERE d.entity_kind='CALL' AND d.status='PROPOSED' ORDER BY d.created_at,d.id LIMIT 20 OFFSET ${(page-1)*20}`
 const counts=await prisma.$queryRaw<Array<{count:number}>>`SELECT count(*)::int count FROM research_area_classifications WHERE entity_kind='CALL' AND status='PROPOSED'`
 return NextResponse.json({page,total:counts[0].count,proposals:rows.map(r=>({id:r.id,callId:r.callId,title:r.title,scope:r.scope,areas:r.areas,hasManual:r.hasManual,needsReview:Boolean(r.evidence.needsReview),reason:r.evidence.reason,quotes:(r.evidence.evidence||[]).map((e:any)=>e.quote)}))})
},'detail')
export const POST=withCatalogueProtection(async(request:NextRequest)=>{
 const auth=await requireCatalogueAdmin(request,true);if('response'in auth)return auth.response
 if(!canonicalAreasEnabled())return NextResponse.json({error:'Research-area review is not enabled.'},{status:409})
 const parsed=z.object({proposalIds:z.array(z.string().uuid()).min(1).max(20),confirmManual:z.boolean().default(false)}).safeParse(await request.json())
 if(!parsed.success)return NextResponse.json({error:'Choose up to 20 proposals to approve.'},{status:400})
 const outcomes=[]
 for(const id of [...new Set(parsed.data.proposalIds)]){
  try{
   const rows=await prisma.$queryRaw<Array<{entity_id:string}>>`SELECT entity_id FROM research_area_classifications WHERE id=${id} AND entity_kind='CALL'`
   if(!rows.length)throw new Error('Proposal not found')
   await protectCatalogueAiContext([rows[0].entity_id])
   outcomes.push({ok:true,...await acceptCallAreaProposal(id,auth.actor.id,{confirmManual:parsed.data.confirmManual,confirmReview:true,workflow:'intake'})})
  }catch(error){outcomes.push({id,ok:false,error:error instanceof Error?error.message:'Approval failed'})}
 }
 return NextResponse.json({outcomes})
},'detail')
