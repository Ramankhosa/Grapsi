import { NextRequest,NextResponse } from 'next/server'
import { requireFundingActor } from '@/lib/funding/access'
import { verifyJWT } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { checkCatalogueSession } from './store'
import { catalogueError } from './guard'
import { CatalogueAccessError } from './policy'
export async function requireCatalogueAdmin(request:NextRequest,fresh=false){
  const auth=await requireFundingActor(request,{allowPlatform:true})
  if('response'in auth)return auth
  if(!auth.actor.isSuperAdminWriter)return {response:NextResponse.json({error:'Superadmin write access required.'},{status:403})}
  try{
    const sid=verifyJWT((request.headers.get('authorization')||'').replace(/^Bearer /,''))?.catalog_session
    if(!sid)throw new CatalogueAccessError('REAUTH_REQUIRED','Sign in again to manage catalogue security.',401)
    const session=await checkCatalogueSession({userId:auth.actor.id,sessionId:sid},prisma,true)
    if(fresh&&(session.authenticated_at.getTime()<Date.now()-300000||(session.reauth_after&&session.authenticated_at<session.reauth_after)))throw new CatalogueAccessError('REAUTH_REQUIRED','Sign in again before making security changes.',401)
  }catch(error){return {response:catalogueError(error)}}
  return auth
}
