import { useEffect,useRef,useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import type { RecommendationSearchFilters } from '@/lib/recommendations/types'
export default function ImportedAreaPicker<T extends RecommendationSearchFilters>({filters,query,onChange}:{filters:T;query:string;onChange:(value:T)=>void}){
  const {authFetch}=useAuth()
  const [q,setQ]=useState(''),[page,setPage]=useState(1),[kind,setKind]=useState('discipline')
  const [data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [labels,setLabels]=useState<Record<string,string>>({}),[stats,setStats]=useState<any>(null)
  const selectedIds=filters.importedAreaIds||[]
  const serialized=JSON.stringify(filters)
  const statsKeyRef=useRef('')
  useEffect(()=>{
    const abort=new AbortController();const timer=setTimeout(async()=>{
      setBusy(true);setError('')
      try{
        const response=await authFetch('/api/recommendations/directory/areas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,filters,q,page,kind,ids:filters.importedAreaIds}),signal:abort.signal})
        const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not load research areas.')
        if(!abort.signal.aborted){setData(result);setLabels(old=>({...old,...Object.fromEntries([...result.areas,...result.selected].map((a:any)=>[a.id,a.label]))}))}
        const statsKey=serialized+'|'+query
        if(!abort.signal.aborted&&statsKeyRef.current!==statsKey){
          const r=await authFetch('/api/recommendations/directory/statistics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,filters}),signal:abort.signal})
          if(r.ok&&!abort.signal.aborted){setStats(await r.json());statsKeyRef.current=statsKey}
        }
      }catch(e:any){if(!abort.signal.aborted)setError(e.message)}finally{if(!abort.signal.aborted)setBusy(false)}
    },400)
    return()=>{clearTimeout(timer);abort.abort()}
    // serialized captures all changes without issuing requests on render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[authFetch,serialized,query,q,page,kind])
  const toggle=(id:string)=>onChange({...filters,importedAreaIds:selectedIds.includes(id)?selectedIds.filter(x=>x!==id):[...selectedIds,id]})
  async function useSaved(){
    setBusy(true);try{const r=await authFetch('/api/recommendations/directory/areas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({useSaved:true})});const value=await r.json();if(!r.ok)throw new Error(value.error);if(value.ids.length)onChange({...filters,importedAreaIds:value.ids});setError(value.unmapped.length?`Please choose imported areas for these previous selections: ${value.unmapped.join(', ')}`:value.ids.length?'':'No approved area mappings yet. Choose areas below.')}catch(e:any){setError(e.message)}finally{setBusy(false)}
  }
  return <section className="space-y-3" aria-label="Imported research areas">
    <h3 className="text-sm font-semibold">Research areas</h3>
    <p className="text-xs text-slate-500">From the imported catalogue. Match any selected area.</p>
    <button type="button" className="text-xs text-blue-700 underline" disabled={busy} onClick={useSaved}>Use my research areas</button>
    <div className="flex flex-wrap gap-1">{selectedIds.map(id=><button type="button" className="rounded bg-blue-50 p-1 text-xs" aria-label={`Remove ${labels[id]||'area'}`} key={id} onClick={()=>toggle(id)}>{labels[id]||'Selected area'} ×</button>)}</div>
    {!!selectedIds.length&&<button type="button" className="text-xs underline" onClick={()=>onChange({...filters,importedAreaIds:[]})}>Clear research areas</button>}
    <select aria-label="Area collection" className="cb-input w-full text-sm" value={kind} onChange={e=>{setKind(e.target.value);setPage(1)}}><option value="discipline">Research areas</option><option value="subject">Broad subjects</option></select>
    <input aria-label="Search imported research areas" className="cb-input w-full text-sm" value={q} onChange={e=>{setQ(e.target.value);setPage(1)}} placeholder="Search all research areas" />
    <p role="status" className="text-xs text-amber-800">{error|| (busy?'Loading areas…':'')}</p>
    <div className="max-h-64 space-y-2 overflow-y-auto">{data?.areas?.map((area:any)=><label key={area.id} className="flex items-start gap-2 text-xs"><input type="checkbox" checked={selectedIds.includes(area.id)} disabled={!selectedIds.includes(area.id)&&selectedIds.length>=50} onChange={()=>toggle(area.id)}/><span className="flex-1">{area.label}</span><span>{area.count}</span></label>)}</div>
    <div className="flex justify-between text-xs"><button type="button" disabled={page===1||busy} onClick={()=>setPage(p=>p-1)}>Previous</button><span>{page} / {Math.max(1,Math.ceil((data?.total||0)/50))}</span><button type="button" disabled={busy||page*50>=(data?.total||0)} onClick={()=>setPage(p=>p+1)}>Next</button></div>
    {stats&&<details className="text-xs"><summary>Matching call statistics</summary><p>As of {stats.asOf} (UTC). Categories overlap.</p>{stats.lifecycle?.map((s:any)=><button type="button" className="block text-blue-700 underline" key={s.status} onClick={()=>onChange({...filters,lifecycleStatuses:[s.status],includeExpired:true})}>{s.status}: {s.count}</button>)}{stats.fundingKinds?.map((s:any)=><button type="button" className="block text-blue-700 underline" key={s.kind} onClick={()=>onChange({...filters,fundingKinds:(filters.fundingKinds||[]).includes(s.kind)?(filters.fundingKinds||[]).filter(k=>k!==s.kind):[...(filters.fundingKinds||[]),s.kind]})}>{s.kind}: {s.count}</button>)}{stats.origins?.map((o:any)=><p key={String(o.imported)}>{o.imported?'Imported':'Intake'}: {o.count}</p>)}<p>Area not mapped: {stats.unmapped?.[0]?.count||0}</p></details>}
  </section>
}
