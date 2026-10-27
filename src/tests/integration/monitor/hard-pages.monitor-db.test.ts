import AdmZip from 'adm-zip'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => {
  const { testPrisma } = await import('../helpers/monitorTestPrisma')
  return { prisma: testPrisma, default: testPrisma }
})

import type { Renderer } from '@/lib/monitor/browser'
import { queueCandidates } from '@/lib/monitor/candidates'
import { readResource } from '@/lib/monitor/content'
import { MonitorFetchError } from '@/lib/monitor/errors'
import { planDueChecks } from '@/lib/monitor/planner'
import { claimNextTask } from '@/lib/monitor/queue'
import type { SafeFetch, SafeFetchResult } from '@/lib/monitor/safeFetch'
import { runSourceMonitorWorker } from '@/lib/monitor/worker'

import { resetMonitorTables, testPrisma as db } from '../helpers/monitorTestPrisma'

/**
 * Pages that do not give up their text easily (27 Oct 2026): script-built
 * shells, bot checks, spreadsheets, and listings kept inside a frame.
 */

beforeEach(async () => { await resetMonitorTables() })
afterAll(async () => { await resetMonitorTables(); await db.$disconnect() })

function answer(url: string, body: Buffer | string, contentType: string, contentKind: SafeFetchResult['contentKind'], status = 200): SafeFetchResult {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body)
  return { requestedUrl: url, finalUrl: url, status, headers: {}, body: bytes, byteLength: bytes.length, truncated: false, contentKind, contentType, notModified: false, redirects: [], tlsExceptionUsed: false }
}
const serve = (map: Record<string, SafeFetchResult>) => {
  const calls: string[] = []
  const fetch: SafeFetch = async (url) => {
    calls.push(url)
    if (!map[url]) throw new MonitorFetchError('HTTP_STATUS', `404 ${url}`, { httpStatus: 404 })
    return map[url]
  }
  return { fetch, calls }
}

async function evidencePage(url: string) {
  const site = await db.monitorSite.create({ data: { host: 'hard.invalid', status: 'ACTIVE', min_delay_ms: 0 } })
  const resource = await db.monitorResource.create({ data: { site_id: site.id, dedup_key: url, canonical_url: url, title: 'Call' } })
  await queueCandidates(db, site.id, [resource.id], false, `hard:${url}`)
  const lease = (await claimNextTask({ owner: 'hard-pages', kinds: ['TRIAGE'] }))!
  return { site, resource, lease }
}
const version = async (resourceId: string) => {
  const r = await db.monitorResource.findUniqueOrThrow({ where: { id: resourceId } })
  return db.monitorResourceVersion.findUniqueOrThrow({ where: { id: r.current_version_id! } })
}

const SHELL = `<html><head><title>Call</title>
  <script type="application/ld+json">{"@type":"Grant","name":"Ocean Data Fellowship","description":"Fellowships for researchers building open ocean datasets, two years, full salary.","validThrough":"2027-04-30"}</script>
  </head><body><div id="root"></div><script src="/app.js"></script></body></html>`

describe('script-built evidence pages', () => {
  it('without a browser, reads the data the page carries', async () => {
    const url = 'https://hard.invalid/calls/ocean'
    const { site, resource, lease } = await evidencePage(url)
    const { fetch } = serve({ [url]: answer(url, SHELL, 'text/html', 'html') })
    const result = await readResource(resource, site, lease, fetch)
    expect(result.segments.map((s) => s.text).join('\n')).toContain('name: Ocean Data Fellowship')
    const v = await version(resource.id)
    expect(v.parser_version).toBe('html-data-1')
    expect(v.truncated).toBe(false)
  })

  it('with the browser tier, renders the shell and reads the rendered page', async () => {
    const url = 'https://hard.invalid/calls/ocean'
    const { site, resource, lease } = await evidencePage(url)
    const { fetch } = serve({ [url]: answer(url, SHELL, 'text/html', 'html') })
    const render = vi.fn<Renderer['render']>(async () => ({
      html: `<html><body><main><h1>Ocean Data Fellowship</h1><p>${'Applications are invited from early career researchers. '.repeat(12)}Closing date 30 April 2027.</p></main></body></html>`,
      finalUrl: url, requests: 3, blockedRequests: 0, blockedHosts: [], bytes: 1000, truncated: false, ready: true,
    }))
    const result = await readResource(resource, site, lease, fetch, undefined, { render, close: async () => undefined })
    expect(render).toHaveBeenCalledTimes(1)
    expect(result.segments.map((s) => s.text).join('\n')).toContain('Closing date 30 April 2027')
    expect((await version(resource.id)).parser_version).toBe('html-rendered-1')
  })

  it('a page that reads well is never rendered', async () => {
    const url = 'https://hard.invalid/calls/plain'
    const { site, resource, lease } = await evidencePage(url)
    const page = `<html><body><div id="root"><main><p>${'This research grant supports pilot studies in public health. '.repeat(10)}</p></main></div></body></html>`
    const render = vi.fn<Renderer['render']>()
    await readResource(resource, site, lease, serve({ [url]: answer(url, page, 'text/html', 'html') }).fetch, undefined, { render, close: async () => undefined })
    expect(render).not.toHaveBeenCalled()
    expect((await version(resource.id)).parser_version).toBe('html-1')
  })
})

describe('bot checks and files', () => {
  it('a bot check is recorded as such, not read as the page', async () => {
    const url = 'https://hard.invalid/calls/guarded'
    const { site, resource, lease } = await evidencePage(url)
    const challenge = '<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script></body></html>'
    await expect(readResource(resource, site, lease, serve({ [url]: answer(url, challenge, 'text/html', 'html') }).fetch)).rejects.toMatchObject({ code: 'BOT_PROTECTED' })
    expect((await db.monitorResource.findUniqueOrThrow({ where: { id: resource.id } })).last_validation_status).toBe('BOT_PROTECTED')
    expect(await db.monitorResourceVersion.count()).toBe(0)
  })

  it('reads a spreadsheet of calls', async () => {
    const url = 'https://hard.invalid/files/calls.xlsx'
    const { site, resource, lease } = await evidencePage(url)
    const zip = new AdmZip()
    zip.addFile('xl/workbook.xml', Buffer.from('<workbook/>'))
    zip.addFile('xl/worksheets/sheet1.xml', Buffer.from('<worksheet><sheetData><row><c t="inlineStr"><is><t>Seed grant for rural health pilots, closing 15 March 2027</t></is></c></row></sheetData></worksheet>'))
    const result = await readResource(resource, site, lease, serve({ [url]: answer(url, zip.toBuffer(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'binary') }).fetch)
    expect(result.segments.map((s) => s.text).join('\n')).toContain('Seed grant for rural health pilots')
    expect((await version(resource.id)).parser_version).toBe('office-1:xlsx')
  })
})

describe('a listing kept inside a frame', () => {
  it('reads the same-site frame when the page itself lists nothing', async () => {
    const site = await db.monitorSite.create({ data: { host: 'frames.invalid', status: 'ACTIVE', min_delay_ms: 0 } })
    await db.monitoredSource.create({ data: { name: 'framed', url: 'https://frames.invalid/', site_id: site.id, next_check_at: new Date(Date.now() - 60_000), fetch_mode: 'FETCH' } })
    const list = `<html><body><main><ul>${['a', 'b', 'c'].map((x) => `<li><a href="/calls/${x}.html">Research grant call ${x} — last date 30/11/2026</a></li>`).join('')}</ul></main></body></html>`
    const { fetch, calls } = serve({
      'https://frames.invalid/': answer('https://frames.invalid/', '<html><frameset cols="20%,80%"><frame src="/menu.html"><frame src="/calls.html"></frameset></html>', 'text/html', 'html'),
      'https://frames.invalid/menu.html': answer('https://frames.invalid/menu.html', '<html><body><a href="/">Home</a></body></html>', 'text/html', 'html'),
      'https://frames.invalid/calls.html': answer('https://frames.invalid/calls.html', list, 'text/html', 'html'),
    })
    await planDueChecks(new Date())
    await runSourceMonitorWorker({ once: true, concurrency: 1, fetch, renderer: null, workerId: 'frames' })
    expect(calls).toContain('https://frames.invalid/calls.html')
    const urls = (await db.monitorResource.findMany({ where: { site_id: site.id } })).map((r) => r.canonical_url)
    expect(urls).toEqual(expect.arrayContaining(['https://frames.invalid/calls/a.html', 'https://frames.invalid/calls/c.html']))
  })
})
