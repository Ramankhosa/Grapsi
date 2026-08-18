/**
 * Fixed-window rate limiter for the funding finder routes.
 *
 * In-process only: the project has no Redis, so each Node worker (PM2 cluster,
 * multiple instances) keeps its own window. Treat the limits as per-worker
 * approximations, not a hard global cap; the FUNDING_CHAT usage ledger is the
 * authoritative quota. Keys must NOT include the client IP or a per-request id
 * (conversation id, etc.) — both let a client mint fresh buckets at will.
 */

type WindowState = {
  count: number;
  resetAt: number;
};

const requestWindows = new Map<string, WindowState>();

/** Sweep expired windows so the map cannot grow without bound. */
const SWEEP_INTERVAL_MS = 60_000;
const SWEEP_SIZE_THRESHOLD = 5_000;
let lastSweepAt = 0;

function sweepExpired(now: number) {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS && requestWindows.size < SWEEP_SIZE_THRESHOLD) return;
  lastSweepAt = now;
  requestWindows.forEach((state, key) => {
    if (state.resetAt <= now) requestWindows.delete(key);
  });
}

export function checkRateLimit(key: string, maxRequests: number, windowMs: number) {
  const now = Date.now();
  sweepExpired(now);
  const existing = requestWindows.get(key);

  if (!existing || existing.resetAt <= now) {
    const nextState = {
      count: 1,
      resetAt: now + windowMs,
    };
    requestWindows.set(key, nextState);
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetAt: nextState.resetAt,
    };
  }

  if (existing.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
    };
  }

  existing.count += 1;
  requestWindows.set(key, existing);

  return {
    allowed: true,
    remaining: maxRequests - existing.count,
    resetAt: existing.resetAt,
  };
}

/** Per-user bucket key for finder routes. Deliberately excludes IP and conversation id. */
export function buildFinderRateLimitKey(bucket: string, userId: string) {
  return `finder:${bucket}:${userId}`;
}

/** Test hook — clears every window. */
export function __resetRateLimitWindowsForTests() {
  requestWindows.clear();
  lastSweepAt = 0;
}

export function __rateLimitWindowCountForTests() {
  return requestWindows.size;
}
