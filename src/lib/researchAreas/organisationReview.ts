import { randomUUID } from 'node:crypto'
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { areaInputHash,CLASSIFICATION_PROMPT_VERSION,validateAreaDecision,type ClassificationInput } from './core'
import { loadAreaVectors,loadStandardAreas,setManualAreaLinks,type ClassificationDb } from './store'
import { newAreaCostLedger,proposeResearchAreas } from './ai'
type ScopeArea={id:string;label:string}

/** Scope evidence consists of the unit's own name and confirmed settings.
 * Individual faculty interests cannot silently redefine a department. */
export async function organisationReviewInput(id:string,db:ClassificationDb=prisma){
 const rows=await db.$queryRaw<Array<{id:string;name:string;tenantId:string;active:boolean;legacy:ScopeArea[];canonical:ScopeArea[]}>>`SELECT u.id,u.name,u.tenant_id "tenantId",u.is_active active,
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',n.id,'label',coalesce(nullif(n.level2_name,''),n.level1_name)) ORDER BY n.id)
    FROM selected_org_unit_research_area_links e JOIN research_area_taxonomy_areas n ON n.id=e.area_id WHERE e.org_unit_id=u.id),'[]') legacy,
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'label',a.label) ORDER BY a.id)
    FROM selected_org_unit_research_area_links e JOIN catalogue_areas a ON a.id=e.area_id WHERE e.org_unit_id=u.id AND a.kind='discipline'),'[]') canonical
  FROM tenant_org_units u WHERE u.id=${id}`
 const unit=rows[0];if(!unit||!unit.active)throw new Error('Active organisation unit not found')
 const input:ClassificationInput={id,title:unit.name,description:`Organisation unit: ${unit.name}.\nConfirmed research scope: ${[...unit.legacy,...unit.canonical].map(a=>a.label).join('; ')||'No confirmed scope is available.'}`,tags:unit.legacy.map(a=>a.label)}
 return {unit,input,hash:areaInputHash({input,legacy:unit.legacy,canonical:unit.canonical})}
}

export async function generateOrganisationProposal(unitId:string,actorId:string){
 const {unit,input,hash}=await organisationReviewInput(unitId)
 const previous=await prisma.$queryRaw<Array<{id:string}>>`SELECT id FROM research_area_classifications WHERE entity_kind='ORG_UNIT' AND entity_id=${unitId} AND status='PROPOSED' AND input_hash=${hash} AND prompt_version=${CLASSIFICATION_PROMPT_VERSION} ORDER BY created_at DESC LIMIT 1`
 if(previous.length)return {id:previous[0].id,reused:true,costEstimateUsd:0}
 const ledger=newAreaCostLedger(.10),vectors=await loadAreaVectors(),proposal=await proposeResearchAreas(input,vectors,ledger,true)
 const id=randomUUID()
 await prisma.$transaction(async tx=>{
  const current=await organisationReviewInput(unitId,tx);if(current.hash!==hash)throw new Error('Department settings changed during review; try again')
  await tx.$executeRaw`INSERT INTO research_area_classifications(id,entity_kind,entity_id,input_hash,status,scope,source,model,prompt_version,candidates,evidence,usage,actor_id)
    VALUES(${id},'ORG_UNIT',${unitId},${hash},'PROPOSED',${proposal.decision.scope},'ai:department-review','gpt-5.4-mini',${CLASSIFICATION_PROMPT_VERSION},${JSON.stringify(proposal.candidates)}::jsonb,${JSON.stringify({...proposal.decision,legacyAreas:unit.legacy})}::jsonb,${JSON.stringify({ledger,usage:proposal.usage})}::jsonb,${actorId})`
  for(const areaId of proposal.decision.areaIds)await tx.$executeRaw`INSERT INTO research_area_classification_links(classification_id,area_id) VALUES(${id},${areaId})`
 })
 return {id,reused:false,costEstimateUsd:ledger.spentUsd}
}

export async function acceptOrganisationProposal(id:string,actorId:string){
 return prisma.$transaction(async tx=>{
  const rows=await tx.$queryRaw<Array<{entity_id:string;input_hash:string;status:string;evidence:any;candidates:any;prompt_version:string}>>`SELECT * FROM research_area_classifications WHERE id=${id} AND entity_kind='ORG_UNIT' FOR UPDATE`
  const p=rows[0];if(!p||p.status!=='PROPOSED')throw new Error('Department proposal is not pending')
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`canonical:ORG_UNIT:${p.entity_id}`},0))::text`
  await tx.$queryRaw`SELECT id FROM tenant_org_units WHERE id=${p.entity_id} FOR UPDATE`
  const current=await organisationReviewInput(p.entity_id,tx)
  if(current.hash!==p.input_hash||p.prompt_version!==CLASSIFICATION_PROMPT_VERSION)throw new Error('Department settings or review policy changed; generate a new proposal')
  const d=validateAreaDecision(p.evidence,p.candidates,current.input)
  if(d.scope==='UNKNOWN'||!d.areaIds.length)throw new Error('Choose research areas manually for an unresolved scope')
  const links=await tx.$queryRaw<Array<{area_id:string}>>`SELECT area_id FROM research_area_classification_links WHERE classification_id=${id}`
  if(links.length!==d.areaIds.length||links.some(l=>!d.areaIds.includes(l.area_id)))throw new Error('Proposal selections changed')
  // Approval adds precise selections while preserving all existing scope. A
  // deliberate removal belongs in the department editor, not bulk conversion.
  const selected=[...new Set([...current.unit.canonical.map(a=>a.id),...d.areaIds])]
  if(selected.includes((await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM catalogue_areas WHERE normalized_label='all disciplines' AND kind='discipline'`)[0]?.id)&&selected.length>1)throw new Error('All disciplines cannot be mixed with specific areas; review in the department editor')
  const revision=await setManualAreaLinks('ORG_UNIT',p.entity_id,selected,actorId,tx)
  await tx.$executeRaw`UPDATE research_area_classifications SET evidence=${JSON.stringify({retainedLegacyAreaIds:current.unit.legacy.map(a=>a.id),reviewedProposal:id})}::jsonb WHERE id=${revision}`
  // Preserve the reviewed proposal as accepted history; the manual revision is
  // the one current selection, so this proposal is already superseded.
  await tx.$executeRaw`UPDATE research_area_classifications SET status='ACCEPTED',accepted_at=now(),revoked_at=now(),revoked_by=${actorId},actor_id=${actorId} WHERE id=${id}`
  await tx.auditLog.create({data:{actorUserId:actorId,tenantId:current.unit.tenantId,action:'ORG_CANONICAL_AREAS_REVIEWED',resource:`tenant_org_unit:${p.entity_id}`,meta:{proposalId:id,revision,retainedLegacyAreas:current.unit.legacy.length,areaCount:selected.length}}})
  return {unitId:p.entity_id,revision}
 },{timeout:15000})
}

export async function organisationReviewPage(page=1,tenantId=''){
 const where=Prisma.sql`u.is_active AND (${tenantId}='' OR u.tenant_id=${tenantId})`
 const units=await prisma.$queryRaw<Array<{unitId:string;name:string;tenantId:string;tenantName:string;legacyCount:number;canonicalCount:number}>>`SELECT u.id "unitId",u.name,u.tenant_id "tenantId",t.name "tenantName",
  (SELECT count(*)::int FROM selected_org_unit_research_area_links e JOIN research_area_taxonomy_areas n ON n.id=e.area_id WHERE e.org_unit_id=u.id) "legacyCount",
  (SELECT count(*)::int FROM selected_org_unit_research_area_links e JOIN catalogue_areas a ON a.id=e.area_id WHERE e.org_unit_id=u.id AND a.kind='discipline') "canonicalCount"
  FROM tenant_org_units u JOIN tenants t ON t.id=u.tenant_id WHERE ${where} ORDER BY t.name,u.depth,u.name,u.id LIMIT 20 OFFSET ${(page-1)*20}`
 const [{total}]=await prisma.$queryRaw<Array<{total:number}>>`SELECT count(*)::int total FROM tenant_org_units u WHERE ${where}`
 const proposals=await prisma.$queryRaw<any[]>`SELECT d.id,d.entity_id "unitId",d.scope,d.evidence,d.usage,
   coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'label',a.label)) FROM research_area_classification_links l JOIN catalogue_areas a ON a.id=l.area_id WHERE l.classification_id=d.id),'[]') areas
   FROM research_area_classifications d WHERE d.entity_kind='ORG_UNIT' AND d.status='PROPOSED' AND d.entity_id=ANY(${units.map(u=>u.unitId)}::text[]) ORDER BY d.created_at DESC`
 return {page,total,units:units.map(u=>({...u,proposal:proposals.find(p=>p.unitId===u.unitId)||null})),maximumEstimatePerUnitUsd:.10}
}

/** Mechanical conversion only: exact labels AND an already reviewed forward
 * scope relationship. Other areas stay visible for evidence-based review. */
export async function exactOrganisationPlan(){
 const units=await prisma.$queryRaw<Array<{id:string}>>`SELECT u.id FROM tenant_org_units u WHERE u.is_active AND EXISTS(SELECT 1 FROM selected_org_unit_research_area_links e JOIN research_area_taxonomy_areas n ON n.id=e.area_id WHERE e.org_unit_id=u.id) ORDER BY u.id`
 const areas=await loadStandardAreas(),targets=await prisma.$queryRaw<Array<{area_id:string;native_area_id:string}>>`SELECT area_id,native_area_id FROM research_area_legacy_targets`
 const plan=[]
 for(const {id}of units){
  const current=await organisationReviewInput(id),exact:Array<{legacyId:string;areaId:string}>=[],unresolved:string[]=[]
  for(const legacy of current.unit.legacy){const matches=areas.filter(a=>a.normalized_label===legacy.label.trim().replace(/\s+/g,' ').toLowerCase());if(matches.length===1&&targets.some(t=>t.area_id===matches[0].id&&t.native_area_id===legacy.id))exact.push({legacyId:legacy.id,areaId:matches[0].id});else unresolved.push(legacy.id)}
  const newIds=exact.map(e=>e.areaId).filter(id=>!current.unit.canonical.some(a=>a.id===id))
  plan.push({unitId:id,name:current.unit.name,tenantId:current.unit.tenantId,inputHash:current.hash,exact,newIds,unresolved})
 }
 return plan
}
export async function applyExactOrganisationItem(item:Awaited<ReturnType<typeof exactOrganisationPlan>>[number],actorId:string){
 if(!item.newIds.length)return null
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`canonical:ORG_UNIT:${item.unitId}`},0))::text`
  await tx.$queryRaw`SELECT id FROM tenant_org_units WHERE id=${item.unitId} FOR UPDATE`
  const current=await organisationReviewInput(item.unitId,tx);if(current.hash!==item.inputHash)throw new Error('Department changed since exact-mapping preview')
  const revision=await setManualAreaLinks('ORG_UNIT',item.unitId,[...new Set([...current.unit.canonical.map(a=>a.id),...item.newIds])],actorId,tx)
  await tx.$executeRaw`UPDATE research_area_classifications SET source='compatibility:exact-label',evidence=${JSON.stringify({retainedLegacyAreaIds:current.unit.legacy.map(a=>a.id),exactTranslations:item.exact,unresolvedLegacyAreaIds:item.unresolved})}::jsonb WHERE id=${revision}`
  await tx.auditLog.create({data:{actorUserId:actorId,tenantId:current.unit.tenantId,action:'ORG_CANONICAL_EXACT_TRANSLATION',resource:`tenant_org_unit:${item.unitId}`,meta:{revision,translations:item.exact,retainedLegacyAreas:current.unit.legacy.length}}})
  return revision
 })
}
