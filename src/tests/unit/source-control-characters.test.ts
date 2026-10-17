import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * A scripted edit once wrote a regex's `\b` as a literal backspace byte, which
 * silently disabled a rule (enrichment's "403 goes to review"). Source files
 * must not carry control characters other than tab and line breaks.
 */
const ROOTS = ['src', 'scripts', 'pages']
// Present before this check, and harmless: a regex for NUL written with a
// literal NUL, and a garbled emoji in a log line.
const KNOWN = new Set([
  path.join('src', 'app', 'api', 'grant-prep', 'sessions', '[id]', 'draft-zero', 'generate', 'route.ts'),
  path.join('scripts', 'seed-production-plans.js'),
])

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* sourceFiles(full)
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) yield full
  }
}

describe('source files', () => {
  it('contain no control characters', () => {
    const offending: string[] = []
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        if (KNOWN.has(file)) continue
        const bytes = fs.readFileSync(file)
        const index = bytes.findIndex((byte) => byte < 32 && byte !== 9 && byte !== 10 && byte !== 13)
        if (index >= 0) offending.push(`${file}:${bytes.subarray(0, index).toString('utf8').split('\n').length} (byte ${bytes[index]})`)
      }
    }
    expect(offending).toEqual([])
  })
})
