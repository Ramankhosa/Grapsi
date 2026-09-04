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

export function frequencyLabel(minutes: number): string {
  const days = Math.round(minutes / 1440)
  if (days <= 1) return 'daily'
  if (days === 7) return 'weekly'
  return `every ${days} days`
}
