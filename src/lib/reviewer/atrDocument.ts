// Action Taken Report (ATR) — the Word deliverable a researcher fills in and
// forwards. Built for reading order, not data order:
//
//   cover + verdict → how to use → contents (hyperlinked)
//   1. At a glance (scorecards)      2. What to fix first (the worksheet)
//   3. Panel assessment              4. Section by section (worksheets)
//   5. Research & patent landscape   Appendix: how this report was produced
//
// Everything here is deterministic rendering of the stored report; nothing is
// generated. Pages-router safe (no `server-only`).

import {
  AlignmentType,
  BorderStyle,
  Bookmark,
  Document,
  Footer,
  Header,
  HeadingLevel,
  InternalHyperlink,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx'

import { compareSections } from '@/lib/reviewer/sectionGrouping'

export type AtrSectionInput = {
  id: string
  section_title: string
  version: number
  review: Record<string, any>
}

export type AtrDocumentInput = {
  projectTitle: string
  agencyName?: string | null
  callTitle?: string | null
  generatedAt?: string | null
  staleNotice?: string | null
  overall: Record<string, any>
  sections: AtrSectionInput[]
}

// ---------------------------------------------------------------------------
// Palette and type scale (half-points for sizes, hex without # for colours)

const FONT = 'Calibri'
const INK = '1F2937'
const MUTED = '6B7280'
const BRAND = '1F4E79'
const BRAND_SOFT = '2E75B6'
const RULE = 'B4C6E7'
const HEADER_FILL = 'D0E2F5'
const ALT_FILL = 'F5F9FC'
const NOTE_FILL = 'F3F6FA'
const WORKSHEET_FILL = 'FFFBEA'

const SCORE_BANDS = {
  strong: { fill: 'E2F0D9', text: '375623' },
  adequate: { fill: 'FFF2CC', text: '7F6000' },
  weak: { fill: 'F8D7DA', text: '842029' },
  none: { fill: 'EDEFF2', text: MUTED },
}

const DECISION_LABELS: Record<string, string> = {
  fund: 'Fund',
  fund_with_revisions: 'Fund with revisions',
  revise_and_resubmit: 'Revise and resubmit',
  do_not_fund: 'Do not fund',
}
const DECISION_BANDS: Record<string, keyof typeof SCORE_BANDS> = {
  fund: 'strong',
  fund_with_revisions: 'strong',
  revise_and_resubmit: 'adequate',
  do_not_fund: 'weak',
}
const COMPETITIVENESS_LABELS: Record<string, string> = {
  top_tier: 'Top tier',
  competitive: 'Competitive',
  borderline: 'Borderline',
  not_competitive: 'Not competitive',
}
const NOVELTY_LABELS: Record<string, string> = {
  generic: 'Generic',
  incremental: 'Incremental',
  differentiated: 'Differentiated',
  novel_within_evidence: 'Novel within available evidence',
}
const NOVELTY_BANDS: Record<string, keyof typeof SCORE_BANDS> = {
  generic: 'weak',
  incremental: 'adequate',
  differentiated: 'strong',
  novel_within_evidence: 'strong',
}

// ---------------------------------------------------------------------------
// Small helpers

function text(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'object') return JSON.stringify(value)
  const out = String(value).replace(/\s+/g, ' ').trim()
  return out || fallback
}

function list(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).map((item) => text(item)).filter(Boolean)
}

function scoreBand(score: unknown): keyof typeof SCORE_BANDS {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'none'
  if (score >= 7) return 'strong'
  if (score >= 5) return 'adequate'
  return 'weak'
}

function scoreLabel(score: unknown): string {
  return typeof score === 'number' && Number.isFinite(score) ? score.toFixed(1) : '—'
}

function deltaLabel(review: Record<string, any>): string {
  const delta = review?.score_delta
  if (typeof delta !== 'number' || !Number.isFinite(delta)) return ''
  if (delta === 0) return 'no change'
  return `${delta > 0 ? '▲ +' : '▼ '}${delta.toFixed(1)}`
}

/** Clip at a word boundary with an ellipsis, never mid-word. */
function clip(value: string, max: number): string {
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  const boundary = cut.lastIndexOf(' ')
  return `${(boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x'
}

function formatDate(value?: string | null): string {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function run(value: string, options: Partial<ConstructorParameters<typeof TextRun>[0] & object> = {}) {
  return new TextRun({ text: value, font: FONT, size: 22, color: INK, ...(options as object) })
}

function para(children: TextRun[] | string, options: Record<string, any> = {}) {
  return new Paragraph({
    children: typeof children === 'string' ? [run(children)] : children,
    spacing: { after: 120 },
    ...options,
  })
}

function spacer(after = 160) {
  return new Paragraph({ children: [run('')], spacing: { after } })
}

function note(value: string, fill = NOTE_FILL) {
  return new Paragraph({
    children: [run(value, { size: 20, color: '374151' })],
    spacing: { before: 80, after: 160 },
    shading: { fill, type: ShadingType.CLEAR },
    indent: { left: 120, right: 120 },
  })
}

function muted(value: string) {
  return para([run(value, { size: 19, color: MUTED })], { spacing: { after: 100 } })
}

function heading(value: string, level: 1 | 2, bookmarkId?: string) {
  const textRun = run(value, {
    bold: true,
    size: level === 1 ? 32 : 26,
    color: level === 1 ? BRAND : BRAND_SOFT,
  })
  return new Paragraph({
    children: bookmarkId ? [new Bookmark({ id: bookmarkId, children: [textRun] })] : [textRun],
    heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
    spacing: level === 1 ? { before: 360, after: 160 } : { before: 240, after: 120 },
    keepNext: true,
    ...(level === 1 ? { pageBreakBefore: true } : {}),
  })
}

function link(label: string, anchor: string, size = 20) {
  return new InternalHyperlink({
    anchor,
    children: [run(label, { size, color: BRAND_SOFT, underline: {} })],
  })
}

function backToContents() {
  return new Paragraph({ children: [link('↑ Back to contents', 'contents', 18)], spacing: { before: 60, after: 200 } })
}

type CellSpec = {
  value: string | Paragraph[]
  fill?: string
  color?: string
  bold?: boolean
  align?: (typeof AlignmentType)[keyof typeof AlignmentType]
  width?: number
  rowSpan?: number
  size?: number
}

function cell(spec: CellSpec): TableCell {
  const children = Array.isArray(spec.value)
    ? spec.value
    : [new Paragraph({
        children: [run(spec.value || ' ', { bold: spec.bold, color: spec.color || INK, size: spec.size || 20 })],
        alignment: spec.align,
        spacing: { after: 0 },
      })]
  return new TableCell({
    children,
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    ...(spec.width ? { width: { size: spec.width, type: WidthType.PERCENTAGE } } : {}),
    ...(spec.fill ? { shading: { fill: spec.fill, type: ShadingType.CLEAR } } : {}),
    ...(spec.rowSpan ? { rowSpan: spec.rowSpan } : {}),
  })
}

function tableBorders() {
  const side = { style: BorderStyle.SINGLE, size: 2, color: RULE }
  return { top: side, bottom: side, left: side, right: side, insideHorizontal: side, insideVertical: side }
}

/** Header row + body rows; body rows accept strings or cell specs per column. */
function grid(headers: string[], widths: number[], rows: Array<Array<string | CellSpec>>): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: headers.map((label, index) => cell({
      value: label, fill: HEADER_FILL, bold: true, width: widths[index], color: BRAND, size: 19,
    })),
  })
  const bodyRows = rows.map((row, rowIndex) => new TableRow({
    cantSplit: true,
    children: row.map((value, index) => {
      const spec: CellSpec = typeof value === 'string' ? { value } : value
      return cell({
        width: widths[index],
        ...(rowIndex % 2 === 1 && !spec.fill ? { fill: ALT_FILL } : {}),
        ...spec,
      })
    }),
  }))
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: tableBorders(), rows: [headerRow, ...bodyRows] })
}

function scoreCell(score: unknown, extra = ''): CellSpec {
  const band = SCORE_BANDS[scoreBand(score)]
  return { value: `${scoreLabel(score)}${extra ? ` ${extra}` : ''}`, fill: band.fill, color: band.text, bold: true, align: AlignmentType.CENTER }
}

function bandCell(value: string, band: keyof typeof SCORE_BANDS): CellSpec {
  return { value, fill: SCORE_BANDS[band].fill, color: SCORE_BANDS[band].text, bold: true, align: AlignmentType.CENTER }
}

function bullets(items: string[], size = 20) {
  return items.map((item) => new Paragraph({
    children: [run(item, { size })],
    bullet: { level: 0 },
    spacing: { after: 60 },
  }))
}

function numbered(items: string[]): Paragraph[] {
  return items.map((item, index) => new Paragraph({ children: [run(`${index + 1}. ${item}`, { size: 20 })], spacing: { after: 80 } }))
}

/**
 * The ATR worksheet idiom: weaknesses (one merged cell) → recommendations
 * (one row each) → an empty "Action taken" column for the researcher.
 */
function worksheet(weaknesses: string[], recommendations: string[], label = 'Weaknesses'): Table {
  const widths = [30, 38, 32]
  const headers = [label, 'Recommendations', 'Action taken (your remarks)']
  const weaknessCell = (rowSpan: number): CellSpec => ({
    value: weaknesses.length ? numbered(weaknesses) : [para('No weaknesses recorded.')],
    width: widths[0],
    ...(rowSpan > 1 ? { rowSpan } : {}),
  })
  const rows: Array<Array<string | CellSpec>> = recommendations.length
    ? recommendations.map((recommendation, index) => [
        ...(index === 0 ? [weaknessCell(recommendations.length)] : []),
        { value: `${index + 1}. ${recommendation}`, width: widths[1] },
        { value: ' ', width: widths[2], fill: WORKSHEET_FILL },
      ])
    : [[weaknessCell(1), { value: 'No specific recommendations provided.', width: widths[1] }, { value: ' ', width: widths[2], fill: WORKSHEET_FILL }]]

  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: headers.map((label, index) => cell({ value: label, fill: HEADER_FILL, bold: true, width: widths[index], color: BRAND, size: 19 })),
  })
  const bodyRows = rows.map((row) => new TableRow({
    cantSplit: true,
    children: row.map((value) => cell(typeof value === 'string' ? { value } : value)),
  }))
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: tableBorders(), rows: [headerRow, ...bodyRows] })
}

// ---------------------------------------------------------------------------
// Document

export async function buildAtrDocument(input: AtrDocumentInput): Promise<Buffer> {
  const overall = input.overall || {}
  const sections = [...input.sections].sort(compareSections as any)
  const sectionAnchor = (section: AtrSectionInput) => `sec-${slug(section.section_title)}-v${section.version}`
  const anchorByTitle = new Map(sections.map((section) => [section.section_title.trim().toLowerCase(), sectionAnchor(section)]))
  const linkToSection = (title: string, size = 20) => {
    const anchor = anchorByTitle.get(String(title || '').trim().toLowerCase())
    return anchor ? link(title, anchor, size) : run(title, { size })
  }

  const children: Array<Paragraph | Table> = []
  const generated = formatDate(input.generatedAt || overall.generated_at)

  // --- Stale banner -------------------------------------------------------
  if (input.staleNotice) {
    children.push(new Paragraph({
      children: [run('OUT OF DATE — ', { bold: true, color: '9C2C2C' }), run(input.staleNotice, { color: '9C2C2C' })],
      spacing: { before: 120, after: 200 },
      shading: { fill: 'FDECEC', type: ShadingType.CLEAR },
    }))
  }

  // --- Cover block --------------------------------------------------------
  children.push(new Paragraph({
    children: [run('Action Taken Report', { bold: true, size: 40, color: BRAND })],
    alignment: AlignmentType.LEFT,
    spacing: { before: 240, after: 60 },
  }))
  children.push(new Paragraph({
    children: [run(input.projectTitle || 'Untitled proposal', { size: 28, color: INK })],
    spacing: { after: 80 },
  }))
  const metaBits = [
    input.agencyName ? `Agency: ${input.agencyName}` : null,
    input.callTitle && input.callTitle !== input.projectTitle ? `Call: ${input.callTitle}` : null,
    generated ? `Generated: ${generated}` : null,
  ].filter(Boolean) as string[]
  if (metaBits.length) children.push(muted(metaBits.join('   ·   ')))

  const recommendation = overall.funding_recommendation || null
  const decision = text(recommendation?.decision)
  const novelty = overall.novelty_assessment && typeof overall.novelty_assessment === 'object' ? overall.novelty_assessment : null
  const verdictHeaders = ['Overall score', 'Panel decision', 'Competitiveness', ...(novelty ? ['Novelty (reference)'] : [])]
  const verdictWidths = novelty ? [16, 24, 22, 38] : [20, 40, 40]
  children.push(spacer(80))
  children.push(grid(verdictHeaders, verdictWidths, [[
    { ...scoreCell(overall.overall_score), value: `${scoreLabel(overall.overall_score)} / 10`, size: 24 },
    decision
      ? bandCell(DECISION_LABELS[decision] || decision, DECISION_BANDS[decision] || 'none')
      : { value: 'Not stated', align: AlignmentType.CENTER },
    { value: COMPETITIVENESS_LABELS[text(recommendation?.competitiveness)] || text(recommendation?.competitiveness, '—'), align: AlignmentType.CENTER },
    ...(novelty ? [bandCell(
      `${NOVELTY_LABELS[text(novelty.verdict)] || text(novelty.verdict, 'Unassessed')}${novelty.confidence ? ` · ${text(novelty.confidence)} confidence` : ''}`,
      NOVELTY_BANDS[text(novelty.verdict)] || 'none'
    )] : []),
  ]]))
  if (recommendation?.rationale) {
    children.push(new Paragraph({
      children: [run(text(recommendation.rationale), { italics: true, size: 21, color: '374151' })],
      spacing: { before: 120, after: 160 },
    }))
  }

  // Compliance facts — counted, not judged
  const compliance = overall.compliance || null
  if (compliance && typeof compliance === 'object') {
    const lines: string[] = []
    if (compliance.requiredSections) {
      lines.push(`Required sections drafted: ${compliance.requiredSections.coveragePercent ?? 100}%${
        compliance.requiredSections.missing?.length ? ` — missing: ${compliance.requiredSections.missing.join('; ')}` : ''}`)
    }
    const breaches = (Array.isArray(compliance.limits) ? compliance.limits : []).filter((limit: any) => limit?.status !== 'within')
    if (breaches.length) {
      lines.push(`Length limits to fix: ${breaches.map((limit: any) => `${limit.section} at ${limit.actual} of ${limit.limit} ${limit.unit}`).join('; ')}`)
    } else if (Array.isArray(compliance.limits) && compliance.limits.length) {
      lines.push(`Length limits: all ${compliance.limits.length} checked sections within their caps`)
    }
    if (compliance.deadline?.date) {
      lines.push(`Deadline: ${String(compliance.deadline.date).slice(0, 10)}${
        compliance.deadline.status === 'passed' ? ' (passed)' : ` (${compliance.deadline.daysRemaining} days remaining)`}`)
    }
    if (lines.length) {
      children.push(para([run('Compliance check  ', { bold: true, size: 20, color: BRAND }), run(lines.join('   ·   '), { size: 20 })], { spacing: { after: 160 } }))
    }
  }

  // How to use
  children.push(note(
    'How to use this document: work through Part 2 first — it ranks the changes that move the funding decision most. ' +
    'Write what you did in the shaded "Action taken" column of each table, then return to Part 4 for section-level fixes. ' +
    'Part 1 shows where marks were lost; Part 5 lists comparable funded work and patents for reference only.'
  ))

  // Contents (hyperlinked; no field update prompt)
  children.push(new Paragraph({
    children: [new Bookmark({ id: 'contents', children: [run('Contents', { bold: true, size: 24, color: BRAND })] })],
    spacing: { before: 120, after: 80 },
  }))
  const contents: Array<[string, string]> = [
    ['1. At a glance — scores and verdicts', 'part-1'],
    ['2. What to fix first — priority actions worksheet', 'part-2'],
    ['3. Panel assessment — summary, strengths, cross-section issues', 'part-3'],
    ['4. Section by section — worksheets', 'part-4'],
    ...(overall.landscape ? [['5. Research & patent landscape (reference)', 'part-5'] as [string, string]] : []),
    ['Appendix — how this report was produced', 'appendix'],
  ]
  for (const [label, anchor] of contents) {
    children.push(new Paragraph({ children: [link(label, anchor, 21)], spacing: { after: 40 }, indent: { left: 240 } }))
    if (anchor === 'part-4') {
      // Section entries nest under Part 4, where a reader expects them.
      sections.forEach((section, index) => {
        children.push(new Paragraph({
          children: [link(`4.${index + 1}  ${section.section_title}${section.version > 1 ? ` (v${section.version})` : ''}`, sectionAnchor(section), 19)],
          spacing: { after: 30 },
          indent: { left: 600 },
        }))
      })
    }
  }

  // --- Part 1: At a glance ------------------------------------------------
  children.push(heading('1. At a glance', 1, 'part-1'))
  children.push(muted('Scores are the panel\'s marking. Green 7 and above, amber 5 to 6.9, red below 5. "Change" compares a revised section with the version reviewed before it.'))

  const panelBySection = new Map<string, any>(
    (Array.isArray(overall.section_scorecard) ? overall.section_scorecard : [])
      .map((entry: any) => [text(entry?.section).toLowerCase(), entry])
  )
  children.push(grid(
    ['Section', 'Version', 'Score', 'Change', 'Verdict', 'What decides it'],
    [24, 9, 9, 10, 12, 36],
    sections.map((section) => {
      const panel = panelBySection.get(section.section_title.toLowerCase())
      const review = section.review || {}
      return [
        { value: [new Paragraph({ children: [linkToSection(section.section_title, 20)], spacing: { after: 0 } })] },
        { value: section.version > 1 ? `v${section.version}${review.revision_of_version ? ` of v${review.revision_of_version}` : ''}` : 'v1', align: AlignmentType.CENTER },
        scoreCell(review.score),
        { value: deltaLabel(review) || '—', align: AlignmentType.CENTER, color: (review.score_delta ?? 0) > 0 ? SCORE_BANDS.strong.text : (review.score_delta ?? 0) < 0 ? SCORE_BANDS.weak.text : MUTED, bold: true },
        { value: text(panel?.verdict, '—'), align: AlignmentType.CENTER },
        clip(text(panel?.headline || review.summary, '—'), 220),
      ]
    })
  ))
  children.push(spacer(120))

  const criteria = Array.isArray(overall.criterion_scorecard) ? overall.criterion_scorecard : []
  if (criteria.length) {
    children.push(heading('Against the call\'s criteria', 2))
    children.push(grid(
      ['Criterion', 'Weight', 'Score', 'Contribution', 'Verdict', 'Evidence from'],
      [26, 8, 9, 11, 30, 16],
      criteria.map((entry: any) => {
        const weight = typeof entry?.weight === 'number' ? entry.weight : null
        const score = typeof entry?.score === 'number' ? entry.score : null
        const contribution = weight !== null && score !== null ? `${((weight / 100) * score).toFixed(2)} pts` : '—'
        return [
          text(entry?.criterion),
          { value: weight === null ? '—' : `${weight}%`, align: AlignmentType.CENTER },
          score === null ? { value: 'Not evidenced', fill: SCORE_BANDS.none.fill, color: MUTED, align: AlignmentType.CENTER } : scoreCell(score),
          { value: contribution, align: AlignmentType.CENTER },
          text(entry?.verdict, '—'),
          list(entry?.evidence_sections).join(', ') || '—',
        ]
      })
    ))
    children.push(spacer(120))
  }

  const basis = overall.score_basis || null
  if (basis && typeof basis === 'object') {
    const bits = [
      typeof basis.weightedScore === 'number' ? `weighted score ${basis.weightedScore.toFixed(2)}` : null,
      typeof basis.meanSectionScore === 'number' ? `mean section score ${basis.meanSectionScore.toFixed(2)}` : null,
      typeof basis.anchorScore === 'number' ? `panel anchored at ${basis.anchorScore.toFixed(2)}` : null,
    ].filter(Boolean)
    if (bits.length) children.push(muted(`How the overall score was formed: ${bits.join(' · ')}.`))
  }

  if (novelty) {
    children.push(heading('Novelty and positioning (reference only)', 2))
    if (novelty.positioning_summary) children.push(para(text(novelty.positioning_summary)))
    const alreadyDone = Array.isArray(novelty.already_done) ? novelty.already_done : []
    if (alreadyDone.length) {
      children.push(grid(['Already done', 'Kind', 'Overlaps your aspects', 'Leaves open'], [36, 10, 27, 27],
        alreadyDone.map((item: any) => [text(item?.title || item?.ref), text(item?.kind, '—'), text(item?.overlap, '—'), text(item?.leaves_open, '—')])))
      children.push(spacer(100))
    }
    const signals = list(novelty.generic_signals)
    if (signals.length) { children.push(para([run('Why it reads as generic', { bold: true, size: 20 })])); children.push(...bullets(signals)) }
    const changes = Array.isArray(novelty.what_would_make_it_distinctive) ? novelty.what_would_make_it_distinctive : []
    if (changes.length) {
      children.push(para([run('What would make it distinctive', { bold: true, size: 20 })], { spacing: { before: 80, after: 60 } }))
      children.push(...bullets(changes.map((item: any) => `${text(item?.change)}${item?.section ? ` — ${text(item.section)}` : ''}${item?.effort ? ` (${text(item.effort)})` : ''}`)))
    }
  }

  // --- Part 2: What to fix first -----------------------------------------
  children.push(heading('2. What to fix first', 1, 'part-2'))
  const actions = Array.isArray(overall.priority_actions) ? overall.priority_actions : []
  if (actions.length) {
    children.push(muted('Ranked by how much the fix moves the funding decision. Record what you changed in the shaded column.'))
    children.push(grid(
      ['#', 'Section', 'Issue', 'Action to take', 'Impact · Effort', 'Expected gain', 'Action taken (your remarks)'],
      [4, 12, 18, 24, 10, 14, 18],
      actions.map((action: any, index: number) => [
        { value: String(action?.rank ?? index + 1), align: AlignmentType.CENTER, bold: true },
        { value: [new Paragraph({ children: [linkToSection(text(action?.section, '—'), 19)], spacing: { after: 0 } })] },
        { value: text(action?.issue, '—'), size: 19 },
        { value: text(action?.action, '—'), size: 19 },
        bandCell(`${text(action?.impact, '—')} · ${text(action?.effort, '—')}`, action?.impact === 'high' ? 'weak' : action?.impact === 'medium' ? 'adequate' : 'none'),
        { value: text(action?.expected_gain, '—'), size: 19 },
        { value: ' ', fill: WORKSHEET_FILL },
      ])
    ))
  } else {
    children.push(para('The panel did not rank priority actions for this report. Use the section worksheets in Part 4.'))
  }
  children.push(backToContents())

  // --- Part 3: Panel assessment ------------------------------------------
  children.push(heading('3. Panel assessment', 1, 'part-3'))
  children.push(heading('Executive summary', 2))
  const summaryParas = text(overall.executive_summary) ? String(overall.executive_summary).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) : []
  if (summaryParas.length) summaryParas.forEach((p) => children.push(para(p, { spacing: { after: 140 }, alignment: AlignmentType.JUSTIFIED })))
  else children.push(para('No executive summary provided.'))

  const flags = Array.isArray(overall.consistency_flags) ? overall.consistency_flags : []
  if (flags.length) {
    children.push(heading('Cross-section consistency', 2))
    children.push(muted('Contradictions visible only when sections are read together — the panel\'s distinctive contribution.'))
    children.push(grid(['Severity', 'Issue', 'Between'], [10, 62, 28],
      flags.map((flag: any) => [
        bandCell(text(flag?.severity, 'medium'), flag?.severity === 'high' ? 'weak' : flag?.severity === 'low' ? 'none' : 'adequate'),
        text(flag?.issue),
        { value: [new Paragraph({ children: list(flag?.sections).flatMap((title, index, all) => [linkToSection(title, 19), ...(index < all.length - 1 ? [run(' ↔ ', { size: 19 })] : [])]), spacing: { after: 0 } })] },
      ])))
    children.push(spacer(120))
  }

  const strengths = list(overall.major_strengths)
  if (strengths.length) {
    children.push(heading('Major strengths — keep these', 2))
    children.push(...bullets(strengths))
  }

  children.push(heading('Overall weaknesses and recommendations', 2))
  children.push(worksheet(list(overall.major_weaknesses), list(overall.cross_sectional_recommendations), 'Major weaknesses'))

  const supplementary = list(overall.supplementary_materials)
  if (supplementary.length) {
    children.push(heading('Material to prepare separately (not scored)', 2))
    children.push(...bullets(supplementary))
  }
  children.push(backToContents())

  // --- Part 4: Section by section ----------------------------------------
  children.push(heading('4. Section by section', 1, 'part-4'))
  children.push(muted('Each section in proposal order. Revised sections show the change against the version reviewed before.'))

  sections.forEach((section, index) => {
    const review = section.review || {}
    const versionLabel = section.version > 1
      ? ` — v${section.version}${review.revision_of_version ? ` (revision of v${review.revision_of_version})` : ''}`
      : ''
    children.push(heading(`4.${index + 1}  ${section.section_title}${versionLabel}`, 2, sectionAnchor(section)))

    const band = SCORE_BANDS[scoreBand(review.score)]
    const scoreLine: TextRun[] = [
      run(` ${scoreLabel(review.score)} / 10 `, { bold: true, size: 22, color: band.text, shading: { fill: band.fill, type: ShadingType.CLEAR } }),
    ]
    const delta = deltaLabel(review)
    if (delta) scoreLine.push(run(`   ${delta} vs v${review.revision_of_version ?? section.version - 1}${typeof review.previous_score === 'number' ? ` (was ${review.previous_score.toFixed(1)})` : ''}`, { size: 20, color: (review.score_delta ?? 0) >= 0 ? SCORE_BANDS.strong.text : SCORE_BANDS.weak.text }))
    if (typeof review.improvement_over_previous === 'boolean' && section.version > 1) {
      scoreLine.push(run(review.improvement_over_previous ? '   · substantive improvement' : '   · not yet a substantive improvement', { size: 20, color: MUTED }))
    }
    children.push(new Paragraph({ children: scoreLine, spacing: { after: 100 } }))

    if (text(review.summary)) children.push(para(text(review.summary), { alignment: AlignmentType.JUSTIFIED }))

    const sectionStrengths = list(review.strengths).slice(0, 4)
    if (sectionStrengths.length) {
      children.push(para([run('Strengths', { bold: true, size: 20, color: BRAND })], { spacing: { after: 40 } }))
      children.push(...bullets(sectionStrengths))
    }

    const recommendations = list(review.recommendations).length ? list(review.recommendations) : list(review.suggestions)
    children.push(para([run('Weaknesses and recommendations', { bold: true, size: 20, color: BRAND })], { spacing: { before: 80, after: 60 } }))
    children.push(worksheet(list(review.weaknesses), recommendations))

    const addressed = Array.isArray(review.addressed_previous_points) ? review.addressed_previous_points : []
    if (addressed.length) {
      children.push(para([run('Previous remarks — what this revision addressed', { bold: true, size: 20, color: BRAND })], { spacing: { before: 160, after: 60 } }))
      children.push(grid(['Earlier remark', 'Status', 'Evidence in this draft'], [44, 14, 42],
        addressed.map((item: any) => {
          const status = text(item?.status, 'unknown')
          return [
            text(item?.point),
            bandCell(status.replace('_', ' '), status === 'addressed' ? 'strong' : status === 'partially' ? 'adequate' : status === 'not_addressed' ? 'weak' : 'none'),
            text(item?.evidence, '—'),
          ]
        })))
    }

    const complianceFlags = Array.isArray(review.compliance_flags) ? review.compliance_flags.filter((flag: any) => flag?.status && flag.status !== 'met') : []
    if (complianceFlags.length) {
      children.push(para([run('Rules not yet met in this section', { bold: true, size: 20, color: BRAND })], { spacing: { before: 160, after: 60 } }))
      children.push(...bullets(complianceFlags.map((flag: any) => `${text(flag.rule)} — ${text(flag.status)}${flag.detail ? `: ${text(flag.detail)}` : ''}`), 19))
    }
    children.push(backToContents())
  })

  // --- Part 5: Landscape ---------------------------------------------------
  const landscape = overall.landscape && typeof overall.landscape === 'object' ? overall.landscape : null
  if (landscape) {
    const rows = Array.isArray(landscape.priorWork?.rows) ? landscape.priorWork.rows : []
    const funded = rows.filter((row: any) => row?.kind === 'funded' && row?.award)
    const patented = rows.filter((row: any) => row?.kind === 'patented' && row?.patent)
    children.push(heading('5. Research & patent landscape (reference only)', 1, 'part-5'))
    children.push(muted('Similar already-funded projects and Indian patents retrieved for this proposal. This did not influence the scores above.'))
    if (funded.length) {
      children.push(heading('Comparable funded projects', 2))
      children.push(grid(['Project', 'Agency / scheme', 'Year', 'Budget', 'Status', 'Aspects of your proposal it touches'], [30, 16, 7, 12, 9, 26],
        funded.slice(0, 12).map((row: any) => [
          text(row.title), [row.award.agencyName, row.award.schemeName].filter(Boolean).join(' · '), row.year ? String(row.year) : '—',
          row.award.budgetAmount ? `${row.award.budgetCurrency || ''} ${Number(row.award.budgetAmount).toLocaleString('en-IN')}`.trim() : '—',
          text(row.award.status, '—'), list(row.facetsCovered).join('; ') || '—',
        ])))
      children.push(spacer(100))
    }
    if (patented.length) {
      children.push(heading('Comparable Indian patents', 2))
      children.push(grid(['Patent', 'Assignee', 'Number', 'Year', 'Aspects of your proposal it touches'], [32, 20, 14, 7, 27],
        patented.slice(0, 10).map((row: any) => [
          text(row.title), text(row.patent.assignee, '—'), text(row.patent.publicationNumber, '—'), row.year ? String(row.year) : '—', list(row.facetsCovered).join('; ') || '—',
        ])))
      children.push(spacer(100))
    }
    if (!funded.length && !patented.length) children.push(para('No closely comparable funded projects or Indian patents were retrieved for this proposal.'))
    const patentNote = landscape.sources?.patents?.status === 'ok'
      ? `Patents searched via PatentNest (${landscape.sources.patents.count ?? patented.length} retrieved).`
      : landscape.sources?.patents?.status === 'not_configured'
        ? 'Patents not searched — patent search is not configured on this server.'
        : 'Patent search was unavailable for this run.'
    children.push(muted(`Sources: sanctioned-project corpus (${landscape.sources?.projects?.count ?? funded.length} retrieved). ${patentNote}`))
    children.push(backToContents())
  }

  // --- Appendix --------------------------------------------------------------
  children.push(heading('Appendix — how this report was produced', 1, 'appendix'))
  const scored = basis?.scoredVersions && typeof basis.scoredVersions === 'object' ? basis.scoredVersions : null
  children.push(...bullets([
    'Section reviews were produced one section at a time against the call\'s published criteria; the panel report reads them together and decides fundability.',
    'Compliance facts (section coverage, length limits, deadline) are counted from the drafts, not judged by the model.',
    scored ? `Versions scored in this report: ${Object.entries(scored).map(([title, version]) => `${title} v${version}`).join(', ')}.` : 'Versions scored: the newest version of every section.',
    landscape ? 'The research & patent landscape is retrieved from the sanctioned-project corpus and PatentNest for reference and does not affect any score.' : null,
    generated ? `Generated on ${generated}. Regenerate the panel report after revising sections, then export again.` : null,
  ].filter(Boolean) as string[], 19))

  // --- Assemble -----------------------------------------------------------
  const headerText = `Action Taken Report · ${input.projectTitle || 'Untitled proposal'}`.slice(0, 120)
  const doc = new Document({
    creator: 'AIGrantMentor reviewer',
    title: `ATR — ${input.projectTitle || 'Untitled proposal'}`,
    styles: {
      default: { document: { run: { font: FONT, size: 22, color: INK } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 32, bold: true, color: BRAND } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 26, bold: true, color: BRAND_SOFT } },
      ],
      characterStyles: [
        { id: 'Hyperlink', name: 'Hyperlink', basedOn: 'DefaultParagraphFont', run: { color: BRAND_SOFT, underline: {} } },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.LANDSCAPE },
          margin: { top: 900, right: 1000, bottom: 900, left: 1000 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [run(headerText, { size: 17, color: MUTED })],
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 4 } },
            spacing: { after: 120 },
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 17, color: MUTED }),
              ...(generated ? [run(`   ·   ${generated}`, { size: 17, color: MUTED })] : []),
            ],
          })],
        }),
      },
      children,
    }],
  })

  return Packer.toBuffer(doc)
}
