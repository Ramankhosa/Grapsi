import { ALLOCATION_REASON_LABELS, type AllocationReason } from '@/lib/assignments/manualAllocation'

export default function ManualAllocationDetails({ allocationMethod, allocationReason, allocationNote }: {
  allocationMethod?: string | null; allocationReason?: string | null; allocationNote?: string | null
}) {
  if (allocationMethod !== 'MANUAL') return null
  return <div className="my-2 rounded border border-cobalt-100 bg-cobalt-50 p-2 text-sm">
    <p className="font-medium">Manual allocation · {ALLOCATION_REASON_LABELS[allocationReason as AllocationReason] || 'DSR recommendation'}</p>
    {allocationNote && <p className="mt-1 whitespace-pre-wrap">{allocationNote}</p>}
  </div>
}
