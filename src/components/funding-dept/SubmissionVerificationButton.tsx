'use client'

import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import WorkspaceDialog from '@/components/ui/WorkspaceDialog'
import { useAuth } from '@/lib/auth-context'

export default function SubmissionVerificationButton({ applicationId, schoolId, title, onVerified }: {
  applicationId: string; schoolId: string; title: string; onVerified: () => void
}) {
  const { authFetch } = useAuth()
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  return <>
    <button type="button" className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-blue-700 hover:bg-blue-50" onClick={() => { setError(''); setOpen(true) }}><ShieldCheck className="h-3.5 w-3.5" />Review evidence</button>
    <WorkspaceDialog open={open} onOpenChange={setOpen} busy={busy} title="Verify submission evidence" description={title}>
      <form className="space-y-4" onSubmit={async event => {
        event.preventDefault(); const reason = String(new FormData(event.currentTarget).get('reason') || '').trim()
        setBusy(true); setError('')
        try {
          const response = await authFetch('/api/funding-dept/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operation: 'verify', applicationId, schoolId, reason }) })
          if (!response.ok) throw Error((await response.json()).error || 'Could not verify this submission.')
          setOpen(false); onVerified()
        } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
      }}>
        <p className="text-sm leading-6 text-slate-500">Check the saved application reference, portal record or submission document. Notes alone do not verify a submission. A verified correction can update the deadline outcome; the original claim and review remain in the audit trail.</p>
        <label className="block text-sm font-medium text-slate-700">Evidence reviewed<textarea name="reason" required minLength={3} maxLength={2000} rows={3} className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm" placeholder="Record what you checked and confirm the actual submission date." /></label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="funding-button-primary w-full"><ShieldCheck className="h-4 w-4" />{busy ? 'Verifying…' : 'Verify current evidence'}</button>
      </form>
    </WorkspaceDialog>
  </>
}
