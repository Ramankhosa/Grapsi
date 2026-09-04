'use client'

import { useState } from 'react'

import type { PreviewResult, SelectorSuggestion } from './types'
import { FREQUENCIES } from './types'

type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>

function SingleAdd({
  authedFetch,
  onAdded,
}: {
  authedFetch: AuthedFetch
  onAdded: () => void
}) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [selector, setSelector] = useState('')
  const [frequency, setFrequency] = useState(1440)
  const [keywords, setKeywords] = useState('')
  const [tags, setTags] = useState('')
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saveStage, setSaveStage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null)

  async function testFetch(overrideSelector?: string) {
    const activeSelector = overrideSelector ?? selector
    setPreviewing(true)
    setError(null)
    try {
      const response = await authedFetch('/api/funding/monitor/sources/preview', {
        method: 'POST',
        body: JSON.stringify({ url, selector: activeSelector || null }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? 'Fetch failed')
      setPreview(data)
      if (!name && data.pageTitle) setName(String(data.pageTitle).slice(0, 120))
    } catch (caught) {
      setPreview(null)
      setError(caught instanceof Error ? caught.message : 'Fetch failed')
    } finally {
      setPreviewing(false)
    }
  }

  function applySuggestion(suggestion: SelectorSuggestion) {
    setSelector(suggestion.selector)
    void testFetch(suggestion.selector)
  }

  async function save(force = false) {
    setSaving(true)
    setError(null)
    setDuplicateOf(null)
    try {
      setSaveStage('Saving…')
      const response = await authedFetch('/api/funding/monitor/sources', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim() || new URL(url).hostname,
          url,
          selector: selector.trim() || null,
          frequencyMinutes: frequency,
          keywords: keywords.trim(),
          tags: tags.trim(),
          force,
        }),
      })
      const data = await response.json()
      if (response.status === 409 && data.duplicateOf) {
        setDuplicateOf(data.duplicateOf)
        throw new Error(data.message)
      }
      if (!response.ok) throw new Error(data.message ?? 'Save failed')

      // Baseline immediately: a source with no snapshot can't detect anything,
      // and waiting for tomorrow's sweep to learn that feels broken.
      setSaveStage('Running first check…')
      await authedFetch(`/api/funding/monitor/sources/${data.source.id}/check`, {
        method: 'POST',
      }).catch(() => undefined)

      setName('')
      setUrl('')
      setSelector('')
      setKeywords('')
      setTags('')
      setPreview(null)
      onAdded()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Save failed')
    } finally {
      setSaving(false)
      setSaveStage(null)
    }
  }

  return (
    <>
      <div className="cb-card space-y-4 p-5">
        <div>
          <label className="cb-label mb-1" htmlFor="monitor-url">
            Page URL
          </label>
          <input
            id="monitor-url"
            className="cb-input"
            placeholder="https://anrf.res.in/opportunities"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>
        <div>
          <label className="cb-label mb-1" htmlFor="monitor-name">
            Name
          </label>
          <input
            id="monitor-name"
            className="cb-input"
            placeholder="Auto-filled from the page title"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <label className="cb-label mb-1" htmlFor="monitor-selector">
            Watched region
          </label>
          <input
            id="monitor-selector"
            className="cb-input font-mono"
            placeholder="Leave empty to watch the whole page — or use Test fetch for suggestions"
            value={selector}
            onChange={(event) => setSelector(event.target.value)}
          />
          <p className="cb-hint mt-1">
            Narrowing to the list of calls keeps banners, counters, and news tickers from raising
            false alarms.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="cb-label mb-1" htmlFor="monitor-frequency">
              Check frequency
            </label>
            <select
              id="monitor-frequency"
              className="cb-select"
              value={frequency}
              onChange={(event) => setFrequency(Number(event.target.value))}
            >
              {FREQUENCIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="cb-label mb-1" htmlFor="monitor-keywords">
              Priority keywords
            </label>
            <input
              id="monitor-keywords"
              className="cb-input"
              placeholder="fellowship, biotech"
              value={keywords}
              onChange={(event) => setKeywords(event.target.value)}
            />
          </div>
          <div>
            <label className="cb-label mb-1" htmlFor="monitor-tags">
              Tags
            </label>
            <input
              id="monitor-tags"
              className="cb-input"
              placeholder="india, govt"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
            />
          </div>
        </div>

        <div className="cb-divider pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="cb-btn-secondary"
              onClick={() => testFetch()}
              disabled={previewing || !url}
            >
              {previewing ? 'Fetching…' : 'Test fetch'}
            </button>
            <button className="cb-btn-primary" onClick={() => save(false)} disabled={saving || !url}>
              {saveStage ?? 'Save & run first check'}
            </button>
          </div>
        </div>

        {error && (
          <p className="text-[13px] text-red-600">
            {error}
            {duplicateOf && (
              <button className="ml-2 underline" onClick={() => save(true)} disabled={saving}>
                Add anyway
              </button>
            )}
          </p>
        )}
      </div>

      {preview && (
        <div className="cb-card space-y-4 p-5">
          {preview.feedUrl && (
            <div className="rounded-lg border border-cobalt-100 bg-cobalt-50 p-3">
              <p className="text-[13px] font-medium text-cobalt-700">
                RSS feed found — Moni will watch that instead of the page.
              </p>
              <p className="mt-1 truncate font-mono text-[12px] text-muted">{preview.feedUrl}</p>
            </div>
          )}
          {preview.selectorOk === false && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
              That selector matches nothing on this page, so Moni would watch the whole page
              instead. Check it for typos.
            </div>
          )}

          {preview.suggestions.length > 0 && (
            <div>
              <p className="cb-eyebrow mb-2">Suggested regions to watch — click to apply</p>
              <div className="space-y-2">
                {preview.suggestions.map((suggestion) => (
                  <button
                    key={suggestion.selector}
                    onClick={() => applySuggestion(suggestion)}
                    className="block w-full rounded-lg border border-hairline bg-inset p-3 text-left transition hover:border-cobalt-600"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <code className="font-mono text-[12px] font-semibold text-cobalt-700">
                        {suggestion.selector}
                      </code>
                      <span className="font-mono text-[11px] text-muted">
                        {suggestion.linkCount} links
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[12px] text-muted">
                      {suggestion.preview.join(' · ')}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="cb-eyebrow mb-2">
              What Moni will watch — {preview.totalLines} lines, first{' '}
              {(preview.feedPreview ?? preview.lines).length} shown
            </p>
            <pre className="cb-scroll-x max-h-80 overflow-auto rounded-lg border border-hairline bg-inset p-3 font-mono text-[11.5px] leading-relaxed text-ink-soft">
              {(preview.feedPreview ?? preview.lines).join('\n')}
            </pre>
          </div>
        </div>
      )}
    </>
  )
}

function BulkAdd({ authedFetch, onAdded }: { authedFetch: AuthedFetch; onAdded: () => void }) {
  const [urls, setUrls] = useState('')
  const [frequency, setFrequency] = useState(1440)
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    created: number
    skipped: { url: string; reason: string }[]
  } | null>(null)

  async function importAll() {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const list = urls
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      const response = await authedFetch('/api/funding/monitor/sources/bulk', {
        method: 'POST',
        body: JSON.stringify({ urls: list, frequencyMinutes: frequency, tags: tags.trim() }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? 'Import failed')
      setResult(data)
      setUrls('')
      onAdded()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cb-card space-y-4 p-5">
      <p className="cb-hint">
        Paste the funder pages you already track — one URL per line, up to 200. Each becomes a
        source named after its site, and the next sweep records its baseline. Refine names and
        watched regions afterwards, starting with the ones that matter most.
      </p>
      <textarea
        className="cb-textarea min-h-40 font-mono text-[12px]"
        placeholder={'https://anrf.res.in/opportunities\nhttps://dbtindia.gov.in/latest-announcement'}
        value={urls}
        onChange={(event) => setUrls(event.target.value)}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="cb-label mb-1" htmlFor="bulk-frequency">
            Check frequency (all)
          </label>
          <select
            id="bulk-frequency"
            className="cb-select"
            value={frequency}
            onChange={(event) => setFrequency(Number(event.target.value))}
          >
            {FREQUENCIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="cb-label mb-1" htmlFor="bulk-tags">
            Tags (all)
          </label>
          <input
            id="bulk-tags"
            className="cb-input"
            placeholder="india, govt"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
        </div>
      </div>
      <button className="cb-btn-primary" onClick={importAll} disabled={busy || !urls.trim()}>
        {busy ? 'Importing…' : 'Import all'}
      </button>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      {result && (
        <div className="rounded-lg border border-cobalt-100 bg-cobalt-50 p-3 text-[13px]">
          <p className="font-medium text-cobalt-700">{result.created} source(s) added.</p>
          {result.skipped.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[12px] text-muted">
              {result.skipped.map((item, index) => (
                <li key={index}>
                  Skipped {item.url} — {item.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default function MonitorAddSource({
  authedFetch,
  onAdded,
}: {
  authedFetch: AuthedFetch
  onAdded: () => void
}) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single')

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        <button
          className={`cb-tab ${mode === 'single' ? 'cb-tab-active' : ''}`}
          onClick={() => setMode('single')}
        >
          One page
        </button>
        <button
          className={`cb-tab ${mode === 'bulk' ? 'cb-tab-active' : ''}`}
          onClick={() => setMode('bulk')}
        >
          Bulk import
        </button>
      </div>
      {mode === 'single' ? (
        <SingleAdd authedFetch={authedFetch} onAdded={onAdded} />
      ) : (
        <BulkAdd authedFetch={authedFetch} onAdded={onAdded} />
      )}
    </div>
  )
}
