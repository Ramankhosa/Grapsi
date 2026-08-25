/**
 * Step 5 — merge the HR faculty record into the derived research profiles.
 *
 * Input is LPU_Researcher_Profiles_Combined.xlsx: the derived profile columns
 * plus an HR join. Only a few HR columns are carried into the seed.
 *
 * Org placement uses ParentDiscipline > ParentDomain (33 -> 107 units), not
 * School_Division or CurrentDomain. School_Division carries the real LPU school
 * names but mixes in non-academic units ("Division of Academic Affairs"), and
 * CurrentDomain has 193 inconsistent values ("ECE", "Department of ..."). The
 * ParentDiscipline/ParentDomain pair is the one clean, complete two-level split.
 *
 * Dropped as irrelevant to funding matching: EmployeeName, StaffType,
 * SubStaffTeachingType, AdministrativeDesignation, CurrentDomain,
 * School_Division, DOJ, ContractDate, PhdStatus, Full Time/Part Time.
 *
 *   npx tsx scripts/lpu-faculty/05-hr-merge.ts --template
 *   npx tsx scripts/lpu-faculty/05-hr-merge.ts --hr=<combined workbook>
 *   npx tsx scripts/lpu-faculty/05-hr-merge.ts --hr=<file> --include-left --heads
 */

import fs from 'fs'
import path from 'path'
import { parseTabularUpload } from '../../src/lib/spreadsheet/parseTabularUpload'
import type { EnrichedAuthor } from './02-enrich'

const IN_PATH = path.join(__dirname, 'data', '02-enriched.json')
const OUT_DIR = path.join(__dirname, 'out')
const TEMPLATE_PATH = path.join(OUT_DIR, 'lpu-hr-fill-template.csv')
const FINAL_ROSTER_PATH = path.join(OUT_DIR, 'lpu-faculty-roster-final.csv')
const EMAIL_GAP_PATH = path.join(OUT_DIR, 'lpu-email-still-needed.csv')

const INSTITUTION_NAME = 'Lovely Professional University'
const INSTITUTION_TYPE = 'University'
const COUNTRY = 'India'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** HR uses "-" as its null marker. */
const NULLISH = new Set(['', '-', 'none', 'null', 'n/a'])

const args = process.argv.slice(2)
const flag = (name: string) => args.find((a) => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=')
const INCLUDE_LEFT = args.includes('--include-left')
const WITH_HEADS = args.includes('--heads')
/** Domain for derived addresses, e.g. --derive-emails=lpu.co.in. Off unless passed. */
const EMAIL_DOMAIN = flag('derive-emails')
/**
 * 'uid'  -> 21975@lpu.co.in   (default: unique by construction, no collisions)
 * 'name' -> prince.chawla@lpu.co.in, employee ID appended where names collide
 */
const EMAIL_FROM = (flag('email-from') || 'uid') as 'uid' | 'name'

const TITLE_PREFIX = /^(dr|prof|mr|mrs|ms|shri|smt)\.?\s*/i

/**
 * "Dr. Prince Chawla" -> "prince.chawla". Strips honorifics and anything that is
 * not a letter, so accents and punctuation cannot leak into an address.
 */
function emailLocalPart(name: string) {
  let value = String(name).trim()
  while (TITLE_PREFIX.test(value)) value = value.replace(TITLE_PREFIX, '')
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s.]/g, ' ')
    .trim()
    .split(/[\s.]+/)
    .filter(Boolean)
    .join('.')
}

/**
 * Derived addresses are a fallback, not a source of truth. Where two people
 * reduce to the same local part the employee ID is appended rather than letting
 * one person silently claim another's address — a collision here would hand one
 * researcher's funding alerts to a different researcher.
 */
function deriveEmails(people: Array<{ uid: string; name: string }>, domain: string) {
  if (EMAIL_FROM === 'uid') {
    // Employee ID is already unique per tenant, so this cannot collide and can
    // never accidentally route to a real person's mailbox. Placeholder only —
    // swap in real addresses before enabling any outbound mail.
    return new Map(people.map((p) => [p.uid, { email: p.uid + '@' + domain, collided: false }]))
  }
  const byLocal = new Map<string, string[]>()
  for (const person of people) {
    const local = emailLocalPart(person.name)
    if (!byLocal.has(local)) byLocal.set(local, [])
    byLocal.get(local)!.push(person.uid)
  }
  const emails = new Map<string, { email: string; collided: boolean }>()
  for (const person of people) {
    const local = emailLocalPart(person.name)
    const collided = (byLocal.get(local) || []).length > 1
    const finalLocal = collided ? local + '.' + person.uid : local
    emails.set(person.uid, { email: finalLocal + '@' + domain, collided })
  }
  return emails
}

function clean(value: unknown) {
  const text = String(value ?? '').trim()
  return NULLISH.has(text.toLowerCase()) ? '' : text
}

function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}

function csvFile(headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  return '﻿' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** facultyImportService splits multi-value cells on [;,|]; keep values free of those. */
function sanitizeMultiValue(values: string[]) {
  return values
    .map((v) => v.replace(/[;,|]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('; ')
}

/**
 * Academic rank is the only career-stage signal in the HR record. Values come
 * from RECOMMENDATION_CAREER_STAGE_OPTIONS so funding eligibility filters match.
 */
function careerStageFromRank(rank: string) {
  const value = rank.toLowerCase()
  if (!value) return ''
  if (value.includes('assistant professor')) return 'Early Career Faculty'
  if (value.includes('associate professor')) return 'Mid Career Researcher'
  if (value.includes('professor')) return 'Senior Researcher'
  if (value.includes('dean')) return 'Senior Researcher'
  return ''
}

/**
 * "HOD/COD: Mathematics" makes someone head of a unit. Only honoured when the
 * named unit is the person's own ParentDomain — a title naming some other unit
 * cannot be resolved to a path safely, so it is reported rather than guessed.
 */
function headOfFromAuthority(authority: string, parentDomain: string) {
  if (!authority || !parentDomain) return { headOf: '', headTitle: '', ambiguous: false }
  const titles = authority.split(',').map((t) => t.trim()).filter(Boolean)
  for (const title of titles) {
    const named = title.replace(/^HOD\/COD:\s*/i, '').trim()
    if (named && named.toLowerCase() === parentDomain.toLowerCase()) {
      return { headOf: 'self', headTitle: 'Head of Department', ambiguous: false }
    }
  }
  return { headOf: '', headTitle: '', ambiguous: true }
}

const TEMPLATE_HEADERS = [
  'Employee ID',
  'Name',
  'Papers On Record',
  'Confidence',
  'Derived Areas (context only)',
  'School (ParentDiscipline)',
  'Department (ParentDomain)',
  'Designation',
  'Email',
]

function writeTemplate(authors: EnrichedAuthor[]) {
  const rows = authors.map((a) => [
    a.uid,
    a.name,
    a.publicationCount,
    a.confidence,
    a.researchAreas.slice(0, 3).join(' | '),
    '',
    '',
    '',
    '',
  ])
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(TEMPLATE_PATH, csvFile(TEMPLATE_HEADERS, rows), 'utf8')
  console.log('Wrote template for ' + authors.length + ' researchers:\n  ' + TEMPLATE_PATH)
}

function mergeHr(authors: EnrichedAuthor[], hrPath: string) {
  const hr = parseTabularUpload(fs.readFileSync(hrPath), path.basename(hrPath))
  console.log('HR file: ' + hr.rows.length + ' rows')

  const hrByUid = new Map<string, Record<string, string>>()
  for (const row of hr.rows) {
    const uid = clean(row.employeeid || row.uid)
    if (uid) hrByUid.set(uid, row)
  }

  const rows: Array<Array<string | number | null | undefined>> = []
  const emailGap: Array<Array<string | number | null | undefined>> = []
  const stats = {
    excludedLeft: 0,
    noHrRecord: 0,
    placed: 0,
    withDesignation: 0,
    withCareerStage: 0,
    heads: 0,
    ambiguousHead: 0,
    withEmail: 0,
  }

  const survivors = authors.filter((a) => {
    const status = clean(hrByUid.get(a.uid)?.staffstatus)
    return INCLUDE_LEFT || status !== 'Left'
  })
  const derived = EMAIL_DOMAIN ? deriveEmails(survivors, EMAIL_DOMAIN) : new Map()
  let derivedUsed = 0
  let derivedCollisions = 0

  for (const author of authors) {
    const row = hrByUid.get(author.uid)
    const staffStatus = clean(row?.staffstatus)
    const matched = clean(row?.facultyrecordmatch).toLowerCase() === 'matched'

    if (staffStatus === 'Left' && !INCLUDE_LEFT) {
      stats.excludedLeft += 1
      continue
    }
    if (!matched) stats.noHrRecord += 1

    const school = clean(row?.parentdiscipline)
    const department = clean(row?.parentdomain)
    const designation = clean(row?.designation)
    const careerStage = careerStageFromRank(clean(row?.academicdesignation) || designation)
    const hrEmail = clean(row?.email).toLowerCase()
    const fallback = derived.get(author.uid)
    if (!hrEmail && fallback) {
      derivedUsed += 1
      if (fallback.collided) derivedCollisions += 1
    }
    const email = hrEmail || fallback?.email || ''

    if (school || department) stats.placed += 1
    if (designation) stats.withDesignation += 1
    if (careerStage) stats.withCareerStage += 1
    if (email && EMAIL_PATTERN.test(email)) stats.withEmail += 1
    else emailGap.push([author.uid, author.name, school, department, designation, ''])

    let headOf = ''
    let headTitle = ''
    if (WITH_HEADS) {
      const head = headOfFromAuthority(clean(row?.staffauthority), department)
      headOf = head.headOf
      headTitle = head.headTitle
      if (head.headOf) stats.heads += 1
      else if (head.ambiguous) stats.ambiguousHead += 1
    }

    rows.push([
      author.name,
      email,
      author.uid,
      '', // Unit Path — School/Department are used instead
      school,
      department,
      designation,
      sanitizeMultiValue(author.researchAreas),
      sanitizeMultiValue(author.keywords),
      author.researchSummary,
      careerStage,
      INSTITUTION_NAME,
      INSTITUTION_TYPE,
      COUNTRY,
      headOf,
      headTitle,
      '', // Head Scope — defaults to SUBTREE
    ])
  }

  const headers = [
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
    'Career Stage',
    'Institution',
    'Institution Type',
    'Country',
    // No Role column on purpose. facultyImportService only rewrites an existing
    // user's roles when the column is PRESENT (applyRole = hasColumn('role')...),
    // and every value here would be blank anyway. Omitting it means the import
    // physically cannot demote a member the tenant already has, while new users
    // still get the ANALYST default.
    'Head Of',
    'Head Title',
    'Head Scope',
  ]

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(FINAL_ROSTER_PATH, csvFile(headers, rows), 'utf8')
  fs.writeFileSync(
    EMAIL_GAP_PATH,
    csvFile(['Employee ID', 'Name', 'School', 'Department', 'Designation', 'Email'], emailGap),
    'utf8'
  )

  const units = new Set(rows.filter((r) => r[4] || r[5]).map((r) => r[4] + ' > ' + r[5]))

  console.log('\nRoster rows written:           ' + rows.length)
  console.log('Excluded (StaffStatus=Left):   ' + stats.excludedLeft + (INCLUDE_LEFT ? ' (kept: --include-left)' : ''))
  console.log('No HR record (unplaced):       ' + stats.noHrRecord)
  console.log('Placed in org tree:            ' + stats.placed + ' across ' + units.size + ' units')
  console.log('With designation:              ' + stats.withDesignation)
  console.log('With career stage:             ' + stats.withCareerStage)
  if (WITH_HEADS) {
    console.log('Unit heads set (self):         ' + stats.heads)
    console.log('HOD titles naming other units: ' + stats.ambiguousHead + ' (skipped, not guessed)')
  }
  console.log('\nWith a valid email:            ' + stats.withEmail + '  <-- importable')
  console.log('MISSING an email:              ' + emailGap.length + '  <-- these rows will be REJECTED')
  console.log('\nWrote ' + FINAL_ROSTER_PATH)
  console.log('Wrote ' + EMAIL_GAP_PATH + ' (fill the Email column and re-run)')
}

function main() {
  const authors: EnrichedAuthor[] = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'))
  const hrPath = flag('hr')
  if (hrPath) {
    if (!fs.existsSync(hrPath)) {
      console.error('HR file not found: ' + hrPath)
      process.exit(1)
    }
    mergeHr(authors, hrPath)
  } else {
    writeTemplate(authors)
  }
}

main()
