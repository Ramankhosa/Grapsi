'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import type { ExportProfile, PartialExportProfile } from '@/lib/export/export-profile-schema'
import {
  EXPORT_ABSTRACT_STYLES,
  EXPORT_CITATION_COMMAND_OPTIONS,
  EXPORT_DOCUMENT_CLASSES,
  EXPORT_FONT_REGISTRY,
  EXPORT_PAGE_NUMBER_POSITIONS,
  EXPORT_PAGE_SIZES,
  getValueAtPath,
} from '@/lib/export/export-profile-schema'

type FieldSource = {
  source: 'default' | 'llm' | 'override'
  confidence: number | null
}

export interface ExportProfileApiPayload {
  profile: {
    id: string
    name?: string | null
    sourceType: string
    sourceFileName?: string | null
    sourceMimeType?: string | null
    sourceFileHash?: string | null
    confidence: number
    extractionModel?: string | null
    extractionTokensIn?: number | null
    extractionTokensOut?: number | null
    createdAt: string
    updatedAt: string
    llmExtracted: PartialExportProfile | null
    userOverrides: PartialExportProfile
  } | null
  resolvedConfig: ExportProfile
  fieldSources: Record<string, FieldSource>
  venueDefaults: PartialExportProfile
  summaries: {
    docx: string
    latex: string
  }
}

type FieldType = 'select' | 'number' | 'checkbox' | 'text'

type FieldDefinition = {
  path: string
  label: string
  type: FieldType
  suffix?: string
  step?: number
  min?: number
  max?: number
  placeholder?: string
  options?: Array<{ label: string; value: string }>
}

type GroupDefinition = {
  key: string
  label: string
  title: string
  collapsible?: boolean
  defaultCollapsed?: boolean
  fields: FieldDefinition[]
}

const COMMON_CITATION_STYLE_OPTIONS = [
  { label: 'APA7', value: 'APA7' },
  { label: 'IEEE', value: 'IEEE' },
  { label: 'HARVARD', value: 'HARVARD' },
  { label: 'MLA9', value: 'MLA9' },
  { label: 'CHICAGO', value: 'CHICAGO' },
  { label: 'VANCOUVER', value: 'VANCOUVER' },
]

const GROUPS: GroupDefinition[] = [
  {
    key: 'typography',
    label: 'Typography',
    title: 'Typography',
    fields: [
      {
        path: 'fontFamily',
        label: 'Font Family',
        type: 'select',
        options: EXPORT_FONT_REGISTRY.map((font) => ({ label: font.name, value: font.name })),
      },
      {
        path: 'fontSizePt',
        label: 'Font Size',
        type: 'number',
        suffix: 'pt',
        min: 8,
        max: 24,
        step: 1,
      },
      {
        path: 'lineSpacing',
        label: 'Line Spacing',
        type: 'number',
        min: 0.5,
        max: 3,
        step: 0.1,
      },
    ],
  },
  {
    key: 'layout',
    label: 'Page Layout',
    title: 'Page Layout',
    fields: [
      {
        path: 'pageSize',
        label: 'Page Size',
        type: 'select',
        options: EXPORT_PAGE_SIZES.map((value) => ({ label: value, value })),
      },
      {
        path: 'margins.topCm',
        label: 'Top Margin',
        type: 'number',
        suffix: 'cm',
        min: 0.5,
        max: 5,
        step: 0.01,
      },
      {
        path: 'margins.bottomCm',
        label: 'Bottom Margin',
        type: 'number',
        suffix: 'cm',
        min: 0.5,
        max: 5,
        step: 0.01,
      },
      {
        path: 'margins.leftCm',
        label: 'Left Margin',
        type: 'number',
        suffix: 'cm',
        min: 0.5,
        max: 5,
        step: 0.01,
      },
      {
        path: 'margins.rightCm',
        label: 'Right Margin',
        type: 'number',
        suffix: 'cm',
        min: 0.5,
        max: 5,
        step: 0.01,
      },
      {
        path: 'columnLayout',
        label: 'Columns',
        type: 'select',
        options: [
          { label: '1', value: '1' },
          { label: '2', value: '2' },
        ],
      },
    ],
  },
  {
    key: 'structure',
    label: 'Document Structure',
    title: 'Document Structure',
    fields: [
      { path: 'sectionNumbering', label: 'Section Numbering', type: 'checkbox' },
      {
        path: 'abstractStyle',
        label: 'Abstract Style',
        type: 'select',
        options: EXPORT_ABSTRACT_STYLES.map((value) => ({ label: value, value })),
      },
      { path: 'includePageNumbers', label: 'Page Numbers', type: 'checkbox' },
      {
        path: 'pageNumberPosition',
        label: 'Page # Position',
        type: 'select',
        options: EXPORT_PAGE_NUMBER_POSITIONS.map((value) => ({ label: value, value })),
      },
      { path: 'headerContent', label: 'Header Content', type: 'text', placeholder: 'Optional header text' },
      { path: 'footerContent', label: 'Footer Content', type: 'text', placeholder: 'Optional footer text' },
    ],
  },
  {
    key: 'citations',
    label: 'Citations & References',
    title: 'Citations & References',
    fields: [
      {
        path: 'citationStyle',
        label: 'Citation Style',
        type: 'select',
        options: COMMON_CITATION_STYLE_OPTIONS,
      },
      {
        path: 'bibliographyStyle',
        label: 'Bibliography Style',
        type: 'text',
        placeholder: 'IEEEtran, apalike, plain...',
      },
      {
        path: 'citationCommand',
        label: 'LaTeX Cite Command',
        type: 'select',
        options: EXPORT_CITATION_COMMAND_OPTIONS.map((value) => ({ label: value, value })),
      },
    ],
  },
  {
    key: 'latex',
    label: 'LaTeX-Specific',
    title: 'LaTeX-Specific',
    collapsible: true,
    defaultCollapsed: true,
    fields: [
      {
        path: 'documentClass',
        label: 'Document Class',
        type: 'select',
        options: EXPORT_DOCUMENT_CLASSES.map((value) => ({ label: value, value })),
      },
      {
        path: 'documentClassOptions',
        label: 'Class Options',
        type: 'text',
        placeholder: 'conference, twocolumn',
      },
      {
        path: 'latexPackages',
        label: 'Extra Packages',
        type: 'text',
        placeholder: 'hyperref, booktabs',
      },
      {
        path: 'latexPreambleExtra',
        label: 'Extra Preamble',
        type: 'text',
        placeholder: '\\setcopyright{none}',
      },
    ],
  },
]

type ExportSettingsPanelProps = {
  data: ExportProfileApiPayload
  onCommitField: (path: string, value: unknown) => void
  onResetField: (path: string) => void
  onResetAll: () => void
}

export default function ExportSettingsPanel({
  data,
  onCommitField,
  onResetField,
  onResetAll,
}: ExportSettingsPanelProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})

  useEffect(() => {
    setCollapsed(
      Object.fromEntries(GROUPS.map((group) => [group.key, Boolean(group.defaultCollapsed)])),
    )
  }, [])

  const fieldDraftDefaults = useMemo(() => {
    const entries: Record<string, string> = {}
    for (const group of GROUPS) {
      for (const field of group.fields) {
        const value = getValueAtPath(data.resolvedConfig, field.path)
        if (Array.isArray(value)) {
          entries[field.path] = value.join(', ')
        } else if (typeof value === 'string' || typeof value === 'number') {
          entries[field.path] = String(value)
        } else {
          entries[field.path] = ''
        }
      }
    }
    return entries
  }, [data])

  useEffect(() => {
    setDraftValues(fieldDraftDefaults)
  }, [fieldDraftDefaults])

  return (
    <div className="rounded-[32px] border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Export Configuration</div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Your export will use these settings</h2>
        </div>
        <button
          type="button"
          onClick={onResetAll}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
        >
          Reset To Defaults
        </button>
      </div>

      <div className="grid gap-4 p-6 lg:grid-cols-2">
        {GROUPS.map((group) => {
          const isCollapsed = Boolean(collapsed[group.key])
          return (
            <div key={group.key} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{group.label}</div>
                  <h3 className="mt-1 text-base font-semibold text-slate-950">{group.title}</h3>
                </div>
                {group.collapsible ? (
                  <button
                    type="button"
                    onClick={() => setCollapsed((current) => ({ ...current, [group.key]: !current[group.key] }))}
                    className="rounded-full border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-100"
                    aria-label={isCollapsed ? `Expand ${group.title}` : `Collapse ${group.title}`}
                  >
                    {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  </button>
                ) : null}
              </div>

              {!isCollapsed ? (
                <div className="mt-4 space-y-3">
                  {group.fields.map((field) => {
                    const source = data.fieldSources[field.path] || { source: 'default', confidence: null }
                    const currentValue = getValueAtPath(data.resolvedConfig, field.path)
                    const lowConfidence = source.source === 'llm' && typeof source.confidence === 'number' && source.confidence < 0.6
                    const overrideValue = getValueAtPath(data.profile?.userOverrides || {}, field.path)
                    const isOverridden = overrideValue !== undefined
                    const displayDraft = draftValues[field.path] ?? fieldDraftDefaults[field.path] ?? ''

                    return (
                      <div
                        key={field.path}
                        className={`rounded-2xl bg-white p-3 ${lowConfidence ? 'border-l-2 border-amber-400 pl-4' : 'border border-transparent'}`}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-slate-900">{field.label}</div>
                            {lowConfidence ? (
                              <div className="mt-1 text-[11px] text-amber-600">Low confidence - please verify this setting</div>
                            ) : null}
                          </div>

                          <div className="flex min-w-0 flex-1 flex-col gap-2">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                              {renderFieldControl({
                                field,
                                currentValue,
                                displayDraft,
                                onDraftChange: (value) => setDraftValues((current) => ({ ...current, [field.path]: value })),
                                onCommit: (value) => onCommitField(field.path, value),
                                onReset: () => onResetField(field.path),
                              })}
                              <span className={badgeClassName(source)}>
                                {badgeLabel(source)}
                              </span>
                            </div>
                            {isOverridden ? (
                              <button
                                type="button"
                                onClick={() => onResetField(field.path)}
                                className="self-end text-[10px] font-medium text-slate-400 hover:text-slate-600"
                              >
                                Reset
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function renderFieldControl(params: {
  field: FieldDefinition
  currentValue: unknown
  displayDraft: string
  onDraftChange: (value: string) => void
  onCommit: (value: unknown) => void
  onReset: () => void
}) {
  const { field, currentValue, displayDraft, onDraftChange, onCommit, onReset } = params

  if (field.type === 'checkbox') {
    return (
      <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={Boolean(currentValue)}
          onChange={(event) => onCommit(event.target.checked)}
          aria-label={field.label}
          className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
        />
        <span>{Boolean(currentValue) ? 'Enabled' : 'Disabled'}</span>
      </label>
    )
  }

  if (field.type === 'select') {
    return (
      <select
        value={String(currentValue ?? '')}
        onChange={(event) => onCommit(parseFieldValue(field, event.target.value))}
        aria-label={field.label}
        className="min-w-[180px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
      >
        {(field.options || []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )
  }

  const inputType = field.type === 'number' ? 'number' : 'text'

  return (
    <div className="flex items-center gap-2">
      <input
        type={inputType}
        value={displayDraft}
        min={field.min}
        max={field.max}
        step={field.step}
        placeholder={field.placeholder}
        aria-label={field.label}
        onChange={(event) => onDraftChange(event.target.value)}
        onBlur={() => commitDraftField(field, displayDraft, onCommit, onReset)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitDraftField(field, displayDraft, onCommit, onReset)
          }
        }}
        className="min-w-[180px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
      />
      {field.suffix ? <span className="text-sm text-slate-500">{field.suffix}</span> : null}
    </div>
  )
}

function commitDraftField(
  field: FieldDefinition,
  rawValue: string,
  onCommit: (value: unknown) => void,
  onReset: () => void,
) {
  const trimmed = rawValue.trim()
  if (!trimmed) {
    onReset()
    return
  }

  onCommit(parseFieldValue(field, trimmed))
}

function parseFieldValue(field: FieldDefinition, rawValue: string): unknown {
  if (field.type === 'number') {
    return Number(rawValue)
  }
  if (field.path === 'documentClassOptions' || field.path === 'latexPackages') {
    return rawValue
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  }
  return rawValue
}

function badgeLabel(source: FieldSource): string {
  if (source.source === 'override') return 'Override'
  if (source.source === 'default') return 'Default'
  const confidence = typeof source.confidence === 'number' ? source.confidence.toFixed(2) : '0.00'
  return `LLM (${confidence})`
}

function badgeClassName(source: FieldSource): string {
  if (source.source === 'override') {
    return 'rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700'
  }
  if (source.source === 'default') {
    return 'rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500'
  }
  if ((source.confidence || 0) < 0.6) {
    return 'rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700'
  }
  return 'rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700'
}
