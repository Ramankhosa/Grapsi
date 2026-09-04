'use client'

import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'

/**
 * The disciplines a call is filed under, and the means to correct them.
 *
 * Every row says where it came from: the alias sweep, the LLM, or a person.
 * That distinction is the point of the panel — a curator needs to see what the
 * machine decided before deciding whether to overrule it, and a correction that
 * looked identical to an automatic guess would be impossible to audit later.
 *
 * Saving replaces only the manual layer. Removing a correction therefore
 * restores the classifier's own answer rather than leaving the call bare.
 */

interface AreaRow {
  id: string
  taxonomyAreaId: string
  label: string
  isGroup: boolean
  source: string
  confidence: number | null
  author: string | null
}

interface CatalogArea {
  id: string
  level1Name: string
  level2Name: string
  label: string
}

const SOURCE_LABEL: Record<string, string> = {
  'auto:alias': 'matched automatically',
  'auto:llm': 'chosen by AI',
  manual: 'set by a person',
}

export default function CallResearchAreas({ callId }: { callId: string }) {
  const { authFetch } = useAuth()
  const [areas, setAreas] = useState<AreaRow[]>([])
  const [catalog, setCatalog] = useState<CatalogArea[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [readOnlyReason, setReadOnlyReason] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await authFetch(`/api/funding/calls/${callId}/research-areas`)
      if (!response.ok) return
      const data = await response.json()
      setAreas(data.areas || [])
      setCanEdit(Boolean(data.canEdit))
      setReadOnlyReason(data.readOnlyReason || null)
    } finally {
      setLoading(false)
    }
  }, [authFetch, callId])

  useEffect(() => {
    void load()
  }, [load])

  const beginEdit = async () => {
    setError(null)
    // The picker needs the whole catalog, which the read endpoint does not carry.
    if (catalog.length === 0) {
      const response = await authFetch('/api/tenant-admin/research-areas')
      if (response.ok) {
        const data = await response.json()
        setCatalog(
          (data.areas || []).map((area: any) => ({
            id: area.id,
            level1Name: area.level1Name,
            level2Name: area.level2Name,
            label: area.level2Name ? `${area.level1Name} → ${area.level2Name}` : area.level1Name,
          }))
        )
      }
    }
    setPicked(areas.map((row) => row.taxonomyAreaId))
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await authFetch(`/api/funding/calls/${callId}/research-areas`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxonomyAreaIds: picked }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error || 'Could not save those disciplines')
        return
      }
      setEditing(false)
      setNotice('Disciplines updated. This correction will survive future re-classification.')
      await load()
    } finally {
      setSaving(false)
    }
  }

  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id) ? current.filter((row) => row !== id) : [...current, id]
    )

  const visible = filter.trim()
    ? catalog.filter((area) => area.label.toLowerCase().includes(filter.trim().toLowerCase()))
    : catalog

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Research areas</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Which schools this call reaches. Corrections here apply everywhere the call is seen.
          </p>
        </div>
        {!editing && canEdit && (
          <button
            type="button"
            onClick={() => void beginEdit()}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {areas.length > 0 ? 'Correct' : 'Set disciplines'}
          </button>
        )}
      </div>

      {notice && (
        <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-300">
          {notice}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading&hellip;</p>
      ) : editing ? (
        <div className="mt-4">
          <input
            type="text"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter areas…"
            className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
          />
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2 dark:border-gray-700">
            {visible.map((area) => (
              <label
                key={area.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <input
                  type="checkbox"
                  checked={picked.includes(area.id)}
                  onChange={() => toggle(area.id)}
                />
                <span className="text-gray-800 dark:text-gray-200">{area.label}</span>
                {!area.level2Name && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                    whole discipline
                  </span>
                )}
              </label>
            ))}
            {visible.length === 0 && (
              <p className="px-2 py-3 text-sm text-gray-500 dark:text-gray-400">
                Nothing matches that filter.
              </p>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {picked.length} selected. Clearing all of them hands the call back to the classifier.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : areas.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          Not classified yet, so this call is shown to <strong>every</strong> school rather than
          hidden from all of them.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {areas.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/40"
            >
              <span className="text-sm text-gray-900 dark:text-white">{row.label}</span>
              {row.isGroup && (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                  whole discipline
                </span>
              )}
              <span
                className={`ml-auto rounded px-1.5 py-0.5 text-xs ${
                  row.source === 'manual'
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                }`}
              >
                {SOURCE_LABEL[row.source] || row.source}
                {row.source === 'manual' && row.author ? ` · ${row.author}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!canEdit && readOnlyReason && !loading && (
        <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-400">
          {readOnlyReason}
        </p>
      )}
    </div>
  )
}
