'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Download, FileCheck2, Loader2 } from 'lucide-react'

import BibliographyPreview from '@/components/paper/BibliographyPreview'
import ExportSettingsPanel, { type ExportProfileApiPayload } from '@/components/stages/ExportSettingsPanel'
import { PaperReviewPipelineStepper } from '@/components/stages/PaperReviewWorkflowControls'
import ReferenceUploadPanel from '@/components/stages/ReferenceUploadPanel'
import { removeValueAtPath, setValueAtPath, type PartialExportProfile } from '@/lib/export/export-profile-schema'
import {
  resolveExportConfigWithSources,
  summarizeDocxExportConfig,
  summarizeLatexExportConfig,
} from '@/lib/export/export-config-resolver'

type ReviewExportStageProps = {
  sessionId: string
  authToken: string | null
  onNavigateToStage?: (stage: string) => void
}

type Notice = {
  tone: 'error' | 'success'
  text: string
} | null

export default function ReviewExportStage({ sessionId, authToken, onNavigateToStage }: ReviewExportStageProps) {
  const [structure, setStructure] = useState<any | null>(null)
  const [wordCounts, setWordCounts] = useState<any | null>(null)
  const [unused, setUnused] = useState<any[]>([])
  const [bibtex, setBibtex] = useState('')
  const [notice, setNotice] = useState<Notice>(null)
  const [citationCheck, setCitationCheck] = useState<any | null>(null)
  const [draftContent, setDraftContent] = useState('')
  const [exporting, setExporting] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileData, setProfileData] = useState<ExportProfileApiPayload | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [extracting, setExtracting] = useState(false)
  const [savingOverrides, setSavingOverrides] = useState(false)
  const [inputMode, setInputMode] = useState<'upload' | 'paste'>('upload')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [pastedText, setPastedText] = useState('')
  const [uploadError, setUploadError] = useState<string | null>(null)

  const loadChecks = useCallback(async () => {
    if (!authToken) return
    const headers = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }
    const [structureRes, wordRes, unusedRes] = await Promise.all([
      fetch(`/api/papers/${sessionId}/drafting`, { method: 'POST', headers, body: JSON.stringify({ action: 'analyze_structure' }) }),
      fetch(`/api/papers/${sessionId}/drafting`, { method: 'POST', headers, body: JSON.stringify({ action: 'word_count' }) }),
      fetch(`/api/papers/${sessionId}/citations/unused`, { headers }),
    ])

    if (structureRes.ok) setStructure(await structureRes.json())
    if (wordRes.ok) setWordCounts(await wordRes.json())
    if (unusedRes.ok) {
      const data = await unusedRes.json()
      setUnused(data.citations || [])
    }
  }, [authToken, sessionId])

  const loadDraftContent = useCallback(async () => {
    if (!authToken) return
    try {
      const response = await fetch(`/api/papers/${sessionId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
        cache: 'no-store',
      })
      if (!response.ok) return
      const data = await response.json()
      const session = data.session
      const drafts = Array.isArray(session?.annexureDrafts) ? session.annexureDrafts : []
      const paperDraft = drafts
        .filter((draft: any) => String(draft?.jurisdiction || '').toUpperCase() === 'PAPER')
        .sort((left: any, right: any) => (right?.version || 0) - (left?.version || 0))[0]
      const extraSections = parseExtraSections(paperDraft?.extraSections)
      const humanized = buildHumanizedMap(session?.paperSectionHumanizations || [])
      const content = Object.keys(extraSections)
        .map((key) => pickHumanizedContent(extraSections[key], humanized[normalizeSectionKey(key)]))
        .join('\n\n')
      setDraftContent(content)
    } catch {
      setDraftContent('')
    }
  }, [authToken, sessionId])

  const loadExportProfile = useCallback(async () => {
    if (!authToken) return
    setProfileLoading(true)
    try {
      const response = await fetch(`/api/papers/${sessionId}/export-profile`, {
        headers: { Authorization: `Bearer ${authToken}` },
        cache: 'no-store',
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load export configuration')
      }
      setProfileData(data)
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to load export configuration' })
    } finally {
      setProfileLoading(false)
    }
  }, [authToken, sessionId])

  const checkCitations = async () => {
    if (!draftContent.trim()) {
      setCitationCheck({ total: 0, missing: [], found: [] })
      return
    }
    const response = await fetch(`/api/papers/${sessionId}/drafting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ action: 'check_citations', content: draftContent }),
    })
    const data = await response.json()
    if (!response.ok) {
      setNotice({ tone: 'error', text: data.error || 'Failed to check citations' })
      return
    }
    setCitationCheck(data)
  }

  const downloadFile = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    window.URL.revokeObjectURL(url)
  }

  const handleExport = async (format: 'docx' | 'latex' | 'bibtex') => {
    if (!authToken) return
    try {
      setExporting(format)
      setNotice(null)
      const response = await fetch(`/api/papers/${sessionId}/export?format=${format}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Export failed')
      }
      const disposition = response.headers.get('Content-Disposition') || ''
      const match = /filename=\"?([^\";]+)\"?/i.exec(disposition)
      const fallback = format === 'latex'
        ? `paper_${sessionId}_latex.zip`
        : `paper_${sessionId}.${format === 'bibtex' ? 'bib' : format}`
      const filename = match?.[1] || fallback

      if (format === 'bibtex') {
        const text = await response.text()
        setBibtex(text)
        downloadFile(new Blob([text], { type: 'text/plain;charset=utf-8' }), filename)
        return
      }

      downloadFile(await response.blob(), filename)
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Export failed' })
    } finally {
      setExporting(null)
    }
  }

  const handleExtract = async () => {
    if (!authToken) return
    if (inputMode === 'upload' && !selectedFile) {
      setUploadError('Choose a .docx or .tex file first')
      return
    }
    if (inputMode === 'paste' && !pastedText.trim()) {
      setUploadError('Paste your formatting guidelines first')
      return
    }

    try {
      setExtracting(true)
      setUploadError(null)
      setNotice(null)

      let response: Response
      if (inputMode === 'upload' && selectedFile) {
        const formData = new FormData()
        formData.append('file', selectedFile)
        response = await fetch(`/api/papers/${sessionId}/export-profile`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
          body: formData,
        })
      } else {
        response = await fetch(`/api/papers/${sessionId}/export-profile`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ pastedText }),
        })
      }

      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to extract export settings')
      }

      setProfileData(data)
      setNotice({ tone: 'success', text: 'Export settings extracted and saved.' })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Failed to extract export settings')
    } finally {
      setExtracting(false)
    }
  }

  const saveOverrides = useCallback(async (nextOverrides: PartialExportProfile) => {
    if (!authToken || !profileData) return

    const optimistic = applyOptimisticOverrides(profileData, nextOverrides)
    setProfileData(optimistic)
    setSavingOverrides(true)

    try {
      const response = await fetch(`/api/papers/${sessionId}/export-profile`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ overrides: nextOverrides }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save export overrides')
      }
      setProfileData(data)
    } catch (error) {
      await loadExportProfile()
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to save export overrides' })
    } finally {
      setSavingOverrides(false)
    }
  }, [authToken, loadExportProfile, profileData, sessionId])

  const handleCommitField = useCallback((path: string, value: unknown) => {
    if (!profileData) return
    if (typeof value === 'number' && !Number.isFinite(value)) return

    const currentOverrides = (profileData.profile?.userOverrides || {}) as PartialExportProfile
    const nextOverrides = setValueAtPath(
      structuredClone(currentOverrides || {}),
      path,
      value,
    ) as PartialExportProfile
    void saveOverrides(nextOverrides)
  }, [profileData, saveOverrides])

  const handleResetField = useCallback((path: string) => {
    if (!profileData) return
    const currentOverrides = (profileData.profile?.userOverrides || {}) as PartialExportProfile
    const nextOverrides = removeValueAtPath(
      structuredClone(currentOverrides || {}),
      path,
    ) as PartialExportProfile
    void saveOverrides(nextOverrides)
  }, [profileData, saveOverrides])

  const handleResetAll = useCallback(async () => {
    if (!authToken) return
    try {
      setSavingOverrides(true)
      const response = await fetch(`/api/papers/${sessionId}/export-profile`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to reset export settings')
      }
      setProfileData(data)
      setNotice({ tone: 'success', text: 'Adaptive export settings were reset to defaults.' })
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to reset export settings' })
    } finally {
      setSavingOverrides(false)
    }
  }, [authToken, sessionId])

  useEffect(() => {
    if (!sessionId || !authToken) return
    setLoading(true)
    Promise.all([loadChecks(), loadDraftContent(), loadExportProfile()]).finally(() => setLoading(false))
  }, [authToken, loadChecks, loadDraftContent, loadExportProfile, sessionId])

  const helperText = !profileData?.profile
    ? 'Using default formatting. Upload a reference above to match a specific venue or template.'
    : savingOverrides
      ? 'Saving export override...'
      : null

  return (
    <div className="space-y-6 p-6">
      <PaperReviewPipelineStepper
        currentStage="REVIEW_EXPORT"
        onNavigateToStage={stage => onNavigateToStage?.(stage)}
        canAccessImprove
        canAccessExport
      />

      <div className="rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.08),_transparent_45%),linear-gradient(135deg,#ffffff_0%,#f8fafc_55%,#eff6ff_100%)] p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                <FileCheck2 className="h-3.5 w-3.5" />
                Adaptive export configuration
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Match the export to your target format</h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                This final stage runs after Humanization. Set a reference file or pasted guidelines, review the extracted settings, then export DOCX, LaTeX, or BibTeX with those rules applied.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={loadChecks}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              >
                Refresh Checks
              </button>
              <button
                type="button"
                onClick={() => onNavigateToStage?.('HUMANIZATION')}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Back To Humanization
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          {notice ? (
            <div className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
              notice.tone === 'error'
                ? 'border border-rose-200 bg-rose-50 text-rose-700'
                : 'border border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}>
              {notice.text}
            </div>
          ) : null}
        </div>
      </div>

      <ReferenceUploadPanel
        mode={inputMode}
        selectedFile={selectedFile}
        pastedText={pastedText}
        extracting={extracting}
        error={uploadError}
        onModeChange={(mode) => {
          setInputMode(mode)
          setUploadError(null)
        }}
        onFileChange={(file) => {
          setSelectedFile(file)
          setUploadError(null)
        }}
        onPastedTextChange={(value) => {
          setPastedText(value)
          setUploadError(null)
        }}
        onExtract={handleExtract}
      />

      {profileLoading ? (
        <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex min-h-[160px] items-center justify-center text-slate-600">
            <Loader2 className="mr-3 h-5 w-5 animate-spin" />
            Loading export configuration...
          </div>
        </div>
      ) : !profileData ? (
        <div className="rounded-[32px] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 shadow-sm">
          Unable to load the adaptive export configuration.
        </div>
      ) : profileData.profile ? (
        <ExportSettingsPanel
          data={profileData}
          onCommitField={handleCommitField}
          onResetField={handleResetField}
          onResetAll={handleResetAll}
        />
      ) : (
        <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Export Configuration</div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">No adaptive profile yet</h2>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            Upload a `.docx` or `.tex` reference, or paste venue guidelines above, to extract and review the export settings before download.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[220px] items-center justify-center text-slate-600">
          <Loader2 className="mr-3 h-5 w-5 animate-spin" />
          Loading export checks...
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Missing Required Sections</div>
              <div className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">{structure?.validation?.missingRequiredSections?.length || 0}</div>
              <div className="mt-2 text-sm text-slate-500">Must be zero before final submission</div>
            </div>
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Total Word Count</div>
              <div className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">{wordCounts?.total || 0}</div>
              <div className="mt-2 text-sm text-slate-500">Use this to check venue fit</div>
            </div>
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Unused Citations</div>
              <div className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">{unused.length}</div>
              <div className="mt-2 text-sm text-slate-500">Candidates to prune before export</div>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="space-y-6">
              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Pre-Export Checks</div>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">What still blocks a clean export</h2>
                <div className="mt-4 space-y-3">
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    Missing required sections: {structure?.validation?.missingRequiredSections?.length || 0}
                    {structure?.validation?.missingRequiredSections?.length > 0 ? (
                      <div className="mt-2 text-rose-700">{structure.validation.missingRequiredSections.join(', ')}</div>
                    ) : null}
                  </div>
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    Citation validation: {citationCheck ? `${citationCheck.missing?.length || 0} missing keys` : 'Not run yet'}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={checkCitations}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                    >
                      Check Citations
                    </button>
                    <button
                      type="button"
                      onClick={loadChecks}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    >
                      Refresh Checks
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Disclosure</div>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Academic integrity reminder</h2>
                <p className="mt-4 text-sm leading-7 text-slate-600">
                  Before exporting, confirm citation accuracy, institutional AI-use policy, and originality requirements for your venue or program.
                </p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Export</div>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Download the paper package</h2>
                {helperText ? <p className="mt-2 text-sm text-slate-500">{helperText}</p> : null}
                <div className="mt-4 space-y-3">
                  <ExportButton
                    label="Export DOCX"
                    helper={profileData?.summaries.docx || 'Word export with adaptive formatting'}
                    loading={exporting === 'docx'}
                    disabled={exporting !== null}
                    onClick={() => handleExport('docx')}
                  />
                  <ExportButton
                    label="Export LaTeX"
                    helper={profileData?.summaries.latex || 'Zip package with .tex, .bib, and images'}
                    loading={exporting === 'latex'}
                    disabled={exporting !== null}
                    onClick={() => handleExport('latex')}
                  />
                  <ExportButton
                    label="Export BibTeX"
                    helper="Citations only"
                    loading={exporting === 'bibtex'}
                    disabled={exporting !== null}
                    onClick={() => handleExport('bibtex')}
                  />
                </div>
                <textarea
                  value={bibtex}
                  readOnly
                  rows={8}
                  className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 outline-none"
                  placeholder="BibTeX export appears here after generation."
                />
              </div>

              <BibliographyPreview sessionId={sessionId} authToken={authToken} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ExportButton(props: {
  label: string
  helper: string
  loading: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <div>
        <div className="inline-flex items-center gap-2">
          {props.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          <span>{props.loading ? `${props.label.replace('Export ', 'Exporting ')}...` : props.label}</span>
        </div>
        <div className="mt-1 text-[11px] text-slate-400">{props.helper}</div>
      </div>
    </button>
  )
}

function parseExtraSections(value: any): Record<string, string> {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, string>
    } catch {
      return {}
    }
  }
  return typeof value === 'object' ? value as Record<string, string> : {}
}

function buildHumanizedMap(rows: Array<{ sectionKey: string; humanizedContent?: string; sourceDraftFingerprint?: string }>) {
  const map: Record<string, { humanizedContent?: string; sourceDraftFingerprint?: string }> = {}
  for (const row of rows || []) {
    const key = normalizeSectionKey(String(row?.sectionKey || ''))
    if (!key) continue
    map[key] = row
  }
  return map
}

function pickHumanizedContent(
  draftContent: string,
  record?: { humanizedContent?: string; sourceDraftFingerprint?: string } | null,
) {
  const humanizedContent = typeof record?.humanizedContent === 'string' ? record.humanizedContent : ''
  if (!humanizedContent.trim()) return String(draftContent || '')

  const expectedFingerprint = typeof record?.sourceDraftFingerprint === 'string' ? record.sourceDraftFingerprint : ''
  if (expectedFingerprint && expectedFingerprint !== computeFingerprint(String(draftContent || ''))) {
    return String(draftContent || '')
  }

  return humanizedContent
}

function computeFingerprint(content: string) {
  const normalized = String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()

  let hash = 0
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0
  }

  return `${(hash >>> 0).toString(16)}_${normalized.length}`
}

function normalizeSectionKey(value: string) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function applyOptimisticOverrides(
  data: ExportProfileApiPayload,
  nextOverrides: PartialExportProfile,
): ExportProfileApiPayload {
  const resolved = resolveExportConfigWithSources(
    data.profile?.llmExtracted || null,
    nextOverrides,
    data.venueDefaults,
  )

  return {
    ...data,
    profile: data.profile
      ? {
          ...data.profile,
          userOverrides: nextOverrides,
        }
      : {
          id: 'optimistic',
          sourceType: 'pasted_text',
          confidence: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          llmExtracted: null,
          userOverrides: nextOverrides,
        },
    resolvedConfig: resolved.config,
    fieldSources: resolved.fieldSources,
    summaries: {
      docx: summarizeDocxExportConfig(resolved.config),
      latex: summarizeLatexExportConfig(resolved.config),
    },
  }
}
