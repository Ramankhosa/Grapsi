'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Download, Loader2, RefreshCw, Save, Sparkles } from 'lucide-react'

import { useAuth } from '@/lib/auth-context'

type StructuredResponse = {
  id?: string
  responseJson?: unknown
}

type GrantSection = {
  id: string
  sectionKey: string
  label: string
  sectionOrder: number
  sectionType: 'narrative' | 'short_answer' | 'checklist' | 'table' | 'budget_rows'
  status: string
  content: string | null
  structuredResponses?: StructuredResponse[]
}

type SectionsResponse = {
  grantSession: {
    id: string
    status: string
    project: { id: string; name: string }
  }
  blueprint: { status: string } | null
  sections: GrantSection[]
}

function structuredJson(section: GrantSection) {
  return JSON.stringify(section.structuredResponses?.[0]?.responseJson || {}, null, 2)
}

export default function GrantDraftPage() {
  const params = useParams()
  const router = useRouter()
  const { user, isLoading: authLoading, authFetch } = useAuth()
  const projectId = params?.projectId as string
  const grantId = params?.grantId as string

  const [data, setData] = useState<SectionsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [generatingAll, setGeneratingAll] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})
  const [structuredValues, setStructuredValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login')
      return
    }

    if (user && projectId && grantId) {
      void loadSections()
    }
  }, [authLoading, user, projectId, grantId, router])

  async function loadSections() {
    try {
      setLoading(true)
      setError(null)
      const response = await authFetch(`/api/projects/${projectId}/grants/${grantId}/sections`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to load grant sections')
      }
      setData(payload)
      const nextDrafts: Record<string, string> = {}
      const nextStructured: Record<string, string> = {}
      for (const section of payload.sections || []) {
        nextDrafts[section.sectionKey] = section.content || ''
        nextStructured[section.sectionKey] = structuredJson(section)
      }
      setDraftValues(nextDrafts)
      setStructuredValues(nextStructured)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load grant sections')
    } finally {
      setLoading(false)
    }
  }

  const blueprintFrozen = data?.blueprint?.status === 'FROZEN'
  const grouped = useMemo(() => (data?.sections || []).sort((a, b) => a.sectionOrder - b.sectionOrder), [data])

  async function generateSection(sectionKey: string) {
    try {
      setBusyKey(sectionKey)
      const response = await authFetch(`/api/projects/${projectId}/grants/${grantId}/sections/${sectionKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to generate section')
      }
      await loadSections()
    } catch (nextError) {
      alert(nextError instanceof Error ? nextError.message : 'Failed to generate section')
    } finally {
      setBusyKey(null)
    }
  }

  async function generateAll() {
    try {
      setGeneratingAll(true)
      const response = await authFetch(`/api/projects/${projectId}/grants/${grantId}/sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate_all' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to generate sections')
      }
      await loadSections()
    } catch (nextError) {
      alert(nextError instanceof Error ? nextError.message : 'Failed to generate sections')
    } finally {
      setGeneratingAll(false)
    }
  }

  async function saveSection(section: GrantSection) {
    try {
      setSavingKey(section.sectionKey)
      const body =
        section.sectionType === 'narrative' || section.sectionType === 'short_answer'
          ? { content: draftValues[section.sectionKey] || '', markReviewed: true }
          : { structuredData: JSON.parse(structuredValues[section.sectionKey] || '{}'), markReviewed: true }

      const response = await authFetch(`/api/projects/${projectId}/grants/${grantId}/sections/${section.sectionKey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to save section')
      }
      await loadSections()
    } catch (nextError) {
      alert(nextError instanceof Error ? nextError.message : 'Failed to save section')
    } finally {
      setSavingKey(null)
    }
  }

  async function exportDocx() {
    try {
      setExporting(true)
      const response = await authFetch(`/api/projects/${projectId}/grants/${grantId}/export`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.message || 'Failed to export the grant draft')
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `grant_${grantId}.docx`
      anchor.click()
      window.URL.revokeObjectURL(url)
    } catch (nextError) {
      alert(nextError instanceof Error ? nextError.message : 'Failed to export the grant draft')
    } finally {
      setExporting(false)
    }
  }

  if (authLoading || loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">Loading draft workspace...</div>
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl rounded-3xl border border-rose-200 bg-white p-8 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">Draft workspace unavailable</div>
          <p className="mt-3 text-sm text-slate-600">{error || 'The grant draft could not be loaded.'}</p>
          <Link href={`/projects/${projectId}/grants/${grantId}/blueprint`} className="mt-6 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            Back to Blueprint
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href={`/projects/${projectId}/grants/${grantId}/blueprint`} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900">
              <ArrowLeft className="h-4 w-4" />
              Back to Blueprint
            </Link>
            <h1 className="mt-3 text-3xl font-bold text-slate-900">Grant Draft Workspace</h1>
            <p className="mt-2 text-sm text-slate-600">Generate, refine, and export the grant sections in template order.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void generateAll()}
              disabled={generatingAll || !blueprintFrozen}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
            >
              {generatingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate Narrative Sections
            </button>
            <button
              type="button"
              onClick={() => void exportDocx()}
              disabled={exporting || grouped.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export DOCX
            </button>
          </div>
        </div>

        {!blueprintFrozen ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Freeze the blueprint before generating section drafts. The current blueprint status is <strong>{data.blueprint?.status || 'not ready'}</strong>.
          </div>
        ) : null}

        <div className="space-y-4">
          {grouped.map((section) => {
            const isNarrative = section.sectionType === 'narrative' || section.sectionType === 'short_answer'
            return (
              <div key={section.sectionKey} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{section.sectionOrder}</span>
                      <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">{section.sectionType}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{section.status}</span>
                    </div>
                    <h2 className="mt-3 text-xl font-semibold text-slate-900">{section.label}</h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void generateSection(section.sectionKey)}
                      disabled={!blueprintFrozen || busyKey !== null}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {busyKey === section.sectionKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      {isNarrative ? (section.content ? 'Regenerate' : 'Generate') : 'Refresh'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveSection(section)}
                      disabled={savingKey !== null}
                      className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {savingKey === section.sectionKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save
                    </button>
                  </div>
                </div>

                {isNarrative ? (
                  <textarea
                    value={draftValues[section.sectionKey] || ''}
                    onChange={(event) =>
                      setDraftValues((current) => ({ ...current, [section.sectionKey]: event.target.value }))
                    }
                    className="mt-4 min-h-[240px] w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm leading-7 text-slate-700 outline-none focus:border-slate-500"
                    placeholder="Generate or write the section draft here."
                  />
                ) : (
                  <textarea
                    value={structuredValues[section.sectionKey] || '{}'}
                    onChange={(event) =>
                      setStructuredValues((current) => ({ ...current, [section.sectionKey]: event.target.value }))
                    }
                    className="mt-4 min-h-[220px] w-full rounded-2xl border border-slate-300 px-4 py-3 font-mono text-sm leading-6 text-slate-700 outline-none focus:border-slate-500"
                    placeholder="Enter the structured response JSON for this section."
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
