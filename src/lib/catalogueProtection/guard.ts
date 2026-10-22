import { buildFundingCallAccessWhere, actorCanSeeTenantDrafts } from '@/lib/fundingIntake/routeAuth'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import type { ServiceType } from '@prisma/client'
import prisma from '@/lib/prisma'
import { verifyJWT } from '@/lib/auth'
import { requireFundingActor, type FundingActor } from '@/lib/funding/access'
import { CatalogueAccessError, type CatalogueMode } from './policy'
import { beginCatalogueRequest, checkCatalogueSession, reserveCatalogueExposure, commitCatalogueExposure, endCatalogueRequest, type CataloguePrincipal } from './store'
import { sanitizeCatalogueResponse } from './response'

interface Context { principal:CataloguePrincipal; actor:FundingActor; leaseId:string; failure?:CatalogueAccessError }
const context=new AsyncLocalStorage<Context>()
export async function readBoundedCatalogueJson(request:NextRequest){
  if(!request.headers.get('content-type')?.includes('application/json'))return null
  if(Number(request.headers.get('content-length')||0)>65536)throw new CatalogueAccessError('REQUEST_TOO_LARGE','Funding request is too large.',413)
  const reader=request.clone().body?.getReader();if(!reader)return null
  const chunks:Uint8Array[]=[];let bytes=0
  for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>65536){void reader.cancel().catch(()=>{});throw new CatalogueAccessError('REQUEST_TOO_LARGE','Funding request is too large.',413)}chunks.push(chunk.value)}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return null}
}
async function authorizeIds(c:Context,ids:string[]) {
  if(!ids.length)return
  const visible=buildFundingCallAccessWhere(c.actor,{includeCatalog:true,includeTenantDrafts:await actorCanSeeTenantDrafts(c.actor)})
  // An empty platform scope means all records. In Prisma, adding that empty
  // object to an OR beside an owner predicate can discard the platform scope.
  const scope=Object.keys(visible).length?{OR:[visible,...(c.actor.tenantId?[{tenantId:c.actor.tenantId,visibility:'TENANT_PRIVATE' as const,createdByUserId:c.actor.id}]:[])]}:visible
  const rows=await prisma.fundingCall.findMany({where:{AND:[{id:{in:ids}},scope]},select:{id:true}})
  if(rows.length!==new Set(ids).size)throw new CatalogueAccessError('NOT_FOUND','Funding call not found.',404)
}
/** Call before sending full call text into any user-facing model context. */
export async function protectCatalogueAiContext(ids:string[]) {
  const c=context.getStore();if(!c)return // Offline operator jobs have their own explicit authorisation.
  if(c.failure)throw c.failure
  try{
    await authorizeIds(c,ids);await reserveCatalogueExposure(c.principal,c.leaseId,ids,'detail')
    await checkCatalogueSession(c.principal)
  }catch(error){c.failure=error instanceof CatalogueAccessError?error:new CatalogueAccessError('CATALOGUE_UNAVAILABLE','Funding access is temporarily unavailable. Please try again.',503,30);throw c.failure}
}
export async function assertCatalogueStreamActive() {
  const c=context.getStore();if(!c)return
  if(c.failure)throw c.failure
  try{await checkCatalogueSession(c.principal)}catch(error){c.failure=error instanceof CatalogueAccessError?error:new CatalogueAccessError('CATALOGUE_UNAVAILABLE','Funding access is temporarily unavailable. Please try again.',503,30);throw c.failure}
}
export function catalogueError(error:unknown) {
  const known=error instanceof CatalogueAccessError
  return NextResponse.json({error:known?error.message:'Funding access is temporarily unavailable. Please try again.',code:known?error.code:'CATALOGUE_UNAVAILABLE'},
    {status:known?error.status:503,headers:{'Cache-Control':'private, no-store','Retry-After':String(known?error.retryAfter:30)}})
}

/** Every catalogue-serving route is registered in the coverage manifest. */
export function withCatalogueProtection<T>(handler:(request:NextRequest,arg:T)=>Promise<Response|undefined>,mode:CatalogueMode='summary',service:ServiceType='FUNDING_DISCOVERY',options:string[]|{linkedIds?:string[];generation?:boolean}=[] ) {
  const linkedIds=Array.isArray(options)?options:options.linkedIds||[]
  return async(request:NextRequest,arg?:T):Promise<Response>=>{
    let c:Context|undefined
    try{
      const auth=await requireFundingActor(request,{allowPlatform:true,requiredServiceType:service,strictEntitlement:true})
      if('response'in auth){const headers=new Headers(auth.response.headers);headers.set('Cache-Control','private, no-store');return new Response(auth.response.body,{status:auth.response.status,headers})}
      const token=verifyJWT((request.headers.get('authorization')||'').replace(/^Bearer /,''))
      if(!token?.catalog_session)throw new CatalogueAccessError('REAUTH_REQUIRED','Please sign in again to access funding calls.',401)
      const principal={userId:auth.actor.id,sessionId:token.catalog_session}
      const body=await readBoundedCatalogueJson(request)
      const network=request.headers.get('x-real-ip')||''
      // Only Nginx supplies this header after the app is bound to loopback.
      // Rotating HMAC tags support investigation, never IP-only suspension.
      const salt=process.env.CATALOGUE_SIGNAL_SALT||process.env.JWT_SECRET
      const networkTag=network&&salt?createHmac('sha256',salt).update(`${Math.floor(Date.now()/604800000)}:${network}`).digest('hex').slice(0,24):undefined
      const leaseId=await beginCatalogueRequest(principal,mode==='ai'||(!Array.isArray(options)&&options.generation)?'ai':mode==='summary'?'search':mode,{page:Number(body?.page||request.nextUrl.searchParams.get('page')||1),networkTag})
      c={principal,actor:auth.actor,leaseId}
      const state=c
      return await context.run(state,async()=>{
        // IDs in detail URLs and request bodies are checked before a model or
        // handler can see their text. Handler-specific authorisation still runs.
        const candidatePathId=/\/calls\/([^/]+)/.exec(request.nextUrl.pathname)?.[1]
        const pathId=candidatePathId==='delete-all'?undefined:candidatePathId
        const bodyId=body?.fundingCallId||body?.callId||body?.anchorFundingCallId||request.nextUrl.searchParams.get('fundingCallId')||request.nextUrl.searchParams.get('callId')
        const requested=[...new Set([...linkedIds,pathId,typeof bodyId==='string'?bodyId:null].filter(Boolean))] as string[]
        if(requested.length){await authorizeIds(state,requested);if(mode==='detail'||mode==='ai')await reserveCatalogueExposure(principal,leaseId,requested,'detail')}
        const response=await handler(request,arg as T)
        if(state.failure)throw state.failure
        if(!response)throw new Error('Missing funding response')
        const headers=new Headers(response.headers);headers.set('Cache-Control','private, no-store');headers.set('X-Content-Type-Options','nosniff')
        if(response.status>=400){
          const raw=await response.json().catch(()=>({})),safe:Record<string,string>={}
          if(response.status<500)for(const key of ['error','message','code','reason','resetAt']){
            const value=raw[key]
            if(typeof value==='string'&&!/Prisma|\b(?:SELECT|INSERT|UPDATE|DELETE)\s+(?:FROM|INTO|\w+\s+SET)|DATABASE_URL|postgres(?:ql)?:|sk-[A-Za-z0-9]{12}|AIza[\w-]{15}|\/var\/www|\bat\s+\w+.*:\d+:\d+/i.test(value))safe[key]=value.slice(0,1000)
          }
          if(!safe.error&&!safe.message)safe.error='Funding request could not be completed.'
          await endCatalogueRequest(leaseId);headers.set('Content-Type','application/json');headers.delete('content-length')
          return new Response(JSON.stringify(safe),{status:response.status,headers})
        }
        const process=async(value:any)=>{
          if(state.failure)throw state.failure
          const safe=sanitizeCatalogueResponse(value,mode,service==='GRANT_PREP'||service==='GRANT_REVIEW')
          await authorizeIds(state,safe.callIds)
          await reserveCatalogueExposure(principal,leaseId,safe.callIds,mode==='detail'?'detail':'summary')
          const text=JSON.stringify(safe.value);await commitCatalogueExposure(principal,leaseId,Buffer.byteLength(text));return text
        }
        if(headers.get('content-type')?.includes('text/event-stream')&&response.body){
          const reader=response.body.getReader(),decoder=new TextDecoder(),encoder=new TextEncoder();let pending=''
          const stream=new ReadableStream({
            async pull(controller){
              try{
                await checkCatalogueSession(principal)
                const {value,done}=await reader.read();pending+=decoder.decode(value,{stream:!done})
                if(pending.length>2_000_000)throw new CatalogueAccessError('RESPONSE_TOO_LARGE','Funding response is too large.',413)
                let boundary:number
                while((boundary=pending.indexOf('\n\n'))>=0){
                  const event=pending.slice(0,boundary);pending=pending.slice(boundary+2)
                  const lines=[]
                  for(const line of event.split('\n')){
                    if(line.startsWith('data:')){const data=line.slice(5).trim();lines.push(data==='[DONE]'?line:`data: ${await process(JSON.parse(data))}`)}else lines.push(line)
                  }
                  controller.enqueue(encoder.encode(lines.join('\n')+'\n\n'))
                }
                if(done){await endCatalogueRequest(leaseId);controller.close()}
              }catch(error){await reader.cancel().catch(()=>{});await endCatalogueRequest(leaseId);controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({error:'Funding stream stopped. Please refresh or sign in again.',code:error instanceof CatalogueAccessError?error.code:'CATALOGUE_UNAVAILABLE'})}\n\n`));controller.close()}
            },async cancel(){await reader.cancel();await endCatalogueRequest(leaseId)},
          })
          return new Response(stream,{status:response.status,headers})
        }
        if(!headers.get('content-type')?.includes('json'))throw new CatalogueAccessError('DOWNLOAD_RESTRICTED','Bulk funding downloads are restricted.',403)
        const output=await process(await response.json());await endCatalogueRequest(leaseId)
        headers.delete('content-length');return new Response(output,{status:response.status,headers})
      })
    }catch(error){if(c)await endCatalogueRequest(c.leaseId).catch(()=>{});return catalogueError(error)}
  }
}
