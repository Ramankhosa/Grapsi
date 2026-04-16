import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'

const DEFAULT_FUNDING_UPLOADS_PATH = process.env.FUNDING_UPLOADS_PATH || 'uploads/funding-imports'

function sanitizeFileName(fileName: string) {
  const trimmed = fileName.trim() || 'asset'
  const base = path.basename(trimmed)
  return base.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function getFundingUploadsPath() {
  return path.resolve(process.cwd(), DEFAULT_FUNDING_UPLOADS_PATH)
}

export async function writeFundingBufferAsset(options: {
  jobId: string
  fileName: string
  buffer: Buffer
}) {
  const uploadsPath = getFundingUploadsPath()
  const safeName = sanitizeFileName(options.fileName)
  const dir = path.join(uploadsPath, options.jobId)

  await fs.mkdir(dir, { recursive: true })

  const fileName = `${crypto.randomUUID()}-${safeName}`
  const filePath = path.join(dir, fileName)

  await fs.writeFile(filePath, options.buffer)

  return {
    storagePath: filePath,
    byteSize: options.buffer.byteLength,
  }
}

export async function readFundingAssetBuffer(storagePath: string) {
  return fs.readFile(storagePath)
}

export async function removeFundingJobAssets(jobId: string) {
  const dir = path.join(getFundingUploadsPath(), jobId)
  await fs.rm(dir, { recursive: true, force: true })
}
