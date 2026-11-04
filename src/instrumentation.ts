/**
 * Runs once when the Next.js server boots (enabled by
 * `experimental.instrumentationHook` in next.config.js).
 *
 * Node 20 connects with "happy eyeballs" and gives each resolved address only
 * 250 ms before moving on. From the production box (asia-south2) a TCP
 * handshake to Zhipu (open.bigmodel.cn / api.z.ai, Alibaba Cloud HK) takes
 * ~270 ms, and the box has no IPv6 route, so every address was abandoned just
 * short of connecting and fetch failed with `AggregateError [ETIMEDOUT]` from
 * `internalConnectMultiple`. Verified on prod 4 Nov 2026: default settings fail
 * 3/3, a 1000 ms attempt timeout succeeds 3/3. Applies to every outbound
 * connection, so other distant APIs benefit too.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const net = await import('node:net')
  if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === 'function') {
    net.setDefaultAutoSelectFamilyAttemptTimeout(1000)
  }
}
