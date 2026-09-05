// @ts-nocheck
/**
 * Splitting a full proposal into a reviewer workspace's sections.
 *
 * Lifted out of `pages/api/reviewer/calls/[id]/import-proposal.ts` so the
 * proposal desk's background runner can do the same import without going
 * through HTTP. The handler keeps the multipart parsing (which is tied to
 * formidable's temp files); everything below is the actual work.
 *
 * The preview is deterministic and spends no tokens: the text is cut at heading
 * lines and each piece matched to a section derived from the call's own
 * structure.
 */
import { hasMeaningfulSectionContent } from '@/lib/reviewer/content'
import { resolveBucketKey } from '@/lib/reviewer/buckets'
import {
  buildProposalTargets,
  countProposalWords,
  splitProposalWithFormat,
} from '@/lib/reviewer/proposalSplit'
import prisma from '@/lib/prisma'

export const MAX_PROPOSAL_CHARS = 400000

export interface ImportTargets {
  templateSections: any[]
  latestByTitle: Map<string, any>
  targets: any[]
}

/**
 * The workspace's current shape: which sections exist, at which version, and
 * what the call's template says they should be.
 */
export async function loadImportTargets(callId: string): Promise<ImportTargets | null> {
  const call = await prisma.reviewerCall.findUnique({
    where: { id: callId },
    select: { id: true, parsed_json: true },
  })
  if (!call) return null

  const parsedContext = call.parsed_json && typeof call.parsed_json === 'object' ? call.parsed_json : {}
  const templateSections = Array.isArray(parsedContext.template_sections)
    ? parsedContext.template_sections
    : []

  const existingSections = await prisma.reviewerSection.findMany({
    where: { call_id: callId },
    orderBy: [{ section_title: 'asc' }, { version: 'desc' }],
    select: {
      id: true,
      section_title: true,
      version: true,
      status: true,
      user_input: true,
      reviewerBucketKey: true,
      mappingJson: true,
    },
  })

  // One row per title (newest version) — that is what an import can fill.
  const latestByTitle = new Map<string, any>()
  for (const section of existingSections) {
    if (!latestByTitle.has(section.section_title)) {
      latestByTitle.set(section.section_title, section)
    }
  }

  const targets = buildProposalTargets(
    Array.from(latestByTitle.values()).map((section) => ({
      section_title: section.section_title,
      reviewerBucketKey: section.reviewerBucketKey,
    })),
    templateSections
  )

  return { templateSections, latestByTitle, targets }
}

export interface ImportPreview {
  chars: number
  words: number
  splitMode: string
  formatLinesRemoved: number
  targets: Array<Record<string, unknown>>
  segments: Array<{
    order: number
    heading: string
    body: string
    words: number
    targetTitle: string | null
    matchedBy: string
  }>
  unmatchedCount: number
  unmatchedWords: number
}

/** Deterministic, zero-LLM: where each block of the document would land. */
export function previewProposalImport(text: string, ctx: ImportTargets): ImportPreview {
  const clipped = String(text || '').slice(0, MAX_PROPOSAL_CHARS)

  const { matches, splitMode, formatLinesRemoved } = splitProposalWithFormat(clipped, ctx.targets, {
    templateSections: ctx.templateSections,
  })

  return {
    chars: clipped.length,
    words: countProposalWords(clipped),
    splitMode,
    formatLinesRemoved,
    targets: ctx.targets.map((target: any) => ({
      title: target.title,
      bucketKey: target.bucketKey,
      aliases: target.aliases || [],
      wordLimit: target.wordLimit ?? null,
      charLimit: target.charLimit ?? null,
      hasContent: hasMeaningfulSectionContent(ctx.latestByTitle.get(target.title)?.user_input || ''),
      status: ctx.latestByTitle.get(target.title)?.status || null,
    })),
    segments: matches.map((match: any) => ({
      order: match.order,
      heading: match.heading,
      body: match.body,
      words: countProposalWords(match.body),
      targetTitle: match.targetTitle,
      matchedBy: match.matchedBy,
    })),
    unmatchedCount: matches.filter((match: any) => !match.targetTitle).length,
    // The whole proposal minus text the matcher placed nowhere, so a caller can
    // warn when a large share of the document would be dropped.
    unmatchedWords: matches
      .filter((match: any) => !match.targetTitle)
      .reduce((total: number, match: any) => total + countProposalWords(match.body), 0),
  }
}

export interface ImportWritten {
  title: string
  sectionId: string
  version: number
  mode: 'filled' | 'revision' | 'created'
}

export type CommitResult =
  | { ok: true; written: ImportWritten[]; skipped: Array<{ title: string; reason: string }> }
  | { ok: false; error: string }

/**
 * Write the assignments.
 *
 * An untouched seeded draft is filled in place; anything already reviewed (or
 * already carrying text) becomes a new revision, so the earlier review and its
 * remarks are preserved and the next review can answer "did they address it".
 */
export async function commitProposalImport(
  callId: string,
  ctx: ImportTargets,
  assignments: Array<{ targetTitle?: string; heading?: string; body?: string }>
): Promise<CommitResult> {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return { ok: false, error: 'No section assignments were supplied' }
  }

  // Several segments may target one section (a proposal often splits
  // Methodology into sub-headings), so merge by title in the given order. Only
  // the sections the preview offered: without this any string the caller sent
  // became a brand-new section, so one typo left an orphan nothing would review.
  const offeredTitles = new Set(ctx.targets.map((target: any) => target.title))
  const rejected: string[] = []

  const merged = new Map<string, string[]>()
  for (const assignment of assignments) {
    const title = String(assignment?.targetTitle || '').trim()
    const blockText = String(assignment?.body || '').trim()
    if (!title || !blockText) continue
    if (!offeredTitles.has(title)) {
      if (!rejected.includes(title)) rejected.push(title)
      continue
    }
    const heading = String(assignment?.heading || '').trim()
    const block = heading && !blockText.startsWith(heading) ? `## ${heading}\n${blockText}` : blockText
    const bucket = merged.get(title) || []
    bucket.push(block)
    merged.set(title, bucket)
  }

  if (merged.size === 0) {
    return {
      ok: false,
      error: rejected.length
        ? `No recognised section was assigned. Unknown: ${rejected.join(', ')}`
        : 'Every assignment was empty. Assign at least one section.',
    }
  }

  const written: ImportWritten[] = []
  const skipped: Array<{ title: string; reason: string }> = []

  for (const [title, blocks] of merged.entries()) {
    const content = blocks.join('\n\n').trim()
    if (!hasMeaningfulSectionContent(content)) {
      skipped.push({ title, reason: 'no_meaningful_content' })
      continue
    }

    const existing = ctx.latestByTitle.get(title)

    if (existing && existing.status === 'draft' && !hasMeaningfulSectionContent(existing.user_input)) {
      await prisma.reviewerSection.update({
        where: { id: existing.id },
        data: { user_input: content },
      })
      written.push({ title, sectionId: existing.id, version: existing.version || 1, mode: 'filled' })
      continue
    }

    if (existing) {
      const version = Number(existing.version || 1) + 1
      const created = await prisma.reviewerSection.create({
        data: {
          call_id: callId,
          section_title: title,
          user_input: content,
          ai_review_json: {},
          status: 'draft',
          version,
          previous_section_id: existing.id,
          is_revision: true,
          review_linked_context: true,
          reviewerBucketKey: existing.reviewerBucketKey || resolveBucketKey({ section_title: title }),
          ...(existing.mappingJson ? { mappingJson: existing.mappingJson } : {}),
        },
        select: { id: true, version: true },
      })
      written.push({ title, sectionId: created.id, version: created.version, mode: 'revision' })
      continue
    }

    const created = await prisma.reviewerSection.create({
      data: {
        call_id: callId,
        section_title: title,
        user_input: content,
        ai_review_json: {},
        status: 'draft',
        version: 1,
        review_linked_context: true,
        reviewerBucketKey: resolveBucketKey({ section_title: title }),
      },
      select: { id: true, version: true },
    })
    written.push({ title, sectionId: created.id, version: created.version, mode: 'created' })
  }

  return {
    ok: true,
    written,
    skipped: [...skipped, ...rejected.map((title) => ({ title, reason: 'unknown_section' }))],
  }
}
