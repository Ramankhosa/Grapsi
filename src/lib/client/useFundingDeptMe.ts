'use client'

import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'

/**
 * The caller's Funding Department standing, fetched once per page load.
 *
 * Client gates read from here instead of inspecting role strings. Roles are a
 * poor proxy for what the server will allow — a covering department member and
 * an org head both hold none of the assigner roles yet can assign, which is how
 * the matching and assignment screens ended up hiding the assign button from
 * exactly the people whose job it is.
 */

export interface FundingDeptSchool {
  id: string
  name: string | null
  code: string | null
  coverageId?: string
}

export interface FundingDeptMe {
  isMember: boolean
  isHead: boolean
  memberId: string | null
  title: string | null
  schools: FundingDeptSchool[]
  canAdminister: boolean
  capabilities: {
    canAssign: boolean
    canViewReports: boolean
    isTenantWide: boolean
  }
}

const EMPTY: FundingDeptMe = {
  isMember: false,
  isHead: false,
  memberId: null,
  title: null,
  schools: [],
  canAdminister: false,
  capabilities: { canAssign: false, canViewReports: false, isTenantWide: false },
}

/**
 * One in-flight request per user, shared by every component that asks.
 *
 * The header, the product chooser and the page body all want this answer on the
 * same render, and without the shared promise that is one HTTP round trip and
 * three database queries each. Keyed by user id so switching accounts refetches
 * rather than showing the previous person's standing.
 */
let cache: { userId: string; promise: Promise<FundingDeptMe> } | null = null

function load(userId: string, authFetch: (url: string, init?: RequestInit) => Promise<Response>) {
  if (cache?.userId === userId) {
    return cache.promise
  }
  const promise = authFetch('/api/funding-dept/me')
    .then(async (response) => {
      // A user with no tenant gets a 403 here, which is a real answer rather
      // than an error worth surfacing: they have no department standing.
      if (!response.ok) return EMPTY
      return (await response.json()) as FundingDeptMe
    })
    .catch(() => EMPTY)
  cache = { userId, promise }
  return promise
}

export function invalidateFundingDeptMe() {
  cache = null
}

export function useFundingDeptMe() {
  const { authFetch, user, isLoading: authLoading } = useAuth()
  const [data, setData] = useState<FundingDeptMe | null>(null)
  const [loading, setLoading] = useState(true)
  const userId = user?.user_id ?? null

  const refresh = useCallback(async () => {
    if (!userId) {
      cache = null
      setData(null)
      setLoading(false)
      return
    }
    const result = await load(userId, authFetch)
    setData(result)
    setLoading(false)
  }, [authFetch, userId])

  useEffect(() => {
    if (authLoading) return
    let cancelled = false
    void (async () => {
      if (!userId) {
        cache = null
        if (!cancelled) {
          setData(null)
          setLoading(false)
        }
        return
      }
      const result = await load(userId, authFetch)
      if (!cancelled) {
        setData(result)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authLoading, userId, authFetch])

  return {
    me: data ?? EMPTY,
    loading: loading || authLoading,
    refresh: useCallback(async () => {
      cache = null
      await refresh()
    }, [refresh]),
  }
}
