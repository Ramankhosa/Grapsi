import { describe, expect, it } from 'vitest'

import { identifyUrl, sameSiteHost, textBlockKey } from '@/lib/monitor/urlIdentity'

const key = (raw: string, base?: string, options = {}) => identifyUrl(raw, base, options)?.dedupKey

describe('URL identity', () => {
  it('merges tracking-parameter variants of one URL', () => {
    const plain = key('https://dst.gov.in/callforproposals/nest')
    expect(key('https://dst.gov.in/callforproposals/nest?utm_source=home&utm_medium=banner')).toBe(plain)
    expect(key('https://dst.gov.in/callforproposals/nest?fbclid=abc123')).toBe(plain)
    expect(key('https://dst.gov.in/callforproposals/nest?gclid=x&_ga=1.2.3')).toBe(plain)
    expect(key('https://DST.GOV.IN/callforproposals/nest')).toBe(plain)
    expect(key('https://dst.gov.in:443/callforproposals/nest/')).toBe(plain)
  })

  it('keeps case-sensitive paths distinct', () => {
    expect(key('https://x.example/Call/A.pdf')).not.toBe(key('https://x.example/call/a.pdf'))
  })

  it('keeps meaningful query values distinct, and their order irrelevant', () => {
    expect(key('https://birac.example/cfp_view.php?id=118&scheme_type=6')).not.toBe(
      key('https://birac.example/cfp_view.php?id=119&scheme_type=6')
    )
    expect(key('https://birac.example/cfp_view.php?scheme_type=6&id=118')).toBe(
      key('https://birac.example/cfp_view.php?id=118&scheme_type=6')
    )
  })

  it('preserves the original query order and encoding in the canonical URL', () => {
    const identity = identifyUrl('https://x.example/view?b=2&a=1&utm_campaign=z&q=a%20b')
    expect(identity?.canonical).toBe('https://x.example/view?b=2&a=1&q=a%20b')
  })

  it('never merges http with https or www with the bare host by itself', () => {
    expect(key('http://example.org/call')).not.toBe(key('https://example.org/call'))
    expect(key('https://www.example.org/call')).not.toBe(key('https://example.org/call'))
    // …but the crawl scope treats www and the bare host as one site.
    expect(sameSiteHost('www.example.org', 'example.org')).toBe(true)
  })

  it('drops fragments unless a site rule keeps them (SPA routes)', () => {
    expect(key('https://portal.example/#section-2')).toBe(key('https://portal.example/'))
    const rules = { fragmentRules: ['^!/call/'] }
    expect(key('https://portal.example/#!/call/42', undefined, rules)).not.toBe(key('https://portal.example/#!/call/43', undefined, rules))
  })

  it('strips session identifiers in the path and the query', () => {
    expect(key('https://x.example/calls;jsessionid=ABC123?id=5')).toBe(key('https://x.example/calls?id=5'))
    expect(key('https://x.example/calls?id=5&PHPSESSID=zz')).toBe(key('https://x.example/calls?id=5'))
    expect(key('https://x.example/calls?id=5&sid=7', undefined, { sessionParams: ['sid'] })).toBe(key('https://x.example/calls?id=5'))
  })

  it('normalises percent-escape case in the key only', () => {
    expect(key('https://x.example/a%2fb')).toBe(key('https://x.example/a%2Fb'))
  })

  it('resolves relative links and rejects non-web schemes', () => {
    expect(identifyUrl('/scheme/x', 'https://dst.gov.in/callforproposals')?.canonical).toBe('https://dst.gov.in/scheme/x')
    expect(identifyUrl('mailto:office@example.org')).toBeNull()
    expect(identifyUrl('javascript:void(0)')).toBeNull()
    expect(identifyUrl('tel:+911234')).toBeNull()
  })

  it('gives text blocks an identity of their own, not a URL fragment', () => {
    expect(textBlockKey('src_1', 'abc')).toBe('text:src_1:abc')
    expect(textBlockKey('src_1', 'abc')).not.toContain('#')
  })
})
