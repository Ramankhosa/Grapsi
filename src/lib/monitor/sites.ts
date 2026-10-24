import { prisma } from '@/lib/prisma'
import type { MonitorSite } from '@/lib/prisma-generated'

import type { Db } from './queue'
import { hostOf, sameSiteHost } from './urlIdentity'

/**
 * The site for a URL's host, created ACTIVE on first sight when an operator
 * adds a watch point by hand (catalog seeding creates SUGGESTED sites instead).
 */
export async function ensureSiteForUrl(url: string, actorUserId: string | null, db: Db = prisma): Promise<MonitorSite> {
  const host = hostOf(url)
  if (!host) throw new Error(`Cannot derive a host from ${url}`)
  return db.monitorSite.upsert({
    where: { host },
    create: { host, status: 'ACTIVE', origin: 'MANUAL', created_by_user_id: actorUserId },
    update: {},
  })
}

/**
 * Hosts a site's crawl may touch: its own host (www or not), the related hosts
 * an admin approved, and attachment-only hosts. Redirects anywhere else stop
 * the fetch with REDIRECT_OUT_OF_SCOPE rather than wandering off-site.
 */
export function siteScope(site: Pick<MonitorSite, 'host' | 'related_hosts' | 'attachment_hosts'>): (host: string) => boolean {
  const allowed = [site.host, ...site.related_hosts, ...site.attachment_hosts].map((h) => h.toLowerCase())
  return (host: string) => allowed.some((candidate) => sameSiteHost(candidate, host))
}

interface TlsException {
  reason?: string
  approved_by?: string
  expires_at?: string
}

/** Hosts whose recorded TLS exception is present and unexpired. Never inferred. */
export function tlsExceptionHosts(site: Pick<MonitorSite, 'host' | 'tls_exception'>, now = new Date()): Set<string> {
  const exception = site.tls_exception as TlsException | null
  if (!exception?.expires_at || !exception.approved_by) return new Set()
  const expires = Date.parse(exception.expires_at)
  if (Number.isNaN(expires) || expires <= now.getTime()) return new Set()
  return new Set([site.host.toLowerCase()])
}

/** A site is paused after this many consecutive FETCH failures (never provider failures). */
export const SITE_AUTO_PAUSE_FAILURES = 7
