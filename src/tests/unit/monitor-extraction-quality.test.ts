import { describe,expect,it } from 'vitest'
import { validateExtraction,groundedValue } from '@/lib/monitor/extract'
import { EXTRACTION_SCHEMA, explicitApplicationInvitation, extractionQuality } from '@/lib/monitor/extractionContract'
import { lifecycleAt,type EvidenceSegment } from '@/lib/monitor/evidence'
import { roundIdentity } from '@/lib/monitor/matching'
const text='Alpha Foundation invites applications for Alpha Research Grant 2026. It supports university research. Applications close on 30 November 2026.'
const segment:EvidenceSegment={id:'E1',resourceId:'r',versionId:'v',url:'https://funder.invalid/call',role:'CALL_NOTICE',page:null,text,complete:true}
const field=(value:unknown)=>({value,citations:[{segment:'E1',quote:text,coverage:'COMPLETE'}]})
describe('opportunity evidence quality',()=>{
 it('requires every typed nullable field for strict OpenAI structured extraction',()=>{
  function check(schema:any){if(schema.type==='object'){expect(schema.additionalProperties).toBe(false);expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());for(const child of Object.values(schema.properties))check(child)}if(schema.type==='array')check(schema.items)}
  check(EXTRACTION_SCHEMA)
  for(const field of Object.values(EXTRACTION_SCHEMA.properties.fields.properties) as any[])expect(field.properties.value.type).toContain('null')
 })
 it.each(['Apply for Proposal','Submit an Application','Applications for Indo-German IRTGs intended for DFG-DST funding are open'])('accepts literal source invitation wording: %s',quote=>{
  const input={value:true,citations:[{segment:'E1',quote,coverage:'COMPLETE'}]}
  expect(validateExtraction({fields:{application_invitation:input}},[{...segment,text:quote}]).invitationVerified).toBe(true)
  expect(validateExtraction({fields:{application_invitation:input}},[segment]).invitationVerified).toBe(false)
 })
 it.each(['Applications for the next round will open soon','Applications for Alpha are not open','Apply for Proposal next month','The call was promoted last year'])('keeps future, negative and promotional wording unresolved: %s',quote=>{expect(explicitApplicationInvitation(quote)).toBe(false)})
 it('does not let an invitation alone establish an open application window',()=>{
  const quote='Submit an Application',r=validateExtraction({fields:{agency_name:field('Alpha Foundation'),scheme_title:field('Alpha Research Grant 2026'),description:field('It supports university research.'),application_invitation:{value:true,citations:[{segment:'E1',quote,coverage:'COMPLETE'}]}}},[{...segment,text:text+' '+quote}])
  expect(r.invitationVerified).toBe(true);expect(extractionQuality(r.payload,r.coverage,true).state).toBe('PARTIAL')
 })
 it('does not invent a funding round from an extended deadline',()=>{expect(roundIdentity('Alpha Scheme','REF-7','2027-01-01','funder').roundKey).toBeNull();expect(roundIdentity('Alpha Scheme','REF-7','2027-01-01','funder','Round 2026').roundKey).toBe('Round 2026')})
 it('keeps ambiguous dates and project deadlines from proving an application deadline',()=>{expect(groundedValue('close_date','2026-11-10','Application deadline 10/11/2026')).toBe(false);expect(groundedValue('close_date','2026-11-30','Project completion deadline 30 November 2026')).toBe(false);expect(groundedValue('close_date','2026-11-30','Applications open 10 November 2026 and close 30 December 2026')).toBe(false)})
 it.each(['Call for proposals','Applications will be invited next month'])('does not turn a promotional phrase into an active invitation: %s',quote=>{
  const r=validateExtraction({fields:{application_invitation:{value:true,citations:[{segment:'E1',quote,coverage:'COMPLETE'}]}}},[{...segment,text:quote}]);expect(r.invitationVerified).toBe(false)
 })
 it('marks empty extraction insufficient rather than successful',()=>{const r=validateExtraction({fields:{}},[segment]);expect(extractionQuality(r.payload,r.coverage,r.invitationVerified).state).toBe('INSUFFICIENT')})
 it('allows a supported genuine invitation with no invented amount',()=>{const r=validateExtraction({fields:{agency_name:field('Alpha Foundation'),scheme_title:field('Alpha Research Grant 2026'),description:field('It supports university research.'),close_date:field('2026-11-30'),application_invitation:field(true),amount_max:field(999999)}},[segment]);expect(r.payload.fields.amount_max.value).toBeNull();expect(extractionQuality(r.payload,r.coverage,r.invitationVerified).state).toBe('READY')})
 it('requires an invitation even when programme facts are available',()=>{const r=validateExtraction({fields:{agency_name:field('Alpha Foundation'),scheme_title:field('Alpha Research Grant 2026'),description:field('It supports university research.'),close_date:field('2026-11-30')}},[segment]);expect(extractionQuality(r.payload,r.coverage,r.invitationVerified).state).toBe('PARTIAL')})
 it('does not let a rolling label override a past deadline or a future opening',()=>{expect(lifecycleAt('2020-01-01',null,'ROLLING')).toBe('EXPIRED');expect(lifecycleAt(null,'2099-01-01','ROLLING')).toBe('FUTURE')})
})
