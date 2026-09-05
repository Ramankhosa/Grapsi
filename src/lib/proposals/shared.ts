/**
 * Shared shapes for the grant-proposal desk.
 *
 * These live outside the route files because a Next App Router `route.ts` may
 * only export the fixed handler set — exporting a constant from one fails the
 * build, and `tsc` only catches it once `.next/types` exists.
 */

/**
 * Where an application stands. A string union rather than a Postgres enum, like
 * every other status in the funding-department module, so a new state needs no
 * migration.
 *
 * Whether a review has been *shared* is deliberately absent: that is a fact
 * about one version, and duplicating it here would mean two fields to keep
 * honest on every upload.
 */
export const PROPOSAL_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'CLEARED',
  'SUBMITTED',
  'UNDER_AGENCY_REVIEW',
  'REVISION_REQUESTED',
  'SANCTIONED',
  'REJECTED',
  'WITHDRAWN',
  'CLOSED',
] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  DRAFT: 'Draft',
  IN_REVIEW: 'With the department',
  CLEARED: 'Cleared to submit',
  SUBMITTED: 'Submitted to agency',
  UNDER_AGENCY_REVIEW: 'Under agency review',
  REVISION_REQUESTED: 'Agency asked for changes',
  SANCTIONED: 'Sanctioned',
  REJECTED: 'Not funded',
  WITHDRAWN: 'Withdrawn',
  CLOSED: 'Closed',
}

/** Statuses that still need somebody to do something. */
export const OPEN_PROPOSAL_STATUSES: ProposalStatus[] = [
  'DRAFT',
  'IN_REVIEW',
  'CLEARED',
  'SUBMITTED',
  'UNDER_AGENCY_REVIEW',
  'REVISION_REQUESTED',
]

/** Statuses where the agency has answered. */
export const DECIDED_PROPOSAL_STATUSES: ProposalStatus[] = ['SANCTIONED', 'REJECTED']

export const VERSION_REVIEW_STATUSES = [
  'NONE',
  'QUEUED',
  'RUNNING',
  'REVIEWED',
  'FAILED',
  'SHARED',
] as const
export type VersionReviewStatus = (typeof VERSION_REVIEW_STATUSES)[number]

export const REVIEW_RUN_STATUSES = [
  'QUEUED',
  'IMPORTING',
  'REVIEWING',
  'REPORTING',
  'DONE',
  'FAILED',
  'CANCELLED',
] as const
export type ReviewRunStatus = (typeof REVIEW_RUN_STATUSES)[number]

/** Run states that mean a worker is (or should be) holding this row. */
export const LIVE_REVIEW_STATUSES: ReviewRunStatus[] = [
  'QUEUED',
  'IMPORTING',
  'REVIEWING',
  'REPORTING',
]

export const TEAM_ROLES = ['PI', 'CO_PI', 'CO_I', 'COLLABORATOR', 'MENTOR'] as const
export type TeamRole = (typeof TEAM_ROLES)[number]

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  PI: 'Principal Investigator',
  CO_PI: 'Co-Principal Investigator',
  CO_I: 'Co-Investigator',
  COLLABORATOR: 'Collaborator',
  MENTOR: 'Mentor',
}

export const BUDGET_HEADS = [
  'MANPOWER',
  'EQUIPMENT',
  'CONSUMABLES',
  'TRAVEL',
  'CONTINGENCY',
  'OVERHEADS',
  'OTHER',
] as const
export type BudgetHead = (typeof BUDGET_HEADS)[number]

export const BUDGET_HEAD_LABELS: Record<BudgetHead, string> = {
  MANPOWER: 'Manpower',
  EQUIPMENT: 'Equipment',
  CONSUMABLES: 'Consumables',
  TRAVEL: 'Travel',
  CONTINGENCY: 'Contingency',
  OVERHEADS: 'Overheads / institutional charges',
  OTHER: 'Other',
}

export const MAX_BUDGET_YEARS = 10

/** Documents the institution issues on a proposal. */
export const PROPOSAL_DOCUMENT_KINDS = [
  'ENDORSEMENT',
  'FORWARDING',
  'NOC',
  'SANCTION_ORDER',
  'AGREEMENT',
  'CERTIFICATE',
  'OTHER',
] as const
export type ProposalDocumentKind = (typeof PROPOSAL_DOCUMENT_KINDS)[number]

export const PROPOSAL_DOCUMENT_LABELS: Record<ProposalDocumentKind, string> = {
  ENDORSEMENT: 'Endorsement letter',
  FORWARDING: 'Forwarding letter',
  NOC: 'No-objection certificate',
  SANCTION_ORDER: 'Sanction order',
  AGREEMENT: 'Agreement / MoU',
  CERTIFICATE: 'Certificate',
  OTHER: 'Other document',
}

/** How a contact with the researcher or the agency happened. */
export const FOLLOW_UP_KINDS = ['CALL', 'EMAIL', 'MEETING', 'PORTAL', 'NOTE'] as const
export type ProposalFollowUpKind = (typeof FOLLOW_UP_KINDS)[number]

export const FOLLOW_UP_KIND_LABELS: Record<ProposalFollowUpKind, string> = {
  CALL: 'Phone call',
  EMAIL: 'Email',
  MEETING: 'Meeting',
  PORTAL: 'Agency portal',
  NOTE: 'Note',
}

export const CHECKLIST_STATUSES = ['PENDING', 'DONE', 'WAIVED', 'NOT_APPLICABLE'] as const
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number]

export const CHECKLIST_STATUS_LABELS: Record<ChecklistStatus, string> = {
  PENDING: 'Outstanding',
  DONE: 'Done',
  WAIVED: 'Waived',
  NOT_APPLICABLE: 'Not applicable',
}

/** A checklist line that no longer blocks clearance. */
export const CHECKLIST_SETTLED: ChecklistStatus[] = ['DONE', 'WAIVED', 'NOT_APPLICABLE']

/** Post-award obligations, reusing the assignment milestone vocabulary. */
export const MILESTONE_KINDS = ['INSTALMENT', 'UC', 'SE', 'REPORT', 'OTHER'] as const
export type MilestoneKind = (typeof MILESTONE_KINDS)[number]

export const MILESTONE_LABELS: Record<MilestoneKind, string> = {
  INSTALMENT: 'Instalment',
  UC: 'Utilisation certificate',
  SE: 'Statement of expenditure',
  REPORT: 'Progress report',
  OTHER: 'Other obligation',
}

export const MILESTONE_STATUSES = ['PENDING', 'SUBMITTED', 'CLEARED', 'WAIVED'] as const
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number]

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  PENDING: 'Due',
  SUBMITTED: 'Submitted',
  CLEARED: 'Cleared',
  WAIVED: 'Waived',
}

export const PROPOSAL_EVENT_KINDS = [
  'CREATED',
  'VERSION_UPLOADED',
  'REVIEW_QUEUED',
  'REVIEW_DONE',
  'REVIEW_FAILED',
  'REVIEW_SHARED',
  'CUTOFF_SET',
  'CLEARED',
  'SUBMITTED',
  'AGENCY_STATUS',
  'TEAM_CHANGED',
  'BUDGET_CHANGED',
  'NOTE',
  'REOPENED',
  'DOCUMENT_ISSUED',
  'FOLLOW_UP',
  'CHECKLIST_CHANGED',
  'MILESTONE_CHANGED',
] as const
export type ProposalEventKind = (typeof PROPOSAL_EVENT_KINDS)[number]

/**
 * Who is looking. Every read goes through one serializer keyed on this, because
 * "the officer's internal note" and "what the applicant is shown" differ on
 * several fields and getting that wrong once leaks the department's private
 * assessment to the person being assessed.
 */
export type ProposalLens = 'admin' | 'officer' | 'faculty' | 'head'

/** Lenses that may see internal notes and officer-only events. */
export function lensSeesInternal(lens: ProposalLens): boolean {
  return lens === 'admin' || lens === 'officer'
}

/** Lenses that may change the record rather than only read it. */
export function lensCanManage(lens: ProposalLens): boolean {
  return lens === 'admin' || lens === 'officer'
}

// Tenant policy (which stages this office runs, who may do what) lives in
// ./settings.ts — it grew past a couple of fields and every service reads it.

/** Uploads the desk accepts. `.doc` is rejected loudly rather than parsed to garbage. */
export const PROPOSAL_UPLOAD_MAX_BYTES = 25 * 1024 * 1024
export const PROPOSAL_UPLOAD_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'] as const

export const proposalInclude = {
  pi: { select: { id: true, name: true, email: true } },
  created_by: { select: { id: true, name: true, email: true } },
  cleared_by: { select: { id: true, name: true, email: true } },
  org_unit: { select: { id: true, name: true, code: true } },
  pi_org_unit: { select: { id: true, name: true, code: true } },
  funding_call: {
    select: {
      id: true,
      title: true,
      agencyName: true,
      scheme_title: true,
      close_date: true,
      deadlineAt: true,
      status: true,
    },
  },
  assignment: {
    select: {
      id: true,
      status: true,
      outcome: true,
      deadline_at: true,
      assignee_user_id: true,
      assigned_by_user_id: true,
      assignee_org_unit_id: true,
    },
  },
} as const

/**
 * The proposal as JSON, with anything the lens must not see removed here rather
 * than at each call site.
 */
export function serializeProposal(row: any, lens: ProposalLens) {
  const internal = lensSeesInternal(lens)
  return {
    id: row.id,
    title: row.title,
    status: row.status as ProposalStatus,
    statusLabel: PROPOSAL_STATUS_LABELS[row.status as ProposalStatus] || row.status,
    agencyName: row.agency_name,
    schemeTitle: row.scheme_title ?? null,
    agencyDeadlineAt: row.agency_deadline_at ?? null,
    reviewCutoffAt: row.review_cutoff_at ?? null,
    currentVersionNo: row.current_version_no ?? 0,
    durationMonths: row.duration_months ?? null,
    requestedAmount: row.requested_amount ?? null,
    currency: row.currency || 'INR',
    sanctionedAmount: row.sanctioned_amount ?? null,
    sanctionReference: row.sanction_reference ?? null,
    sanctionDate: row.sanction_date ?? null,
    // The project's own window, once the money has landed. Both lenses see it:
    // the certificate due dates hang off these, and an applicant who cannot see
    // when their project ends cannot plan the closing report.
    projectStartAt: row.project_start_at ?? null,
    projectEndAt: row.project_end_at ?? null,
    submittedAt: row.submitted_at ?? null,
    submissionReference: row.submission_reference ?? null,
    submissionUrl: row.submission_url ?? null,
    agencyStatusNote: row.agency_status_note ?? null,
    agencyStatusUpdatedAt: row.agency_status_updated_at ?? null,
    clearedAt: row.cleared_at ?? null,
    clearedBy: internal ? row.cleared_by?.name || row.cleared_by?.email || null : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pi: {
      userId: row.pi_user_id,
      name: row.pi?.name || null,
      email: row.pi?.email || null,
    },
    school: row.org_unit ? { id: row.org_unit.id, name: row.org_unit.name, code: row.org_unit.code } : null,
    department: row.pi_org_unit
      ? { id: row.pi_org_unit.id, name: row.pi_org_unit.name, code: row.pi_org_unit.code }
      : null,
    fundingCall: row.funding_call
      ? {
          id: row.funding_call.id,
          title: row.funding_call.title,
          agencyName: row.funding_call.agencyName,
          schemeTitle: row.funding_call.scheme_title ?? null,
          closeDate: row.funding_call.close_date ?? row.funding_call.deadlineAt ?? null,
        }
      : null,
    assignmentId: row.assignment_id ?? null,
    grantSessionId: row.grant_session_id ?? null,
    // Only somebody who can open the reviewer workspace is told it exists.
    reviewerCallId: internal ? row.reviewer_call_id ?? null : null,
  }
}

export function serializeVersion(row: any) {
  return {
    id: row.id,
    versionNo: row.version_no,
    fileName: row.file_name,
    mimeType: row.mime_type ?? null,
    byteSize: row.byte_size ?? 0,
    note: row.note ?? null,
    overrideReason: row.override_reason ?? null,
    reviewStatus: row.review_status as VersionReviewStatus,
    uploadedAt: row.created_at,
    uploadedByUserId: row.uploaded_by_user_id,
    uploadedBy: row.uploaded_by?.name || row.uploaded_by?.email || null,
  }
}

/**
 * A review run for the list/progress views. The frozen report itself is served
 * by its own route, because it is large and most screens do not need it.
 */
export function serializeReview(row: any, lens: ProposalLens) {
  const internal = lensSeesInternal(lens)
  const shared = Boolean(row.shared_at)
  return {
    id: row.id,
    versionId: row.version_id,
    versionNo: row.version?.version_no ?? null,
    status: row.status as ReviewRunStatus,
    attempt: row.attempt ?? 0,
    // Faculty are shown the score only once it was deliberately shared with
    // them; a run that is still being read is not a verdict yet.
    overallScore: internal || shared ? row.overall_score ?? null : null,
    recommendation: internal || shared ? row.recommendation ?? null : null,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    sharedAt: row.shared_at ?? null,
    officerNote: row.officer_note ?? null,
    internalNote: internal ? row.internal_note ?? null : null,
    hasReport: Boolean(row.report_snapshot) || (internal && row.status === 'DONE'),
    hasDocx: Boolean(row.docx_storage_path),
    error: internal ? row.error ?? null : null,
    errorCode: internal ? row.error_code ?? null : null,
    progress: internal ? row.progress ?? null : null,
    importSummary: internal ? row.import_summary ?? null : null,
    runBy: internal ? row.run_by?.name || row.run_by?.email || null : null,
    sharedBy: row.shared_by?.name || row.shared_by?.email || null,
  }
}

export function serializeTeamMember(row: any) {
  return {
    id: row.id,
    userId: row.user_id ?? null,
    name: row.name,
    email: row.email ?? null,
    affiliation: row.affiliation ?? null,
    orgUnitId: row.org_unit_id ?? null,
    orgUnitName: row.org_unit?.name ?? null,
    role: row.role as TeamRole,
    roleLabel: TEAM_ROLE_LABELS[row.role as TeamRole] || row.role,
    isExternal: row.is_external,
    sortOrder: row.sort_order ?? 0,
  }
}

export function serializeBudgetLine(row: any) {
  return {
    id: row.id,
    head: row.head as BudgetHead,
    headLabel: BUDGET_HEAD_LABELS[row.head as BudgetHead] || row.head,
    yearNo: row.year_no,
    amount: row.amount ?? 0,
    note: row.note ?? null,
  }
}

export function serializeProposalDocument(row: any) {
  return {
    id: row.id,
    kind: row.kind as ProposalDocumentKind,
    kindLabel: PROPOSAL_DOCUMENT_LABELS[row.kind as ProposalDocumentKind] || row.kind,
    title: row.title,
    referenceNo: row.reference_no ?? null,
    issuedOn: row.issued_on ?? null,
    signedBy: row.signed_by ?? null,
    fileName: row.file_name,
    mimeType: row.mime_type ?? null,
    byteSize: row.byte_size ?? 0,
    note: row.note ?? null,
    visibleToFaculty: row.visible_to_faculty,
    issuedBy: row.issued_by?.name || row.issued_by?.email || null,
    createdAt: row.created_at,
  }
}

export function serializeProposalFollowUp(row: any, lens: ProposalLens) {
  return {
    id: row.id,
    kind: row.kind as ProposalFollowUpKind,
    kindLabel: FOLLOW_UP_KIND_LABELS[row.kind as ProposalFollowUpKind] || row.kind,
    note: row.note,
    happenedAt: row.happened_at,
    recordedStatus: row.recorded_status ?? null,
    // A tickler is the officer's own working state; the applicant has no use
    // for the date somebody set to ring them again.
    remindAt: lensSeesInternal(lens) ? row.remind_at ?? null : null,
    reminderSentAt: lensSeesInternal(lens) ? row.reminder_sent_at ?? null : null,
    visibleToFaculty: row.visible_to_faculty,
    author: lensSeesInternal(lens) ? row.created_by?.name || row.created_by?.email || null : null,
  }
}

export function serializeChecklistItem(row: any) {
  return {
    id: row.id,
    label: row.label,
    isRequired: row.is_required,
    status: row.status as ChecklistStatus,
    statusLabel: CHECKLIST_STATUS_LABELS[row.status as ChecklistStatus] || row.status,
    note: row.note ?? null,
    documentId: row.document_id ?? null,
    documentName: row.document?.file_name ?? null,
    visibleToFaculty: row.visible_to_faculty,
    completedBy: row.completed_by?.name || row.completed_by?.email || null,
    completedAt: row.completed_at ?? null,
    sortOrder: row.sort_order ?? 0,
  }
}

export function serializeMilestone(row: any) {
  return {
    id: row.id,
    kind: row.kind as MilestoneKind,
    kindLabel: MILESTONE_LABELS[row.kind as MilestoneKind] || row.kind,
    title: row.title,
    dueAt: row.due_at ?? null,
    amount: row.amount ?? null,
    currency: row.currency ?? null,
    status: row.status as MilestoneStatus,
    statusLabel: MILESTONE_STATUS_LABELS[row.status as MilestoneStatus] || row.status,
    completedAt: row.completed_at ?? null,
    note: row.note ?? null,
  }
}

export function serializeProposalEvent(row: any, lens: ProposalLens) {
  return {
    id: row.id,
    kind: row.kind as ProposalEventKind,
    fromStatus: row.from_status ?? null,
    toStatus: row.to_status ?? null,
    payload: row.payload ?? null,
    visibleToFaculty: row.visible_to_faculty,
    createdAt: row.created_at,
    // An applicant is told what happened, not which officer wrote every
    // internal line; the department's own views keep the name.
    actor: lensSeesInternal(lens) ? row.actor?.name || row.actor?.email || null : null,
  }
}
