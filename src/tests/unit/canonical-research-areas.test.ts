import { describe,it,expect } from 'vitest'
import { activeCallExclusion,intakeCallExclusion,shortlistAreas,validateAreaDecision,researchContent,cosineSimilarity,estimateAreaCost,type ClassificationInput } from '@/lib/researchAreas/core'

const call:ClassificationInput={id:'old-call',title:'Blood cancer research',description:'This grant funds hematopoietic stem cell transplantation and cell manufacturing to treat blood cancer. Research must address immune complications and cell therapy.',tags:['cell manufacturing'],published:true,active:true,rolling:false,deadline:'2026-11-16'}
const candidates=[{id:'blood',label:'Hematology',similarity:.8},{id:'engineering',label:'Mechanical engineering',similarity:.7},{id:'all',label:'All disciplines',similarity:.2}]
const decision={scope:'SPECIFIC',areaIds:['blood'],evidence:[{areaId:'blood',quote:'to treat blood cancer'}],needsReview:false,shortlistInsufficient:false,reason:'The stated funding purpose is treatment of blood cancer.'}
describe('canonical research area safety',()=>{
 it('classifies linked intake drafts without expanding the historical batch',()=>{
  const draft={...call,published:false,active:false,deadline:null}
  expect(activeCallExclusion(draft,'2026-10-22')).toBe('not_published_active')
  expect(intakeCallExclusion(draft,true,'2026-10-22')).toBeNull()
  expect(intakeCallExclusion(draft,false,'2026-10-22')).toBe('not_intake_draft')
  expect(intakeCallExclusion({...draft,importRunId:'source'},true,'2026-10-22')).toBe('imported_call_preserved')
  expect(intakeCallExclusion({...draft,deadline:'2020-01-01'},true,'2026-10-22')).toBe('deadline_passed')
 })
 it('limits the old-call batch to published active accepting opportunities',()=>{
  expect(activeCallExclusion(call,'2026-10-22')).toBeNull()
  expect(activeCallExclusion({...call,importRunId:'import'},'2026-10-22')).toBe('imported_call_preserved')
  expect(activeCallExclusion({...call,deadline:'2026-10-01'},'2026-10-22')).toBe('deadline_passed')
  expect(activeCallExclusion({...call,deadline:'2026-10-01',rolling:true},'2026-10-22')).toBe('rolling_deadline_conflict')
  expect(activeCallExclusion({...call,openDate:'2027-01-01',rolling:true},'2026-10-22')).toBe('not_yet_open')
  expect(activeCallExclusion({...call,published:false},'2026-10-22')).toBe('not_published_active')
  expect(activeCallExclusion({...call,deadline:null},'2026-10-22')).toBe('unknown_deadline')
 })
 it('uses embeddings as a shortlist while retaining broad and exact candidates',()=>{
  const rows=[{id:'blood',label:'Hematology',embedding:[1,0]},{id:'eng',label:'Mechanical engineering',embedding:[0,1]},{id:'all',label:'All disciplines',embedding:[-1,0]},{id:'other',label:'Biotechnology',embedding:[0,-1]}]
  const selected=shortlistAreas(rows,[1,0],['Biotechnology'],1)
  expect(selected.map(a=>a.id)).toEqual(['blood','other','all'])
  expect(selected[0].similarity).toBe(1)
 })
 it('does not trust malformed paragraphs as curated discipline tags',()=>{
  expect(researchContent({...call,tags:['x'.repeat(1000)]})).not.toContain('x'.repeat(1000))
 })
 it('requires known IDs and actual research evidence rather than similarity',()=>{
  expect(validateAreaDecision(decision,candidates,call).areaIds).toEqual(['blood'])
  expect(()=>validateAreaDecision({...decision,areaIds:['invented']},candidates,call)).toThrow()
  expect(()=>validateAreaDecision({...decision,evidence:[{areaId:'blood',quote:'Unsupported invented evidence'}]},candidates,call)).toThrow(/evidence/)
  expect(()=>validateAreaDecision({...decision,areaIds:['blood','blood']},candidates,call)).toThrow()
 })
 it('never automatically supersedes a human classification',()=>{
  expect(validateAreaDecision(decision,candidates,{...call,hasManualMapping:true}).needsReview).toBe(true)
 })
 it('distinguishes all disciplines from a broad interdisciplinary list',()=>{
  expect(()=>validateAreaDecision({...decision,scope:'ALL'},candidates,call)).toThrow(/all-disciplines/)
  expect(()=>validateAreaDecision({...decision,scope:'UNKNOWN'},candidates,call)).toThrow(/scope/)
  const unknown=validateAreaDecision({...decision,scope:'UNKNOWN',areaIds:[],evidence:[]},candidates,call)
  expect(unknown.needsReview).toBe(true)
 })
 it('rejects incompatible or invalid vectors',()=>{
  expect(()=>cosineSimilarity([1,0],[1])).toThrow()
  expect(()=>cosineSimilarity([NaN],[1])).toThrow()
  expect(cosineSimilarity([0,0],[1,0])).toBe(0)
 })
 it('estimates the small active-call batch within its allowance',()=>{
  expect(estimateAreaCost(58).estimatedUsd).toBeLessThan(1)
  expect(estimateAreaCost(58).budgetUsd).toBe(2)
 })
})
