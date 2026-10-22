import assert from 'node:assert/strict'
import { withDisposableDb } from './lib/disposableDb'

async function main(){
 await withDisposableDb(async({db,database})=>{
  process.env.CANONICAL_RESEARCH_AREAS_ENABLED='true'
  process.env.EMBEDDING_GENERATION_ENABLED='false'
  const {loadCallClassificationInput,saveAreaProposal,acceptCallAreaProposal,setManualAreaLinks}=await import('../src/lib/researchAreas/store')
  const {recommendationSearchService}=await import('../src/lib/services/recommendationSearchService')
  const {researcherProfileService}=await import('../src/lib/services/researcherProfileService')
  const {researchAreaTaxonomyService}=await import('../src/lib/services/researchAreaTaxonomyService')
  await db.user.create({data:{id:'areas-user',email:'areas-user@example.invalid',roles:['SUPER_ADMIN'],status:'ACTIVE'}})
  const ids={blood:'scientify:discipline:blood',eng:'scientify:discipline:eng',all:'scientify:discipline:all'}
  for(const [key,label]of [['blood','Hematology'],['eng','Mechanical engineering'],['all','All disciplines']])await db.$executeRawUnsafe('INSERT INTO catalogue_areas(id,source_key,kind,label,normalized_label,version) VALUES($1,\'scientify\',\'discipline\',$2,lower($2),\'fixture\')',ids[key as keyof typeof ids],label)
  const upload=await db.researchAreaTaxonomyUpload.create({data:{source_name:'Old fixture taxonomy',row_count:1,active_row_count:1,uploaded_by:'areas-user'}})
  const legacy=await db.researchAreaTaxonomyArea.create({data:{upload_id:upload.id,level1_code:'ENG',level1_name:'Engineering',level2_code:'ENG.1',level2_name:'Mechanical engineering'}})
  await db.$executeRaw`INSERT INTO catalogue_area_crosswalk(native_area_id,imported_area_id,relation,approved_by,approved_at) VALUES(${legacy.id},${ids.eng},'exact','fixture',now())`
  const call=await db.fundingCall.create({data:{title:'Blood cancer cell therapy',description:'This research grant funds hematopoietic stem cell transplantation and cell manufacturing to treat blood cancer and immune complications.',disciplines:['cell manufacturing'],createdByUserId:'areas-user',updatedByUserId:'areas-user',visibility:'GLOBAL_PUBLISHED',status:'PUBLISHED',catalog_status:'PUBLISHED',is_active:true,close_date:new Date('2099-12-31')}})
  await db.fundingCallResearchAreaTaxonomy.create({data:{funding_call_id:call.id,taxonomy_area_id:legacy.id,taxonomy_level1_code:'ENG',taxonomy_level1_name:'Engineering',taxonomy_level2_name:'Mechanical engineering',source:'auto:alias'}})
  const before=await db.fundingCall.findUniqueOrThrow({where:{id:call.id}}),beforeLegacy=await db.fundingCallResearchAreaTaxonomy.findMany({where:{funding_call_id:call.id}})
  const input=(await loadCallClassificationInput(call.id,db as any))!
  const decision={scope:'SPECIFIC' as const,areaIds:[ids.blood],evidence:[{areaId:ids.blood,quote:'to treat blood cancer'}],needsReview:false,shortlistInsufficient:false,reason:'Research purpose is treatment of blood cancer'}
  const candidates=[{id:ids.blood,label:'Hematology',similarity:.8},{id:ids.eng,label:'Mechanical engineering',similarity:.7}]
  const p=await saveAreaProposal(input,decision,candidates,{},'areas-user',db as any)
  await acceptCallAreaProposal(p,'areas-user',{},db as any)
  assert.deepEqual(await db.fundingCall.findUniqueOrThrow({where:{id:call.id}}),before,'Classification cannot rewrite the call or its vector')
  assert.deepEqual(await db.fundingCallResearchAreaTaxonomy.findMany({where:{funding_call_id:call.id}}),beforeLegacy,'Legacy history must remain intact')
  const browse=(area:string)=>recommendationSearchService.browseDirectory({filters:{importedAreaIds:[area],lifecycleStatuses:['OPEN','ROLLING']},access:{tenantId:null,isSuperAdmin:false}})
  assert.equal((await browse(ids.blood)).totalResults,1)
  assert.equal((await browse(ids.eng)).totalResults,0,'An obsolete compatibility tag must not reintroduce a corrected error')
  const broad=await db.fundingCall.create({data:{title:'Any research field',description:'This research grant accepts applications in any research discipline.',createdByUserId:'areas-user',updatedByUserId:'areas-user',visibility:'GLOBAL_PUBLISHED',status:'PUBLISHED',catalog_status:'PUBLISHED',is_rolling:true}})
  await setManualAreaLinks('CALL',broad.id,[ids.all],'areas-user',db as any)
  assert.equal((await browse(ids.eng)).totalResults,1,'All-disciplines calls remain discoverable under a specific area')
  assert.equal((await browse(ids.blood)).totalResults,2)
  const facets:any=await recommendationSearchService.catalogueOverview({filters:{lifecycleStatuses:['OPEN','ROLLING']},access:{tenantId:null,isSuperAdmin:false}},{kind:'discipline'})
  assert.equal(facets.areas.find((a:any)=>a.id===ids.blood).count,2)
  assert.equal(facets.areas.find((a:any)=>a.id===ids.eng).count,1)
  assert.equal(facets.areas.find((a:any)=>a.id===ids.all).count,1)
  const med=await db.researchAreaTaxonomyArea.create({data:{upload_id:upload.id,level1_code:'MED',level1_name:'Medicine',level2_code:'MED.01',level2_name:'Clinical medicine'}})
  await db.$executeRaw`INSERT INTO research_area_legacy_targets(area_id,native_area_id,crosswalk_version) VALUES(${ids.blood},${med.id},'reviewed-fixture'),(${ids.eng},${legacy.id},'reviewed-fixture')`
  const tenant=await db.tenant.create({data:{name:'Area verification institution',atiId:'AREA_VERIFICATION'}})
  const clinic=await db.tenantOrgUnit.create({data:{tenant_id:tenant.id,kind:'SCHOOL',name:'Medical school'}})
  const engineering=await db.tenantOrgUnit.create({data:{tenant_id:tenant.id,kind:'SCHOOL',name:'Engineering school'}})
  await db.tenantOrgUnitResearchArea.createMany({data:[{tenant_id:tenant.id,org_unit_id:clinic.id,taxonomy_area_id:med.id},{tenant_id:tenant.id,org_unit_id:engineering.id,taxonomy_area_id:legacy.id}]})
  const orgBefore=await db.tenantOrgUnitResearchArea.findMany({orderBy:{id:'asc'}})
  const {loadUnitAreaProfile,relevantCallWhereSql}=await import('../src/lib/funding/callUnitRelevance')
  const clinicProfile=await loadUnitAreaProfile(tenant.id,[clinic.id]),engineeringProfile=await loadUnitAreaProfile(tenant.id,[engineering.id])
  const medicalMatches=await db.$queryRaw<Array<{id:string}>>`SELECT f.id FROM funding_calls f WHERE ${relevantCallWhereSql(clinicProfile,'f')}`
  const engineeringMatches=await db.$queryRaw<Array<{id:string}>>`SELECT f.id FROM funding_calls f WHERE ${relevantCallWhereSql(engineeringProfile,'f')}`
  assert(medicalMatches.some(c=>c.id===call.id),'Reviewed forward compatibility must preserve an existing medical school scope')
  assert(!engineeringMatches.some(c=>c.id===call.id),'A corrected call must not retain its erroneous engineering match')
  assert(engineeringMatches.some(c=>c.id===broad.id),'Broad calls must remain visible to an existing school')
  await setManualAreaLinks('ORG_UNIT',clinic.id,[ids.blood],'areas-user',db as any)
  const selected=await db.$queryRaw<Array<{area_id:string}>>`SELECT area_id FROM selected_org_unit_research_area_links WHERE org_unit_id=${clinic.id}`
  assert.deepEqual(selected.map(s=>s.area_id),[ids.blood],'Compatibility targets must not appear as extra user selections')
  assert.deepEqual(await db.tenantOrgUnitResearchArea.findMany({orderBy:{id:'asc'}}),orgBefore,'Existing department mappings must not be overwritten')
  console.log('PASS existing departmental scopes, forward compatibility, corrected matching and unchanged department rows')
  console.log('PASS authoritative call mapping, broad-call filtering, reconciled area counts and preserved source rows')
  const stale=await saveAreaProposal(input,decision,candidates,{},'areas-user',db as any)
  await db.fundingCall.update({where:{id:call.id},data:{description:'Changed research purpose after selection. This is a distinct biomedical study examining long-term immune outcomes and transplant complications in patients.'}})
  await assert.rejects(acceptCallAreaProposal(stale,'areas-user',{},db as any),/changed after classification/)
  await db.fundingCall.update({where:{id:call.id},data:{description:input.description,close_date:new Date('2020-01-01')}})
  await assert.rejects(acceptCallAreaProposal(stale,'areas-user',{},db as any),/no longer an eligible/)
  await db.fundingCall.update({where:{id:call.id},data:{close_date:new Date('2099-12-31')}})
  await setManualAreaLinks('CALL',call.id,[ids.eng],'areas-user',db as any)
  await assert.rejects(acceptCallAreaProposal(stale,'areas-user',{},db as any),/human classification/)
  await assert.rejects(setManualAreaLinks('CALL',call.id,['invented'],'areas-user',db as any),/Unknown standard/)
  assert.equal((await browse(ids.eng)).totalResults,2,'A failed edit must not revoke the accepted manual decision')
  console.log('PASS stale-input, expired-call, manual-decision and failed-write guards')
  const taxonomy=await researchAreaTaxonomyService.listActiveTaxonomy()
  assert.equal(taxonomy.vocabulary,'canonical');assert.equal(taxonomy.areas.length,3)
  const saved=await researcherProfileService.saveResearchArea('areas-user',{label:'My custom topic',researchArea:'Immune responses to blood cancer cell therapy',isDefault:true,useForAlerts:false})
  const savedBefore=await db.researcherSavedResearchArea.findUniqueOrThrow({where:{id:saved.id}})
  await setManualAreaLinks('SAVED_AREA',saved.id,[ids.blood],'areas-user',db as any)
  const areas=await researcherProfileService.listResearchAreas('areas-user')
  assert.equal(areas[0].canonicalAreas?.[0].id,ids.blood)
  assert.equal(areas[0].researchArea,savedBefore.research_area)
  assert.equal(areas[0].useForAlerts,false)
  assert.equal(areas[0].isDefault,true)
  assert.equal((await db.researcherSavedResearchArea.findUniqueOrThrow({where:{id:saved.id}})).research_area,savedBefore.research_area)
  await setManualAreaLinks('SAVED_AREA',saved.id,[],'areas-user',db as any)
  assert.equal((await researcherProfileService.listResearchAreas('areas-user'))[0].taxonomy,null)
  console.log('PASS flat canonical selectors, free-text interests, confirmed areas and preference preservation on '+database)
 })
}
main().catch(error=>{console.error(error);process.exitCode=1})
