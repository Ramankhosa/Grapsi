'use client'

import { type ChangeEvent, type MouseEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  BookOpen,
  Copy,
  Download,
  Loader2,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'

import FloatingWritingPanel from '@/components/paper/FloatingWritingPanel'
import PaperMarkdownEditor, {
  type PaperCitationDisplayMeta,
  type PaperFigureDisplayMeta,
  type PaperMarkdownEditorRef,
} from '@/components/paper/PaperMarkdownEditor'
import {
  collectUsedGrantCitationKeysForBibliography,
  countUsedGrantCitationKeysForBibliography,
} from '@/lib/grants/bibliography'
import {
  isGrantBibliographySection,
  isGrantSectionAiGenerated,
} from '@/lib/grants/workflowMode'
import { budgetStructuredDataHasMeaningfulRows } from '@/lib/grants/budgetTemplate'
// The agency-rule review loop originally shipped in Draft One. Drafting is
// never blocked by rule checks — this reviewer judges the result instead, and
// its findings compose the revision prompt fed back to the engine.
import { buildAiFixInstructions } from '@/lib/draftOne/logic'
import type { GrantAiReviewReport } from '@/types/grant'

type StructuredResponse = {
  id?: string
  fieldKey?: string
  responseJson?: unknown
}

export type GrantSection = {
  id: string
  sectionKey: string
  label: string
  sectionOrder: number
  sectionType: 'narrative' | 'short_answer' | 'checklist' | 'table' | 'budget_rows'
  workflowMode: 'app_draft' | 'app_support' | 'team_manual'
  citationMode?: 'mapped_evidence' | 'direct_draft' | 'no_citations'
  status: string
  content: string | null
  required?: boolean
  wordBudget?: number | null
  characterLimit?: number | null
  dimensions?: string[]
  suggestedCitationCount?: number | null
  grantSemantic?: string | null
  prepContextBlock?: { bullets?: string[]; keywords?: string[] } | null
  grantRuleProfile?: {
    requiredPoints?: string[]
    evaluationFocus?: string[]
    reviewerSignals?: string[]
    avoidRules?: string[]
    formatConstraints?: string[]
  } | null
  isStale?: boolean
  /** Latest agency-rule verdict for this section, served by getGrantWorkspace. */
  grantAiReviewReport?: GrantAiReviewReport | null
  /** True when the content changed after that verdict was produced. */
  grantAiReviewStale?: boolean
  structuredResponses?: StructuredResponse[]
}

type SectionsResponse = {
  sections: GrantSection[]
}

type SectionSaveResponse = {
  section?: GrantSection
  message?: string
}

type BibliographySortOrder = 'alphabetical' | 'order_of_appearance'

type FigurePlan = {
  id: string
  figureNo: number
  title: string
  caption?: string
  description?: string
  imagePath?: string
  status: 'PLANNED' | 'GENERATING' | 'GENERATED' | 'FAILED'
  category?: string
  figureType?: string
}

export type DraftingFilter = 'all' | 'app_draft'

const NUMERIC_BIBLIOGRAPHY_STYLES = new Set(['IEEE', 'VANCOUVER'])

interface GrantSectionDraftingStageProps {
  projectId: string
  grantId: string
  draftingSessionId: string | null
  authToken: string | null
  selectedSection?: string
  onSectionSelect?: (sectionKey: string) => void
  onSessionUpdated?: (session: any) => void
  onSectionsUpdated?: (sections: GrantSection[]) => void
  sectionFilter?: DraftingFilter
  onSectionFilterChange?: (filter: DraftingFilter) => void
}

function getStructuredResponseJson(section: GrantSection) {
  return section.structuredResponses?.find((response) => response.fieldKey === 'structuredData')?.responseJson
    ?? section.structuredResponses?.[0]?.responseJson
}

function structuredJson(section: GrantSection) {
  return JSON.stringify(getStructuredResponseJson(section) || {}, null, 2)
}

export function isNarrativeSection(section: GrantSection) {
  return section.sectionType === 'narrative' || section.sectionType === 'short_answer'
}

function verdictLabel(verdict: string): string {
  if (verdict === 'ready') return 'Ready'
  if (verdict === 'minor_revisions') return 'Minor revisions'
  if (verdict === 'major_revisions') return 'Major revisions'
  return 'Reviewed'
}

function verdictBadgeClass(verdict: string, stale: boolean): string {
  const base = 'flex-none rounded-full px-2 py-0.5 text-[11px] font-semibold'
  if (stale) return `${base} bg-amber-100 text-amber-900`
  if (verdict === 'ready') return `${base} bg-emerald-100 text-emerald-800`
  if (verdict === 'major_revisions') return `${base} bg-rose-100 text-rose-800`
  return `${base} bg-violet-100 text-violet-800`
}

function severityDotClass(severity: string): string {
  const base = 'mt-1 h-1.5 w-1.5 flex-none rounded-full'
  if (severity === 'critical') return `${base} bg-rose-500`
  if (severity === 'important') return `${base} bg-amber-500`
  return `${base} bg-slate-400`
}

export function isPaperBackedSection(section: GrantSection) {
  return section.workflowMode === 'app_draft'
    && isNarrativeSection(section)
    && !isGrantBibliographySection(section.sectionKey)
}

export function isAiGeneratedSection(section: GrantSection) {
  return isGrantSectionAiGenerated({
    sectionKey: section.sectionKey,
    sectionType: section.sectionType,
    workflowMode: section.workflowMode,
  })
}

function sectionWordCount(section: GrantSection) {
  const text = String(section.content || '').replace(/<[^>]*>/g, ' ').trim()
  return text ? text.split(/\s+/).filter(Boolean).length : 0
}

function hasStructuredResponse(section: GrantSection) {
  const responseJson = getStructuredResponseJson(section)
  if (!responseJson) return false
  if (section.sectionType === 'budget_rows') {
    return budgetStructuredDataHasMeaningfulRows(responseJson)
  }
  try {
    const serialized = JSON.stringify(responseJson)
    return Boolean(serialized && serialized !== '{}' && serialized !== '[]')
  } catch {
    return false
  }
}

export function hasSectionContent(section: GrantSection) {
  if (isNarrativeSection(section)) {
    return sectionWordCount(section) > 0
  }
  return hasStructuredResponse(section)
}

function hasPreparedStructuredExportContent(value: unknown, sectionType?: GrantSection['sectionType']): boolean {
  if (value === null || typeof value === 'undefined') return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value !== 'object') return true

  const record = value as Record<string, unknown>
  if (sectionType === 'budget_rows') {
    return budgetStructuredDataHasMeaningfulRows(record)
  }

  if (Array.isArray(record.items)) {
    return record.items.some((item) => {
      const row = item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {}
      return Boolean(row.completed)
        || Boolean(row.checked)
        || Boolean(row.done)
        || String(row.notes || row.comment || row.response || row.value || '').trim().length > 0
    })
  }

  if (Array.isArray(record.rows)) return record.rows.length > 0

  return Object.entries(record).some(([key, entry]) => {
    if (key === 'columns' || key === 'currency') return false
    if (Array.isArray(entry)) return entry.length > 0
    if (entry && typeof entry === 'object') return Object.keys(entry as Record<string, unknown>).length > 0
    return String(entry || '').trim().length > 0
  })
}

function hasPreparedExportContent(section: GrantSection) {
  if (isNarrativeSection(section)) return sectionWordCount(section) > 0
  return hasPreparedStructuredExportContent(getStructuredResponseJson(section), section.sectionType)
}

async function writeClipboardText(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard is not available')
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  try {
    if (!document.execCommand('copy')) {
      throw new Error('Clipboard copy failed')
    }
  } finally {
    document.body.removeChild(textarea)
  }
}

export function filterMatches(section: GrantSection, filter: DraftingFilter) {
  if (filter === 'app_draft') return isAiGeneratedSection(section)
  return true
}

type StructuredTableColumn = { key: string; label: string; kind?: string | null; [key: string]: any }

function AutoSizeTextarea({
  value,
  onChange,
  onClick,
  className,
  placeholder,
  disabled,
  minHeight = 260,
}: {
  value: string
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onClick?: (event: MouseEvent<HTMLTextAreaElement>) => void
  className?: string
  placeholder?: string
  disabled?: boolean
  minHeight?: number
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    const textarea = ref.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.max(minHeight, textarea.scrollHeight)}px`
  }, [minHeight, value])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      onClick={onClick}
      disabled={disabled}
      className={`${className || ''} overflow-hidden`}
      placeholder={placeholder}
      style={{ minHeight }}
    />
  )
}

function safeParseStructuredObject(raw: string): Record<string, any> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function humanizeColumnKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function inferStructuredColumnKind(label: string): string | null {
  const text = String(label || '').trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (!text) return null
  if (/\b(category|head|item|expense)\b/.test(text)) return 'category'
  if (/\b(justification|rationale|basis|description)\b/.test(text)) return 'justification'
  if (/\b(co funding|cofunding|matching|match|cost share|contribution)\b/.test(text)) return 'co_funding'
  if (/\b(total|subtotal|grand total)\b/.test(text)) return 'total'
  if (/\b(year|yr|fy|fiscal year|financial year)\b/.test(text)) return 'year'
  if (/\b(amount|cost|budget|requested|funds|salary|fee|rate)\b/.test(text)) return 'amount'
  if (/\b(note|remark|comment)\b/.test(text)) return 'notes'
  if (/\b(number|qty|quantity|unit)\b/.test(text)) return 'number'
  return 'text'
}

function slugifyStructuredColumnKey(value: string, fallback: string): string {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
  return key || fallback
}

function buildUniqueStructuredColumnKey(columns: StructuredTableColumn[], label: string): string {
  const existing = new Set(columns.map((column) => String(column.key || '').trim()).filter(Boolean))
  const base = slugifyStructuredColumnKey(label, 'column')
  let candidate = base
  let index = 2
  while (existing.has(candidate)) {
    candidate = `${base}_${index}`
    index += 1
  }
  return candidate
}

function deriveStructuredColumns(rows: Array<Record<string, any>>): StructuredTableColumn[] {
  const seen = new Set<string>()
  const keys: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row || {})) {
      if (seen.has(key)) continue
      seen.add(key)
      keys.push(key)
    }
  }
  return keys.map((key) => ({ key, label: humanizeColumnKey(key) }))
}

function appendMarker(content: string, marker: string): string {
  const current = String(content || '')
  if (!current.trim()) return marker
  const separator = /[\s\n]$/.test(current) ? '' : ' '
  return `${current}${separator}${marker}`
}

function budgetInstructionsMayOverwriteAmounts(value: string): boolean {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return false
  return /[\d$₹€£]/.test(text)
    || /\b(amount|cost|costs|budget|total|subtotal|split|allocate|allocation|salary|stipend|fee|rate|funds|funding|lakh|lac|crore|million|thousand|zero|nil)\b/.test(text)
}

function isNumericBibliographyStyle(styleCode: string): boolean {
  return NUMERIC_BIBLIOGRAPHY_STYLES.has(String(styleCode || '').trim().toUpperCase())
}

// Renders structured JSON rows as an editable table so users do not edit raw JSON.
function StructuredTableEditor({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const obj = safeParseStructuredObject(value)
  const rows: Array<Record<string, any>> = Array.isArray(obj.rows) ? obj.rows : []
  const columns: StructuredTableColumn[] = Array.isArray(obj.columns) && obj.columns.length > 0
    ? obj.columns
        .map((column: any) => {
          const columnRecord = column && typeof column === 'object' && !Array.isArray(column) ? column : {}
          return {
            ...columnRecord,
            key: String(column?.key ?? column?.label ?? ''),
            label: String(column?.label ?? column?.key ?? ''),
            kind: column?.kind ?? null,
          }
        })
        .filter((column: StructuredTableColumn) => column.key)
    : deriveStructuredColumns(rows)

  const commitTable = (
    nextRows: Array<Record<string, any>>,
    nextColumns: StructuredTableColumn[] = columns
  ) => {
    onChange(
      JSON.stringify(
        {
          ...obj,
          columns: nextColumns,
          rows: nextRows,
        },
        null,
        2
      )
    )
  }

  const setCell = (rowIndex: number, key: string, cellValue: string) => {
    const nextRows = rows.map((row, index) =>
      index === rowIndex ? { ...row, [key]: cellValue === '' ? null : cellValue } : row
    )
    commitTable(nextRows)
  }

  const setColumnLabel = (columnIndex: number, label: string) => {
    const nextColumns = columns.map((column, index) =>
      index === columnIndex
        ? {
            ...column,
            label,
            kind: inferStructuredColumnKind(label) || column.kind || 'text',
          }
        : column
    )
    commitTable(rows, nextColumns)
  }

  const addRow = () => {
    const blank: Record<string, any> = {}
    for (const column of columns) blank[column.key] = null
    commitTable([...rows, blank])
  }

  const removeLastRow = () => {
    if (rows.length === 0) return
    commitTable(rows.slice(0, -1))
  }

  const addColumn = () => {
    const label = `Column ${columns.length + 1}`
    const key = buildUniqueStructuredColumnKey(columns, label)
    const nextColumn: StructuredTableColumn = {
      key,
      label,
      kind: inferStructuredColumnKind(label),
    }
    const nextRows = rows.map((row) => ({ ...row, [key]: null }))
    commitTable(nextRows, [...columns, nextColumn])
  }

  const removeLastColumn = () => {
    if (columns.length === 0) return
    const columnToRemove = columns[columns.length - 1]
    const nextRows = rows.map((row) => {
      const nextRow = { ...row }
      delete nextRow[columnToRemove.key]
      return nextRow
    })
    commitTable(nextRows, columns.slice(0, -1))
  }

  if (columns.length === 0) {
    return (
      <div className="mt-4" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm italic text-slate-500">
          No table format yet. Add a column or generate this section with AI to populate the table.
        </p>
        <button
          type="button"
          onClick={addColumn}
          disabled={disabled}
          className="mt-2 inline-flex items-center gap-1.5 border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <Plus className="h-3.5 w-3.5" />
          Add column
        </button>
      </div>
    )
  }

  return (
    <div className="mt-3" onClick={(e) => e.stopPropagation()}>
      {obj.currency ? (
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">Currency: {String(obj.currency)}</div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-sans text-[13.5px] leading-5 text-slate-950">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="border border-slate-300 bg-slate-100 p-0 text-left font-semibold text-slate-950"
                >
                  <input
                    value={column.label}
                    onChange={(event) => setColumnLabel(columns.indexOf(column), event.target.value)}
                    disabled={disabled}
                    aria-label={`Column heading ${column.label || column.key}`}
                    className="block w-full min-w-[120px] border-0 bg-transparent px-2 py-1 font-sans text-[13px] font-semibold text-slate-950 outline-none disabled:opacity-60"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="border border-slate-300 px-2 py-2 text-center text-sm italic text-slate-500">
                  No rows yet. Add a row or generate this table with AI.
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {columns.map((column) => (
                    <td key={column.key} className="border border-slate-300 align-top">
                      <AutoSizeTextarea
                        value={row[column.key] == null ? '' : String(row[column.key])}
                        onChange={(event) => setCell(rowIndex, column.key, event.target.value)}
                        disabled={disabled}
                        minHeight={28}
                        className="block w-full resize-none border-0 bg-transparent px-2 py-1 font-sans text-[13.5px] leading-5 text-slate-950 outline-none disabled:opacity-60"
                      />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={addRow}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <Plus className="h-3.5 w-3.5" />
          Add row
        </button>
        <button
          type="button"
          onClick={addColumn}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <Plus className="h-3.5 w-3.5" />
          Add column
        </button>
        {rows.length > 0 ? (
          <button
            type="button"
            onClick={removeLastRow}
            disabled={disabled}
            className="inline-flex items-center border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Remove last row
          </button>
        ) : null}
        {columns.length > 1 ? (
          <button
            type="button"
            onClick={removeLastColumn}
            disabled={disabled}
            className="inline-flex items-center border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Remove last column
          </button>
        ) : null}
      </div>
      {obj.notes ? <p className="mt-2 text-xs leading-5 text-slate-500">Notes: {String(obj.notes)}</p> : null}
    </div>
  )
}

export default function GrantSectionDraftingStage({
  projectId,
  grantId,
  draftingSessionId,
  authToken,
  selectedSection,
  onSectionSelect,
  onSessionUpdated,
  onSectionsUpdated,
  sectionFilter: controlledFilter,
  onSectionFilterChange,
}: GrantSectionDraftingStageProps) {
  const [sections, setSections] = useState<GrantSection[]>([])
  const [internalFilter, setInternalFilter] = useState<DraftingFilter>('all')
  const sectionFilter = controlledFilter ?? internalFilter
  const setSectionFilter = onSectionFilterChange ?? setInternalFilter
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [generatingKey, setGeneratingKey] = useState<string | null>(null)
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})
  const [structuredValues, setStructuredValues] = useState<Record<string, string>>({})
  const [budgetInstructions, setBudgetInstructions] = useState<Record<string, string>>({})
  const [budgetUseCurrentValues, setBudgetUseCurrentValues] = useState<Record<string, boolean>>({})
  // Agency-rule review loop state.
  const [reviewingKey, setReviewingKey] = useState<string | null>(null)
  const [fixingKey, setFixingKey] = useState<string | null>(null)
  const [batchRun, setBatchRun] = useState<'draft' | 'review' | null>(null)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [expandedReviewKeys, setExpandedReviewKeys] = useState<Record<string, boolean>>({})
  // Remarks from the standalone grant reviewer, mapped onto grant sections by
  // ReviewerSectionGrantLink. The endpoint that serves these has existed all
  // along with nothing calling it, so the author never saw the review that the
  // reviewer module had already written about their draft.
  const [reviewerRemarks, setReviewerRemarks] = useState<Record<string, any[]>>({})
  const [reviewerCallId, setReviewerCallId] = useState<string | null>(null)
  const [evidenceNotes, setEvidenceNotes] = useState<Record<string, string>>({})
  const batchStopRef = useRef(false)
  const [exportingDraft, setExportingDraft] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [copiedSectionKey, setCopiedSectionKey] = useState<string | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [panelVisible, setPanelVisible] = useState(true)
  const [figures, setFigures] = useState<FigurePlan[]>([])
  const [citations, setCitations] = useState<any[]>([])
  const [bibliographyStyle, setBibliographyStyle] = useState('APA7')
  const [bibliographySortOrder, setBibliographySortOrder] = useState<BibliographySortOrder>('alphabetical')
  const [generatingBibliography, setGeneratingBibliography] = useState(false)
  const [urgentSaveSectionKey, setUrgentSaveSectionKey] = useState<string | null>(null)
  const [selectedText, setSelectedText] = useState<{
    text: string
    start: number
    end: number
    sectionKey: string
  } | null>(null)
  const editorRefs = useRef<Record<string, PaperMarkdownEditorRef | null>>({})
  const lastAutoBibliographySignatureRef = useRef<string | null>(null)
  const hasLoadedSectionsRef = useRef(false)
  const pendingScrollRestoreRef = useRef<{ x: number; y: number } | null>(null)
  // Batch runs iterate over a snapshot, so they need the freshest section state
  // (content and review verdicts change between steps) without re-subscribing.
  const sectionsRef = useRef<GrantSection[]>([])
  sectionsRef.current = sections

  const preserveScrollOnNextPaint = useCallback(() => {
    if (typeof window === 'undefined') return
    pendingScrollRestoreRef.current = { x: window.scrollX, y: window.scrollY }
  }, [])

  useLayoutEffect(() => {
    const pending = pendingScrollRestoreRef.current
    if (!pending || typeof window === 'undefined') return
    pendingScrollRestoreRef.current = null
    window.requestAnimationFrame(() => {
      window.scrollTo({ left: pending.x, top: pending.y, behavior: 'auto' })
    })
  })

  const loadSections = useCallback(async () => {
    if (!authToken) return
    const showBlockingLoader = !hasLoadedSectionsRef.current

    try {
      if (showBlockingLoader) {
        setLoading(true)
      } else {
        preserveScrollOnNextPaint()
      }
      setError(null)
      const response = await fetch(`/api/projects/${projectId}/grants/${grantId}/sections`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const payload = await response.json().catch(() => ({})) as SectionsResponse & { message?: string }
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to load grant sections')
      }

      const nextSections = Array.isArray(payload.sections)
        ? [...payload.sections].sort((a, b) => a.sectionOrder - b.sectionOrder)
        : []
      setSections(nextSections)

      const nextDrafts: Record<string, string> = {}
      const nextStructured: Record<string, string> = {}
      for (const section of nextSections) {
        nextDrafts[section.sectionKey] = section.content || ''
        nextStructured[section.sectionKey] = structuredJson(section)
      }
      setDraftValues(nextDrafts)
      setStructuredValues(nextStructured)
      onSectionsUpdated?.(nextSections)
      hasLoadedSectionsRef.current = true
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load grant sections')
    } finally {
      if (showBlockingLoader) {
        setLoading(false)
      }
    }
  }, [authToken, grantId, onSectionsUpdated, preserveScrollOnNextPaint, projectId])

  useEffect(() => {
    void loadSections()
  }, [loadSections])

  const loadCitations = useCallback(async () => {
    if (!authToken || !draftingSessionId) return
    try {
      const response = await fetch(`/api/papers/${draftingSessionId}/citations`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (!response.ok) return
      const payload = await response.json().catch(() => ({}))
      setCitations(Array.isArray(payload.citations) ? payload.citations : [])
      const nextStyle = typeof payload.citationStyle === 'string' && payload.citationStyle.trim()
        ? payload.citationStyle.trim()
        : ''
      if (nextStyle) {
        setBibliographyStyle(nextStyle)
      }
      const nextSortOrder = payload.citationStyleMeta?.sortOrder
      if (nextSortOrder === 'alphabetical' || nextSortOrder === 'order_of_appearance') {
        setBibliographySortOrder(nextSortOrder)
      } else if (nextStyle && isNumericBibliographyStyle(nextStyle)) {
        setBibliographySortOrder('order_of_appearance')
      }
    } catch {
      // Panel data is auxiliary; the editor remains usable if this read fails.
    }
  }, [authToken, draftingSessionId])

  const loadFigures = useCallback(async () => {
    if (!authToken) return
    try {
      const [paperResponse, diagramResponse] = await Promise.all([
        draftingSessionId
          ? fetch(`/api/papers/${draftingSessionId}/figures`, {
              headers: { Authorization: `Bearer ${authToken}` },
            })
          : Promise.resolve(null),
        fetch(`/api/projects/${projectId}/grants/${grantId}/diagrams`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
      ])

      const paperPayload = paperResponse?.ok ? await paperResponse.json().catch(() => ({})) : {}
      const paperFigures = Array.isArray(paperPayload.figures)
        ? paperPayload.figures.map((figure: any): FigurePlan => ({
            id: String(figure.id || ''),
            figureNo: Number(figure.figureNo || 0),
            title: String(figure.title || 'Figure'),
            caption: figure.caption || figure.nodes?.caption || figure.description || undefined,
            description: figure.description || undefined,
            imagePath: figure.imagePath || figure.nodes?.imagePath || undefined,
            status: figure.status || figure.nodes?.status || (figure.imagePath ? 'GENERATED' : 'PLANNED'),
            category: figure.category || figure.nodes?.category || 'CHART',
            figureType: figure.figureType || figure.nodes?.figureType || 'auto',
          })).filter((figure: FigurePlan) => figure.id)
        : []

      const diagramPayload = diagramResponse.ok ? await diagramResponse.json().catch(() => ({})) : {}
      const grantDiagramFigures = Array.isArray(diagramPayload.diagrams)
        ? diagramPayload.diagrams.map((diagram: any): FigurePlan => ({
            id: String(diagram.id || ''),
            figureNo: Number(diagram.figureNo || 0),
            title: String(diagram.title || 'Diagram'),
            caption: diagram.caption || undefined,
            description: undefined,
            imagePath: diagram.imageUrl || undefined,
            status: diagram.status === 'READY' ? 'GENERATED' : diagram.status === 'FAILED' ? 'FAILED' : 'PLANNED',
            category: 'DIAGRAM',
            figureType: String(diagram.kind || 'diagram'),
          })).filter((figure: FigurePlan) => figure.id)
        : []

      // Grant Diagram Studio figures share the [Figure N] numbering space with
      // legacy figure-planner figures; on a collision the studio figure wins.
      const byNo = new Map<number, FigurePlan>()
      paperFigures.forEach((figure: FigurePlan) => {
        if (figure.figureNo) byNo.set(figure.figureNo, figure)
      })
      grantDiagramFigures.forEach((figure: FigurePlan) => {
        if (figure.figureNo) byNo.set(figure.figureNo, figure)
      })
      const merged = Array.from(byNo.values()).sort((a, b) => a.figureNo - b.figureNo)
      setFigures(merged)
    } catch {
      // Panel data is auxiliary; the editor remains usable if this read fails.
    }
  }, [authToken, draftingSessionId, grantId, projectId])

  useEffect(() => {
    if (draftingSessionId) {
      void loadCitations()
    }
    void loadFigures()
  }, [draftingSessionId, loadCitations, loadFigures])

  const isNumericStyleBibliography = useMemo(
    () => isNumericBibliographyStyle(bibliographyStyle),
    [bibliographyStyle]
  )

  useEffect(() => {
    if (isNumericStyleBibliography && bibliographySortOrder !== 'order_of_appearance') {
      setBibliographySortOrder('order_of_appearance')
    }
  }, [bibliographySortOrder, isNumericStyleBibliography])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const previousOverflow = document.body.style.overflow
    if (focusMode) {
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [focusMode])

  useEffect(() => {
    if (!onSectionSelect || sections.length === 0) return
    if (selectedSection && sections.some((section) => section.sectionKey === selectedSection)) return
    onSectionSelect(sections[0].sectionKey)
  }, [onSectionSelect, sections, selectedSection])

  const filteredSections = useMemo(
    () => sections.filter((section) => filterMatches(section, sectionFilter)),
    [sectionFilter, sections]
  )

  useEffect(() => {
    if (!onSectionSelect || filteredSections.length === 0) return
    if (selectedSection && filteredSections.some((section) => section.sectionKey === selectedSection)) return
    onSectionSelect(filteredSections[0].sectionKey)
  }, [filteredSections, onSectionSelect, selectedSection])

  const currentSection = useMemo(() => {
    if (sections.length === 0) return null
    return sections.find((section) => section.sectionKey === selectedSection) || sections[0]
  }, [sections, selectedSection])

  const currentContent = useMemo(() => {
    if (!currentSection) return ''
    return isNarrativeSection(currentSection)
      ? draftValues[currentSection.sectionKey] || ''
      : structuredValues[currentSection.sectionKey] || ''
  }, [currentSection, draftValues, structuredValues])

  const availableSectionContexts = useMemo(() => {
    return sections
      .map((section) => ({
        sectionKey: section.sectionKey,
        label: section.label,
        content: isNarrativeSection(section)
          ? draftValues[section.sectionKey] || ''
          : structuredValues[section.sectionKey] || '',
      }))
      .filter((section) => section.content.trim().length > 0)
  }, [draftValues, sections, structuredValues])

  const usedCitationKeys = useMemo(() => {
    return collectUsedGrantCitationKeysForBibliography(
      sections.map((section) => ({
        sectionKey: section.sectionKey,
        content: isNarrativeSection(section) ? draftValues[section.sectionKey] || '' : '',
        structuredResponses: isNarrativeSection(section)
          ? []
          : [{ responseJson: safeParseStructuredObject(structuredValues[section.sectionKey] || '{}') }],
      })),
      citations.map((citation) => String(citation?.citationKey || '')).filter(Boolean)
    )
  }, [citations, draftValues, sections, structuredValues])

  const usedCitationCountsByKey = useMemo(() => {
    return countUsedGrantCitationKeysForBibliography(
      sections.map((section) => ({
        sectionKey: section.sectionKey,
        content: isNarrativeSection(section) ? draftValues[section.sectionKey] || '' : '',
        structuredResponses: isNarrativeSection(section)
          ? []
          : [{ responseJson: safeParseStructuredObject(structuredValues[section.sectionKey] || '{}') }],
      })),
      citations.map((citation) => String(citation?.citationKey || '')).filter(Boolean)
    )
  }, [citations, draftValues, sections, structuredValues])

  const usedCitationSignature = useMemo(
    () => Object.entries(usedCitationCountsByKey)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, count]) => `${key}:${count}`)
      .join('|'),
    [usedCitationCountsByKey]
  )

  const citationDisplayMeta = useMemo<PaperCitationDisplayMeta>(() => {
    const displayByKey: Record<string, string> = {}
    const orderByKey: Record<string, number> = {}
    const usedOrderByKey = new Map<string, number>()
    usedCitationKeys.forEach((key, index) => {
      usedOrderByKey.set(String(key || '').trim().toLocaleLowerCase('en-US'), index + 1)
    })
    citations.forEach((citation, index) => {
      const key = String(citation?.citationKey || '').trim()
      if (!key) return
      const authors = String(citation?.authors || '').split(/[;,]/)[0]?.trim()
      const year = citation?.year ? String(citation.year).trim() : ''
      const displayOrder = usedOrderByKey.get(key.toLocaleLowerCase('en-US')) || index + 1
      displayByKey[key] = isNumericStyleBibliography
        ? `[${displayOrder}]`
        : authors && year
          ? `[${authors}, ${year}]`
          : `[${key}]`
      orderByKey[key] = displayOrder
    })
    return {
      styleCode: bibliographyStyle,
      displayByKey,
      orderByKey,
      signature: [
        bibliographyStyle,
        isNumericStyleBibliography ? usedCitationSignature : '',
        citations.map((citation) => `${citation?.citationKey || ''}:${citation?.year || ''}`).join('|'),
      ].join('::'),
    }
  }, [bibliographyStyle, citations, isNumericStyleBibliography, usedCitationKeys, usedCitationSignature])

  const figureDisplayMeta = useMemo<PaperFigureDisplayMeta>(() => {
    const byNo: PaperFigureDisplayMeta['byNo'] = {}
    figures.forEach((figure) => {
      if (!figure.figureNo) return
      byNo[figure.figureNo] = {
        title: figure.title,
        imagePath: figure.imagePath,
      }
    })
    return {
      byNo,
      signature: figures.map((figure) => `${figure.figureNo}:${figure.title}:${figure.imagePath || ''}`).join('|'),
    }
  }, [figures])

  const appendToCurrentNarrativeSection = useCallback((marker: string) => {
    const targetSection = currentSection
    if (!targetSection || !isNarrativeSection(targetSection)) return
    const editor = editorRefs.current[targetSection.sectionKey]
    if (editor) {
      preserveScrollOnNextPaint()
      editor.insertTextAtCursor(marker)
      const syncEditorMarkdown = () => {
        const nextMarkdown = editor.getMarkdown()
        setDraftValues((current) => {
          if ((current[targetSection.sectionKey] || '') === nextMarkdown) return current
          return { ...current, [targetSection.sectionKey]: nextMarkdown }
        })
      }
      syncEditorMarkdown()
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(syncEditorMarkdown)
      }
      setUrgentSaveSectionKey(targetSection.sectionKey)
      return
    }
    preserveScrollOnNextPaint()
    setDraftValues((current) => ({
      ...current,
      [targetSection.sectionKey]: appendMarker(current[targetSection.sectionKey] || '', marker),
    }))
    setUrgentSaveSectionKey(targetSection.sectionKey)
  }, [currentSection, preserveScrollOnNextPaint])

  const handleInsertFigure = useCallback((figureId: string) => {
    const figure = figures.find((entry) => entry.id === figureId)
    if (!figure?.figureNo) return
    appendToCurrentNarrativeSection(`[Figure ${figure.figureNo}]`)
  }, [appendToCurrentNarrativeSection, figures])

  const handleInsertCitation = useCallback((citation: any) => {
    const citationKey = String(citation?.citationKey || '').trim()
    if (!citationKey) return
    appendToCurrentNarrativeSection(`[CITE:${citationKey}]`)
  }, [appendToCurrentNarrativeSection])

  const handleTextAction = useCallback(async (
    action: 'rewrite' | 'expand' | 'condense' | 'formal' | 'simple' | 'create_sections',
    text: string,
    customInstructions?: string
  ): Promise<string> => {
    if (!authToken || !draftingSessionId || !text.trim()) {
      throw new Error('Missing required parameters')
    }

    const targetSectionKey = selectedText?.sectionKey || currentSection?.sectionKey
    const targetSection = sections.find((section) => section.sectionKey === targetSectionKey)
    if (!targetSectionKey || !targetSection || !isNarrativeSection(targetSection)) {
      throw new Error('Please select text in a narrative grant section first')
    }

    const editor = editorRefs.current[targetSectionKey]
    const savedRange = editor?.saveSelection() || (
      selectedText && selectedText.sectionKey === targetSectionKey
        ? { from: selectedText.start, to: selectedText.end }
        : null
    )

    try {
      setError(null)
      const response = await fetch(`/api/papers/${draftingSessionId}/text-action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          action,
          selectedText: text,
          context: (draftValues[targetSectionKey] || '').slice(0, 500),
          sectionKey: targetSectionKey,
          customInstructions,
        }),
      })
      const payload = await response.json().catch(() => ({})) as { transformedText?: string; error?: string }
      if (!response.ok) {
        throw new Error(payload.error || 'Text action failed')
      }

      const transformedText = String(payload.transformedText || '')
      if (!transformedText.trim()) {
        throw new Error('Text action returned empty content')
      }

      preserveScrollOnNextPaint()
      if (editor && savedRange && savedRange.from !== savedRange.to) {
        editor.replaceRange(savedRange.from, savedRange.to, transformedText)
        const syncEditorMarkdown = () => {
          const nextMarkdown = editor.getMarkdown()
          setDraftValues((current) => {
            if ((current[targetSectionKey] || '') === nextMarkdown) return current
            return { ...current, [targetSectionKey]: nextMarkdown }
          })
        }
        syncEditorMarkdown()
        if (typeof window !== 'undefined') {
          window.requestAnimationFrame(syncEditorMarkdown)
        }
      } else {
        setDraftValues((current) => {
          const currentValue = current[targetSectionKey] || ''
          const nextValue = currentValue.includes(text)
            ? currentValue.replace(text, transformedText)
            : appendMarker(currentValue, transformedText)
          return { ...current, [targetSectionKey]: nextValue }
        })
      }

      setSelectedText(null)
      setUrgentSaveSectionKey(targetSectionKey)
      return transformedText
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Text action failed')
      throw nextError
    }
  }, [
    authToken,
    currentSection?.sectionKey,
    draftingSessionId,
    draftValues,
    preserveScrollOnNextPaint,
    sections,
    selectedText,
  ])

  const handleGenerateFigure = useCallback(async (description: string, meta?: Record<string, any>) => {
    if (!authToken || !draftingSessionId || !description.trim()) return
    const title = String(meta?.title || description.trim().slice(0, 100) || 'Generated figure')
    const createResponse = await fetch(`/api/papers/${draftingSessionId}/figures`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        title,
        caption: String(meta?.caption || description.trim()),
        generationPrompt: description,
        category: meta?.category || 'DIAGRAM',
        figureType: meta?.suggestedType || 'auto',
        notes: '',
        suggestionMeta: meta || null,
      }),
    })
    const createPayload = await createResponse.json().catch(() => ({}))
    if (!createResponse.ok) {
      throw new Error(createPayload.error || createPayload.message || 'Failed to create figure')
    }

    const figureId = createPayload.figure?.id
    if (figureId) {
      const generateResponse = await fetch(`/api/papers/${draftingSessionId}/figures/${figureId}/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (!generateResponse.ok) {
        const generatePayload = await generateResponse.json().catch(() => ({}))
        throw new Error(generatePayload.error || generatePayload.message || 'Failed to generate figure')
      }
    }
    await loadFigures()
  }, [authToken, draftingSessionId, loadFigures])

  const handleGenerateExistingFigure = useCallback(async (figureId: string) => {
    if (!authToken || !draftingSessionId || !figureId) return
    const response = await fetch(`/api/papers/${draftingSessionId}/figures/${figureId}/generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error || payload.message || 'Failed to generate figure')
    }
    await loadFigures()
  }, [authToken, draftingSessionId, loadFigures])

  const refreshShadowSession = useCallback(async () => {
    if (!authToken || !draftingSessionId || !onSessionUpdated) return
    try {
      const response = await fetch(`/api/papers/${draftingSessionId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (!response.ok) return
      const payload = await response.json().catch(() => ({}))
      if (payload.session) {
        onSessionUpdated(payload.session)
      }
    } catch {
      // Best-effort shell refresh.
    }
  }, [authToken, draftingSessionId, onSessionUpdated])

  const applyPersistedSection = useCallback((
    updatedSection: GrantSection,
    options: { syncLocalValue?: boolean; preserveScroll?: boolean } = {}
  ) => {
    if (options.preserveScroll) {
      preserveScrollOnNextPaint()
    }
    setSections((current) => {
      const nextSections = current.map((section) =>
        section.sectionKey === updatedSection.sectionKey
          ? {
              ...section,
              ...updatedSection,
              sectionOrder: updatedSection.sectionOrder ?? section.sectionOrder,
            }
          : section
      )
      onSectionsUpdated?.(nextSections)
      return nextSections
    })
    if (options.syncLocalValue) {
      if (isNarrativeSection(updatedSection)) {
        setDraftValues((current) => ({
          ...current,
          [updatedSection.sectionKey]: updatedSection.content || '',
        }))
      } else {
        setStructuredValues((current) => ({
          ...current,
          [updatedSection.sectionKey]: structuredJson(updatedSection),
        }))
      }
    }
  }, [onSectionsUpdated, preserveScrollOnNextPaint])

  const persistSection = useCallback(async (section: GrantSection, markReviewed: boolean) => {
    if (!authToken) throw new Error('You must be signed in to save grant sections')

    const body =
      section.sectionType === 'narrative' || section.sectionType === 'short_answer'
        ? { content: draftValues[section.sectionKey] || '', markReviewed }
        : { structuredData: JSON.parse(structuredValues[section.sectionKey] || '{}'), markReviewed }

    const response = await fetch(`/api/projects/${projectId}/grants/${grantId}/sections/${section.sectionKey}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({})) as SectionSaveResponse
    if (!response.ok) {
      throw new Error(payload.message || 'Failed to save grant section')
    }

    if (payload.section) {
      applyPersistedSection(payload.section)
    }

    return payload
  }, [applyPersistedSection, authToken, draftValues, grantId, projectId, structuredValues])

  const hasLocalGrantSectionChange = useCallback((section: GrantSection) => {
    if (isNarrativeSection(section)) {
      return (draftValues[section.sectionKey] || '') !== (section.content || '')
    }
    return (structuredValues[section.sectionKey] || '{}') !== structuredJson(section)
  }, [draftValues, structuredValues])

  const getLocalGrantSectionText = useCallback((section: GrantSection) => {
    if (isNarrativeSection(section)) {
      return draftValues[section.sectionKey] || section.content || ''
    }
    return structuredValues[section.sectionKey] || structuredJson(section)
  }, [draftValues, structuredValues])

  const hasLocalGrantSectionContent = useCallback((section: GrantSection) => {
    const text = getLocalGrantSectionText(section)
      .replace(/<[^>]*>/g, ' ')
      .trim()
    if (!text || text === '{}' || text === '[]') return false
    if (isNarrativeSection(section)) {
      return text.split(/\s+/).filter(Boolean).length > 0
    }
    return true
  }, [getLocalGrantSectionText])

  const copyGrantSectionContent = useCallback(async (section: GrantSection) => {
    const text = getLocalGrantSectionText(section).trim()
    if (!text || text === '{}' || text === '[]') {
      setError('No content is available to copy for this section yet.')
      return
    }

    try {
      await writeClipboardText(text)
      setCopiedSectionKey(section.sectionKey)
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          setCopiedSectionKey((current) => current === section.sectionKey ? null : current)
        }, 1400)
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to copy section content')
    }
  }, [getLocalGrantSectionText])

  const saveGeneratedNarrativeGrantSection = useCallback(async (section: GrantSection, content: string) => {
    if (!authToken) throw new Error('You must be signed in to save grant sections')

    const response = await fetch(`/api/projects/${projectId}/grants/${grantId}/sections/${section.sectionKey}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ content, markReviewed: false }),
    })
    const payload = await response.json().catch(() => ({})) as SectionSaveResponse
    if (!response.ok) {
      throw new Error(payload.message || 'Failed to save generated grant section')
    }
    if (payload.section) {
      applyPersistedSection(payload.section, { syncLocalValue: true, preserveScroll: true })
    }
    return payload
  }, [applyPersistedSection, authToken, grantId, projectId])

  const syncPaperDraftSectionContent = useCallback(async (section: GrantSection, content: string) => {
    if (!authToken || !draftingSessionId || !content.trim()) return

    const response = await fetch(`/api/papers/${draftingSessionId}/drafting`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        action: 'save_section',
        sectionKey: section.sectionKey,
        content,
      }),
    })
    const payload = await response.json().catch(() => ({})) as { error?: string; message?: string }
    if (!response.ok) {
      throw new Error(payload.error || payload.message || 'Failed to sync section content before generation')
    }
  }, [authToken, draftingSessionId])

  /**
   * Generate (or revise) one narrative section through the drafting engine.
   * `instructions` carries the reviewer's revision prompt on a "Fix with AI"
   * pass. Returns whether the section was written, so batch runs can count.
   */
  const generateNarrativeGrantSection = useCallback(async (
    section: GrantSection,
    forceRegenerate = false,
    instructions = ''
  ): Promise<boolean> => {
    if (!authToken) {
      setError('You must be signed in to generate grant sections')
      return false
    }
    if (!draftingSessionId) {
      setError('The linked drafting workspace is not available yet.')
      return false
    }
    if (!isPaperBackedSection(section)) {
      setError('Only app draft narrative sections can be generated from this control.')
      return false
    }

    try {
      setGeneratingKey(section.sectionKey)
      setError(null)
      preserveScrollOnNextPaint()

      const localContent = getLocalGrantSectionText(section)
      if (localContent.trim()) {
        await syncPaperDraftSectionContent(section, localContent)
      }

      const runGeneration = async (useMappedEvidence: boolean) => {
        const response = await fetch(`/api/papers/${draftingSessionId}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            action: forceRegenerate || instructions || localContent.trim() ? 'regenerate_section' : 'generate_section',
            sectionKey: section.sectionKey,
            instructions: instructions || '',
            useMappedEvidence,
            allowGrantEvidenceBypass: !useMappedEvidence,
            autoCitationRepair: false,
          }),
        })
        const payload = await response.json().catch(() => ({})) as {
          content?: string
          code?: string
          error?: string
          message?: string
          hint?: string
        }
        if (!response.ok) {
          const hint = payload.hint ? ` ${payload.hint}` : ''
          const failure = new Error(`${payload.error || payload.message || 'Failed to generate grant section'}${hint}`)
          ;(failure as Error & { code?: string }).code = payload.code
          throw failure
        }
        return String(payload.content || '').trim()
      }

      let generatedContent: string
      try {
        generatedContent = await runGeneration(section.citationMode !== 'no_citations')
      } catch (generationError) {
        // Drafting must not be blocked when no evidence has been mapped — the
        // author may have skipped literature search entirely. Fall back to an
        // uncited draft and say so, rather than failing the section.
        const code = (generationError as Error & { code?: string }).code
        if (code === 'MAPPED_EVIDENCE_MISSING' || code === 'GRANT_EVIDENCE_READINESS_FAILED') {
          generatedContent = await runGeneration(false)
          setEvidenceNotes((notes) => ({
            ...notes,
            [section.sectionKey]:
              'Drafted without mapped citations — run Literature Search to add evidence, then regenerate.',
          }))
        } else {
          throw generationError
        }
      }

      if (!generatedContent) {
        throw new Error('Generation returned empty content')
      }

      setDraftValues((current) => ({
        ...current,
        [section.sectionKey]: generatedContent,
      }))
      await saveGeneratedNarrativeGrantSection(section, generatedContent)
      await refreshShadowSession()
      return true
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to generate grant section')
      return false
    } finally {
      setGeneratingKey(null)
    }
  }, [
    authToken,
    draftingSessionId,
    getLocalGrantSectionText,
    preserveScrollOnNextPaint,
    refreshShadowSession,
    saveGeneratedNarrativeGrantSection,
    syncPaperDraftSectionContent,
  ])

  const generateBudgetSection = useCallback(async (section: GrantSection) => {
    if (!authToken) {
      setError('You must be signed in to generate grant sections')
      return
    }

    try {
      setGeneratingKey(section.sectionKey)
      setError(null)
      if (hasLocalGrantSectionChange(section)) {
        await persistSection(section, false)
      }

      const instructionText = budgetInstructions[section.sectionKey] || ''
      const response = await fetch(`/api/projects/${projectId}/grants/${grantId}/sections/${section.sectionKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          action: hasSectionContent(section) ? 'regenerate' : 'generate',
          userInstructions: instructionText || undefined,
          allowInstructionAmounts: true,
          overwriteAmounts: budgetInstructionsMayOverwriteAmounts(instructionText),
          useCurrentBudgetValues: budgetUseCurrentValues[section.sectionKey] === true,
        }),
      })
      const payload = await response.json().catch(() => ({})) as SectionSaveResponse
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to generate the table section')
      }

      if (payload.section) {
        applyPersistedSection(payload.section, { syncLocalValue: true, preserveScroll: true })
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to generate the table section')
    } finally {
      setGeneratingKey(null)
    }
  }, [
    authToken,
    budgetInstructions,
    budgetUseCurrentValues,
    grantId,
    hasLocalGrantSectionChange,
    applyPersistedSection,
    persistSection,
    projectId,
  ])

  const persistLocalGrantSectionChanges = useCallback(async () => {
    const changedSections = sections.filter((section) => hasLocalGrantSectionChange(section))
    if (changedSections.length === 0) return

    for (const section of changedSections) {
      await persistSection(section, false)
    }
  }, [hasLocalGrantSectionChange, persistSection, sections])

  /**
   * Run the LLM agency-rule review for one drafted section. Any unsaved local
   * edit is persisted first so the reviewer judges what the author sees.
   */
  const runSectionAiReview = useCallback(async (section: GrantSection): Promise<boolean> => {
    if (!authToken) {
      setError('You must be signed in to run the AI review')
      return false
    }

    try {
      setReviewingKey(section.sectionKey)
      setError(null)
      if (hasLocalGrantSectionChange(section)) {
        await persistSection(section, false)
      }

      const response = await fetch(
        `/api/projects/${projectId}/grants/${grantId}/sections/${encodeURIComponent(section.sectionKey)}/ai-review`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({}),
        }
      )
      const payload = await response.json().catch(() => ({})) as { report?: GrantAiReviewReport; message?: string }
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to run the AI review')
      }

      // Patch the verdict in place instead of reloading every section, so the
      // author's scroll position and unsaved edits elsewhere survive.
      setSections((current) => current.map((entry) => (
        entry.sectionKey === section.sectionKey
          ? { ...entry, grantAiReviewReport: payload.report || null, grantAiReviewStale: false }
          : entry
      )))
      setExpandedReviewKeys((current) => ({ ...current, [section.sectionKey]: true }))
      return true
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to run the AI review')
      return false
    } finally {
      setReviewingKey(null)
    }
  }, [authToken, grantId, hasLocalGrantSectionChange, persistSection, projectId])

  /** Pull the grant reviewer's remarks for this proposal, grouped by section. */
  const loadReviewerRemarks = useCallback(async () => {
    if (!authToken) return
    try {
      const response = await fetch(
        `/api/projects/${projectId}/grants/${grantId}/reviewer/recommendations`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      )
      if (!response.ok) return
      const payload = await response.json().catch(() => ({}))
      setReviewerCallId(payload.callId || null)
      setReviewerRemarks(payload.recommendationsBySection || {})
    } catch (remarkError) {
      // Remarks are supplementary — drafting still works without them.
      console.warn('Could not load reviewer remarks', remarkError)
    }
  }, [authToken, grantId, projectId])

  useEffect(() => {
    void loadReviewerRemarks()
  }, [loadReviewerRemarks])

  /**
   * One revision pass, then a fresh review so the verdict on screen always
   * matches the content on screen.
   *
   * `options.includeReviewerRemarks` folds in the grant reviewer's findings for
   * this section as well as the drafting review's own — they are independent
   * assessments and the rewrite should answer both.
   */
  const fixSectionWithAiReview = useCallback(async (
    section: GrantSection,
    options?: { includeReviewerRemarks?: boolean }
  ) => {
    const report = section.grantAiReviewReport
    const remarks = options?.includeReviewerRemarks
      ? (reviewerRemarks[section.sectionKey] || []).filter((item: any) => item.status !== 'resolved')
      : []

    if (!report && remarks.length === 0) return

    const instructions = buildAiFixInstructions({
      section: {
        label: section.label,
        wordBudget: section.wordBudget ?? null,
        characterLimit: section.characterLimit ?? null,
        content: getLocalGrantSectionText(section),
      },
      report,
      reviewerRecommendations: remarks,
      userNote: reviewNotes[section.sectionKey] || null,
    })
    if (!instructions) return

    try {
      setFixingKey(section.sectionKey)
      const written = await generateNarrativeGrantSection(section, true, instructions)
      if (!written) return
      setReviewNotes((notes) => ({ ...notes, [section.sectionKey]: '' }))

      // Mark the remarks answered so the panel does not keep asking for a fix
      // that has already been applied. The reviewer still has the final say on
      // the next run — this only records that the rewrite addressed them.
      if (remarks.length > 0) {
        try {
          await fetch(`/api/projects/${projectId}/grants/${grantId}/reviewer/recommendations`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({
              updates: remarks.map((item: any) => ({
                id: item.id,
                reviewerSectionId: item.reviewerSectionId,
                status: 'resolved',
              })),
            }),
          })
          await loadReviewerRemarks()
        } catch (patchError) {
          console.warn('Could not record remark status', patchError)
        }
      }

      const latest = sectionsRef.current.find((entry) => entry.sectionKey === section.sectionKey) || section
      await runSectionAiReview(latest)
    } finally {
      setFixingKey(null)
    }
  }, [
    authToken,
    generateNarrativeGrantSection,
    getLocalGrantSectionText,
    grantId,
    loadReviewerRemarks,
    projectId,
    reviewNotes,
    reviewerRemarks,
    runSectionAiReview,
  ])

  /** Sections the batch runs operate on: AI-draftable narrative sections. */
  const aiDraftableSections = useMemo(
    () => sections.filter((section) => isPaperBackedSection(section) && !isGrantBibliographySection(section.sectionKey)),
    [sections]
  )

  const draftAllPendingSections = useCallback(async () => {
    if (batchRun) return
    const queue = aiDraftableSections.filter(
      (section) => !getLocalGrantSectionText(section).trim() || section.isStale
    )
    if (!queue.length) {
      setError('Every AI-draftable section already has content — use the per-section controls to revise.')
      return
    }

    setBatchRun('draft')
    batchStopRef.current = false
    setBatchProgress({ done: 0, total: queue.length })
    try {
      for (const [index, section] of queue.entries()) {
        if (batchStopRef.current) break
        const latest = sectionsRef.current.find((entry) => entry.sectionKey === section.sectionKey) || section
        await generateNarrativeGrantSection(latest)
        setBatchProgress({ done: index + 1, total: queue.length })
      }
    } finally {
      setBatchRun(null)
      setBatchProgress(null)
    }
  }, [aiDraftableSections, batchRun, generateNarrativeGrantSection, getLocalGrantSectionText])

  const reviewAllDraftedSections = useCallback(async () => {
    if (batchRun) return
    const queue = aiDraftableSections.filter((section) => {
      if (!getLocalGrantSectionText(section).trim()) return false
      return !section.grantAiReviewReport || section.grantAiReviewStale
    })
    if (!queue.length) {
      setError('Every drafted section already has a current AI review.')
      return
    }

    setBatchRun('review')
    batchStopRef.current = false
    setBatchProgress({ done: 0, total: queue.length })
    try {
      for (const [index, section] of queue.entries()) {
        if (batchStopRef.current) break
        const latest = sectionsRef.current.find((entry) => entry.sectionKey === section.sectionKey) || section
        await runSectionAiReview(latest)
        setBatchProgress({ done: index + 1, total: queue.length })
      }
    } finally {
      setBatchRun(null)
      setBatchProgress(null)
    }
  }, [aiDraftableSections, batchRun, getLocalGrantSectionText, runSectionAiReview])

  const bibliographySectionExists = useMemo(
    () => sections.some((section) => isGrantBibliographySection(section.sectionKey)),
    [sections]
  )

  const refreshBibliographySection = useCallback(async (
    silent = false,
    override?: {
      style?: string
      sortOrder?: BibliographySortOrder
    }
  ) => {
    if (!authToken || !bibliographySectionExists) return false
    if (savingKey !== null || generatingKey !== null || exportingDraft) {
      if (!silent) {
        setError('Please wait for the current save or generation to finish before updating bibliography.')
      }
      return false
    }

    const nextStyle = String(override?.style || bibliographyStyle || 'APA7').trim() || 'APA7'
    const nextSortOrder = override?.sortOrder
      || (isNumericBibliographyStyle(nextStyle) ? 'order_of_appearance' : bibliographySortOrder)

    try {
      setGeneratingBibliography(true)
      if (!silent) setError(null)
      await persistLocalGrantSectionChanges()

      const response = await fetch(`/api/projects/${projectId}/grants/${grantId}/sections/bibliography`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          action: 'generate',
          bibliographyStyle: nextStyle,
          bibliographySortOrder: nextSortOrder,
        }),
      })
      const payload = await response.json().catch(() => ({})) as SectionSaveResponse
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to update bibliography')
      }

      if (payload.section) {
        applyPersistedSection(payload.section, { syncLocalValue: true, preserveScroll: true })
      }
      await loadCitations()
      return true
    } catch (nextError) {
      if (!silent) {
        setError(nextError instanceof Error ? nextError.message : 'Failed to update bibliography')
      } else {
        console.warn('[GrantSectionDraftingStage] Bibliography auto-refresh failed:', nextError)
      }
      return false
    } finally {
      setGeneratingBibliography(false)
    }
  }, [
    authToken,
    bibliographySectionExists,
    bibliographySortOrder,
    bibliographyStyle,
    exportingDraft,
    generatingKey,
    grantId,
    applyPersistedSection,
    loadCitations,
    persistLocalGrantSectionChanges,
    projectId,
    savingKey,
  ])

  const handleBibliographyStyleChange = useCallback(async (style: string) => {
    if (!authToken || !draftingSessionId) return

    const nextStyle = String(style || 'APA7').trim() || 'APA7'
    const nextSortOrder: BibliographySortOrder = isNumericBibliographyStyle(nextStyle)
      ? 'order_of_appearance'
      : bibliographySortOrder

    setBibliographyStyle(nextStyle)
    setBibliographySortOrder(nextSortOrder)

    try {
      const response = await fetch(`/api/papers/${draftingSessionId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ citationStyleCode: nextStyle }),
      })
      const payload = await response.json().catch(() => ({})) as { session?: any; error?: string }
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update citation style')
      }
      if (payload.session) {
        onSessionUpdated?.(payload.session)
      }
      await loadCitations()
      await refreshBibliographySection(false, { style: nextStyle, sortOrder: nextSortOrder })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to update citation style')
    }
  }, [
    authToken,
    bibliographySortOrder,
    draftingSessionId,
    loadCitations,
    onSessionUpdated,
    refreshBibliographySection,
  ])

  const handleBibliographySortOrderChange = useCallback((order: BibliographySortOrder) => {
    const nextOrder = isNumericStyleBibliography ? 'order_of_appearance' : order
    setBibliographySortOrder(nextOrder)
    void refreshBibliographySection(false, { sortOrder: nextOrder })
  }, [isNumericStyleBibliography, refreshBibliographySection])

  useEffect(() => {
    if (!authToken || !bibliographySectionExists || loading || exportingDraft) return
    const signature = [
      usedCitationSignature,
      bibliographyStyle,
      bibliographySortOrder,
    ].join('::')
    if (lastAutoBibliographySignatureRef.current === signature) return

    const timer = window.setTimeout(() => {
      void refreshBibliographySection(true).then((updated) => {
        if (updated) {
          lastAutoBibliographySignatureRef.current = signature
        }
      })
    }, 1800)

    return () => window.clearTimeout(timer)
  }, [
    authToken,
    bibliographySectionExists,
    bibliographySortOrder,
    bibliographyStyle,
    exportingDraft,
    generatingKey,
    loading,
    refreshBibliographySection,
    savingKey,
    usedCitationSignature,
  ])

  const autosaveChangedSections = useCallback(async () => {
    if (!authToken || savingKey !== null || generatingKey !== null || exportingDraft) return

    const changedSections = sections.filter((section) => hasLocalGrantSectionChange(section))
    if (changedSections.length === 0) return

    try {
      setError(null)
      for (const section of changedSections) {
        setSavingKey(section.sectionKey)
        await persistSection(section, false)
      }
      await refreshShadowSession()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to autosave grant section')
    } finally {
      setSavingKey(null)
    }
  }, [
    authToken,
    exportingDraft,
    generatingKey,
    hasLocalGrantSectionChange,
    persistSection,
    refreshShadowSession,
    savingKey,
    sections,
  ])

  useEffect(() => {
    if (!urgentSaveSectionKey || !authToken || loading || savingKey !== null || generatingKey !== null || exportingDraft) return
    const section = sections.find((entry) => entry.sectionKey === urgentSaveSectionKey)
    if (!section) {
      setUrgentSaveSectionKey(null)
      return
    }
    if (!hasLocalGrantSectionChange(section)) {
      setUrgentSaveSectionKey(null)
      return
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          setError(null)
          setSavingKey(section.sectionKey)
          await persistSection(section, false)
          await refreshShadowSession()
          setUrgentSaveSectionKey((current) => current === section.sectionKey ? null : current)
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : 'Failed to save inserted marker')
        } finally {
          setSavingKey(null)
        }
      })()
    }, 120)

    return () => window.clearTimeout(timer)
  }, [
    authToken,
    exportingDraft,
    generatingKey,
    hasLocalGrantSectionChange,
    loading,
    persistSection,
    refreshShadowSession,
    savingKey,
    sections,
    urgentSaveSectionKey,
  ])

  useEffect(() => {
    if (!authToken || loading || savingKey !== null || generatingKey !== null || exportingDraft) return
    if (!sections.some((section) => hasLocalGrantSectionChange(section))) return

    const autosaveTimer = window.setTimeout(() => {
      void autosaveChangedSections()
    }, 900)

    return () => window.clearTimeout(autosaveTimer)
  }, [
    authToken,
    autosaveChangedSections,
    draftValues,
    exportingDraft,
    generatingKey,
    hasLocalGrantSectionChange,
    loading,
    savingKey,
    sections,
    structuredValues,
  ])

  const downloadFile = useCallback((blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    window.URL.revokeObjectURL(url)
  }, [])

  const exportDraftWord = useCallback(async () => {
    if (!authToken) return

    try {
      setExportingDraft(true)
      setExportError(null)
      await persistLocalGrantSectionChanges()

      const response = await fetch(`/api/projects/${projectId}/grants/${grantId}/export?mode=draft`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { message?: string; issues?: string[] }
        const issueText = Array.isArray(payload.issues) && payload.issues.length > 0
          ? ` ${payload.issues.slice(0, 3).join(' ')}`
          : ''
        throw new Error(`${payload.message || 'Failed to export Word document'}${issueText}`.trim())
      }

      const disposition = response.headers.get('Content-Disposition') || ''
      const match = /filename="?([^";]+)"?/i.exec(disposition)
      downloadFile(await response.blob(), match?.[1] || `grant-proposal_${grantId}.docx`)
    } catch (nextError) {
      setExportError(nextError instanceof Error ? nextError.message : 'Failed to export Word document')
    } finally {
      setExportingDraft(false)
    }
  }, [authToken, downloadFile, grantId, persistLocalGrantSectionChanges, projectId])

  const draftExportSummary = useMemo(() => {
    const notPrepared = sections.filter((section) => !hasPreparedExportContent(section)).length
    const suffix = notPrepared === 1 ? '1 not prepared yet' : `${notPrepared} not prepared yet`
    return `Includes all ${sections.length || 0} sections; ${suffix}`
  }, [sections])

  const filterTabs = useMemo(() => ([
    { key: 'all' as const, label: 'All sections', count: sections.length },
    { key: 'app_draft' as const, label: 'App draft', count: sections.filter((section) => filterMatches(section, 'app_draft')).length },
  ]), [sections])

  const editorMaxWidthClass = focusMode ? 'max-w-[980px]' : 'max-w-[850px]'

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center text-slate-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading section drafting workspace...
      </div>
    )
  }

  if (error && !currentSection) {
    return (
      <div className="m-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-900">
        <div className="flex items-center gap-2 font-semibold">
          <AlertCircle className="h-4 w-4" />
          Section drafting unavailable
        </div>
        <div className="mt-2">{error}</div>
      </div>
    )
  }

  if (!currentSection) {
    return (
      <div className="m-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-sm text-slate-600">
        No grant sections are available yet.
      </div>
    )
  }

  return (
    <div
      className={focusMode ? 'fixed inset-0 z-[80] overflow-y-auto bg-slate-50' : 'min-h-[720px] bg-slate-50'}
    >
      {error ? (
        <div className="mx-6 mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </div>
      ) : null}

      <div className={focusMode ? 'min-h-screen bg-white px-6 py-7' : 'bg-white px-6 py-7'}>
        <div className={`mx-auto mb-4 flex ${editorMaxWidthClass} flex-wrap items-center justify-between gap-3`}>
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
            {filterTabs.map((tab) => {
              const isActive = sectionFilter === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setSectionFilter(tab.key)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                    isActive
                      ? 'bg-white text-slate-950 shadow-sm'
                      : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  {tab.label} {tab.count}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2">
            {/* Whole-proposal runs: write everything still empty, then judge
                every draft against the agency rules. */}
            <button
              type="button"
              onClick={() => void draftAllPendingSections()}
              disabled={!authToken || !draftingSessionId || savingKey !== null || generatingKey !== null || batchRun !== null}
              title="Draft every AI-draftable section that is still empty or stale"
              className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {batchRun === 'draft' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {batchRun === 'draft' && batchProgress
                ? `Drafting ${batchProgress.done}/${batchProgress.total}`
                : 'Draft all'}
            </button>
            <button
              type="button"
              onClick={() => void reviewAllDraftedSections()}
              disabled={!authToken || savingKey !== null || generatingKey !== null || batchRun !== null}
              title="Run the agency-rule review on every drafted section without a current verdict"
              className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {batchRun === 'review' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {batchRun === 'review' && batchProgress
                ? `Reviewing ${batchProgress.done}/${batchProgress.total}`
                : 'Review all'}
            </button>
            {batchRun ? (
              <button
                type="button"
                onClick={() => { batchStopRef.current = true }}
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Stop
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setPanelVisible((current) => !current)}
              disabled={!draftingSessionId}
              title={panelVisible ? 'Hide writing panel' : 'Show writing panel'}
              aria-label={panelVisible ? 'Hide writing panel' : 'Show writing panel'}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {panelVisible ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => setFocusMode((current) => !current)}
              title={focusMode ? 'Exit full screen' : 'Full screen editor'}
              aria-label={focusMode ? 'Exit full screen' : 'Full screen editor'}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            >
              {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => void exportDraftWord()}
              disabled={savingKey !== null || generatingKey !== null || exportingDraft}
              title={draftExportSummary}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {exportingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {exportingDraft ? 'Exporting...' : 'Export Word'}
            </button>
          </div>
        </div>
        {!panelVisible && draftingSessionId ? (
          <button
            type="button"
            onClick={() => setPanelVisible(true)}
            className="fixed bottom-6 right-6 z-[95] inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-lg hover:bg-slate-50"
          >
            <BookOpen className="h-4 w-4" />
            Writing panel
          </button>
        ) : null}
        {exportError ? (
          <div className={`mx-auto ${editorMaxWidthClass} mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800`}>
            {exportError}
          </div>
        ) : null}

        <div className="space-y-6">
          {filteredSections.map((section) => {
            const sectionIsNarrative = isNarrativeSection(section)
            const sectionIsBibliography = isGrantBibliographySection(section.sectionKey)
            const sectionIsBudget = section.sectionType === 'budget_rows'
            const sectionIsTable = section.sectionType === 'table' || sectionIsBudget
            const isSelected = selectedSection === section.sectionKey
            const canUseNarrativeGeneration = sectionIsNarrative && isPaperBackedSection(section)
            const sectionHasLocalContent = hasLocalGrantSectionContent(section)
            const sectionIsGenerating = generatingKey === section.sectionKey
            const sectionActionBusy = savingKey !== null || generatingKey !== null || exportingDraft || batchRun !== null
            const sectionIsReviewing = reviewingKey === section.sectionKey
            const sectionIsFixing = fixingKey === section.sectionKey
            const sectionReview = section.grantAiReviewReport || null
            const sectionReviewStale = Boolean(sectionReview && section.grantAiReviewStale)
            const sectionRemarks = (reviewerRemarks[section.sectionKey] || []) as any[]
            const openRemarks = sectionRemarks.filter((remark) => remark.status !== 'resolved')
            const sectionReviewOpen = expandedReviewKeys[section.sectionKey] === true
            const sectionEvidenceNote = evidenceNotes[section.sectionKey] || null

            return (
              <div
                key={section.sectionKey}
                id={`section-${section.sectionKey}`}
                onClick={() => onSectionSelect?.(section.sectionKey)}
                className={`mx-auto ${editorMaxWidthClass} cursor-pointer rounded-sm border bg-white px-12 py-10 shadow-[0_1px_12px_rgba(0,0,0,0.08)] transition-all ${
                  isSelected
                    ? 'border-blue-300 ring-2 ring-blue-100'
                    : 'border-gray-100/70 hover:border-slate-200'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
                  <div>
                    <h2 className="font-sans text-xl font-semibold text-slate-950">{section.label}</h2>
                  </div>
                  {canUseNarrativeGeneration ? (
                    <div
                      className="flex flex-wrap items-center justify-end gap-2"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => void generateNarrativeGrantSection(section, false)}
                        disabled={!authToken || !draftingSessionId || sectionActionBusy}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {sectionIsGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {sectionIsGenerating ? 'Generating...' : 'Generate'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyGrantSectionContent(section)}
                        disabled={!sectionHasLocalContent}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {copiedSectionKey === section.sectionKey ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void generateNarrativeGrantSection(section, true)}
                        disabled={!authToken || !draftingSessionId || sectionActionBusy}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {sectionIsGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                        Regenerate
                      </button>
                      <button
                        type="button"
                        onClick={() => void runSectionAiReview(section)}
                        disabled={!authToken || sectionActionBusy || reviewingKey !== null || !sectionHasLocalContent}
                        title="Check this section against the agency's rules"
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {sectionIsReviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                        {sectionIsReviewing ? 'Reviewing...' : sectionReview ? 'Re-review' : 'AI review'}
                      </button>
                    </div>
                  ) : null}
                </div>

                {sectionEvidenceNote ? (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {sectionEvidenceNote}
                  </div>
                ) : null}

                {canUseNarrativeGeneration && sectionReview ? (
                  <div
                    className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedReviewKeys((current) => ({
                          ...current,
                          [section.sectionKey]: !current[section.sectionKey],
                        }))
                      }
                      className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
                    >
                      <span className={verdictBadgeClass(sectionReview.verdict, sectionReviewStale)}>
                        {sectionReviewStale ? 'Review outdated' : verdictLabel(sectionReview.verdict)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-600">
                        {sectionReview.summary || `${sectionReview.findings.length} finding${sectionReview.findings.length === 1 ? '' : 's'}`}
                      </span>
                      <span className="text-xs font-medium text-slate-500">{sectionReviewOpen ? 'Hide' : 'Details'}</span>
                    </button>

                    {sectionReviewOpen ? (
                      <div className="space-y-3 border-t border-slate-200 px-3 py-3">
                        {sectionReviewStale ? (
                          <p className="text-xs text-amber-700">
                            This section changed after the review — re-run it for a current verdict.
                          </p>
                        ) : null}
                        {sectionReview.findings.length ? (
                          <ul className="space-y-2">
                            {sectionReview.findings.slice(0, 12).map((finding, findingIndex) => (
                              <li key={`${section.sectionKey}-finding-${findingIndex}`} className="flex gap-2 text-xs">
                                <span className={severityDotClass(finding.severity)} />
                                <span className="min-w-0 flex-1 text-slate-700">
                                  <span className="font-medium text-slate-900">{finding.issue}</span>
                                  {finding.fix ? <span className="block text-slate-600">Fix: {finding.fix}</span> : null}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-slate-600">No findings — the reviewer considers this section ready.</p>
                        )}

                        {sectionReview.findings.length ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              value={reviewNotes[section.sectionKey] || ''}
                              onChange={(event) =>
                                setReviewNotes((notes) => ({ ...notes, [section.sectionKey]: event.target.value }))
                              }
                              placeholder="Optional note the rewrite must honor..."
                              className="h-8 min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:border-violet-400 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => void fixSectionWithAiReview(section, { includeReviewerRemarks: true })}
                              disabled={!authToken || !draftingSessionId || sectionActionBusy || reviewingKey !== null}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {sectionIsFixing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                              {sectionIsFixing ? 'Applying...' : 'Fix with AI'}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* What the grant reviewer said about this section. A separate
                    assessment from the drafting review above: it scores against
                    the funder's published criteria rather than the section
                    brief, so it is shown on its own rather than merged. */}
                {sectionRemarks.length ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60">
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        Grant reviewer
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-600">
                        {openRemarks.length
                          ? `${openRemarks.length} remark${openRemarks.length === 1 ? '' : 's'} to address`
                          : 'All remarks addressed'}
                      </span>
                      {reviewerCallId ? (
                        <a
                          href={`/reviewer/${reviewerCallId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-violet-700 hover:underline"
                        >
                          Open the review
                        </a>
                      ) : null}
                    </div>

                    <div className="space-y-3 border-t border-amber-200 px-3 py-3">
                      <ul className="space-y-2">
                        {sectionRemarks.slice(0, 12).map((remark) => (
                          <li
                            key={remark.id}
                            className={`flex gap-2 text-xs ${remark.status === 'resolved' ? 'opacity-55' : ''}`}
                          >
                            <span
                              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                                remark.priority === 'high'
                                  ? 'bg-red-500'
                                  : remark.priority === 'low'
                                    ? 'bg-slate-400'
                                    : 'bg-amber-500'
                              }`}
                            />
                            <span className="min-w-0 flex-1 text-slate-700">
                              <span
                                className={`font-medium text-slate-900 ${
                                  remark.status === 'resolved' ? 'line-through' : ''
                                }`}
                              >
                                {remark.issue}
                              </span>
                              {remark.recommendation && remark.recommendation !== remark.issue ? (
                                <span className="block text-slate-600">Fix: {remark.recommendation}</span>
                              ) : null}
                              {remark.reviewerSectionTitle ? (
                                <span className="mt-0.5 block text-[11px] text-slate-500">
                                  From “{remark.reviewerSectionTitle}”
                                </span>
                              ) : null}
                            </span>
                            {remark.status === 'resolved' ? (
                              <span className="shrink-0 text-[11px] font-medium text-emerald-700">Addressed</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>

                      {openRemarks.length ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void fixSectionWithAiReview(section, { includeReviewerRemarks: true })}
                            disabled={!authToken || !draftingSessionId || sectionActionBusy || reviewingKey !== null}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {sectionIsFixing ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5" />
                            )}
                            {sectionIsFixing ? 'Rewriting...' : 'Rewrite from these remarks'}
                          </button>
                          <span className="text-[11px] text-slate-500">
                            Rewrites this section answering the remarks, then re-runs the review.
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {sectionIsNarrative ? (
                  <div className="mt-4 text-justify font-sans text-[15px] leading-7 text-slate-950" onClick={(e) => e.stopPropagation()}>
                    <PaperMarkdownEditor
                      ref={(editor) => { editorRefs.current[section.sectionKey] = editor }}
                      value={draftValues[section.sectionKey] || ''}
                      onChange={(markdown) =>
                        setDraftValues((current) => ({ ...current, [section.sectionKey]: markdown }))
                      }
                      onFocus={() => {
                        onSectionSelect?.(section.sectionKey)
                        setSelectedText((current) =>
                          current && current.sectionKey !== section.sectionKey ? null : current
                        )
                      }}
                      onSelectionChange={(selection) => {
                        if (!selection || !selection.text) {
                          if (selectedSection === section.sectionKey) setSelectedText(null)
                          return
                        }
                        onSectionSelect?.(section.sectionKey)
                        setSelectedText({
                          text: selection.text,
                          start: selection.start,
                          end: selection.end,
                          sectionKey: section.sectionKey,
                        })
                        editorRefs.current[section.sectionKey]?.saveSelection()
                      }}
                      citationDisplayMeta={citationDisplayMeta}
                      figureDisplayMeta={figureDisplayMeta}
                      onFigureClick={(figureNo) => {
                        const figure = figures.find((entry) => entry.figureNo === figureNo)
                        if (figure?.imagePath) {
                          window.open(figure.imagePath, '_blank', 'noopener,noreferrer')
                        }
                      }}
                      className="min-h-[260px] border-0 bg-transparent px-0 py-0 [&_.ProseMirror]:min-h-[240px]"
                      disabled={generatingKey === section.sectionKey}
                      placeholder={sectionIsBibliography ? 'Generate or edit the bibliography for this grant.' : 'Write this grant section here.'}
                    />
                  </div>
                ) : sectionIsTable ? (
                  <>
                    {sectionIsBudget ? (
                      <div className="mt-3 flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
                        <AutoSizeTextarea
                          value={budgetInstructions[section.sectionKey] || ''}
                          onChange={(event) =>
                            setBudgetInstructions((current) => ({
                              ...current,
                              [section.sectionKey]: event.target.value,
                            }))
                          }
                          minHeight={44}
                          className="w-full resize-none border border-slate-300 bg-white px-2.5 py-1.5 text-sm leading-5 text-slate-900 outline-none placeholder:text-slate-400"
                          placeholder="Budget instructions for AI generation, e.g. use INR 12 lakh total and split equipment/personnel/travel."
                        />
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800">
                            <input
                              type="checkbox"
                              checked={budgetUseCurrentValues[section.sectionKey] === true}
                              onChange={(event) =>
                                setBudgetUseCurrentValues((current) => ({
                                  ...current,
                                  [section.sectionKey]: event.target.checked,
                                }))
                              }
                              className="h-4 w-4 border-slate-400 text-slate-900 focus:ring-slate-700"
                            />
                            Use current table values
                          </label>
                          <button
                            type="button"
                            onClick={() => void generateBudgetSection(section)}
                            disabled={savingKey !== null || generatingKey !== null}
                            className="inline-flex items-center gap-2 border border-slate-400 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60"
                          >
                            {generatingKey === section.sectionKey
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Sparkles className="h-3.5 w-3.5" />}
                            {generatingKey === section.sectionKey ? 'Generating Table...' : 'Generate Table With AI'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <StructuredTableEditor
                      value={structuredValues[section.sectionKey] || '{}'}
                      onChange={(next) =>
                        setStructuredValues((current) => ({ ...current, [section.sectionKey]: next }))
                      }
                      disabled={generatingKey === section.sectionKey}
                    />
                  </>
                ) : (
                  <AutoSizeTextarea
                    value={structuredValues[section.sectionKey] || '{}'}
                    onChange={(event) =>
                      setStructuredValues((current) => ({ ...current, [section.sectionKey]: event.target.value }))
                    }
                    onClick={(e) => e.stopPropagation()}
                    minHeight={180}
                    className="mt-4 w-full resize-none border border-slate-300 bg-white px-3 py-2 font-mono text-sm leading-6 text-slate-700 outline-none"
                    placeholder="Enter the structured response JSON for this section."
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
      {draftingSessionId ? (
        <FloatingWritingPanel
          sessionId={draftingSessionId}
          authToken={authToken}
          currentSection={currentSection?.sectionKey}
          currentContent={currentContent}
          availableSectionContexts={availableSectionContexts}
          figures={figures}
          citations={citations}
          onInsertFigure={handleInsertFigure}
          onInsertCitation={handleInsertCitation}
          onTextAction={handleTextAction}
          onGenerateFigure={handleGenerateFigure}
          onGenerateExistingFigure={handleGenerateExistingFigure}
          selectedText={selectedText}
          onRefreshFigures={loadFigures}
          onRefreshCitations={loadCitations}
          isVisible={panelVisible}
          documentLabel="Grant"
          bibliographyStyle={bibliographyStyle}
          onBibliographyStyleChange={handleBibliographyStyleChange}
          bibliographySortOrder={bibliographySortOrder}
          onBibliographySortOrderChange={handleBibliographySortOrderChange}
          onGenerateBibliography={() => void refreshBibliographySection(false)}
          generatingBibliography={generatingBibliography}
          usedCitationCount={usedCitationKeys.length}
          usedCitationKeys={usedCitationKeys}
          usedCitationCountsByKey={usedCitationCountsByKey}
          isNumericStyleBibliography={isNumericStyleBibliography}
          onCitationsUpdated={setCitations}
        />
      ) : null}
    </div>
  )
}
