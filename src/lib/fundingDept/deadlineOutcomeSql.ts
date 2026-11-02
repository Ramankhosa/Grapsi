import { Prisma } from '@/lib/prisma-generated'
import { DEFAULT_TIMEZONE } from '@/lib/i18n/format'
import { callDeadlineZoneSql, effectiveCallDeadlineSql } from './callSql'
import { trustedDeadlineSubmissionSql } from './submissionEvidenceSql'

/** End of the entry day in UTC; an earlier explicit source closure takes precedence. */
export function callDeadlineEndSql(alias = 'fc', timeZone = DEFAULT_TIMEZONE): Prisma.Sql {
  const a = Prisma.raw(alias)
  return Prisma.sql`LEAST(((${effectiveCallDeadlineSql(alias,timeZone)}::date + 1)::timestamp
    AT TIME ZONE ${callDeadlineZoneSql(alias,timeZone)}) AT TIME ZONE 'UTC',
    CASE WHEN ${a}.import_run_id IS NOT NULL THEN ${a}.source_closed_at END)`
}

/** Facts before entry closed. Late allocations, submissions and closures cannot erase a miss. */
export function schoolDeadlineFactsSql(tenantId: string, school: string | Prisma.Sql, alias = 'fc', timeZone = DEFAULT_TIMEZONE): Prisma.Sql {
  const call = Prisma.raw(`${alias}.id`), schoolId = typeof school==='string' ? Prisma.raw(school) : school
  const end = callDeadlineEndSql(alias,timeZone)
  return Prisma.sql`SELECT
    (SELECT count(*)::int FROM call_assignments a JOIN tenant_org_units u ON u.id=a.assignee_org_unit_id
      WHERE a.tenant_id=${tenantId} AND a.funding_call_id=${call} AND u.path[1]=${schoolId} AND a.created_at < ${end}) allocations,
    (SELECT count(*)::int FROM dsr_applications a LEFT JOIN call_assignments ca ON ca.id=a.assignment_id AND ca.tenant_id=a.tenant_id
      WHERE a.tenant_id=${tenantId} AND a.call_id=${call} AND a.school_id=${schoolId}
        AND COALESCE(a.submitted_at,ca.completed_at) < ${end}
        AND ${trustedDeadlineSubmissionSql(end)}) submissions,
    (EXISTS (SELECT 1 FROM call_school_triage t WHERE t.tenant_id=${tenantId} AND t.org_unit_id=${schoolId} AND t.funding_call_id=${call}
        AND t.status='NOT_RELEVANT' AND t.decided_at < ${end})
      OR EXISTS (SELECT 1 FROM dsr_opportunity_dispositions d WHERE d.tenant_id=${tenantId} AND d.school_id=${schoolId} AND d.call_id=${call}
        AND d.reason IN ('NO_SUITABLE_FACULTY','DECLINED','CAPACITY','OTHER') AND d.updated_at < ${end})
      OR EXISTS (SELECT 1 FROM (
        SELECT e.kind,e.after_data FROM dsr_events e WHERE e.tenant_id=${tenantId} AND e.school_id=${schoolId}
          AND e.entity_type='REVIEW' AND e.entity_id=${call} AND e.kind IN ('ACTION_COMPLETED','ACTION_REOPENED') AND e.occurred_at < ${end}
          ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1
      ) completion WHERE completion.kind='ACTION_COMPLETED'
        AND completion.after_data->>'outcome' IN ('NO_SUITABLE_FACULTY','NOT_RELEVANT','CAPACITY','OTHER')
        AND length(btrim(completion.after_data->>'note'))>0)) closed`
}

/** Accountable owner at closing, reconstructed from dated transfers and coverage history.
 * Missing historical evidence stays unassigned instead of blaming today's replacement. */
export function deadlineCoordinatorSql(tenantId:string,school:string,alias='fc',timeZone=DEFAULT_TIMEZONE):Prisma.Sql {
  return historicalCoordinatorSql(tenantId, school, `${alias}.id`, callDeadlineEndSql(alias,timeZone))
}

/** Recorded responsibility at a point in time; unavailable history remains unassigned. */
export function historicalCoordinatorSql(tenantId: string, school: string, callExpression: string, end: Prisma.Sql): Prisma.Sql {
  const schoolId=Prisma.raw(school),call=Prisma.raw(callExpression)
  return Prisma.sql`COALESCE(
    (SELECT e.after_data->>'ownerUserId' FROM dsr_events e WHERE e.tenant_id=${tenantId} AND e.school_id=${schoolId}
      AND e.entity_type='RESPONSIBILITY' AND e.entity_id=${call} AND e.kind='TRANSFER' AND e.occurred_at < ${end}
      ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1),
    (SELECT tr.owner_user_id FROM dsr_responsibility_transfers tr WHERE tr.tenant_id=${tenantId} AND tr.school_id=${schoolId} AND tr.call_id=${call} AND tr.updated_at < ${end}),
    (SELECT e.before_data->0->>'owner_user_id' FROM dsr_events e WHERE e.tenant_id=${tenantId} AND e.school_id=${schoolId}
      AND e.entity_type='RESPONSIBILITY' AND e.entity_id=${call} AND e.kind='TRANSFER' AND e.occurred_at >= ${end}
      ORDER BY e.occurred_at,e.id LIMIT 1),
    (WITH history AS (
      SELECT DISTINCT ON(e.entity_id) e.entity_id,
        CASE WHEN e.occurred_at < ${end} THEN e.after_data ELSE e.before_data END data
      FROM dsr_events e WHERE e.tenant_id=${tenantId} AND e.school_id=${schoolId} AND e.entity_type='OWNERSHIP'
      ORDER BY e.entity_id,(e.occurred_at < ${end}) DESC,
        CASE WHEN e.occurred_at < ${end} THEN e.occurred_at END DESC,e.occurred_at,e.id
    ), snapshots AS (
      SELECT entity_id,data FROM history
      UNION ALL SELECT sa.id,to_jsonb(sa) FROM funding_dept_school_assignments sa
        WHERE sa.tenant_id=${tenantId} AND sa.org_unit_id=${schoolId} AND sa.created_at < ${end}
          AND NOT EXISTS(SELECT 1 FROM history h WHERE h.entity_id=sa.id)
    ) SELECT dm.user_id FROM snapshots s JOIN funding_dept_members dm ON dm.id=s.data->>'member_id' AND dm.tenant_id=${tenantId}
       WHERE s.data->>'is_deputy'='false' ORDER BY s.entity_id LIMIT 1))`
}
