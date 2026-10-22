export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { directoryFilterSchema } from '@/lib/recommendations/directorySchema'
import { requireRecommendationUser,toRecommendationAccessScope } from '@/lib/recommendations/request-auth'
import { recommendationSearchService } from '@/lib/services/recommendationSearchService'
import prisma from '@/lib/prisma'
import { canonicalAreasEnabled } from '@/lib/researchAreas/core'
export const runtime='nodejs'
const schema=z.object({query:z.string().max(300).optional(),filters:directoryFilterSchema,q:z.string().max(120).optional(),page:z.number().int().min(1).max(1000).optional(),kind:z.enum(['discipline','subject']).optional(),ids:z.array(z.string().max(100)).max(50).optional(),useSaved:z.boolean().optional()})
export const POST=withCatalogueProtection(async(request:NextRequest)=>{
  const auth=await requireRecommendationUser(request);if('response'in auth)return auth.response
  const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Invalid area search.'},{status:400})
  if(parsed.data.useSaved){
    const rows=canonicalAreasEnabled()
      ?await prisma.$queryRaw<Array<{saved_id:string;label:string;area_id:string|null}>>`SELECT s.id saved_id,s.label,e.area_id FROM researcher_saved_research_areas s LEFT JOIN effective_saved_research_area_links e ON e.saved_area_id=s.id WHERE s.user_id=${auth.userId}`
      :await prisma.$queryRaw<Array<{saved_id:string;label:string;area_id:string|null}>>`SELECT s.id AS saved_id,s.label,c.imported_area_id AS area_id FROM researcher_saved_research_areas s LEFT JOIN catalogue_area_crosswalk c ON c.native_area_id=s.taxonomy_area_id AND c.approved_at IS NOT NULL AND c.relation IN ('exact','broader','narrower') WHERE s.user_id=${auth.userId}`
    const mapped=[...new Set(rows.filter(r=>r.area_id).map(r=>r.area_id!))]
    const unmapped=rows.filter(r=>!r.area_id).map(r=>r.label)
    return NextResponse.json({ids:mapped.slice(0,50),unmapped})
  }
  return NextResponse.json(await recommendationSearchService.catalogueOverview({query:parsed.data.query,filters:parsed.data.filters,access:toRecommendationAccessScope(auth.actor)},parsed.data))
},'metadata')
