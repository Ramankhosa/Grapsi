import { describe, expect, it } from 'vitest'
import { EMPTY_DISCOVERY_QUERY, discoverySearchLink, legacySavedSearchLink, readDiscoveryQuery } from '@/lib/discovery/types'
import { decodeDirectoryFilters } from '@/lib/recommendations/directoryUrl'

const read = (link: string) => readDiscoveryQuery(new URL(link, 'https://example.test').searchParams)
describe('shareable discovery search context', () => {
  it('round trips the people filters and special characters', () => {
    const state = { ...EMPTY_DISCOVERY_QUERY, tab: 'people' as const, peopleMode: 'call' as const, query: 'C++ & health',
      areaIds: ['scientify:discipline:bio'], unitId: 'school', callId: 'call', callTitle: 'Health & AI', includeSubunits: false,
      designation: 'Professor', careerStage: 'SENIOR' }
    expect(read(discoverySearchLink(state))).toEqual(state)
  })
  it('round trips the directory, description, filters and page', () => {
    const state = { ...EMPTY_DISCOVERY_QUERY, callMode: 'semantic' as const, callQuery: 'C++ & health', callPage: 3,
      callFilters: JSON.stringify({ eligibleCountries: ['India'], residencyRequirements: ['India'], applicationLanguages: ['English'] }) }
    expect(read(discoverySearchLink(state))).toEqual(state)
  })
  it('round trips organisation browsing and its people filters', () => {
    const state = { ...EMPTY_DISCOVERY_QUERY, tab: 'org' as const, orgUnitId: 'dept', query: 'Meera', designation: 'Professor', careerStage: 'SENIOR', includeSubunits: false }
    expect(read(discoverySearchLink(state))).toEqual(state)
  })
  it('normalizes unknown values, duplicates and excessive search context', () => {
    const params = new URLSearchParams({ tab: 'admin', pmode: 'execute', q: 'x'.repeat(500), unit: 'u'.repeat(300), cpage: 'Infinity', f: 'x'.repeat(5000) })
    for (let i = 0; i < 30; i++) params.append('area', `area${i}`)
    params.append('area', 'area0')
    const value = readDiscoveryQuery(params)
    expect(value.tab).toBe('calls'); expect(value.peopleMode).toBe('name')
    expect(value.query).toHaveLength(300); expect(value.unitId).toHaveLength(120); expect(value.areaIds).toHaveLength(20)
    expect(value.callFilters).toHaveLength(4000); expect(value.callPage).toBe(1)
    expect(read('/discovery?cpage=9999').callPage).toBe(500)
  })
  it.each([
    ['person', 'standard', 'name'], ['alignment', 'standard', 'call'], ['people', 'standard', 'areas'], ['people', 'semantic', 'semantic'],
  ])('maps the legacy %s/%s view to people %s', (task, mode, peopleMode) => {
    expect(read(`/discovery?task=${task}&mode=${mode}&q=biosensors&call=c&title=Call`)).toMatchObject({ tab: 'people', peopleMode, callId: 'c' })
  })
  it('maps legacy call filters and closed-call links', () => {
    const value = read('/discovery?task=calls&mode=standard&area=bio&q=health&closed=1&sort=deadline_soonest')
    expect(value).toMatchObject({ tab: 'calls', callMode: 'directory', callQuery: 'health' })
    expect(decodeDirectoryFilters(value.callFilters)).toMatchObject({ importedAreaIds: ['bio'], includeExpired: true, lifecycleStatuses: [], sort: 'deadline_soonest' })
    expect(read('/discovery?task=calls&mode=semantic&q=biosensors&area=bio')).toMatchObject({ callMode: 'semantic', callQuery: 'biosensors', callFilters: null })
  })
  it('migrates browser-local legacy searches without storing results', () => {
    const link = legacySavedSearchLink({ task: 'alignment', mode: 'semantic', callId: 'c', callTitle: 'Health & AI', unitId: 'school', people: [{ id: 'private' }] })!
    expect(read(link)).toMatchObject({ tab: 'people', peopleMode: 'call', callId: 'c', callTitle: 'Health & AI', unitId: 'school' })
    expect(link).not.toContain('private')
    expect(legacySavedSearchLink({})).toBeNull()
  })
})
