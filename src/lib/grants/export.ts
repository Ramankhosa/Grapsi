import type { PaperDocxBlock, PaperDocxSection } from '@/lib/export/paper-docx-export'
import { budgetStructuredDataHasMeaningfulRows } from '@/lib/grants/budgetTemplate'
import {
  resolveCitationKeyFromLookup,
  splitCitationKeyList,
} from '@/lib/utils/citation-key-normalization'

export const GRANT_EXPORT_EMPTY_PLACEHOLDER = 'Not prepared yet.'

type GrantExportSectionDraft = {
  sectionKey: string
  label: string
  sectionType: string
  sectionOrder?: number | null
  content?: string | null
  structuredResponses?: Array<{ fieldKey?: string | null; responseJson?: unknown }>
}

export interface GrantProposalDocxSectionsResult {
  sections: PaperDocxSection[]
  emptySectionCount: number
}

const CITE_MARKER_PATTERN = '\\[CITE:([^\\]]+)\\]'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function hasText(value: unknown): boolean {
  return cleanText(value).length > 0
}

function asStructuredResponse(sectionDraft: GrantExportSectionDraft): unknown {
  const responses = sectionDraft.structuredResponses || []
  const structured = responses.find((response) => response.fieldKey === 'structuredData')
    || responses[0]
  return structured?.responseJson
}

function structuredValueHasContent(value: unknown, sectionType?: string | null): boolean {
  if (value === null || typeof value === 'undefined') return false
  if (typeof value === 'string') return hasText(value)
  if (Array.isArray(value)) return value.length > 0
  if (!isRecord(value)) return true

  if (sectionType === 'budget_rows') {
    return budgetStructuredDataHasMeaningfulRows(value)
  }

  if (Array.isArray(value.items)) {
    return value.items.some((item) => {
      const row = isRecord(item) ? item : {}
      return Boolean(row.completed)
        || Boolean(row.checked)
        || Boolean(row.done)
        || hasText(row.notes)
        || hasText(row.comment)
        || hasText(row.response)
        || hasText(row.value)
    })
  }

  if (Array.isArray(value.rows)) {
    return value.rows.length > 0
  }

  return Object.entries(value).some(([key, entry]) => {
    if (key === 'columns' || key === 'currency') return false
    if (Array.isArray(entry)) return entry.length > 0
    if (isRecord(entry)) return Object.keys(entry).length > 0
    return hasText(entry)
  })
}

function labelFromKey(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function getColumnDefinitions(record: Record<string, unknown>, rows: Record<string, unknown>[]) {
  if (Array.isArray(record.columns)) {
    const columns = record.columns
      .map((column) => {
        if (isRecord(column)) {
          const key = cleanText(column.key || column.id || column.name || column.label)
          const label = cleanText(column.label || column.title || column.name || key)
          return key ? { key, label: label || labelFromKey(key) } : null
        }
        const key = cleanText(column)
        return key ? { key, label: labelFromKey(key) } : null
      })
      .filter(Boolean) as Array<{ key: string; label: string }>
    if (columns.length > 0) return columns
  }

  const keys: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue
      seen.add(key)
      keys.push(key)
    }
  }

  return keys.map((key) => ({ key, label: labelFromKey(key) }))
}

function renderChecklistBlocks(record: Record<string, unknown>): PaperDocxBlock[] {
  const items = Array.isArray(record.items) ? record.items : []
  const bullets = items
    .map((item, index) => {
      const row: Record<string, unknown> = isRecord(item) ? item : { label: item }
      const label = cleanText(row.label || row.title || row.name || `Item ${index + 1}`)
      const notes = cleanText(row.notes || row.comment || row.response)
      const checked = row.completed === true || row.checked === true || row.done === true
      return `${checked ? '[x]' : '[ ]'} ${label}${notes ? ` - ${notes}` : ''}`
    })
    .filter(Boolean)

  return bullets.length > 0
    ? [{ type: 'bullets', items: bullets }]
    : [{ type: 'paragraph', text: GRANT_EXPORT_EMPTY_PLACEHOLDER }]
}

function renderRowsAsTableBlocks(record: Record<string, unknown>): PaperDocxBlock[] {
  const rows: Record<string, unknown>[] = Array.isArray(record.rows)
    ? record.rows.map((row): Record<string, unknown> => isRecord(row) ? row : { value: row })
    : []
  if (rows.length === 0) {
    return [{ type: 'paragraph', text: GRANT_EXPORT_EMPTY_PLACEHOLDER }]
  }

  const columns = getColumnDefinitions(record, rows)
  if (columns.length === 0) {
    return [{ type: 'paragraph', text: GRANT_EXPORT_EMPTY_PLACEHOLDER }]
  }

  const blocks: PaperDocxBlock[] = []
  const notes = cleanText(record.notes)
  if (notes) {
    blocks.push({ type: 'paragraph', text: notes })
  }

  blocks.push({
    type: 'table',
    headers: columns.map((column) => column.label),
    rows: rows.map((row) => columns.map((column) => cleanText(row[column.key]))),
  })

  return blocks
}

function renderGenericStructuredBlocks(value: unknown): PaperDocxBlock[] {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = cleanText(value)
    return [{ type: 'paragraph', text: text || GRANT_EXPORT_EMPTY_PLACEHOLDER }]
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => cleanText(item)).filter(Boolean)
    return items.length > 0
      ? [{ type: 'bullets', items }]
      : [{ type: 'paragraph', text: GRANT_EXPORT_EMPTY_PLACEHOLDER }]
  }

  if (!isRecord(value)) {
    return [{ type: 'paragraph', text: GRANT_EXPORT_EMPTY_PLACEHOLDER }]
  }

  const rows = Object.entries(value)
    .map(([key, entry]) => [labelFromKey(key), cleanText(entry)])
    .filter(([, entry]) => entry)

  return rows.length > 0
    ? [{ type: 'table', headers: ['Field', 'Response'], rows }]
    : [{ type: 'paragraph', text: GRANT_EXPORT_EMPTY_PLACEHOLDER }]
}

function renderStructuredBlocks(sectionDraft: GrantExportSectionDraft): PaperDocxBlock[] {
  const structuredData = asStructuredResponse(sectionDraft)
  if (!structuredValueHasContent(structuredData, sectionDraft.sectionType)) {
    return [{ type: 'paragraph', text: GRANT_EXPORT_EMPTY_PLACEHOLDER }]
  }

  if (isRecord(structuredData)) {
    if (Array.isArray(structuredData.items)) return renderChecklistBlocks(structuredData)
    if (Array.isArray(structuredData.rows)) return renderRowsAsTableBlocks(structuredData)
  }

  return renderGenericStructuredBlocks(structuredData)
}

function renderGrantSectionBlocksForExport(sectionDraft: GrantExportSectionDraft): PaperDocxBlock[] {
  if (sectionDraft.sectionType === 'narrative' || sectionDraft.sectionType === 'short_answer') {
    const content = String(sectionDraft.content || '').trim()
    return [{ type: 'paragraph', text: content || GRANT_EXPORT_EMPTY_PLACEHOLDER }]
  }

  return renderStructuredBlocks(sectionDraft)
}

function flattenBlocks(blocks: PaperDocxBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === 'paragraph') return block.text
      if (block.type === 'bullets') return block.items.map((item) => `- ${item}`).join('\n')
      return [
        block.headers.join('\t'),
        ...block.rows.map((row) => row.join('\t')),
      ].join('\n')
    })
    .join('\n\n')
}

function extractCitationKeysFromText(
  text: string,
  canonicalLookup?: Map<string, string>
): string[] {
  const ordered: string[] = []
  const seen = new Set<string>()
  const markerRegex = new RegExp(CITE_MARKER_PATTERN, 'gi')
  let match: RegExpExecArray | null = null

  while ((match = markerRegex.exec(text || '')) !== null) {
    const keys = splitCitationKeyList(match[1] || '')
    for (const key of keys) {
      const canonical = canonicalLookup
        ? resolveCitationKeyFromLookup(key, canonicalLookup) || key
        : key
      const identity = canonical.toLocaleLowerCase('en-US')
      if (!canonical || seen.has(identity)) continue
      seen.add(identity)
      ordered.push(canonical)
    }
  }

  return ordered
}

function appendOrderedCitationKeys(
  target: string[],
  seen: Set<string>,
  keys: string[]
) {
  for (const key of keys) {
    const identity = key.toLocaleLowerCase('en-US')
    if (!key || seen.has(identity)) continue
    seen.add(identity)
    target.push(key)
  }
}

function sectionHasPreparedContent(blocks: PaperDocxBlock[]): boolean {
  return blocks.some((block) => {
    if (block.type === 'paragraph') return cleanText(block.text) !== GRANT_EXPORT_EMPTY_PLACEHOLDER
    if (block.type === 'bullets') return block.items.some(hasText)
    return block.rows.some((row) => row.some(hasText))
  })
}

export function buildGrantProposalDocxSections(
  sectionDrafts: GrantExportSectionDraft[]
): GrantProposalDocxSectionsResult {
  let emptySectionCount = 0
  const sections = sectionDrafts
    .map((section, index) => ({ section, index }))
    .sort((left, right) => {
      const leftOrder = Number(left.section.sectionOrder ?? Number.MAX_SAFE_INTEGER)
      const rightOrder = Number(right.section.sectionOrder ?? Number.MAX_SAFE_INTEGER)
      if (leftOrder !== rightOrder) return leftOrder - rightOrder
      return left.index - right.index
    })
    .map(({ section }) => {
      const blocks = renderGrantSectionBlocksForExport(section)
      if (!sectionHasPreparedContent(blocks)) emptySectionCount += 1
      return {
        key: section.sectionKey,
        title: section.label,
        content: flattenBlocks(blocks),
        blocks,
      }
    })

  return { sections, emptySectionCount }
}

export function extractOrderedCitationKeysFromGrantDocxSections(
  sections: PaperDocxSection[],
  canonicalLookup?: Map<string, string>
): string[] {
  const ordered: string[] = []
  const seen = new Set<string>()

  for (const section of sections) {
    const blocks = section.blocks && section.blocks.length > 0
      ? section.blocks
      : [{ type: 'paragraph' as const, text: section.content || '' }]

    for (const block of blocks) {
      if (block.type === 'paragraph') {
        appendOrderedCitationKeys(ordered, seen, extractCitationKeysFromText(block.text, canonicalLookup))
      } else if (block.type === 'bullets') {
        for (const item of block.items) {
          appendOrderedCitationKeys(ordered, seen, extractCitationKeysFromText(item, canonicalLookup))
        }
      } else if (block.type === 'table') {
        for (const header of block.headers) {
          appendOrderedCitationKeys(ordered, seen, extractCitationKeysFromText(header, canonicalLookup))
        }
        for (const row of block.rows) {
          for (const cell of row) {
            appendOrderedCitationKeys(ordered, seen, extractCitationKeysFromText(cell, canonicalLookup))
          }
        }
      }
    }
  }

  return ordered
}

export async function mapGrantProposalDocxSectionText(
  sections: PaperDocxSection[],
  mapText: (text: string) => Promise<string>
): Promise<PaperDocxSection[]> {
  return Promise.all(sections.map(async (section) => {
    if (section.blocks && section.blocks.length > 0) {
      const blocks = await Promise.all(section.blocks.map(async (block): Promise<PaperDocxBlock> => {
        if (block.type === 'paragraph') {
          return { ...block, text: await mapText(block.text) }
        }
        if (block.type === 'bullets') {
          return { ...block, items: await Promise.all(block.items.map((item) => mapText(item))) }
        }
        return {
          ...block,
          headers: await Promise.all(block.headers.map((header) => mapText(header))),
          rows: await Promise.all(block.rows.map((row) =>
            Promise.all(row.map((cell) => mapText(cell)))
          )),
        }
      }))
      return {
        ...section,
        blocks,
        content: flattenBlocks(blocks),
      }
    }

    return {
      ...section,
      content: await mapText(section.content || ''),
    }
  }))
}

export function renderGrantSectionForExport(sectionDraft: {
  sectionType: string
  content: string | null
  structuredResponses: Array<{ fieldKey: string; responseJson: unknown }>
}) {
  return flattenBlocks(renderGrantSectionBlocksForExport({
    sectionKey: '',
    label: '',
    sectionType: sectionDraft.sectionType,
    content: sectionDraft.content,
    structuredResponses: sectionDraft.structuredResponses,
  }))
}
