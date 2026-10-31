'use client'

import { ChevronDown, ChevronRight, ExternalLink, FileText, Globe, Layers, Radar, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { OUTCOME_ORDER, OUTCOME_STYLES, type PageOutcome } from './outcome'
import SkipPageButton from './SkipPageButton'

type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>

interface PageNode {
  id: string
  parentId: string | null
  level: number
  kind: 'WATCH_POINT' | 'PAGE' | 'DOCUMENT' | 'EXPLORED' | 'GROUP'
  url: string | null
  title: string | null
  outcome: PageOutcome
  detail: string | null
  opportunity: { id: string; title: string | null; reviewState: string; fundingCallId: string | null } | null
  lastSeenAt: string | null
  skipRuleId: string | null
  childCount: number
}

interface SkipRule { id: string; url: string; match: string; reason: string | null; expires_at: string | null; created_at: string }
interface TreeResponse { site: { id: string; host: string; status: string }; nodes: PageNode[]; counts: Partial<Record<PageOutcome, number>>; skipRules: SkipRule[]; truncated: boolean }
interface SiteOption { id: string; host: string; status: string; display_name: string | null; _count: { resources: number } }

const KIND_ICON = { WATCH_POINT: Radar, PAGE: Globe, DOCUMENT: FileText, EXPLORED: Globe, GROUP: Layers }

function pathOf(url: string | null, host: string): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    const sameHost = u.hostname.replace(/^www\./, '') === host.replace(/^www\./, '')
    return `${sameHost ? '' : u.hostname}${u.pathname}${u.search}`
  } catch {
    return url
  }
}

function ago(iso: string | null): string {
  if (!iso) return ''
  const hours = (Date.now() - Date.parse(iso)) / 3600_000
  if (hours < 1) return 'just now'
  if (hours < 48) return `${Math.round(hours)} h ago`
  return `${Math.round(hours / 24)} d ago`
}

/**
 * Every page of one website as a tree: the watched pages at the top, what
 * they list one level down, evidence documents under their call page, and the
 * crawler's own exploration under its own branch. Colour = what the page led to.
 */
export default function MonitorSiteTree({ authedFetch, canOperate, initialSiteId }: { authedFetch: AuthedFetch; canOperate: boolean; initialSiteId?: string | null }) {
  const [sites, setSites] = useState<SiteOption[]>([])
  const [siteId, setSiteId] = useState<string | null>(initialSiteId ?? null)
  const [tree, setTree] = useState<TreeResponse | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['group:explore', 'group:other']))
  const [filter, setFilter] = useState<Set<PageOutcome>>(new Set())
  const [query, setQuery] = useState('')

  useEffect(() => {
    void authedFetch('/api/funding/monitor/sites?status=ACTIVE')
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.message ?? 'Could not load websites')
        setSites(data.sites)
        setSiteId((current) => current ?? data.sites[0]?.id ?? null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load websites'))
  }, [authedFetch])

  const load = useCallback(async () => {
    if (!siteId) return
    setLoading(true)
    setError('')
    try {
      const response = await authedFetch(`/api/funding/monitor/sites/${siteId}/tree`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? 'Could not load the page tree')
      setTree(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the page tree')
    } finally {
      setLoading(false)
    }
  }, [authedFetch, siteId])

  useEffect(() => {
    void load()
  }, [load])

  const children = useMemo(() => {
    const map = new Map<string | null, PageNode[]>()
    for (const node of tree?.nodes ?? []) {
      const list = map.get(node.parentId) ?? []
      list.push(node)
      map.set(node.parentId, list)
    }
    // Results first inside each branch, so green rises to the top.
    // At the top, watched pages come before the exploration and catch-all groups.
    const rank = (n: PageNode) => (n.kind === 'WATCH_POINT' ? 0 : n.kind === 'GROUP' ? 2 : 1)
    for (const list of map.values()) list.sort((a, b) => rank(a) - rank(b) || OUTCOME_ORDER.indexOf(a.outcome) - OUTCOME_ORDER.indexOf(b.outcome) || (a.url ?? '').localeCompare(b.url ?? ''))
    return map
  }, [tree])

  // A filtered view keeps the ancestors of every match so levels stay readable.
  const visible = useMemo(() => {
    if (!tree || (!filter.size && !query.trim())) return null
    const q = query.trim().toLowerCase()
    const byId = new Map(tree.nodes.map((n) => [n.id, n]))
    const keep = new Set<string>()
    for (const node of tree.nodes) {
      const outcomeOk = !filter.size || filter.has(node.outcome)
      const textOk = !q || `${node.url ?? ''} ${node.title ?? ''}`.toLowerCase().includes(q)
      if (outcomeOk && textOk && node.kind !== 'GROUP') {
        let current: PageNode | undefined = node
        while (current && !keep.has(current.id)) {
          keep.add(current.id)
          current = current.parentId ? byId.get(current.parentId) : undefined
        }
      }
    }
    return keep
  }, [tree, filter, query])

  function toggle(id: string) {
    setCollapsed((old) => {
      const next = new Set(old)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function changed(message: string) {
    setNotice(message)
    void load()
  }

  function renderNode(node: PageNode): ReactNode {
    if (visible && !visible.has(node.id)) return null
    const style = OUTCOME_STYLES[node.outcome]
    const kids = children.get(node.id) ?? []
    const open = visible ? true : !collapsed.has(node.id)
    const Icon = KIND_ICON[node.kind]
    const host = tree?.site.host ?? ''
    return (
      <li key={node.id}>
        <div
          className={`group flex items-start gap-2 border-l-[3px] py-1.5 pr-2 transition-colors hover:bg-nickel-50 ${style.row}`}
          style={{ paddingLeft: `${8 + node.level * 22}px` }}
        >
          <button
            type="button"
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-nickel-500 hover:bg-nickel-100 ${kids.length ? '' : 'invisible'}`}
            onClick={() => toggle(node.id)}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          <span className="mt-[3px] shrink-0 rounded bg-nickel-100 px-1 font-mono text-[10px] leading-4 text-nickel-600" title={`Level ${node.level}`}>
            L{node.level}
          </span>
          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-nickel-500" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {node.kind === 'GROUP' || node.kind === 'WATCH_POINT' ? (
                <span className="text-[13px] font-semibold text-ink">{node.title}</span>
              ) : (
                <span className="truncate text-[13px] text-ink" title={node.url ?? ''}>
                  {node.title || pathOf(node.url, host)}
                </span>
              )}
              {node.kind !== 'GROUP' && (
                <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10.5px] font-medium ${style.chip}`} title={style.hint}>
                  <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                  {style.label}
                </span>
              )}
              {kids.length > 0 && <span className="text-[11px] text-nickel-500">{node.childCount} below</span>}
            </div>
            {node.kind !== 'GROUP' && (
              <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-nickel-500">
                {node.title && node.url && <span className="truncate font-mono">{pathOf(node.url, host)}</span>}
                {node.detail && <span>{node.detail}</span>}
                {node.lastSeenAt && <span>· {ago(node.lastSeenAt)}</span>}
                {node.opportunity?.fundingCallId && (
                  <a className="text-cobalt-700 underline" href={`/funding/calls/${node.opportunity.fundingCallId}`}>
                    Open catalog call
                  </a>
                )}
              </div>
            )}
          </div>
          {node.url && (
            <span className="flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
              <a className="cb-btn-ghost cb-btn-xs" href={node.url} target="_blank" rel="noreferrer" aria-label="Open page">
                <ExternalLink className="h-3 w-3" />
              </a>
              {canOperate && node.kind !== 'WATCH_POINT' && <SkipPageButton compact authedFetch={authedFetch} url={node.url} skipRuleId={node.skipRuleId} onChanged={changed} />}
            </span>
          )}
        </div>
        {open && kids.length > 0 && <ul>{kids.map(renderNode)}</ul>}
      </li>
    )
  }

  const total = Object.values(tree?.counts ?? {}).reduce((n, v) => n + (v ?? 0), 0)
  const found = (tree?.counts.PUBLISHED ?? 0) + (tree?.counts.FUNDING_FOUND ?? 0)

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="cb-label">Website</span>
          <select className="cb-select min-w-[16rem]" value={siteId ?? ''} onChange={(e) => setSiteId(e.target.value)}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name ? `${s.display_name} · ${s.host}` : s.host}
              </option>
            ))}
          </select>
        </label>
        <label className="relative flex-1 min-w-[12rem]">
          <span className="sr-only">Find a page</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-nickel-400" />
          <input className="cb-input pl-8" placeholder="Find a page by address or title" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button type="button" className="cb-btn-secondary cb-btn-sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {!sites.length && !error && <p className="cb-hint">No approved websites yet. Add one in the Sources stage.</p>}
      {error && <p role="alert" className="text-[13px] text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-cobalt-100 bg-cobalt-50 px-3 py-2 text-[13px] text-cobalt-800">{notice}</p>}

      {tree && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
              <p className="text-[12px] font-medium text-green-800">Pages that found funding</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-green-900">{found}</p>
              <p className="text-[11.5px] text-green-800">{tree.counts.PUBLISHED ?? 0} published · {tree.counts.FUNDING_FOUND ?? 0} in review</p>
            </div>
            <div className="rounded-xl border border-hairline bg-ground px-4 py-3">
              <p className="text-[12px] font-medium text-nickel-600">Pages known on this website</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">{total}</p>
              <p className="text-[11.5px] text-nickel-500">{tree.counts.QUEUED ?? 0} queued · {tree.counts.UNSURE ?? 0} unsure · {tree.counts.NOT_FUNDING ?? 0} not funding</p>
            </div>
            <div className={`rounded-xl border px-4 py-3 ${(tree.counts.FAILED ?? 0) > 0 ? 'border-red-200 bg-red-50' : 'border-hairline bg-ground'}`}>
              <p className={`text-[12px] font-medium ${(tree.counts.FAILED ?? 0) > 0 ? 'text-red-800' : 'text-nickel-600'}`}>Needs a look</p>
              <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${(tree.counts.FAILED ?? 0) > 0 ? 'text-red-900' : 'text-ink'}`}>{(tree.counts.FAILED ?? 0) + (tree.counts.UNREADABLE ?? 0)}</p>
              <p className="text-[11.5px] text-nickel-500">{tree.counts.FAILED ?? 0} failed · {tree.counts.UNREADABLE ?? 0} unreadable · {tree.skipRules.length} don&apos;t-visit marks</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show pages by result">
            <span className="mr-1 text-[12px] text-nickel-500">Show:</span>
            {OUTCOME_ORDER.filter((o) => tree.counts[o]).map((outcome) => {
              const style = OUTCOME_STYLES[outcome]
              const on = filter.has(outcome)
              return (
                <button
                  key={outcome}
                  type="button"
                  title={style.hint}
                  onClick={() => setFilter((old) => {
                    const next = new Set(old)
                    if (next.has(outcome)) next.delete(outcome)
                    else next.add(outcome)
                    return next
                  })}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition ${style.chip} ${on ? 'ring-2 ring-cobalt-500 ring-offset-1' : filter.size ? 'opacity-50 hover:opacity-100' : ''}`}
                >
                  <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                  {style.label}
                  <span className="tabular-nums opacity-80">{tree.counts[outcome]}</span>
                </button>
              )
            })}
            {filter.size > 0 && (
              <button type="button" className="cb-btn-ghost cb-btn-xs" onClick={() => setFilter(new Set())}>
                Show all
              </button>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-hairline bg-ground">
            <div className="flex items-center justify-between border-b border-hairline bg-inset px-3 py-2 text-[11.5px] text-nickel-600">
              <span>
                <span className="font-mono">L0</span> watched page · <span className="font-mono">L1</span> pages it lists · <span className="font-mono">L2+</span> documents and pages found deeper
              </span>
              <span className="font-mono">{tree.site.host}</span>
            </div>
            {tree.nodes.length === 0 ? (
              <p className="p-6 text-center text-[13px] text-nickel-500">Nothing crawled on this website yet. Its first check is queued.</p>
            ) : (
              <ul className="max-h-[70vh] overflow-y-auto py-1">{(children.get(null) ?? []).map(renderNode)}</ul>
            )}
          </div>
          {tree.truncated && <p className="cb-hint">Showing the 3,000 most recently seen pages on this website.</p>}

          {tree.skipRules.length > 0 && (
            <div className="rounded-xl border border-hairline bg-ground">
              <p className="border-b border-hairline px-4 py-2.5 text-[12.5px] font-semibold text-ink">Don&apos;t-visit marks on this website</p>
              <ul className="divide-y divide-hairline">
                {tree.skipRules.map((rule) => (
                  <li key={rule.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[12.5px]">
                    <span className="rounded bg-nickel-100 px-1.5 py-px text-[10.5px] font-medium text-nickel-600">{rule.match === 'FOLDER' ? 'Folder' : 'Page'}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-soft" title={rule.url}>{pathOf(rule.url, tree.site.host)}</span>
                    {rule.reason && <span className="text-nickel-500">{rule.reason}</span>}
                    <span className="text-nickel-500">{rule.expires_at ? `until ${new Date(rule.expires_at).toLocaleDateString()}` : 'until removed'}</span>
                    {canOperate && <SkipPageButton compact authedFetch={authedFetch} url={rule.url} skipRuleId={rule.id} onChanged={changed} />}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}
