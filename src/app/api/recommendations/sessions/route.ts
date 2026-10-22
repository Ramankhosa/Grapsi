export const dynamic = 'force-dynamic'
import { randomUUID } from 'node:crypto'
import { NextRequest,NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { verifyJWT } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { checkCatalogueSession } from '@/lib/catalogueProtection/store'
export const runtime='nodejs'
async function identity(request:NextRequest){const auth=await authenticateUser(request);if(auth.error)return null;const sid=verifyJWT((request.headers.get('authorization')||'').replace(/^Bearer /,''))?.catalog_session;if(!sid)return null;try{await checkCatalogueSession({userId:auth.user.id,sessionId:sid},prisma,true)}catch{return null}return {userId:auth.user.id,sid}}
export async function GET(request:NextRequest){
  const who=await identity(request);if(!who)return NextResponse.json({error:'Sign in required.',code:'REAUTH_REQUIRED'},{status:401})
  const [sessions,restrictions,exposure]=await Promise.all([
    prisma.$queryRaw`SELECT id,created_at,authenticated_at,expires_at,user_agent,id=${who.sid||''} AS current FROM catalogue_sessions WHERE user_id=${who.userId} AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC`,
    prisma.$queryRaw`SELECT restricted_until,reason,allowance_multiplier,allowance_until FROM catalogue_accounts WHERE user_id=${who.userId}`,
    prisma.$queryRaw`SELECT kind,count(DISTINCT call_id)::int AS count FROM catalogue_exposures WHERE user_id=${who.userId} AND seen_at>now()-interval '1 day' GROUP BY kind`,
  ])
  return NextResponse.json({sessions,restrictions,exposure},{headers:{'Cache-Control':'private, no-store'}})
}
export async function DELETE(request:NextRequest){
  const who=await identity(request);if(!who)return NextResponse.json({error:'Sign in required.',code:'REAUTH_REQUIRED'},{status:401})
  const body=await request.json().catch(()=>null);if(typeof body?.id!=='string'||body.id.length>100)return NextResponse.json({error:'Select a session.'},{status:400})
  await prisma.$transaction(async tx=>{
    await tx.$executeRaw`UPDATE catalogue_sessions SET revoked_at=now() WHERE user_id=${who.userId} AND id=${body.id}`
    await tx.refreshToken.updateMany({where:{userId:who.userId,familyId:body.id,isRevoked:false},data:{isRevoked:true,revokedAt:new Date(),revokedReason:'logout'}})
    await tx.$executeRaw`INSERT INTO catalogue_security_events(id,user_id,kind,actor_id) VALUES(${randomUUID()},${who.userId},'session_revoke',${who.userId})`
  })
  return NextResponse.json({ok:true},{headers:{'Cache-Control':'private, no-store'}})
}
