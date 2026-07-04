'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AlertTriangle,
  Database,
  Loader2,
  PauseCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Shield,
  Upload,
  FileText,
  Trash2,
  FileSpreadsheet,
} from 'lucide-react'

import { useAuth } from '@/lib/auth-context'

type SourceResponse = {
  sources: any[]
  embeddingHealth: any
  coverage: {
    total: number
    active: number
    generated: number
    failed: number
    stale: number
    pending: number
    processing: number
    currentEmbeddingVersion: string
  }
}

const ICSSR_UPLOAD_CHUNK_SIZE = 512 * 1024
const CSV_UPLOAD_CHUNK_SIZE = 512 * 1024

function authHeaders() {
  return {
    'Content-Type': 'application/json',
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function projectFundingAgency(project: any) {
  const value =
    project?.extendedFields?.fundingAgency ||
    project?.schemeHierarchy?.fundingAgency ||
    project?.extendedFields?.agencyName ||
    project?.schemeHierarchy?.agencyName
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export default function PublicProjectCrawlerPage() {
  const { user, isLoading, authFetch } = useAuth()
  const router = useRouter()
  const [sources, setSources] = useState<SourceResponse | null>(null)
  const [runs, setRuns] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [selectedSource, setSelectedSource] = useState<'PRISM' | 'CSIR' | 'BIRAC' | 'ICMR' | 'ICSSR' | 'CSV_IMPORT'>('PRISM')
  const [states, setStates] = useState('PUNJAB, DELHI')
  const [csirPilotLimit, setCsirPilotLimit] = useState(20)
  const [biracPilotLimit, setBiracPilotLimit] = useState(20)
  const [icmrPilotLimit, setIcmrPilotLimit] = useState(20)
  const [icssrPilotLimit, setIcssrPilotLimit] = useState(20)
  const [csvImportLimit, setCsvImportLimit] = useState(200)
  const [isBusy, setIsBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ICSSR upload state
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ name: string; path: string }>>([])
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ total: number; success: number; error: number } | null>(null)

  // CSV upload state (for DST and other CSV sources)
  const [csvFiles, setCsvFiles] = useState<Array<{ name: string; path: string }>>([])
  const [isCsvUploading, setIsCsvUploading] = useState(false)
  const [csvUploadProgress, setCsvUploadProgress] = useState<{ total: number; success: number; error: number } | null>(null)

  const canRead = useMemo(
    () => Boolean(user?.roles?.includes('SUPER_ADMIN') || user?.roles?.includes('SUPER_ADMIN_VIEWER')),
    [user]
  )
  const canWrite = Boolean(user?.roles?.includes('SUPER_ADMIN'))

  useEffect(() => {
    if (isLoading) return
    if (!user) {
      router.replace('/login')
      return
    }
    if (!canRead) {
      router.replace('/dashboard')
    }
  }, [canRead, isLoading, router, user])

  useEffect(() => {
    if (canRead) {
      refresh()
      const timer = window.setInterval(refresh, 15000)
      return () => window.clearInterval(timer)
    }
  }, [canRead, selectedSource])

  async function refresh() {
    try {
      const [sourceResponse, runResponse, projectResponse] = await Promise.all([
        authFetch('/api/super-admin/project-intelligence/crawlers/sources', { headers: authHeaders() }),
        authFetch('/api/super-admin/project-intelligence/crawlers/runs?limit=20', { headers: authHeaders() }),
        authFetch(`/api/super-admin/project-intelligence/projects?sourceKey=${selectedSource}&limit=10`, { headers: authHeaders() }),
      ])

      if (sourceResponse.ok) setSources(await sourceResponse.json())
      if (runResponse.ok) setRuns((await runResponse.json()).runs || [])
      if (projectResponse.ok) setProjects((await projectResponse.json()).projects || [])
    } catch (refreshError) {
      console.error(refreshError)
    }
  }

  async function postJson(url: string, body: Record<string, unknown> = {}) {
    setIsBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await authFetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || data.error || 'Request failed')
      }
      setMessage('Operation queued successfully.')
      await refresh()
      return data
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError))
      return null
    } finally {
      setIsBusy(false)
    }
  }

  async function drainUntilDone(runId: string) {
    setIsBusy(true)
    setMessage('Run started — processing...')
    let keepDraining = true
    while (keepDraining) {
      try {
        const response = await authFetch('/api/super-admin/project-intelligence/crawlers/worker/drain', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ runId }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          setError(data.message || data.error || 'Drain request failed')
          keepDraining = false
          break
        }

        const processed = data.processed
        if (!processed || ['completed', 'completed_with_errors', 'failed', 'canceled'].includes(processed.status)) {
          keepDraining = false
        }

        await refresh()

        if (keepDraining) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      } catch (drainError) {
        setError(drainError instanceof Error ? drainError.message : 'Drain loop failed')
        keepDraining = false
      }
    }
    setMessage('Run processing complete.')
    await refresh()
    setIsBusy(false)
  }

  async function startPilot() {
    let result: any = null

    if (selectedSource === 'CSIR' || selectedSource === 'BIRAC' || selectedSource === 'ICMR' || selectedSource === 'ICSSR' || selectedSource === 'CSV_IMPORT') {
      const maxRecords =
        selectedSource === 'CSIR' ? csirPilotLimit :
        selectedSource === 'BIRAC' ? biracPilotLimit :
        selectedSource === 'ICMR' ? icmrPilotLimit :
        selectedSource === 'ICSSR' ? icssrPilotLimit :
        csvImportLimit
      result = await postJson('/api/super-admin/project-intelligence/crawlers/runs', {
        sourceKey: selectedSource,
        mode: 'pilot',
        filters: {
          maxRecords,
        },
      })
    } else {
      const parsedStates = states
        .split(',')
        .map((state) => state.trim().toUpperCase())
        .filter(Boolean)

      result = await postJson('/api/super-admin/project-intelligence/crawlers/runs', {
        sourceKey: 'PRISM',
        mode: 'pilot',
        filters: {
          states: parsedStates.length ? parsedStates : ['PUNJAB', 'DELHI'],
          maxRecords: 20,
          onlinePerState: 5,
          legacyPerState: 5,
        },
      })
    }

    if (result?.run?.id) {
      await drainUntilDone(result.run.id)
    }
  }

  async function startFull() {
    const typed = window.prompt(`Type PRODUCTION FULL ${selectedSource} to queue the full ${selectedSource} run.`)
    if (typed !== `PRODUCTION FULL ${selectedSource}`) return
    const result = await postJson('/api/super-admin/project-intelligence/crawlers/runs', {
      sourceKey: selectedSource,
      mode: 'full',
      confirmFullProduction: true,
    })

    if (result?.run?.id) {
      await drainUntilDone(result.run.id)
    }
  }

  async function drain(runId?: string) {
    await postJson('/api/super-admin/project-intelligence/crawlers/worker/drain', {
      runId,
    })
  }

  async function drainEmbeddings() {
    await postJson('/api/super-admin/project-intelligence/embeddings/drain', {
      limit: 25,
      includeFailed: true,
    })
  }

  // ICSSR file upload functions
  async function fetchUploadedFiles() {
    try {
      const response = await authFetch('/api/super-admin/project-intelligence/crawlers/upload', {
        headers: authHeaders(),
      })
      if (response.ok) {
        const data = await response.json()
        setUploadedFiles(data.files || [])
      }
    } catch (err) {
      console.error('Failed to fetch uploaded files:', err)
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return

    setIsUploading(true)
    setUploadProgress(null)
    setError(null)
    setMessage(null)

    try {
      let successCount = 0
      let errorCount = 0
      const failures: string[] = []

      for (const file of Array.from(files)) {
        try {
          if (!file.name.toLowerCase().endsWith('.pdf')) {
            throw new Error('Only PDF files are accepted')
          }

          const uploadId = crypto.randomUUID()
          const totalChunks = Math.ceil(file.size / ICSSR_UPLOAD_CHUNK_SIZE)
          if (totalChunks === 0) throw new Error('The PDF is empty')

          for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
            const start = chunkIndex * ICSSR_UPLOAD_CHUNK_SIZE
            const chunk = file.slice(start, Math.min(start + ICSSR_UPLOAD_CHUNK_SIZE, file.size))
            const params = new URLSearchParams({
              mode: 'chunk',
              uploadId,
              fileName: file.name,
              chunkIndex: String(chunkIndex),
              totalChunks: String(totalChunks),
              fileSize: String(file.size),
            })
            const response = await authFetch(
              `/api/super-admin/project-intelligence/crawlers/upload?${params.toString()}`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/octet-stream',
                },
                body: chunk,
              }
            )
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
              throw new Error(
                data.error ||
                  (response.status === 413
                    ? 'Upload rejected by the server or reverse proxy'
                    : `Upload failed with status ${response.status}`)
              )
            }
          }

          successCount += 1
        } catch (fileError) {
          errorCount += 1
          failures.push(
            `${file.name}: ${fileError instanceof Error ? fileError.message : 'Upload failed'}`
          )
        }

        setUploadProgress({ total: files.length, success: successCount, error: errorCount })
      }

      setMessage(`Uploaded ${successCount} of ${files.length} files successfully.`)
      if (failures.length > 0) setError(failures.join('\n'))
      await fetchUploadedFiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  async function deleteUploadedFile(fileName: string) {
    try {
      const response = await authFetch(
        `/api/super-admin/project-intelligence/crawlers/upload?fileName=${encodeURIComponent(fileName)}`,
        {
          method: 'DELETE',
          headers: authHeaders(),
        }
      )

      if (response.ok) {
        await fetchUploadedFiles()
        setMessage(`Deleted ${fileName}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  // Fetch uploaded files when ICSSR is selected
  useEffect(() => {
    if (selectedSource === 'ICSSR' && canRead) {
      fetchUploadedFiles()
    }
  }, [selectedSource, canRead])

  // CSV upload functions for DST and other CSV sources
  async function fetchCsvFiles() {
    try {
      const response = await authFetch('/api/super-admin/project-intelligence/crawlers/csv-upload', {
        headers: authHeaders(),
      })
      if (response.ok) {
        const data = await response.json()
        setCsvFiles(data.files || [])
      }
    } catch (err) {
      console.error('Failed to fetch CSV files:', err)
    }
  }

  async function uploadCsvFiles(files: FileList | null) {
    if (!files || files.length === 0) return

    setIsCsvUploading(true)
    setCsvUploadProgress(null)
    setError(null)
    setMessage(null)

    try {
      let successCount = 0
      let errorCount = 0
      const failures: string[] = []

      for (const file of Array.from(files)) {
        try {
          const lowerName = file.name.toLowerCase()
          if (!lowerName.endsWith('.csv') && !lowerName.endsWith('.txt')) {
            throw new Error('Only .csv or .txt files are accepted')
          }

          const uploadId = crypto.randomUUID()
          const totalChunks = Math.ceil(file.size / CSV_UPLOAD_CHUNK_SIZE)
          if (totalChunks === 0) throw new Error('The file is empty')

          for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
            const start = chunkIndex * CSV_UPLOAD_CHUNK_SIZE
            const chunk = file.slice(start, Math.min(start + CSV_UPLOAD_CHUNK_SIZE, file.size))
            const params = new URLSearchParams({
              mode: 'chunk',
              uploadId,
              fileName: file.name,
              chunkIndex: String(chunkIndex),
              totalChunks: String(totalChunks),
              fileSize: String(file.size),
            })
            const response = await authFetch(
              `/api/super-admin/project-intelligence/crawlers/csv-upload?${params.toString()}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: chunk,
              }
            )
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
              throw new Error(
                data.error ||
                  (response.status === 413
                    ? 'Upload rejected by the server or reverse proxy'
                    : `Upload failed with status ${response.status}`)
              )
            }
          }

          successCount += 1
        } catch (fileError) {
          errorCount += 1
          failures.push(
            `${file.name}: ${fileError instanceof Error ? fileError.message : 'Upload failed'}`
          )
        }

        setCsvUploadProgress({ total: files.length, success: successCount, error: errorCount })
      }

      setMessage(`Uploaded ${successCount} of ${files.length} CSV files successfully.`)
      if (failures.length > 0) setError(failures.join('\n'))
      await fetchCsvFiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsCsvUploading(false)
    }
  }

  async function deleteCsvFile(fileName: string) {
    try {
      const response = await authFetch(
        `/api/super-admin/project-intelligence/crawlers/csv-upload?fileName=${encodeURIComponent(fileName)}`,
        {
          method: 'DELETE',
          headers: authHeaders(),
        }
      )

      if (response.ok) {
        await fetchCsvFiles()
        setMessage(`Deleted ${fileName}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  // Fetch CSV files when CSV_IMPORT is selected
  useEffect(() => {
    if (selectedSource === 'CSV_IMPORT' && canRead) {
      fetchCsvFiles()
    }
  }, [selectedSource, canRead])

  if (isLoading || !user || !canRead) {
    return <div className="min-h-screen bg-slate-50 p-8 text-sm text-slate-600">Checking Super Admin access...</div>
  }

  const coverage = sources?.coverage
  const prism = sources?.sources?.find((source) => source.sourceKey === 'PRISM')
  const csir = sources?.sources?.find((source) => source.sourceKey === 'CSIR')
  const birac = sources?.sources?.find((source) => source.sourceKey === 'BIRAC')
  const icmr = sources?.sources?.find((source) => source.sourceKey === 'ICMR')
  const icssr = sources?.sources?.find((source) => source.sourceKey === 'ICSSR')
  const csvImport = sources?.sources?.find((source) => source.sourceKey === 'CSV_IMPORT')

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Super Admin / Project Intelligence
              </div>
              <h1 className="mt-3 text-3xl font-semibold text-slate-950">Public Project Crawlers</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                Build the awarded-project corpus from public sources. PRISM, CSIR, BIRAC, ICMR and ICSSR are active for local pilot runs.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={refresh}
                className="inline-flex items-center gap-2 border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
              {canWrite && (
                <button
                  onClick={() => drain()}
                  disabled={isBusy}
                  className="inline-flex items-center gap-2 bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Run crawler once
                </button>
              )}
              {canWrite && (
                <button
                  onClick={drainEmbeddings}
                  disabled={isBusy}
                  className="inline-flex items-center gap-2 border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-800 hover:bg-violet-100 disabled:opacity-50"
                >
                  {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                  Run embeddings once
                </button>
              )}
            </div>
          </div>
        </section>

        {(message || error) && (
          <div className={`border p-4 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {error || message}
          </div>
        )}

        <section className="border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Choose crawler source</h2>
              <p className="mt-1 text-sm text-slate-600">Select PRISM, CSIR, BIRAC, ICMR or ICSSR before starting a pilot run.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedSource('PRISM')}
                className={`px-4 py-2 text-sm font-semibold ${
                  selectedSource === 'PRISM'
                    ? 'bg-sky-700 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                PRISM crawler
              </button>
              <button
                onClick={() => setSelectedSource('CSIR')}
                className={`px-4 py-2 text-sm font-semibold ${
                  selectedSource === 'CSIR'
                    ? 'bg-emerald-700 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                CSIR crawler
              </button>
              <button
                onClick={() => setSelectedSource('BIRAC')}
                className={`px-4 py-2 text-sm font-semibold ${
                  selectedSource === 'BIRAC'
                    ? 'bg-fuchsia-700 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                BIRAC crawler
              </button>
              <button
                onClick={() => setSelectedSource('ICMR')}
                className={`px-4 py-2 text-sm font-semibold ${
                  selectedSource === 'ICMR'
                    ? 'bg-rose-700 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                ICMR crawler
              </button>
              <button
                onClick={() => setSelectedSource('ICSSR')}
                className={`px-4 py-2 text-sm font-semibold ${
                  selectedSource === 'ICSSR'
                    ? 'bg-indigo-700 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                ICSSR crawler
              </button>
              <button
                onClick={() => setSelectedSource('CSV_IMPORT')}
                className={`px-4 py-2 text-sm font-semibold ${
                  selectedSource === 'CSV_IMPORT'
                    ? 'bg-emerald-700 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                CSV Importer
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4 lg:grid-cols-8">
          <div className="border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              <Database className="h-4 w-4" />
              Corpus
            </div>
            <div className="mt-3 text-2xl font-semibold text-slate-950">{coverage?.total ?? '—'}</div>
            <p className="mt-1 text-sm text-slate-500">{coverage?.active ?? 0} active records</p>
          </div>
          <div className="border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Embeddings</div>
            <div className="mt-3 text-2xl font-semibold text-slate-950">{coverage?.generated ?? '—'}</div>
            <p className="mt-1 text-sm text-slate-500">
              {coverage?.pending ?? 0} pending, {coverage?.processing ?? 0} processing, {coverage?.failed ?? 0} failed
            </p>
          </div>
          <div className="border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Embedding Provider</div>
            <div className="mt-3 text-lg font-semibold text-slate-950">{sources?.embeddingHealth?.provider || '—'}</div>
            <p className="mt-1 truncate text-sm text-slate-500">{sources?.embeddingHealth?.modelName || 'not loaded'}</p>
          </div>
          <button
            onClick={() => setSelectedSource('PRISM')}
            className={`border p-5 text-left shadow-sm ${selectedSource === 'PRISM' ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'}`}
          >
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">PRISM</div>
            <div className="mt-3 text-lg font-semibold text-slate-950">{prism?.enabled ? 'Enabled' : 'Disabled'}</div>
            <p className="mt-1 text-sm text-slate-500">Last run: {formatDate(prism?.lastRunAt)}</p>
          </button>
          <button
            onClick={() => setSelectedSource('CSIR')}
            className={`border p-5 text-left shadow-sm ${selectedSource === 'CSIR' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white'}`}
          >
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">CSIR</div>
            <div className="mt-3 text-lg font-semibold text-slate-950">{csir?.enabled ? 'Enabled' : 'Disabled'}</div>
            <p className="mt-1 text-sm text-slate-500">Last run: {formatDate(csir?.lastRunAt)}</p>
          </button>
          <button
            onClick={() => setSelectedSource('BIRAC')}
            className={`border p-5 text-left shadow-sm ${selectedSource === 'BIRAC' ? 'border-fuchsia-500 bg-fuchsia-50' : 'border-slate-200 bg-white'}`}
          >
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">BIRAC</div>
            <div className="mt-3 text-lg font-semibold text-slate-950">{birac?.enabled ? 'Enabled' : 'Disabled'}</div>
            <p className="mt-1 text-sm text-slate-500">Last run: {formatDate(birac?.lastRunAt)}</p>
          </button>
          <button
            onClick={() => setSelectedSource('ICMR')}
            className={`border p-5 text-left shadow-sm ${selectedSource === 'ICMR' ? 'border-rose-500 bg-rose-50' : 'border-slate-200 bg-white'}`}
          >
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">ICMR</div>
            <div className="mt-3 text-lg font-semibold text-slate-950">{icmr?.enabled ? 'Enabled' : 'Disabled'}</div>
            <p className="mt-1 text-sm text-slate-500">Last run: {formatDate(icmr?.lastRunAt)}</p>
          </button>
          <button
            onClick={() => setSelectedSource('ICSSR')}
            className={`border p-5 text-left shadow-sm ${selectedSource === 'ICSSR' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white'}`}
          >
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">ICSSR</div>
            <div className="mt-3 text-lg font-semibold text-slate-950">{icssr?.enabled ? 'Enabled' : 'Disabled'}</div>
            <p className="mt-1 text-sm text-slate-500">Last run: {formatDate(icssr?.lastRunAt)}</p>
          </button>
          <button
            onClick={() => setSelectedSource('CSV_IMPORT')}
            className={`border p-5 text-left shadow-sm ${selectedSource === 'CSV_IMPORT' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white'}`}
          >
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">CSV Importer</div>
            <div className="mt-3 text-lg font-semibold text-slate-950">{csvImport?.enabled ? 'Enabled' : 'Disabled'}</div>
            <p className="mt-1 text-sm text-slate-500">Last run: {formatDate(csvImport?.lastRunAt)}</p>
          </button>
        </section>

        {selectedSource === 'ICSSR' && (
          <section className="border border-indigo-200 bg-indigo-50/30 p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-indigo-700" />
              <h2 className="text-lg font-semibold text-slate-950">ICSSR PDF Upload</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Upload all ICSSR PDF files (Major, Minor, JSPS, NSTC, FFSI, etc.) in one go. Files are stored temporarily and processed during the crawl. Taiwan PI data from NSTC files is automatically excluded.
            </p>

            {canWrite && (
              <div className="mt-5">
                <label className="block text-sm font-medium text-slate-700">
                  Select PDF files to upload (multiple allowed)
                  <input
                    type="file"
                    accept=".pdf"
                    multiple
                    onChange={(event) => uploadFiles(event.target.files)}
                    disabled={isUploading}
                    className="mt-2 block w-full text-sm text-slate-600 file:mr-4 file:rounded file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-indigo-700 disabled:opacity-50"
                  />
                </label>
              </div>
            )}

            {isUploading && (
              <div className="mt-4 flex items-center gap-2 text-sm text-indigo-700">
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading files...
              </div>
            )}

            {uploadProgress && (
              <div className="mt-4 rounded bg-white p-3 text-sm">
                <div className="font-medium text-slate-700">Upload Results:</div>
                <div className="mt-1 text-slate-600">
                  Total: {uploadProgress.total} | Success:{' '}
                  <span className="text-emerald-600">{uploadProgress.success}</span> | Errors:{' '}
                  <span className="text-red-600">{uploadProgress.error}</span>
                </div>
              </div>
            )}

            {uploadedFiles.length > 0 && (
              <div className="mt-5">
                <h3 className="text-sm font-medium text-slate-700">
                  Uploaded Files ({uploadedFiles.length})
                </h3>
                <div className="mt-2 max-h-48 overflow-y-auto rounded border border-slate-200 bg-white">
                  {uploadedFiles.map((file) => (
                    <div
                      key={file.name}
                      className="flex items-center justify-between border-b border-slate-100 px-3 py-2 last:border-b-0"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FileText className="h-4 w-4 flex-shrink-0 text-slate-400" />
                        <span className="truncate text-sm text-slate-700" title={file.name}>
                          {file.name}
                        </span>
                      </div>
                      {canWrite && (
                        <button
                          onClick={() => deleteUploadedFile(file.name)}
                          className="flex-shrink-0 text-slate-400 hover:text-red-600"
                          title="Delete file"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {uploadedFiles.length === 0 && !isUploading && (
              <div className="mt-4 rounded border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-500">
                No PDF files uploaded yet. Upload files to begin crawling.
              </div>
            )}

            {!canWrite && (
              <p className="mt-4 text-sm text-slate-500">Viewer role: read-only file access.</p>
            )}
          </section>
        )}

        {selectedSource === 'CSV_IMPORT' && (
          <section className="border border-emerald-200 bg-emerald-50/30 p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-emerald-700" />
              <h2 className="text-lg font-semibold text-slate-950">CSV Manual Importer</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Upload CSV files containing manually collected project data from any funding agency (DST, DBT, DAE, DRDO, ISRO, etc.). The CSV can include columns like: Funding_agency, project_id, scheme, financial_year, title, pi_name, pi_organization, pi_emails, state, budget_size. The system auto-detects columns and reads the Funding_agency for each row.
            </p>

            {canWrite && (
              <div className="mt-5">
                <label className="block text-sm font-medium text-slate-700">
                  Select CSV files to upload (.csv or .txt)
                  <input
                    type="file"
                    accept=".csv,.txt"
                    multiple
                    onChange={(event) => uploadCsvFiles(event.target.files)}
                    disabled={isCsvUploading}
                    className="mt-2 block w-full text-sm text-slate-600 file:mr-4 file:rounded file:border-0 file:bg-emerald-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-emerald-700 disabled:opacity-50"
                  />
                </label>
              </div>
            )}

            {isCsvUploading && (
              <div className="mt-4 flex items-center gap-2 text-sm text-emerald-700">
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading CSV files...
              </div>
            )}

            {csvUploadProgress && (
              <div className="mt-4 rounded bg-white p-3 text-sm">
                <div className="font-medium text-slate-700">Upload Results:</div>
                <div className="mt-1 text-slate-600">
                  Total: {csvUploadProgress.total} | Success:{' '}
                  <span className="text-emerald-600">{csvUploadProgress.success}</span> | Errors:{' '}
                  <span className="text-red-600">{csvUploadProgress.error}</span>
                </div>
              </div>
            )}

            {csvFiles.length > 0 && (
              <div className="mt-5">
                <h3 className="text-sm font-medium text-slate-700">
                  Uploaded CSV Files ({csvFiles.length})
                </h3>
                <div className="mt-2 max-h-48 overflow-y-auto rounded border border-slate-200 bg-white">
                  {csvFiles.map((file) => (
                    <div
                      key={file.name}
                      className="flex items-center justify-between border-b border-slate-100 px-3 py-2 last:border-b-0"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FileSpreadsheet className="h-4 w-4 flex-shrink-0 text-slate-400" />
                        <span className="truncate text-sm text-slate-700" title={file.name}>
                          {file.name}
                        </span>
                      </div>
                      {canWrite && (
                        <button
                          onClick={() => deleteCsvFile(file.name)}
                          className="flex-shrink-0 text-slate-400 hover:text-red-600"
                          title="Delete file"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {csvFiles.length === 0 && !isCsvUploading && (
              <div className="mt-4 rounded border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-500">
                No CSV files uploaded yet. Upload DST project data files to begin import.
              </div>
            )}

            {!canWrite && (
              <p className="mt-4 text-sm text-slate-500">Viewer role: read-only file access.</p>
            )}
          </section>
        )}

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-sky-700" />
              <h2 className="text-lg font-semibold text-slate-950">{selectedSource} pilot controls</h2>
            </div>
            {selectedSource === 'PRISM' ? (
              <>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Local PRISM pilot is capped at 20 records: five online and five legacy rows per state where available.
                </p>
                <label className="mt-5 block text-sm font-medium text-slate-700">
                  Pilot states
                  <input
                    value={states}
                    onChange={(event) => setStates(event.target.value)}
                    disabled={!canWrite}
                    className="mt-2 w-full border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700 disabled:bg-slate-100"
                  />
                </label>
              </>
            ) : selectedSource === 'CSIR' ? (
              <>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Local CSIR pilot reads the paginated project list and follows each session-bound detail POST.
                </p>
                <label className="mt-5 block text-sm font-medium text-slate-700">
                  CSIR pilot record cap
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={csirPilotLimit}
                    onChange={(event) => setCsirPilotLimit(Number(event.target.value || 20))}
                    disabled={!canWrite}
                    className="mt-2 w-full border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700 disabled:bg-slate-100"
                  />
                </label>
              </>
            ) : selectedSource === 'BIRAC' ? (
              <>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Local BIRAC pilot discovers scheme tables and stores supported-project rows. Abstract is stored as NA and embeddings use title only.
                </p>
                <label className="mt-5 block text-sm font-medium text-slate-700">
                  BIRAC pilot record cap
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={biracPilotLimit}
                    onChange={(event) => setBiracPilotLimit(Number(event.target.value || 20))}
                    disabled={!canWrite}
                    className="mt-2 w-full border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700 disabled:bg-slate-100"
                  />
                </label>
              </>
            ) : selectedSource === 'ICMR' ? (
              <>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Local ICMR pilot discovers approved-project PDF links, parses table rows, stores the raw row JSON, and embeds title only because the PDFs do not expose abstracts.
                </p>
                <label className="mt-5 block text-sm font-medium text-slate-700">
                  ICMR pilot record cap
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={icmrPilotLimit}
                    onChange={(event) => setIcmrPilotLimit(Number(event.target.value || 20))}
                    disabled={!canWrite}
                    className="mt-2 w-full border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700 disabled:bg-slate-100"
                  />
                </label>
              </>
            ) : selectedSource === 'ICSSR' ? (
              <>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  ICSSR pilot processes uploaded PDF files, parses awarded project details (Major, Minor, Fellowships, Special Calls, JSPS, NSTC), stores the raw row JSON, and embeds title only. Taiwan PI information from NSTC files is automatically excluded.
                </p>
                {uploadedFiles.length === 0 && (
                  <div className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-800">
                    <AlertTriangle className="mb-1 inline h-4 w-4" />
                    No PDF files uploaded. Please upload files above before starting the crawl.
                  </div>
                )}
                <label className="mt-5 block text-sm font-medium text-slate-700">
                  ICSSR pilot record cap
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={icssrPilotLimit}
                    onChange={(event) => setIcssrPilotLimit(Number(event.target.value || 20))}
                    disabled={!canWrite}
                    className="mt-2 w-full border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700 disabled:bg-slate-100"
                  />
                </label>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  CSV Importer processes uploaded CSV files containing manually collected project data from any funding agency. Automatically detects the funding agency from the Funding_agency column. Supports DST, DBT, DAE, DRDO, ISRO, and other agencies. Embeds title only for search.
                </p>
                {csvFiles.length === 0 && (
                  <div className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-800">
                    <AlertTriangle className="mb-1 inline h-4 w-4" />
                    No CSV files uploaded. Please upload files in the section above before starting the import.
                  </div>
                )}
                <label className="mt-5 block text-sm font-medium text-slate-700">
                  CSV import record cap
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={csvImportLimit}
                    onChange={(event) => setCsvImportLimit(Number(event.target.value || 200))}
                    disabled={!canWrite}
                    className="mt-2 w-full border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700 disabled:bg-slate-100"
                  />
                </label>
              </>
            )}
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                onClick={startPilot}
                disabled={!canWrite || isBusy}
                className="inline-flex items-center gap-2 bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
              >
                <Play className="h-4 w-4" />
                Start {selectedSource} pilot
              </button>
              <button
                onClick={startFull}
                disabled={!canWrite || isBusy}
                className="inline-flex items-center gap-2 border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              >
                <AlertTriangle className="h-4 w-4" />
                Queue full {selectedSource} run
              </button>
            </div>
            {!canWrite && <p className="mt-4 text-sm text-slate-500">Viewer role: read-only crawl access.</p>}
          </div>

          <div className="border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Registered sources</h2>
            <div className="mt-4 space-y-3">
              {sources?.sources?.map((source) => (
                <div key={source.id} className="border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">{source.name}</div>
                      <div className="text-xs text-slate-500">{source.sourceKey} · {source.baseUrl}</div>
                    </div>
                    <span className={`px-2 py-1 text-xs font-semibold ${source.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                      {source.enabled ? 'Enabled' : 'Planned'}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                    <span>Projects: {source._count?.projects ?? 0}</span>
                    <span>Runs: {source._count?.crawlRuns ?? 0}</span>
                    <span>Last error: {source.lastError || '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Recent crawler runs</h2>
              <p className="mt-1 text-sm text-slate-600">Runs checkpoint after every record and can be retried safely.</p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-3 py-3 text-left">Source</th>
                  <th className="px-3 py-3 text-left">Mode</th>
                  <th className="px-3 py-3 text-left">Status</th>
                  <th className="px-3 py-3 text-left">Counters</th>
                  <th className="px-3 py-3 text-left">Updated</th>
                  <th className="px-3 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-3 py-3">{run.source?.sourceKey}</td>
                    <td className="px-3 py-3">{run.mode}</td>
                    <td className="px-3 py-3">{run.status}</td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      discovered {run.discoveredCount} · ok {run.succeededCount} · failed {run.failedCount} · quarantine {run.quarantinedCount}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500">{formatDate(run.updatedAt)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        {canWrite && ['queued', 'running'].includes(run.status) && (
                          <button onClick={() => postJson(`/api/super-admin/project-intelligence/crawlers/runs/${run.id}/cancel`)} className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                            <PauseCircle className="h-3.5 w-3.5" />
                            Cancel
                          </button>
                        )}
                        {canWrite && ['failed', 'blocked', 'completed_with_errors'].includes(run.status) && (
                          <button onClick={() => postJson(`/api/super-admin/project-intelligence/crawlers/runs/${run.id}/retry`)} className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700">
                            <RotateCcw className="h-3.5 w-3.5" />
                            Retry
                          </button>
                        )}
                        {canWrite && ['queued', 'running'].includes(run.status) && (
                          <button onClick={() => drainUntilDone(run.id)} disabled={isBusy} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 disabled:opacity-50">
                            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                            Run
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {runs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">No crawler runs yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Recent {selectedSource} records</h2>
              <p className="mt-1 text-sm text-slate-600">Contacts are stored separately and excluded from embeddings.</p>
            </div>
            <Link href="/super-admin/project-intelligence/crawlers" className="text-sm font-semibold text-sky-700">Crawler workspace</Link>
          </div>
          <div className="mt-4 grid gap-3">
            {projects.map((project) => (
              <div key={project.id} className="border border-slate-200 p-4">
                <div className="text-sm font-semibold text-slate-950">{project.title}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {project.primaryInvestigatorName || 'PI unavailable'} · {project.primaryInstitutionName || 'Institution unavailable'} · {project.state || 'State unavailable'} · {project.sanctionYear || 'Year unavailable'}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {[projectFundingAgency(project), project.sourceVariant, project.recordStatus, `embedding ${project.embeddingStatus}`].filter(Boolean).join(' · ')}
                </div>
              </div>
            ))}
            {projects.length === 0 && <div className="py-8 text-center text-sm text-slate-500">No {selectedSource} records ingested yet.</div>}
          </div>
        </section>
      </div>
    </div>
  )
}
