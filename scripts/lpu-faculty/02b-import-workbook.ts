/**
 * Step 2b — adapter for a profile workbook enriched outside this repo.
 *
 * Takes LPU_Researcher_Profiles.xlsx (UID, Name, Paper Count, Confidence,
 * Research Areas, Keywords, Research Summary, Influential Publication 1..5) and
 * rewrites it into the same shape 02-enrich.ts produces, so 03-emit.ts runs
 * against either source without changes.
 *
 * Title and venue are taken from the ORIGINAL authorship export via each cell's
 * "[Row N]" back-reference, not from the display text in the workbook — the
 * display text uses curly quotes and an em-dash separator, and re-parsing it
 * would be a lossy round-trip. The row reference is verified against the source
 * title before it is accepted, so a bad reference fails loudly instead of
 * silently attaching the wrong paper to a researcher.
 *
 *   npx tsx scripts/lpu-faculty/02b-import-workbook.ts [profiles.xlsx] [source.xlsx]
 */

import fs from 'fs'
import path from 'path'
import { parseTabularUpload } from '../../src/lib/spreadsheet/parseTabularUpload'
import type { AggregatedAuthor } from './01-aggregate'
import type { EnrichedAuthor } from './02-enrich'

const DEFAULT_PROFILES = String.raw`C:\Users\raman\Downloads\LPU_Researcher_Profiles.xlsx`
const DEFAULT_SOURCE = String.raw`C:\Users\raman\Downloads\First and Corresponding Authorship data from 1 Jan 2024 to 19 August 2026 DSR 20August2026.xlsx`
const AUTHORS_PATH = path.join(__dirname, 'data', '01-authors.json')
const OUT_PATH = path.join(__dirname, 'data', '02-enriched.json')

/** "Research Areas" and "Keywords" are comma-delimited per PROMPT.md. */
function splitList(value: string) {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

function normalizeTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

interface ParsedCell {
  sourceRow: number
  whySelected: string
  scopeNote: string
}

/**
 * Cell layout:
 *   [Row 2] "Title" — Journal
 *   Why selected: ...
 *   Scope note: ...
 */
function parsePublicationCell(cell: string): ParsedCell | null {
  const rowMatch = cell.match(/^\[Row (\d+)\]/)
  if (!rowMatch) return null
  const why = cell.match(/\n\s*Why selected:\s*([\s\S]*?)(?=\n\s*Scope note:|$)/)
  const scope = cell.match(/\n\s*Scope note:\s*([\s\S]*)$/)
  return {
    sourceRow: Number(rowMatch[1]),
    whySelected: (why?.[1] || '').trim(),
    scopeNote: (scope?.[1] || '').trim(),
  }
}

function main() {
  const profilesPath = process.argv[2] || DEFAULT_PROFILES
  const sourcePath = process.argv[3] || DEFAULT_SOURCE

  for (const file of [profilesPath, sourcePath, AUTHORS_PATH]) {
    if (!fs.existsSync(file)) {
      console.error('Not found: ' + file)
      process.exit(1)
    }
  }

  const profiles = parseTabularUpload(fs.readFileSync(profilesPath), path.basename(profilesPath))
  const source = parseTabularUpload(fs.readFileSync(sourcePath), path.basename(sourcePath))
  const authors: AggregatedAuthor[] = JSON.parse(fs.readFileSync(AUTHORS_PATH, 'utf8'))
  const authorByUid = new Map(authors.map((a) => [a.uid, a]))

  console.log('Profile rows: ' + profiles.rows.length + ' | source rows: ' + source.rows.length)

  const enriched: EnrichedAuthor[] = []
  const problems: string[] = []
  let publicationsKept = 0

  for (const row of profiles.rows) {
    const uid = (row.uid || '').trim()
    const author = authorByUid.get(uid)
    if (!author) {
      problems.push('UID ' + uid + ' is in the profile workbook but not in the source aggregation')
      continue
    }

    const influential: EnrichedAuthor['influentialPublications'] = []

    for (let slot = 1; slot <= 5; slot++) {
      // parseTabularUpload normalizes headers: "Influential Publication 1" -> influentialpublication1
      const cell = (row['influentialpublication' + slot] || '').trim()
      if (!cell) continue

      const parsed = parsePublicationCell(cell)
      if (!parsed) {
        problems.push(uid + ' slot ' + slot + ': no [Row N] reference')
        continue
      }

      // Sheet row 1 is the header, so sheet row N is data row N-2.
      const sourceRow = source.rows[parsed.sourceRow - 2]
      if (!sourceRow) {
        problems.push(uid + ' slot ' + slot + ': [Row ' + parsed.sourceRow + '] is out of range')
        continue
      }
      if ((sourceRow.uid || '').trim() !== uid) {
        problems.push(
          uid + ' slot ' + slot + ': [Row ' + parsed.sourceRow + '] belongs to UID ' + sourceRow.uid
        )
        continue
      }

      // The workbook quotes the title; confirm it against the source before trusting the reference.
      const quoted = cell.match(/^\[Row \d+\]\s*[""“”"](.+?)[""“”"]\s*[—–-]/s)?.[1]
      if (quoted && normalizeTitle(quoted) !== normalizeTitle(sourceRow.papertitle || '')) {
        problems.push(uid + ' slot ' + slot + ': quoted title does not match source row ' + parsed.sourceRow)
        continue
      }

      const match = author.publications.find(
        (p) => normalizeTitle(p.title) === normalizeTitle(sourceRow.papertitle || '')
      )

      influential.push({
        title: (sourceRow.papertitle || '').trim(),
        venue: (sourceRow.journalname || '').trim(),
        role: match?.role || 'UNKNOWN',
        scopeNote: parsed.scopeNote,
        whySelected: parsed.whySelected,
      })
      publicationsKept += 1
    }

    if (!influential.length) problems.push(uid + ': no usable influential publications')

    const areas = splitList(row.researchareas || '')
    if (areas.length < 2) problems.push(uid + ': only ' + areas.length + ' research area(s)')

    enriched.push({
      ...author, // true publicationCount, roleCounts, nameVariants, full publication list
      researchAreas: areas,
      primaryDiscipline: '',
      keywords: splitList(row.keywords || ''),
      researchSummary: (row.researchsummary || '').trim(),
      confidence: ((row.confidence || '').trim().toUpperCase() || 'LOW') as EnrichedAuthor['confidence'],
      influentialPublications: influential,
      derivedBy: 'external:LPU_Researcher_Profiles.xlsx',
    })
  }

  enriched.sort((a, b) => b.publicationCount - a.publicationCount || a.uid.localeCompare(b.uid))
  fs.writeFileSync(OUT_PATH, JSON.stringify(enriched, null, 2))

  console.log('Researchers imported:  ' + enriched.length)
  console.log('Publications imported: ' + publicationsKept)
  console.log('Problems:              ' + problems.length)
  problems.slice(0, 15).forEach((p) => console.log('  - ' + p))
  if (problems.length > 15) console.log('  ...and ' + (problems.length - 15) + ' more')
  console.log('\nWrote ' + OUT_PATH)
}

main()
