/** Trailing-slash and fragment differences shouldn't create duplicate watches. */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.hash = ''
    let normalized = url.toString()
    if (url.pathname !== '/' && normalized.endsWith('/')) normalized = normalized.slice(0, -1)
    return normalized
  } catch {
    return raw
  }
}
