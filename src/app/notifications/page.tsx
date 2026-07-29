'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'

interface NotificationRow {
  id: string
  title: string
  body: string | null
  category: string
  linkUrl: string | null
  readAt: string | null
  createdAt: string
  createdBy: { id: string; name: string | null; email: string } | null
}

const CATEGORY_STYLES: Record<string, string> = {
  ASSIGNMENT: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  DEADLINE: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  OUTCOME: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  ANNOUNCEMENT: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  FUNDING_MATCH: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
}

export default function NotificationsPage() {
  const { user, isLoading: authLoading, authFetch } = useAuth()

  const [items, setItems] = useState<NotificationRow[]>([])
  const [unread, setUnread] = useState(0)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (unreadOnly) params.set('unreadOnly', 'true')
      const res = await authFetch(`/api/notifications?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load notifications')
      setItems(data.notifications || [])
      setUnread(data.unreadCount || 0)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [authFetch, unreadOnly])

  useEffect(() => {
    if (user) load()
  }, [user, load])

  const markRead = async (id: string) => {
    setItems((list) => list.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item)))
    setUnread((count) => Math.max(0, count - 1))
    await authFetch(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    }).catch(() => load())
  }

  const markAllRead = async () => {
    setUnread(0)
    setItems((list) => list.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })))
    await authFetch('/api/notifications/read-all', { method: 'POST' }).catch(() => load())
  }

  const dismiss = async (id: string) => {
    setItems((list) => list.filter((item) => item.id !== id))
    await authFetch(`/api/notifications/${id}`, { method: 'DELETE' }).catch(() => load())
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Sign in required</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Please log in to see your notifications.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Notifications</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {unread > 0 ? `${unread} unread` : 'You are all caught up.'}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setUnreadOnly((value) => !value)}
              className={`px-3 py-2 text-sm font-medium rounded-lg border ${
                unreadOnly
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
              }`}
            >
              Unread only
            </button>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                Mark all read
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-16 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {unreadOnly ? 'No unread notifications.' : 'No notifications yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className={`rounded-lg border p-4 ${
                  item.readAt
                    ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                    : 'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {!item.readAt && <span className="h-2 w-2 rounded-full bg-blue-600 flex-shrink-0" />}
                      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{item.title}</h2>
                      <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${CATEGORY_STYLES[item.category] || CATEGORY_STYLES.ANNOUNCEMENT}`}>
                        {item.category}
                      </span>
                    </div>
                    {item.body && (
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{item.body}</p>
                    )}
                    <p className="mt-1 text-xs text-gray-400">
                      {new Date(item.createdAt).toLocaleString()}
                      {item.createdBy && ` · from ${item.createdBy.name || item.createdBy.email}`}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-3 text-sm">
                  {item.linkUrl && (
                    <Link href={item.linkUrl} className="text-blue-600 hover:text-blue-800 dark:text-blue-400">
                      Open
                    </Link>
                  )}
                  {!item.readAt && (
                    <button onClick={() => markRead(item.id)} className="text-gray-600 hover:text-gray-900 dark:text-gray-300">
                      Mark read
                    </button>
                  )}
                  <button onClick={() => dismiss(item.id)} className="text-red-600 hover:text-red-800 dark:text-red-400">
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
