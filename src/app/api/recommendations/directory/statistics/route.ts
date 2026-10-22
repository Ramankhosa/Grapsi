export const dynamic = 'force-dynamic'
import { NextRequest,NextResponse } from 'next/server'
import { z } from 'zod'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { directoryFilterSchema } from '@/lib/recommendations/directorySchema'
import { requireRecommendationUser,toRecommendationAccessScope } from '@/lib/recommendations/request-auth'
import { recommendationSearchService } from '@/lib/services/recommendationSearchService'
export const runtime='nodejs'
export const POST=withCatalogueProtection(async(request:NextRequest)=>{
  const auth=await requireRecommendationUser(request);if('response'in auth)return auth.response
  const parsed=z.object({query:z.string().max(300).optional(),filters:directoryFilterSchema}).safeParse(await request.json().catch(()=>null))
  if(!parsed.success)return NextResponse.json({error:'Invalid statistics request.'},{status:400})
  return NextResponse.json(await recommendationSearchService.catalogueOverview({...parsed.data,access:toRecommendationAccessScope(auth.actor)}))
},'metadata')
