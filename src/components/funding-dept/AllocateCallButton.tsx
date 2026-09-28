'use client'

import { useState } from 'react'
import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'
import type { AllocationCall, AllocationPerson } from '@/lib/assignments/manualAllocation'
import AllocateCallDialog from './AllocateCallDialog'

export default function AllocateCallButton({ person, call, initialSchoolId, onAssigned, className = 'nk-btn-primary nk-btn-sm' }: {
  person?: AllocationPerson; call?: AllocationCall; initialSchoolId?: string; onAssigned?: () => void; className?: string
}) {
  const { me } = useFundingDeptMe()
  const [open, setOpen] = useState(false)
  if (!me.capabilities.canAssign) return null
  return <><button type="button" className={className} onClick={() => setOpen(true)}>{person ? 'Allocate call' : 'Allocate to faculty'}</button>
    {open && <AllocateCallDialog person={person} call={call} initialSchoolId={initialSchoolId} onClose={() => setOpen(false)} onAssigned={() => onAssigned?.()} />}
  </>
}
