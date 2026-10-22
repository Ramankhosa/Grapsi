/** Applies a previously generated, reviewed manifest. Makes no model calls and
 * never writes funding rows, legacy taxonomy links or notification records. */
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { activeCallExclusion,areaInputHash,embeddingAreaText,validateAreaDecision,CLASSIFICATION_PROMPT_VERSION,AREA_EMBEDDING_MODEL } from '../src/lib/researchAreas/core'
import prisma from '../src/lib/prisma'
import { loadStandardAreas,loadCallClassificationInput,saveAreaProposal,acceptCallAreaProposal,syncForwardAreaCompatibility } from '../src/lib/researchAreas/store'

async function main(){
 const args=process.argv.slice(2),arg=(key:string)=>args.find(a=>a.startsWith(key+'='))?.slice(key.length+1)
 const target=arg('--confirm-target'),manifestFile=arg('--manifest'),cacheFile=arg('--vector-cache')
 assert(target&&manifestFile&&cacheFile,'Supply --confirm-target, --manifest and --vector-cache')
 const [{db}]=await prisma.$queryRaw<Array<{db:string}>>`SELECT current_database() db`
 assert.equal(db,target,'Application and operator database targets differ')
 const rehearsal=/^grapsi_area_rehearsal_\d+$/.test(target)
 assert(target==='grapsi'||rehearsal,'Only Grapsi and its named area rehearsal databases are allowed')
 const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8')),cache=JSON.parse(fs.readFileSync(cacheFile,'utf8'))
 assert.equal(manifest.promptVersion,CLASSIFICATION_PROMPT_VERSION)
 assert.equal(cache.vocabularyHash,manifest.vocabularyHash);assert.equal(cache.model,AREA_EMBEDDING_MODEL)
 const areas=await loadStandardAreas(),byId=new Map(areas.map(a=>[a.id,a]))
 assert.equal(areas.length,528);assert.equal(cache.areas.length,528)
 assert.equal(new Set(cache.areas.map((a:any)=>a.id)).size,528)
 for(const a of cache.areas){assert.equal(byId.get(a.id)?.label,a.label,'Vocabulary mismatch');assert(a.embedding.length===1024&&a.embedding.every(Number.isFinite),'Invalid Voyage vector cache')}
 const reviewed=new Set((arg('--reviewed-call-ids')||'').split(',').filter(Boolean)),plan=[]
 for(const p of manifest.proposals){
  const input=await loadCallClassificationInput(p.callId)
  const exclusion=input?activeCallExclusion(input):'missing_call'
  if(exclusion||!input||areaInputHash(input)!==p.inputHash){plan.push({callId:p.callId,skip:exclusion||'input_changed'});continue}
  validateAreaDecision(p.decision,p.candidates,input)
  if(p.decision.scope==='UNKNOWN'||!p.decision.areaIds.length){plan.push({callId:p.callId,pending:true,input,proposal:p});continue}
  const needsReview=p.decision.needsReview||input.hasManualMapping
  if(needsReview&&!reviewed.has(p.callId)){plan.push({callId:p.callId,pending:true,input,proposal:p});continue}
  if(input.hasManualMapping&&!args.includes('--confirm-manual-selections')){plan.push({callId:p.callId,skip:'manual_confirmation_required'});continue}
  plan.push({callId:p.callId,input,proposal:p})
 }
 console.log(JSON.stringify({database:db,apply:args.includes('--apply'),ready:plan.filter(p=>!p.skip&&!p.pending).length,pending:plan.filter(p=>p.pending).length,skipped:plan.filter(p=>p.skip).map(p=>({callId:p.callId,reason:p.skip})),aiCalls:0}))
 if(!args.includes('--apply'))return
 if(!rehearsal){
  assert(process.platform==='linux'&&fs.realpathSync(process.cwd())==='/var/www/granter/Grapsi','Production apply must run inside the verified Grapsi checkout')
  const proofFile=arg('--backup-proof');assert(proofFile,'A verified focused-backup proof is required')
  assert(fs.realpathSync(proofFile).startsWith('/var/www/granter/Grapsi/backups/active-areas-'),'Unexpected backup-proof location')
  const proof=JSON.parse(fs.readFileSync(proofFile,'utf8'))
  assert.equal(proof.database,'grapsi');assert.equal(proof.restoredAndVerified,true)
  assert.equal(proof.classificationRehearsed,true,'Classification must pass on the restored database first')
  assert(/^grapsi_area_rehearsal_\d+$/.test(proof.rehearsalDatabase))
  const age=Date.now()-Date.parse(proof.createdAt);assert(age>=0&&age<86400000,'Backup proof must be less than 24 hours old')
  assert.equal(createHash('sha256').update(fs.readFileSync(proof.backupFile)).digest('hex'),proof.sha256,'Backup checksum mismatch')
 }
 const actor=arg('--actor')||'operator:active-area-unification',outcomes=[]
 const receipt=arg('--receipt')||'active-area-application-receipt.json'
 for(const a of cache.areas)await prisma.$executeRaw`INSERT INTO research_area_vectors(area_id,embedding,input_hash,model) VALUES(${a.id},${JSON.stringify(a.embedding)}::vector,${areaInputHash(embeddingAreaText(a))},${AREA_EMBEDDING_MODEL}) ON CONFLICT(area_id) DO UPDATE SET embedding=EXCLUDED.embedding,input_hash=EXCLUDED.input_hash,model=EXCLUDED.model`
 const compatibility=await syncForwardAreaCompatibility()
 for(const item of plan){
  if(item.skip){outcomes.push({callId:item.callId,applied:false,reason:item.skip});continue}
  const p=item.proposal!
  const prior=await prisma.$queryRaw<Array<{id:string;status:string;revoked_at:Date|null}>>`SELECT id,status,revoked_at FROM research_area_classifications WHERE entity_kind='CALL' AND entity_id=${item.callId} AND input_hash=${p.inputHash} AND prompt_version=${CLASSIFICATION_PROMPT_VERSION} AND evidence=${JSON.stringify(p.decision)}::jsonb ORDER BY created_at DESC LIMIT 1`
  const id=prior[0]?.id||await saveAreaProposal(item.input!,p.decision,p.candidates,p.usage,actor)
  if(prior[0]?.status==='ACCEPTED'){outcomes.push({callId:item.callId,id,applied:prior[0].revoked_at===null,reason:'previously_processed'});continue}
  if(item.pending){outcomes.push({callId:item.callId,id,applied:false,reason:'review_required'});continue}
  try{await acceptCallAreaProposal(id,actor,{confirmReview:reviewed.has(item.callId),confirmManual:reviewed.has(item.callId)&&args.includes('--confirm-manual-selections')});outcomes.push({callId:item.callId,id,applied:true})}
  catch(error){outcomes.push({callId:item.callId,id,applied:false,reason:error instanceof Error?error.message:'Approval failed'})}
  fs.writeFileSync(receipt,JSON.stringify({database:db,actor,compatibility,outcomes},null,2),{mode:0o600})
 }
 fs.writeFileSync(receipt,JSON.stringify({database:db,actor,compatibility,outcomes},null,2),{mode:0o600})
 console.log(JSON.stringify({applied:outcomes.filter(o=>o.applied).length,pending:outcomes.filter(o=>!o.applied).length,compatibilityUnmapped:compatibility.unmapped.length,receipt}))
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Area application failed');process.exitCode=1}).finally(()=>prisma.$disconnect())
