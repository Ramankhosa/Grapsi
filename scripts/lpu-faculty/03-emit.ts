/**
 * Step 3 — turn enriched profiles into the files that actually get loaded.
 *
 * Emits three artefacts into scripts/lpu-faculty/out/:
 *
 *   lpu-faculty-roster.csv        Columns match FACULTY_IMPORT_TEMPLATE_HEADERS, so this
 *                                 goes straight through the existing, tested importer at
 *                                 /tenant-admin/faculty. Email / School / Department are
 *                                 left blank on purpose — those come from HR, keyed on
 *                                 Employee ID, and the import will reject rows without an
 *                                 email rather than invent one.
 *
 *   lpu-influential-publications.json
 *                                 The per-researcher publication shortlist for step 4.
 *                                 The importer has no publication column, so these are
 *                                 seeded separately into reference_library.
 *
 *   lpu-profile-review.csv        Flat one-row-per-researcher sheet for eyeballing the
 *                                 derived areas before anything is written to a database.
 *
 *   npx tsx scripts/lpu-faculty/03-emit.ts
 */

import fs from 'fs'
import path from 'path'
import type { EnrichedAuthor } from './02-enrich'

const IN_PATH = path.join(__dirname, 'data', '02-enriched.json')
const OUT_DIR = path.join(__dirname, 'out')
const SOURCE_FILE = 'First and Corresponding Authorship data from 1 Jan 2024 to 19 August 2026 DSR 20August2026.xlsx'

/**
 * Provenance carried on every synthesized abstract. The source spreadsheet has no
 * abstracts; these were inferred from title + venue. Stored on the row itself so a
 * reader of the database — not just a reader of this script — can tell.
 */
const SYNTHETIC_TAG = 'synthetic-abstract'
const SYNTHETIC_NOTE =
  'Scope note inferred from the paper title and journal name by claude-opus-5 during the DSR roster seed. ' +
  'This is NOT the published abstract and must not be quoted as one.'

/** facultyImportService splits multi-value cells on [;,|] — see MULTI_VALUE_SEPARATOR. */
const MULTI_VALUE_JOIN = '; '

/** Strip separator characters out of individual values so the importer cannot split one in half. */
function sanitizeMultiValue(values: string[]) {
  return values
    .map((v) => v.replace(/[;,|]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(MULTI_VALUE_JOIN)
}

function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}

function csvFile(headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  // BOM so Excel opens the UTF-8 researcher names correctly.
  return '﻿' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

function main() {
  const authors: EnrichedAuthor[] = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'))
  fs.mkdirSync(OUT_DIR, { recursive: true })

  // --- Roster: importer-ready ------------------------------------------------
  // Header order and spelling must stay aligned with FACULTY_IMPORT_TEMPLATE_HEADERS.
  const rosterHeaders = [
    'Name',
    'Email',
    'Employee ID',
    'Unit Path',
    'School',
    'Department',
    'Designation',
    'Research Areas',
    'Keywords',
    'Research Summary',
    'Role',
    'Head Of',
    'Head Title',
    'Head Scope',
  ]

  const rosterRows = authors.map((a) => [
    a.name,
    '', // Email — supplied from HR, keyed on Employee ID
    a.uid,
    '', // Unit Path — supplied from HR
    '', // School — supplied from HR
    '', // Department — supplied from HR
    '', // Designation — not present in the authorship export
    sanitizeMultiValue(a.researchAreas),
    sanitizeMultiValue(a.keywords),
    a.researchSummary,
    '', // Role — blank so the importer applies its ANALYST default
    '',
    '',
    '',
  ])

  fs.writeFileSync(path.join(OUT_DIR, 'lpu-faculty-roster.csv'), csvFile(rosterHeaders, rosterRows), 'utf8')

  // --- Publications: for step 4 ----------------------------------------------
  const publications = {
    generatedAt: new Date().toISOString(),
    provenance: {
      source: SOURCE_FILE,
      coverage: 'First and/or corresponding authorship, 1 Jan 2024 – 19 Aug 2026',
      derivedBy: authors[0]?.derivedBy || 'claude-opus-5',
      abstractsAreSynthetic: true,
      abstractDisclaimer: SYNTHETIC_NOTE,
      // The export carries no publication dates, so year is deliberately null
      // rather than a fabricated value inside the 2024–2026 window.
      yearAvailable: false,
    },
    researchers: authors.map((a) => ({
      employeeId: a.uid,
      name: a.name,
      confidence: a.confidence,
      totalPublicationsOnRecord: a.publicationCount,
      publications: a.influentialPublications.map((p) => ({
        title: p.title,
        venue: p.venue || null,
        year: null,
        authorRole: p.role,
        abstract: p.scopeNote,
        abstractIsSynthetic: true,
        selectionRationale: p.whySelected,
        tags: ['my-publication', SYNTHETIC_TAG],
        notes: SYNTHETIC_NOTE,
      })),
    })),
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'lpu-influential-publications.json'),
    JSON.stringify(publications, null, 2),
    'utf8'
  )

  // --- Review sheet ----------------------------------------------------------
  const reviewHeaders = [
    'Employee ID',
    'Name',
    'Name Variants',
    'Papers On Record',
    'Confidence',
    'Primary Discipline',
    'Research Areas',
    'Keywords',
    'Research Summary',
    'Influential Papers Selected',
    'Top Paper',
    'Top Venue',
  ]

  const reviewRows = authors.map((a) => [
    a.uid,
    a.name,
    a.nameVariants.length > 1 ? a.nameVariants.join(' | ') : '',
    a.publicationCount,
    a.confidence,
    a.primaryDiscipline,
    a.researchAreas.join(' | '),
    a.keywords.join(' | '),
    a.researchSummary,
    a.influentialPublications.length,
    a.influentialPublications[0]?.title || '',
    a.influentialPublications[0]?.venue || '',
  ])

  fs.writeFileSync(path.join(OUT_DIR, 'lpu-profile-review.csv'), csvFile(reviewHeaders, reviewRows), 'utf8')

  // --- Summary ---------------------------------------------------------------
  const byConfidence = authors.reduce<Record<string, number>>((acc, a) => {
    acc[a.confidence] = (acc[a.confidence] || 0) + 1
    return acc
  }, {})
  const totalPubs = authors.reduce((n, a) => n + a.influentialPublications.length, 0)
  const areaCounts = new Map<string, number>()
  authors.forEach((a) => a.researchAreas.forEach((r) => areaCounts.set(r, (areaCounts.get(r) || 0) + 1)))

  console.log('Researchers:        ' + authors.length)
  console.log('Confidence:         ' + JSON.stringify(byConfidence))
  console.log('Influential papers: ' + totalPubs + ' (avg ' + (totalPubs / authors.length).toFixed(1) + ' per researcher)')
  console.log('Distinct areas:     ' + areaCounts.size)
  console.log('\nMost common areas:')
  ;[...areaCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([area, n]) => console.log('  ' + String(n).padStart(4) + '  ' + area))
  console.log('\nWrote 3 files to ' + OUT_DIR)
}

main()
