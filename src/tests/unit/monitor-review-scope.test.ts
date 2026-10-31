import { describe, expect, it } from 'vitest'
import { createSafeFetcher } from '@/lib/monitor/safeFetch'

describe('independent review: approved host boundary', () => {
  it('checks an initial discovered URL against the site scope before connecting', async () => {
    let connected = false
    const fetch = createSafeFetcher({
      resolver: async () => ['93.184.216.34'], robots: null, pacer: null,
      transport: async () => {
        connected = true
        return { status: 200, headers: {}, body: (async function* () { yield Buffer.from('unapproved host') })(), close: async () => undefined }
      },
    })
    await expect(fetch('https://unapproved.example/sitemap.xml', {
      inScope: host => host === 'approved.example',
    })).rejects.toMatchObject({ code: 'REDIRECT_OUT_OF_SCOPE' })
    expect(connected).toBe(false)
  })
})
