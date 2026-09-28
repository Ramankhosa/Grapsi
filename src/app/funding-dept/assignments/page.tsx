import { redirect } from 'next/navigation'

/**
 * "Calls I assigned" now lives in DSR reports → Assigned Calls, which lists
 * every allocation in your schools; "Allocated by me" reproduces this view.
 */
export default function DeptAssignmentsPage() {
  redirect('/funding-dept/reports?tab=assigned&assignedBy=me')
}
