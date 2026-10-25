import { describe,expect,it } from 'vitest'
import { validateExtraction } from '@/lib/monitor/extract'
import { extractionQuality } from '@/lib/monitor/extractionContract'
import { lifecycleAt,type EvidenceSegment } from '@/lib/monitor/evidence'
const text='Alpha Foundation invites applications for Alpha Research Grant 2026. It supports university research. Applications close on 30 November 2026.'
const segment:EvidenceSegment={id:'E1',resourceId:'r',versionId:'v',url:'https://funder.invalid/call',role:'CALL_NOTICE',page:null,text,complete:true}
const field=(value:unknown)=>({value,citations:[{segment:'E1',quote:text,coverage:'COMPLETE'}]})
describe('opportunity evidence quality',()=>{
 it('marks empty extraction insufficient rather than successful',()=>{const r=validateExtraction({fields:{}},[segment]);expect(extractionQuality(r.payload,r.coverage,r.invitationVerified).state).toBe('INSUFFICIENT')})
 it('allows a supported genuine invitation with no invented amount',()=>{const r=validateExtraction({fields:{agency_name:field('Alpha Foundation'),scheme_title:field('Alpha Research Grant 2026'),description:field('It supports university research.'),close_date:field('2026-11-30'),application_invitation:field(true),amount_max:field(999999)}},[segment]);expect(r.payload.fields.amount_max.value).toBeNull();expect(extractionQuality(r.payload,r.coverage,r.invitationVerified).state).toBe('READY')})
 it('requires an invitation even when programme facts are available',()=>{const r=validateExtraction({fields:{agency_name:field('Alpha Foundation'),scheme_title:field('Alpha Research Grant 2026'),description:field('It supports university research.'),close_date:field('2026-11-30')}},[segment]);expect(extractionQuality(r.payload,r.coverage,r.invitationVerified).state).toBe('PARTIAL')})
 it('does not let a rolling label override a past deadline or a future opening',()=>{expect(lifecycleAt('2020-01-01',null,'ROLLING')).toBe('EXPIRED');expect(lifecycleAt(null,'2099-01-01','ROLLING')).toBe('FUTURE')})
})
