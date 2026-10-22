'use client'
import { useState } from 'react'
import { useAuth } from '@/lib/auth-context'
export default function StandardAreaSuggestions({text,onSelect}:{text:string;onSelect:(id:string)=>void}) {
 const {authFetch}=useAuth(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[areas,setAreas]=useState<Array<{id:string;label:string}>>([])
 const suggest=async()=>{
  setBusy(true);setError('')
  try{
   const response=await authFetch('/api/researcher/research-area-suggestions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text.slice(0,5000)})}),data=await response.json()
   if(!response.ok)throw new Error(data.error||'Could not suggest areas')
   setAreas(data.suggestions||[])
  }catch(error){setError(error instanceof Error?error.message:'Could not suggest areas')}finally{setBusy(false)}
 }
 return <div className="space-y-2"><button type="button" className="cb-btn-secondary cb-btn-sm" disabled={busy||text.trim().length<20} onClick={suggest}>{busy?'Finding related areas…':'Suggest areas from my research focus'}</button><p className="text-xs text-muted">Suggestions are optional. Select the areas that describe your work.</p>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}<div className="flex flex-wrap gap-2">{areas.map(a=><button type="button" key={a.id} className="cb-btn-secondary cb-btn-sm" onClick={()=>onSelect(a.id)}>{a.label}</button>)}</div></div>
}
