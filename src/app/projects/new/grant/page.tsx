'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, FileText, Loader2, Sparkles } from 'lucide-react'

import FundingCallImportModal from '@/components/FundingCallImportModal'
import { useAuth } from '@/lib/auth-context'

const grantProjectWizardStorageKey = 'grant-project-upload-wizard-v1'

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || payload?.details || 'Request failed')
  }
  return payload as T
}

export default function NewGrantProjectPage() {
  const router = useRouter()
  const { user, isLoading, authFetch } = useAuth()
  const [wizardReady, setWizardReady] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const resumeJobId = new URLSearchParams(window.location.search).get('jobId')
    if (resumeJobId) {
      window.localStorage.setItem(
        grantProjectWizardStorageKey,
        JSON.stringify({
          step: 'source',
          mode: 'text',
          jobId: resumeJobId,
          savedAt: new Date().toISOString(),
        })
      )
    }

    setWizardReady(true)
  }, [])

  useEffect(() => {
    if (!isLoading && !user) {
      router.push(`/login?callbackUrl=${encodeURIComponent('/projects/new/grant')}`)
    }
  }, [isLoading, router, user])

  async function handleBeginWriting(fundingCallId: string, options?: { projectName?: string; selectedPriorityAreas?: string[] }) {
    if (!user) {
      router.push(`/login?callbackUrl=${encodeURIComponent('/projects/new/grant')}`)
      return
    }

    setLaunching(true)
    setError(null)

    try {
      const payload = await readJsonResponse<{ launchUrl?: string | null; prepUrl?: string | null }>(
        await authFetch(`/api/funding/calls/${encodeURIComponent(fundingCallId)}/start-grant-prep`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            engagementMode: 'expert',
            projectName: options?.projectName || undefined,
            selectedPriorityAreas: options?.selectedPriorityAreas || [],
          }),
        })
      )

      router.push(payload.launchUrl || payload.prepUrl || '/projects')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Grant Prep')
      setLaunching(false)
    }
  }

  if (isLoading || !wizardReady || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/10 px-5 py-4 text-sm font-semibold">
          <Loader2 className="h-4 w-4 animate-spin" />
          Preparing grant project flow...
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_15%_10%,rgba(16,185,129,0.25),transparent_32%),linear-gradient(135deg,#0f172a_0%,#12312b_52%,#f8fafc_52%,#eef2f7_100%)] text-slate-950">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/20"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to projects
          </Link>
          <div className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100 backdrop-blur">
            Bring your own call
          </div>
        </header>

        <main className="grid flex-1 items-center gap-8 py-12 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="max-w-2xl text-white">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/30 bg-emerald-100/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100">
              <Sparkles className="h-4 w-4" />
              Direct Grant Prep
            </div>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
              Create a grant project from your own funding call.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-200">
              Paste the call text, add guideline text if you have it, upload a funder template as a PDF/image if available, or use the standard grant application template fallback.
            </p>
          </section>

          <section className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-[0_28px_90px_rgba(15,23,42,0.25)] backdrop-blur">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white">
              <FileText className="h-7 w-7" />
            </div>
            <h2 className="mt-5 text-2xl font-semibold text-slate-950">Pasted-call pathway</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              The wizard opens automatically. The project is created only after you start Grant Prep.
            </p>
            {launching ? (
              <div className="mt-5 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating project and starting Grant Prep...
              </div>
            ) : null}
            {error ? (
              <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}
          </section>
        </main>
      </div>

      <FundingCallImportModal
        open={!launching}
        onClose={() => router.push('/projects')}
        onBeginWriting={handleBeginWriting}
        importEndpoint="/api/funding/imports"
        allowedCallModes={['text']}
        allowedGuidelineModes={['skip', 'text']}
        allowedTemplateModes={['skip', 'file', 'text']}
        storageKey={grantProjectWizardStorageKey}
        showProjectNameField
        eyebrow="Grant project upload"
        title="Create Grant Project From Your Own Call"
        description="Add the call, choose any optional supporting documents, and start Grant Prep."
      />
    </div>
  )
}
