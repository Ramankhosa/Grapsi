// @ts-nocheck
import fs from 'fs/promises'

import type { NextApiRequest, NextApiResponse } from 'next'
import formidable from 'formidable'

import {
  getReviewerSession as getServerSession,
  requireReviewerCallAccess,
} from '@/lib/reviewer-auth-api'
import {
  commitProposalImport,
  loadImportTargets,
  previewProposalImport,
} from '@/lib/reviewer/proposalImport'
import { extractTextFromDocumentBytes } from '@/lib/reviewer/sourceText'

export const config = {
  api: {
    // formidable needs the raw stream for multipart uploads, so the built-in
    // parser is off and JSON bodies are read by `readJsonBody` below.
    bodyParser: false,
  },
}

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
 * The splitting and writing live in `src/lib/reviewer/proposalImport.ts`, which
 * the proposal desk's background runner shares. What remains here is the HTTP:
 * multipart parsing, auth, and status codes.
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
    const ctx = await loadImportTargets(callId)
    if (!ctx) {
      return res.status(404).json({ error: 'Reviewer workspace not found' })
    }

    // ---- Commit -----------------------------------------------------------
    if (body?.action === 'commit') {
      const result = await commitProposalImport(callId, ctx, body.assignments)
      if (!result.ok) {
        return res.status(400).json({ error: result.error })
      }
      return res.status(200).json({ written: result.written, skipped: result.skipped })
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

    if (!text.trim()) {
      return res.status(400).json({
        error: 'No readable text was found. Paste the proposal text, or upload a text-based PDF or DOCX.',
      })
    }

    return res.status(200).json({ filename, ...previewProposalImport(text, ctx) })
  } catch (error) {
    console.error('Error importing proposal:', error)
    const message = error instanceof Error ? error.message : 'Failed to import the proposal'
    return res.status(500).json({ error: message })
  }
}
