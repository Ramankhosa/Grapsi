export const dynamic = 'force-dynamic'
import { randomUUID } from 'node:crypto'
import { NextRequest,NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { requireCatalogueAdmin } from '@/lib/catalogueProtection/admin'
export const runtime='nodejs'
export async function GET(request:NextRequest){
  const auth=await requireCatalogueAdmin(request);if('response'in auth)return auth.response
  const q=(request.nextUrl.searchParams.get('q')||'').slice(0,120)
  const [native,imported,mappings]=await Promise.all([
    prisma.$queryRaw`SELECT id,level1_name,level2_name FROM research_area_taxonomy_areas WHERE is_active=true ORDER BY level1_code,level2_code LIMIT 100`,
    prisma.$queryRaw`SELECT id,label,kind FROM catalogue_areas WHERE position(lower(${q}) in lower(label))>0 ORDER BY label,id LIMIT 50`,
    prisma.$queryRaw`SELECT c.*,a.label FROM catalogue_area_crosswalk c JOIN catalogue_areas a ON a.id=c.imported_area_id ORDER BY c.approved_at DESC NULLS LAST LIMIT 100`,
  ])
  return NextResponse.json({native,imported,mappings},{headers:{'Cache-Control':'private, no-store'}})
}
export async function POST(request:NextRequest){
  const auth=await requireCatalogueAdmin(request,true);if('response'in auth)return auth.response
  const p=z.object({nativeAreaId:z.string().min(1).max(100),importedAreaId:z.string().min(1).max(100),relation:z.enum(['exact','broader','narrower','unresolved']),note:z.string().min(10).max(500)}).safeParse(await request.json().catch(()=>null))
  if(!p.success)return NextResponse.json({error:'Select both areas, relation and a review note.'},{status:400})
  const b=p.data
  await prisma.$transaction(async tx=>{
    const native=await tx.researchAreaTaxonomyArea.findUnique({where:{id:b.nativeAreaId}});if(!native)throw new Error('Unknown native area')
    await tx.$executeRaw`INSERT INTO catalogue_area_crosswalk(native_area_id,imported_area_id,relation,approved_by,approved_at) VALUES(${b.nativeAreaId},${b.importedAreaId},${b.relation},${auth.actor.id},CASE WHEN ${b.relation}='unresolved' THEN NULL ELSE now() END) ON CONFLICT(native_area_id,imported_area_id) DO UPDATE SET relation=EXCLUDED.relation,approved_by=EXCLUDED.approved_by,approved_at=EXCLUDED.approved_at`
    await tx.$executeRaw`INSERT INTO catalogue_security_events(id,user_id,kind,actor_id,detail) VALUES(${randomUUID()},${auth.actor.id},'area_mapping',${auth.actor.id},${JSON.stringify(b)}::jsonb)`
  })
  return NextResponse.json({ok:true})
}
