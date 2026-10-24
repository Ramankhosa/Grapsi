import { gzipSync } from 'node:zlib'

import { describe, expect, it, vi } from 'vitest'

import type { HostPacer } from '@/lib/monitor/hostPacing'
import { createRobotsPolicy, type RobotsRecord, type RobotsStore } from '@/lib/monitor/robots'
import {
  createSafeFetcher,
  robotsFetcherFor,
  type FetchTransport,
  type TransportRequest,
  type TransportResponse,
} from '@/lib/monitor/safeFetch'

/**
 * safeFetch against a fixture transport and a fixture resolver. Production
 * protections are never relaxed to make a localhost server reachable; the
 * network is replaced instead.
 */

type Route = { status: number; headers?: Record<string, string>; body?: Buffer | string | (() => AsyncIterable<Uint8Array>) }

function fixtureTransport(routes: Record<string, Route | ((req: TransportRequest) => Route)>) {
  const calls: TransportRequest[] = []
  const transport: FetchTransport = async (req) => {
    calls.push(req)
    const entry = routes[req.url.href]
    const route = typeof entry === 'function' ? entry(req) : entry
    if (!route) return respond({ status: 404, body: 'not found' })
    return respond(route)
  }
  return { transport, calls }
}

function respond(route: Route): TransportResponse {
  const raw = route.body
  const body =
    typeof raw === 'function'
      ? raw()
      : (async function* () {
          if (raw !== undefined) yield Buffer.from(raw)
        })()
  return { status: route.status, headers: route.headers ?? {}, body, close: async () => undefined }
}

const resolver = async (host: string) => {
  const table: Record<string, string[]> = {
    'funder.example': ['93.184.216.34'],
    'cdn.funder.example': ['93.184.216.35'],
    'internal.example': ['169.254.169.254'],
    'rebind.example': ['93.184.216.36', '10.0.0.8'],
  }
  if (table[host]) return table[host]
  throw new Error('ENOTFOUND')
}

function memoryRobotsStore(initial: Record<string, RobotsRecord> = {}): RobotsStore & { data: Record<string, RobotsRecord> } {
  const data = { ...initial }
  return {
    data,
    async get(origin) {
      return data[origin] ?? null
    },
    async put(origin, _ua, record) {
      data[origin] = record
    },
  }
}

function recordingPacer(): HostPacer & { cooldowns: Array<{ host: string; until: Date }>; acquired: string[] } {
  const cooldowns: Array<{ host: string; until: Date }> = []
  const acquired: string[] = []
  return {
    cooldowns,
    acquired,
    async acquire(host) {
      acquired.push(host)
    },
    async cooldown(host, until) {
      cooldowns.push({ host, until })
    },
  }
}

function fetcherWith(routes: Parameters<typeof fixtureTransport>[0], options: { robots?: boolean; store?: RobotsStore } = {}) {
  const { transport, calls } = fixtureTransport(routes)
  const pacer = recordingPacer()
  const base = createSafeFetcher({ transport, resolver, robots: null, pacer })
  const robots = options.robots
    ? createRobotsPolicy({ fetchRobots: robotsFetcherFor(base), store: options.store ?? memoryRobotsStore() })
    : null
  const fetch = createSafeFetcher({ transport, resolver, robots, pacer })
  return { fetch, calls, pacer }
}

describe('safeFetch: addresses and redirects', () => {
  it('connects only to the validated addresses (DNS pinning)', async () => {
    const { fetch, calls } = fetcherWith({ 'https://funder.example/calls': { status: 200, headers: { 'content-type': 'text/html' }, body: '<html></html>' } })
    const result = await fetch('https://funder.example/calls')
    expect(result.status).toBe(200)
    expect(calls[0].addresses).toEqual(['93.184.216.34'])
  })

  it('refuses a host that resolves to a private address before connecting', async () => {
    const { fetch, calls } = fetcherWith({})
    await expect(fetch('https://internal.example/')).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' })
    await expect(fetch('https://rebind.example/')).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' })
    expect(calls).toHaveLength(0)
  })

  it('re-validates every redirect hop: a redirect to a private target is blocked before connecting', async () => {
    const { fetch, calls } = fetcherWith({
      'https://funder.example/go': { status: 302, headers: { location: 'https://internal.example/latest/meta-data' } },
    })
    await expect(fetch('https://funder.example/go')).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' })
    expect(calls.map((call) => call.url.hostname)).toEqual(['funder.example'])
  })

  it('blocks a redirect to a literal metadata address', async () => {
    const { fetch, calls } = fetcherWith({
      'https://funder.example/go': { status: 301, headers: { location: 'http://169.254.169.254/' } },
    })
    await expect(fetch('https://funder.example/go')).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' })
    expect(calls).toHaveLength(1)
  })

  it('stops a redirect that leaves the site scope', async () => {
    const { fetch } = fetcherWith({
      'https://funder.example/go': { status: 302, headers: { location: 'https://cdn.funder.example/file' } },
    })
    await expect(fetch('https://funder.example/go', { inScope: (host) => host === 'funder.example' })).rejects.toMatchObject({
      code: 'REDIRECT_OUT_OF_SCOPE',
    })
  })

  it('follows in-scope redirects and drops validators on the way', async () => {
    const { fetch, calls } = fetcherWith({
      'https://funder.example/old': { status: 301, headers: { location: '/new' } },
      'https://funder.example/new': { status: 200, headers: { 'content-type': 'text/html' }, body: 'ok' },
    })
    const result = await fetch('https://funder.example/old', { headers: { 'If-None-Match': '"abc"' } })
    expect(result.finalUrl).toBe('https://funder.example/new')
    expect(result.redirects).toEqual(['https://funder.example/new'])
    expect(calls[0].headers['if-none-match']).toBe('"abc"')
    expect(calls[1].headers['if-none-match']).toBeUndefined()
  })

  it('gives up after the redirect limit', async () => {
    const { fetch } = fetcherWith({
      'https://funder.example/loop': { status: 302, headers: { location: '/loop' } },
    })
    await expect(fetch('https://funder.example/loop', { maxRedirects: 3 })).rejects.toMatchObject({ code: 'REDIRECT_LIMIT' })
  })
})

describe('safeFetch: bodies', () => {
  it('caps a large body as it streams and flags it truncated', async () => {
    const chunk = Buffer.alloc(64 * 1024, 'a')
    const { fetch } = fetcherWith({
      'https://funder.example/big': {
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: () =>
          (async function* () {
            for (let i = 0; i < 100; i += 1) yield chunk // 6.4 MB, never fully read
          })(),
      },
    })
    const result = await fetch('https://funder.example/big', { maxBytes: 200_000 })
    expect(result.truncated).toBe(true)
    expect(result.byteLength).toBe(200_000)
  })

  it('bounds decompression too (a small gzip body cannot inflate past the cap)', async () => {
    const bomb = gzipSync(Buffer.alloc(5_000_000, 0))
    const { fetch } = fetcherWith({
      'https://funder.example/bomb': { status: 200, headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' }, body: bomb },
    })
    const result = await fetch('https://funder.example/bomb', { maxBytes: 100_000 })
    expect(result.truncated).toBe(true)
    expect(result.byteLength).toBe(100_000)
  })

  it('reports 304 as not modified with an empty body', async () => {
    const { fetch } = fetcherWith({ 'https://funder.example/calls': { status: 304, headers: { etag: '"v2"' } } })
    const result = await fetch('https://funder.example/calls', { headers: { 'if-none-match': '"v1"' } })
    expect(result.notModified).toBe(true)
    expect(result.byteLength).toBe(0)
  })

  it('detects PDFs by magic bytes even when mislabelled', async () => {
    const { fetch } = fetcherWith({
      'https://funder.example/file': { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: '%PDF-1.7 ...' },
    })
    expect((await fetch('https://funder.example/file')).contentKind).toBe('pdf')
  })

  it('throws typed errors for HTTP failures (5xx retryable, 4xx not)', async () => {
    const { fetch } = fetcherWith({
      'https://funder.example/down': { status: 502, body: 'bad gateway' },
      'https://funder.example/gone': { status: 410, body: 'gone' },
    })
    await expect(fetch('https://funder.example/down')).rejects.toMatchObject({ code: 'HTTP_STATUS', retryable: true, httpStatus: 502 })
    await expect(fetch('https://funder.example/gone')).rejects.toMatchObject({ code: 'HTTP_STATUS', retryable: false, httpStatus: 410 })
  })

  it('turns 429 + Retry-After into a shared host cooldown', async () => {
    const { fetch, pacer } = fetcherWith({
      'https://funder.example/busy': { status: 429, headers: { 'retry-after': '120' } },
    })
    const before = Date.now()
    await expect(fetch('https://funder.example/busy')).rejects.toMatchObject({ code: 'HOST_COOLDOWN', retryable: true })
    expect(pacer.cooldowns).toHaveLength(1)
    expect(pacer.cooldowns[0].host).toBe('funder.example')
    expect(pacer.cooldowns[0].until.getTime()).toBeGreaterThanOrEqual(before + 119_000)
  })

  it('relaxes TLS only for a host with a recorded exception', async () => {
    const { fetch, calls } = fetcherWith({
      'https://funder.example/a': { status: 200, body: 'x' },
      'https://cdn.funder.example/b': { status: 200, body: 'y' },
    })
    const exceptions = new Set(['funder.example'])
    const a = await fetch('https://funder.example/a', { tlsInsecureHosts: exceptions })
    await fetch('https://cdn.funder.example/b', { tlsInsecureHosts: exceptions })
    expect(calls[0].tlsInsecure).toBe(true)
    expect(calls[1].tlsInsecure).toBe(false)
    expect(a.tlsExceptionUsed).toBe(true)
  })
})

describe('safeFetch: robots.txt (RFC 9309)', () => {
  const page = { status: 200, headers: { 'content-type': 'text/html' }, body: '<html>ok</html>' }

  it('obeys a 2xx robots.txt', async () => {
    const { fetch } = fetcherWith(
      {
        'https://funder.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /private\n' },
        'https://funder.example/public': page,
        'https://funder.example/private/x': page,
      },
      { robots: true }
    )
    await expect(fetch('https://funder.example/public')).resolves.toMatchObject({ status: 200 })
    await expect(fetch('https://funder.example/private/x')).rejects.toMatchObject({ code: 'ROBOTS_DISALLOWED' })
  })

  it('treats a 4xx robots.txt as "no rules"', async () => {
    const { fetch } = fetcherWith(
      { 'https://funder.example/robots.txt': { status: 404 }, 'https://funder.example/calls': page },
      { robots: true }
    )
    await expect(fetch('https://funder.example/calls')).resolves.toMatchObject({ status: 200 })
  })

  it('defers — never assumes permission — when robots.txt answers 5xx', async () => {
    const { fetch, calls } = fetcherWith(
      { 'https://funder.example/robots.txt': { status: 503 }, 'https://funder.example/calls': page },
      { robots: true }
    )
    await expect(fetch('https://funder.example/calls')).rejects.toMatchObject({ code: 'ROBOTS_DEFERRED', retryable: true })
    expect(calls.map((call) => call.url.pathname)).toEqual(['/robots.txt'])
  })

  it('treats a 429 robots.txt as overload (defer), not as "unavailable" (allow)', async () => {
    const { fetch, pacer } = fetcherWith(
      { 'https://funder.example/robots.txt': { status: 429, headers: { 'retry-after': '600' } }, 'https://funder.example/calls': page },
      { robots: true }
    )
    await expect(fetch('https://funder.example/calls')).rejects.toMatchObject({ code: 'ROBOTS_DEFERRED' })
    expect(pacer.cooldowns.map((c) => c.host)).toContain('funder.example')
  })

  it('falls back to the last good copy while robots.txt is unreachable', async () => {
    const store = memoryRobotsStore({
      'https://funder.example': {
        state: 'DEFER',
        httpStatus: 503,
        body: null,
        crawlDelayMs: null,
        expiresAt: new Date(Date.now() + 60_000),
        lastGoodAt: new Date(Date.now() - 2 * 86_400_000),
        lastGoodBody: 'User-agent: *\nDisallow: /private\n',
      },
    })
    const { fetch } = fetcherWith(
      { 'https://funder.example/calls': page, 'https://funder.example/private/a': page },
      { robots: true, store }
    )
    await expect(fetch('https://funder.example/calls')).resolves.toMatchObject({ status: 200 })
    await expect(fetch('https://funder.example/private/a')).rejects.toMatchObject({ code: 'ROBOTS_DISALLOWED' })
  })

  it('reports a robots.txt that fails TLS as a TLS error, not an endless deferral', async () => {
    const { fetch } = fetcherWith(
      {
        'https://funder.example/robots.txt': () => {
          throw Object.assign(new Error('unable to get local issuer certificate'), { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })
        },
        'https://funder.example/calls': page,
      },
      { robots: true }
    )
    await expect(fetch('https://funder.example/calls')).rejects.toMatchObject({ code: 'TLS_ERROR', retryable: false })
  })

  it('caches per origin: http and https are separate policies', async () => {
    const routes = {
      'https://funder.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow:\n' },
      'http://funder.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /\n' },
      'https://funder.example/calls': page,
      'http://funder.example/calls': page,
    }
    const { fetch } = fetcherWith(routes, { robots: true })
    await expect(fetch('https://funder.example/calls')).resolves.toMatchObject({ status: 200 })
    await expect(fetch('http://funder.example/calls')).rejects.toMatchObject({ code: 'ROBOTS_DISALLOWED' })
  })

  it('checks robots for the redirect target origin too', async () => {
    const spy = vi.fn()
    const { fetch } = fetcherWith(
      {
        'https://funder.example/robots.txt': { status: 404 },
        'https://cdn.funder.example/robots.txt': (req) => {
          spy(req.url.href)
          return { status: 200, body: 'User-agent: *\nDisallow: /files\n' }
        },
        'https://funder.example/doc': { status: 302, headers: { location: 'https://cdn.funder.example/files/a.pdf' } },
      },
      { robots: true }
    )
    await expect(fetch('https://funder.example/doc')).rejects.toMatchObject({ code: 'ROBOTS_DISALLOWED' })
    expect(spy).toHaveBeenCalledWith('https://cdn.funder.example/robots.txt')
  })
})
