import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '../../../middleware'
import { PatentNestClient, resolvePatentNestBaseUrl } from '@/lib/patentnest/client'
import { PATENT_MAX_REQUEST_BYTES, readPatentJson } from '@/lib/patentIntelligence/http'
import { buildShortlistCsv, toPatentSearchItem } from '@/lib/patentIntelligence/searchCore'
import { patentErrorResponse } from '@/lib/patentIntelligence/service'
import type { PatentShortlistItemDto } from '@/lib/patentIntelligence/types'

afterEach(() => vi.unstubAllEnvs())

describe('PatentNest credential transport', () => {
  it.each(['http://patentnest.ai', 'https://user:password@patentnest.ai', 'https://patentnest.ai/api', 'https://patentnest.ai?target=other', 'https://patentnest.ai#fragment', 'file:///etc/passwd'])('rejects unsafe origin %s', origin => {
    expect(() => resolvePatentNestBaseUrl(origin)).toThrow()
  })
  it('allows HTTPS origins and loopback development origins', () => {
    expect(resolvePatentNestBaseUrl('https://patentnest.ai/')).toBe('https://patentnest.ai')
    expect(resolvePatentNestBaseUrl('http://127.0.0.1:4011')).toBe('http://127.0.0.1:4011')
  })
  it('disallows redirects on requests carrying the server credential', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { publicationNumber: 'IN1' }, meta: { requestId: 'secure', durationMs: 1 } })))
    const client = new PatentNestClient({ apiKey: 'pn_live_test', fetchImplementation: fetchMock })
    await client.getPatent('IN1')
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error', cache: 'no-store' }))
    await expect(client.getPatent('..')).rejects.toMatchObject({ code: 'INVALID_PUBLICATION_NUMBER' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('Patent API request boundaries', () => {
  it('blocks the unused public image optimizer without blocking direct image files', () => {
    expect(middleware(new NextRequest('https://aigrantmentor.com/_next/image?url=/brand/logo.svg&w=640&q=75')).status).toBe(404)
    expect(middleware(new NextRequest('https://aigrantmentor.com/brand/logo.svg')).status).toBe(200)
  })
  it('rejects oversized declared and undeclared bodies with 413', async () => {
    const declared = new NextRequest('http://localhost/api/patent-intelligence/search', { method: 'POST', body: '{}', headers: { 'content-length': String(PATENT_MAX_REQUEST_BYTES + 1) } })
    await expect(readPatentJson(declared)).rejects.toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' })
    const streamed = new NextRequest('http://localhost/api/patent-intelligence/search', { method: 'POST', body: JSON.stringify({ query: 'a'.repeat(PATENT_MAX_REQUEST_BYTES) }) })
    const error = await readPatentJson(streamed).catch(error => error)
    expect(error).toMatchObject({ status: 413 })
    expect(patentErrorResponse(error).status).toBe(413)
  })
  it('rejects malformed JSON and accepts valid Unicode within the byte limit', async () => {
    await expect(readPatentJson(new NextRequest('http://localhost', { method: 'POST', body: '{' }))).rejects.toMatchObject({ status: 400 })
    await expect(readPatentJson(new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify({ filters: { applicants: ['Université'] } }) }))).resolves.toEqual({ filters: { applicants: ['Université'] } })
  })
})

describe('Patent CSV export security', () => {
  it.each(['=HYPERLINK("https://example.com")', '+SUM(1,2)', '-1+2', '@SUM(1)', ' \t=1+1', '\tformula', '\rformula'])('exports formula-looking text as literal text: %j', note => {
    const record = toPatentSearchItem({ publicationNumber: 'IN1', title: 'Safe' })!
    const csv = buildShortlistCsv([{ record, note, createdAt: '2026-11-03' } as PatentShortlistItemDto])
    expect(csv).toContain(`'${note.replace(/"/g, '""')}`)
  })
})
