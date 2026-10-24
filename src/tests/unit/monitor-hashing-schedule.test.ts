import { describe, expect, it } from 'vitest'

import { canonicalJson, fingerprint, listingMeaningfulHash, meaningfulText } from '@/lib/monitor/hashing'
import { backoffMs, operationKeys } from '@/lib/monitor/queue'
import { JITTER_WINDOW_MS, cadenceDays, jitterMs, nextCheckAt, startOfIstDay } from '@/lib/monitor/schedule'

describe('meaningful text', () => {
  it('drops volatile lines but keeps dates near calls', () => {
    const text = meaningfulText('Call for proposals — last date 31/12/2026\nVisitors: 1,234,567\nLast updated: 23 Oct 2026\n© 2026 DST')
    expect(text).toBe('Call for proposals — last date 31/12/2026')
  })

  it('applies reviewer ignore rules', () => {
    expect(meaningfulText('Call A\nBanner: Har Ghar Tiranga', ['^Banner:'])).toBe('Call A')
  })

  it('normalises Unicode so composed and decomposed Devanagari hash alike', () => {
    const composed = 'क़'.normalize('NFC')
    const decomposed = 'क़'.normalize('NFD')
    expect(meaningfulText(composed)).toBe(meaningfulText(decomposed))
  })

  it('makes a listing hash independent of item order', () => {
    expect(listingMeaningfulHash(['a|1', 'b|2', 'c|3'])).toBe(listingMeaningfulHash(['c|3', 'a|1', 'b|2']))
    expect(listingMeaningfulHash(['a|1', 'b|2'])).not.toBe(listingMeaningfulHash(['a|1', 'b|3']))
  })
})

describe('fingerprints', () => {
  it('hashes manifests independently of key order and ignores undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
    expect(fingerprint({ a: 1, b: undefined })).toBe(fingerprint({ a: 1 }))
  })
})

describe('schedule', () => {
  it('finds the IST calendar day', () => {
    // 20:00 UTC on 23 Oct is 01:30 IST on 24 Oct.
    expect(startOfIstDay(new Date('2026-10-23T20:00:00Z')).toISOString()).toBe('2026-10-23T18:30:00.000Z')
    expect(startOfIstDay(new Date('2026-10-23T10:00:00Z')).toISOString()).toBe('2026-10-22T18:30:00.000Z')
  })

  it('keeps a daily source on calendar days, spread by a stable jitter', () => {
    const now = new Date('2026-10-23T10:00:00Z') // 15:30 IST
    const next = nextCheckAt(now, 1, 'source-a')
    const dayStart = new Date('2026-10-23T18:30:00Z') // 00:00 IST, 24 Oct
    expect(next.getTime()).toBeGreaterThanOrEqual(dayStart.getTime())
    expect(next.getTime()).toBeLessThan(dayStart.getTime() + JITTER_WINDOW_MS)
    expect(nextCheckAt(now, 1, 'source-a').getTime()).toBe(next.getTime())
    expect(jitterMs('source-a')).not.toBe(jitterMs('source-b'))
  })

  it('treats daily as the floor and weekly as the slowest listing cadence', () => {
    expect(cadenceDays(60)).toBe(1)
    expect(cadenceDays(4320)).toBe(3)
    expect(cadenceDays(100_000)).toBe(7)
  })
})

describe('queue keys and backoff', () => {
  it('keys recurring checks by occurrence, computations by input', () => {
    expect(operationKeys.check('s1', 4)).not.toBe(operationKeys.check('s1', 5))
    expect(operationKeys.stage('TRIAGE', 'f00')).toBe('triage:f00')
    expect(operationKeys.handoff('o1', 2, 'DRAFT')).toBe('handoff:o1:2:DRAFT')
    expect(operationKeys.notify('e1', 'u1', 'EMAIL')).toBe('notify:e1:u1:EMAIL')
  })

  it('backs off exponentially with jitter, capped at six hours', () => {
    expect(backoffMs(1, () => 0.5)).toBe(60_000)
    expect(backoffMs(3, () => 0.5)).toBe(240_000)
    expect(backoffMs(30, () => 1)).toBeLessThanOrEqual(6 * 3600_000 * 1.2)
    expect(backoffMs(2, () => 0)).toBe(96_000)
  })
})
