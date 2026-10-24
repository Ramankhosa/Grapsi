import { describe, expect, it } from 'vitest'

import { MonitorFetchError } from '@/lib/monitor/errors'
import { assertFetchableUrl, isPublicAddress, resolvePublicAddresses } from '@/lib/monitor/netGuard'

describe('isPublicAddress', () => {
  it.each([
    ['8.8.8.8', true],
    ['164.100.94.214', true], // an Indian government host
    ['2606:4700:4700::1111', true],
    ['10.1.2.3', false],
    ['172.16.0.9', false],
    ['192.168.1.1', false],
    ['127.0.0.1', false],
    ['169.254.169.254', false], // cloud metadata
    ['100.64.1.1', false], // CGNAT
    ['0.0.0.0', false],
    ['224.0.0.1', false],
    ['255.255.255.255', false],
    ['198.51.100.7', false], // documentation
    ['::1', false],
    ['::', false],
    ['fe80::1', false],
    ['fd00::1', false],
    ['ff02::1', false],
    ['2001:db8::1', false],
  ])('%s → %s', (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected)
  })

  it('judges IPv4-mapped IPv6 by the IPv4 address', () => {
    expect(isPublicAddress('::ffff:169.254.169.254')).toBe(false)
    expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false)
    expect(isPublicAddress('::ffff:a9fe:a9fe')).toBe(false)
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true)
  })

  it('judges NAT64 and 6to4 by the embedded IPv4 address', () => {
    expect(isPublicAddress('64:ff9b::a9fe:a9fe')).toBe(false) // 169.254.169.254
    expect(isPublicAddress('64:ff9b::808:808')).toBe(true) // 8.8.8.8
    expect(isPublicAddress('2002:0a00:0001::1')).toBe(false) // 10.0.0.1
    expect(isPublicAddress('2002:0808:0808::1')).toBe(true)
  })

  it('rejects things that are not addresses', () => {
    expect(isPublicAddress('example.com')).toBe(false)
    expect(isPublicAddress('')).toBe(false)
  })
})

describe('assertFetchableUrl', () => {
  const blocked = (raw: string) => {
    try {
      assertFetchableUrl(new URL(raw))
      return null
    } catch (error) {
      return (error as MonitorFetchError).code
    }
  }

  it('allows ordinary public http(s) URLs', () => {
    expect(blocked('https://dst.gov.in/callforproposals')).toBeNull()
    expect(blocked('http://www.icmr.gov.in/call-for-proposals')).toBeNull()
  })

  it('refuses other schemes, credentials and odd ports', () => {
    expect(blocked('ftp://example.org/file')).toBe('BLOCKED_URL')
    expect(blocked('https://user:pass@example.org/')).toBe('BLOCKED_URL')
    expect(blocked('https://example.org:8443/')).toBe('BLOCKED_URL')
  })

  it('refuses private literals and local names before any DNS lookup', () => {
    expect(blocked('http://169.254.169.254/latest/meta-data')).toBe('BLOCKED_ADDRESS')
    expect(blocked('http://127.0.0.1/')).toBe('BLOCKED_ADDRESS')
    expect(blocked('http://[::1]/')).toBe('BLOCKED_ADDRESS')
    expect(blocked('http://localhost/')).toBe('BLOCKED_ADDRESS')
    expect(blocked('http://metadata.google.internal/')).toBe('BLOCKED_ADDRESS')
  })
})

describe('resolvePublicAddresses', () => {
  it('returns every address when all are public', async () => {
    await expect(resolvePublicAddresses('funder.example', async () => ['8.8.8.8', '2606:4700::1'])).resolves.toEqual([
      '8.8.8.8',
      '2606:4700::1',
    ])
  })

  it('refuses a host if ANY address is private (no picking the good one)', async () => {
    await expect(resolvePublicAddresses('rebind.example', async () => ['8.8.8.8', '10.0.0.5'])).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    })
  })

  it('reports resolution failure as retryable DNS_FAILED', async () => {
    await expect(
      resolvePublicAddresses('nxdomain.example', async () => {
        throw new Error('ENOTFOUND')
      })
    ).rejects.toMatchObject({ code: 'DNS_FAILED', retryable: true })
  })
})
