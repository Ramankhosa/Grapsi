'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Building2, CalendarDays, ExternalLink, FileText,
  Landmark, Loader2, MapPin, Sparkles, Users, WalletCards,
} from 'lucide-react'

import { useAuth } from '@/lib/auth-context'
import type { ProjectSearchItem } from './types'

type Participant = {
  id: string
  role: string
  name: string
  institutionName: string | null
  departmentName: string | null
  city: string | null
  state: string | null
  country: string | null
}

type ProjectDetail = {
  id: string
  sourceKey: string
  externalId: string
  fileNumber: string | null
  projectNumber: string | null
  sourceUrl: string | null
  detailUrl: string | null
  statusText: string | null
  programName: string | null
  schemeName: string | null
  category: string | null
  theme: string | null
  discipline: string | null
  areaName: string | null
  subAreaName: string | null
  title: string
  abstractText: string | null
  executiveSummary: string | null
  objectivesText: string | null
  milestonesText: string | null
  deliverablesText: string | null
  outputPlannedText: string | null
  outputAchievedText: string | null
  keywords: string[]
  primaryInvestigatorName: string | null
  primaryInstitutionName: string | null
  departmentName: string | null
  city: string | null
  state: string | null
  country: string | null
  sanctionYear: number | null
  startDate: string | null
  endDate: string | null
  durationMonths: number | null
  budgetAmount: number | null
  budgetCurrency: string | null
  publications: unknown
  patents: unknown
  outcomes: unknown
  source: { name: string; baseUrl: string }
  participants: Participant[]
}

function formatBudget(amount: number | null, currency = 'INR') {
  if (amount === null) return 'Not reported'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : null
}

function EvidenceSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><h2 className="text-lg font-semibold text-slate-900">{title}</h2><div className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-600 sm:text-[15px]">{children}</div></section>
}

function SimilarCard({ item }: { item: ProjectSearchItem }) {
  return (
    <Link href={`/funding/intelligence/projects/${item.id}`} className="block min-w-[280px] max-w-[330px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md">
      <div className="flex items-center justify-between gap-3"><span className="rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-bold text-teal-700">{item.sourceKey}</span>{item.relevanceScore ? <span className="text-xs font-semibold text-teal-700">{Math.round(item.relevanceScore * 100)}% similar</span> : null}</div>
      <h3 className="mt-3 line-clamp-3 font-semibold leading-6 text-slate-900">{item.title}</h3>
      <p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-500">{item.primaryInstitutionName || item.schemeName || 'Institution not reported'}</p>
    </Link>
  )
}

export default function ProjectDetailPage({ projectId }: { projectId: string }) {
  const { token, isLoading: authLoading } = useAuth()
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [similar, setSimilar] = useState<ProjectSearchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const headers = { Authorization: `Bearer ${token}` }
      const [projectResponse, similarResponse] = await Promise.all([
        fetch(`/api/project-intelligence/projects/${projectId}`, { headers }),
        fetch(`/api/project-intelligence/projects/${projectId}/similar?limit=8`, { headers }),
      ])
      const projectBody = await projectResponse.json()
      if (!projectResponse.ok) throw new Error(projectBody.error || 'Failed to load project')
      setProject(projectBody.project)
      if (similarResponse.ok) {
        const similarBody = await similarResponse.json()
        setSimilar(similarBody.results || [])
      }
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }, [projectId, token])

  useEffect(() => { void load() }, [load])

  const sourceLink = project?.detailUrl || project?.sourceUrl || project?.source?.baseUrl || null
  const abstract = useMemo(() => project?.abstractText && project.abstractText.toUpperCase() !== 'NA' ? project.abstractText : project?.executiveSummary, [project])

  if (authLoading || loading) return <div className="flex min-h-[70vh] items-center justify-center bg-[#f6f8f7]"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>
  if (!token) return <div className="p-8 text-sm text-slate-600">Sign in to view funding evidence.</div>
  if (error || !project) return <div className="mx-auto max-w-3xl p-8"><Link href="/funding/intelligence" className="text-sm font-semibold text-teal-700">Back to explorer</Link><div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">{error || 'Project not found'}</div></div>

  return (
    <main className="min-h-screen bg-[#f6f8f7] text-slate-900">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8"><Link href="/funding/intelligence" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-teal-800"><ArrowLeft className="h-4 w-4" /> Back to landscape</Link></div>
      </div>

      <section className="border-b border-teal-950/10 bg-[#0b3437] text-white">
        <div className="mx-auto max-w-7xl px-4 py-9 sm:px-6 sm:py-12 lg:px-8">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-teal-100/70"><span className="rounded-full border border-teal-100/20 bg-white/10 px-2.5 py-1 text-teal-50">{project.sourceKey}</span>{project.schemeName ? <span>{project.schemeName}</span> : null}</div>
          <h1 className="mt-4 max-w-4xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{project.title}</h1>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-sm text-teal-50/75">
            {project.primaryInvestigatorName ? <span className="flex items-center gap-2"><Landmark className="h-4 w-4" />{project.primaryInvestigatorName}</span> : null}
            {project.primaryInstitutionName ? <span className="flex items-center gap-2"><Building2 className="h-4 w-4" />{project.primaryInstitutionName}</span> : null}
            {project.state ? <span className="flex items-center gap-2"><MapPin className="h-4 w-4" />{project.state}</span> : null}
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-7 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-8">
        <div className="space-y-6">
          <EvidenceSection title="Project overview">{abstract || <span className="italic text-slate-400">The source did not provide a project abstract. Metadata below is shown exactly as reported.</span>}</EvidenceSection>
          {project.objectivesText ? <EvidenceSection title="Objectives">{project.objectivesText}</EvidenceSection> : null}
          {project.deliverablesText || project.outputPlannedText ? <EvidenceSection title="Planned outputs">{project.deliverablesText || project.outputPlannedText}</EvidenceSection> : null}
          {project.outputAchievedText ? <EvidenceSection title="Reported outcomes">{project.outputAchievedText}</EvidenceSection> : null}

          {project.participants.length ? <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="flex items-center gap-2"><Users className="h-5 w-5 text-teal-700" /><h2 className="text-lg font-semibold">Project team</h2></div><div className="mt-4 divide-y divide-slate-100">{project.participants.map((participant) => <div key={participant.id} className="py-3 first:pt-0 last:pb-0"><p className="text-sm font-semibold text-slate-800">{participant.name}</p><p className="mt-1 text-xs text-slate-500">{[participant.role.replace(/_/g, ' '), participant.institutionName, participant.departmentName].filter(Boolean).join(' · ')}</p></div>)}</div></section> : null}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-5 lg:self-start">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-500">Funding record</h2>
            <dl className="mt-4 space-y-4">
              <div className="flex gap-3"><WalletCards className="mt-0.5 h-4 w-4 text-teal-700" /><div><dt className="text-xs text-slate-500">Award amount</dt><dd className="mt-0.5 text-sm font-semibold text-slate-900">{formatBudget(project.budgetAmount, project.budgetCurrency || 'INR')}</dd></div></div>
              <div className="flex gap-3"><CalendarDays className="mt-0.5 h-4 w-4 text-teal-700" /><div><dt className="text-xs text-slate-500">Timeline</dt><dd className="mt-0.5 text-sm font-semibold text-slate-900">{formatDate(project.startDate) || project.sanctionYear || 'Not reported'}{formatDate(project.endDate) ? ` – ${formatDate(project.endDate)}` : ''}</dd>{project.durationMonths ? <p className="mt-0.5 text-xs text-slate-500">{project.durationMonths} months</p> : null}</div></div>
              <div className="flex gap-3"><FileText className="mt-0.5 h-4 w-4 text-teal-700" /><div><dt className="text-xs text-slate-500">Record</dt><dd className="mt-0.5 text-sm font-semibold text-slate-900">{project.projectNumber || project.fileNumber || project.externalId}</dd></div></div>
            </dl>
            {sourceLink ? <a href={sourceLink} target="_blank" rel="noreferrer" className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">View original source <ExternalLink className="h-4 w-4" /></a> : null}
          </section>

          <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-teal-800 to-cyan-900 p-5 text-white shadow-lg shadow-teal-950/10"><Sparkles className="h-5 w-5 text-teal-200" /><h2 className="mt-3 text-lg font-semibold">Compare your idea</h2><p className="mt-2 text-sm leading-6 text-teal-50/75">Use this award as evidence in a wider landscape analysis.</p><Link href={`/funding/intelligence/idea/new?projectId=${project.id}`} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-teal-900">Analyze my idea <ArrowRight className="h-4 w-4" /></Link></section>
        </aside>
      </div>

      {similar.length ? <section className="border-t border-slate-200 bg-white/60"><div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"><div className="flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Semantic neighbors</p><h2 className="mt-1 text-2xl font-semibold">Similar funded projects</h2></div></div><div className="mt-5 flex gap-4 overflow-x-auto pb-3">{similar.map((item) => <SimilarCard key={item.id} item={item} />)}</div></div></section> : null}
    </main>
  )
}
