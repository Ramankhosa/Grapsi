import { PatentNestApiError } from '@/lib/patentnest/client'

export const PATENT_PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
export const PATENT_MAX_REQUEST_BYTES = 256 * 1024

/** Bound streamed bodies too: Content-Length is optional and cannot be trusted. */
export async function readPatentJson(request: Request): Promise<unknown> {
  const tooLarge = () => new PatentNestApiError({ code: 'PAYLOAD_TOO_LARGE', message: 'Patent requests must be no larger than 256 KB.', status: 413 })
  if (Number(request.headers.get('content-length')) > PATENT_MAX_REQUEST_BYTES) throw tooLarge()
  const reader = request.body?.getReader()
  if (!reader) throw new PatentNestApiError({ code: 'INVALID_REQUEST', message: 'Supply a valid JSON patent request.', status: 400 })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > PATENT_MAX_REQUEST_BYTES) { await reader.cancel(); throw tooLarge() }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder().decode(body)) }
  catch { throw new PatentNestApiError({ code: 'INVALID_REQUEST', message: 'Supply a valid JSON patent request.', status: 400 }) }
}
