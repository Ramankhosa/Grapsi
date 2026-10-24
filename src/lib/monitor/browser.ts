import type { Browser, BrowserContext } from 'playwright'

import { MonitorFetchError } from './errors'
import { databaseHostPacer, type HostPacer } from './hostPacing'
import { assertFetchableUrl, resolvePublicAddresses, systemResolver, type AddressResolver } from './netGuard'
import { sourceWatchUserAgent } from './safeFetch'
import { sameSiteHost } from './urlIdentity'

/**
 * The browser tier: renders JavaScript-built listings, loaded only inside the
 * worker process (dynamic import, behind MONITOR_BROWSER_ENABLED).
 *
 * Application-layer controls, all enforced here:
 * - every request is routed through a check: http(s) only, public addresses,
 *   and a host that is the site's own, an approved related/attachment host, or
 *   on the rendering-dependency allowlist (common script CDNs);
 * - WebSockets are refused (routeWebSocket), service workers are blocked, and
 *   images, fonts and media are never loaded;
 * - each render has request, byte and time budgets, a fresh context with no
 *   persistent storage, and closes on timeout or lease loss;
 * - readiness is DOM ready plus a readiness selector (or enough links), never
 *   `networkidle`;
 * - the Chromium sandbox stays on.
 *
 * Chromium resolves DNS itself, so the address check here cannot pin its
 * connections. The mandatory network boundary is the OS-level egress rule on
 * the browser's user (see the Phase 0/rollout notes); this layer is defence in
 * depth and the reason a blocked request is visible in the evidence.
 */

export interface RenderOptions {
  inScope: (host: string) => boolean
  readinessSelector?: string | null
  minDelayMs: number
  signal?: AbortSignal
}

export interface RenderResult {
  html: string
  finalUrl: string
  requests: number
  blockedRequests: number
  /** Hosts the page tried to reach that are outside the site's approved scope. */
  blockedHosts: string[]
  bytes: number
  truncated: boolean
  ready: boolean
}

export interface Renderer {
  render(url: string, options: RenderOptions): Promise<RenderResult>
  close(): Promise<void>
}

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'font', 'media'])
const MAX_REQUESTS = 150
const MAX_BYTES = 8 * 1024 * 1024
const MAX_HTML_CHARS = 5_000_000
const NAVIGATION_TIMEOUT_MS = 20_000
const READINESS_TIMEOUT_MS = 10_000
const RECYCLE_AFTER_RENDERS = 50

/** Script/style CDNs a rendered funder page commonly needs. Overridable by env. */
const DEFAULT_DEPENDENCY_HOSTS = [
  'ajax.googleapis.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'code.jquery.com',
  'stackpath.bootstrapcdn.com',
  'maxcdn.bootstrapcdn.com',
  'fonts.googleapis.com',
  'www.gstatic.com',
]

function dependencyHosts(): string[] {
  const configured = process.env.MONITOR_BROWSER_DEPENDENCY_HOSTS
  return configured ? configured.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean) : DEFAULT_DEPENDENCY_HOSTS
}

class Semaphore {
  private active = 0
  private waiters: Array<() => void> = []
  constructor(private readonly limit: number) {}
  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.active += 1
    return () => {
      this.active -= 1
      this.waiters.shift()?.()
    }
  }
}

/** Test seam: answers requests that passed every check, instead of the network. */
export type FixtureResponder = (url: string) => { status: number; contentType: string; body: string } | null

export async function createBrowserRenderer(
  deps: { pacer?: HostPacer | null; resolver?: AddressResolver; maxConcurrent?: number; fixtureResponder?: FixtureResponder } = {}
): Promise<Renderer> {
  const { chromium } = await import('playwright')
  const pacer = deps.pacer === undefined ? databaseHostPacer : deps.pacer
  const resolver = deps.resolver ?? systemResolver
  const semaphore = new Semaphore(deps.maxConcurrent ?? 1)
  const deps_ = dependencyHosts()

  let browser: Browser | null = null
  let renders = 0

  async function getBrowser(): Promise<Browser> {
    if (browser && renders >= RECYCLE_AFTER_RENDERS) {
      const old = browser
      browser = null
      await old.close().catch(() => undefined)
    }
    if (!browser) {
      browser = await chromium.launch({ headless: true, chromiumSandbox: true })
      renders = 0
    }
    return browser
  }

  async function render(url: string, options: RenderOptions): Promise<RenderResult> {
    const release = await semaphore.acquire()
    let context: BrowserContext | null = null
    const onAbort = () => void context?.close().catch(() => undefined)
    try {
      if (options.signal?.aborted) throw new MonitorFetchError('ABORTED', 'Render aborted before it started')
      const target = new URL(url)
      assertFetchableUrl(target)
      await resolvePublicAddresses(target.hostname, resolver)

      const instance = await getBrowser()
      renders += 1
      context = await instance.newContext({
        userAgent: sourceWatchUserAgent(),
        serviceWorkers: 'block',
        acceptDownloads: false,
        ignoreHTTPSErrors: false,
        javaScriptEnabled: true,
      })
      options.signal?.addEventListener('abort', onAbort, { once: true })

      let requests = 0
      let blockedRequests = 0
      let bytes = 0
      const resolved = new Map<string, boolean>()
      const blockedHosts = new Set<string>()

      await context.routeWebSocket(/.*/, (ws) => {
        blockedRequests += 1
        void ws.close({ code: 1008, reason: 'WebSockets are not allowed for Source Watch renders' })
      })

      await context.route('**/*', async (route) => {
        const request = route.request()
        try {
          if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
            blockedRequests += 1
            return await route.abort('blockedbyclient')
          }
          requests += 1
          if (requests > MAX_REQUESTS || bytes > MAX_BYTES) {
            blockedRequests += 1
            return await route.abort('blockedbyclient')
          }
          const requestUrl = new URL(request.url())
          assertFetchableUrl(requestUrl)
          const host = requestUrl.hostname.toLowerCase()
          const allowedHost = options.inScope(host) || deps_.some((dep) => sameSiteHost(dep, host))
          if (!allowedHost) {
            blockedRequests += 1
            blockedHosts.add(host)
            return await route.abort('blockedbyclient')
          }
          if (!resolved.has(host)) {
            try {
              await resolvePublicAddresses(host, resolver)
              resolved.set(host, true)
            } catch {
              resolved.set(host, false)
            }
          }
          if (!resolved.get(host)) {
            blockedRequests += 1
            return await route.abort('blockedbyclient')
          }
          if (request.isNavigationRequest() && request.frame() === request.frame().page()?.mainFrame() && pacer) {
            await pacer.acquire(host, options.minDelayMs, options.signal)
          }
          if (deps.fixtureResponder) {
            const fixture = deps.fixtureResponder(requestUrl.href) ?? { status: 404, contentType: 'text/plain', body: 'no fixture' }
            return await route.fulfill({ status: fixture.status, contentType: fixture.contentType, body: fixture.body })
          }
          return await route.continue()
        } catch {
          blockedRequests += 1
          return route.abort('blockedbyclient').catch(() => undefined)
        }
      })

      const page = await context.newPage()
      // Count bytes actually received (not Content-Length, which can be absent
      // or false). Once the budget is spent, every further request is refused
      // by the route above and the render is reported truncated. A single
      // response already in flight cannot be cut mid-stream from here; the OS
      // egress boundary and the HTML size cap bound that case.
      page.on('requestfinished', (request) => {
        void request
          .sizes()
          .then((sizes) => {
            bytes += Math.max(0, sizes.responseBodySize) + Math.max(0, sizes.responseHeadersSize)
          })
          .catch(() => undefined)
      })

      await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })

      let ready = true
      if (options.readinessSelector?.trim()) {
        ready = await page
          .waitForSelector(options.readinessSelector.trim(), { timeout: READINESS_TIMEOUT_MS })
          .then(() => true)
          .catch(() => false)
      } else {
        // Content links only: a cookie banner and a menu are ready long before
        // the listing they sit around has loaded.
        ready = await page
          .waitForFunction(
            () =>
              Array.from(document.querySelectorAll('a[href]')).filter(
                (a) => !a.closest('nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="dialog"], [aria-modal="true"]')
              ).length >= 5,
            null,
            { timeout: READINESS_TIMEOUT_MS }
          )
          .then(() => true)
          .catch(() => false)
      }

      let html = await page.content()
      let truncated = bytes > MAX_BYTES
      if (html.length > MAX_HTML_CHARS) {
        html = html.slice(0, MAX_HTML_CHARS)
        truncated = true
      }
      return { html, finalUrl: page.url(), requests, blockedRequests, blockedHosts: [...blockedHosts].sort(), bytes, truncated, ready }
    } catch (error) {
      if (error instanceof MonitorFetchError) throw error
      if (options.signal?.aborted) throw new MonitorFetchError('ABORTED', 'Render was cancelled')
      throw new MonitorFetchError('BROWSER', `Render of ${url} failed: ${error instanceof Error ? error.message : String(error)}`, {
        retryable: true,
        url,
      })
    } finally {
      options.signal?.removeEventListener('abort', onAbort)
      await context?.close().catch(() => undefined)
      release()
    }
  }

  return {
    render,
    async close() {
      const current = browser
      browser = null
      await current?.close().catch(() => undefined)
    },
  }
}
