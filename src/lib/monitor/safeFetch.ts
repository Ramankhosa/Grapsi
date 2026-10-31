import { isIP } from 'node:net'
import { Readable, pipeline } from 'node:stream'
import zlib from 'node:zlib'

import { Agent, request } from 'undici'

import { MonitorFetchError, isMonitorFetchError } from './errors'
import { botChallenge, botChallengeError } from './pageText'
import { MISSING_ISSUER_CODES, caWith, completeChain, knownIntermediates } from './tlsChain'
import { databaseHostPacer, parseRetryAfter, type HostPacer } from './hostPacing'
import {
  DEFAULT_ALLOWED_PORTS,
  assertFetchableUrl,
  resolvePublicAddresses,
  systemResolver,
  type AddressResolver,
} from './netGuard'
import { ROBOTS_MAX_BYTES, createRobotsPolicy, type RobotsFetcher, type RobotsPolicy } from './robots'

/**
 * The only way Source Watch reaches the network outside the browser tier.
 *
 * Before every connection — the first request and every redirect hop — it
 * validates the URL (scheme, credentials, port), checks robots.txt for that
 * hop's origin, resolves the host and requires ALL addresses to be public,
 * takes a pacing slot for the destination host, and then connects to exactly
 * those validated addresses (DNS pinning), so a second resolution cannot swap
 * in a private address. Bodies are read as a stream under a byte cap that also
 * bounds decompression; a capped body is flagged `truncated` and must never be
 * treated as the complete content.
 *
 * TLS is strict. Only a host-specific, expiring exception recorded on the site
 * relaxes it, and the result says so (`tlsExceptionUsed`) so the evidence can.
 */

export type ContentKind = 'html' | 'xml' | 'json' | 'pdf' | 'docx' | 'gzip' | 'text' | 'binary'

export interface TransportRequest {
  url: URL
  method: 'GET' | 'HEAD'
  headers: Record<string, string>
  /** Validated public addresses the connection must use. */
  addresses: string[]
  tlsInsecure: boolean
  signal: AbortSignal
}

export interface TransportResponse {
  status: number
  headers: Record<string, string>
  body: AsyncIterable<Uint8Array>
  close(): Promise<void>
}

export type FetchTransport = (request: TransportRequest) => Promise<TransportResponse>

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD'
  headers?: Record<string, string>
  /** Cap on decoded body bytes (also bounds compressed bytes read). */
  maxBytes?: number
  /** Whole-fetch deadline, redirects included. */
  timeoutMs?: number
  maxRedirects?: number
  /** Hosts a redirect may land on. Default: any public host. */
  inScope?: (host: string) => boolean
  /** Check robots.txt for every hop (default true). */
  robots?: boolean
  /** Take a pacing slot per hop (default true). */
  pace?: boolean
  /** Minimum gap between requests to one host. */
  minDelayMs?: number | ((host: string) => number)
  /** Hosts with an approved, unexpired TLS exception. */
  tlsInsecureHosts?: ReadonlySet<string>
  allowedPorts?: Set<number>
  /** Throw on HTTP >= 400 (default true). Robots fetching needs the status. */
  throwOnHttpError?: boolean
  signal?: AbortSignal
}

export interface SafeFetchResult {
  requestedUrl: string
  finalUrl: string
  status: number
  headers: Record<string, string>
  body: Buffer
  byteLength: number
  truncated: boolean
  contentType: string
  contentKind: ContentKind
  notModified: boolean
  redirects: string[]
  tlsExceptionUsed: boolean
}

export type SafeFetch = (url: string, options?: SafeFetchOptions) => Promise<SafeFetchResult>

export const DEFAULT_MAX_BYTES = 2_500_000
export const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_REDIRECTS = 5
const DEFAULT_MIN_DELAY_MS = 3_000
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const TLS_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_UNTRUSTED',
])

export function sourceWatchUserAgent(): string {
  const site = (process.env.SITE_URL || process.env.NEXTAUTH_URL || '').split(/[\s,]+/)[0]
  return site ? `GrapsiSourceWatch/1.0 (+${site})` : 'GrapsiSourceWatch/1.0'
}

/**
 * undici transport whose connection is pinned to the validated addresses. A
 * server that leaves its intermediate certificate out is retried once with
 * the chain completed from the certificate's own issuer URL (see tlsChain).
 */
export const undiciTransport: FetchTransport = async (req) => {
  const host = req.url.hostname
  const known = req.tlsInsecure ? null : knownIntermediates(host)
  try {
    return await pinnedRequest(req, known)
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } })?.code || (error as { cause?: { code?: string } })?.cause?.code || ''
    if (req.tlsInsecure || known || !MISSING_ISSUER_CODES.has(code) || req.signal?.aborted) throw error
    const port = Number(req.url.port) || 443
    const intermediates = await completeChain(host, req.addresses[0], port)
    if (!intermediates) throw error
    return pinnedRequest(req, intermediates)
  }
}

async function pinnedRequest(req: TransportRequest, intermediates: string[] | null): Promise<TransportResponse> {
  const pinned = req.addresses.map((address) => ({ address, family: isIP(address) === 6 ? 6 : 4 }))
  const agent = new Agent({
    connect: {
      rejectUnauthorized: !req.tlsInsecure,
      ...(intermediates ? { ca: caWith(intermediates) } : {}),
      timeout: 15_000,
      // net/tls call this instead of DNS: the socket can only reach the
      // addresses resolvePublicAddresses already approved.
      lookup: ((
        _hostname: string,
        options: { all?: boolean } | number,
        callback: (error: Error | null, address: unknown, family?: number) => void
      ) => {
        const all = typeof options === 'object' && options?.all
        if (all) callback(null, pinned)
        else callback(null, pinned[0].address, pinned[0].family)
      }) as never,
    },
    headersTimeout: 30_000,
    bodyTimeout: 30_000,
  })
  try {
    const response = await request(req.url, {
      method: req.method,
      headers: req.headers,
      dispatcher: agent,
      signal: req.signal,
    })
    // Discarding an unread body (a redirect, a 304, a capped read) makes
    // undici emit UND_ERR_ABORTED on the stream; with no listener that event
    // would crash the whole worker process. Read errors still surface through
    // the async iterator that consumes the body.
    response.body.on('error', () => undefined)
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(response.headers)) {
      if (value === undefined) continue
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value)
    }
    return {
      status: response.statusCode,
      headers,
      body: response.body,
      close: async () => {
        response.body.destroy()
        await agent.close().catch(() => undefined)
      },
    }
  } catch (error) {
    await agent.destroy().catch(() => undefined)
    throw error
  }
}

async function* countedChunks(
  body: AsyncIterable<Uint8Array>,
  limit: number,
  state: { raw: number; rawExceeded: boolean }
): AsyncGenerator<Uint8Array> {
  for await (const chunk of body) {
    if (state.raw + chunk.length > limit) {
      // Read exactly up to the limit, then stop pulling from the socket.
      const room = limit - state.raw
      if (room > 0) yield chunk.subarray(0, room)
      state.raw = limit
      state.rawExceeded = true
      return
    }
    state.raw += chunk.length
    yield chunk
  }
}

/** Read a body under one cap for compressed input and one for decoded output. */
export async function readCappedBody(
  body: AsyncIterable<Uint8Array>,
  encoding: string,
  maxBytes: number
): Promise<{ buffer: Buffer; truncated: boolean }> {
  const state = { raw: 0, rawExceeded: false }
  const source = Readable.from(countedChunks(body, maxBytes, state))
  const enc = encoding.toLowerCase()
  const decoder = enc.includes('br')
    ? zlib.createBrotliDecompress()
    : enc.includes('gzip')
      ? zlib.createGunzip()
      : enc.includes('deflate')
        ? zlib.createInflate()
        : null
  // pipeline, not pipe: a timeout or socket error in the compressed body must
  // reach the loop below. With pipe() it was an unhandled 'error' event on the
  // source stream, which killed the whole worker process.
  const stream: AsyncIterable<Buffer> = decoder ? pipeline(source, decoder, () => undefined) : source

  const chunks: Buffer[] = []
  let total = 0
  let truncated = false
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.from(chunk)
      if (total + buffer.length > maxBytes) {
        chunks.push(buffer.subarray(0, maxBytes - total))
        total = maxBytes
        truncated = true
        break
      }
      chunks.push(buffer)
      total += buffer.length
    }
  } finally {
    source.destroy()
    decoder?.destroy()
  }
  return { buffer: Buffer.concat(chunks, total), truncated: truncated || state.rawExceeded }
}

/** Decompress a gzip file body (e.g. sitemap.xml.gz) under a decoded-size cap. */
export async function gunzipCapped(buffer: Buffer, maxBytes: number): Promise<{ buffer: Buffer; truncated: boolean }> {
  return readCappedBody(Readable.from([buffer]), 'gzip', maxBytes)
}

function startsWith(buffer: Buffer, text: string): boolean {
  return buffer.subarray(0, text.length).toString('latin1') === text
}

export function detectContentKind(contentType: string, body: Buffer, url: string): ContentKind {
  const head = body.subarray(0, 1024)
  if (startsWith(head, '%PDF')) return 'pdf'
  if (head[0] === 0x1f && head[1] === 0x8b) return 'gzip'
  const ct = contentType.toLowerCase()
  if (startsWith(head, 'PK\u0003\u0004')) {
    return ct.includes('wordprocessingml') || /\.docx(\?|$)/i.test(url) ? 'docx' : 'binary'
  }
  if (ct.includes('html') || ct.includes('xhtml')) return 'html'
  if (ct.includes('xml') || ct.includes('rss') || ct.includes('atom')) return 'xml'
  if (ct.includes('json')) return 'json'
  if (ct.includes('pdf')) return 'pdf'
  const text = head.toString('utf8').replace(/^﻿/, '').trimStart().toLowerCase()
  if (/^<\?xml|^<rss|^<feed|^<urlset|^<sitemapindex|^<rdf:rdf/.test(text)) return 'xml'
  if (/^<!doctype html|^<html/.test(text)) return 'html'
  if (ct.startsWith('text/')) return 'text'
  return 'binary'
}

/** Decode a text body using the declared or sniffed charset (UTF-8 default). */
export function decodeBody(result: Pick<SafeFetchResult, 'body' | 'contentType' | 'contentKind'>): string {
  const body = result.body
  // A byte-order mark is the strongest signal there is.
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return new TextDecoder('utf-8').decode(body.subarray(3))
  if (body[0] === 0xff && body[1] === 0xfe) return new TextDecoder('utf-16le').decode(body.subarray(2))
  if (body[0] === 0xfe && body[1] === 0xff) return new TextDecoder('utf-16be').decode(body.subarray(2))
  let charset = /charset=["']?([\w-]+)/i.exec(result.contentType)?.[1]
  if (!charset && result.contentKind === 'xml') charset = /^<\?xml[^>]+encoding=["']([\w-]+)/i.exec(body.subarray(0, 200).toString('latin1'))?.[1]
  // Servers often label UTF-8 pages as Latin-1: bytes that are valid UTF-8
  // and contain multi-byte characters are UTF-8, whatever the label says.
  if (charset && /^(iso-8859-1|latin-?1|windows-1252|us-ascii|ascii)$/i.test(charset) && body.subarray(0, 65536).some((b) => b >= 0x80)) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(body)
    } catch {
      // really a single-byte encoding
    }
  }
  if (!charset && result.contentKind === 'html') {
    const head = result.body.subarray(0, 4096).toString('latin1')
    charset =
      /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
      /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head)?.[1]
  }
  let text: string
  try {
    text = new TextDecoder(charset || 'utf-8', { fatal: false }).decode(result.body)
  } catch {
    text = new TextDecoder('utf-8', { fatal: false }).decode(result.body)
  }
  return text.replace(/^﻿/, '')
}

function mapTransportError(error: unknown, url: URL): MonitorFetchError {
  if (isMonitorFetchError(error)) return error
  const err = error as { name?: string; code?: string; message?: string; cause?: { code?: string } }
  const code = err?.code || err?.cause?.code || ''
  if (err?.name === 'AbortError' || code === 'UND_ERR_ABORTED') {
    return new MonitorFetchError('TIMEOUT', `Fetch of ${url.href} timed out or was aborted`, { retryable: true, url: url.href })
  }
  if (TLS_ERROR_CODES.has(code)) {
    return new MonitorFetchError(
      'TLS_ERROR',
      `TLS verification failed for ${url.hostname} (${code}). Fix the certificate chain, or record an explicit, expiring TLS exception for this host.`,
      { url: url.href, cause: error }
    )
  }
  if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return new MonitorFetchError('TIMEOUT', `${url.hostname} did not respond in time`, { retryable: true, url: url.href })
  }
  return new MonitorFetchError('NETWORK', `Network error fetching ${url.href}: ${err?.message ?? code ?? 'unknown'}`, {
    retryable: true,
    url: url.href,
    cause: error,
  })
}

export interface SafeFetchDeps {
  transport?: FetchTransport
  resolver?: AddressResolver
  /** null disables robots entirely (only for robots.txt fetches themselves). */
  robots?: RobotsPolicy | null
  /** null disables pacing (tests). */
  pacer?: HostPacer | null
  userAgent?: string
}

export function createSafeFetcher(deps: SafeFetchDeps = {}): SafeFetch {
  const transport = deps.transport ?? undiciTransport
  const resolver = deps.resolver ?? systemResolver
  const pacer = deps.pacer === undefined ? databaseHostPacer : deps.pacer
  const userAgent = deps.userAgent ?? sourceWatchUserAgent()

  let robots: RobotsPolicy | null = null

  const safeFetch: SafeFetch = async (rawUrl, options = {}) => {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
    const method = options.method ?? 'GET'
    const throwOnHttpError = options.throwOnHttpError ?? true
    const checkRobots = options.robots ?? true
    const pace = options.pace ?? true

    const controller = new AbortController()
    const onAbort = () => controller.abort()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    let current: URL
    try {
      current = new URL(rawUrl)
    } catch {
      clearTimeout(timer)
      throw new MonitorFetchError('BLOCKED_URL', `Not a valid URL: ${rawUrl}`)
    }
    const requestedUrl = current.href
    const redirects: string[] = []
    let headers: Record<string, string> = {
      'user-agent': userAgent,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml,application/atom+xml,application/pdf,*/*;q=0.8',
      'accept-encoding': 'gzip, deflate, br',
      'accept-language': 'en-IN,en;q=0.9,hi;q=0.8',
      ...Object.fromEntries(Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
    }

    try {
      for (let hop = 0; hop <= maxRedirects; hop += 1) {
        if (controller.signal.aborted) throw new MonitorFetchError('TIMEOUT', `Fetch of ${requestedUrl} timed out`, { retryable: true })
        assertFetchableUrl(current, options.allowedPorts ?? DEFAULT_ALLOWED_PORTS)
        const host = current.hostname.toLowerCase()
        // Scope applies to EVERY hop, the first included: a discovered link to
        // an unapproved host is refused before any DNS lookup or connection.
        if (options.inScope && !options.inScope(host)) {
          throw new MonitorFetchError(
            'REDIRECT_OUT_OF_SCOPE',
            hop > 0
              ? `Redirected to ${host}, which is outside this site's approved hosts`
              : `${host} is outside this site's approved hosts`,
            { url: current.href }
          )
        }

        // Address check first: a private target must be reported as blocked,
        // never masked by the robots lookup that would also fail on it.
        const addresses = await resolvePublicAddresses(host, resolver)

        let crawlDelayMs = 0
        if (checkRobots && robots) {
          const decision = await robots.check(current, controller.signal)
          if (!decision.allowed) {
            if (decision.failure) {
              throw new MonitorFetchError(decision.failure.code, `${current.origin}/robots.txt: ${decision.failure.message}`, {
                url: current.href,
              })
            }
            if (decision.deferUntil) {
              throw new MonitorFetchError('ROBOTS_DEFERRED', `${current.origin}: ${decision.reason}`, {
                retryable: true,
                retryAt: decision.deferUntil,
                url: current.href,
              })
            }
            throw new MonitorFetchError('ROBOTS_DISALLOWED', `${current.href} is ${decision.reason}`, { url: current.href })
          }
          crawlDelayMs = decision.crawlDelayMs ?? 0
        }

        if (pace && pacer) {
          const configured =
            typeof options.minDelayMs === 'function' ? options.minDelayMs(host) : options.minDelayMs ?? DEFAULT_MIN_DELAY_MS
          await pacer.acquire(host, Math.max(configured, crawlDelayMs), controller.signal)
        }

        const tlsInsecure = options.tlsInsecureHosts?.has(host) ?? false
        let response: TransportResponse
        try {
          response = await transport({ url: current, method, headers, addresses, tlsInsecure, signal: controller.signal })
        } catch (error) {
          throw mapTransportError(error, current)
        }

        if (REDIRECT_STATUSES.has(response.status) && response.headers.location) {
          await response.close()
          let next: URL
          try {
            next = new URL(response.headers.location, current)
          } catch {
            throw new MonitorFetchError('BLOCKED_URL', `Unparsable redirect target from ${current.href}`)
          }
          redirects.push(next.href)
          current = next
          // Validators belong to the resource first asked for, not its target.
          const { 'if-none-match': _etag, 'if-modified-since': _since, ...rest } = headers
          headers = rest
          continue
        }

        if (response.status === 429 || (response.status === 503 && response.headers['retry-after'])) {
          await response.close()
          const until = parseRetryAfter(response.headers['retry-after']) ?? new Date(Date.now() + 10 * 60 * 1000)
          if (pacer) await pacer.cooldown(host, until, `HTTP ${response.status}`)
          throw new MonitorFetchError('HOST_COOLDOWN', `${host} answered ${response.status}; cooling down`, {
            retryable: true,
            retryAt: until,
            httpStatus: response.status,
            url: current.href,
          })
        }

        const contentType = response.headers['content-type'] ?? ''
        if (response.status === 304) {
          await response.close()
          return {
            requestedUrl,
            finalUrl: current.href,
            status: 304,
            headers: response.headers,
            body: Buffer.alloc(0),
            byteLength: 0,
            truncated: false,
            contentType,
            contentKind: 'binary',
            notModified: true,
            redirects,
            tlsExceptionUsed: tlsInsecure,
          }
        }

        let read: { buffer: Buffer; truncated: boolean }
        try {
          read =
            method === 'HEAD'
              ? { buffer: Buffer.alloc(0), truncated: false }
              : await readCappedBody(response.body, response.headers['content-encoding'] ?? '', maxBytes)
        } catch (error) {
          throw mapTransportError(error, current)
        } finally {
          await response.close()
        }

        if (response.status >= 400 && throwOnHttpError) {
          // A bot check is not an outage: say so, and do not retry it as one.
          const vendor = read.buffer.length ? botChallenge(response.status, response.headers, read.buffer.subarray(0, 200_000).toString('utf8')) : null
          if (vendor) throw botChallengeError(current.href, vendor, response.status)
          throw new MonitorFetchError('HTTP_STATUS', `${current.href} answered HTTP ${response.status}`, {
            retryable: response.status >= 500,
            httpStatus: response.status,
            url: current.href,
          })
        }

        return {
          requestedUrl,
          finalUrl: current.href,
          status: response.status,
          headers: response.headers,
          body: read.buffer,
          byteLength: read.buffer.length,
          truncated: read.truncated,
          contentType,
          contentKind: detectContentKind(contentType, read.buffer, current.href),
          notModified: false,
          redirects,
          tlsExceptionUsed: tlsInsecure,
        }
      }
      throw new MonitorFetchError('REDIRECT_LIMIT', `More than ${maxRedirects} redirects from ${requestedUrl}`, { url: requestedUrl })
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }

  if (deps.robots !== null) {
    robots = deps.robots ?? createRobotsPolicy({ fetchRobots: robotsFetcherFor(safeFetch) })
  }

  return safeFetch
}

/**
 * How robots.txt itself is fetched (RFC 9309): follow redirects, apply every
 * safety rule except robots itself (no recursion), read at least 500 KiB, and
 * report a 429 as overload so the deferral matches the host's cooldown.
 */
export function robotsFetcherFor(fetch: SafeFetch): RobotsFetcher {
  return async (robotsUrl, signal) => {
    let result: SafeFetchResult
    try {
      result = await fetch(robotsUrl, {
        robots: false,
        maxBytes: ROBOTS_MAX_BYTES,
        throwOnHttpError: false,
        timeoutMs: 15_000,
        signal,
      })
    } catch (error) {
      if (isMonitorFetchError(error) && error.code === 'HOST_COOLDOWN' && error.httpStatus === 429) {
        return { status: 429, body: '', retryAfter: error.retryAt ?? null }
      }
      throw error
    }
    return {
      status: result.status,
      body: result.body.toString('utf8'),
      retryAfter: parseRetryAfter(result.headers['retry-after']),
    }
  }
}

let defaultFetcher: SafeFetch | null = null
let defaultRobots: RobotsPolicy | null = null

/** The process-wide fetcher: real DNS, real undici, database robots and pacing. */
export function defaultSafeFetch(): SafeFetch {
  if (!defaultFetcher) defaultFetcher = createSafeFetcher({ robots: defaultRobotsPolicy() })
  return defaultFetcher
}

/** The process-wide robots policy (shared by the fetcher and legacy callers). */
export function defaultRobotsPolicy(): RobotsPolicy {
  if (!defaultRobots) defaultRobots = createRobotsPolicy({ fetchRobots: robotsFetcherFor(createSafeFetcher({ robots: null })) })
  return defaultRobots
}
