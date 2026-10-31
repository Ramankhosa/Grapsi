import assert from 'node:assert/strict'
import prisma from '../src/lib/prisma'
import { Prisma } from '../src/lib/prisma-generated'
import { responsibilitiesSql } from '../src/lib/fundingDept/callRegister'
import { pendencySql } from '../src/lib/fundingDept/pendencyReport'
import { coordinatorSql } from '../src/lib/fundingDept/hubScope'

// SELECT-only fixtures shadow every referenced operational table. The transaction
// also enforces READ ONLY. This script never mutates or notifies real users.
const now=new Date('2026-10-23T12:00:00Z')
const fixture=Prisma.sql`WITH
  scenarios AS (SELECT unnest(ARRAY['untouched','allocated','independent-draft','late-completed','late-submitted','on-time-submitted','on-time-closed','on-time-completed','wide','loi','source-closed','inactive','foreign','global-with-owner']) id),
  users AS (SELECT 'officer-a' id,'Officer A' name,'a@example.test' email,'tenant' "tenantId",'ACTIVE' status UNION ALL SELECT 'officer-b','Officer B','b@example.test','tenant','ACTIVE' UNION ALL SELECT 'officer-c','Officer C','c@example.test','tenant','ACTIVE' UNION ALL SELECT 'faculty','Faculty','f@example.test','tenant','ACTIVE'),
  tenant_org_units AS (SELECT 'school' id,'tenant' tenant_id,'Biotech' name,true is_active,ARRAY['school']::text[] path),
  funding_calls AS (SELECT id,id title,NULL::text scheme_title,NULL::text agency_name,NULL::text "agencyName",
    CASE WHEN id IN ('foreign','global-with-owner') THEN 'foreign-tenant' ELSE 'tenant' END "tenantId",
    CASE WHEN id='global-with-owner' THEN 'GLOBAL_PUBLISHED' ELSE 'TENANT_PRIVATE' END visibility,'PUBLISHED' status,'PUBLISHED' catalog_status,
    id<>'inactive' is_active,'2026-09-01'::timestamp "createdAt",'2026-09-01'::timestamp "publishedAt",
    CASE WHEN id IN ('loi','wide') THEN '2026-12-01'::timestamp WHEN id='source-closed' THEN NULL ELSE '2026-10-10'::timestamp END close_date,NULL::timestamp "deadlineAt",
    CASE WHEN id IN ('loi','source-closed') THEN 'import' END import_run_id,
    CASE WHEN id='loi' THEN '2026-10-01'::date END entry_closes_at,
    CASE WHEN id='loi' THEN '2026-12-01'::date END final_deadline_at,
    CASE WHEN id='source-closed' THEN '2026-10-20'::timestamp END source_closed_at,
    'Asia/Kolkata'::text deadline_timezone FROM scenarios),
  dsr_call_school_mappings AS (SELECT 'tenant' tenant_id,id call_id,'school' school_id,'INGESTION_DIRECT' source,'direct' tier,'Fixture' reason,false is_origin,'2026-09-01'::timestamp mapped_at,false backfilled,true is_active FROM scenarios),
  funding_opportunity_matches AS (SELECT 'tenant' tenant_id,'wide' funding_call_id,'school' school_id,'faculty' user_id,false inferred,true is_current,.40::float8 match_score,'weak' match_tier,'call-people-census-v2' source_version,'2026-09-02'::timestamp first_seen_at),
  call_assignments AS (SELECT id,id funding_call_id,'tenant' tenant_id,'school' assignee_org_unit_id,'IN_PROGRESS' status,
    '2026-10-02'::timestamp created_at,NULL::timestamp submitted_at,NULL::timestamp completed_at FROM scenarios WHERE id IN ('allocated','late-submitted','on-time-submitted')),
  dsr_applications AS (SELECT id,'tenant' tenant_id,id call_id,'school' school_id,
    CASE WHEN id='independent-draft' THEN NULL ELSE id END assignment_id,'IN_PROGRESS' assignment_status,
    CASE WHEN id IN ('on-time-submitted','late-submitted') THEN 'SUBMITTED' ELSE 'DRAFT' END proposal_status,NULL::text outcome,
    CASE WHEN id='on-time-submitted' THEN '2026-10-09'::timestamp WHEN id='late-submitted' THEN '2026-10-12'::timestamp END submitted_at
    FROM scenarios WHERE id IN ('allocated','late-submitted','on-time-submitted','independent-draft')),
  call_school_triage AS (SELECT 'tenant' tenant_id,id funding_call_id,'school' org_unit_id,
    CASE WHEN id='on-time-closed' THEN 'NOT_RELEVANT' ELSE 'NEW' END status,
    CASE WHEN id='on-time-closed' THEN '2026-10-08'::timestamp END decided_at,
    CASE WHEN id IN ('late-completed','on-time-completed') THEN '2026-10-08'::timestamp END action_completed_at,
    CASE WHEN id IN ('late-completed','on-time-completed') THEN 'OTHER' END action_completed_outcome,
    'Reviewed after deadline'::text action_completed_note,NULL::text action_completed_by_user_id,ARRAY[]::text[] escalation_stages
    FROM scenarios WHERE id IN ('on-time-closed','late-completed','on-time-completed')),
  dsr_opportunity_dispositions AS (SELECT NULL::text tenant_id,NULL::text call_id,NULL::text school_id,NULL::text reason,NULL::text explanation,NULL::timestamp updated_at WHERE false),
  dsr_actions AS (SELECT NULL::text tenant_id,NULL::text call_id,NULL::text school_id,NULL::text application_id,NULL::text status,NULL::timestamp due_at,NULL::timestamp created_at WHERE false),
  assignment_follow_ups AS (SELECT NULL::text tenant_id,NULL::text funding_call_id,NULL::text org_unit_id,NULL::timestamp happened_at WHERE false),
  dsr_events AS (SELECT 1::bigint id,'tenant' tenant_id,'school' school_id,'OWNERSHIP' entity_type,'cover-a' entity_id,'DELETE' kind,
    '{"member_id":"ma","is_deputy":false}'::jsonb before_data,NULL::jsonb after_data,'2026-10-15'::timestamp occurred_at
    UNION ALL SELECT 2,'tenant','school','OWNERSHIP','cover-c','INSERT',NULL,'{"member_id":"mc","is_deputy":false}'::jsonb,'2026-10-15'::timestamp
    UNION ALL SELECT 3,'tenant','school','REVIEW','late-completed','ACTION_COMPLETED',NULL,'{"outcome":"WORK_RECORDED","note":"Circulated"}'::jsonb,'2026-10-08'::timestamp
    UNION ALL SELECT 4,'tenant','school','REVIEW','late-completed','ACTION_COMPLETED',NULL,'{"outcome":"OTHER","note":"Closed after deadline"}'::jsonb,'2026-10-12'::timestamp
    UNION ALL SELECT 5,'tenant','school','REVIEW','on-time-completed','ACTION_COMPLETED',NULL,'{"outcome":"OTHER","note":"Closed before deadline"}'::jsonb,'2026-10-08'::timestamp),
  dsr_responsibility_transfers AS (SELECT 'tenant' tenant_id,'school' school_id,'wide' call_id,'officer-b' owner_user_id,'2026-09-01'::timestamp updated_at),
  funding_dept_members AS (SELECT 'ma' id,'tenant' tenant_id,'officer-a' user_id,false is_active,NULL::timestamp away_from,NULL::timestamp away_until UNION ALL SELECT 'mb','tenant','officer-b',true,NULL,NULL UNION ALL SELECT 'mc','tenant','officer-c',true,'2000-01-01'::timestamp,'2099-01-01'::timestamp),
  funding_dept_school_assignments AS (SELECT 'cover-c' id,'mc' member_id,'tenant' tenant_id,'school' org_unit_id,false is_deputy,'2026-10-15'::timestamp created_at UNION ALL SELECT 'cover-b','mb','tenant','school',true,'2026-09-01'::timestamp)`

function withFixture(query: Prisma.Sql) {
  const strings=[...query.strings]
  if(!/^\s*WITH\b/.test(strings[0])) return Prisma.sql`${fixture} ${query}`
  strings[0]=strings[0].replace(/^\s*WITH\b/,',')
  return Prisma.sql`${fixture} ${Prisma.sql(strings,...query.values)}`
}

async function main(){
  try {
    await prisma.$transaction(async tx=>{
      await tx.$executeRaw`SET TRANSACTION READ ONLY`
      const f={schoolIds:['school'],asOf:now,page:1,pageSize:100,timeZone:'Asia/Kolkata',width:'WIDE' as const}
      const pend=await tx.$queryRaw<Array<{call_id:string;state:string;matched_faculty:number;coordinator_id:string}>>(withFixture(Prisma.sql`${pendencySql('tenant',f)} SELECT * FROM pend ORDER BY call_id`))
      const byId=new Map(pend.map(r=>[r.call_id,r]))
      for(const id of ['untouched','allocated','independent-draft','late-completed','late-submitted','loi','source-closed','global-with-owner']) assert.equal(byId.get(id)?.state,'MISSED',id)
      assert.equal(byId.get('wide')?.state,'PENDING')
      assert.equal(byId.get('wide')?.matched_faculty,1)
      assert.equal(byId.get('wide')?.coordinator_id,'officer-b','per-call transfer wins over primary school')
      assert.equal(byId.get('untouched')?.coordinator_id,'officer-a','missed work belongs to owner at deadline, not replacement C')
      assert.equal(byId.get('on-time-closed')?.state,'COMPLETED_NO_ALLOCATION')
      assert.equal(byId.get('on-time-completed')?.state,'COMPLETED_NO_ALLOCATION')
      for(const id of ['on-time-submitted','inactive','foreign']) assert.ok(!byId.has(id),id)
      const register=await tx.$queryRaw<Array<{call_id:string;deadline_state:string}>>(withFixture(Prisma.sql`${responsibilitiesSql('tenant',{scopeSchoolIds:['school'],asOf:now,timeZone:'Asia/Kolkata',attention:'MISSED'})} SELECT * FROM filtered`))
      assert.equal(register.length,8)
      assert.equal(register.find(r=>r.call_id==='allocated')?.deadline_state,'MISSED_ALLOCATED_NOT_SUBMITTED')
      assert.equal(register.find(r=>r.call_id==='late-submitted')?.deadline_state,'MISSED_ALLOCATED_NOT_SUBMITTED')
      assert.equal(register.find(r=>r.call_id==='untouched')?.deadline_state,'MISSED_NEVER_ALLOCATED')
      const [cover]=await tx.$queryRaw<Array<{owner:string}>>(withFixture(Prisma.sql`SELECT ${coordinatorSql('tenant','s.id','fc.id')} owner FROM funding_calls fc CROSS JOIN tenant_org_units s WHERE fc.id='untouched'`))
      assert.equal(cover.owner,'officer-b','an available deputy covers an away primary')
      console.log('READ-ONLY SQL fixtures passed: complete backlog, zero matches, independent drafts, late closure/submission, imported LOI/source closure, active visibility, global ownership, WIDE matches, transferred member and both missed drill-down categories.')
    },{timeout:30000})
  } finally {await prisma.$disconnect()}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Validation failed');process.exitCode=1})
