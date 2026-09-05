'use client'

import { PROPOSAL_STATUS_LABELS, type ProposalStatus } from '@/lib/proposals/shared'

/**
 * One status, one colour, everywhere.
 *
 * The scheme reads as a journey rather than as good/bad: grey while it is being
 * written, blue while the department has it, green once it is cleared and gone,
 * and only the agency's final answer earns a strong colour.
 */
const STYLES: Record<ProposalStatus, string> = {
  DRAFT: 'bg-nickel-100 text-nickel-700 border-nickel-200',
  IN_REVIEW: 'bg-cobalt-50 text-cobalt-700 border-cobalt-200',
  CLEARED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  SUBMITTED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  UNDER_AGENCY_REVIEW: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  REVISION_REQUESTED: 'bg-amber-50 text-amber-800 border-amber-200',
  SANCTIONED: 'bg-emerald-600 text-white border-emerald-700',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  WITHDRAWN: 'bg-nickel-100 text-nickel-600 border-nickel-200',
  CLOSED: 'bg-nickel-100 text-nickel-600 border-nickel-200',
}

export default function ProposalStatusChip({
  status,
  className = '',
}: {
  status: ProposalStatus | string
  className?: string
}) {
  const key = status as ProposalStatus
  const style = STYLES[key] || STYLES.DRAFT
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${style} ${className}`}
    >
      {PROPOSAL_STATUS_LABELS[key] || status}
    </span>
  )
}
