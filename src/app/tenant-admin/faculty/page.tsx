'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import OrgUnitTree, { flattenForSelect, type OrgUnitNode } from '@/components/org/OrgUnitTree'

interface Department {
  id: string
  name: string
  code: string | null
  isActive: boolean
  facultyCount: number
}

interface School {
  id: string
  name: string
  code: string | null
  isActive: boolean
  facultyCount: number
  departments: Department[]
}

interface FacultyRow {
  userId: string
  email: string
  name: string
  employeeId: string | null
  school: string | null
  department: string | null
  designation: string | null
  researchAreas: string[]
  keywords: string[]
  orgUnitId: string | null
  hasEmbedding: boolean
  activated: boolean
}

interface ImportRowResult {
  rowNumber: number
  name: string
  email: string
  employeeId: string
  school: string
  department: string
  outcome: 'created' | 'updated' | 'error'
  message?: string
}

interface ImportSummary {
  dryRun: boolean
  totalRows: number
  created: number
  updated: number
  errors: number
  unitsCreated: string[]
  embeddingsIndexed: number
  embeddingsPending: number
  rolesAssigned: number
  headsCreated: number
  pendingActivation: number
  activationBlocked: number
  results: ImportRowResult[]
}

const ADMIN_ROLES = ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'CALL_ADMIN']
const PAGE_SIZE = 50

export default function TenantFacultyPage() {
  const { user, isLoading: authLoading, authFetch } = useAuth()

  const [tab, setTab] = useState<'organization' | 'faculty'>('organization')
  const [schools, setSchools] = useState<School[]>([])
  const [faculty, setFaculty] = useState<FacultyRow[]>([])
  const [total, setTotal] = useState(0)
  const [embedded, setEmbedded] = useState(0)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [orgUnitFilter, setOrgUnitFilter] = useState<string>('')
  const [accessFilter, setAccessFilter] = useState<'' | 'activated' | 'pending' | 'noid'>('')
  const [accessCounts, setAccessCounts] = useState({ activated: 0, pending: 0, noid: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newSchool, setNewSchool] = useState('')
  const [newDepartment, setNewDepartment] = useState<Record<string, string>>({})

  const [showImport, setShowImport] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [autoCreateUnits, setAutoCreateUnits] = useState(true)
  const [importing, setImporting] = useState(false)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  // Inline rename/delete dialogs (replaces window.prompt / confirm).
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  // Depth-aware shapes from the org-units API. `schools` above is the legacy
  // two-level projection, still used by nothing but kept while callers migrate.
  const [tree, setTree] = useState<OrgUnitNode[]>([])
  const [units, setUnits] = useState<Array<{ id: string; name: string; depth: number }>>([])
  const [levels, setLevels] = useState<Array<{ depth: number; singularName: string }>>([])
  const [maxDepth, setMaxDepth] = useState(7)

  const levelNameForDepth = useCallback(
    (depth: number) => {
      const named = levels.find(level => level.depth === depth)
      if (named) return named.singularName
      return ['School', 'Department', 'Centre', 'Group', 'Team', 'Unit', 'Unit'][Math.min(depth, 6)]
    },
    [levels]
  )

  const isAdmin = Boolean(user?.roles?.some((role: string) => ADMIN_ROLES.includes(role)))

  const loadSchools = useCallback(async () => {
    try {
      const res = await authFetch('/api/tenant-admin/org-units')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load the org structure')
      setSchools(data.schools || [])
      setTree(data.tree || [])
      setUnits(data.units || [])
      setLevels(data.levels || [])
      setMaxDepth(data.maxDepth || 7)
    } catch (e: any) {
      setError(e.message)
    }
  }, [authFetch])

  const loadFaculty = useCallback(async (nextOffset: number, query: string, unitId: string, access: string = '') => {
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(nextOffset) })
      if (query) params.set('q', query)
      if (unitId) params.set('orgUnitId', unitId)
      if (access) params.set('access', access)
      const res = await authFetch(`/api/tenant-admin/faculty?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load faculty')
      setFaculty(data.faculty || [])
      setTotal(data.total || 0)
      setEmbedded(data.embedded || 0)
      setAccessCounts({
        activated: data.activatedCount || 0,
        pending: data.pendingCount || 0,
        noid: data.noIdCount || 0,
      })
      setOffset(nextOffset)
    } catch (e: any) {
      setError(e.message)
    }
  }, [authFetch])

  useEffect(() => {
    if (!user) return
    setLoading(true)
    Promise.all([loadSchools(), loadFaculty(0, '', '')]).finally(() => setLoading(false))
  }, [user, loadSchools, loadFaculty])

  // Poll the faculty endpoint while embeddings are catching up — the async
  // worker after an import writes to researcher_profiles and this is the
  // authoritative source for progress.
  useEffect(() => {
    if (total === 0 || embedded >= total) return
    const interval = setInterval(() => {
      loadFaculty(offset, search, orgUnitFilter, accessFilter)
    }, 5000)
    // Stop after ~5 minutes even if something got stuck.
    const stop = setTimeout(() => clearInterval(interval), 5 * 60 * 1000)
    return () => {
      clearInterval(interval)
      clearTimeout(stop)
    }
  }, [total, embedded, offset, search, orgUnitFilter, accessFilter, loadFaculty])

  // `kind` is no longer sent — depth follows the parent, so any unit can nest
  // under any other up to maxDepth.
  const createUnit = async (name: string, parentId?: string) => {
    if (!name.trim()) return
    setError(null)
    try {
      const res = await authFetch('/api/tenant-admin/org-units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), parentId: parentId || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create that unit')
      if (!parentId) setNewSchool('')
      await loadSchools()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const openRename = (id: string, currentName: string) => {
    setRenameTarget({ id, name: currentName })
    setRenameValue(currentName)
  }

  const confirmRename = async () => {
    if (!renameTarget) return
    const nextName = renameValue.trim()
    if (!nextName || nextName === renameTarget.name) {
      setRenameTarget(null)
      return
    }
    setError(null)
    try {
      const res = await authFetch(`/api/tenant-admin/org-units/${renameTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Rename failed')
      await loadSchools()
      setRenameTarget(null)
    } catch (e: any) {
      setError(e.message)
    }
  }

  const openDelete = (id: string, name: string) => {
    setDeleteTarget({ id, name })
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setError(null)
    try {
      const res = await authFetch(`/api/tenant-admin/org-units/${deleteTarget.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      await loadSchools()
      setDeleteTarget(null)
    } catch (e: any) {
      setError(e.message)
    }
  }

  const downloadTemplate = async () => {
    try {
      const res = await authFetch('/api/tenant-admin/faculty/import')
      if (!res.ok) throw new Error('Could not download the template')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'faculty-import-template.csv'
      link.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setImportError(e.message)
    }
  }

  const runImport = async (dryRun: boolean) => {
    if (!file) return
    setImporting(true)
    setImportError(null)
    try {
      const body = new FormData()
      body.append('file', file)
      body.append('autoCreateUnits', String(autoCreateUnits))
      body.append('dryRun', String(dryRun))

      // No Content-Type header: the browser must set the multipart boundary.
      const res = await authFetch('/api/tenant-admin/faculty/import', { method: 'POST', body })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')

      setSummary(data)
      if (!dryRun) {
        await Promise.all([loadSchools(), loadFaculty(0, search, orgUnitFilter, accessFilter)])
      }
    } catch (e: any) {
      setImportError(e.message)
    } finally {
      setImporting(false)
    }
  }

  const closeImport = () => {
    setShowImport(false)
    setFile(null)
    setSummary(null)
    setImportError(null)
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Access denied</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Organization admin access is required to manage faculty.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Faculty &amp; Organization</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Define your organizational structure to any depth, then upload your faculty roster so they can be
            matched to funding calls.
          </p>
        </div>

        <div className="mb-6 flex gap-2">
          {(['organization', 'faculty'] as const).map(entry => (
            <button
              key={entry}
              onClick={() => setTab(entry)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                tab === entry
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {entry === 'organization' ? 'Organization' : `Faculty (${total})`}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {tab === 'organization' ? (
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Add a {levelNameForDepth(0).toLowerCase()}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSchool}
                  onChange={e => setNewSchool(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createUnit(newSchool)}
                  placeholder="e.g. School of Computer Science and Engineering"
                  className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
                <button
                  onClick={() => createUnit(newSchool)}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                >
                  Add {levelNameForDepth(0).toLowerCase()}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Nest as deep as your organization needs — up to {maxDepth} levels. Use “Add …” on any
                unit to create one beneath it.
              </p>
            </div>

            {tree.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-16 text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No units yet. Add your first {levelNameForDepth(0).toLowerCase()} above, or import a
                  roster and let it create the structure for you.
                </p>
              </div>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <OrgUnitTree
                  nodes={tree}
                  levelNameForDepth={levelNameForDepth}
                  maxDepth={maxDepth}
                  onRename={openRename}
                  onDelete={openDelete}
                  onAddChild={(parentId, name) => createUnit(name, parentId)}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && loadFaculty(0, search, orgUnitFilter, accessFilter)}
                  placeholder="Search by name, email, school or department..."
                  className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
                <select
                  value={orgUnitFilter}
                  onChange={e => {
                    setOrgUnitFilter(e.target.value)
                    loadFaculty(0, search, e.target.value, accessFilter)
                  }}
                  className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white min-w-[220px]"
                >
                  {/* A depth-indented flat list, not <optgroup> — optgroups
                      cannot nest, which is what capped this picker at two
                      levels. Selecting a unit includes everything beneath it. */}
                  <option value="">All units</option>
                  {flattenForSelect(tree).map(option => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => loadFaculty(0, search, orgUnitFilter, accessFilter)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Search
                </button>
              </div>
              <button
                onClick={() => setShowImport(true)}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                Import CSV / Excel
              </button>
            </div>

            <p className="text-sm text-gray-500 dark:text-gray-400">
              {total} {accessFilter ? 'shown' : 'faculty'} · {embedded} searchable (embedded)
              {total > embedded && (
                <span className="text-amber-600 dark:text-amber-400">
                  {' '}· {total - embedded} awaiting embedding
                </span>
              )}
            </p>

            {/* Activation status filter — isolate who still needs to sign in. */}
            <div className="flex flex-wrap items-center gap-2">
              {([
                { key: '', label: 'All', count: accessCounts.activated + accessCounts.pending + accessCounts.noid },
                { key: 'activated', label: 'Activated', count: accessCounts.activated },
                { key: 'pending', label: 'Pending', count: accessCounts.pending },
                { key: 'noid', label: 'No ID', count: accessCounts.noid },
              ] as const).map(chip => (
                <button
                  key={chip.key || 'all'}
                  onClick={() => {
                    setAccessFilter(chip.key)
                    loadFaculty(0, search, orgUnitFilter, chip.key)
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                    accessFilter === chip.key
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {chip.label}
                  <span
                    className={`rounded-full px-1.5 ${
                      accessFilter === chip.key ? 'bg-blue-500/40' : 'bg-gray-100 dark:bg-gray-700'
                    }`}
                  >
                    {chip.count}
                  </span>
                </button>
              ))}
              {accessCounts.noid > 0 && (
                <span className="text-xs text-red-600 dark:text-red-400">
                  {accessCounts.noid} can’t self-activate — add an Employee ID and re-import.
                </span>
              )}
            </div>

            <div className="bg-white dark:bg-gray-800 shadow rounded-lg overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    {['Faculty', 'School / Department', 'Designation', 'Research areas', 'Access', 'Searchable'].map(heading => (
                      <th
                        key={heading}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {faculty.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                        No faculty yet. Use “Import CSV / Excel” to upload your roster.
                      </td>
                    </tr>
                  ) : (
                    faculty.map(row => (
                      <tr key={row.userId}>
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">{row.name || '—'}</div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">{row.email}</div>
                          {row.employeeId && (
                            <div className="text-xs text-gray-400 dark:text-gray-500">ID {row.employeeId}</div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                          <div>{row.school || '—'}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{row.department || '—'}</div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                          {row.designation || '—'}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1 max-w-md">
                            {row.researchAreas.length === 0 ? (
                              <span className="text-xs text-gray-400">None</span>
                            ) : (
                              row.researchAreas.slice(0, 4).map(area => (
                                <span
                                  key={area}
                                  className="inline-flex px-2 py-0.5 text-xs rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                                >
                                  {area}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              row.activated
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                                : row.employeeId
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                                  : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                            }`}
                            title={
                              row.activated
                                ? 'This person has set a password and can sign in.'
                                : row.employeeId
                                  ? 'Seeded account — activates on first login with email + Employee ID.'
                                  : 'Seeded but has no Employee ID, so it cannot self-activate. Add an Employee ID and re-import.'
                            }
                          >
                            {row.activated ? 'Activated' : row.employeeId ? 'Pending' : 'No ID'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              row.hasEmbedding
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                            }`}
                          >
                            {row.hasEmbedding ? 'Yes' : 'Pending'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between text-sm">
                <button
                  onClick={() => loadFaculty(Math.max(0, offset - PAGE_SIZE), search, orgUnitFilter, accessFilter)}
                  disabled={offset === 0}
                  className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-40 text-gray-700 dark:text-gray-200"
                >
                  Previous
                </button>
                <span className="text-gray-500 dark:text-gray-400">
                  {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
                </span>
                <button
                  onClick={() => loadFaculty(offset + PAGE_SIZE, search, orgUnitFilter, accessFilter)}
                  disabled={offset + PAGE_SIZE >= total}
                  className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-40 text-gray-700 dark:text-gray-200"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Rename dialog */}
      {renameTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Rename</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Enter a new name for &ldquo;{renameTarget.name}&rdquo;.
            </p>
            <input
              type="text"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmRename()}
              autoFocus
              className="mt-4 block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setRenameTarget(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={confirmRename}
                disabled={!renameValue.trim() || renameValue.trim() === renameTarget.name}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Delete this unit?</h3>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              This will remove &ldquo;{deleteTarget.name}&rdquo;. This cannot be undone. Units with
              faculty still attached or child departments will be refused by the server.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Import faculty roster</h3>
            <p className="mt-1 mb-3 text-sm text-gray-500 dark:text-gray-400">
              Upload a .csv or .xlsx file. Columns: <strong>Name</strong>, <strong>Email</strong>,{' '}
              <strong>Employee ID</strong>, <strong>Unit Path</strong> (or <strong>School</strong> +{' '}
              <strong>Department</strong>), <strong>Designation</strong>, <strong>Research Areas</strong>,{' '}
              <strong>Keywords</strong>, <strong>Role</strong>, <strong>Head Of</strong>. Only Name and
              Email are required. <strong>Role</strong> defaults to Analyst (Admin/Manager need an
              owner/admin uploader). <strong>Head Of</strong> makes someone a unit head — use{' '}
              <code>self</code> for their own unit, or give a unit path. Existing faculty are matched
              by email and updated.{' '}
              <button onClick={downloadTemplate} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 underline">
                Download template
              </button>
            </p>

            <div className="mb-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
              <strong>How your team signs in — no emails needed.</strong> Imported people activate
              themselves at <code>/set-password</code> using their <strong>email + Employee ID</strong>,
              where they set a password. Include an Employee ID for everyone you want to self-activate.
            </div>

            <input
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xlsm"
              onChange={e => {
                setFile(e.target.files?.[0] || null)
                setSummary(null)
                setImportError(null)
              }}
              className="block w-full text-sm text-gray-700 dark:text-gray-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />

            <label className="mt-3 flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={autoCreateUnits}
                onChange={e => setAutoCreateUnits(e.target.checked)}
                className="mt-1"
              />
              <span>
                Create missing schools and departments automatically
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  Leave off to reject rows that reference a unit you have not defined.
                </span>
              </span>
            </label>

            {importError && (
              <div className="mt-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                {importError}
              </div>
            )}

            {summary && (
              <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {summary.dryRun ? 'Preview' : 'Import complete'} — {summary.totalRows} row
                  {summary.totalRows !== 1 ? 's' : ''}
                </p>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  {summary.created} to create · {summary.updated} to update ·{' '}
                  <span className={summary.errors > 0 ? 'text-red-600 dark:text-red-400 font-medium' : ''}>
                    {summary.errors} error{summary.errors !== 1 ? 's' : ''}
                  </span>
                  {!summary.dryRun && ` · ${summary.embeddingsIndexed} embedded`}
                </p>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  {summary.rolesAssigned} role{summary.rolesAssigned !== 1 ? 's' : ''} set ·{' '}
                  {summary.headsCreated} head{summary.headsCreated !== 1 ? 's' : ''} ·{' '}
                  {summary.pendingActivation} to activate
                  {summary.activationBlocked > 0 && (
                    <span className="text-red-600 dark:text-red-400 font-medium">
                      {' '}· {summary.activationBlocked} without an Employee ID (can’t self-activate)
                    </span>
                  )}
                </p>
                {summary.unitsCreated.length > 0 && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    New units: {summary.unitsCreated.slice(0, 8).join(', ')}
                    {summary.unitsCreated.length > 8 && ` +${summary.unitsCreated.length - 8} more`}
                  </p>
                )}
                {!summary.dryRun && summary.embeddingsPending > 0 && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    {summary.embeddingsPending} profile(s) still embedding in the background — the
                    Faculty tab updates automatically as they finish.
                  </p>
                )}

                {summary.results.some(row => row.outcome === 'error') && (
                  <div className="mt-3 max-h-48 overflow-y-auto rounded border border-red-200 dark:border-red-800">
                    <table className="min-w-full text-xs">
                      <thead className="bg-red-50 dark:bg-red-900/20">
                        <tr>
                          <th className="px-2 py-1 text-left text-red-800 dark:text-red-300">Row</th>
                          <th className="px-2 py-1 text-left text-red-800 dark:text-red-300">Email</th>
                          <th className="px-2 py-1 text-left text-red-800 dark:text-red-300">Problem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.results
                          .filter(row => row.outcome === 'error')
                          .slice(0, 100)
                          .map(row => (
                            <tr key={row.rowNumber} className="border-t border-red-100 dark:border-red-900">
                              <td className="px-2 py-1 text-gray-700 dark:text-gray-300">{row.rowNumber}</td>
                              <td className="px-2 py-1 text-gray-700 dark:text-gray-300">{row.email || '—'}</td>
                              <td className="px-2 py-1 text-red-700 dark:text-red-400">{row.message}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={closeImport}
                disabled={importing}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                {summary && !summary.dryRun ? 'Close' : 'Cancel'}
              </button>
              <button
                onClick={() => runImport(true)}
                disabled={!file || importing}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50"
              >
                {importing ? 'Working...' : 'Preview'}
              </button>
              <button
                onClick={() => runImport(false)}
                disabled={!file || importing}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                {importing ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
