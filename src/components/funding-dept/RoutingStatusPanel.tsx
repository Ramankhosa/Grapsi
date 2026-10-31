'use client'
import { useEffect,useState } from 'react'
import { useAuth } from '@/lib/auth-context'

type Payload={summary:{pending:number;running:number;failed:number};rows:Array<{callId:string;title:string;status:string;attempts:number;lastError:string|null}>}
export default function RoutingStatusPanel() {
  const {authFetch}=useAuth()
  const [data,setData]=useState<Payload|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[busy,setBusy]=useState<string|null>(null)
  useEffect(()=>{
    let live=true
    authFetch('/api/funding-dept/routing').then(async response=>{
      const body=await response.json();if(!response.ok)throw Error(body.error || 'Routing status unavailable.')
      if(live){setData(body);setError('')}
    }).catch(e=>{if(live)setError(e.message)})
    return()=>{live=false}
  },[authFetch,revision])
  useEffect(()=>{if(!data || !(data.summary.pending+data.summary.running))return;const timer=setTimeout(()=>setRevision(r=>r+1),30000);return()=>clearTimeout(timer)},[data])
  async function retry(callId:string){setBusy(callId);setError('');try{const r=await authFetch('/api/funding-dept/routing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callId})});if(!r.ok)throw Error((await r.json()).error || 'Could not retry routing.');setRevision(v=>v+1)}catch(e){setError((e as Error).message)}finally{setBusy(null)}}
  return <section className="nk-panel space-y-3 p-4" aria-label="Call routing health">
    <div className="flex items-center justify-between"><h2 className="font-semibold">Call routing</h2><button className="nk-btn-secondary nk-btn-xs" onClick={()=>setRevision(v=>v+1)}>Refresh</button></div>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {data&&<><p className="nk-sub text-sm">{data.summary.pending} awaiting routing · {data.summary.running} processing · {data.summary.failed} need retry. The scheduled sweep retries failed work up to eight attempts. Existing deliveries are not sent twice.</p>
      {data.rows.map(row=><div key={row.callId} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"><div><a className="text-cobalt-700 underline" href={`/funding-dept/calls/${encodeURIComponent(row.callId)}`}>{row.title}</a><p className="nk-sub">{row.status==='FAILED'?'Needs attention':row.status==='RUNNING'?'Processing':'Awaiting routing'} · {row.attempts} attempts</p>{row.lastError&&<p className="text-amber-700">{row.lastError}</p>}</div>
        <button className="nk-btn-secondary nk-btn-xs" disabled={!!busy || row.status==='RUNNING'} onClick={()=>void retry(row.callId)}>{busy===row.callId?'Retrying…':'Retry routing'}</button></div>)}
      {!data.rows.length&&<p className="nk-sub text-sm">No pending routing jobs. Review unclassified calls and school coverage below for mapping gaps.</p>}</>}
  </section>
}
