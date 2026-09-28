'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from '@/lib/auth-context'
import { allocationHref, type AllocationCall, type AllocationCallOption, type AllocationPerson, type AllocationPersonOption, type AllocationSchool } from '@/lib/assignments/manualAllocation'
import AssignDialog from './AssignDialog'

interface Props {
  person?: AllocationPerson
  call?: AllocationCall
  initialSchoolId?: string
  onClose: () => void
  onAssigned: () => void
}

export default function AllocateCallDialog({ person: fixedPerson, call: fixedCall, initialSchoolId = '', onClose, onAssigned }: Props) {
  const { authFetch } = useAuth()
  const returnFocus = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.activeElement as HTMLElement)
  const [person, setPerson] = useState(fixedPerson)
  const [call, setCall] = useState(fixedCall)
  const [schoolId, setSchoolId] = useState(initialSchoolId)
  const [departmentId, setDepartmentId] = useState('')
  const [schools, setSchools] = useState<AllocationSchool[]>([])
  const [q, setQ] = useState('')
  const [includeClosed, setIncludeClosed] = useState(false)
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [calls, setCalls] = useState<AllocationCallOption[]>([])
  const [people, setPeople] = useState<AllocationPersonOption[]>([])
  const [confirmation, setConfirmation] = useState<AllocationCallOption | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const complete = Boolean(person && call)
  const choosingCalls = Boolean(person && !call)
  const requestKey = JSON.stringify([person?.userId, call?.id, schoolId, departmentId, q, offset, includeClosed, retry])
  const latestRequestKey = useRef(requestKey)
  latestRequestKey.current = requestKey
  const [loadedKey, setLoadedKey] = useState('')
  const current = loadedKey === requestKey

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setConfirmation(null)
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: '20', offset: String(offset) })
        let endpoint = 'faculty'
        if (person) {
          endpoint = 'calls'
          params.set('assigneeUserId', person.userId)
          params.set('includeClosed', String(includeClosed))
          if (call) { params.set('callId', call.id); params.set('offset', '0') }
        } else if (call) {
          params.set('fundingCallId', call.id)
          if (schoolId) params.set('schoolId', schoolId)
          if (departmentId) params.set('departmentId', departmentId)
        } else throw new Error('Open allocation from a faculty member or a funding call.')
        const response = await authFetch(`/api/assignments/options/${endpoint}?${params}`, { signal: controller.signal })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not load allocation options.')
        if (cancelled || latestRequestKey.current !== requestKey) return
        setCalls(data.calls || [])
        setPeople(data.faculty || [])
        setTotal(data.total || 0)
        if (data.schools) {
          setSchools(data.schools)
          const placed = data.schools.filter((school: AllocationSchool) => school.id !== '__unplaced__')
          if (!schoolId && placed.length === 1) setSchoolId(placed[0].id)
        }
        if (person && call) setConfirmation(data.calls[0] || null)
        setLoadedKey(requestKey)
      } catch (err) {
        if (!cancelled && latestRequestKey.current === requestKey) setError(err instanceof Error ? err.message : 'Could not load allocation options.')
      } finally {
        if (!cancelled && latestRequestKey.current === requestKey) setLoading(false)
      }
    }, q ? 250 : 0)
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer) }
  }, [authFetch, person, call, schoolId, departmentId, q, includeClosed, offset, requestKey])

  const change = () => {
    if (!fixedPerson) setPerson(undefined)
    if (!fixedCall) setCall(undefined)
    setConfirmation(null)
    setOffset(0)
  }
  const existingLink = (assignment: { id: string; status: string }) => <Link href={allocationHref(assignment.id)} className="nk-btn-secondary nk-btn-sm">Open allocation · {assignment.status.toLowerCase().replace(/_/g, ' ')}</Link>

  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}>
    <DialogContent className="max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto" onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus() }} onEscapeKeyDown={event => { if (saving) event.preventDefault() }} onPointerDownOutside={event => event.preventDefault()}>
      <DialogTitle>Allocate call{person ? ` to ${person.name}` : ' to faculty'}</DialogTitle>
      <DialogDescription>Choose any accessible published call and faculty member within your allocation access. An automatic match is not required.</DialogDescription>
      {call && <p className="font-medium">{call.title}</p>}
      {person && <p className="nk-sub">{[person.school, person.department, person.employeeId && `ID ${person.employeeId}`].filter(Boolean).join(' · ')}</p>}

      {!complete && <>
        {!choosingCalls && <div className="grid gap-3 sm:grid-cols-2">
          <label className="nk-label">School<select className="nk-input mt-1" value={schoolId} onChange={event => { setSchoolId(event.target.value); setDepartmentId(''); setOffset(0) }}>
            <option value="">Choose a school</option>{schools.map(school => <option key={school.id} value={school.id}>{school.name}</option>)}
          </select></label>
          <label className="nk-label">Department (optional)<select className="nk-input mt-1" value={departmentId} disabled={!schoolId} onChange={event => { setDepartmentId(event.target.value); setOffset(0) }}>
            <option value="">All departments</option>{schools.find(school => school.id === schoolId)?.departments.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select></label>
        </div>}
        <label className="nk-label">{choosingCalls ? 'Search calls' : 'Search faculty'}<input className="nk-input mt-1" value={q} onChange={event => { setQ(event.target.value); setOffset(0) }} placeholder={choosingCalls ? 'Title, agency, call ID or keywords' : 'Name, email or employee ID'} /></label>
        {choosingCalls && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeClosed} onChange={event => { setIncludeClosed(event.target.checked); setOffset(0) }} />Include closed calls</label>}
      </>}

      {error ? <div role="alert" className="text-sm text-red-700">{error} <button className="underline" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : loading || !current ? <p role="status" className="nk-sub">Loading…</p> : complete && confirmation && person ? <>
        {confirmation.isClosed && <p role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">The submission deadline has passed ({new Date(confirmation.closeDate!).toLocaleDateString('en-IN')}). You can still record this allocation.</p>}
        {confirmation.responsibility.willReopen && <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Allocating will reopen {confirmation.responsibility.schoolName}&rsquo;s responsibility for this call. Previous removal: {confirmation.responsibility.previousReason || 'No reason recorded'}. Your allocation reason will be recorded with the reopening.</p>}
        {confirmation.existingAssignment ? <div><p className="nk-sub mb-2">This faculty member already has an allocation for this call. Open it to review or re-request it.</p>{existingLink(confirmation.existingAssignment)}</div> : <AssignDialog embedded manual callId={confirmation.id} callTitle={confirmation.title} callCloseDate={confirmation.closeDate} person={person} onClose={onClose} onSavingChange={setSaving} onAssigned={() => { onAssigned(); onClose() }} />}
      </> : <div className="space-y-2" aria-live="polite">
        {choosingCalls ? calls.map(option => <div key={option.id} className="rounded border border-nickel-200 p-3">
          <p className="font-medium">{option.title}</p><p className="nk-sub mb-2">{option.agency || 'Agency not recorded'} · {option.closeDate ? `${option.isClosed ? 'Closed' : 'Closes'} ${new Date(option.closeDate).toLocaleDateString('en-IN')}` : 'No stated deadline'}</p>
          {option.existingAssignment ? existingLink(option.existingAssignment) : <button className="nk-btn-primary nk-btn-sm" onClick={() => { setCall(option); setOffset(0) }}>Choose call</button>}
        </div>) : people.map(option => <div key={option.userId} className="rounded border border-nickel-200 p-3">
          <p className="font-medium">{option.name}</p><p className="nk-sub">{[option.school, option.department, option.employeeId && `ID ${option.employeeId}`].filter(Boolean).join(' · ')}</p><p className="nk-sub mb-2">{option.email}</p>
          {option.existingAssignment ? existingLink(option.existingAssignment) : <button className="nk-btn-primary nk-btn-sm" onClick={() => { setPerson(option); setOffset(0) }}>Choose faculty</button>}
        </div>)}
        {!total && <p className="nk-sub">{!choosingCalls && !schoolId ? 'Choose a school to browse its faculty.' : 'No results. Try a different search or filter.'}</p>}
        {total > 20 && <div className="flex items-center justify-between gap-2"><button className="nk-btn-secondary nk-btn-sm" disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 20))}>Previous</button><span className="nk-sub">{offset + 1}–{Math.min(offset + 20, total)} of {total}</span><button className="nk-btn-secondary nk-btn-sm" disabled={offset + 20 >= total} onClick={() => setOffset(value => value + 20)}>Next</button></div>}
      </div>}
      {complete && !(fixedPerson && fixedCall) && <button disabled={saving} className="nk-btn-secondary nk-btn-sm justify-self-start" onClick={change}>Choose a different {fixedPerson ? 'call' : 'faculty member'}</button>}
    </DialogContent>
  </Dialog>
}
