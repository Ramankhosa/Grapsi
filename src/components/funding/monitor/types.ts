export type DiffPart = { t: 'add' | 'del' | 'ctx'; text: string }

export type ExtractedOpportunity = {
  title: string
  funder?: string
  deadline?: string
  amount?: string
  link?: string
  eligibility?: string
}

export type ExtractedPayload = {
  summary?: string
  opportunities?: ExtractedOpportunity[]
}

export type MonitorSource = {
  id: string
  name: string
  url: string
  mode: string
  feed_url: string | null
  selector: string | null
  frequency_minutes: number
  keywords: string
  tags: string
  notes: string | null
  status: string
  last_checked_at: string | null
  last_changed_at: string | null
  fail_count: number
  last_error: string | null
  owner: { id: string; name: string | null; email: string } | null
  _count?: { changes: number }
  // v2 engine fields (present once the foundation migration ran)
  site_id?: string | null
  kind?: string
  fetch_mode?: string
  next_check_at?: string | null
  last_complete_check_at?: string | null
}

export type MonitorEngine = 'legacy' | 'v2'

export type HealthSnapshot = {
  coverage?: {groups:Record<string,number>;frontier:Record<string,number>;recent:Array<{id:string;kind:string;url:string;reason:string}>}
  localAnalysis?: { required: boolean; online: boolean; ageSeconds: number | null; backlogWarning: boolean; waiting: number; needsAttention: number }
  engine: MonitorEngine
  browserEnabled: boolean
  worker: {
    alive: boolean
    lastBeatAt: string | null
    ageSeconds: number | null
    instances: { workerId: string; state: string; lastBeatAt: string; ageSeconds: number; currentTaskId: string | null }[]
  }
  queue: Record<string, Record<string, number>>
  oldestRunnable: { kind: string; ageSeconds: number } | null
  deadLetters: {
    id: string
    kind: string
    status: string
    last_error: string | null
    terminal_reason: string | null
    updated_at: string
    source_id: string | null
    attempts: number
  }[]
  checksLast24h: Record<string, number>
  sites: Record<string, number>
  providers: { account: string; state: string; reason: string | null; openedAt: string | null; nextProbeAt: string | null }[]
  budgetToday: { scope: string; limitMicros: string; reservedMicros: string; settledMicros: string }[]
  jobRuns: { job_key: string; status: string; started_at: string; finished_at: string | null; error_message: string | null }[]
}

export type SiteSummary = {
  id: string
  host: string
  status: string
  origin: string
  consecutive_fetch_failures: number
  last_fetch_error: string | null
  sources: {
    id: string
    name: string
    url: string
    kind: string
    status: string
    fetch_mode: string
    next_check_at: string | null
    last_checked_at: string | null
    last_complete_check_at: string | null
    last_error: string | null
    check_generation: number
  }[]
  _count: { resources: number }
}

export type CheckRunRow = {
  id: string
  source_id: string
  check_generation: number
  status: string
  complete: boolean
  truncated: boolean
  pages_visited: number
  items_observed: number
  new_resources: number
  fetch_mode_used: string | null
  error_class: string | null
  error_message: string | null
  started_at: string
  finished_at: string | null
}

export type ResourceRow = {
  id: string
  kind: string
  role: string
  canonical_url: string | null
  title: string | null
  first_seen_at: string
  last_observed_at: string
  last_validated_at: string | null
  last_validation_status: string | null
  observations: {
    source_id: string
    anchor_text: string | null
    context_text: string | null
    date_hints: string[]
    first_seen_at: string
    last_seen_at: string
    missing_since: string | null
  }[]
}

export type SiteEvidence = {
  site: { id: string; host: string; status: string; sources: { id: string; name: string; url: string; kind: string }[] }
  checkRuns: CheckRunRow[]
  resources: ResourceRow[]
  resourceCounts: Record<string, number>
}

export type MonitorChange = {
  id: string
  created_at: string
  diff: DiffPart[]
  verdict: string
  confidence: number | null
  extracted: ExtractedPayload | null
  state: string
  intake_job_id: string | null
  source: { id: string; name: string; url: string }
  resolved_by: { id: string; name: string | null } | null
}

export type SelectorSuggestion = {
  selector: string
  linkCount: number
  preview: string[]
}

export type PreviewResult = {
  pageTitle: string | null
  feedUrl: string | null
  feedPreview: string[] | null
  selectorOk: boolean | null
  suggestions: SelectorSuggestion[]
  lines: string[]
  totalLines: number
}

export const FREQUENCIES = [
  { value: 1440, label: 'Daily (recommended)' },
  { value: 4320, label: 'Every 3 days' },
  { value: 10080, label: 'Weekly' },
]

export const VERDICT_LABEL: Record<string, string> = {
  NEW_OPPORTUNITY: 'New opportunity',
  UPDATE: 'Update',
  COSMETIC: 'Cosmetic',
  UNKNOWN: 'Needs review',
}

export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return 'never'
  const date = typeof value === 'string' ? new Date(value) : value
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return date.toISOString().slice(0, 10)
}

export function timeUntil(value: string | Date | null | undefined): string {
  if (!value) return 'not scheduled'
  const date = typeof value === 'string' ? new Date(value) : value
  const seconds = Math.floor((date.getTime() - Date.now()) / 1000)
  if (seconds <= 0) return 'due now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `in ${hours}h`
  return `in ${Math.floor(hours / 24)}d`
}

export function ageLabel(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'never'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

export function frequencyLabel(minutes: number): string {
  const days = Math.round(minutes / 1440)
  if (days <= 1) return 'daily'
  if (days === 7) return 'weekly'
  return `every ${days} days`
}
