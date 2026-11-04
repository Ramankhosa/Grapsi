/**
 * Runs once when the Next.js server boots (enabled by
 * `experimental.instrumentationHook` in next.config.js). It lives at the repo
 * root, not src/: Next looks for it beside the pages dir, and the root
 * `pages/` wins over `src/`. A copy under src/ is silently never built.
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
  // Node-only code sits in its own module so the edge bundle never sees `net`.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node')
  }
}
