import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { catalogueError,readBoundedCatalogueJson,withCatalogueProtection } from './guard'
import { verifyJWT } from '@/lib/auth'

/** Source-bound workspaces can read current catalogue text. Standalone work
 * keeps its existing feature access and is not subject to catalogue cooldowns.
 * The original handler still verifies project ownership on every request. */
export function withCatalogueSourceProtection<T>(handler:(request:NextRequest,arg:T)=>Promise<Response|undefined>){
  return async(request:NextRequest,arg?:T):Promise<Response>=>{
    try{
      // Let the original feature's authentication reject anonymous requests
      // before querying any source bindings.
      const bearer=request.headers.get('authorization')||''
      if(!bearer.startsWith('Bearer ')||!verifyJWT(bearer.slice(7)))return await handler(request,arg as T)||catalogueError(new Error('Missing response'))
      let id:string|null=null
      const prepId=/\/grant-prep\/sessions\/([^/]+)/.exec(request.nextUrl.pathname)?.[1]
      const grant=/\/projects\/([^/]+)\/grants\/([^/]+)/.exec(request.nextUrl.pathname)
      if(prepId){const row=await prisma.grantPrepSession.findUnique({where:{id:prepId},select:{funding_call_id:true}});id=row?.funding_call_id||null}
      else if(grant){const row=await prisma.grantPrepSession.findFirst({where:{project_id:grant[1],OR:[{id:grant[2]},{grant_session_id:grant[2]}]},select:{funding_call_id:true}});id=row?.funding_call_id||null}
      else if(request.headers.get('content-type')?.includes('application/json')){
        const body=await readBoundedCatalogueJson(request);id=typeof body?.fundingCallId==='string'?body.fundingCallId:null
      }
      if(!id&&request.method==='GET'){
        const project=/\/projects\/([^/]+)\/grants$/.exec(request.nextUrl.pathname)?.[1]
        if(project){const row=await prisma.grantPrepSession.findFirst({where:{project_id:project,funding_call_id:{not:null}},select:{funding_call_id:true}});id=row?.funding_call_id||null}
      }
      if(!id)return await handler(request,arg as T)||catalogueError(new Error('Missing response'))
      const source=await prisma.fundingCall.findUnique({where:{id},select:{source:true,import_run_id:true}})
      if(source?.source==='default-grant-format'&&!source.import_run_id)return await handler(request,arg as T)||catalogueError(new Error('Missing response'))
      return withCatalogueProtection(handler,'detail','GRANT_PREP',[id])(request,arg)
    }catch(error){return catalogueError(error)}
  }
}
