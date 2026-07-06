import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, basename, extname } from 'node:path'

import pdfParse from 'pdf-parse-fork'

import type {
  JsonRecord,
  NormalizedPublicProject,
  PublicProjectConnector,
  PublicProjectDiscoveredRecord,
  PublicProjectDiscoveryOptions,
  PublicProjectRawRecord,
} from '@/lib/publicProjects/types'

const ICSSR_BASE_URL = 'https://www.icssr.org'
const DEFAULT_PDF_FOLDER = process.env.ICSSR_UPLOAD_DIR || '/tmp/icssr-uploads'

type IcssrPdfFile = {
  fileId: string
  fileName: string
  filePath: string
  projectType: string
  yearWindow: string
}

type IcssrParsedRow = JsonRecord & {
  fileId: string
  fileName: string
  serialNumber: string
  applicationId?: string | null
  taiwanCollaboration?: boolean
  title?: string | null
  principalInvestigator?: string | null
  institution?: string | null
  fundedBy?: string | null
  awardDate?: string | null
  amount?: string | null
  duration?: string | null
  subjectArea?: string | null
  status?: string | null
  rawBlock: string
}

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\r/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!text || text === '-' || /^null$/i.test(text)) return null
  return text
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizedLines(text: string) {
  return text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => cleanText(line))
    .filter((line): line is string => Boolean(line))
}

function isSerialLine(line: string) {
  return /^\d{1,4}[.\)]?$/.test(line.trim())
}

function isAmountLine(line: string) {
  return /^(Rs\.?|INR|₹)\s*[\d,]+\s*(lakhs?)?/i.test(line.trim())
}

function isDurationLine(line: string) {
  return /^\d+\s*(months?|years?)/i.test(line.trim())
}

function isDateLine(line: string) {
  return /^(January|February|March|April|May|June|July|August|September|October|November|December|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i.test(
    line.trim()
  )
}

const APPLICATION_ID_PATTERN = /\bICSSR\s*[-–]\s*[A-Z0-9]+(?:\s*[-–]\s*[A-Z0-9]+)+\b/i
const PERSON_PREFIX_PATTERN = /(?:Dr|Prof|Professor|Mr|Mrs|Ms)\.?/i
const TITLE_START_WORDS = new Set([
  'a', 'an', 'the', 'advancing', 'ai', 'alleviating', 'analysing', 'analyzing', 'assessment',
  'assessing', 'awareness', 'bridging', 'building', 'carbon', 'citizenship', 'climate',
  'colonial', 'comparative', 'contours', 'crafting', 'cross-national', 'cultural', 'decoding',
  'designing', 'determinants', 'developing', 'development', 'digital', 'digitalising', 'documentation',
  'ecology', 'effectiveness', 'empowering', 'enhancing', 'evaluating', 'evaluation',
  'exploring', 'expressing', 'festivals', 'foraging', 'from', 'gendered', 'green',
  'harnessing', 'heritage', 'historical', 'history', 'impact', 'implementation',
  'improving', 'infrastructure', 'integral', 'integrating', 'investigating', 'leveraging',
  'kalinga-lanka', 'mapping', 'marginalization', 'mediating', 'mission', 'optimal', 'paid', 'panchayat', 'pm',
  'performing', 'policy', 'preserving', 'professional', 'psychosocial', 'repositioning',
  'resilience', 'revisiting', 'reviving', 'river-sensitive', 'role', 'socio-economic',
  'socio-ecological', 'socio-technical', 'solar', 'strategic', 'strengthening', 'street',
  'striving', 'studying', 'temple', 'toward', 'towards', 'transforming', 'triple',
  'understanding', 'unveiling', 'urban', 'water', 'woman-led', 'women',
])

function normalizeApplicationId(value: string | null): string | null {
  if (!value) return null
  return value.replace(/\s*[-–]\s*/g, '-').replace(/\s+/g, '').toUpperCase()
}

function findApplicationId(lines: string[]): string | null {
  const match = lines.join(' ').match(APPLICATION_ID_PATTERN)
  return normalizeApplicationId(match?.[0] || null)
}

function isPersonStart(line: string) {
  return /^(?:Dr|Prof|Mr|Mrs|Ms)\.?\s+[\p{L}]/iu.test(line.trim())
}

function findRowStarts(lines: string[], collaborationFile: boolean) {
  const starts: Array<{ index: number; serialNumber: string }> = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    const inlineApplication = line.match(/^(\d{1,4})[.)]?\s+(?=ICSSR\s*[-–])/i)
    if (inlineApplication) {
      starts.push({ index, serialNumber: inlineApplication[1] })
      continue
    }

    const inlineCollaboration = collaborationFile
      ? line.match(/^(\d{1,4})[.)]\s+(?=(?:Dr|Prof|Professor|Mr|Mrs|Ms)\.?\s)/i)
      : null
    if (inlineCollaboration) {
      starts.push({ index, serialNumber: inlineCollaboration[1] })
      continue
    }

    const isolated = line.match(/^(\d{1,4})[.)]?$/)
    if (!isolated) continue

    const lookahead = lines.slice(index + 1, index + 5)
    const hasApplicationId = /^ICSSR\s*[-–]/i.test(lookahead.slice(0, 2).join(' '))
    const hasCollaborationPerson = collaborationFile && lookahead.some(isPersonStart)
    if (hasApplicationId || hasCollaborationPerson) {
      starts.push({ index, serialNumber: isolated[1] })
    }
  }

  return starts
}

function cleanRowContent(blockLines: string[], applicationId: string | null) {
  let content = blockLines.join(' ').replace(/^\s*\d{1,4}[.)]?\s*/, '')
  const applicationMatch = content.match(APPLICATION_ID_PATTERN)
  if (applicationMatch?.index !== undefined) {
    content = content.slice(applicationMatch.index + applicationMatch[0].length)
  } else if (applicationId) {
    content = content.replace(applicationId, '')
  }
  return cleanText(content)
}

function splitPersonAndTitle(content: string | null) {
  if (!content) return { person: null, title: null }

  const prefixMatch = content.match(new RegExp(`^(${PERSON_PREFIX_PATTERN.source})\\s+`, 'i'))
  const prefixWordCount = prefixMatch ? prefixMatch[0].trim().split(/\s+/).length : 0
  const words = content.split(/\s+/)
  const minimumNameWords = prefixWordCount > 0 ? prefixWordCount + 1 : 1
  const maximumNameWords = Math.min(words.length - 1, prefixWordCount > 0 ? prefixWordCount + 5 : 4)

  let titleIndex = -1
  for (let index = minimumNameWords; index <= maximumNameWords; index += 1) {
    const normalized = words[index]?.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}-]+$/gu, '').toLowerCase()
    if (normalized && TITLE_START_WORDS.has(normalized)) {
      titleIndex = index
      break
    }
  }

  if (titleIndex < 0) {
    const defaultNameWords = prefixWordCount > 0
      ? (words[prefixWordCount]?.match(/^[A-Z]\.?$/) ? prefixWordCount + 4 : prefixWordCount + 2)
      : Math.min(3, words.length - 1)
    titleIndex = Math.min(Math.max(defaultNameWords, minimumNameWords), words.length - 1)
  }

  return {
    person: cleanText(words.slice(0, titleIndex).join(' ')),
    title: cleanText(words.slice(titleIndex).join(' ')),
  }
}

function splitInstitutionAndTitle(content: string | null) {
  if (!content) return { institution: null, title: null }
  const words = content.split(/\s+/)
  for (let index = 2; index < words.length; index += 1) {
    const normalized = words[index].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}-]+$/gu, '').toLowerCase()
    if (TITLE_START_WORDS.has(normalized)) {
      return {
        institution: cleanText(words.slice(0, index).join(' ')),
        title: cleanText(words.slice(index).join(' ')),
      }
    }
  }
  return { institution: null, title: content }
}

function parseCollaborationBlock(blockLines: string[], isTaiwanFile: boolean) {
  const withoutSerial = [...blockLines]
  withoutSerial[0] = withoutSerial[0].replace(/^\s*\d{1,4}[.)]?\s*/, '')

  const personIndexes = withoutSerial
    .map((line, index) => (isPersonStart(line) ? index : -1))
    .filter((index) => index >= 0)
  const indianIndex = personIndexes[0] ?? -1
  const foreignIndex = personIndexes[1] ?? -1

  let titleStart = -1
  if (foreignIndex >= 0) {
    const foreignCountryPattern = isTaiwanFile
      ? /(?:^|,\s*)(?:taiwan(?:\s*\(r\.?o\.?c\.?\))?|taipei(?:,?\s*taiwan)?)\s*$/i
      : /(?:japan|tokyo|osaka|kyoto)\s*$/i
    for (let index = foreignIndex + 1; index < withoutSerial.length; index += 1) {
      if (foreignCountryPattern.test(withoutSerial[index])) {
        titleStart = index + 1
        break
      }
    }
  }
  if (titleStart < 0 && foreignIndex >= 0) {
    titleStart = Math.min(foreignIndex + 2, withoutSerial.length - 1)
  }

  const principalInvestigator = indianIndex >= 0 ? cleanText(withoutSerial[indianIndex]) : null
  const institution = indianIndex >= 0 && foreignIndex > indianIndex
    ? lineJoin(withoutSerial.slice(indianIndex + 1, foreignIndex))
    : null
  const title = titleStart >= 0 ? lineJoin(withoutSerial.slice(titleStart)) : null

  return { principalInvestigator, institution, title }
}

function lineJoin(lines: string[]) {
  return cleanText(lines.join('\n'))
}

function isTaiwanCollaboration(fileName: string): boolean {
  return fileName.toLowerCase().includes('nstc')
}

function isJapanCollaboration(fileName: string): boolean {
  return fileName.toLowerCase().includes('jsps')
}

function extractProjectTypeFromFilename(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower.includes('major')) return 'Major Research Project'
  if (lower.includes('minor')) return 'Minor Research Project'
  if (lower.includes('ffsi')) return 'Fellowship for Senior Indian Faculty (FFSI)'
  if (lower.includes('lss')) return 'Library Support Scheme (LSS)'
  if (lower.includes('longitudinal')) return 'Longitudinal Studies'
  if (lower.includes('pvtg') || lower.includes('tribe')) return 'Special Call for PVTGs/Tribes'
  if (lower.includes('vvb') || lower.includes('2047')) return 'Viksit Bharat 2047'
  if (lower.includes('jjm')) return 'Jal Jeevan Mission Research'
  if (lower.includes('jsps')) return 'ICSSR-JSPS Joint Research (India-Japan)'
  if (lower.includes('nstc')) return 'ICSSR-NSTC Joint Research (India-Taiwan)'
  if (lower.includes('jointresearch')) return 'Joint Research Programme'
  if (lower.includes('research-programme')) return 'Research Programme'
  if (lower.includes('awardees')) return 'Awardees List'
  return 'ICSSR Research Project'
}

function extractYearFromFilename(fileName: string): string {
  const patterns = [
    /(\d{4})[-_](\d{2,4})/,
    /(\d{4})\s*[-_]?\s*results?/i,
    /(\d{4})\s*[-_]?\s*final/i,
    /result[_\s]?(\d{4})/i,
    /(\d{4})[-_]\d{2}/,
    /(\d{4})/,
  ]
  for (const pattern of patterns) {
    const match = fileName.match(pattern)
    if (match) {
      const year = match[1]
      if (year && Number(year) >= 2020 && Number(year) <= 2030) {
        return match[2] ? `${match[1]}-${match[2]}` : match[1]
      }
    }
  }
  return 'Unknown Year'
}

function classifyPdfType(fileName: string): { projectType: string; yearWindow: string } {
  return {
    projectType: extractProjectTypeFromFilename(fileName),
    yearWindow: extractYearFromFilename(fileName),
  }
}

function isTaiwanPI(line: string): boolean {
  const taiwanIndicators = [
    /taiwan/i,
    /taipei/i,
    /national taiwan/i,
    /academia sinica/i,
    /nstc/i,
    /taiwanese/i,
    /china.*taiwan/i,
    /taiwan.*china/i,
  ]
  return taiwanIndicators.some((pattern) => pattern.test(line))
}

function isIndianPI(line: string): boolean {
  const indianIndicators = [
    /india/i,
    /university of delhi/i,
    /jnu/i,
    /jawaharlal nehru/i,
    /iit/i,
    /iim/i,
    /university of hyderabad/i,
    /bhu/i,
    /banaras hindu/i,
    /university of mumbai/i,
    /university of calcutta/i,
    /university of madras/i,
    /\b(du|hu|pu|mu)\b/i,
  ]
  return indianIndicators.some((pattern) => pattern.test(line))
}

function extractPIsForCollaboration(blockLines: string[], isTaiwanFile: boolean): { pi: string | null; institution: string | null } {
  let indianPI: string | null = null
  let indianInstitution: string | null = null
  let foreignPI: string | null = null
  let foreignInstitution: string | null = null

  for (let i = 0; i < blockLines.length; i++) {
    const line = blockLines[i]
    const lower = line.toLowerCase()

    if (lower.includes('principal investigator') || lower.includes('pi:') || /^Dr\.?\s+/i.test(line)) {
      const cleanPI = cleanText(line.replace(/principal investigator[:\s]*/i, ''))
      if (!cleanPI) continue

      const nextLines = blockLines.slice(i + 1, i + 5).join(' ')
      const combinedText = `${cleanPI} ${nextLines}`

      if (isTaiwanPI(combinedText) || isTaiwanPI(cleanPI)) {
        foreignPI = cleanPI
        for (let j = i + 1; j < Math.min(i + 6, blockLines.length); j++) {
          if (isTaiwanPI(blockLines[j])) {
            foreignInstitution = blockLines[j]
            break
          }
        }
      } else if (isIndianPI(combinedText) || !isTaiwanFile) {
        if (!indianPI) {
          indianPI = cleanPI
          for (let j = i + 1; j < Math.min(i + 6, blockLines.length); j++) {
            const instLine = blockLines[j]
            if (instLine.toLowerCase().includes('university') ||
                instLine.toLowerCase().includes('college') ||
                instLine.toLowerCase().includes('institute') ||
                instLine.toLowerCase().includes('centre') ||
                instLine.toLowerCase().includes('center')) {
              if (!isTaiwanPI(instLine)) {
                indianInstitution = instLine
                break
              }
            }
          }
        }
      }
    }
  }

  return { pi: indianPI, institution: indianInstitution }
}

function parseIcssrPdfRows(text: string, pdf: IcssrPdfFile): IcssrParsedRow[] {
  const lines = normalizedLines(text)
  const rows: IcssrParsedRow[] = []
  const seen = new Set<string>()

  const headerText = lines.slice(0, 40).join(' ')
  const isTaiwanFile = isTaiwanCollaboration(pdf.fileName) || /\bNSTC\b|Taiwan/i.test(headerText)
  const isJapanFile = isJapanCollaboration(pdf.fileName) || /\bJSPS\b|Japan Society/i.test(headerText)
  const isCollaborationFile = isTaiwanFile || isJapanFile
  const hasNamedCoordinatorColumn = /Name of (?:the )?Project\s+(?:Director|Coordinator|Co-ordinator)/i.test(
    headerText
  )
  const hasInstitutionColumn = /Name of (?:the )?Institution/i.test(headerText)
  const serialIndexes = findRowStarts(lines, isCollaborationFile)

  for (let position = 0; position < serialIndexes.length; position += 1) {
    const start = serialIndexes[position].index
    const end = serialIndexes[position + 1]?.index ?? lines.length
    const serialNumber = serialIndexes[position].serialNumber
    const untrimmedBlock = lines.slice(start, end)
    const footerIndex = untrimmedBlock.findIndex(
      (line, index) =>
        index > 0 &&
        /^(?:Disclaimer|Note:\s*All precautions|List of Awardees|Detailed List|Indian Council of Social Science Research|S\.?\s*No\.?$)/i.test(
          line
        )
    )
    const blockLines = (footerIndex > 0 ? untrimmedBlock.slice(0, footerIndex) : untrimmedBlock).filter(
      (line, index) =>
        index === 0 ||
        !/^(?:Application(?: ID| No\.?| Number)?|Name of (?:the )?(?:Project|Institution)|Project Director|Title of (?:the )?(?:Study|Research|Proposal|Programme)|Indian PI|Taiwanese PI|Japanese Principal Investigator)$/i.test(
          line
        )
    )
    const applicationId = findApplicationId(blockLines)

    let title: string | null = null
    let principalInvestigator: string | null = null
    let institution: string | null = null
    let fundedBy: string | null = null
    let awardDate: string | null = null
    let amount: string | null = null
    let duration: string | null = null
    let subjectArea: string | null = null
    let status: string | null = null

    if (isCollaborationFile) {
      const collaboration = parseCollaborationBlock(blockLines, isTaiwanFile)
      principalInvestigator = collaboration.principalInvestigator
      institution = collaboration.institution
      title = collaboration.title
    } else {
      const content = cleanRowContent(blockLines, applicationId)
      const startsWithPerson = Boolean(
        content && new RegExp(`^${PERSON_PREFIX_PATTERN.source}\\s+`, 'i').test(content)
      )
      if (startsWithPerson || hasNamedCoordinatorColumn) {
        const split = splitPersonAndTitle(content)
        principalInvestigator = split.person
        title = split.title
      } else if (hasInstitutionColumn) {
        const split = splitInstitutionAndTitle(content)
        institution = split.institution
        title = split.title
      } else {
        title = content
      }
    }

    for (let i = 1; i < blockLines.length; i++) {
      const line = blockLines[i]
      const lower = line.toLowerCase()

      if (!isCollaborationFile && (lower.includes('institution') || lower.includes('university') || lower.includes('college'))) {
        if (!institution) institution = line
      }

      if (isAmountLine(line) && !amount) {
        amount = line
        continue
      }

      if (isDurationLine(line) && !duration) {
        duration = line
        continue
      }

      if (isDateLine(line) && !awardDate) {
        awardDate = line
        continue
      }

      if (lower.includes('subject') || lower.includes('discipline') || lower.includes('area:')) {
        if (!subjectArea) {
          subjectArea = cleanText(line.replace(/subject\s*(area)?[:\s]*/i, ''))
        }
        continue
      }

      if (lower.includes('status') || lower.includes('recommended') || lower.includes('approved')) {
        if (!status) {
          status = line
        }
        continue
      }

    }

    if (!title) {
      title = blockLines.find((l) => l.length > 20 && !isSerialLine(l)) || null
    }

    const rawBlock = blockLines.join('\n')
    const stableKey = `${pdf.fileId}:${serialNumber}:${(title || principalInvestigator || '').toLowerCase()}`
    if (seen.has(stableKey)) continue
    seen.add(stableKey)

    rows.push({
      fileId: pdf.fileId,
      fileName: pdf.fileName,
      serialNumber,
      applicationId,
      taiwanCollaboration: isTaiwanFile,
      title,
      principalInvestigator,
      institution,
      fundedBy,
      awardDate,
      amount,
      duration,
      subjectArea,
      status,
      rawBlock,
    })
  }

  return rows
}

function buildSourceRecordKey(row: IcssrParsedRow) {
  return `ICSSR:${row.fileId}:${row.serialNumber}:${hash([row.title, row.principalInvestigator].join('|')).slice(0, 12)}`
}

function parseBudgetAmount(value?: string | null): string | null {
  if (!value) return null
  const numeric = value.replace(/[^\d.]/g, '')
  if (!numeric) return null
  return numeric
}

function parseDurationMonths(value?: string | null): number | null {
  if (!value) return null
  const match = value.match(/(\d+)\s*(months?|years?)/i)
  if (!match) return null
  const count = Number(match[1])
  if (!Number.isFinite(count)) return null
  return /^year/i.test(match[2]) ? count * 12 : count
}

function parseAwardDate(value?: string | null): { date: Date | null; year: number | null } {
  if (!value) return { date: null, year: null }

  const yearMatch = value.match(/(\d{4})/)
  if (yearMatch) {
    const year = Number(yearMatch[1])
    if (year >= 2020 && year <= 2030) {
      return { date: new Date(`${year}-01-01`), year }
    }
  }

  const date = new Date(value)
  if (!Number.isNaN(date.getTime())) {
    return { date, year: date.getUTCFullYear() }
  }

  return { date: null, year: null }
}

export class IcssrPublicProjectConnector implements PublicProjectConnector {
  sourceKey = 'ICSSR' as const
  baseUrl = ICSSR_BASE_URL

  private readonly pdfFolder: string

  constructor(options: { pdfFolder?: string } = {}) {
    this.pdfFolder = options.pdfFolder || DEFAULT_PDF_FOLDER
  }

  async listStates(): Promise<string[]> {
    return []
  }

  private async discoverPdfFiles(): Promise<IcssrPdfFile[]> {
    const files: IcssrPdfFile[] = []
    try {
      const entries = await fs.readdir(this.pdfFolder, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
          const filePath = join(this.pdfFolder, entry.name)
          const fileId = hash(entry.name).slice(0, 16)
          const { projectType, yearWindow } = classifyPdfType(entry.name)
          files.push({
            fileId,
            fileName: entry.name,
            filePath,
            projectType,
            yearWindow,
          })
        }
      }
    } catch (error) {
      console.error(`Error reading ICSSR PDF folder: ${error}`)
    }
    return files.sort((a, b) => a.fileName.localeCompare(b.fileName))
  }

  async *discover(options: PublicProjectDiscoveryOptions): AsyncGenerator<PublicProjectDiscoveredRecord> {
    const maxRecords = options.maxRecords ?? (options.mode === 'pilot' ? 20 : Number.POSITIVE_INFINITY)
    let emitted = 0

    const pdfFiles = await this.discoverPdfFiles()

    for (const pdf of pdfFiles) {
      if (emitted >= maxRecords) return

      try {
        const buffer = await fs.readFile(pdf.filePath)
        const parsed = await pdfParse(buffer)
        const rows = parseIcssrPdfRows(parsed.text || '', pdf)

        for (const row of rows) {
          if (emitted >= maxRecords) return

          const title =
            cleanText(row.title) ||
            cleanText(row.rawBlock.split('\n').find((line) => line.length > 20)) ||
            `ICSSR ${pdf.projectType} ${row.serialNumber}`

          const sourceRecordKey = buildSourceRecordKey({ ...row, title })
          emitted += 1

          yield {
            sourceKey: 'ICSSR',
            externalId: `${pdf.fileId}:${row.applicationId || row.serialNumber}`,
            sourceVariant: `icssr_${pdf.projectType.toLowerCase().replace(/\s+/g, '_')}`,
            sourceRecordKey,
            detailUrl: null,
            listingPayload: {
              ...row,
              title,
              projectType: pdf.projectType,
              yearWindow: pdf.yearWindow,
              pdfTextHash: hash(parsed.text || ''),
              pdfPages: parsed.numpages || null,
              filePath: pdf.filePath,
            },
          }
        }
      } catch (error) {
        console.error(`Error parsing ICSSR PDF ${pdf.fileName}: ${error}`)
      }
    }
  }

  async fetchAndNormalize(record: PublicProjectDiscoveredRecord): Promise<NormalizedPublicProject> {
    const row = record.listingPayload as IcssrParsedRow & {
      projectType: string
      yearWindow: string
      pdfPages?: number | null
      pdfTextHash?: string | null
      filePath: string
    }

    const isTaiwanFile = Boolean(row.taiwanCollaboration) || isTaiwanCollaboration(row.fileName)
    const title = cleanText(row.title) || `ICSSR ${row.projectType} ${row.serialNumber}`
    const award = parseAwardDate(row.awardDate)

    let piName = cleanText(row.principalInvestigator)
    let piInstitution = cleanText(row.institution)

    if (isTaiwanFile && piName && isTaiwanPI(`${piName} ${piInstitution || ''}`)) {
      piName = null
      piInstitution = null
    }

    const participants = piName
      ? [
          {
            role: 'PI' as const,
            name: piName,
            institutionName: piInstitution,
            country: 'India',
            sourcePayload: {
              institution: row.institution,
            },
          },
        ]
      : []

    return {
      sourceKey: 'ICSSR',
      externalId: record.externalId,
      sourceVariant: record.sourceVariant,
      sourceRecordKey: record.sourceRecordKey,
      sourceUrl: ICSSR_BASE_URL,
      detailUrl: null,
      projectType: row.projectType,
      programName: 'ICSSR Research Funding',
      schemeName: row.projectType,
      schemeHierarchy: {
        source: 'ICSSR',
        program: 'Research Projects',
        projectType: row.projectType,
        yearWindow: row.yearWindow,
      },
      category: row.projectType,
      areaName: cleanText(row.subjectArea),
      title,
      abstractText: 'NA',
      primaryInvestigatorName: piName,
      primaryInstitutionName: piInstitution,
      country: 'India',
      sanctionYear: award.year,
      startDate: award.date,
      durationMonths: parseDurationMonths(row.duration),
      budgetAmount: parseBudgetAmount(row.amount),
      budgetCurrency: row.amount ? 'INR' : null,
      budgetComponents: row.amount
        ? {
            amount: row.amount,
            duration: row.duration,
          }
        : null,
      rawPayload: {
        row,
      },
      extendedFields: {
        fileName: row.fileName,
        projectType: row.projectType,
        yearWindow: row.yearWindow,
        serialNumber: row.serialNumber,
        applicationId: row.applicationId,
        institution: row.institution,
        fundedBy: row.fundedBy,
        awardDate: row.awardDate,
        amount: row.amount,
        duration: row.duration,
        subjectArea: row.subjectArea,
        status: row.status,
        pdfPages: row.pdfPages,
        pdfTextHash: row.pdfTextHash,
        filePath: row.filePath,
        note: isTaiwanFile
          ? 'ICSSR-NSTC joint research project. Taiwan PI information excluded from record as per policy. Indian PI data only.'
          : 'ICSSR source processes local PDF files from awarded projects; abstract is stored as NA and embeddings use title only.',
      },
      participants,
      contacts: [],
    }
  }

  async fetchRaw(record: PublicProjectDiscoveredRecord): Promise<PublicProjectRawRecord> {
    const row = record.listingPayload as IcssrParsedRow & {
      projectType: string
      yearWindow: string
      pdfPages?: number | null
      pdfTextHash?: string | null
      filePath?: string | null
    }

    return {
      sourceKey: 'ICSSR',
      externalId: record.externalId,
      sourceVariant: record.sourceVariant,
      sourceRecordKey: record.sourceRecordKey,
      sourceUrl: ICSSR_BASE_URL,
      detailUrl: null,
      fetchedAt: new Date().toISOString(),
      listingPayload: row,
      detailPayload: {
        fileName: row.fileName,
        filePath: row.filePath || null,
        pdfPages: row.pdfPages || null,
        pdfTextHash: row.pdfTextHash || null,
      },
      rawPayload: {
        row,
      },
    }
  }
}

export function createIcssrPublicProjectConnector(options?: { pdfFolder?: string }) {
  return new IcssrPublicProjectConnector(options)
}

export const __icssrTestables = {
  classifyPdfType,
  parseIcssrPdfRows,
  extractProjectTypeFromFilename,
  extractYearFromFilename,
  parseBudgetAmount,
  parseDurationMonths,
  parseAwardDate,
  buildSourceRecordKey,
  isTaiwanCollaboration,
  isJapanCollaboration,
  isTaiwanPI,
  isIndianPI,
  extractPIsForCollaboration,
}
