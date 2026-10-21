import fs from 'node:fs'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {withDisposableDb} from './lib/disposableDb'
import {captureSafetySnapshot,compareSafetySnapshots} from '../src/lib/fundingCatalogImport/safety'
import {callsWithAttachedWork,rollbackImportRun} from '../src/lib/fundingCatalogImport/rollback'
import {loadScientifyCrosswalks,lookup} from '../src/lib/fundingCatalogImport/crosswalks'

async function main() {
const cw=loadScientifyCrosswalks(); const counts=new Map<string,number>(); const missing=new Set<string>()
const files=fs.readdirSync('storage/import-snapshots').filter(x=>x.startsWith('scientify-2026-10-21') && !x.endsWith('.tar.gz')).sort()
for(const line of fs.readFileSync(`storage/import-snapshots/${files.at(-1)}/grants.jsonl`,'utf8').split(/\r?\n/).filter(Boolean)) {
 const r=JSON.parse(line)
 for(const [key,table] of Object.entries({'discipline':cw.disciplines,'my-subject':cw.subjects,'career-stage':cw.careerStages,'grant-type':cw.grantTypes,'funding-sources':cw.fundingSources})) {
  for(const label of r.taxonomies?.[key]||[]) {if(!lookup(table,label))missing.add(`${key}:${label}`); if(key==='discipline')counts.set(label,(counts.get(label)||0)+1)}
 }
}
assert.equal(missing.size,0,'Every controlled source label must resolve')
console.log('UNMAPPED',JSON.stringify([...missing])); console.log('TOP40',JSON.stringify([...counts].sort((a,b)=>b[1]-a[1]).slice(0,40).map(([label,count])=>({label,count,mapping:lookup(cw.disciplines,label)?.research_area_codes})),null,2))
await withDisposableDb(async({db})=>{
 const base={createdByUserId:'review',updatedByUserId:'review',sourceType:'URL' as const,visibility:'GLOBAL_PUBLISHED' as const,status:'PUBLISHED' as const,catalog_status:'PUBLISHED' as const}
 const call=await db.fundingCall.create({data:{...base,title:'a|b',scheme_title:'c'}})
 const cols=await db.$queryRawUnsafe<any[]>(`SELECT column_name FROM information_schema.columns WHERE table_name='funding_calls' AND column_name IN ('title','scheme_title','agency_name','description') ORDER BY ordinal_position`)
 console.log('TEXT_COLUMN_ORDER',cols)
 await db.$executeRawUnsafe('UPDATE funding_calls SET description=NULL WHERE id=$1',call.id)
 const before=await captureSafetySnapshot(db as any)
 await db.$executeRawUnsafe('UPDATE funding_calls SET description=$1 WHERE id=$2','<null>',call.id)
 assert.equal(compareSafetySnapshots(before,await captureSafetySnapshot(db as any)).ok,false)
 console.log('PASS null-sentinel fingerprint bypass rejected')
 await db.$executeRawUnsafe('UPDATE funding_calls SET description=$1, "updatedAt"="updatedAt" + interval \'1 second\' WHERE id=$2','malicious edit',call.id)
 assert.equal(compareSafetySnapshots(before,await captureSafetySnapshot(db as any)).ok,false)
 console.log('PASS content change with timestamp change rejected')
 const run=await db.fundingImportRun.create({data:{source_key:'scientify',mode:'APPLY',status:'COMPLETED',importer_version:'review'}})
 const releaseSource=fs.readFileSync('src/lib/fundingCatalogImport/release.ts','utf8')
 const guardedSql=releaseSource.match(/`(WITH old AS \([\s\S]*?old\.old_published)`/)![1].replace('${REVIEW_STATUS.CLEAR}','CLEAR').replace('${NOTIFICATION_POLICY_SUPPRESSED}','SUPPRESSED')
 for(const [name,override] of Object.entries({valid:{},noImport:{import_run_id:null},notStaged:{catalog_status:'PUBLISHED'},held:{review_status:'NEEDS_REVIEW'},notSuppressed:{notification_policy:null},department:{visibility:'GLOBAL_PUBLISHED'}})) {
  const guardCall=await db.fundingCall.create({data:{...base,title:'guard '+name,visibility:'GLOBAL_CATALOG',catalog_status:'STAGED',import_run_id:run.id,review_status:'CLEAR',notification_policy:'SUPPRESSED',...override} as any})
  const changed=await db.$queryRawUnsafe<any[]>(guardedSql,[guardCall.id],new Date().toISOString())
  console.log('RELEASE_GUARD',name,changed.length)
  assert.equal(changed.length,name==='valid'?1:0)
  await db.fundingCall.delete({where:{id:guardCall.id}})
 }
 const imported=await db.fundingCall.create({data:{...base,title:'review import',visibility:'GLOBAL_CATALOG',catalog_status:'STAGED',import_run_id:run.id,review_status:'CLEAR',notification_policy:'SUPPRESSED'}})
 const {Prisma}=await import('@prisma/client')
 const {importedDimensionCountryCondition,directoryEligibilityDemotion}=await import('../src/lib/services/recommendationSearchService')
 const {evaluateDimension}=await import('../src/lib/funding/eligibility')
 for(const scope of [null,'ANY','UNSPECIFIED','COUNTRIES','REGIONS'] as const) {
  for(const allowed of [[],['IN'],['US']])for(const excluded of [[],['IN']]) {
   await db.fundingCall.update({where:{id:imported.id},data:{residence_scope:scope,residence_country_codes:allowed,residence_excluded_codes:excluded}})
   const verdict=evaluateDimension({scope,countryCodes:allowed,excludedCodes:excluded,regionCodes:[]},['IN'])
   const condition=importedDimensionCountryCondition(['residence'],['IN'])
   const demotion=directoryEligibilityDemotion({residence:['IN'],citizenship:['IN']})
   const rows=await db.$queryRaw<any[]>(Prisma.sql`SELECT (${condition}) AS admitted, (${demotion}) AS demotion FROM funding_calls WHERE id=${imported.id}`)
   assert.equal(rows[0].admitted,verdict!=='INELIGIBLE',JSON.stringify({scope,allowed,excluded,verdict}))
   assert.equal(rows[0].demotion,verdict==='INELIGIBLE'?1:0)
  }
 }
 console.log('PASS 30 country-filter and SQL-demotion cases agree with evaluateDimension')
 await db.fundingCall.update({where:{id:imported.id},data:{residence_scope:'COUNTRIES',residence_country_codes:['US'],residence_excluded_codes:[],close_date:new Date('2026-11-01')}})
 const eligibleCall=await db.fundingCall.create({data:{...base,title:'eligible later',close_date:new Date('2026-12-01'),residence_scope:'ANY'}})
 const globalOrder=directoryEligibilityDemotion({residence:['IN']})
 const firstPage=await db.$queryRaw<any[]>(Prisma.sql`SELECT id FROM funding_calls WHERE id IN (${imported.id},${eligibleCall.id}) ORDER BY ${globalOrder}, close_date ASC, id ASC LIMIT 1`)
 assert.equal(firstPage[0].id,eligibleCall.id)
 console.log('PASS SQL demotion puts eligible call on page one before LIMIT')
 await db.$executeRawUnsafe('INSERT INTO funding_intake_duplicates (id,job_id,candidate_funding_call_id,match_type,match_score) VALUES ($1,$2,$3,\'exact_fingerprint\',1)','review-ref','review-job',imported.id)
 assert.equal((await callsWithAttachedWork(db as any,[imported.id])).has(imported.id),true)
 console.log('PASS non-FK attached work detected')
 await rollbackImportRun({db:db as any,runId:run.id,dryRun:false,confirmTarget:(await db.$queryRawUnsafe<any[]>('SELECT current_database() name'))[0].name})
 assert.ok(await db.fundingCall.findUnique({where:{id:imported.id}}))
 console.log('PASS rollback retains referenced call')
 const url=(db as any)._engineConfig.overrideDatasources.db.url
 const diff=execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','diff','--from-url',url,'--to-schema-datamodel','prisma/schema.prisma','--script'],{encoding:'utf8',maxBuffer:10*1024*1024})
 fs.writeFileSync('catalog-review-drift.sql',diff);console.log('DRIFT_WRITTEN')
})
}
main().catch(e=>{console.error(e);process.exitCode=1})
