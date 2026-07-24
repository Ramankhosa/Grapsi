'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

export interface NotificationItem {
  id: string
  title: string
  body: string | null
  category: string
  linkUrl: string | null
  readAt: string | null
  createdAt: string
}

/** Poll interval — cheap (one indexed count) and avoids needing websockets. */
const POLL_MS = 60000

function timeAgo(value: string) {
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(value).toLocaleDateString()
}

export default function NotificationBell() {
  const { user, authFetch } = useAuth()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/notifications?limit=10')
      if (!res.ok) return
      const data = await res.json()
      setItems(data.notifications || [])
      setUnread(data.unreadCount || 0)
    } catch {
      /* transient — the next poll will retry */
    }
  }, [authFetch])

  useEffect(() => {
    if (!user) return
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [user, load])

  // Close when clicking outside the dropdown.
  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const markAllRead = async () => {
    // Optimistic: the badge should clear instantly.
    setUnread(0)
    setItems((list) => list.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })))
    try {
      await authFetch('/api/notifications/read-all', { method: 'POST' })
    } catch {
      load()
    }
  }

  const markRead = async (id: string) => {
    setItems((list) => list.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item)))
    setUnread((count) => Math.max(0, count - 1))
    try {
      await authFetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: true }),
      })
    } catch {
      load()
    }
  }

  if (!user) return null

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => {
          setOpen((value) => !value)
          if (!open) load()
        }}
        className="relative p-2 rounded-lg text-gpt-gray-600 hover:bg-gpt-gray-100"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-gpt-gray-200 rounded-lg shadow-lg z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gpt-gray-200 bg-gpt-gray-50">
            <span className="text-sm font-semibold text-gpt-gray-900">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-blue-600 hover:text-blue-800">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-gpt-gray-500">Nothing yet.</div>
            ) : (
              items.map((item) => {
                const content = (
                  <>
                    <div className="flex items-start gap-2">
                      {!item.readAt && <span className="mt-1.5 h-2 w-2 rounded-full bg-blue-600 flex-shrink-0" />}
                      <div className={item.readAt ? 'flex-1 pl-4' : 'flex-1'}>
                        <div className="text-sm font-medium text-gpt-gray-900">{item.title}</div>
                        {item.body && <div className="text-xs text-gpt-gray-600 mt-0.5">{item.body}</div>}
                        <div className="text-[11px] text-gpt-gray-400 mt-1">{timeAgo(item.createdAt)}</div>
                      </div>
                    </div>
                  </>
                )

                return (
                  <div
                    key={item.id}
                    onClick={() => !item.readAt && markRead(item.id)}
                    className="px-3 py-2 border-b border-gpt-gray-100 hover:bg-gpt-gray-50 cursor-pointer"
                  >
                    {item.linkUrl ? (
                      <Link href={item.linkUrl} onClick={() => setOpen(false)}>
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </div>
                )
              })
            )}
          </div>

          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-center text-sm text-blue-600 hover:bg-gpt-gray-50"
          >
            View all
          </Link>
        </div>
      )}
    </div>
  )
}
