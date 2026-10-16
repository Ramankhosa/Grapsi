/**
 * Versioned crosswalks from a source's vocabulary to Grapsi's controlled lists.
 *
 * Kept as CSVs in Seed/crosswalks/ so a curator can review and correct every
 * mapping without touching code. Each file's content hash is its version: it
 * is recorded on the import run and folded into every record's change hash,
 * so editing a crosswalk re-processes the records it affects.
 *
 * Research areas are referenced by CODE (e.g. MED.01, or MED for the whole
 * group), never by row id, so re-seeding the research-area catalogue does not
 * orphan the crosswalk.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { matchKey } from './normalize/text'

export interface CrosswalkTable {
  file: string
  version: string
  rows: Map<string, Record<string, string>>
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        current += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      cells.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current)
  return cells.map((cell) => cell.trim())
}

export function loadCrosswalk(file: string, baseDir = path.resolve(process.cwd(), 'Seed/crosswalks')): CrosswalkTable {
  const fullPath = path.isAbsolute(file) ? file : path.join(baseDir, file)
  const content = fs.readFileSync(fullPath, 'utf8')
  const lines = content.split(/\r?\n/).filter((line) => line.trim())
  const header = parseCsvLine(lines[0])
  const rows = new Map<string, Record<string, string>>()
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line)
    const record: Record<string, string> = {}
    header.forEach((name, index) => {
      record[name] = cells[index] ?? ''
    })
    if (record.source_value) rows.set(matchKey(record.source_value), record)
  }
  return {
    file: path.basename(fullPath),
    version: crypto.createHash('sha256').update(content).digest('hex').slice(0, 12),
    rows,
  }
}

export function splitList(value: string | undefined): string[] {
  return String(value || '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
}

export interface ScientifyCrosswalks {
  disciplines: CrosswalkTable
  subjects: CrosswalkTable
  careerStages: CrosswalkTable
  grantTypes: CrosswalkTable
  fundingSources: CrosswalkTable
  regions: CrosswalkTable
}

export function loadScientifyCrosswalks(baseDir?: string): ScientifyCrosswalks {
  return {
    disciplines: loadCrosswalk('scientify-disciplines.csv', baseDir),
    subjects: loadCrosswalk('scientify-subjects.csv', baseDir),
    careerStages: loadCrosswalk('scientify-career-stages.csv', baseDir),
    grantTypes: loadCrosswalk('scientify-grant-types.csv', baseDir),
    fundingSources: loadCrosswalk('scientify-funding-sources.csv', baseDir),
    regions: loadCrosswalk('scientify-regions.csv', baseDir),
  }
}

export function crosswalkVersions(crosswalks: object): Record<string, string> {
  const out: Record<string, string> = {}
  for (const table of Object.values(crosswalks) as CrosswalkTable[]) out[table.file] = table.version
  return out
}

/** Looks a source label up; `undefined` means the label is not in the crosswalk at all. */
export function lookup(table: CrosswalkTable, label: string): Record<string, string> | undefined {
  return table.rows.get(matchKey(label))
}
