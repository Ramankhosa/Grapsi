/**
 * Step 1 — collapse the DSR authorship spreadsheet into one record per researcher.
 *
 * Input is a publication-per-row export (UID, Name, Paper Title, Journal Name,
 * Author Type); everything downstream needs it keyed by researcher instead.
 *
 * UID is the only safe identity: 29 names in the source map to more than one
 * UID ("Dr. Rajesh Kumar" is three different people) and 12 UIDs carry spelling
 * variants of one name, so grouping by name would both merge strangers and
 * split individuals.
 *
 *   npx tsx scripts/lpu-faculty/01-aggregate.ts "<path to .xlsx>"
 */

import fs from 'fs'
import path from 'path'
import { parseTabularUpload } from '../../src/lib/spreadsheet/parseTabularUpload'

const DEFAULT_INPUT = String.raw`C:\Users\raman\Downloads\First and Corresponding Authorship data from 1 Jan 2024 to 19 August 2026 DSR 20August2026.xlsx`
const OUT_PATH = path.join(__dirname, 'data', '01-authors.json')

/** Source values in the Author Type column, normalized to a stable key. */
type AuthorRole = 'FIRST_AND_CORRESPONDING' | 'CORRESPONDING' | 'FIRST' | 'UNKNOWN'

export interface AggregatedPublication {
  title: string
  venue: string
  role: AuthorRole
}

export interface AggregatedAuthor {
  uid: string
  /** Most frequent spelling of the name across this UID's rows. */
  name: string
  /** Every distinct spelling seen, so a reviewer can spot bad source data. */
  nameVariants: string[]
  publicationCount: number
  roleCounts: Record<AuthorRole, number>
  publications: AggregatedPublication[]
}

function normalizeRole(raw: string): AuthorRole {
  const value = raw.toLowerCase()
  const isFirst = value.includes('first')
  const isCorresponding = value.includes('corresponding')
  if (isFirst && isCorresponding) return 'FIRST_AND_CORRESPONDING'
  if (isCorresponding) return 'CORRESPONDING'
  if (isFirst) return 'FIRST'
  return 'UNKNOWN'
}

/** Title-level dedupe key — case and punctuation vary between duplicate rows. */
function titleKey(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function pickCanonicalName(counts: Map<string, number>) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0]
}

function main() {
  const input = process.argv[2] || DEFAULT_INPUT
  if (!fs.existsSync(input)) {
    console.error(`Input not found: ${input}`)
    process.exit(1)
  }

  const sheet = parseTabularUpload(fs.readFileSync(input), path.basename(input))
  console.log(`Headers: ${sheet.headers.join(' | ')}`)
  console.log(`Rows: ${sheet.rows.length}`)

  const byUid = new Map<string, AggregatedAuthor & { _names: Map<string, number>; _titles: Set<string> }>()
  let skipped = 0
  let duplicateTitles = 0

  for (const row of sheet.rows) {
    const uid = (row.uid || '').trim()
    const name = (row.name || '').trim()
    const title = (row.papertitle || '').trim()
    if (!uid || !name || !title) {
      skipped += 1
      continue
    }

    let author = byUid.get(uid)
    if (!author) {
      author = {
        uid,
        name,
        nameVariants: [],
        publicationCount: 0,
        roleCounts: { FIRST_AND_CORRESPONDING: 0, CORRESPONDING: 0, FIRST: 0, UNKNOWN: 0 },
        publications: [],
        _names: new Map(),
        _titles: new Set(),
      }
      byUid.set(uid, author)
    }

    author._names.set(name, (author._names.get(name) || 0) + 1)

    const key = titleKey(title)
    if (author._titles.has(key)) {
      duplicateTitles += 1
      continue
    }
    author._titles.add(key)

    const role = normalizeRole((row.authortype || '').trim())
    author.roleCounts[role] += 1
    author.publications.push({ title, venue: (row.journalname || '').trim(), role })
  }

  const authors: AggregatedAuthor[] = [...byUid.values()]
    .map(({ _names, _titles, ...rest }) => ({
      ...rest,
      name: pickCanonicalName(_names),
      nameVariants: [..._names.keys()],
      publicationCount: rest.publications.length,
    }))
    .sort((a, b) => b.publicationCount - a.publicationCount || a.uid.localeCompare(b.uid))

  fs.writeFileSync(OUT_PATH, JSON.stringify(authors, null, 2))

  const multiName = authors.filter((a) => a.nameVariants.length > 1)
  console.log(`\nAuthors: ${authors.length}`)
  console.log(`Publications kept: ${authors.reduce((n, a) => n + a.publicationCount, 0)}`)
  console.log(`Duplicate titles collapsed: ${duplicateTitles}`)
  console.log(`Rows skipped (missing uid/name/title): ${skipped}`)
  console.log(`UIDs with more than one name spelling: ${multiName.length}`)
  console.log(`\nWrote ${OUT_PATH}`)
}

main()
