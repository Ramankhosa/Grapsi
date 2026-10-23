import assert from 'node:assert/strict'
import prisma from '../src/lib/prisma'
import { Prisma } from '../src/lib/prisma-generated'
import { storedCallMatches } from '../src/lib/fundingDept/callMatchCensus'
import { currentQualifyingMatchSql } from '../src/lib/fundingDept/reportDefinitions'

async function main() {
  const original = prisma.$queryRaw.bind(prisma)
  const fixture = Prisma.sql`WITH
    users AS (SELECT 'p'||i id,'Person '||i name,'p'||i||'@example.test' email,
      'tenant' "tenantId",CASE WHEN i=46 THEN 'INACTIVE' ELSE 'ACTIVE' END status FROM generate_series(1,48) i),
    researcher_profiles AS (SELECT 'p'||i user_id,'Department' department,ARRAY['Biotech']::text[] research_areas FROM generate_series(1,48) i),
    funding_opportunity_matches AS (SELECT 'p'||i user_id,'tenant' tenant_id,'call' funding_call_id,
      'unit' org_unit_id,CASE WHEN i BETWEEN 41 AND 45 THEN 'other-school' ELSE 'biotech' END school_id,
      CASE WHEN i<=8 OR i>40 THEN .7 ELSE .4 END::float8 match_score,
      'strong' match_tier,'Fixture' match_reason,true is_current,false inferred,
      CASE WHEN i=47 THEN 'manual-allocation-v1' WHEN i=48 THEN 'person-call-census-v1' ELSE 'call-people-census-v2' END source_version
      FROM generate_series(1,48) i)`
  // SELECT-only CTE fixtures shadow the real tables; no records are written.
  ;(prisma as any).$queryRaw = (query: Prisma.Sql) => original(Prisma.sql`${fixture} ${query}`)
  try {
    for (const [width,expected] of [['NARROW',8],['BALANCED',8],['WIDE',40]] as const) {
      const people = await storedCallMatches('tenant','call',['biotech'],null,width)
      const counts = await original<Array<{n:number}>>(Prisma.sql`${fixture}
        SELECT count(*)::int n FROM funding_opportunity_matches m WHERE m.tenant_id='tenant'
          AND m.funding_call_id='call' AND m.school_id='biotech' AND ${currentQualifyingMatchSql('m',width)}`)
      assert.equal(people.length,expected)
      assert.equal(people.length,counts[0].n)
      assert.ok(people.every(p=>p.schoolId==='biotech' && !['p46','p47','p48'].includes(p.userId)))
      console.log(`${width}: count and list both ${expected}; other-school, inactive and retired/manual rows excluded`)
    }
  } finally { (prisma as any).$queryRaw=original; await prisma.$disconnect() }
}
main().catch(error=>{console.error(error instanceof Error ? error.message : 'Validation failed');process.exitCode=1})
