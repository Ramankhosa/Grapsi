import path from 'node:path'
import { Worker } from 'node:worker_threads'

/**
 * Local-only document parsing (C1).
 *
 * The shared `parseFundingDocument` silently asks an LLM to transcribe any
 * sparse page, attaches the whole PDF to each request, and turns a failed
 * transcription into empty text. Source Watch never uses it. This parser:
 *
 * - runs pdfjs / mammoth in a worker_thread with a memory limit, and cancels by
 *   terminating that thread (a timeout or lost lease stops the parse itself,
 *   not just the wait for it);
 * - makes no network or model calls at all;
 * - reports a status per page — OK, NEEDS_OCR, PARSE_FAILED, SKIPPED_LIMIT — so
 *   an empty page is never mistaken for a parsed one.
 *
 * Transcribing NEEDS_OCR pages is a separate, reserved and cached step that
 * receives only the selected pages.
 */

export const DOC_PARSER_VERSION = 'monitor-local-1'

export type PageStatus = 'OK' | 'NEEDS_OCR' | 'PARSE_FAILED' | 'SKIPPED_LIMIT'

export interface ParsedPage {
  page: number
  status: PageStatus
  text: string
  chars: number
  error?: string
}

export type DocumentKind = 'pdf' | 'docx'

export interface LocalParseResult {
  kind: DocumentKind
  pageCount: number
  pages: ParsedPage[]
  parserVersion: string
  /** OK: every parsed page has text. PARTIAL: some need OCR or were skipped. */
  status: 'OK' | 'PARTIAL' | 'NEEDS_OCR' | 'PARSE_FAILED'
}

export interface ParseLocalOptions {
  /** Inclusive page range (1-based). Default: the whole document. */
  pages?: [number, number]
  maxPages?: number
  maxBytes?: number
  timeoutMs?: number
  maxMemoryMb?: number
  signal?: AbortSignal
}

export class DocumentParseError extends Error {
  readonly code: 'TOO_LARGE' | 'TIMEOUT' | 'ABORTED' | 'PARSE_FAILED' | 'UNSUPPORTED'
  constructor(code: DocumentParseError['code'], message: string) {
    super(message)
    this.name = 'DocumentParseError'
    this.code = code
  }
}

function workerPath(): string {
  return process.env.MONITOR_DOCPARSE_WORKER || path.join(process.cwd(), 'src', 'lib', 'monitor', 'docParse.worker.mjs')
}

function overallStatus(pages: ParsedPage[]): LocalParseResult['status'] {
  if (pages.length === 0) return 'PARSE_FAILED'
  if (pages.every((page) => page.status === 'PARSE_FAILED')) return 'PARSE_FAILED'
  if (pages.every((page) => page.status === 'NEEDS_OCR' || page.status === 'PARSE_FAILED')) return 'NEEDS_OCR'
  return pages.every((page) => page.status === 'OK') ? 'OK' : 'PARTIAL'
}

export function documentKindOf(contentKind: string, url = ''): DocumentKind | null {
  if (contentKind === 'pdf') return 'pdf'
  if (contentKind === 'docx' || /\.docx(\?|#|$)/i.test(url)) return 'docx'
  return null
}

export async function parseLocal(input: Buffer, kind: DocumentKind, options: ParseLocalOptions = {}): Promise<LocalParseResult> {
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024
  if (input.length > maxBytes) {
    throw new DocumentParseError('TOO_LARGE', `Document is ${input.length} bytes; the parse limit is ${maxBytes}`)
  }
  if (options.signal?.aborted) throw new DocumentParseError('ABORTED', 'Parse aborted before it started')

  // Copy into a transferable buffer so the worker owns its bytes outright.
  const copy = new Uint8Array(input.length)
  copy.set(input)

  const worker = new Worker(workerPath(), {
    workerData: { buffer: copy.buffer, kind, range: options.pages ?? null, maxPages: options.maxPages ?? 40 },
    transferList: [copy.buffer],
    resourceLimits: { maxOldGenerationSizeMb: options.maxMemoryMb ?? 256 },
  })

  return new Promise<LocalParseResult>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      void worker.terminate()
      fn()
    }
    const timer = setTimeout(
      () => finish(() => reject(new DocumentParseError('TIMEOUT', 'Document parse exceeded its time limit'))),
      options.timeoutMs ?? 60_000
    )
    const onAbort = () => finish(() => reject(new DocumentParseError('ABORTED', 'Document parse was cancelled')))
    options.signal?.addEventListener('abort', onAbort, { once: true })

    // Persistent listeners, not `once`: a worker can emit a second 'error'
    // after the parse has settled (pdfjs failing late on a hostile file), and
    // an 'error' event with no listener would crash this whole process.
    worker.on('message', (message: { ok: boolean; result?: Omit<LocalParseResult, 'parserVersion' | 'status'>; error?: string }) => {
      if (!message.ok || !message.result) {
        finish(() => reject(new DocumentParseError('PARSE_FAILED', message.error ?? 'Document could not be parsed')))
        return
      }
      const result = message.result
      finish(() =>
        resolve({ ...result, parserVersion: DOC_PARSER_VERSION, status: overallStatus(result.pages) })
      )
    })
    worker.on('error', (error) => finish(() => reject(new DocumentParseError('PARSE_FAILED', error.message))))
    worker.on('exit', (code) => {
      if (code !== 0) finish(() => reject(new DocumentParseError('PARSE_FAILED', `Parser exited with code ${code}`)))
    })
  })
}

/** The parsed text with page markers, for evidence segments. */
export function joinedText(result: LocalParseResult): string {
  return result.pages
    .filter((page) => page.status === 'OK')
    .map((page) => `[page ${page.page}]\n${page.text}`)
    .join('\n\n')
}
