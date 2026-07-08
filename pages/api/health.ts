import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Lightweight liveness probe.
 *
 * Intentionally does NOT touch the database or any external service — it only
 * confirms that the Next.js server process is up and serving. This is used by:
 *   - the zero-downtime deploy script (scripts/deploy.sh) to health-gate a new
 *     release before switching traffic to it, and
 *   - an upstream health check (nginx / GCP load balancer) if configured.
 *
 * Keep it fast and dependency-free so a struggling database can never make the
 * process look "down" and trigger an unnecessary restart/rollback.
 */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
}
