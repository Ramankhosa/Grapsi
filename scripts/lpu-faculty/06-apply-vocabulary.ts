/**
 * Step 6 — apply the approved canonical vocabulary to every researcher.
 *
 * Enrichment produced 1,857 distinct area labels, 1,512 of them used by exactly
 * one researcher — too fine for a broadly worded funding call to match. Falling
 * back on the HR faculty split is the opposite failure: it puts 117 researchers
 * under "Agriculture", so one call would recommend all of them.
 *
 * The approved vocabulary (239 labels, ~10.8 researchers each) sits between the
 * two. This maps every researcher onto it.
 *
 * Nothing derived is discarded. A researcher's original specific labels move
 * into `keywords`, where the precision they carry still counts toward matching —
 * research_areas gains recall, keywords keeps the sharpness.
 *
 *   npx tsx scripts/lpu-faculty/06-apply-vocabulary.ts --mapping=<file>
 *   npx tsx scripts/lpu-faculty/06-apply-vocabulary.ts --mapping=<file> --apply
 */

import fs from 'fs'
import path from 'path'
import { parseTabularUpload } from '../../src/lib/spreadsheet/parseTabularUpload'
import type { EnrichedAuthor } from './02-enrich'

const IN_PATH = path.join(__dirname, 'data', '02-enriched.json')
const BACKUP_PATH = path.join(__dirname, 'data', '02-enriched.pre-vocabulary.json')
const VOCAB_PATH = path.join(__dirname, 'data', '06-vocabulary.json')
/** Above this, a label is too broad to be a useful recommendation. */
const TOO_BROAD = 25

const args = process.argv.slice(2)
const flag = (name: string) => args.find((a) => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=')
const MAPPING_FILE = flag('mapping')
const APPLY = args.includes('--apply')

function main() {
  if (!MAPPING_FILE || !fs.existsSync(MAPPING_FILE)) {
    console.error('Pass --mapping=<completed vocabulary file>')
    process.exit(1)
  }

  const authors: EnrichedAuthor[] = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'))
  const vocabulary: string[] = JSON.parse(fs.readFileSync(VOCAB_PATH, 'utf8'))
  const allowed = new Map(vocabulary.map((v) => [v.toLowerCase(), v]))

  const sheet = parseTabularUpload(fs.readFileSync(MAPPING_FILE), path.basename(MAPPING_FILE))
  const mapping = new Map<string, string>()
  const rejected: string[] = []
  for (const row of sheet.rows) {
    const current = (row.currentlabel || '').trim()
    const canonical = (row.canonicallabel || '').trim()
    if (!current) continue
    // Anything outside the approved vocabulary is refused, not quietly accepted —
    // a single invented label would reintroduce the fragmentation being removed.
    const resolved = allowed.get(canonical.toLowerCase())
    if (resolved) mapping.set(current, resolved)
    else {
      rejected.push(current + ' -> ' + (canonical || '(blank)'))
      mapping.set(current, current)
    }
  }

  console.log('Mapping rows: ' + mapping.size + ' | rejected (kept as original): ' + rejected.length)
  rejected.slice(0, 10).forEach((r) => console.log('   ' + r))

  const unmapped = new Set<string>()
  const perLabel = new Map<string, Set<string>>()
  let areasBefore = 0
  let areasAfter = 0

  const next = authors.map((author) => {
    areasBefore += author.researchAreas.length
    const canonical: string[] = []
    for (const area of author.researchAreas) {
      const mapped = mapping.get(area)
      if (!mapped) unmapped.add(area)
      const value = mapped || area
      if (!canonical.includes(value)) canonical.push(value)
      if (!perLabel.has(value)) perLabel.set(value, new Set())
      perLabel.get(value)!.add(author.uid)
    }
    areasAfter += canonical.length

    // Specific labels are preserved as keywords rather than dropped.
    const keywords = [...author.keywords]
    const seen = new Set(keywords.map((k) => k.toLowerCase()))
    for (const area of author.researchAreas) {
      if (!canonical.some((c) => c.toLowerCase() === area.toLowerCase()) && !seen.has(area.toLowerCase())) {
        keywords.push(area)
        seen.add(area.toLowerCase())
      }
    }

    return { ...author, researchAreas: canonical, keywords }
  })

  if (unmapped.size) {
    console.log('\nWARNING ' + unmapped.size + ' label(s) had no mapping row and were left unchanged:')
    ;[...unmapped].slice(0, 10).forEach((u) => console.log('   ' + u))
  }

  const sizes = [...perLabel.entries()].map(([label, set]) => [label, set.size] as [string, number])
  const bucket = { '1': 0, '2-4': 0, '5-15': 0, '16-25': 0, '26+': 0 }
  sizes.forEach(([, n]) => {
    if (n === 1) bucket['1']++
    else if (n < 5) bucket['2-4']++
    else if (n < 16) bucket['5-15']++
    else if (n <= TOO_BROAD) bucket['16-25']++
    else bucket['26+']++
  })

  const kwBefore = authors.reduce((n, a) => n + a.keywords.length, 0)
  const kwAfter = next.reduce((n, a) => n + a.keywords.length, 0)

  console.log('\n--- RESULT ---')
  console.log('Distinct area labels : 1857 -> ' + perLabel.size)
  console.log('Area assignments     : ' + areasBefore + ' -> ' + areasAfter + ' (duplicates merged within a researcher)')
  console.log('Keywords             : ' + kwBefore + ' -> ' + kwAfter + ' (specific labels preserved)')
  console.log('Researchers per label: ' + JSON.stringify(bucket))
  console.log('Median label size    : ' + sizes.map(([, n]) => n).sort((a, b) => a - b)[Math.floor(sizes.length / 2)])

  console.log('\nLargest labels:')
  sizes.sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([label, n]) =>
    console.log('   ' + String(n).padStart(4) + '  ' + label + (n > TOO_BROAD ? '   <-- broad' : '')))
  console.log('\nSmallest labels: ' + sizes.filter(([, n]) => n === 1).length + ' used by a single researcher')

  if (APPLY) {
    if (!fs.existsSync(BACKUP_PATH)) {
      fs.copyFileSync(IN_PATH, BACKUP_PATH)
      console.log('\nBacked up pre-vocabulary profiles to ' + BACKUP_PATH)
    }
    fs.writeFileSync(IN_PATH, JSON.stringify(next, null, 2))
    console.log('Applied to ' + next.length + ' researchers.')
    console.log('Next: re-run 05-hr-merge.ts to regenerate the roster.')
  } else {
    console.log('\nDry run — nothing written. Re-run with --apply.')
  }
}

main()
