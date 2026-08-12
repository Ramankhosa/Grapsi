import crypto from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import type { IntakeSubmitInput } from './types'
import { MAX_INTAKE_PDF_BYTES } from './upload'

const INTAKE_UPLOAD_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

export async function stagePdfUpload(file: File): Promise<NonNullable<IntakeSubmitInput['sourceFile']>> {
  if (!INTAKE_UPLOAD_MIMES.has(file.type)) {
    throw new Error('Only PDF and DOCX files are supported for intake uploads')
  }

  if (file.size > MAX_INTAKE_PDF_BYTES) {
    throw new Error('Intake file is too large')
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex')
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const targetPath = path.join(os.tmpdir(), `funding-intake-${Date.now()}-${safeName}`)

  try {
    await fs.writeFile(targetPath, bytes)
  } catch (error) {
    await fs.unlink(targetPath).catch(() => undefined)
    throw new Error(
      `Failed to stage intake PDF upload${error instanceof Error && error.message ? `: ${error.message}` : ''}`
    )
  }

  return {
    originalName: file.name || 'upload.pdf',
    mimeType: file.type || 'application/pdf',
    size: file.size,
    tempFilePath: targetPath,
    checksum,
  }
}
