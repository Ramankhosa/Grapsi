import { X509Certificate } from 'node:crypto'
import tls from 'node:tls'
import { request } from 'undici'

import { assertFetchableUrl, resolvePublicAddresses, systemResolver } from './netGuard'

/**
 * Completing a server's incomplete certificate chain, the way browsers do.
 *
 * Many government sites send only their own certificate and leave out the
 * intermediate, so a strict client fails with UNABLE_TO_GET_ISSUER_CERT_LOCALLY.
 * The certificate names where its issuer can be downloaded (the "CA Issuers"
 * URL of its Authority Information Access extension). We fetch that issuer,
 * check it really signed the certificate, and retry with it as an extra chain
 * certificate. Trust is unchanged: the chain must still end at a root in
 * Node's own store, because the roots are passed alongside it and partial
 * chains are not accepted. Turned off by MONITOR_TLS_AIA=false.
 */

const AIA_TTL_MS = 24 * 60 * 60 * 1000
const MAX_CERT_BYTES = 64 * 1024
const MAX_DEPTH = 3
const cache = new Map<string, { at: number; pems: string[] }>()

export const MISSING_ISSUER_CODES = new Set(['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT'])

export function aiaEnabled() {
  return process.env.MONITOR_TLS_AIA !== 'false'
}

/** Intermediates already found for a host, if any (cached for a day). */
export function knownIntermediates(host: string): string[] | null {
  const hit = cache.get(host.toLowerCase())
  if (!hit || Date.now() - hit.at > AIA_TTL_MS) return null
  return hit.pems
}

/** Roots plus the found intermediates, for `connect.ca`. */
export function caWith(intermediates: string[]): string[] {
  return [...tls.rootCertificates, ...intermediates]
}

function peerCertificate(address: string, servername: string, port: number): Promise<tls.DetailedPeerCertificate> {
  return new Promise((resolve, reject) => {
    // Read-only: the certificate is inspected, no request is sent over this socket.
    const socket = tls.connect({ host: address, port, servername, rejectUnauthorized: false, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate(true)
      socket.destroy()
      resolve(cert)
    })
    socket.once('timeout', () => { socket.destroy(); reject(new Error('TLS inspection timed out')) })
    socket.once('error', reject)
  })
}

function issuerUrls(cert: { infoAccess?: Record<string, string[] | undefined> | undefined }): string[] {
  return (cert.infoAccess?.['CA Issuers - URI'] ?? []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 2)
}

async function download(url: string): Promise<Buffer | null> {
  const target = new URL(url)
  assertFetchableUrl(target)
  await resolvePublicAddresses(target.hostname, systemResolver)
  const response = await request(target, { method: 'GET', headersTimeout: 10_000, bodyTimeout: 10_000 })
  if (response.statusCode !== 200) { response.body.destroy(); return null }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > MAX_CERT_BYTES) { response.body.destroy(); return null }
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/** A DER or PEM certificate (PKCS#7 bundles are not handled). */
function parseCertificate(bytes: Buffer): X509Certificate | null {
  try { return new X509Certificate(bytes) } catch { return null }
}

/**
 * Find the intermediates a host left out. Returns PEM strings, or null when
 * the chain cannot be completed (no AIA URL, download failed, wrong issuer).
 */
export async function completeChain(host: string, address: string, port: number): Promise<string[] | null> {
  if (!aiaEnabled()) return null
  const known = knownIntermediates(host)
  if (known) return known
  try {
    const peer = await peerCertificate(address, host, port)
    // Walk to the last certificate the server did send.
    let last: tls.DetailedPeerCertificate = peer
    for (let i = 0; i < 10 && last.issuerCertificate && last.issuerCertificate !== last; i += 1) last = last.issuerCertificate
    let child = last.raw ? parseCertificate(last.raw) : null
    let urls = issuerUrls(last)
    const pems: string[] = []
    for (let depth = 0; child && depth < MAX_DEPTH && urls.length; depth += 1) {
      let issuer: X509Certificate | null = null
      for (const url of urls) {
        const bytes = await download(url).catch(() => null)
        const parsed = bytes ? parseCertificate(bytes) : null
        if (parsed && child.checkIssued(parsed) && child.verify(parsed.publicKey)) { issuer = parsed; break }
      }
      if (!issuer) break
      pems.push(issuer.toString())
      // A root needs nothing more; stop once the issuer signed itself.
      if (issuer.checkIssued(issuer)) break
      child = issuer
      urls = issuerUrls({ infoAccess: parseInfoAccess(issuer.infoAccess) })
    }
    if (!pems.length) return null
    cache.set(host.toLowerCase(), { at: Date.now(), pems })
    return pems
  } catch {
    return null
  }
}

/** X509Certificate.infoAccess is text ("CA Issuers - URI:http://…\n…"). */
function parseInfoAccess(text: string | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const line of (text ?? '').split('\n')) {
    const match = /^(.+?) - URI:(.+)$/.exec(line.trim())
    if (match) (out[`${match[1]} - URI`] ??= []).push(match[2])
  }
  return out
}
