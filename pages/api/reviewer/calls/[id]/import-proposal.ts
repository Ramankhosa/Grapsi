// @ts-nocheck
import fs from 'fs/promises'

import type { NextApiRequest, NextApiResponse } from 'next'
import formidable from 'formidable'

import {
  getReviewerSession as getServerSession,
  requireReviewerCallAccess,
} from '@/lib/reviewer-auth-api'
import { hasMeaningfulSectionContent } from '@/lib/reviewer/content'
import {
  buildProposalTargets,
  countProposalWords,
  matchSegmentsToTargets,
  splitProposalIntoSegments,
} from '@/lib/reviewer/proposalSplit'
import { extractTextFromDocumentBytes } from '@/lib/reviewer/sourceText'
import prisma from '../../../../../lib/prisma'

export const config = {
  api: {
    // formidable needs the raw stream for multipart uploads, so the built-in
    // parser is off and JSON bodies are read by `readJsonBody` below.
    bodyParser: false,
  },
}

const MAX_PROPOSAL_CHARS = 400000
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const MAX_JSON_BYTES = 5 * 1024 * 1024

function isMultipart(req: NextApiRequest): boolean {
  return String(req.headers['content-type'] || '').includes('multipart/form-data')
}

async function readJsonBody(req: NextApiRequest): Promise<any> {
  const chunks: Buffer[] = []
  let total = 0

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_JSON_BYTES) {
      throw new Error('The pasted proposal is too large. Upload it as a PDF or DOCX instead.')
    }
    chunks.push(buffer)
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}

  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('Request body was not valid JSON')
  }
}

async function readUploadedProposal(req: NextApiRequest): Promise<{ text: string; filename: string | null }> {
  const form = formidable({ maxFileSize: MAX_UPLOAD_BYTES, maxFiles: 1 })
  const [, files] = await form.parse(req)
  const uploaded = Array.isArray(files.file) ? files.file[0] : files.file

  if (!uploaded?.filepath) {
    throw new Error('No proposal file was received')
  }

  try {
    const bytes = await fs.readFile(uploaded.filepath)
    const { text } = await extractTextFromDocumentBytes(bytes, uploaded.originalFilename)
    return { text, filename: uploaded.originalFilename || null }
  } finally {
    await fs.unlink(uploaded.filepath).catch(() => {})
  }
}

/**
 * Split a full proposal into the workspace's sections.
 *
 * `preview` (default) is deterministic and spends no tokens: the text is cut at
 * heading lines and each piece is matched to a section derived from the
 * approved template's structure. The client shows the mapping, the user fixes
 * whatever the matcher could not place, then `commit` writes the assignments.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: `Method ${req.method} not allowed` })
  }

  const session = await getServerSession(req, res)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  const callId = req.query.id as string
  if (!callId) {
    return res.status(400).json({ error: 'Call ID is required' })
  }

  const callAccess = await requireReviewerCallAccess(callId, session, res, 'editContent')
  if (!callAccess) return

  let body: any = {}
  const multipart = isMultipart(req)
  if (!multipart) {
    try {
      body = await readJsonBody(req)
    } catch (bodyError) {
      return res.status(400).json({
        error: bodyError instanceof Error ? bodyError.message : 'Request body was not readable',
      })
    }
  }

  try {

    const call = await prisma.reviewerCall.findUnique({
      where: { id: callId },
      select: { id: true, parsed_json: true },
    })

    if (!call) {
      return res.status(404).json({ error: 'Reviewer workspace not found' })
    }

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
      },
    })

    // One row per title (newest version) — that is what an import can fill.
    const latestByTitle = new Map<string, typeof existingSections[number]>()
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

    // ---- Commit -----------------------------------------------------------
    if (body?.action === 'commit') {
      const assignments = Array.isArray(body.assignments) ? body.assignments : []
      if (assignments.length === 0) {
        return res.status(400).json({ error: 'No section assignments were supplied' })
      }

      // Several segments may target one section (a proposal often splits
      // Methodology into sub-headings), so merge by title in the given order.
      const merged = new Map<string, string[]>()
      for (const assignment of assignments) {
        const title = String(assignment?.targetTitle || '').trim()
        const blockText = String(assignment?.body || '').trim()
        if (!title || !blockText) continue
        const heading = String(assignment?.heading || '').trim()
        const block = heading && !blockText.startsWith(heading) ? `## ${heading}\n${blockText}` : blockText
        const bucket = merged.get(title) || []
        bucket.push(block)
        merged.set(title, bucket)
      }

      if (merged.size === 0) {
        return res.status(400).json({ error: 'Every assignment was empty. Assign at least one section.' })
      }

      const written = []
      const skipped = []

      for (const [title, blocks] of merged.entries()) {
        const content = blocks.join('\n\n').trim()
        if (!hasMeaningfulSectionContent(content)) {
          skipped.push({ title, reason: 'no_meaningful_content' })
          continue
        }

        const existing = latestByTitle.get(title)

        // An untouched seeded draft is filled in place; anything already
        // reviewed (or already carrying text) becomes a new revision so the
        // earlier review and its remarks are preserved.
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
              reviewerBucketKey: existing.reviewerBucketKey || null,
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
          },
          select: { id: true, version: true },
        })
        written.push({ title, sectionId: created.id, version: created.version, mode: 'created' })
      }

      return res.status(200).json({ written, skipped })
    }

    // ---- Preview ----------------------------------------------------------
    let text = ''
    let filename: string | null = null

    if (multipart) {
      // Unreadable uploads (legacy .doc, corrupt PDFs, oversized files) are the
      // user's problem to fix, not a server fault — return the message as a 400.
      try {
        const uploaded = await readUploadedProposal(req)
        text = uploaded.text
        filename = uploaded.filename
      } catch (uploadError) {
        return res.status(400).json({
          error: uploadError instanceof Error ? uploadError.message : 'Could not read the uploaded file',
        })
      }
    } else {
      text = String(body?.text || '')
    }

    text = text.slice(0, MAX_PROPOSAL_CHARS)

    if (!text.trim()) {
      return res.status(400).json({
        error: 'No readable text was found. Paste the proposal text, or upload a text-based PDF or DOCX.',
      })
    }

    const segments = splitProposalIntoSegments(text)
    const matches = matchSegmentsToTargets(segments, targets)

    return res.status(200).json({
      filename,
      chars: text.length,
      words: countProposalWords(text),
      targets: targets.map((target) => ({
        title: target.title,
        bucketKey: target.bucketKey,
        aliases: target.aliases || [],
        wordLimit: target.wordLimit ?? null,
        charLimit: target.charLimit ?? null,
        hasContent: hasMeaningfulSectionContent(latestByTitle.get(target.title)?.user_input || ''),
        status: latestByTitle.get(target.title)?.status || null,
      })),
      segments: matches.map((match) => ({
        order: match.order,
        heading: match.heading,
        body: match.body,
        words: countProposalWords(match.body),
        targetTitle: match.targetTitle,
        matchedBy: match.matchedBy,
      })),
      unmatchedCount: matches.filter((match) => !match.targetTitle).length,
      // The whole proposal minus text the matcher placed nowhere, so the UI can
      // warn when a large share of the document would be dropped.
      unmatchedWords: matches
        .filter((match) => !match.targetTitle)
        .reduce((total, match) => total + countProposalWords(match.body), 0),
    })
  } catch (error) {
    console.error('Error importing proposal:', error)
    const message = error instanceof Error ? error.message : 'Failed to import the proposal'
    return res.status(500).json({ error: message })
  }
}
