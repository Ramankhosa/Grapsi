export const DISCOVERY_TASKS = [
  { id: 'calls', title: 'Calls by area', description: 'Find funding for a research field or idea.' },
  { id: 'people', title: 'People by area', description: 'Find colleagues with relevant expertise.' },
  { id: 'person', title: 'A person’s research', description: 'Look up someone and explore their areas.' },
  { id: 'alignment', title: 'People for a call', description: 'Find researchers aligned with a funding call.' },
] as const
export type DiscoveryTask = typeof DISCOVERY_TASKS[number]['id']
export interface DiscoveryArea { id: string; label: string }
export interface DiscoveryPerson {
  id: string; name: string; designation: string | null; school: string | null; department: string | null
  summary: string | null; areas: string[]; standardAreas: DiscoveryArea[]; savedAreas: DiscoveryArea[]
  matchReason?: string | null; score?: number; eligibilityFlags?: string[]
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
  task: DiscoveryTask; mode: 'standard' | 'semantic'; query: string; areaIds: string[]
  unitId: string; callId: string; callTitle: string; includeClosed: boolean; sort: 'best_match' | 'deadline_soonest'
}
export const EMPTY_DISCOVERY_QUERY: DiscoveryQuery = {
  task: 'calls', mode: 'standard', query: '', areaIds: [], unitId: '', callId: '', callTitle: '', includeClosed: false, sort: 'best_match',
}

export function discoverySearchLink(state: DiscoveryQuery) {
  const params = new URLSearchParams({ task: state.task, mode: state.mode })
  if (state.query) params.set('q', state.query)
  for (const id of state.areaIds) params.append('area', id)
  if (state.unitId) params.set('unit', state.unitId)
  if (state.callId) params.set('call', state.callId)
  if (state.callTitle) params.set('title', state.callTitle)
  if (state.includeClosed) params.set('closed', '1')
  params.set('sort', state.sort)
  return `/discovery?${params}`
}

export function readDiscoveryQuery(params: URLSearchParams): DiscoveryQuery {
  const task = DISCOVERY_TASKS.find(t => t.id === params.get('task'))?.id || 'calls'
  return { ...EMPTY_DISCOVERY_QUERY, task, mode: params.get('mode') === 'semantic' ? 'semantic' : 'standard',
    query: (params.get('q') || '').slice(0, 300), areaIds: [...new Set(params.getAll('area').map(id => id.slice(0, 120)))].slice(0, 20),
    unitId: (params.get('unit') || '').slice(0, 120), callId: (params.get('call') || '').slice(0, 120),
    callTitle: (params.get('title') || '').slice(0, 300), includeClosed: params.get('closed') === '1',
    sort: params.get('sort') === 'deadline_soonest' ? 'deadline_soonest' : 'best_match' }
}
