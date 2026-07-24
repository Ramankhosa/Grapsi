import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildReviewerSourceBundle, fetchReviewerSourceDocument } from '@/lib/reviewer/sourceText'

const CALL_PAGE_HTML = `<!doctype html>
<html>
  <head>
    <title>National Green Hydrogen R&D Call</title>
    <style>.nav { color: red; }</style>
    <script>window.analytics = 1;</script>
  </head>
  <body>
    <nav><a href="/home">Home</a></nav>
    <h1>National Green Hydrogen R&amp;D Call 2026</h1>
    <p>The Ministry invites proposals from recognised research institutions.</p>
    <h2>Eligibility</h2>
    <p>The Principal Investigator must hold a regular position. Private firms may not apply alone.</p>
    <h2>Proposal format</h2>
    <ul>
      <li>Abstract: maximum 300 words.</li>
      <li>Objectives and Methodology: maximum 2000 words.</li>
      <li>Budget: the total grant is capped at Rs 50 lakhs over 24 months.</li>
    </ul>
    <h2>Evaluation criteria</h2>
    <p>Scientific merit 40 marks, industrial relevance 30 marks, team capability 30 marks.</p>
    <h2>Submission</h2>
    <p>Upload the signed endorsement form on the portal before 31 March 2026.</p>
  </body>
</html>`

let server: http.Server
let baseUrl = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/call') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(CALL_PAGE_HTML)
      return
    }
    if (req.url === '/annexure') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<html><body><h1>Annexure II</h1><p>Attach the institutional overhead certificate. Overheads must not exceed 10 percent of the sanctioned amount.</p></body></html>')
      return
    }
    if (req.url === '/thin') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<html><body><p>Coming soon.</p></body></html>')
      return
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('reviewer source fetching', () => {
  it('reads a call page as text and drops scripts, styles, and chrome', async () => {
    const document = await fetchReviewerSourceDocument(`${baseUrl}/call`)

    expect(document.kind).toBe('html')
    expect(document.httpStatus).toBe(200)
    // html-to-text upper-cases headings, so match case-insensitively.
    expect(document.text).toMatch(/national green hydrogen r&d call 2026/i)
    expect(document.text).toContain('maximum 2000 words')
    expect(document.text).toContain('capped at Rs 50 lakhs')
    expect(document.text).not.toContain('window.analytics')
    expect(document.text).not.toContain('color: red')
  })

  it('bundles several sources, fingerprints them, and labels each one', async () => {
    const bundle = await buildReviewerSourceBundle([`${baseUrl}/call`, `${baseUrl}/annexure`])

    expect(bundle.documents).toHaveLength(2)
    expect(bundle.skipped).toEqual([])
    expect(bundle.combinedText).toContain('### SOURCE:')
    expect(bundle.promptText).toContain('Scientific merit 40 marks')
    expect(bundle.promptText).toContain('Overheads must not exceed 10 percent')
    expect(bundle.sourceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(bundle.truncated).toBe(false)
  })

  it('produces the same fingerprint for the same bytes, so a repeat analysis can be reused', async () => {
    const first = await buildReviewerSourceBundle([`${baseUrl}/call`])
    const second = await buildReviewerSourceBundle([`${baseUrl}/call`])

    expect(second.sourceHash).toBe(first.sourceHash)
  })

  it('skips a landing page with no usable text and reports why', async () => {
    const bundle = await buildReviewerSourceBundle([`${baseUrl}/thin`, `${baseUrl}/call`])

    expect(bundle.documents.map((document) => document.url)).toEqual([`${baseUrl}/call`])
    expect(bundle.skipped).toEqual([
      { url: `${baseUrl}/thin`, reason: 'the page returned almost no readable text' },
    ])
  })

  it('records the fetch failure for an unreachable link instead of dropping it silently', async () => {
    const bundle = await buildReviewerSourceBundle([`${baseUrl}/missing`, `${baseUrl}/call`])

    expect(bundle.documents).toHaveLength(1)
    expect(bundle.skipped[0].url).toBe(`${baseUrl}/missing`)
    expect(bundle.skipped[0].reason).toBeTruthy()
  })

  it('fails with the underlying reason when nothing is readable', async () => {
    await expect(buildReviewerSourceBundle([`${baseUrl}/missing`])).rejects.toThrow(
      /Could not read any of the supplied URLs/
    )
  })

  it('refuses a non-http scheme', async () => {
    await expect(fetchReviewerSourceDocument('file:///etc/passwd')).rejects.toThrow()
  })
})
