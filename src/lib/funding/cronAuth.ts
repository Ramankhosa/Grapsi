import { NextRequest } from 'next/server'

/**
 * Schedulers authenticate with the same shared secret the funding alert jobs
 * use — one scheduler credential for the whole product. The secret must be
 * configured server-side for the header path to work at all, so an unset env
 * can never open the route.
 *
 * Shared by every cron-callable route; routes fall back to interactive
 * funding-operator auth when the header is absent.
 */
export function isCronRequest(request: NextRequest): boolean {
  const secret = process.env.FUNDING_ALERT_CRON_SECRET
  if (!secret) {
    return false
  }
  return request.headers.get('x-funding-alert-secret') === secret
}
