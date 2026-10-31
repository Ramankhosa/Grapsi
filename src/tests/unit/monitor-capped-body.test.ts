import zlib from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { readCappedBody } from '@/lib/monitor/safeFetch'

describe('readCappedBody', () => {
  it('decodes a compressed body', async () => {
    const body = zlib.gzipSync(Buffer.from('Funding call text '.repeat(200)))
    const read = await readCappedBody((async function* () { yield body })(), 'gzip', 1_000_000)
    expect(read.buffer.toString()).toBe('Funding call text '.repeat(200))
    expect(read.truncated).toBe(false)
  })

  // 27-29 Oct 2026: a timeout in the middle of a gzip body was an unhandled
  // 'error' event on the source stream and took the whole worker down.
  it('rejects, without an unhandled stream error, when a compressed body aborts mid-read', async () => {
    const unhandled: unknown[] = []
    const onUncaught = (error: unknown) => unhandled.push(error)
    process.on('uncaughtException', onUncaught)
    try {
      const gz = zlib.gzipSync(Buffer.from('x'.repeat(100_000)))
      const body = (async function* () {
        yield gz.subarray(0, 64)
        await new Promise((resolve) => setTimeout(resolve, 5))
        throw new DOMException('This operation was aborted', 'AbortError')
      })()
      await expect(readCappedBody(body, 'gzip', 1_000_000)).rejects.toMatchObject({ name: 'AbortError' })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(unhandled).toEqual([])
    } finally {
      process.off('uncaughtException', onUncaught)
    }
  })
})
