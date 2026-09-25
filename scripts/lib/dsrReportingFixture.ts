/**
 * One tenant exercising every case the DSR reporting fix has to get right.
 * Built inside a disposable database only (see disposableDb.ts).
 *
 * Schools
 *   ENG  Engineering  areas: Mechanical, Electrical; keyword "robotics"; primary officer A, deputy
 *   MED  Medicine     area: Pharmacology; primary officer A
 *   SCI  Science      area: Chemistry; primary officer C
 *   ART  Arts         no areas, no keywords, no coordinator
 *
 * Calls (deadlines relative to now)
 *   dup          Mechanical; arrived twice (import CREATED + intake flagged duplicate); origin ENG
 *   three        Mechanical + Pharmacology + Chemistry; no match anywhere — the routing gap
 *   unclassified no classification at all
 *   expiredIdle  Chemistry; deadline passed; nothing done
 *   expiredLive  Mechanical; deadline passed; one allocation still in progress
 *   partial      Mechanical; three allocations: one submitted, one drafting, one declined
 *   realloc      Pharmacology; first allocation declined, second made to another person
 *   independent  Chemistry; faculty applied and submitted with no allocation
 *   reviewed     Electrical; ENG marked it relevant; nobody allocated
 *   notRelevant  Pharmacology; MED marked it not relevant, with a reason
 *   broadKeyword Civil (ENG's discipline group, not its area) + "robotics" tag
 *   broadOnly    Civil only
 *   closingSoon  Chemistry; 3 days left; untouched
 *   future       Pharmacology; 60 days left; allocated
 *   failedIntake an intake job that failed before any call existed
 * plus one ad-hoc independent proposal with no call at all (SCI).
 */
import type { PrismaClient } from '@prisma/client'

const DAY = 86400000

export async function buildReportingFixture(db: PrismaClient, label = 'fixture') {
  const now = new Date()
  const at = (days: number) => new Date(now.getTime() + days * DAY)
  const tenant = await db.tenant.create({ data: { name: `DSR reporting ${label}`, atiId: `dsr-reporting-${label}-${now.getTime()}` } })
  const tenantId = tenant.id
  const user = (name: string) => db.user.create({ data: { tenantId, email: `${name}-${tenantId}@example.invalid`, name, status: 'ACTIVE', roles: ['MANAGER'] } })
  const [head, officerA, officerC, deputy, fA1, fA2, fA3, fB1, fB2, fC1] = await Promise.all(
    ['head', 'officerA', 'officerC', 'deputy', 'fA1', 'fA2', 'fA3', 'fB1', 'fB2', 'fC1'].map(user))

  // Discipline catalog: two level-1 groups, Engineering has three areas.
  const upload = await db.researchAreaTaxonomyUpload.create({ data: { uploaded_by: head.id, status: 'ACTIVE', source_name: 'Fixture' } })
  const area = (code: string, l1: string, l1n: string, l2: string) => db.researchAreaTaxonomyArea.create({ data: { upload_id: upload.id, level1_code: l1, level1_name: l1n, level2_code: code, level2_name: l2 } })
  const [mech, elec, civil, pharm, chem] = await Promise.all([
    area('ENG-M', 'ENG', 'Engineering', 'Mechanical'), area('ENG-E', 'ENG', 'Engineering', 'Electrical'), area('ENG-C', 'ENG', 'Engineering', 'Civil'),
    area('MED-P', 'MED', 'Medicine', 'Pharmacology'), area('NAT-C', 'NAT', 'Natural sciences', 'Chemistry')])

  const school = (name: string, keywords: string[] = []) => db.tenantOrgUnit.create({ data: { tenant_id: tenantId, name, kind: 'SCHOOL', keywords } })
  const eng = await school('Engineering', ['robotics']); const med = await school('Medicine'); const sci = await school('Science'); const art = await school('Arts')
  for (const [unit, areas] of [[eng, [mech, elec]], [med, [pharm]], [sci, [chem]]] as const)
    for (const a of areas) await db.tenantOrgUnitResearchArea.create({ data: { tenant_id: tenantId, org_unit_id: unit.id, taxonomy_area_id: a.id } })

  const member = (u: { id: string }, isHead = false) => db.fundingDeptMember.create({ data: { tenant_id: tenantId, user_id: u.id, is_head: isHead } })
  const [mHead, mA, mC, mDep] = [await member(head, true), await member(officerA), await member(officerC), await member(deputy)]
  const cover = (m: { id: string }, unit: { id: string }, isDeputy = false) => db.fundingDeptSchoolAssignment.create({ data: { tenant_id: tenantId, member_id: m.id, org_unit_id: unit.id, is_deputy: isDeputy, assigned_by_user_id: head.id } })
  await cover(mA, eng); await cover(mA, med); await cover(mC, sci); await cover(mDep, eng, true)
  // Unrelated research interests keep automated matching out of the picture.
  for (const [f, unit] of [[fA1, eng], [fA2, eng], [fA3, eng], [fB1, med], [fB2, med], [fC1, sci]] as const)
    await db.researcherProfile.create({ data: { user_id: f.id, org_unit_id: unit.id, display_name: f.name!, research_areas: ['zz fixture unrelated interest'] } })

  const created = at(-20)
  const call = (title: string, deadline: Date | null, extra: Record<string, unknown> = {}) => db.fundingCall.create({ data: {
    tenantId, createdByUserId: head.id, updatedByUserId: head.id, title, scheme_title: title, visibility: 'TENANT_PRIVATE', status: 'PUBLISHED',
    deadlineAt: deadline, createdAt: created, ...extra } })
  const classify = async (callId: string, areas: Array<typeof mech>) => {
    for (const a of areas) await db.fundingCallResearchAreaTaxonomy.create({ data: { funding_call_id: callId, taxonomy_area_id: a.id, taxonomy_level1_code: a.level1_code,
      taxonomy_level1_name: a.level1_name, taxonomy_level2_code: a.level2_code, taxonomy_level2_name: a.level2_name, source: 'alias' } })
  }
  const calls = {
    dup: await call('Duplicate robotics call', at(30), { origin_school_id: eng.id, origin_school_name: 'Engineering', origin_school_source: 'SELECTED_AT_INTAKE' }),
    three: await call('Cross-disciplinary call', at(30)),
    unclassified: await call('Unclassified call', at(30)),
    expiredIdle: await call('Expired untouched call', at(-5)),
    expiredLive: await call('Expired call with live work', at(-5)),
    partial: await call('Partly submitted call', at(10)),
    realloc: await call('Reallocated call', at(30)),
    independent: await call('Independent application call', at(20)),
    reviewed: await call('Reviewed not allocated call', at(25)),
    notRelevant: await call('Not relevant call', at(25)),
    broadKeyword: await call('Broad and keyword call', at(30), { disciplines: ['Robotics'] }),
    broadOnly: await call('Broad only call', at(30)),
    closingSoon: await call('Closing soon call', at(3)),
    future: await call('Future allocated call', at(60)),
  }
  await classify(calls.dup.id, [mech]); await classify(calls.three.id, [mech, pharm, chem]); await classify(calls.expiredIdle.id, [chem])
  await classify(calls.expiredLive.id, [mech]); await classify(calls.partial.id, [mech]); await classify(calls.realloc.id, [pharm])
  await classify(calls.independent.id, [chem]); await classify(calls.reviewed.id, [elec]); await classify(calls.notRelevant.id, [pharm])
  await classify(calls.broadKeyword.id, [civil]); await classify(calls.broadOnly.id, [civil]); await classify(calls.closingSoon.id, [chem])
  await classify(calls.future.id, [pharm])

  // Two arrivals of one call, and one intake that failed before any call existed.
  await db.fundingImportJob.create({ data: { tenantId, fundingCallId: calls.dup.id, visibility: 'TENANT_PRIVATE', sourceType: 'URL', status: 'COMPLETED', outcome: 'CREATED',
    createdByUserId: officerA.id, updatedByUserId: officerA.id, originSchoolId: eng.id, originSchoolName: 'Engineering', originSchoolSource: 'SELECTED_AT_INTAKE', createdAt: at(-20) } })
  await db.fundingIntakeJob.create({ data: { submitted_by_user_id: officerA.id, linked_funding_call_id: calls.dup.id, input_type: 'url', status: 'draft_created', duplicate_status: 'resolved',
    origin_school_id: eng.id, origin_school_name: 'Engineering', origin_school_source: 'SELECTED_AT_INTAKE', created_at: at(-18) } })
  await db.fundingIntakeJob.create({ data: { submitted_by_user_id: officerC.id, input_type: 'url', status: 'failed', error_message: 'Source unreachable',
    origin_school_id: sci.id, origin_school_name: 'Science', origin_school_source: 'SELECTED_AT_INTAKE', created_at: at(-2) } })

  const assign = (callId: string, faculty: { id: string }, unit: { id: string }, status: string, extra: Record<string, unknown> = {}) =>
    db.callAssignment.create({ data: { tenant_id: tenantId, funding_call_id: callId, assignee_user_id: faculty.id, assigned_by_user_id: officerA.id,
      assignee_org_unit_id: unit.id, status: status as never, created_at: at(-10), ...extra } })
  const allocations = {
    expiredLive: await assign(calls.expiredLive.id, fA1, eng, 'IN_PROGRESS'),
    partialSubmitted: await assign(calls.partial.id, fA1, eng, 'IN_PROGRESS', { assigned_by_user_id: deputy.id }),
    partialDrafting: await assign(calls.partial.id, fA2, eng, 'IN_PROGRESS'),
    partialDeclined: await assign(calls.partial.id, fA3, eng, 'DECLINED'),
    reallocDeclined: await assign(calls.realloc.id, fB1, med, 'DECLINED'),
    reallocLive: await assign(calls.realloc.id, fB2, med, 'ASSIGNED'),
    future: await assign(calls.future.id, fB1, med, 'ASSIGNED'),
  }
  await db.grantProposal.create({ data: { tenant_id: tenantId, assignment_id: allocations.partialSubmitted.id, funding_call_id: calls.partial.id, pi_user_id: fA1.id, org_unit_id: eng.id,
    title: 'Partly submitted proposal', agency_name: 'Agency', created_by_user_id: fA1.id, status: 'SUBMITTED', submitted_at: at(-1), submission_reference: 'ACK-1', created_at: at(-9) } })
  await db.grantProposal.create({ data: { tenant_id: tenantId, funding_call_id: calls.independent.id, pi_user_id: fC1.id, org_unit_id: sci.id,
    title: 'Independent proposal', agency_name: 'Agency', created_by_user_id: fC1.id, status: 'SUBMITTED', submitted_at: at(-2), created_at: at(-8) } })
  await db.grantProposal.create({ data: { tenant_id: tenantId, pi_user_id: fC1.id, org_unit_id: sci.id,
    title: 'Ad-hoc proposal with no call', agency_name: 'Agency', created_by_user_id: fC1.id, status: 'DRAFT', created_at: at(-4) } })
  await db.callSchoolTriage.create({ data: { tenant_id: tenantId, org_unit_id: eng.id, funding_call_id: calls.reviewed.id, status: 'RELEVANT', decided_at: at(-3), decided_by_user_id: officerA.id } })
  await db.callSchoolTriage.create({ data: { tenant_id: tenantId, org_unit_id: med.id, funding_call_id: calls.notRelevant.id, status: 'NOT_RELEVANT', note: 'Clinical trials only', decided_at: at(-3), decided_by_user_id: officerA.id } })

  return { tenantId, now, users: { head, officerA, officerC, deputy, fA1, fA2, fA3, fB1, fB2, fC1 }, members: { mHead, mA, mC, mDep },
    schools: { eng, med, sci, art }, areas: { mech, elec, civil, pharm, chem }, calls, allocations }
}
export type ReportingFixture = Awaited<ReturnType<typeof buildReportingFixture>>
