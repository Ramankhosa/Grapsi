import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import type {
  JsonRecord,
  NormalizedPublicProject,
  PublicProjectConnector,
  PublicProjectDiscoveredRecord,
  PublicProjectDiscoveryOptions,
} from '@/lib/publicProjects/types'

const CSV_IMPORT_BASE_URL = 'https://manual-import.local'
const DEFAULT_CSV_FOLDER = process.env.CSV_IMPORT_DIR || '/tmp/csv-imports'

type CsvFile = {
  fileId: string
  fileName: string
  filePath: string
}

type CsvParsedRow = JsonRecord & {
  fileId: string
  fundingAgency: string
  projectRecordId: string
  scheme: string
  financialYear: string
  title: string
  piName: string
  piOrganization: string
  piEmail: string | null
  state: string | null
  budgetAmount: string | null
}

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\r/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .trim()
  if (!text || text === '-' || /^null$/i.test(text) || text === '') return null
  return text
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function parseBudgetAmount(value?: string | null): string | null {
  if (!value) return null
  const numeric = String(value).replace(/[^\d.]/g, '')
  if (!numeric) return null
  return numeric
}

function extractYearFromFinancialYear(financialYear: string): number | null {
  const match = financialYear.match(/(\d{4})/)
  if (match) {
    const year = Number(match[1])
    if (year >= 2000 && year <= 2050) return year
  }
  return null
}

function normalizeColumnName(key: string): string {
  return key.toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^_+|_+$/g, '')
}

function splitCsvLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"' && quoted && next === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      quoted = !quoted
      continue
    }

    if (char === ',' && !quoted) {
      values.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  values.push(current.trim())
  return values
}

function parseCsvRecords(content: string): JsonRecord[] {
  const lines: string[] = []
  let current = ''
  let quoted = false

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const next = content[index + 1]

    if (char === '"' && quoted && next === '"') {
      current += '""'
      index += 1
      continue
    }

    if (char === '"') {
      quoted = !quoted
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (current.trim()) lines.push(current)
      current = ''
      if (char === '\r' && next === '\n') index += 1
      continue
    }

    current += char
  }

  if (current.trim()) lines.push(current)
  if (lines.length < 2) return []

  const headers = splitCsvLine(lines[0]).map((header) => header.replace(/^\uFEFF/, '').trim())
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line)
    return headers.reduce<JsonRecord>((record, header, index) => {
      record[header] = values[index] ?? ''
      return record
    }, {})
  })
}

function detectColumnMapping(columns: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  
  for (const col of columns) {
    const normalized = normalizeColumnName(col)
    
    // Funding Agency
    if (/funding_?agency|agency|source|funder/.test(normalized)) {
      mapping.fundingAgency = col
    }
    // Project ID
    else if (/(project_?record_?id|project_?id|record_?id|id|proposal_?id|application_?id)/.test(normalized) && 
             !normalized.includes('pi_')) {
      mapping.projectRecordId = col
    }
    // Scheme
    else if (/scheme|programme|program|funding_?scheme/.test(normalized)) {
      mapping.scheme = col
    }
    // Financial Year
    else if (/financial_?year|fy|year|fiscal_?year/.test(normalized)) {
      mapping.financialYear = col
    }
    // Title
    else if (/title|project_?title|proposal_?title/.test(normalized)) {
      mapping.title = col
    }
    // PI Name
    else if (/(pi_?name|principal_?investigator|investigator_?name|applicant_?name|researcher_?name)/.test(normalized)) {
      mapping.piName = col
    }
    // PI Organization
    else if (/(pi_?organization|pi_?institution|organization|institution|university|college|host_?institution)/.test(normalized)) {
      mapping.piOrganization = col
    }
    // PI Email
    else if (/(pi_?email|email|contact_?email)/.test(normalized)) {
      mapping.piEmail = col
    }
    // State
    else if (/state|location|region|province/.test(normalized)) {
      mapping.state = col
    }
    // Budget
    else if (/(budget_?size|budget|budget_?amount|amount|funding_?amount|total_?budget|grant|sanctioned_?amount)/.test(normalized)) {
      mapping.budgetAmount = col
    }
  }
  
  return mapping
}

function parseCsvFile(buffer: Buffer, file: CsvFile): CsvParsedRow[] {
  const rows: CsvParsedRow[] = []

  try {
    const content = buffer.toString('utf-8')
    const records = parseCsvRecords(content)

    if (records.length === 0) {
      return rows
    }

    // Detect column mapping from first record
    const columns = Object.keys(records[0])
    const mapping = detectColumnMapping(columns)

    for (const record of records) {
      // Extract values using detected mapping
      const fundingAgency = cleanText(record[mapping.fundingAgency || ''] || record['Funding_agency'] || record['Funding Agency'] || record['Agency'] || 'Unknown')
      const projectRecordId = cleanText(record[mapping.projectRecordId || ''] || record['dst_project_record_id'] || record['Project ID'] || record['ID'] || record['Record ID'])
      const scheme = cleanText(record[mapping.scheme || ''] || record['scheme'] || record['Scheme'] || 'General Scheme')
      const financialYear = cleanText(record[mapping.financialYear || ''] || record['financial_year'] || record['Financial Year'] || record['Year'] || 'Unknown')
      const title = cleanText(record[mapping.title || ''] || record['title_for_entry'] || record['Title'] || record['Project Title'])
      const piName = cleanText(record[mapping.piName || ''] || record['pi_name'] || record['PI Name'] || record['Principal Investigator'])
      const piOrganization = cleanText(record[mapping.piOrganization || ''] || record['pi_organization'] || record['PI Organization'] || record['Organization'] || record['Institution'])
      const piEmail = cleanText(record[mapping.piEmail || ''] || record['pi_emails'] || record['PI Email'] || record['Email'])
      const state = cleanText(record[mapping.state || ''] || record['state'] || record['State'] || record['Location'])
      const budgetAmount = cleanText(record[mapping.budgetAmount || ''] || record['budget_size'] || record['Budget'] || record['Amount'] || record['Budget Size'])

      // Skip rows without minimum required fields
      if (!title) {
        continue
      }

      // Generate a record ID if not provided
      const finalProjectId = projectRecordId || 
        `${fundingAgency?.replace(/\s+/g, '_').toUpperCase() || 'UNKNOWN'}-${hash(title).slice(0, 10)}`

      rows.push({
        fileId: file.fileId,
        fundingAgency: fundingAgency || 'Unknown Agency',
        projectRecordId: finalProjectId,
        scheme: scheme || 'General',
        financialYear: financialYear || 'Unknown',
        title,
        piName: piName || 'Unknown',
        piOrganization: piOrganization || 'Unknown',
        piEmail,
        state,
        budgetAmount,
      })
    }
  } catch (error) {
    console.error(`Error parsing CSV ${file.fileName}:`, error)
  }

  return rows
}

function buildSourceRecordKey(row: CsvParsedRow) {
  return `CSV_IMPORT:${row.fileId}:${row.projectRecordId}:${hash(row.title).slice(0, 12)}`
}

export class CsvImportPublicProjectConnector implements PublicProjectConnector {
  sourceKey = 'CSV_IMPORT' as const
  baseUrl = CSV_IMPORT_BASE_URL

  private readonly csvFolder: string

  constructor(options: { csvFolder?: string } = {}) {
    this.csvFolder = options.csvFolder || DEFAULT_CSV_FOLDER
  }

  async listStates(): Promise<string[]> {
    return []
  }

  private async discoverCsvFiles(): Promise<CsvFile[]> {
    const files: CsvFile[] = []
    try {
      const entries = await fs.readdir(this.csvFolder, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && (entry.name.toLowerCase().endsWith('.csv') || entry.name.toLowerCase().endsWith('.txt'))) {
          const filePath = join(this.csvFolder, entry.name)
          const fileId = hash(entry.name).slice(0, 16)
          files.push({
            fileId,
            fileName: entry.name,
            filePath,
          })
        }
      }
    } catch (error) {
      console.error(`Error reading CSV folder: ${error}`)
    }
    return files.sort((a, b) => a.fileName.localeCompare(b.fileName))
  }

  async *discover(options: PublicProjectDiscoveryOptions): AsyncGenerator<PublicProjectDiscoveredRecord> {
    const maxRecords = options.maxRecords ?? (options.mode === 'pilot' ? 100 : Number.POSITIVE_INFINITY)
    let emitted = 0

    const csvFiles = await this.discoverCsvFiles()

    for (const csv of csvFiles) {
      if (emitted >= maxRecords) return

      try {
        const buffer = await fs.readFile(csv.filePath)
        const rows = parseCsvFile(buffer, csv)

        for (const row of rows) {
          if (emitted >= maxRecords) return

          const title = cleanText(row.title) || `Project ${row.projectRecordId}`
          const sourceRecordKey = buildSourceRecordKey(row)
          emitted += 1

          yield {
            sourceKey: 'CSV_IMPORT',
            externalId: `${csv.fileId}:${row.projectRecordId}`,
            sourceVariant: `csv_${row.fundingAgency.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}`,
            sourceRecordKey,
            detailUrl: null,
            listingPayload: {
              ...row,
              title,
              filePath: csv.filePath,
            },
          }
        }
      } catch (error) {
        console.error(`Error processing CSV ${csv.fileName}: ${error}`)
      }
    }
  }

  async fetchAndNormalize(record: PublicProjectDiscoveredRecord): Promise<NormalizedPublicProject> {
    const row = record.listingPayload as CsvParsedRow & {
      filePath: string
    }

    const title = cleanText(row.title) || `Project ${row.projectRecordId}`
    const sanctionYear = extractYearFromFinancialYear(row.financialYear)

    const budgetValue = parseBudgetAmount(row.budgetAmount)
    const budgetNumber = budgetValue ? Number(budgetValue) : null

    return {
      sourceKey: 'CSV_IMPORT',
      externalId: record.externalId,
      sourceVariant: record.sourceVariant,
      sourceRecordKey: record.sourceRecordKey,
      sourceUrl: CSV_IMPORT_BASE_URL,
      detailUrl: null,
      projectType: 'csv_imported_project',
      programName: `${row.fundingAgency} Funding`,
      schemeName: row.scheme,
      schemeHierarchy: {
        source: 'CSV Import',
        fundingAgency: row.fundingAgency,
        scheme: row.scheme,
        financialYear: row.financialYear,
      },
      category: row.scheme,
      areaName: null,
      title,
      abstractText: 'NA',
      primaryInvestigatorName: cleanText(row.piName),
      primaryInstitutionName: cleanText(row.piOrganization),
      country: 'India',
      state: cleanText(row.state),
      sanctionYear,
      startDate: sanctionYear ? new Date(`${sanctionYear}-04-01`) : null,
      durationMonths: null,
      budgetAmount: budgetNumber,
      budgetCurrency: budgetValue ? 'INR' : null,
      budgetComponents: budgetValue
        ? {
            totalBudget: row.budgetAmount,
            financialYear: row.financialYear,
          }
        : null,
      rawPayload: {
        row,
      },
      extendedFields: {
        fileName: row.fileId,
        fundingAgency: row.fundingAgency,
        projectRecordId: row.projectRecordId,
        scheme: row.scheme,
        financialYear: row.financialYear,
        piEmail: row.piEmail,
        filePath: row.filePath,
        note: 'CSV Import source processes uploaded CSV files containing manually collected project data from various funding agencies; abstract is stored as NA and embeddings use title only.',
      },
      participants: row.piName
        ? [
            {
              role: 'PI',
              name: row.piName,
              institutionName: cleanText(row.piOrganization),
              country: 'India',
              state: cleanText(row.state),
              sourcePayload: {
                piOrganization: row.piOrganization,
                piEmail: row.piEmail,
              },
            },
          ]
        : [],
      contacts: row.piEmail
        ? [
            {
              contactType: 'email',
              label: 'Principal Investigator',
              value: row.piEmail,
              sourcePayload: { source: 'csv_import' },
            },
          ]
        : [],
    }
  }
}

export function createCsvImportPublicProjectConnector(options?: { csvFolder?: string }) {
  return new CsvImportPublicProjectConnector(options)
}

export const __csvImportTestables = {
  parseCsvFile,
  detectColumnMapping,
  extractYearFromFinancialYear,
  parseBudgetAmount,
  buildSourceRecordKey,
  normalizeColumnName,
}
