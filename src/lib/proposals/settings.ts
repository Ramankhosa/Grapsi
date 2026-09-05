/**
 * What each tenant's proposal desk actually does.
 *
 * Institutions run this process differently, and the differences are real
 * rather than cosmetic: some hold budgets in a finance system and never want
 * them here, some stop caring the moment a proposal is submitted, some have no
 * internal cut-off at all, and some have not bought the AI review. A desk that
 * insists on all of it would be wrong for most of them.
 *
 * This is deliberately NOT the plan-entitlement system. That answers "has this
 * tenant paid for the grant reviewer", is set by the platform, and still
 * applies underneath all of this. These are operating choices the tenant's own
 * administrator makes about how their office works.
 *
 * Everything defaults to ON, so a tenant that never opens the settings screen
 * gets the full process and nothing changes under them.
 */
import prisma from '@/lib/prisma'

import { BUDGET_HEADS, type BudgetHead } from './shared'

export interface ProposalSettings {
  // --- Which stages this office runs -------------------------------------
  /** Run the AI reviewer over drafts and send reports back. */
  aiReviewEnabled: boolean
  /** Capture the budget by head and year. */
  budgetEnabled: boolean
  /** Capture co-investigators and collaborators. */
  teamEnabled: boolean
  /** Follow what the agency decided after submission. */
  agencyTrackingEnabled: boolean
  /** Operate an internal cut-off after which drafts are not accepted. */
  cutoffEnabled: boolean
  /** Issue endorsement / forwarding letters and NOCs on a proposal. */
  endorsementEnabled: boolean
  /** Check a bundle of required attachments before clearing. */
  checklistEnabled: boolean
  /** Track instalments, utilisation certificates and reports after a sanction. */
  postAwardEnabled: boolean

  // --- Who does what ------------------------------------------------------
  /** May a researcher open their own proposal record, or only the office? */
  facultyMayOpenProposals: boolean
  /** May a researcher record their own agency submission? */
  facultyMayRecordSubmission: boolean
  /** Must a review have been shared before a proposal can be cleared? */
  requireReviewBeforeClearing: boolean

  // --- Delivery -----------------------------------------------------------
  /** Send email as well as in-app notifications. */
  emailNotifications: boolean

  // --- Timings ------------------------------------------------------------
  /** Days before the agency deadline that the internal cut-off falls. */
  cutoffOffsetDays: number
  /** Days a draft may sit unreviewed or unsent before the office is warned. */
  reviewSlaDays: number
  /** Days after submission with no agency news before the officer is prompted. */
  agencyStaleDays: number

  // --- Vocabulary ---------------------------------------------------------
  /** The heads of expenditure this institution budgets under. */
  budgetHeads: BudgetHead[]
  /**
   * The attachment lines a new proposal starts with. Every institution's list
   * differs, and an office that cannot edit this one will keep its real list on
   * a printed sheet instead.
   */
  checklistTemplate: string[]
}

export const DEFAULT_PROPOSAL_SETTINGS: ProposalSettings = {
  aiReviewEnabled: true,
  budgetEnabled: true,
  teamEnabled: true,
  agencyTrackingEnabled: true,
  cutoffEnabled: true,
  endorsementEnabled: true,
  checklistEnabled: true,
  postAwardEnabled: true,
  facultyMayOpenProposals: true,
  facultyMayRecordSubmission: true,
  requireReviewBeforeClearing: true,
  emailNotifications: true,
  cutoffOffsetDays: 3,
  reviewSlaDays: Number(process.env.PROPOSAL_REVIEW_SLA_DAYS) || 3,
  agencyStaleDays: Number(process.env.PROPOSAL_AGENCY_STALE_DAYS) || 60,
  budgetHeads: [...BUDGET_HEADS],
  // The bundle most Indian agencies ask for. A starting point to edit, not a
  // rule — the office knows its own funders.
  checklistTemplate: [
    'Endorsement letter from the institution',
    'Principal investigator CV',
    'Budget justification',
    'Ethics / biosafety clearance (if applicable)',
    'Plagiarism / similarity certificate',
    'Undertaking by the investigator',
    'No-objection certificate from the employer',
  ],
}

/** The toggles a tenant admin can flip, for the settings screen and the API. */
export const PROPOSAL_TOGGLES = [
  'aiReviewEnabled',
  'budgetEnabled',
  'teamEnabled',
  'agencyTrackingEnabled',
  'cutoffEnabled',
  'endorsementEnabled',
  'checklistEnabled',
  'postAwardEnabled',
  'facultyMayOpenProposals',
  'facultyMayRecordSubmission',
  'requireReviewBeforeClearing',
  'emailNotifications',
] as const
export type ProposalToggle = (typeof PROPOSAL_TOGGLES)[number]

export const TOGGLE_COPY: Record<ProposalToggle, { label: string; help: string }> = {
  aiReviewEnabled: {
    label: 'AI review of drafts',
    help: 'Officers can run the grant reviewer on a draft and send the report back. Turn this off to use the desk purely as a record.',
  },
  budgetEnabled: {
    label: 'Budget',
    help: 'Capture the amount requested by head of expenditure and project year. Turn this off if budgets live in your finance system.',
  },
  teamEnabled: {
    label: 'Co-investigators',
    help: 'Record co-PIs, collaborators and external partners on each application.',
  },
  agencyTrackingEnabled: {
    label: 'Agency outcome tracking',
    help: 'Follow what the agency decided after submission — under review, revision asked, sanctioned or not funded. Turn this off if your record ends at submission.',
  },
  cutoffEnabled: {
    label: 'Internal cut-off for revisions',
    help: 'Stop accepting new drafts a set number of days before the agency deadline, so the office has time to clear them. Officers can still accept a late draft with a reason.',
  },
  endorsementEnabled: {
    label: 'Endorsement letters',
    help: 'Issue the signed endorsement or forwarding letter on a proposal and send it to the applicant. Turn this off if your letters are handled entirely outside the system.',
  },
  checklistEnabled: {
    label: 'Pre-submission checklist',
    help: 'Tick off the attachments an agency requires before clearing a proposal. Turn this off if your officers check the bundle their own way.',
  },
  postAwardEnabled: {
    label: 'Post-award tracking',
    help: 'After a sanction, record instalments, utilisation certificates, statements of expenditure and progress reports, with due dates that are chased for you. Turn this off if your finance office owns all of that.',
  },
  facultyMayOpenProposals: {
    label: 'Researchers may open their own proposals',
    help: 'Turn this off if only the funding department should create proposal records.',
  },
  facultyMayRecordSubmission: {
    label: 'Researchers may record their own submission',
    help: 'Turn this off if the department records every agency submission itself.',
  },
  requireReviewBeforeClearing: {
    label: 'Require a shared review before clearing',
    help: 'A proposal cleared with no review sent to the applicant needs a written reason. Turn this off to clear freely.',
  },
  emailNotifications: {
    label: 'Email notifications',
    help: 'Send email as well as in-app notices for shared reviews and approaching cut-offs. In-app notices are always sent.',
  },
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.round(parsed), min), max)
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Read whatever is stored and return a complete, valid settings object.
 *
 * Never throws and never returns a partial: a malformed or half-written column
 * degrades to the defaults rather than leaving a route to discover halfway
 * through that `budgetHeads` is undefined.
 */
export function normalizeProposalSettings(raw: unknown): ProposalSettings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}

  const heads = Array.isArray(source.budgetHeads)
    ? (source.budgetHeads as unknown[])
        .map((value) => String(value || '').toUpperCase())
        .filter((value): value is BudgetHead => (BUDGET_HEADS as readonly string[]).includes(value))
    : []

  return {
    aiReviewEnabled: bool(source.aiReviewEnabled, DEFAULT_PROPOSAL_SETTINGS.aiReviewEnabled),
    budgetEnabled: bool(source.budgetEnabled, DEFAULT_PROPOSAL_SETTINGS.budgetEnabled),
    teamEnabled: bool(source.teamEnabled, DEFAULT_PROPOSAL_SETTINGS.teamEnabled),
    agencyTrackingEnabled: bool(
      source.agencyTrackingEnabled,
      DEFAULT_PROPOSAL_SETTINGS.agencyTrackingEnabled
    ),
    cutoffEnabled: bool(source.cutoffEnabled, DEFAULT_PROPOSAL_SETTINGS.cutoffEnabled),
    endorsementEnabled: bool(source.endorsementEnabled, DEFAULT_PROPOSAL_SETTINGS.endorsementEnabled),
    checklistEnabled: bool(source.checklistEnabled, DEFAULT_PROPOSAL_SETTINGS.checklistEnabled),
    postAwardEnabled: bool(source.postAwardEnabled, DEFAULT_PROPOSAL_SETTINGS.postAwardEnabled),
    facultyMayOpenProposals: bool(
      source.facultyMayOpenProposals,
      DEFAULT_PROPOSAL_SETTINGS.facultyMayOpenProposals
    ),
    facultyMayRecordSubmission: bool(
      source.facultyMayRecordSubmission,
      DEFAULT_PROPOSAL_SETTINGS.facultyMayRecordSubmission
    ),
    requireReviewBeforeClearing: bool(
      source.requireReviewBeforeClearing,
      DEFAULT_PROPOSAL_SETTINGS.requireReviewBeforeClearing
    ),
    emailNotifications: bool(
      source.emailNotifications,
      DEFAULT_PROPOSAL_SETTINGS.emailNotifications
    ),
    cutoffOffsetDays: clampInt(
      source.cutoffOffsetDays,
      DEFAULT_PROPOSAL_SETTINGS.cutoffOffsetDays,
      0,
      90
    ),
    reviewSlaDays: clampInt(source.reviewSlaDays, DEFAULT_PROPOSAL_SETTINGS.reviewSlaDays, 1, 60),
    agencyStaleDays: clampInt(
      source.agencyStaleDays,
      DEFAULT_PROPOSAL_SETTINGS.agencyStaleDays,
      7,
      730
    ),
    // An empty list would mean "no budget at all", which is what the toggle is
    // for; a tenant that clears every head gets the defaults back instead.
    budgetHeads: heads.length > 0 ? heads : DEFAULT_PROPOSAL_SETTINGS.budgetHeads,
    // An empty template is a real choice (start every proposal with a blank
    // checklist), so unlike budget heads it is honoured rather than replaced.
    checklistTemplate: Array.isArray(source.checklistTemplate)
      ? (source.checklistTemplate as unknown[])
          .map((line) => String(line || '').trim().slice(0, 200))
          .filter(Boolean)
          .slice(0, 40)
      : DEFAULT_PROPOSAL_SETTINGS.checklistTemplate,
  }
}

export async function getProposalSettings(tenantId: string): Promise<ProposalSettings> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { proposal_settings: true },
  })
  if (!tenant) return DEFAULT_PROPOSAL_SETTINGS
  return normalizeProposalSettings(tenant.proposal_settings)
}

export async function saveProposalSettings(
  tenantId: string,
  patch: Partial<ProposalSettings>
): Promise<ProposalSettings> {
  const current = await getProposalSettings(tenantId)
  const next = normalizeProposalSettings({ ...current, ...patch })
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { proposal_settings: next as any },
  })
  return next
}

/**
 * Settings for many tenants at once, for the sweeps — which run across every
 * tenant and would otherwise read the same row once per proposal.
 */
export async function getProposalSettingsFor(
  tenantIds: string[]
): Promise<Map<string, ProposalSettings>> {
  const rows = await prisma.tenant.findMany({
    where: { id: { in: Array.from(new Set(tenantIds)) } },
    select: { id: true, proposal_settings: true },
  })
  const map = new Map<string, ProposalSettings>()
  for (const row of rows) map.set(row.id, normalizeProposalSettings(row.proposal_settings))
  return map
}

/**
 * Thrown when a route is asked to do something this tenant has switched off.
 * Distinct from a permission error: the person is allowed, the office is not
 * running that stage.
 */
export class ProposalFeatureDisabled extends Error {
  status = 403
  code = 'FEATURE_DISABLED'
  feature: ProposalToggle

  constructor(feature: ProposalToggle, message?: string) {
    super(message || `${TOGGLE_COPY[feature].label} is switched off for this institution.`)
    this.name = 'ProposalFeatureDisabled'
    this.feature = feature
  }
}

/** Guard for a route: throws when the tenant has this stage switched off. */
export function requireProposalFeature(settings: ProposalSettings, feature: ProposalToggle) {
  if (!settings[feature]) throw new ProposalFeatureDisabled(feature)
}
