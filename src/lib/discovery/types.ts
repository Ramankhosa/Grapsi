import { DIRECTORY_DEFAULT_FILTERS, encodeDirectoryFilters } from '@/lib/recommendations/directoryUrl'

export const DISCOVERY_TABS = [
  { id: 'calls', title: 'Calls', description: 'Funding open to your organisation, with every directory filter.' },
  { id: 'people', title: 'People', description: 'Colleagues by name, expertise or fit for a call.' },
  { id: 'org', title: 'Organisation', description: 'Schools, departments and the people in them.' },
] as const
export type DiscoveryTab = typeof DISCOVERY_TABS[number]['id']

export const PEOPLE_MODES = [
  { id: 'name', label: 'Name' },
  { id: 'areas', label: 'Standard areas' },
  { id: 'semantic', label: 'Describe expertise' },
  { id: 'call', label: 'Matched to a call' },
] as const
export type PeopleMode = typeof PEOPLE_MODES[number]['id']

/** The org-tree entry for faculty with no active unit. */
export const UNPLACED_UNIT = '__unplaced__'

export interface DiscoveryArea { id: string; label: string }
export interface DiscoveryEligibility { group: 'PASS' | 'CONFLICT' | 'CHECK'; conflicts: string[]; toCheck: string[] }
export interface DiscoveryPerson {
  id: string; name: string; designation: string | null; school: string | null; department: string | null
  unitId?: string | null; careerStage?: string | null
  summary: string | null; areas: string[]; standardAreas: DiscoveryArea[]; savedAreas: DiscoveryArea[]
  matchReason?: string | null; matchTier?: string | null; score?: number; eligibilityFlags?: string[]
  eligibility?: DiscoveryEligibility | null
}
export interface DiscoveryCall {
  id: string; schemeTitle: string; agencyName: string | null; shortDescription: string | null
  closeDate: string | null; isRolling: boolean; disciplines: string[]; matchReasons: string[]
}
export interface DiscoveryResults {
  calls?: DiscoveryCall[]; people?: DiscoveryPerson[]; total: number; page: number; totalPages: number
  basis: 'directory' | 'identity' | 'standard' | 'semantic'; bounded?: boolean; warning?: string | null
  callRequiresRelease?: boolean
}

export interface DiscoveryQuery {
  tab: DiscoveryTab
  /** Calls: directory search, or meaning-based suggestions for a description. */
  callMode: 'directory' | 'semantic'
  callQuery: string
  /** Calls: the directory filters, encoded as the Finder encodes them (null = defaults). */
  callFilters: string | null
  callPage: number
  peopleMode: PeopleMode
  query: string
  areaIds: string[]
  unitId: string
  includeSubunits: boolean
  designation: string
  careerStage: string
  callId: string
  callTitle: string
  orgUnitId: string
}

export const EMPTY_DISCOVERY_QUERY: DiscoveryQuery = {
  tab: 'calls', callMode: 'directory', callQuery: '', callFilters: null, callPage: 1,
  peopleMode: 'name', query: '', areaIds: [], unitId: '', includeSubunits: true, designation: '', careerStage: '',
  callId: '', callTitle: '', orgUnitId: '',
}

export function discoverySearchLink(state: DiscoveryQuery) {
  const params = new URLSearchParams({ tab: state.tab })
  if (state.tab === 'calls') {
    if (state.callMode === 'semantic') params.set('cmode', 'semantic')
    if (state.callQuery) params.set('cq', state.callQuery)
    if (state.callFilters) params.set('f', state.callFilters)
    if (state.callPage > 1) params.set('cpage', String(state.callPage))
  } else if (state.tab === 'people') {
    params.set('pmode', state.peopleMode)
    if (state.query) params.set('q', state.query)
    for (const id of state.areaIds) params.append('area', id)
    if (state.unitId) params.set('unit', state.unitId)
    if (!state.includeSubunits) params.set('sub', '0')
    if (state.designation) params.set('des', state.designation)
    if (state.careerStage) params.set('stage', state.careerStage)
    if (state.callId) params.set('call', state.callId)
    if (state.callTitle) params.set('title', state.callTitle)
  } else {
    if (state.orgUnitId) params.set('ou', state.orgUnitId)
    if (state.query) params.set('q', state.query)
    if (!state.includeSubunits) params.set('sub', '0')
    if (state.designation) params.set('des', state.designation)
    if (state.careerStage) params.set('stage', state.careerStage)
  }
  return `/discovery?${params}`
}

const clip = (value: string | null, max: number) => (value || '').slice(0, max)

/**
 * Discovery state from an address bar or a saved search. Links from the
 * four-task page (`task=calls|people|person|alignment`) still open the
 * equivalent view, so shared links and bookmarks keep working.
 */
export function readDiscoveryQuery(params: URLSearchParams): DiscoveryQuery {
  const areaIds = [...new Set(params.getAll('area').map(id => id.slice(0, 120)))].slice(0, 20)
  const base: DiscoveryQuery = { ...EMPTY_DISCOVERY_QUERY,
    query: clip(params.get('q'), 300), areaIds, unitId: clip(params.get('unit'), 120),
    callId: clip(params.get('call'), 120), callTitle: clip(params.get('title'), 300) }
  const task = params.get('task')
  if (task && !params.get('tab')) {
    if (task === 'people' || task === 'person' || task === 'alignment') {
      const peopleMode: PeopleMode = task === 'person' ? 'name' : task === 'alignment' ? 'call' : params.get('mode') === 'semantic' ? 'semantic' : 'areas'
      return { ...base, tab: 'people', peopleMode, query: peopleMode === 'call' && base.callId ? '' : base.query }
    }
    const semantic = params.get('mode') === 'semantic'
    const filters = { ...DIRECTORY_DEFAULT_FILTERS,
      importedAreaIds: semantic ? [] : areaIds,
      lifecycleStatuses: params.get('closed') === '1' ? [] : DIRECTORY_DEFAULT_FILTERS.lifecycleStatuses,
      includeExpired: params.get('closed') === '1',
      sort: params.get('sort') === 'deadline_soonest' ? 'deadline_soonest' as const : 'best_match' as const }
    return { ...EMPTY_DISCOVERY_QUERY, tab: 'calls', callMode: semantic ? 'semantic' : 'directory', callQuery: base.query,
      callFilters: encodeDirectoryFilters(filters) }
  }
  const tab = DISCOVERY_TABS.find(t => t.id === params.get('tab'))?.id || 'calls'
  const peopleMode = PEOPLE_MODES.find(m => m.id === params.get('pmode'))?.id || 'name'
  const page = Number(params.get('cpage'))
  return { ...base, tab, peopleMode,
    callMode: params.get('cmode') === 'semantic' ? 'semantic' : 'directory',
    callQuery: clip(params.get('cq'), 300), callFilters: params.get('f') ? clip(params.get('f'), 4000) : null,
    callPage: Number.isInteger(page) && page > 1 ? Math.min(page, 500) : 1,
    includeSubunits: params.get('sub') !== '0',
    designation: clip(params.get('des'), 120), careerStage: clip(params.get('stage'), 120),
    orgUnitId: clip(params.get('ou'), 120) }
}

/** A search saved by the four-task page ({ name, state } with the old shape), as a link. */
export function legacySavedSearchLink(state: Record<string, unknown>): string | null {
  if (!state || typeof state !== 'object' || typeof state.task !== 'string') return null
  const params = new URLSearchParams({ task: String(state.task), mode: String(state.mode || 'standard') })
  if (typeof state.query === 'string' && state.query) params.set('q', state.query)
  if (Array.isArray(state.areaIds)) for (const id of state.areaIds) if (typeof id === 'string') params.append('area', id)
  if (typeof state.unitId === 'string' && state.unitId) params.set('unit', state.unitId)
  if (typeof state.callId === 'string' && state.callId) params.set('call', state.callId)
  if (typeof state.callTitle === 'string' && state.callTitle) params.set('title', state.callTitle)
  if (state.includeClosed === true) params.set('closed', '1')
  if (state.sort === 'deadline_soonest') params.set('sort', 'deadline_soonest')
  return `/discovery?${params}`
}
