import { promises as dns } from 'node:dns'
import { BlockList, isIP } from 'node:net'

import { MonitorFetchError } from './errors'

/**
 * Which network destinations the crawler may connect to.
 *
 * Anything that is not globally routable public unicast is refused: private
 * and loopback space, link-local (which includes the 169.254.169.254 cloud
 * metadata service), CGNAT, multicast, reserved, documentation and
 * benchmarking ranges. IPv6 forms that carry an IPv4 address — mapped, NAT64,
 * 6to4 — are judged by that IPv4 address, so a private target cannot be
 * smuggled through an IPv6 spelling.
 *
 * This is the application-layer check. Production also runs the worker and
 * its browser under OS users whose egress rules deny the same ranges; this
 * module does not replace that boundary (Chromium resolves names itself).
 */

const blockedV4 = new BlockList()
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast (deprecated)
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, incl. 255.255.255.255
]
for (const [network, prefix] of BLOCKED_V4) blockedV4.addSubnet(network, prefix, 'ipv4')

const blockedV6 = new BlockList()
const BLOCKED_V6: Array<[string, number]> = [
  ['::', 96], // unspecified, loopback, IPv4-compatible (deprecated)
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 23], // IETF protocol assignments, incl. Teredo and benchmarking
  ['2001:db8::', 32], // documentation
  ['3fff::', 20], // documentation
  ['5f00::', 16], // SRv6 SIDs
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
]
for (const [network, prefix] of BLOCKED_V6) blockedV6.addSubnet(network, prefix, 'ipv6')

/**
 * Expand an IPv6 literal (already validated by `isIP`) to 8 hextets, folding a
 * trailing dotted quad ("::ffff:1.2.3.4") into the last two.
 */
function ipv6Hextets(address: string): number[] | null {
  let text = address.toLowerCase()
  const zone = text.indexOf('%')
  if (zone !== -1) text = text.slice(0, zone)

  let tail: number[] = []
  const lastColon = text.lastIndexOf(':')
  if (lastColon === -1) return null
  const last = text.slice(lastColon + 1)
  if (last.includes('.')) {
    if (isIP(last) !== 4) return null
    const octets = last.split('.').map(Number)
    tail = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]]
    // Keep a "::" that directly precedes the quad; drop a lone ":" separator.
    let prefix = text.slice(0, lastColon + 1)
    if (!prefix.endsWith('::')) prefix = prefix.slice(0, -1)
    text = prefix
  }

  const halves = text.split('::')
  if (halves.length > 2) return null
  const parse = (part: string): number[] | null => {
    if (part === '') return []
    const groups = part.split(':')
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null
    return groups.map((group) => parseInt(group, 16))
  }
  const head = parse(halves[0])
  const rest = halves.length === 2 ? parse(halves[1]) : []
  if (!head || !rest) return null

  if (halves.length === 1) {
    const hextets = [...head, ...tail]
    return hextets.length === 8 ? hextets : null
  }
  const fill = 8 - (head.length + rest.length + tail.length)
  if (fill < 0) return null
  return [...head, ...new Array(fill).fill(0), ...rest, ...tail]
}

function v4FromHextets(high: number, low: number): string {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
}

function isPublicV4(address: string): boolean {
  return !blockedV4.check(address, 'ipv4')
}

/** True only for a globally routable public unicast address. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPublicV4(address)
  if (family !== 6) return false

  const h = ipv6Hextets(address)
  if (!h) return false

  // IPv4-mapped ::ffff:a.b.c.d — judge the IPv4 address.
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    return isPublicV4(v4FromHextets(h[6], h[7]))
  }
  // NAT64 well-known prefix 64:ff9b::/96 — judge the embedded IPv4 address.
  if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
    return isPublicV4(v4FromHextets(h[6], h[7]))
  }
  // 6to4 2002::/16 — the IPv4 address sits in hextets 1–2.
  if (h[0] === 0x2002) return isPublicV4(v4FromHextets(h[1], h[2]))

  const normalised = h.map((x) => x.toString(16)).join(':')
  if (blockedV6.check(normalised, 'ipv6')) return false
  // Global unicast is 2000::/3; everything else is not the public internet.
  return h[0] >= 0x2000 && h[0] <= 0x3fff
}

const BLOCKED_HOSTNAMES = [/^localhost$/i, /\.localhost$/i, /\.local$/i, /\.internal$/i, /\.home\.arpa$/i]

export const DEFAULT_ALLOWED_PORTS = new Set([80, 443])

/** Reject a URL before any DNS or connection: scheme, credentials, port, name. */
export function assertFetchableUrl(url: URL, allowedPorts: Set<number> = DEFAULT_ALLOWED_PORTS): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new MonitorFetchError('BLOCKED_URL', `Only http(s) URLs are fetched, not ${url.protocol}`, { url: url.href })
  }
  if (url.username || url.password) {
    throw new MonitorFetchError('BLOCKED_URL', 'URLs with embedded credentials are never fetched', { url: url.href })
  }
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
  if (!allowedPorts.has(port)) {
    throw new MonitorFetchError('BLOCKED_URL', `Port ${port} is not an allowed crawl port`, { url: url.href })
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (!hostname) throw new MonitorFetchError('BLOCKED_URL', 'URL has no host', { url: url.href })
  if (BLOCKED_HOSTNAMES.some((pattern) => pattern.test(hostname))) {
    throw new MonitorFetchError('BLOCKED_ADDRESS', `${hostname} is not a public host`, { url: url.href })
  }
  if (isIP(hostname) && !isPublicAddress(hostname)) {
    throw new MonitorFetchError('BLOCKED_ADDRESS', `${hostname} is not a public address`, { url: url.href })
  }
}

export type AddressResolver = (hostname: string) => Promise<string[]>

export const systemResolver: AddressResolver = async (hostname) => {
  const records = await dns.lookup(hostname, { all: true, verbatim: true })
  return records.map((record) => record.address)
}

/**
 * Resolve a host and require EVERY address to be public. Returning the list is
 * what lets the caller pin the connection to exactly these addresses, so a
 * second resolution (DNS rebinding) can never swap in a private one.
 */
export async function resolvePublicAddresses(hostname: string, resolver: AddressResolver = systemResolver): Promise<string[]> {
  const bare = hostname.replace(/^\[|\]$/g, '')
  if (isIP(bare)) {
    if (!isPublicAddress(bare)) throw new MonitorFetchError('BLOCKED_ADDRESS', `${bare} is not a public address`)
    return [bare]
  }
  let addresses: string[]
  try {
    addresses = await resolver(bare)
  } catch (error) {
    throw new MonitorFetchError('DNS_FAILED', `Could not resolve ${bare}`, { retryable: true, cause: error })
  }
  if (addresses.length === 0) {
    throw new MonitorFetchError('DNS_FAILED', `${bare} resolved to no addresses`, { retryable: true })
  }
  const blocked = addresses.filter((address) => !isPublicAddress(address))
  if (blocked.length > 0) {
    throw new MonitorFetchError('BLOCKED_ADDRESS', `${bare} resolves to a non-public address (${blocked[0]})`)
  }
  return addresses
}
