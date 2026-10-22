import {afterEach,it,expect,vi} from 'vitest'
import {catalogueFetch} from '@/lib/catalogue-client'
afterEach(()=>vi.unstubAllGlobals())
it('queues discovery widgets within two concurrent requests without changing server allowances',async()=>{
 const releases:Array<(r:Response)=>void>=[]
 const fetcher=vi.fn(()=>new Promise<Response>(resolve=>releases.push(resolve)));vi.stubGlobal('fetch',fetcher)
 const requests=['/api/recommendations/manual-search','/api/recommendations/directory/facets','/api/recommendations/directory/areas','/api/recommendations/funders?q=research'].map(url=>catalogueFetch(url))
 expect(fetcher).toHaveBeenCalledTimes(2)
 releases[0](new Response('{}'));await requests[0];await Promise.resolve();expect(fetcher).toHaveBeenCalledTimes(3)
 releases[1](new Response('{}'));await requests[1];await Promise.resolve();expect(fetcher).toHaveBeenCalledTimes(4)
 releases[2](new Response('{}'));releases[3](new Response('{}'));await Promise.all(requests);await Promise.resolve()
})
it('keeps in-flight reservations accounted for when a view unmounts and drops queued cancelled work',async()=>{
 const releases:Array<(r:Response)=>void>=[];const fetcher=vi.fn((_url:string,_options?:RequestInit)=>new Promise<Response>(resolve=>releases.push(resolve)));vi.stubGlobal('fetch',fetcher)
 const controller=new AbortController();const first=catalogueFetch('/api/recommendations/directory/areas',{signal:controller.signal}),second=catalogueFetch('/api/recommendations/directory/statistics')
 const cancelled=new AbortController();const pending=catalogueFetch('/api/recommendations/directory/areas',{signal:cancelled.signal}).catch(error=>error)
 controller.abort();cancelled.abort();expect(fetcher.mock.calls[0][1]?.signal).toBeUndefined();expect(fetcher).toHaveBeenCalledTimes(2)
 releases[0](new Response('{}'));releases[1](new Response('{}'));await Promise.all([first,second]);expect((await pending).name).toBe('AbortError');expect(fetcher).toHaveBeenCalledTimes(2);await Promise.resolve()
})
