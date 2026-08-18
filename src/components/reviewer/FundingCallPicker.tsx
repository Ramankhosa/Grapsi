import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import {
  FaCheck,
  FaExclamationTriangle,
  FaExternalLinkAlt,
  FaSearch,
  FaSpinner,
  FaTimes,
} from 'react-icons/fa'

import {
  READINESS_BADGE_CLASS,
  READINESS_HELP,
  dedupeById,
  formatCallDeadline,
  resolveVisibleCalls,
  splitOnQuery,
  type FundingCallOption,
} from '@/lib/reviewer/fundingCallPicker'

export type { FundingCallOption }

/**
 * Picking a stored funding call.
 *
 * This deliberately does not use a native `<select size=...>` listbox. A
 * controlled `<select>` whose `value` is not among its rendered `<option>`s —
 * which happens the moment a search filters the selected call out of the list —
 * gets its first option force-selected by React without a `change` event. The
 * highlighted row and the selected id then disagree, and clicking the row that
 * is already highlighted is silently swallowed by the browser because
 * `selectedIndex` never changes. Rows here are ordinary buttons: one click, one
 * `onChange`, no hidden DOM state to drift out of sync.
 */

const SEARCH_DEBOUNCE_MS = 250
// Below this, the local list is a better answer than a round trip.
const MIN_REMOTE_QUERY = 2
const LIBRARY_PAGE_SIZE = 100
const SEARCH_PAGE_SIZE = 50

function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitOnQuery(text, query).map((part, index) =>
        part.match ? (
          <mark key={index} className="rounded-[3px] bg-cobalt-100 px-0.5 text-cobalt-900">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        )
      )}
    </>
  )
}

function CallRow({
  call,
  query,
  selected,
  tabIndex,
  onSelect,
  onFocus,
  rowRef,
}: {
  call: FundingCallOption
  query: string
  selected: boolean
  tabIndex: number
  onSelect: () => void
  onFocus?: () => void
  rowRef?: (node: HTMLButtonElement | null) => void
}) {
  const deadline = formatCallDeadline(call.deadlineAt)
  return (
    <button
      ref={rowRef}
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={tabIndex}
      onClick={onSelect}
      onFocus={onFocus}
      className={`flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors duration-100 focus:outline-none focus-visible:bg-cobalt-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cobalt-600 ${
        selected ? 'bg-cobalt-50' : 'hover:bg-nickel-50'
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          selected ? 'border-cobalt-600 bg-cobalt-600 text-white' : 'border-nickel-300 bg-white'
        }`}
      >
        {selected ? <FaCheck className="h-2 w-2" /> : null}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={`block text-[13.5px] leading-5 ${
            selected ? 'font-semibold text-cobalt-900' : 'font-medium text-nickel-900'
          }`}
        >
          <Highlight text={call.title} query={query} />
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-nickel-500">
          <Highlight text={call.agencyName || 'Agency not recorded'} query={query} />
          {deadline ? <span className="text-nickel-500"> · Closes {deadline}</span> : null}
        </span>
      </span>

      {call.readinessLabel ? (
        <span className={`${READINESS_BADGE_CLASS[call.readiness || ''] || 'nk-badge'} mt-0.5 shrink-0`}>
          {call.readinessLabel}
        </span>
      ) : null}
    </button>
  )
}

export default function FundingCallPicker({
  value,
  onChange,
  enabled = true,
  invalid = false,
  onUseUrlMode,
}: {
  value: FundingCallOption | null
  onChange: (call: FundingCallOption | null) => void
  enabled?: boolean
  invalid?: boolean
  onUseUrlMode?: () => void
}) {
  const [library, setLibrary] = useState<FundingCallOption[]>([])
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [libraryError, setLibraryError] = useState('')
  const [query, setQuery] = useState('')
  const [remote, setRemote] = useState<{ query: string; calls: FundingCallOption[] } | null>(null)
  const [searching, setSearching] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [reloadKey, setReloadKey] = useState(0)

  const searchRef = useRef<HTMLInputElement | null>(null)
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([])

  const trimmedQuery = query.trim()

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const loadLibrary = async () => {
      try {
        setLibraryLoading(true)
        const response = await axios.get('/api/reviewer/funding-calls', {
          params: { limit: LIBRARY_PAGE_SIZE },
        })
        if (cancelled) return
        setLibrary(dedupeById(response.data?.calls || []))
        setLibraryError('')
      } catch (error) {
        if (cancelled) return
        console.error('Failed to load funding calls:', error)
        setLibraryError('Could not load the funding call library. Retry, or start from a call URL instead.')
      } finally {
        if (!cancelled) setLibraryLoading(false)
      }
    }

    void loadLibrary()
    return () => {
      cancelled = true
    }
  }, [enabled, reloadKey])

  // The library list is only the most recently updated page of calls, so a call
  // that is genuinely in the database can sit outside it. Anything typed goes
  // back to the server, which searches the whole table.
  useEffect(() => {
    if (!enabled || trimmedQuery.length < MIN_REMOTE_QUERY) {
      setRemote(null)
      setSearching(false)
      return
    }

    let cancelled = false
    setSearching(true)

    const timer = setTimeout(async () => {
      try {
        const response = await axios.get('/api/reviewer/funding-calls', {
          params: { search: trimmedQuery, limit: SEARCH_PAGE_SIZE },
        })
        if (cancelled) return
        setRemote({ query: trimmedQuery, calls: dedupeById(response.data?.calls || []) })
      } catch (error) {
        if (cancelled) return
        // Fall back to filtering what is already loaded.
        console.error('Funding call search failed:', error)
        setRemote(null)
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [enabled, trimmedQuery])

  const results = useMemo(
    () => resolveVisibleCalls({ library, query: trimmedQuery, remote }),
    [library, remote, trimmedQuery]
  )

  const selectedIndex = value ? results.findIndex((call) => call.id === value.id) : -1
  const selectedOutsideResults = Boolean(value) && selectedIndex === -1
  // One row must stay tabbable so the list is reachable by keyboard.
  const rovingIndex = activeIndex >= 0 ? activeIndex : selectedIndex >= 0 ? selectedIndex : 0

  useEffect(() => {
    rowRefs.current.length = results.length
    setActiveIndex(-1)
  }, [results.length, trimmedQuery])

  const moveActive = useCallback(
    (nextIndex: number) => {
      if (results.length === 0) return
      const clamped = Math.max(0, Math.min(results.length - 1, nextIndex))
      setActiveIndex(clamped)
      const node = rowRefs.current[clamped]
      node?.focus()
      // Only ever scrolls in response to a key press — never on render, which is
      // what made the old listbox jump out from under the pointer.
      node?.scrollIntoView({ block: 'nearest' })
    },
    [results.length]
  )

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActive(activeIndex + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (activeIndex <= 0) {
        setActiveIndex(-1)
        searchRef.current?.focus()
      } else {
        moveActive(activeIndex - 1)
      }
    } else if (event.key === 'Home') {
      event.preventDefault()
      moveActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      moveActive(results.length - 1)
    }
  }

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActive(selectedIndex >= 0 ? selectedIndex : 0)
    } else if (event.key === 'Enter') {
      // A lone match is what the typing was aiming at; don't submit the form.
      event.preventDefault()
      if (results.length === 1) onChange(results[0])
    }
  }

  const deadline = formatCallDeadline(value?.deadlineAt)
  const libraryEmpty =
    !libraryLoading && !libraryError && library.length === 0 && !trimmedQuery && !remote

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor="fundingCallSearch" className="nk-label">
          Funding call*
        </label>
        {!libraryLoading && !libraryEmpty ? (
          <span className="text-[11.5px] text-nickel-500">
            {trimmedQuery
              ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}`
              : `${library.length} in your library`}
          </span>
        ) : null}
      </div>

      {libraryError ? (
        <div className="mb-2 flex flex-wrap items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          <FaExclamationTriangle className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{libraryError}</span>
          <button
            type="button"
            onClick={() => setReloadKey((current) => current + 1)}
            className="shrink-0 font-semibold underline"
          >
            Retry
          </button>
        </div>
      ) : null}

      {libraryEmpty ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800">
          No funding calls are available to your account yet. Switch to{' '}
          <button type="button" className="font-medium underline" onClick={onUseUrlMode}>
            the call URL route
          </button>{' '}
          to start from the agency&apos;s own page.
        </div>
      ) : (
        <div
          className={`overflow-hidden rounded-lg border bg-white ${
            invalid ? 'border-red-300' : 'border-nickel-200'
          }`}
        >
          {/* Search */}
          <div className="relative border-b border-nickel-200">
            <FaSearch
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-nickel-400"
              aria-hidden="true"
            />
            <input
              id="fundingCallSearch"
              ref={searchRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="fundingCallList"
              aria-autocomplete="list"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search every call by scheme or agency..."
              className="w-full bg-transparent py-2.5 pl-9 pr-20 text-[13.5px] text-nickel-900 outline-none placeholder:text-nickel-400"
            />
            <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-2">
              {searching ? (
                <FaSpinner className="h-3.5 w-3.5 animate-spin text-nickel-400" aria-hidden="true" />
              ) : null}
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('')
                    searchRef.current?.focus()
                  }}
                  className="rounded p-1 text-nickel-500 hover:bg-nickel-100 hover:text-nickel-900"
                  aria-label="Clear search"
                >
                  <FaTimes className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          </div>

          {/* Selected call, pinned when the search has scrolled it out of view */}
          {selectedOutsideResults && value ? (
            <div className="border-b border-cobalt-200 bg-cobalt-50/60">
              <div className="px-3.5 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-cobalt-700">
                Selected — clear the search to see it in the list
              </div>
              <CallRow
                call={value}
                query=""
                selected
                tabIndex={-1}
                onSelect={() => {
                  setQuery('')
                  searchRef.current?.focus()
                }}
              />
            </div>
          ) : null}

          {/* Results */}
          {libraryLoading ? (
            <div className="space-y-2 p-3.5" aria-live="polite">
              {[0, 1, 2].map((row) => (
                <div key={row} className="h-9 animate-pulse rounded-md bg-nickel-100" />
              ))}
              <span className="sr-only">Loading funding calls</span>
            </div>
          ) : results.length === 0 ? (
            <div className="px-3.5 py-6 text-center">
              <p className="text-[13px] text-nickel-700">
                {trimmedQuery
                  ? `No calls match “${trimmedQuery}”${searching ? ' yet' : ''}.`
                  : 'No funding calls loaded.'}
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                {trimmedQuery ? (
                  <button type="button" className="nk-btn-secondary nk-btn-xs" onClick={() => setQuery('')}>
                    Clear search
                  </button>
                ) : null}
                {onUseUrlMode ? (
                  <button type="button" className="nk-btn-ghost nk-btn-xs" onClick={onUseUrlMode}>
                    Start from the call URL instead
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div
              id="fundingCallList"
              role="listbox"
              aria-label="Funding calls"
              onKeyDown={handleListKeyDown}
              className="max-h-[19rem] divide-y divide-nickel-100 overflow-y-auto"
            >
              {results.map((call, index) => (
                <CallRow
                  key={call.id}
                  call={call}
                  query={trimmedQuery}
                  selected={value?.id === call.id}
                  tabIndex={index === rovingIndex ? 0 : -1}
                  rowRef={(node) => {
                    rowRefs.current[index] = node
                  }}
                  onFocus={() => setActiveIndex(index)}
                  onSelect={() => {
                    setActiveIndex(index)
                    onChange(call)
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Selected call detail */}
      {value ? (
        <div className="mt-3 rounded-lg border border-nickel-200 bg-nickel-50 p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="nk-eyebrow">Reviewing against</div>
              <div className="mt-1 text-[13.5px] font-semibold text-nickel-900">{value.title}</div>
              <div className="mt-0.5 text-[12.5px] text-nickel-600">
                {value.agencyName || 'Agency not recorded'}
                {deadline ? ` · Closes ${deadline}` : ''}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {value.readinessLabel ? (
                <span className={READINESS_BADGE_CLASS[value.readiness || ''] || 'nk-badge'}>
                  {value.readinessLabel}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  onChange(null)
                  searchRef.current?.focus()
                }}
                className="nk-btn-ghost nk-btn-xs"
              >
                Clear
              </button>
            </div>
          </div>

          {value.summary ? (
            <p className="mt-2 line-clamp-3 text-[12.5px] leading-5 text-nickel-600">{value.summary}</p>
          ) : null}

          {value.readiness ? (
            <p className="mt-2 text-[12px] leading-5 text-nickel-500">{READINESS_HELP[value.readiness]}</p>
          ) : null}

          {value.sourceUrl ? (
            <a
              href={value.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-cobalt-700 hover:text-cobalt-800"
            >
              <FaExternalLinkAlt className="h-2.5 w-2.5" aria-hidden="true" />
              Open the call page
            </a>
          ) : null}
        </div>
      ) : !libraryLoading && !libraryEmpty ? (
        <p className="mt-2 text-[12.5px] text-nickel-500">
          Nothing selected yet — pick the call this proposal is being written for.
        </p>
      ) : null}
    </div>
  )
}
