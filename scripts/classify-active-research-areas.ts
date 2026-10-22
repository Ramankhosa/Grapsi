/** Preview by default. Model generation is explicit; production application is
 * a separate hash-checked step after rehearsal and a focused backup. */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import dotenv from 'dotenv'
import { activeCallExclusion,areaInputHash,AREA_EMBEDDING_MODEL,CLASSIFICATION_PROMPT_VERSION,estimateAreaCost,normalizedAreaLabel,type ClassificationInput } from '../src/lib/researchAreas/core'

async function main(){
 const args=process.argv.slice(2),arg=(key:string)=>args.find(a=>a.startsWith(key+'='))?.slice(key.length+1)
 const inputFile=arg('--offline-input'),output=arg('--output')||'storage/release-bundles/active-area-proposals.json'
 assert(inputFile,'Supply a verified offline inspection JSON with --offline-input=<path>. No database is modified by this command.')
 const snapshot=JSON.parse(fs.readFileSync(inputFile,'utf8'))
 assert(snapshot.backup_sha256==='53b521cbb29464ffd61d431a439bb73629fe8846fc7432c9aaa551719078fbb2','Unexpected source snapshot; verify its provenance first')
 const areas=(snapshot.labels as string[]).map(label=>({label,id:'scientify:discipline:'+createHash('md5').update(normalizedAreaLabel(label)).digest('hex')}))
 assert.equal(areas.length,528,'The full imported area vocabulary must be present')
 const inputs:ClassificationInput[]=snapshot.calls.map((c:any)=>({id:c.id,title:c.scheme_title||c.title,description:c.description||c.summary||'',tags:c.disciplines,
  importRunId:null,published:c.status==='PUBLISHED'||c.catalog_status==='PUBLISHED',active:c.is_active!=='f',rolling:c.is_rolling==='t',openDate:c.open_date,
  deadline:(c.entry_closes_at||c.final_deadline_at||c.close_date)?.slice(0,10)||null,closedAt:c.source_closed_at,hasManualMapping:c.legacy_areas.some((a:any)=>a.source==='manual')}))
 const excluded=inputs.map(input=>({id:input.id,title:input.title,reason:activeCallExclusion(input)})).filter(r=>r.reason)
 const eligible=inputs.filter(input=>!activeCallExclusion(input)),limit=Number(arg('--limit')||5)
 const selectedIds=arg('--ids')?.split(',').filter(Boolean)
 if(selectedIds)assert(selectedIds.every(id=>eligible.some(c=>c.id===id)),'Selected call is not in the active eligible manifest')
 assert(Number.isInteger(limit)&&limit>=1&&limit<=100,'Limit must be 1–100')
 console.log(JSON.stringify({mode:args.includes('--generate')?'generate-preview':'estimate-only',areas:areas.length,eligible:eligible.length,excluded:excluded.length,estimate:estimateAreaCost(eligible.length),productionWrites:false}))
 if(!args.includes('--generate'))return
 for(const file of ['.env','.env.local'])if(fs.existsSync(file))dotenv.config({path:file,override:true,quiet:true})
 const {embedAreaVocabulary,proposeResearchAreas,newAreaCostLedger}=await import('../src/lib/researchAreas/ai')
 const vocabularyHash=areaInputHash(areas),cachePath=arg('--vector-cache')||'storage/release-bundles/research-area-vectors.json'
 const previous=fs.existsSync(output)?JSON.parse(fs.readFileSync(output,'utf8')):null
 if(previous)assert.equal(previous.vocabularyHash,vocabularyHash,'Area vocabulary changed; use a new proposal file')
 const ledger=previous?.ledger||newAreaCostLedger(2)
 const report=previous||{createdAt:new Date().toISOString(),snapshotHash:snapshot.backup_sha256,vocabularyHash,promptVersion:CLASSIFICATION_PROMPT_VERSION,embeddingModel:AREA_EMBEDDING_MODEL,ledger,excluded,proposals:[]}
 if(report.proposals.length)assert.equal(report.promptVersion,CLASSIFICATION_PROMPT_VERSION,'Prompt changed; use a new proposal manifest')
 else report.promptVersion=CLASSIFICATION_PROMPT_VERSION
 const checkpoint=()=>{fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2))}
 let vectors
 if(fs.existsSync(cachePath)){
  const cache=JSON.parse(fs.readFileSync(cachePath,'utf8'));assert.equal(cache.vocabularyHash,vocabularyHash);assert.equal(cache.model,AREA_EMBEDDING_MODEL);vectors=cache.areas
 }else{
  try{vectors=await embedAreaVocabulary(areas,ledger)}finally{checkpoint()}
  fs.writeFileSync(cachePath,JSON.stringify({vocabularyHash,model:AREA_EMBEDDING_MODEL,areas:vectors}))
 }
 let processed=0
 for(const input of eligible.filter(c=>!selectedIds||selectedIds.includes(c.id))){
  const existing=report.proposals.find((p:any)=>p.callId===input.id)
  if(existing){assert.equal(existing.inputHash,areaInputHash(input),'Call changed; use a fresh manifest');continue}
  try{
   const proposal=await proposeResearchAreas(input,vectors,ledger)
   report.proposals.push({callId:input.id,title:input.title,inputHash:areaInputHash(input),input,...proposal})
   console.log(JSON.stringify({callId:input.id,title:input.title,areas:proposal.decision.areaIds.map(id=>areas.find(a=>a.id===id)?.label),needsReview:proposal.decision.needsReview,costEstimateUsd:ledger.spentUsd}))
  }catch(error){report.lastFailure={callId:input.id,message:error instanceof Error?error.message:'Review failed',diagnostic:(error as any)?.reviewDiagnostic||null};throw error}finally{checkpoint()}
  if(++processed>=limit)break
 }
 console.log(JSON.stringify({proposals:report.proposals.length,ledger,applied:false}))
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Area preview failed');process.exitCode=1})
