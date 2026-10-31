import assert from 'node:assert/strict'
import prisma from '../src/lib/prisma'
import { Prisma } from '../src/lib/prisma-generated'

// Every application table read by this preview is shadowed by a SELECT CTE.
// The real connection is read-only; no fixture rows are inserted anywhere.
const fixture = Prisma.sql`WITH
 users AS (SELECT 'p'||i id,'Faculty '||i name,'p'||i||'@example.test' email,
   CASE WHEN i=12 THEN 'other' ELSE 'fixture-lpu' END "tenantId",CASE WHEN i=13 THEN 'INACTIVE' ELSE 'ACTIVE' END status,
   '2026-10-01'::timestamp "updatedAt",'1'::text xmin FROM generate_series(1,13) i
   UNION ALL SELECT 'officer','Coordinator','o@example.test','fixture-lpu','ACTIVE','2026-10-01'::timestamp,'1'),
 tenant_org_units AS (SELECT 'school' id,'School' name,'fixture-lpu' tenant_id,true is_active,0 depth,ARRAY['school']::text[] path,'2026-10-01'::timestamp updated_at,'1'::text xmin
   UNION ALL SELECT 'dept','Department','fixture-lpu',true,1,ARRAY['school','dept'],'2026-10-01'::timestamp,'1'
   UNION ALL SELECT 'moved-school','Moved School','fixture-lpu',true,0,ARRAY['moved-school'],'2026-10-01'::timestamp,'1'),
 researcher_profiles AS (SELECT 'profile'||i id,'p'||i user_id,NULL::text display_name,
   CASE WHEN i=10 THEN NULL WHEN i=11 THEN 'moved-school' ELSE 'dept' END org_unit_id,
   CASE WHEN i=9 THEN NULL ELSE 'indexed' END embedding_voyage_1024,'Research'::text research_summary,ARRAY['AI']::text[] research_areas,ARRAY[]::text[] keywords,
   NULL::text career_stage,NULL::text institution_type,'2026-10-01'::timestamp updated_at,'1'::text xmin FROM generate_series(1,13) i),
 funding_calls AS (SELECT id,id title,NULL::text scheme_title,'fixture-lpu'::text "tenantId",'PUBLISHED'::text status,'PUBLISHED'::text catalog_status,true is_active,
   CASE WHEN id='catalogue' THEN 'GLOBAL_CATALOG' WHEN id='foreign' THEN 'TENANT_PRIVATE' ELSE 'GLOBAL_PUBLISHED' END visibility,
   '2099-12-31'::timestamp close_date,NULL::timestamp "deadlineAt",NULL::text import_run_id,NULL::date entry_closes_at,NULL::date final_deadline_at,
   NULL::timestamp source_closed_at,NULL::text deadline_timezone,'2026-10-01'::timestamp "updatedAt",'1'::text xmin
   FROM unnest(ARRAY['call','catalogue','foreign']) id WHERE id<>'foreign'),
 funding_opportunity_matches AS (SELECT 'fixture-lpu'::text tenant_id,'call'::text funding_call_id,'p'||i user_id,'school'::text school_id,
   CASE WHEN i=9 THEN .2 ELSE .8 END::float8 match_score,'weak'::text match_tier,'Relevant methods'::text match_reason,false inferred,
   'call-people-census-v2'::text source_version,true is_current FROM generate_series(1,13) i),
 dsr_call_school_mappings AS (SELECT 'fixture-lpu'::text tenant_id,'call'::text call_id,'moved-school'::text school_id,true is_active),
 dsr_call_match_state AS (SELECT NULL::text tenant_id,NULL::text call_id,NULL::text version,NULL::text fingerprint,NULL::text basis,NULL::timestamp refreshed_at WHERE false),
 dsr_responsibility_transfers AS (SELECT 'fixture-lpu'::text tenant_id,'call'::text call_id,'school'::text school_id,'officer'::text owner_user_id),
 funding_dept_members AS (SELECT 'member'::text id,'officer'::text user_id,'fixture-lpu'::text tenant_id,true is_active,NULL::timestamp away_from,NULL::timestamp away_until),
 funding_dept_school_assignments AS (SELECT 'assignment'::text id,'fixture-lpu'::text tenant_id,'member'::text member_id,'school'::text org_unit_id,false is_deputy),
 researcher_saved_research_areas AS (SELECT NULL::text id,NULL::text user_id,NULL::timestamp updated_at,NULL::text xmin WHERE false),
 reference_library AS (SELECT NULL::text id,NULL::text user_id,NULL::timestamp "updatedAt",NULL::text xmin WHERE false),
 funding_call_research_area_taxonomies AS (SELECT NULL::text funding_call_id,NULL::text taxonomy_area_id,NULL::text taxonomy_level1_name,NULL::text taxonomy_level2_name WHERE false)
`

async function main() {
  process.env.CANONICAL_RESEARCH_AREAS_ENABLED = 'false'
  const { researcherRoutingPreview } = await import('../src/lib/fundingDept/researcherRoutingPreview')
  const original = prisma.$transaction.bind(prisma)
  // This interception is local to this verification process. It executes the
  // actual preview query objects against the shadow CTEs in a real PostgreSQL transaction.
  const intercepted = async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => original(async tx => {
    const wrapped = new Proxy(tx, { get(target, key) {
      if (key === '$queryRaw') return (sql: Prisma.Sql) => target.$queryRaw(Prisma.sql`${fixture} ${sql}`)
      if (key === 'fundingCall') return { findFirst: async () => ({ id: 'call', title: 'Fixture call', scheme_title: null, career_stages: [], institution_types: [] }) }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } })
    return fn(wrapped)
  }, options)
  try {
    Object.assign(prisma, { $transaction: intercepted })
    const result = await researcherRoutingPreview('fixture-lpu')
    assert.equal(result.previewOnly, true)
    assert.equal(result.activationEnabled, false)
    assert.equal(result.calls.length, 1, 'Catalogue-only calls must not become operational preview work')
    assert.equal(result.coverage.profiles, 11, 'Exclude inactive and foreign-tenant profiles')
    assert.equal(result.coverage.unplaced, 1)
    assert.equal(result.coverage.missingEmbedding, 1)
    const school = result.schools.find(s => s.id === 'school')!
    assert.equal(school.coordinator, 'Coordinator', 'Call ID remains bound correctly through nested coordinator SQL')
    assert.equal(school.matchingPeople, 8)
    assert.equal(school.people.length, 8)
    assert.equal(school.borderlinePeople, 1)
    assert.equal(school.placementConflicts, 2, 'Unplaced and moved faculty must not inflate school totals')
    assert.equal(result.schools.find(s => s.id === 'moved-school')?.status, 'INSTITUTIONAL_REVIEW')
    assert.equal(result.snapshotStatus, 'MISSING', 'No census must not be interpreted as a validated zero')
    console.log('PASS real PostgreSQL SELECT-only routing preview: 8 counted/listed people, tenant isolation, moved/unplaced exclusions, catalogue fence, coordinator bindings, readiness and missing-result state.')
  } finally {
    Object.assign(prisma, { $transaction: original })
    await prisma.$disconnect()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
