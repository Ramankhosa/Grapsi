import type { FundingTemplateBudget } from '@/lib/fundingTemplates/types'
import type {
  GrantBlueprintPlanSection,
  GrantBudgetTemplateCategory,
  GrantBudgetTemplateColumn,
  GrantBudgetTemplateScaffold,
} from '@/types/grant'

type JsonRecord = Record<string, unknown>

const FALLBACK_BUDGET_COLUMNS: GrantBudgetTemplateColumn[] = [
  { key: 'category', label: 'Category', kind: 'category', required: true },
  { key: 'amount', label: 'Amount', kind: 'amount', required: false },
  { key: 'justification', label: 'Justification', kind: 'justification', required: false },
]

const NUMERIC_KINDS = new Set(['amount', 'year', 'total', 'co_funding', 'number'])
const UNKNOWN_NUMERIC_VALUES = new Set(['', 'tbd', 'to be determined', 'unknown', 'n/a', 'na', 'not available', 'null'])

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function slugify(value: unknown, fallback: string): string {
  const normalized = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
  return normalized || fallback
}

function inferColumnKind(value: unknown): string | null {
  const text = cleanText(value).toLowerCase().replace(/[_-]+/g, ' ')
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

export function normalizeBudgetColumns(columns: unknown): GrantBudgetTemplateColumn[] {
  const source = Array.isArray(columns) ? columns : []
  const seen = new Set<string>()
  const next: GrantBudgetTemplateColumn[] = []

  source.forEach((entry, index) => {
    const record = asRecord(entry)
    const label = cleanText(record.label || record.title || record.name || record.key || entry)
    if (!label) return
    const key = slugify(record.key || record.id || label, `column_${index + 1}`)
    if (seen.has(key)) return
    seen.add(key)
    next.push({
      key,
      label,
      kind: cleanText(record.kind || record.type || inferColumnKind(label)) || null,
      required: record.required === true,
      sourceAnchors: Array.isArray(record.sourceAnchors) ? record.sourceAnchors as Array<Record<string, unknown>> : [],
    })
  })

  return next
}

function normalizeBudgetCategories(categories: unknown): GrantBudgetTemplateCategory[] {
  const source = Array.isArray(categories) ? categories : []
  const seen = new Set<string>()
  const next: GrantBudgetTemplateCategory[] = []

  source.forEach((entry, index) => {
    const record = asRecord(entry)
    const label = cleanText(record.label || record.title || record.name || record.key)
    if (!label) return
    const key = slugify(record.key || label, `budget_${index + 1}`)
    const identity = `${key}:${label.toLowerCase()}`
    if (seen.has(identity)) return
    seen.add(identity)
    next.push({
      key,
      label,
      cap: cleanText(record.cap || record.limit) || null,
      notes: cleanText(record.notes || record.description || record.instructions) || null,
      sourceAnchors: Array.isArray(record.sourceAnchors) ? record.sourceAnchors as Array<Record<string, unknown>> : [],
    })
  })

  return next
}

export function buildBudgetTemplateFromFundingBudget(
  budget: FundingTemplateBudget,
  currency?: string | null
): GrantBudgetTemplateScaffold {
  const categories = normalizeBudgetCategories(budget.categories)
  return {
    source: 'extracted',
    required: budget.required,
    yearWise: budget.yearWise,
    fixedCategories: categories.length > 0,
    currency: currency || null,
    columns: normalizeBudgetColumns(budget.columns || []),
    categories,
    caps: budget.caps ? budget.caps as Record<string, unknown> : null,
    notes: cleanText(budget.justificationNotes) || null,
    sourceAnchors: Array.isArray(budget.sourceAnchors)
      ? budget.sourceAnchors as unknown as Array<Record<string, unknown>>
      : [],
    supportLevel: budget.supportLevel,
    confidence: typeof budget.confidence === 'number' ? budget.confidence : null,
  }
}

export function buildFallbackBudgetTemplate(currency?: string | null): GrantBudgetTemplateScaffold {
  return {
    source: 'fallback',
    required: false,
    yearWise: false,
    fixedCategories: false,
    currency: currency || null,
    columns: FALLBACK_BUDGET_COLUMNS,
    categories: [],
    caps: null,
    notes: null,
    sourceAnchors: [],
    supportLevel: null,
    confidence: null,
  }
}

function getCategoryColumnKey(columns: GrantBudgetTemplateColumn[]): string | null {
  return columns.find((column) => column.kind === 'category')?.key
    || columns.find((column) => /category|head|item/i.test(column.label))?.key
    || null
}

function ensureUsableBudgetColumns(
  columns: GrantBudgetTemplateColumn[],
  hasCategories: boolean
): GrantBudgetTemplateColumn[] {
  const normalized = normalizeBudgetColumns(columns)
  const selected = normalized.length > 0 ? normalized : FALLBACK_BUDGET_COLUMNS
  if (!hasCategories || getCategoryColumnKey(selected)) {
    return selected.map((column) => ({ ...column }))
  }

  return [{ ...FALLBACK_BUDGET_COLUMNS[0] }, ...selected.map((column) => ({ ...column }))]
}

export function buildBudgetStructuredScaffold(input: {
  section: GrantBlueprintPlanSection
  currency?: string | null
}): JsonRecord {
  const baseTemplate = input.section.budgetTemplate || buildFallbackBudgetTemplate(input.currency)
  const template = {
    ...baseTemplate,
    required: baseTemplate.required || input.section.required,
  }
  const categories = normalizeBudgetCategories(template.categories)
  const columns = ensureUsableBudgetColumns(template.columns, categories.length > 0)
  const categoryColumnKey = getCategoryColumnKey(columns)
  const rowTemplates = categories.length > 0
    ? categories
    : template.required
      ? [{ key: 'budget_1', label: '', cap: null, notes: null, sourceAnchors: [] }]
      : []

  const rows = rowTemplates.map((category) => {
    const row: JsonRecord = {}
    for (const column of columns) {
      row[column.key] = column.key === categoryColumnKey ? category.label : null
    }
    return row
  })

  return {
    currency: template.currency || input.currency || null,
    columns,
    rows,
    notes: template.notes || null,
    constraints: template.caps || null,
    openQuestions: [],
    source: template.source || 'fallback',
  }
}

function strictParseJsonObject(output: string): JsonRecord {
  const text = String(output || '').trim()
  if (!text.startsWith('{') || !text.endsWith('}')) {
    throw new Error('Budget LLM output must be a single JSON object.')
  }
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Budget LLM output must be a JSON object.')
  }
  return parsed as JsonRecord
}

function isNumericColumn(column: GrantBudgetTemplateColumn): boolean {
  return NUMERIC_KINDS.has(cleanText(column.kind).toLowerCase())
}

function isCategoryColumn(column: GrantBudgetTemplateColumn): boolean {
  return column.kind === 'category' || /\b(category|head|item|expense)\b/i.test(column.label)
}

function cleanCellValue(value: unknown): string | null {
  const text = cleanText(value)
  return text || null
}

function cleanNumericCellValue(value: unknown): string | null {
  const text = cleanText(value)
  return UNKNOWN_NUMERIC_VALUES.has(text.toLowerCase()) ? null : text
}

function cleanMeaningfulCellValue(value: unknown): string | null {
  const text = cleanText(value)
  return UNKNOWN_NUMERIC_VALUES.has(text.toLowerCase()) ? null : text
}

function cleanConfirmedNumericCellValue(value: unknown): string | null {
  const text = cleanNumericCellValue(value)
  return text && /\d/.test(text) ? text : null
}

function rowHasAnyValue(row: JsonRecord): boolean {
  return Object.values(row).some((value) => cleanText(value).length > 0)
}

function budgetColumnsFromStructuredData(record: JsonRecord): GrantBudgetTemplateColumn[] {
  if (Array.isArray(record.columns) && record.columns.length > 0) {
    return normalizeBudgetColumns(record.columns)
  }

  const keys: string[] = []
  const seen = new Set<string>()
  for (const row of Array.isArray(record.rows) ? record.rows : []) {
    const rowRecord = asRecord(row)
    for (const key of Object.keys(rowRecord)) {
      if (seen.has(key)) continue
      seen.add(key)
      keys.push(key)
    }
  }

  return normalizeBudgetColumns(keys.map((key) => ({ key, label: key })))
}

export function getBudgetStructuredOpenQuestions(value: unknown): string[] {
  const record = asRecord(value)
  return Array.isArray(record.openQuestions)
    ? record.openQuestions.map((item) => cleanText(item)).filter(Boolean).slice(0, 10)
    : []
}

export function budgetStructuredDataHasNumericColumns(value: unknown): boolean {
  return budgetColumnsFromStructuredData(asRecord(value)).some(isNumericColumn)
}

export function budgetStructuredDataHasConfirmedNumericValues(value: unknown): boolean {
  const record = asRecord(value)
  const rows = Array.isArray(record.rows) ? record.rows.map((row) => asRecord(row)) : []
  const numericColumnKeys = budgetColumnsFromStructuredData(record)
    .filter(isNumericColumn)
    .map((column) => column.key)
  if (rows.length === 0 || numericColumnKeys.length === 0) return false

  return rows.some((row) =>
    numericColumnKeys.some((key) => Boolean(cleanConfirmedNumericCellValue(row[key])))
  )
}

export function budgetStructuredDataHasMeaningfulRows(value: unknown): boolean {
  const record = asRecord(value)
  const rows = Array.isArray(record.rows) ? record.rows.map((row) => asRecord(row)) : []
  if (rows.length === 0) return false

  const columns = budgetColumnsFromStructuredData(record)
  const categoryColumnKeys = new Set(columns.filter(isCategoryColumn).map((column) => column.key))
  const columnByKey = new Map(columns.map((column) => [column.key, column]))

  return rows.some((row) =>
    Object.entries(row).some(([key, value]) => {
      if (categoryColumnKeys.has(key)) return false
      const column = columnByKey.get(key)
      if (column && isNumericColumn(column)) return Boolean(cleanConfirmedNumericCellValue(value))
      return Boolean(cleanMeaningfulCellValue(value))
    })
  )
}

function findCandidateRow(
  rows: JsonRecord[],
  categoryLabel: string,
  categoryColumnKey: string | null,
  index: number
): JsonRecord {
  if (categoryColumnKey && categoryLabel) {
    const match = rows.find((row) =>
      cleanText(row[categoryColumnKey]).toLowerCase() === categoryLabel.toLowerCase()
    )
    if (match) return match
  }
  return rows[index] || {}
}

export function mergeBudgetTemplateWithStructuredTable(
  template: GrantBudgetTemplateScaffold,
  currentData?: unknown
): GrantBudgetTemplateScaffold {
  const current = asRecord(currentData)
  const currentColumns = budgetColumnsFromStructuredData(current)
  const columns = currentColumns.length > 0 ? currentColumns : template.columns
  const categoryColumnKey = getCategoryColumnKey(columns)
  const templateCategories = normalizeBudgetCategories(template.categories)
  const templateCategoryByLabel = new Map(
    templateCategories.map((category) => [category.label.toLowerCase(), category])
  )
  const currentRows = Array.isArray(current.rows) ? current.rows.map((row) => asRecord(row)) : []
  const currentCategories: GrantBudgetTemplateCategory[] = []
  const seenCategoryLabels = new Set<string>()

  if (categoryColumnKey) {
    currentRows.forEach((row, index) => {
      const label = cleanText(row[categoryColumnKey])
      const identity = label.toLowerCase()
      if (!label || seenCategoryLabels.has(identity)) return
      seenCategoryLabels.add(identity)
      const existing = templateCategoryByLabel.get(identity)
      currentCategories.push(existing || {
        key: slugify(label, `budget_${index + 1}`),
        label,
        cap: null,
        notes: null,
        sourceAnchors: [],
      })
    })
  }

  return {
    ...template,
    currency: cleanText(current.currency) || template.currency || null,
    columns,
    categories: currentCategories.length > 0 ? currentCategories : templateCategories,
  }
}

export function validateBudgetDraftLlmResult(input: {
  rawOutput: string
  template: GrantBudgetTemplateScaffold
  currentData?: unknown
  allowNewNumericValues?: boolean
  preserveCurrentNumericValues?: boolean
}): JsonRecord {
  const parsed = strictParseJsonObject(input.rawOutput)
  const current = asRecord(input.currentData)
  const currentColumns = budgetColumnsFromStructuredData(current)
  const templateCategories = normalizeBudgetCategories(input.template.categories)
  const templateScaffold = {
    ...input.template,
    columns: ensureUsableBudgetColumns(
      currentColumns.length > 0 ? currentColumns : input.template.columns,
      templateCategories.length > 0
    ),
    categories: templateCategories,
  }
  const columns = templateScaffold.columns
  const categoryColumnKey = getCategoryColumnKey(columns)
  const candidateRows = Array.isArray(parsed.rows)
    ? parsed.rows.map((row) => asRecord(row))
    : []
  const currentRows = Array.isArray(current.rows)
    ? current.rows.map((row) => asRecord(row))
    : []
  const fixedCategories = templateScaffold.fixedCategories && templateScaffold.categories.length > 0
  const currentRowSource = currentRows.map((row, index) => ({
    index,
    label: categoryColumnKey ? cleanText(row[categoryColumnKey]) : '',
    currentBacked: true,
  }))
  const templateRowSource = fixedCategories
    ? templateScaffold.categories.map((category, index) => ({
        index,
        label: category.label,
        currentBacked: false,
      }))
    : candidateRows.map((_, index) => ({
        index,
        label: '',
        currentBacked: false,
      }))
  const rowSource = currentRowSource.length > 0 ? currentRowSource : templateRowSource

  const rows = rowSource.map((source) => {
    const candidateRow = source.label
      ? findCandidateRow(candidateRows, source.label, categoryColumnKey, source.index)
      : candidateRows[source.index] || {}
    const currentRow = source.currentBacked
      ? currentRows[source.index] || {}
      : source.label
        ? findCandidateRow(currentRows, source.label, categoryColumnKey, source.index)
        : currentRows[source.index] || {}
    const row: JsonRecord = {}

    for (const column of columns) {
      if (column.key === categoryColumnKey) {
        row[column.key] = cleanCellValue(candidateRow[column.key])
          || cleanCellValue(currentRow[column.key])
          || source.label
          || null
        continue
      }

      if (isNumericColumn(column)) {
        const existing = cleanNumericCellValue(currentRow[column.key])
        if (input.preserveCurrentNumericValues !== false && existing) {
          row[column.key] = existing
          continue
        }
        const candidate = input.allowNewNumericValues
          ? cleanNumericCellValue(candidateRow[column.key])
          : null
        row[column.key] = candidate || existing || null
        continue
      }

      row[column.key] = cleanCellValue(candidateRow[column.key]) || cleanCellValue(currentRow[column.key])
    }

    return row
  }).filter((row) => fixedCategories || rowHasAnyValue(row))

  if (rows.length === 0 && input.template.required) {
    const row: JsonRecord = {}
    for (const column of columns) row[column.key] = null
    rows.push(row)
  }

  const openQuestions = Array.isArray(parsed.openQuestions)
    ? parsed.openQuestions.map((item) => cleanText(item)).filter(Boolean).slice(0, 10)
    : []

  return {
    currency: cleanText(parsed.currency) || input.template.currency || current.currency || null,
    columns,
    rows,
    notes: cleanText(parsed.notes) || input.template.notes || null,
    constraints: input.template.caps || asRecord(current.constraints) || null,
    openQuestions,
    source: input.template.source || 'fallback',
  }
}

export function buildBudgetDraftingPrompt(input: {
  budgetTemplate: GrantBudgetTemplateScaffold
  currentData?: unknown
  grantContextSummary: string[]
  prepFacts: string[]
  userInstructions?: string | null
  allowInstructionAmounts?: boolean
  overwriteAmounts?: boolean
  useCurrentBudgetValues?: boolean
}): string {
  const userInstructions = String(input.userInstructions || '').trim()
  const useCurrentBudgetValues = input.useCurrentBudgetValues === true
  return [
    'You are completing the Budget section as a structured grant table.',
    'Populate the table according to the provided section table format.',
    'Return ONLY raw JSON. No markdown, no code fences, no prose outside JSON.',
    '',
    'USER INSTRUCTIONS (AUTHORITATIVE):',
    userInstructions || '- None.',
    userInstructions
      ? 'Apply these instructions to the matching rows and columns. If an instruction cannot be applied without breaking the table format or funder rules, put that issue in openQuestions.'
      : 'No user-specific budget instructions were provided.',
    '',
    'HARD RULES:',
    '- Preserve the provided column keys exactly.',
    '- Preserve extracted section/table category rows unless the format has no fixed categories.',
    '- Do not invent amounts, totals, rates, salaries, co-funding, or contribution values.',
    input.allowInstructionAmounts
      ? '- You may transcribe confirmed numeric values from the funding call, section format, current table, Grant Prep facts, or user instructions; do not infer values.'
      : '- Do not place numeric amounts from user instructions into table cells unless they already appear in the current structured budget.',
    input.overwriteAmounts
      ? '- If user instructions provide confirmed values that conflict with current table cells, follow the user instructions and replace the conflicting cells.'
      : useCurrentBudgetValues
        ? '- Preserve current numeric cells when they already contain confirmed values; use instructions to fill blanks and text/justification cells.'
        : '- Use user instructions to fill numeric and text cells only when the values are confirmed by instructions, Grant Prep facts, or funder rules.',
    useCurrentBudgetValues
      ? '- Current table values are included below. Manipulate the existing row values as needed to satisfy the user instructions while preserving the table format.'
      : '- Current table values are intentionally not included. Generate values from the section format, funder rules, Grant Prep facts, and user instructions only.',
    input.overwriteAmounts
      ? '- If the user specifies an overall or total budget, adjust the component line-item amount cells so the visible row values reconcile with that total; do not only change a final total row.'
      : '- If totals are present, keep them consistent with the visible line-item amount cells.',
    '- Leave unknown numeric cells null.',
    '- Fill category, justification, and notes cells only from the section format, project facts, Grant Prep facts, or user instructions.',
    '- When user instructions name a budget split, category, currency, or justification, make the output table visibly reflect it.',
    '- Put uncertainties in openQuestions, not inside table cells.',
    '',
    'OUTPUT JSON SHAPE:',
    '{"currency":"string|null","columns":[{"key":"string","label":"string","kind":"string|null"}],"rows":[{"...columnKey":"string|null"}],"notes":"string|null","openQuestions":["string"]}',
    '',
    'SECTION TABLE FORMAT:',
    JSON.stringify(input.budgetTemplate, null, 2),
    '',
    'CURRENT STRUCTURED BUDGET:',
    useCurrentBudgetValues
      ? JSON.stringify(input.currentData || null, null, 2)
      : 'Not provided. The user did not enable current-table-value context.',
    '',
    'FUNDING CALL SUMMARY:',
    input.grantContextSummary.length > 0
      ? input.grantContextSummary.map((item) => `- ${item}`).join('\n')
      : '- None available.',
    '',
    'GRANT PREP BUDGET FACTS:',
    input.prepFacts.length > 0
      ? input.prepFacts.map((item) => `- ${item}`).join('\n')
      : '- None available.',
    '',
  ].join('\n')
}
