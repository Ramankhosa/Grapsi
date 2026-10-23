import { describe, expect, it } from 'vitest'
import { EMPTY_DISCOVERY_QUERY, discoverySearchLink, readDiscoveryQuery } from '@/lib/discovery/types'

describe('shareable discovery search context', () => {
  it('round trips the complete search without losing special characters', () => {
    const state = { ...EMPTY_DISCOVERY_QUERY, task: 'alignment' as const, mode: 'semantic' as const, query: 'C++ & health',
      areaIds: ['scientify:discipline:bio'], unitId: 'school', callId: 'call', callTitle: 'Health & AI', includeClosed: true, sort: 'deadline_soonest' as const }
    expect(readDiscoveryQuery(new URL(discoverySearchLink(state), 'https://example.test').searchParams)).toEqual(state)
  })
  it('normalizes unknown task/mode values and bounds pasted search context', () => {
    const params = new URLSearchParams({ task: 'admin', mode: 'execute', q: 'x'.repeat(500), unit: 'u'.repeat(300) })
    for (let i = 0; i < 30; i++) params.append('area', `area${i}`)
    const value = readDiscoveryQuery(params)
    expect(value.task).toBe('calls'); expect(value.mode).toBe('standard')
    expect(value.query).toHaveLength(300); expect(value.unitId).toHaveLength(120); expect(value.areaIds).toHaveLength(20)
  })
})
