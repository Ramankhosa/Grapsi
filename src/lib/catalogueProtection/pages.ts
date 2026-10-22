import type { NextApiRequest,NextApiResponse } from 'next'
import { NextRequest } from 'next/server'
import { withCatalogueProtection } from './guard'
import type { CatalogueMode } from './policy'
import type { ServiceType } from '@prisma/client'
/** Adapter for the remaining Pages Router JSON endpoints. */
export function withCataloguePagesProtection(handler:(req:NextApiRequest,res:NextApiResponse)=>Promise<unknown>,mode:CatalogueMode='summary',service:ServiceType='FUNDING_DISCOVERY'){
  return async(req:NextApiRequest,res:NextApiResponse)=>{
    const headers=new Headers();for(const[key,value]of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value)
    const request=new NextRequest(new URL(req.url||'/', 'http://127.0.0.1:3010'),{method:req.method,headers,...(req.method!=='GET'&&req.method!=='HEAD'?{body:JSON.stringify(req.body)}:{})})
    const protectedHandler=withCatalogueProtection(async()=>{
      let status=200,payload:unknown,finished=false;const responseHeaders=new Headers({'Content-Type':'application/json'})
      const proxy={status(code:number){status=code;return proxy},setHeader(key:string,value:string){responseHeaders.set(key,String(value));return proxy},json(value:unknown){payload=value;finished=true;return proxy},send(value:unknown){payload=value;finished=true;return proxy},end(){finished=true;return proxy}}
      await handler(req,proxy as unknown as NextApiResponse)
      if(!finished)throw new Error('Missing catalogue response')
      return new Response(JSON.stringify(payload??{}),{status,headers:responseHeaders})
    },mode,service)
    const response=await protectedHandler(request)
    response.headers.forEach((v,k)=>res.setHeader(k,v));res.status(response.status).send(await response.text())
  }
}
