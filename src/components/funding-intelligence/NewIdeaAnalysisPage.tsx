'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, BrainCircuit, Check, Loader2, Search, ShieldCheck, Sparkles } from 'lucide-react'

import { useAuth } from '@/lib/auth-context'
import AnalysisHistoryList from './AnalysisHistoryList'

const EXAMPLE = `We propose a low-cost, offline retinal screening system for rural primary-health centres. The system will combine a portable fundus camera with an on-device AI model to identify patients at risk of diabetic retinopathy and prioritise referrals. We will validate it with community health workers across three districts.`

export default function NewIdeaAnalysisPage() {
  const { token, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const anchorProjectId = searchParams?.get('projectId') || undefined
  const [ideaText, setIdeaText] = useState('')
  const [anchorTitle, setAnchorTitle] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token || !anchorProjectId) return
    fetch(`/api/project-intelligence/projects/${anchorProjectId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => setAnchorTitle(body?.project?.title || null))
      .catch(() => undefined)
  }, [anchorProjectId, token])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!token || ideaText.trim().length < 50) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch('/api/idea-intelligence', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ideaText: ideaText.trim(), anchorPublicProjectId: anchorProjectId }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not start the analysis')
      router.push(`/funding/intelligence/idea/${body.run.id}`)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not start the analysis')
      setSubmitting(false)
    }
  }

  if (authLoading) return <div className="flex min-h-[70vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>

  return (
    <main className="min-h-screen bg-[#f5f8f7] text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <Link href="/funding/intelligence" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-teal-800"><ArrowLeft className="h-4 w-4" /> Funding landscape</Link>
        <div className="mt-5">
          <AnalysisHistoryList token={token} compact />
        </div>
        <div className="mt-6 grid overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 lg:grid-cols-[0.88fr_1.12fr]">
          <section className="relative overflow-hidden bg-[#0b3437] p-7 text-white sm:p-10">
            <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-teal-300/10 blur-3xl" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-teal-100"><BrainCircuit className="h-4 w-4" /> Evidence-led idea analysis</div>
              <h1 className="mt-6 text-3xl font-semibold leading-tight sm:text-4xl">Find the strongest way to position your research idea.</h1>
              <p className="mt-4 text-sm leading-7 text-teal-50/70">We compare your idea with funded projects and active calls. You receive an evidence matrix—not an unsupported promise of funding.</p>
              <div className="mt-8 space-y-4">
                {[
                  ['Semantic landscape search', 'Find conceptually similar awards, even when terminology differs.'],
                  ['Facet-by-facet comparison', 'See what is already covered and what remains unassessed.'],
                  ['Open-call matching', 'Connect the idea with currently relevant schemes.'],
                ].map(([title, description]) => <div key={title} className="flex gap-3"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-200/15"><Check className="h-3.5 w-3.5 text-teal-200" /></span><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-5 text-teal-50/60">{description}</p></div></div>)}
              </div>
            </div>
          </section>

          <section className="p-6 sm:p-10">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-700"><Sparkles className="h-4 w-4" /> Describe your idea</div>
            <h2 className="mt-3 text-2xl font-semibold">What are you proposing?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">Include the problem, proposed approach, intended users, deployment context, and expected outcome.</p>

            {anchorTitle ? <div className="mt-5 rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900"><span className="font-semibold">Landscape anchor:</span> {anchorTitle}</div> : null}

            <form onSubmit={submit} className="mt-6">
              <div className="relative">
                <textarea value={ideaText} onChange={(event) => setIdeaText(event.target.value)} rows={11} maxLength={12000} placeholder="Example: We propose to develop…" className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-100" />
                <span className={`absolute bottom-3 right-3 text-xs ${ideaText.length >= 50 ? 'text-teal-700' : 'text-slate-400'}`}>{ideaText.length}/12,000</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={() => setIdeaText(EXAMPLE)} className="text-xs font-semibold text-teal-700 hover:text-teal-900">Use an example</button><span className="inline-flex items-center gap-1.5 text-xs text-slate-400"><ShieldCheck className="h-3.5 w-3.5" /> Your analysis remains private</span></div>
              {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}
              <button type="submit" disabled={!token || ideaText.trim().length < 50 || submitting} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-800 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-teal-900/10 transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:bg-slate-300">{submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating analysis…</> : <>Analyze funding landscape <ArrowRight className="h-4 w-4" /></>}</button>
            </form>
          </section>
        </div>
      </div>
    </main>
  )
}
