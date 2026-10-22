import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import type { PrismaClient } from '@/lib/prisma-generated'
import { activeCallExclusion, intakeCallExclusion, areaInputHash, CLASSIFICATION_PROMPT_VERSION, validateAreaDecision, type ClassificationInput, type EntityKind, type ValidatedDecision, type Candidate } from './core'

export type ClassificationDb = Pick<PrismaClient,'$queryRaw'|'$executeRaw'>
export async function loadStandardAreas(db:ClassificationDb=prisma) {
 return db.$queryRaw<Array<{id:string;label:string;normalized_label:string}>>`SELECT id,label,normalized_label FROM catalogue_areas WHERE kind='discipline' AND source_key='scientify' ORDER BY label,id`
}
export async function loadCallClassificationInput(id:string,db:ClassificationDb=prisma):Promise<ClassificationInput|null> {
 const rows=await db.$queryRaw<Array<{id:string;title:string;description:string;tags:string[];import_run_id:string|null;published:boolean;active:boolean;rolling:boolean;open_date:string|null;deadline:string|null;closed_at:string|null;has_manual:boolean}>>`
  SELECT f.id,coalesce(nullif(f.scheme_title,''),f.title) title,coalesce(nullif(f.description,''),f.summary,'') description,
   f.disciplines tags,f.import_run_id,(f.status='PUBLISHED' OR f.catalog_status='PUBLISHED') published,
   coalesce(f.is_active,true) active,coalesce(f.is_rolling,false) rolling,f.open_date::text,
   coalesce(f.entry_closes_at,f.final_deadline_at,f.close_date::date)::text deadline,f.source_closed_at::text closed_at,
   EXISTS(SELECT 1 FROM funding_call_research_area_taxonomies n WHERE n.funding_call_id=f.id AND n.source='manual') has_manual
  FROM funding_calls f WHERE f.id=${id}`
 const r=rows[0];return r?{id:r.id,title:r.title,description:r.description,tags:r.tags,importRunId:r.import_run_id,published:r.published,active:r.active,rolling:r.rolling,openDate:r.open_date,deadline:r.deadline,closedAt:r.closed_at,hasManualMapping:r.has_manual}:null
}
export async function listActiveExistingCallInputs(db:ClassificationDb=prisma) {
 const rows=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM funding_calls WHERE import_run_id IS NULL AND (status='PUBLISHED' OR catalog_status='PUBLISHED') AND coalesce(is_active,true) AND source_closed_at IS NULL ORDER BY id LIMIT 1000`
 const eligible:ClassificationInput[]=[],excluded:Array<{id:string;reason:string}>=[]
 for(const r of rows){const input=await loadCallClassificationInput(r.id,db);if(!input)continue;const reason=activeCallExclusion(input);if(reason)excluded.push({id:r.id,reason});else eligible.push(input)}
 return {eligible,excluded}
}
export async function saveAreaProposal(input:ClassificationInput,decision:ValidatedDecision,candidates:Candidate[],usage:unknown,actorId:string,db:ClassificationDb=prisma) {
 const id=randomUUID()
 const recordedUsage={...(usage&&typeof usage==='object'?usage:{}),researchHash:areaInputHash({title:input.title,description:input.description,tags:input.tags})}
 await db.$executeRaw`INSERT INTO research_area_classifications(id,entity_kind,entity_id,input_hash,status,scope,source,model,prompt_version,candidates,evidence,usage,actor_id)
  VALUES(${id},'CALL',${input.id},${areaInputHash(input)},'PROPOSED',${decision.scope},'ai:verified','gpt-5.4-mini',${CLASSIFICATION_PROMPT_VERSION},${JSON.stringify(candidates)}::jsonb,${JSON.stringify({...decision})}::jsonb,${JSON.stringify(recordedUsage)}::jsonb,${actorId})`
 for(const areaId of decision.areaIds)await db.$executeRaw`INSERT INTO research_area_classification_links(classification_id,area_id) VALUES(${id},${areaId})`
 return id
}
async function validateIds(ids:string[],db:ClassificationDb) {
 if(ids.length>50||new Set(ids).size!==ids.length)throw new Error('Choose at most 50 unique research areas')
 const found=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM catalogue_areas WHERE id=ANY(${ids}::text[]) AND kind='discipline' AND source_key='scientify'`
 if(found.length!==ids.length)throw new Error('Unknown standard research area')
}
export async function setManualAreaLinks(kind:EntityKind,entityId:string,ids:string[],actorId:string,db:PrismaClient | Prisma.TransactionClient=prisma) {
 const write=async(tx:Prisma.TransactionClient)=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`canonical:${kind}:${entityId}`},0))::text`
  await validateIds(ids,tx)
  const exists=kind==='CALL'?await tx.$queryRaw`SELECT id FROM funding_calls WHERE id=${entityId} FOR UPDATE`:
   kind==='SAVED_AREA'?await tx.$queryRaw`SELECT id FROM researcher_saved_research_areas WHERE id=${entityId} FOR UPDATE`:
   kind==='PROFILE'?await tx.$queryRaw`SELECT user_id FROM researcher_profiles WHERE user_id=${entityId} FOR UPDATE`:
   await tx.$queryRaw`SELECT id FROM tenant_org_units WHERE id=${entityId} FOR UPDATE`
  if(!(exists as unknown[]).length)throw new Error('Research-area owner no longer exists')
  await tx.$executeRaw`UPDATE research_area_classifications SET revoked_at=now(),revoked_by=${actorId} WHERE entity_kind=${kind} AND entity_id=${entityId} AND status='ACCEPTED' AND revoked_at IS NULL`
  const id=randomUUID()
  const all=await tx.$queryRaw<Array<{n:number}>>`SELECT count(*)::int n FROM catalogue_areas WHERE id=ANY(${ids}::text[]) AND normalized_label='all disciplines'`
  if(all[0].n&&ids.length!==1)throw new Error('All disciplines must be selected on its own')
  const scope=all[0].n?'ALL':ids.length?'SPECIFIC':'UNKNOWN'
  await tx.$executeRaw`INSERT INTO research_area_classifications(id,entity_kind,entity_id,input_hash,status,scope,source,prompt_version,actor_id,accepted_at)
   VALUES(${id},${kind},${entityId},${areaInputHash(ids)},'ACCEPTED',${scope},'manual',${CLASSIFICATION_PROMPT_VERSION},${actorId},now())`
  for(const areaId of ids)await tx.$executeRaw`INSERT INTO research_area_classification_links(classification_id,area_id) VALUES(${id},${areaId})`
  return id
 }
 return '$transaction' in db?db.$transaction(write):write(db)
}
export async function callClassificationExclusion(input:ClassificationInput,workflow:'active-backfill'|'intake'='active-backfill',db:ClassificationDb=prisma) {
 if(workflow==='active-backfill')return activeCallExclusion(input)
 const rows=await db.$queryRaw<Array<{draft:boolean;retired:boolean}>>`SELECT (catalog_status::text='DRAFT' AND intake_job_id IS NOT NULL) draft,
  (status::text IN ('ARCHIVED','FAILED') OR catalog_status::text IN ('ARCHIVED','REJECTED')) retired FROM funding_calls WHERE id=${input.id}`
 if(!rows.length||rows[0].retired)return 'retired_call'
 return intakeCallExclusion(input,rows[0].draft)
}
export async function acceptCallAreaProposal(id:string,actorId:string,options:{confirmManual?:boolean;confirmReview?:boolean;workflow?:'active-backfill'|'intake'}={},db:PrismaClient=prisma) {
 return db.$transaction(async tx=>{
  const rows=await tx.$queryRaw<Array<{id:string;entity_id:string;input_hash:string;status:string;scope:string;evidence:any;candidates:Candidate[];prompt_version:string}>>`SELECT * FROM research_area_classifications WHERE id=${id} AND entity_kind='CALL' FOR UPDATE`
  const proposal=rows[0];if(!proposal||proposal.status!=='PROPOSED')throw new Error('Area proposal is not pending')
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`canonical:CALL:${proposal.entity_id}`},0))::text`
  await tx.$queryRaw`SELECT id FROM funding_calls WHERE id=${proposal.entity_id} FOR UPDATE`
  const input=await loadCallClassificationInput(proposal.entity_id,tx)
  if(!input||await callClassificationExclusion(input,options.workflow,tx))throw new Error('Call is no longer an eligible open existing call or intake draft')
  if(areaInputHash(input)!==proposal.input_hash)throw new Error('Call changed after classification; generate a fresh proposal')
  if(proposal.prompt_version!==CLASSIFICATION_PROMPT_VERSION)throw new Error('Classification policy changed; generate a fresh proposal')
  const validated=validateAreaDecision(proposal.evidence,proposal.candidates,input)
  if(validated.scope!==proposal.scope)throw new Error('Classification scope changed')
  if(input.hasManualMapping&&!options.confirmManual)throw new Error('Existing human classification requires explicit review')
  if(proposal.evidence.needsReview&&!options.confirmReview)throw new Error('This classification requires review')
  const current=await tx.$queryRaw<Array<{source:string}>>`SELECT source FROM research_area_classifications WHERE entity_kind='CALL' AND entity_id=${input.id} AND status='ACCEPTED' AND revoked_at IS NULL`
  if(current.some(r=>r.source==='manual')&&!options.confirmManual)throw new Error('An accepted human classification cannot be replaced automatically')
  const links=await tx.$queryRaw<Array<{area_id:string}>>`SELECT area_id FROM research_area_classification_links WHERE classification_id=${id}`
  if(links.length!==validated.areaIds.length||links.some(l=>!validated.areaIds.includes(l.area_id)))throw new Error('Classification links do not match the reviewed decision')
  await validateIds(links.map(l=>l.area_id),tx)
  if(proposal.scope==='UNKNOWN'||!links.length)throw new Error('An unresolved classification cannot be accepted as a funding area')
  await tx.$executeRaw`UPDATE research_area_classifications SET revoked_at=now(),revoked_by=${actorId} WHERE entity_kind='CALL' AND entity_id=${input.id} AND status='ACCEPTED' AND revoked_at IS NULL`
  await tx.$executeRaw`UPDATE research_area_classifications SET status='ACCEPTED',accepted_at=now(),actor_id=${actorId} WHERE id=${id}`
  return {id,callId:input.id,areas:links.length}
 },{timeout:15000})
}
export async function currentEntityAreas(kind:EntityKind,entityId:string,db:ClassificationDb=prisma) {
 return db.$queryRaw<Array<{id:string;label:string;source:string}>>`SELECT a.id,a.label,d.source FROM research_area_classifications d JOIN research_area_classification_links l ON l.classification_id=d.id JOIN catalogue_areas a ON a.id=l.area_id WHERE d.entity_kind=${kind} AND d.entity_id=${entityId} AND d.status='ACCEPTED' AND d.revoked_at IS NULL ORDER BY a.label`
}
export async function loadAreaVectors(db:ClassificationDb=prisma) {
 const rows=await db.$queryRaw<Array<{id:string;label:string;embedding:string}>>`SELECT a.id,a.label,v.embedding::text FROM catalogue_areas a JOIN research_area_vectors v ON v.area_id=a.id WHERE a.kind='discipline' AND v.model='voyage-4-large' ORDER BY a.id`
 const areas=await loadStandardAreas(db)
 if(rows.length!==areas.length||!rows.length)throw new Error('The standard area embedding index must be prepared before classification')
 return rows.map(r=>({...r,embedding:JSON.parse(r.embedding) as number[]}))
}
/** SQL shape used by existing school matching code, without inventing groups. */
export const canonicalCallTaxonomiesSql=Prisma.sql`(SELECT DISTINCT e.call_id AS funding_call_id,e.area_id AS taxonomy_area_id,''::text AS taxonomy_level1_code,''::text AS taxonomy_level1_name,a.id AS taxonomy_level2_code,a.label AS taxonomy_level2_name FROM effective_call_research_areas e JOIN catalogue_areas a ON a.id=e.area_id WHERE a.kind='discipline')`
/** Old school profiles keep their reviewed scope through the original import
 * crosswalk, while corrected calls no longer inherit erroneous alias tags. */
export const canonicalSchoolCallTaxonomiesSql=Prisma.sql`(
 SELECT * FROM ${canonicalCallTaxonomiesSql} canonical
 UNION SELECT e.call_id,n.id,n.level1_code,n.level1_name,n.level2_code,n.level2_name
 FROM effective_call_research_areas e JOIN research_area_legacy_targets t ON t.area_id=e.area_id
 JOIN research_area_taxonomy_areas n ON n.id=t.native_area_id
 UNION SELECT m.funding_call_id,m.taxonomy_area_id,m.taxonomy_level1_code,m.taxonomy_level1_name,m.taxonomy_level2_code,m.taxonomy_level2_name
 FROM funding_call_research_area_taxonomies m WHERE NOT EXISTS(SELECT 1 FROM research_area_classifications d
  WHERE d.entity_kind='CALL' AND d.entity_id=m.funding_call_id AND d.status='ACCEPTED' AND d.revoked_at IS NULL)
)`
export async function syncForwardAreaCompatibility(db:PrismaClient=prisma) {
 const {loadScientifyCrosswalks,lookup,splitList}=await import('@/lib/fundingCatalogImport/crosswalks')
 const table=loadScientifyCrosswalks().disciplines,areas=await loadStandardAreas(db)
 const native=await db.$queryRaw<Array<{id:string;level1_code:string;level2_code:string}>>`SELECT a.id,a.level1_code,a.level2_code FROM research_area_taxonomy_areas a JOIN research_area_taxonomy_uploads u ON u.id=a.upload_id WHERE a.is_active AND u.status='ACTIVE'`
 const byCode=new Map(native.map(a=>[a.level2_code||a.level1_code,a.id])),unmapped:string[]=[]
 await db.$transaction(async tx=>{
  for(const area of areas){
   const row=lookup(table,area.label),codes=splitList(row?.research_area_codes)
   if(!row){unmapped.push(area.label);continue}
   for(const code of codes){
    const id=byCode.get(code);if(!id)throw new Error(`Unresolved compatibility code: ${code}`)
    await tx.$executeRaw`INSERT INTO research_area_legacy_targets(area_id,native_area_id,crosswalk_version) VALUES(${area.id},${id},${table.version}) ON CONFLICT(area_id,native_area_id) DO NOTHING`
   }
  }
 },{timeout:30000})
 return {version:table.version,unmapped}
}
