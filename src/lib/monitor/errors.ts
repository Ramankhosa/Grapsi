/**
 * Typed fetch failures. The worker decides retry versus give-up from `code`
 * and `retryable`, never by reading message strings.
 */
export type MonitorFetchErrorCode =
  | 'BLOCKED_URL'
  | 'BLOCKED_ADDRESS'
  | 'DNS_FAILED'
  | 'REDIRECT_LIMIT'
  | 'REDIRECT_OUT_OF_SCOPE'
  | 'TOO_LARGE'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'HTTP_STATUS'
  | 'UNEXPECTED_CONTENT_TYPE'
  | 'ROBOTS_DISALLOWED'
  | 'ROBOTS_DEFERRED'
  | 'HOST_COOLDOWN'
  | 'HOST_BUSY'
  | 'TLS_ERROR'
  | 'NETWORK'
  | 'BROWSER'

export class MonitorFetchError extends Error {
  readonly code: MonitorFetchErrorCode
  readonly retryable: boolean
  /** When a deferral may be retried (cooldowns, busy hosts, robots defer). */
  readonly retryAt?: Date
  readonly httpStatus?: number
  readonly url?: string

  constructor(
    code: MonitorFetchErrorCode,
    message: string,
    options: { retryable?: boolean; retryAt?: Date; httpStatus?: number; url?: string; cause?: unknown } = {}
  ) {
    super(message)
    this.name = 'MonitorFetchError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.retryAt = options.retryAt
    this.httpStatus = options.httpStatus
    this.url = options.url
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause
  }

  /**
   * A deferral is not a failure: the host asked us to wait (cooldown, busy,
   * robots unreachable). It must not count toward a site's failure streak.
   */
  get isDeferral(): boolean {
    return this.code === 'HOST_COOLDOWN' || this.code === 'HOST_BUSY' || this.code === 'ROBOTS_DEFERRED'
  }
}

export function isMonitorFetchError(error: unknown): error is MonitorFetchError {
  return error instanceof MonitorFetchError
}
