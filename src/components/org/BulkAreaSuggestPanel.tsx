'use client'

import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'

/**
 * Map a whole organization's research areas in one pass.
 *
 * One modal per unit is fine for a handful and hopeless for a university: sixty
 * to a hundred units, each needing open / suggest / review / save / close. The
 * setup gets abandoned half-done, and half-mapped is worse than unmapped —
 * some schools then silently filter their queue while others show everything.
 *
 * Every proposal arrives with its evidence and how coarse it is, and nothing is
 * written until Confirm. A whole-group proposal ("Engineering & Technology"
 * rather than a named speciality) is deliberately offered rather than withheld:
 * it is less accurate but still correct, and it makes a unit's queue useful
 * immediately instead of leaving it unfiltered.
 */

interface Suggestion {
  taxonomyAreaId: string
  label: string
  confidence: number
  matchedTerms: string[]
  breadth: 'specific' | 'broad'
  alreadyMapped: boolean
}

interface UnitRow {
  unitId: string
  name: string
  depth: number
  existingAreas: number
  strategy: string | null
  evidence: string
  coverage: 'specific' | 'broad' | 'none'
  suggestions: Suggestion[]
  data: {
    faculty: number
    profilesWithAreas: number
    profilesWithDepartment: number
    assignments: number
    parentMapped: boolean
  }
}

const STRATEGY_LABEL: Record<string, string> = {
  name: 'unit name',
  faculty_areas: 'faculty research areas',
  faculty_departments: 'faculty departments',
  assignments: 'past assignments',
  ancestor: 'parent unit',
}

export default function BulkAreaSuggestPanel({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const { authFetch } = useAuth()
  const [rows, setRows] = useState<UnitRow[]>([])
  const [summary, setSummary] = useState<{ specific: number; broad: number; none: number } | null>(
    null
  )
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [allowBroad, setAllowBroad] = useState(true)
  const [includeMapped, setIncludeMapped] = useState(false)

  /** unitId -> the area ids the admin has kept. Absent = row not accepted. */
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState(0)

  const load = useCallback(
    async (nextAllowBroad: boolean, nextIncludeMapped: boolean) => {
      setLoading(true)
      setError(null)
      try {
        const response = await authFetch('/api/tenant-admin/org-units/research-areas/suggest-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            allowBroad: nextAllowBroad,
            includeMapped: nextIncludeMapped,
          }),
        })
        const data = await response.json()
        if (!response.ok) {
          setError(data.error || 'Could not work out any suggestions')
          return
        }
        const units: UnitRow[] = data.units || []
        setRows(units)
        setSummary(data.summary || null)
        setTruncated(Boolean(data.truncated))
        // Pre-tick every unit that got a proposal. The admin's job is to
        // correct and confirm, not to tick eighty boxes.
        const next: Record<string, string[]> = {}
        for (const unit of units) {
          if (unit.suggestions.length > 0) {
            next[unit.unitId] = unit.suggestions.map((row) => row.taxonomyAreaId)
          }
        }
        setPicked(next)
      } catch {
        setError('Could not work out any suggestions')
      } finally {
        setLoading(false)
      }
    },
    [authFetch]
  )

  useEffect(() => {
    void load(allowBroad, includeMapped)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowBroad, includeMapped])

  const toggleUnit = (unitId: string, suggestions: Suggestion[]) => {
    setPicked((current) => {
      const next = { ...current }
      if (next[unitId]) delete next[unitId]
      else next[unitId] = suggestions.map((row) => row.taxonomyAreaId)
      return next
    })
  }

  const toggleArea = (unitId: string, areaId: string) => {
    setPicked((current) => {
      const chosen = current[unitId] || []
      const next = chosen.includes(areaId)
        ? chosen.filter((id) => id !== areaId)
        : [...chosen, areaId]
      const copy = { ...current }
      if (next.length === 0) delete copy[unitId]
      else copy[unitId] = next
      return copy
    })
  }

  const acceptedCount = Object.keys(picked).length

  const confirm = async () => {
    setSaving(true)
    setError(null)
    setProgress(0)
    let done = 0
    let failed = 0
    try {
      for (const [unitId, areaIds] of Object.entries(picked)) {
        const unit = rows.find((row) => row.unitId === unitId)
        const source =
          unit?.strategy === 'name'
            ? 'suggested_name'
            : unit?.strategy
              ? 'suggested_faculty'
              : 'manual'
        const response = await authFetch(`/api/tenant-admin/org-units/${unitId}/research-areas`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taxonomyAreaIds: areaIds, source }),
        })
        if (!response.ok) failed += 1
        done += 1
        setProgress(done)
      }
      if (failed > 0) {
        setError(`${failed} of ${done} units could not be saved. The rest were.`)
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-lg bg-white p-6 dark:bg-gray-800">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
          Suggest research areas across the organization
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Proposals only — nothing is saved until you press Confirm. Untick a unit to skip it, or
          remove individual areas from a row.
        </p>

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={allowBroad}
              disabled={loading || saving}
              onChange={(event) => setAllowBroad(event.target.checked)}
            />
            <span className="text-gray-700 dark:text-gray-200">
              Accept whole-discipline answers when nothing specific is found
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeMapped}
              disabled={loading || saving}
              onChange={(event) => setIncludeMapped(event.target.checked)}
            />
            <span className="text-gray-700 dark:text-gray-200">
              Include units already mapped
            </span>
          </label>
          {summary && (
            <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
              {summary.specific} specific · {summary.broad} whole-discipline · {summary.none} no
              signal
            </span>
          )}
        </div>

        {truncated && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            Showing the first 200 units. Confirm these, then run it again for the rest.
          </p>
        )}

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
          {loading ? (
            <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
              Working through the organization&hellip;
            </p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
              Every unit already has research areas mapped.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {rows.map((row) => {
                const accepted = Boolean(picked[row.unitId])
                const chosen = picked[row.unitId] || []
                return (
                  <li key={row.unitId} className="flex gap-3 p-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={accepted}
                      disabled={row.suggestions.length === 0 || saving}
                      onChange={() => toggleUnit(row.unitId, row.suggestions)}
                    />
                    <div className="min-w-0 flex-1" style={{ paddingLeft: row.depth * 12 }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {row.name}
                        </span>
                        {row.existingAreas > 0 && (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                            {row.existingAreas} already mapped
                          </span>
                        )}
                        {row.coverage === 'broad' && (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                            whole discipline
                          </span>
                        )}
                        {row.coverage === 'none' && (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-700">
                            no signal
                          </span>
                        )}
                      </div>

                      {row.suggestions.length === 0 ? (
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {row.evidence}. {row.data.faculty === 0
                            ? 'No faculty are placed here yet.'
                            : row.data.profilesWithAreas === 0
                              ? `${row.data.faculty} faculty here, none with research areas on their profile.`
                              : 'Map it by hand from the tree.'}
                        </p>
                      ) : (
                        <>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {row.suggestions.map((suggestion) => {
                              const on = chosen.includes(suggestion.taxonomyAreaId)
                              return (
                                <button
                                  key={suggestion.taxonomyAreaId}
                                  type="button"
                                  disabled={saving}
                                  onClick={() => toggleArea(row.unitId, suggestion.taxonomyAreaId)}
                                  className={`rounded-full border px-2 py-0.5 text-xs ${
                                    on
                                      ? suggestion.breadth === 'broad'
                                        ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200'
                                        : 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-200'
                                      : 'border-gray-200 text-gray-400 line-through dark:border-gray-600'
                                  }`}
                                >
                                  {suggestion.label}
                                </button>
                              )
                            })}
                          </div>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {row.evidence}
                            {row.strategy ? ` · from ${STRATEGY_LABEL[row.strategy] || row.strategy}` : ''}
                          </p>
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-3">
          {saving && (
            <span className="mr-auto text-xs text-gray-500 dark:text-gray-400">
              Saving {progress} of {acceptedCount}&hellip;
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={saving || loading || acceptedCount === 0}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : `Confirm ${acceptedCount} unit${acceptedCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
