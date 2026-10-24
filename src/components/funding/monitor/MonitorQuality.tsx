'use client'
import { useEffect, useState } from 'react'
interface Ratio { successes: number; total: number; value: number | null; interval95: number[] | null }
interface Quality { precision: Ratio; discoveryRecall: Ratio; p95QueueAgeHours: number; pendingReview: number; spendAndOutstandingMicros: string; attempts: number; uncertainAttempts: number; cache: { entries: number; hits: number }; coverage: Record<string, number>; auditedNegativeMisses: { audited: number; relevant: number; estimatedMisses: number; note: string }; capped: boolean }
function ratio(r: Ratio) { return r.value === null ? 'Not yet measured' : `${Math.round(r.value * 100)}% (${r.successes}/${r.total}; 95% interval ${r.interval95!.map(n => Math.round(n * 100) + '%').join('–')})` }
export default function MonitorQuality({ authedFetch }: { authedFetch: (path: string, init?: RequestInit) => Promise<Response> }) {
  const [data, setData] = useState<Quality | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { void authedFetch('/api/funding/monitor/metrics').then(async r => { if (!r.ok) throw new Error('Could not load quality figures'); setData(await r.json()) }).catch(e => setError(e.message)) }, [authedFetch])
  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>
  if (!data) return <p className="cb-hint">Loading quality figures…</p>
  return <section className="space-y-4"><p className="cb-hint">Quality figures come from human labels and an independent list of official announcements. A small or missing sample is shown plainly. Automatic drafting remains off until its measured rollout gates pass.</p><dl className="grid gap-4 sm:grid-cols-2">
    {[['Screening precision', ratio(data.precision)], ['Discovery recall against verified announcements', ratio(data.discoveryRecall)], ['Review queue', `${data.pendingReview} items; 95th percentile age ${Math.round(data.p95QueueAgeHours)} hours`], ['AI cost, including unresolved reservations', `$${(Number(data.spendAndOutstandingMicros) / 1e6).toFixed(4)} across ${data.attempts} attempts`], ['Uncertain provider charges', String(data.uncertainAttempts)], ['Reused results', `${data.cache.hits} cache hits; ${data.cache.entries} saved results`]].map(([label, value]) => <div key={label} className="rounded-lg border bg-white p-4"><dt className="cb-hint">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}
  </dl><p className="text-sm">Audited filtered items: {data.auditedNegativeMisses.audited}; relevant items found among them: {data.auditedNegativeMisses.relevant}. {data.auditedNegativeMisses.note}</p><p className="text-sm">Site exploration: {Object.entries(data.coverage).map(([state, count]) => `${count} ${state.toLowerCase().replace(/_/g, ' ')}`).join(' · ') || 'No exploration recorded yet.'}</p>{data.capped && <p className="text-sm text-amber-800">These figures reached the reporting sample limit; they cannot enable automatic drafting.</p>}</section>
}
