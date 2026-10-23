// Keep one directory screen below the shared three-request server limit,
// including its results, facets, area picker and funder lookup.
let active = 0
const waiting: Array<() => void> = []
function drain() { while (active < 2 && waiting.length) waiting.shift()!() }

export function catalogueFetch(url: string, options: RequestInit = {}): Promise<Response> {
  if (!/^\/api\/(?:recommendations\/(?:manual-search(?:\?|$)|directory\/|funders(?:\?|$))|discovery\/(?:calls|people)(?:\?|$))/.test(url)) return fetch(url, options)
  return new Promise((resolve, reject) => {
    waiting.push(() => {
      if (options.signal?.aborted) { reject(new DOMException('Request cancelled', 'AbortError')); return }
      active++
      // A cancelled UI update must not free a client slot while the server
      // still holds its reservation. Components already discard stale results.
      fetch(url, { ...options, signal: undefined }).then(resolve, reject).finally(() => { active--; drain() })
    })
    drain()
  })
}
