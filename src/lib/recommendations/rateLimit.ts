type WindowState = {
  count: number;
  resetAt: number;
};

const requestWindows = new Map<string, WindowState>();

export function checkRateLimit(key: string, maxRequests: number, windowMs: number) {
  const now = Date.now();
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
