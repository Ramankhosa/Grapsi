import { useEffect,useState } from 'react'
import Header from '@/components/Header'
import { useAuth } from '@/lib/auth-context'
export default function FundingAccess(){
  const {authFetch,user}=useAuth();const[data,setData]=useState<any>(null),[error,setError]=useState('')
  async function load(){const r=await authFetch('/api/recommendations/sessions');const d=await r.json();if(!r.ok)throw new Error(d.error);setData(d)}
  useEffect(()=>{if(user)load().catch(e=>setError(e.message))},[user]) // eslint-disable-line react-hooks/exhaustive-deps
  async function revoke(id:string){try{const r=await authFetch('/api/recommendations/sessions',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});if(!r.ok)throw new Error('Could not revoke session.');await load()}catch(e:any){setError(e.message)}}
  return <><Header/><main className="mx-auto max-w-3xl space-y-5 p-6"><h1 className="text-2xl font-semibold">Funding access and sessions</h1><p>Two signed-in sessions are allowed. Multiple tabs share one session. Ending a session stops its funding access immediately.</p><p role="status">{error}</p>{data?.restrictions?.map((a:any)=><p key={a.reason}>{a.restricted_until?`Restricted until ${new Date(a.restricted_until).toLocaleString()}. `:''}{a.reason} Contact your administrator for help.</p>)}<h2 className="font-semibold">Distinct calls viewed in the last day</h2>{data?.exposure?.map((e:any)=><p key={e.kind}>{e.kind}: {e.count}</p>)}{data?.sessions?.map((s:any)=><section key={s.id} className="space-y-2 rounded border p-4"><strong>{s.current?'This session':'Other session'}</strong><p className="break-words text-sm">{s.user_agent||'Browser session'}</p><p className="text-sm">Signed in {new Date(s.authenticated_at).toLocaleString()}</p><button className="rounded border px-3 py-2" onClick={()=>revoke(s.id)}>End session</button></section>)}{!user&&<a href="/login">Sign in to manage sessions</a>}</main></>
}
