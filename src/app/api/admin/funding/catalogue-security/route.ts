export const dynamic = 'force-dynamic'
import { randomUUID } from 'node:crypto'
import { NextRequest,NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { requireCatalogueAdmin } from '@/lib/catalogueProtection/admin'
export const runtime='nodejs'
export async function GET(request:NextRequest){
  const auth=await requireCatalogueAdmin(request);if('response'in auth)return auth.response
  const user=request.nextUrl.searchParams.get('userId')?.slice(0,100)||''
  const [events,accounts,sessions]=await Promise.all([
    prisma.$queryRaw`SELECT e.id,e.user_id,u.email,e.kind,e.actor_id,e.detail,e.created_at FROM catalogue_security_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.kind<>'network_presence' AND (${user}='' OR e.user_id=${user}) ORDER BY e.created_at DESC LIMIT 100`,
    prisma.$queryRaw`SELECT a.*,u.email FROM catalogue_accounts a LEFT JOIN users u ON u.id=a.user_id WHERE (${user}='' OR a.user_id=${user}) ORDER BY a.restricted_until DESC NULLS LAST LIMIT 100`,
    user?prisma.$queryRaw`SELECT id,user_id,created_at,expires_at,revoked_at,user_agent FROM catalogue_sessions WHERE user_id=${user} ORDER BY created_at DESC LIMIT 20`:[],
  ])
  return NextResponse.json({events,accounts,sessions,behaviourEnforceAfter:process.env.CATALOGUE_BEHAVIOUR_ENFORCE_AFTER||null},{headers:{'Cache-Control':'private, no-store'}})
}
const schema=z.object({userId:z.string().min(1).max(100),action:z.enum(['unblock','override','reauth','revoke-session']),sessionId:z.string().max(100).optional(),multiplier:z.number().int().min(1).max(10).default(1),hours:z.number().int().min(1).max(24).default(24),reason:z.string().min(10).max(500)})
export async function POST(request:NextRequest){
  const auth=await requireCatalogueAdmin(request,true);if('response'in auth)return auth.response
  const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Provide a user, action and a reason of at least 10 characters.'},{status:400})
  const b=parsed.data
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`catalogue:${b.userId}`},0))::text`
    await tx.$executeRaw`INSERT INTO catalogue_accounts(user_id) VALUES(${b.userId}) ON CONFLICT DO NOTHING`
    if(b.action==='unblock')await tx.$executeRaw`UPDATE catalogue_accounts SET restricted_until=NULL,reason=NULL,reauth_after=NULL WHERE user_id=${b.userId}`
    if(b.action==='reauth')await tx.$executeRaw`UPDATE catalogue_accounts SET reauth_after=now(),reason='administrator_reauthentication' WHERE user_id=${b.userId}`
    if(b.action==='override')await tx.$executeRaw`UPDATE catalogue_accounts SET allowance_multiplier=${b.multiplier},allowance_until=now()+make_interval(hours=>${b.hours}::int) WHERE user_id=${b.userId}`
    if(b.action==='revoke-session'){
      if(!b.sessionId)throw new Error('Session required')
      await tx.$executeRaw`UPDATE catalogue_sessions SET revoked_at=now() WHERE id=${b.sessionId} AND user_id=${b.userId}`
      await tx.refreshToken.updateMany({where:{userId:b.userId,familyId:b.sessionId,isRevoked:false},data:{isRevoked:true,revokedAt:new Date(),revokedReason:'admin'}})
    }
    await tx.$executeRaw`INSERT INTO catalogue_security_events(id,user_id,kind,actor_id,detail) VALUES(${randomUUID()},${b.userId},${b.action},${auth.actor.id},${JSON.stringify({reason:b.reason,multiplier:b.multiplier,hours:b.hours,sessionId:b.sessionId})}::jsonb)`
  })
  return NextResponse.json({ok:true},{headers:{'Cache-Control':'private, no-store'}})
}
