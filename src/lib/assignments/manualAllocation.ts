import { z } from 'zod'

export const ALLOCATION_REASONS = ['FACULTY_WILLINGNESS', 'INDIRECT_FIT', 'DSR_RECOMMENDATION'] as const
export type AllocationReason = (typeof ALLOCATION_REASONS)[number]
export const ALLOCATION_REASON_LABELS: Record<AllocationReason, string> = {
  FACULTY_WILLINGNESS: 'Faculty willingness',
  INDIRECT_FIT: 'Indirect research fit',
  DSR_RECOMMENDATION: 'DSR recommendation',
}

export const createAssignmentSchema = z.object({
  fundingCallId: z.string().trim().min(1, 'A funding call is required'),
  assigneeUserId: z.string().trim().min(1, 'A faculty member is required'),
  deadlineAt: z.string().trim().nullable().optional(),
  message: z.string().trim().max(5000).nullable().optional(),
  matchScore: z.number().nullable().optional(),
  matchTier: z.string().trim().max(20).nullable().optional(),
  matchBasis: z.string().trim().max(20).nullable().optional(),
  allocationMethod: z.literal('MANUAL').nullable().optional(),
  allocationReason: z.enum(ALLOCATION_REASONS).nullable().optional(),
  allocationNote: z.string().trim().max(2000).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.allocationMethod === 'MANUAL' && !value.allocationReason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['allocationReason'], message: 'Choose an allocation reason.' })
  }
  if (!value.allocationMethod && (value.allocationReason || value.allocationNote)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['allocationMethod'], message: 'Manual allocation metadata requires allocationMethod MANUAL.' })
  }
})

export type ExistingAllocation = { id: string; status: string }
export type AllocationSchool = { id: string; name: string; departments: Array<{ id: string; name: string }> }
export type AllocationPerson = {
  userId: string; name: string; email?: string; employeeId?: string | null
  school?: string | null; department?: string | null
}
export type AllocationCall = { id: string; title: string; agency?: string | null; closeDate?: string | null }
export type AllocationCallOption = AllocationCall & {
  isClosed: boolean; existingAssignment: ExistingAllocation | null
  responsibility: { schoolId: string | null; schoolName: string | null; willReopen: boolean; previousReason: string | null }
}
export type AllocationPersonOption = AllocationPerson & { existingAssignment: ExistingAllocation | null }

/** Date-only call deadlines remain open throughout the institution's local day. */
export function allocationDateKey(date: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date))
}
export function allocationCallClosed(deadline: Date | string | null | undefined, now = new Date()): boolean {
  return Boolean(deadline && allocationDateKey(deadline) < allocationDateKey(now))
}
export function allocationHref(id: string): string {
  return `/assignments?view=managed&assignmentId=${encodeURIComponent(id)}`
}
