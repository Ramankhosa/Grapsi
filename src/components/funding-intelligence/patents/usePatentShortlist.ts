'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { formatShortlistMarkdown } from '@/lib/patentIntelligence/searchCore'
import type { PatentSearchItem, PatentShortlistItemDto } from '@/lib/patentIntelligence/types'

export const SHORTLIST_API = '/api/patent-intelligence/shortlist'

export function authHeaders(token: string | null | undefined, json = false): HeadersInit {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json()
    return body?.error || `Request failed (${response.status})`
  } catch {
    return `Request failed (${response.status})`
  }
}

function filenameFrom(response: Response, fallback: string): string {
  const disposition = response.headers.get('content-disposition') || ''
  const match = /filename="?([^";]+)"?/i.exec(disposition)
  return match?.[1] || fallback
}

export type PatentShortlistState = {
  items: PatentShortlistItemDto[]
  byKey: Map<string, PatentShortlistItemDto>
  loading: boolean
  error: string | null
  pendingKeys: Set<string>
  refresh: () => Promise<void>
  add: (record: PatentSearchItem, options?: { note?: string | null; ideaRunId?: string | null }) => Promise<PatentShortlistItemDto | null>
  remove: (id: string) => Promise<boolean>
  toggle: (record: PatentSearchItem, options?: { ideaRunId?: string | null }) => Promise<void>
  updateNote: (id: string, note: string | null) => Promise<void>
  exportAs: (format: 'csv' | 'md', options?: { runId?: string | null }) => Promise<void>
  copyMarkdown: (items: PatentShortlistItemDto[], heading?: string) => Promise<boolean>
}

/**
 * The signed-in user's saved patents, shared by the search page, detail page,
 * and drawer. Mutations are optimistic; a failed call rolls back and surfaces
 * `error`.
 */
export function usePatentShortlist(token: string | null | undefined): PatentShortlistState {
  const [items, setItems] = useState<PatentShortlistItemDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set())
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const markPending = useCallback((key: string, pending: boolean) => {
    setPendingKeys((current) => {
      const next = new Set(current)
      if (pending) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  const refresh = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const response = await fetch(SHORTLIST_API, { headers: authHeaders(token), cache: 'no-store' })
      if (!response.ok) throw new Error(await readError(response))
      const body = await response.json()
      if (mounted.current) {
        setItems(Array.isArray(body.items) ? body.items : [])
        setError(null)
      }
    } catch (loadError) {
      if (mounted.current) setError(loadError instanceof Error ? loadError.message : 'Could not load your shortlist')
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [token])

  useEffect(() => { void refresh() }, [refresh])

  const byKey = useMemo(() => new Map(items.map((item) => [item.publicationNumberKey, item])), [items])

  const add = useCallback<PatentShortlistState['add']>(async (record, options = {}) => {
    if (!token) return null
    const key = record.publicationNumberKey
    markPending(key, true)
    try {
      const response = await fetch(SHORTLIST_API, {
        method: 'POST',
        headers: authHeaders(token, true),
        body: JSON.stringify({ record, note: options.note ?? null, ideaRunId: options.ideaRunId ?? null }),
      })
      if (!response.ok) throw new Error(await readError(response))
      const body = await response.json()
      const saved: PatentShortlistItemDto = body.item
      setItems((current) => [saved, ...current.filter((item) => item.publicationNumberKey !== saved.publicationNumberKey)])
      setError(null)
      return saved
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the patent')
      return null
    } finally {
      markPending(key, false)
    }
  }, [markPending, token])

  const remove = useCallback<PatentShortlistState['remove']>(async (id) => {
    if (!token) return false
    const target = items.find((item) => item.id === id)
    const key = target?.publicationNumberKey || id
    markPending(key, true)
    const previous = items
    setItems((current) => current.filter((item) => item.id !== id))
    try {
      const response = await fetch(`${SHORTLIST_API}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders(token) })
      if (!response.ok && response.status !== 404) throw new Error(await readError(response))
      setError(null)
      return true
    } catch (removeError) {
      setItems(previous)
      setError(removeError instanceof Error ? removeError.message : 'Could not remove the patent')
      return false
    } finally {
      markPending(key, false)
    }
  }, [items, markPending, token])

  const toggle = useCallback<PatentShortlistState['toggle']>(async (record, options = {}) => {
    const existing = byKey.get(record.publicationNumberKey)
    if (existing) await remove(existing.id)
    else await add(record, { ideaRunId: options.ideaRunId ?? null })
  }, [add, byKey, remove])

  const updateNote = useCallback<PatentShortlistState['updateNote']>(async (id, note) => {
    if (!token) return
    const previous = items
    setItems((current) => current.map((item) => (item.id === id ? { ...item, note } : item)))
    try {
      const response = await fetch(`${SHORTLIST_API}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: authHeaders(token, true),
        body: JSON.stringify({ note }),
      })
      if (!response.ok) throw new Error(await readError(response))
      setError(null)
    } catch (noteError) {
      setItems(previous)
      setError(noteError instanceof Error ? noteError.message : 'Could not save the note')
    }
  }, [items, token])

  const exportAs = useCallback<PatentShortlistState['exportAs']>(async (format, options = {}) => {
    if (!token) return
    const params = new URLSearchParams({ format })
    if (options.runId) params.set('runId', options.runId)
    try {
      const response = await fetch(`${SHORTLIST_API}/export?${params.toString()}`, { headers: authHeaders(token) })
      if (!response.ok) throw new Error(await readError(response))
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filenameFrom(response, `patent-shortlist.${format}`)
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setError(null)
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Could not export the shortlist')
    }
  }, [token])

  const copyMarkdown = useCallback<PatentShortlistState['copyMarkdown']>(async (selected, heading) => {
    try {
      await navigator.clipboard.writeText(formatShortlistMarkdown(selected, heading ? { heading } : {}))
      return true
    } catch {
      setError('Clipboard access was blocked — use Download instead.')
      return false
    }
  }, [])

  return { items, byKey, loading, error, pendingKeys, refresh, add, remove, toggle, updateNote, exportAs, copyMarkdown }
}
