'use client'

import { useEffect, useMemo, useState, useCallback, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'

interface CitationManagerProps {
  sessionId: string
  authToken: string | null
  citations?: any[]
  onCitationsUpdated?: (citations: any[]) => void
  onInsertCitation?: (citationKey: string) => void
  allowSelection?: boolean
  usageFilterAction?: ReactNode
}

const EMPTY_EDIT = {
  title: '',
  authors: '',
  year: '',
  venue: '',
  volume: '',
  issue: '',
  pages: '',
  doi: '',
  url: '',
  isbn: '',
  publisher: '',
  edition: '',
  editors: '',
  publicationPlace: '',
  publicationDate: '',
  accessedDate: '',
  articleNumber: '',
  issn: '',
  journalAbbreviation: '',
  pmid: '',
  pmcid: '',
  arxivId: '',
  abstract: '',
  notes: '',
  tags: ''
}

export default function CitationManager({
  sessionId,
  authToken,
  citations: externalCitations,
  onCitationsUpdated,
  onInsertCitation,
  allowSelection = false,
  usageFilterAction
}: CitationManagerProps) {
  const [citations, setCitations] = useState<any[]>(externalCitations || [])
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<any | null>(null)
  const [editValues, setEditValues] = useState<typeof EMPTY_EDIT>(EMPTY_EDIT)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [fetchingAbstract, setFetchingAbstract] = useState(false)
  const [usageFilter, setUsageFilter] = useState<'all' | 'used' | 'unused'>('all')

  const syncCitations = useCallback((updated: any[]) => {
    setCitations(updated)
    onCitationsUpdated?.(updated)
  }, [onCitationsUpdated])

  const loadCitations = useCallback(async () => {
    if (!authToken) return;
    const response = await fetch(`/api/papers/${sessionId}/citations`, {
      headers: { Authorization: `Bearer ${authToken}` }
    })
    if (!response.ok) return
    const data = await response.json()
    syncCitations(data.citations || [])
  }, [authToken, sessionId, syncCitations])

  useEffect(() => {
    if (externalCitations) {
      setCitations(externalCitations)
    }
  }, [externalCitations])

  useEffect(() => {
    if (!externalCitations && sessionId && authToken) {
      loadCitations().catch(() => undefined)
    }
  }, [externalCitations, sessionId, authToken, loadCitations])

  const usageSummary = useMemo(() => {
    const used = citations.filter(citation => Number(citation.usageCount || 0) > 0).length
    const unused = Math.max(0, citations.length - used)
    return {
      total: citations.length,
      used,
      unused
    }
  }, [citations])

  const filtered = useMemo(() => {
    const lower = query.trim().toLowerCase()
    return citations
      .filter(citation => {
        const count = Number(citation.usageCount || 0)
        if (usageFilter === 'used' && count <= 0) return false
        if (usageFilter === 'unused' && count > 0) return false
        if (!lower) return true
        return (
          citation.title?.toLowerCase().includes(lower) ||
          citation.authors?.join(' ').toLowerCase().includes(lower) ||
          citation.citationKey?.toLowerCase().includes(lower) ||
          String(citation.year || '').includes(lower)
        )
      })
      .sort((a, b) => {
        const usageDiff = Number(b.usageCount || 0) - Number(a.usageCount || 0)
        if (usageDiff !== 0) return usageDiff
        return String(a.title || '').localeCompare(String(b.title || ''))
      })
  }, [citations, query, usageFilter])

  const openEdit = (citation: any) => {
    setEditing(citation)
    setEditValues({
      title: citation.title || '',
      authors: Array.isArray(citation.authors) ? citation.authors.join(', ') : '',
      year: citation.year ? String(citation.year) : '',
      venue: citation.venue || '',
      volume: citation.volume || '',
      issue: citation.issue || '',
      pages: citation.pages || '',
      doi: citation.doi || '',
      url: citation.url || '',
      isbn: citation.isbn || '',
      publisher: citation.publisher || '',
      edition: citation.edition || '',
      editors: Array.isArray(citation.editors) ? citation.editors.join(', ') : '',
      publicationPlace: citation.publicationPlace || '',
      publicationDate: citation.publicationDate || '',
      accessedDate: citation.accessedDate || '',
      articleNumber: citation.articleNumber || '',
      issn: citation.issn || '',
      journalAbbreviation: citation.journalAbbreviation || '',
      pmid: citation.pmid || '',
      pmcid: citation.pmcid || '',
      arxivId: citation.arxivId || '',
      abstract: citation.abstract || '',
      notes: citation.notes || '',
      tags: Array.isArray(citation.tags) ? citation.tags.join(', ') : ''
    })
  }

  // Fetch abstract from external sources (Semantic Scholar, OpenAlex, CrossRef)
  const handleFetchAbstract = async () => {
    if (!editing || !authToken) return
    
    try {
      setFetchingAbstract(true)
      setStatusMessage(null)
      
      const response = await fetch(
        `/api/papers/${sessionId}/citations/${editing.id}/abstract`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      )
      
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch abstract')
      }
      
      if (data.found && data.abstracts?.length > 0) {
        // Use the best abstract (first one, sorted by confidence)
        const bestAbstract = data.abstracts[0]
        setEditValues(prev => ({ ...prev, abstract: bestAbstract.abstract }))
        setStatusMessage(`Abstract found from ${bestAbstract.source}`)
      } else {
        setStatusMessage('No abstract found online. You can add it manually below.')
      }
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed to fetch abstract')
    } finally {
      setFetchingAbstract(false)
      setTimeout(() => setStatusMessage(null), 5000)
    }
  }

  const handleEditSave = async () => {
    if (!editing) return
    try {
      setStatusMessage(null)
      const payload = {
        title: editValues.title,
        authors: editValues.authors.split(',').map(a => a.trim()).filter(Boolean),
        year: editValues.year ? Number(editValues.year) : undefined,
        venue: editValues.venue || undefined,
        volume: editValues.volume || undefined,
        issue: editValues.issue || undefined,
        pages: editValues.pages || undefined,
        doi: editValues.doi || undefined,
        url: editValues.url || undefined,
        isbn: editValues.isbn || undefined,
        publisher: editValues.publisher || undefined,
        edition: editValues.edition || undefined,
        editors: editValues.editors.split(',').map(a => a.trim()).filter(Boolean),
        publicationPlace: editValues.publicationPlace || undefined,
        publicationDate: editValues.publicationDate || undefined,
        accessedDate: editValues.accessedDate || undefined,
        articleNumber: editValues.articleNumber || undefined,
        issn: editValues.issn || undefined,
        journalAbbreviation: editValues.journalAbbreviation || undefined,
        pmid: editValues.pmid || undefined,
        pmcid: editValues.pmcid || undefined,
        arxivId: editValues.arxivId || undefined,
        abstract: editValues.abstract || undefined,
        notes: editValues.notes || undefined,
        tags: editValues.tags.split(',').map(tag => tag.trim()).filter(Boolean)
      }

      const response = await fetch(`/api/papers/${sessionId}/citations/${editing.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify(payload)
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update citation')
      }

      const updated = citations.map(citation => citation.id === editing.id ? data.citation : citation)
      syncCitations(updated)
      setEditing(null)
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed to update citation')
    }
  }

  const handleDelete = async (citation: any) => {
    if (!citation) return
    const confirmed = window.confirm('Delete this citation? This cannot be undone.')
    if (!confirmed) return

    setStatusMessage(null)
    const response = await fetch(`/api/papers/${sessionId}/citations/${citation.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` }
    })
    const data = await response.json()

    if (response.status === 409 && data.warning) {
      const archive = window.confirm(`${data.warning} Archive instead?`)
      if (archive) {
        const archiveRes = await fetch(`/api/papers/${sessionId}/citations/${citation.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({ isActive: false })
        })
        if (archiveRes.ok) {
          syncCitations(citations.filter(item => item.id !== citation.id))
        }
      }
      return
    }

    if (!response.ok) {
      setStatusMessage(data.error || 'Failed to delete citation')
      return
    }

    syncCitations(citations.filter(item => item.id !== citation.id))
  }

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id])
  }

  const exportSelected = async () => {
    if (selectedIds.length === 0) return
    if (!authToken) return
    const params = new URLSearchParams({ ids: selectedIds.join(',') })
    const response = await fetch(`/api/papers/${sessionId}/citations/export?${params.toString()}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    })
    const data = await response.json()
    if (!response.ok) {
      setStatusMessage(data.error || 'Failed to export BibTeX')
      return
    }

    setStatusMessage('BibTeX copied to clipboard.')
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(data.bibtex || '')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search citations"
          className="max-w-sm"
        />
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={usageFilter === 'all' ? 'default' : 'secondary'}
            onClick={() => setUsageFilter('all')}
            className="text-xs"
          >
            All ({usageSummary.total})
          </Button>
          <Button
            size="sm"
            variant={usageFilter === 'used' ? 'default' : 'secondary'}
            onClick={() => setUsageFilter('used')}
            className="text-xs"
          >
            Used ({usageSummary.used})
          </Button>
          <Button
            size="sm"
            variant={usageFilter === 'unused' ? 'default' : 'secondary'}
            onClick={() => setUsageFilter('unused')}
            className="text-xs"
          >
            Unused ({usageSummary.unused})
          </Button>
          {usageFilterAction}
        </div>
        {allowSelection && (
          <Button variant="secondary" onClick={exportSelected} disabled={selectedIds.length === 0}>
            Export selected BibTeX
          </Button>
        )}
      </div>

      {statusMessage && <div className="text-xs text-gray-600">{statusMessage}</div>}

      <div className="grid gap-3">
        {filtered.length === 0 && (
          <div className="text-sm text-gray-500">No citations to display.</div>
        )}
        {filtered.map(citation => {
          const hasAbstract = citation.abstract && citation.abstract.length > 50
          return (
            <Card key={citation.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900">{citation.title}</div>
                    <div className="text-xs text-gray-500">
                      {(citation.authors || []).slice(0, 3).join(', ')}{citation.authors?.length > 3 ? ' et al.' : ''} • {citation.year || 'n.d.'}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{citation.preview?.inText || citation.citationKey}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {allowSelection && (
                      <Checkbox
                        checked={selectedIds.includes(citation.id)}
                        onCheckedChange={() => toggleSelected(citation.id)}
                      />
                    )}
                    {Number(citation.usageCount || 0) > 0 ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {citation.usageCount} uses
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">
                        Unused
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Abstract preview if exists */}
                {hasAbstract && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-indigo-600 hover:text-indigo-700">
                      View abstract
                    </summary>
                    <p className="mt-2 text-gray-600 bg-gray-50 p-2 rounded leading-relaxed">
                      {citation.abstract.length > 300 
                        ? citation.abstract.slice(0, 300) + '...' 
                        : citation.abstract
                      }
                    </p>
                  </details>
                )}

                {Array.isArray(citation.tags) && citation.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {citation.tags.map((tag: string) => (
                      <Badge key={tag} variant="secondary">{tag}</Badge>
                    ))}
                  </div>
                )}

                {Array.isArray(citation.usages) && citation.usages.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {citation.usages.map((usage: any) => (
                      <Badge key={usage.id} variant="outline">
                        {String(usage.sectionKey || 'section').replace(/_/g, ' ')}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {onInsertCitation && (
                    <Button size="sm" variant="secondary" onClick={() => onInsertCitation(citation.citationKey)}>
                      Insert
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => openEdit(citation)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => handleDelete(citation)}>
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Dialog open={!!editing} onOpenChange={() => setEditing(null)}>
        <DialogContent className="max-w-2xl bg-white border-gray-200 shadow-2xl">
          <DialogHeader>
            <DialogTitle>Edit citation</DialogTitle>
            <DialogDescription>Update the bibliographic details below.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 md:grid-cols-2">
            <Input
              value={editValues.title}
              onChange={event => setEditValues(prev => ({ ...prev, title: event.target.value }))}
              placeholder="Title"
            />
            <Input
              value={editValues.authors}
              onChange={event => setEditValues(prev => ({ ...prev, authors: event.target.value }))}
              placeholder="Authors (comma-separated)"
            />
            <Input
              value={editValues.year}
              onChange={event => setEditValues(prev => ({ ...prev, year: event.target.value }))}
              placeholder="Year"
            />
            <Input
              value={editValues.venue}
              onChange={event => setEditValues(prev => ({ ...prev, venue: event.target.value }))}
              placeholder="Venue / Journal"
            />
            <Input
              value={editValues.volume}
              onChange={event => setEditValues(prev => ({ ...prev, volume: event.target.value }))}
              placeholder="Volume"
            />
            <Input
              value={editValues.issue}
              onChange={event => setEditValues(prev => ({ ...prev, issue: event.target.value }))}
              placeholder="Issue"
            />
            <Input
              value={editValues.pages}
              onChange={event => setEditValues(prev => ({ ...prev, pages: event.target.value }))}
              placeholder="Pages"
            />
            <Input
              value={editValues.doi}
              onChange={event => setEditValues(prev => ({ ...prev, doi: event.target.value }))}
              placeholder="DOI"
            />
            <Input
              value={editValues.url}
              onChange={event => setEditValues(prev => ({ ...prev, url: event.target.value }))}
              placeholder="URL"
            />
            <Input
              value={editValues.publisher}
              onChange={event => setEditValues(prev => ({ ...prev, publisher: event.target.value }))}
              placeholder="Publisher"
            />
            <Input
              value={editValues.edition}
              onChange={event => setEditValues(prev => ({ ...prev, edition: event.target.value }))}
              placeholder="Edition"
            />
            <Input
              value={editValues.editors}
              onChange={event => setEditValues(prev => ({ ...prev, editors: event.target.value }))}
              placeholder="Editors (comma-separated)"
            />
            <Input
              value={editValues.isbn}
              onChange={event => setEditValues(prev => ({ ...prev, isbn: event.target.value }))}
              placeholder="ISBN"
            />
            <Input
              value={editValues.publicationPlace}
              onChange={event => setEditValues(prev => ({ ...prev, publicationPlace: event.target.value }))}
              placeholder="Publication place"
            />
            <Input
              value={editValues.publicationDate}
              onChange={event => setEditValues(prev => ({ ...prev, publicationDate: event.target.value }))}
              placeholder="Publication date (YYYY-MM-DD)"
            />
            <Input
              value={editValues.accessedDate}
              onChange={event => setEditValues(prev => ({ ...prev, accessedDate: event.target.value }))}
              placeholder="Accessed date (YYYY-MM-DD)"
            />
            <Input
              value={editValues.articleNumber}
              onChange={event => setEditValues(prev => ({ ...prev, articleNumber: event.target.value }))}
              placeholder="Article number"
            />
            <Input
              value={editValues.issn}
              onChange={event => setEditValues(prev => ({ ...prev, issn: event.target.value }))}
              placeholder="ISSN"
            />
            <Input
              value={editValues.journalAbbreviation}
              onChange={event => setEditValues(prev => ({ ...prev, journalAbbreviation: event.target.value }))}
              placeholder="Journal abbreviation"
            />
            <Input
              value={editValues.pmid}
              onChange={event => setEditValues(prev => ({ ...prev, pmid: event.target.value }))}
              placeholder="PMID"
            />
            <Input
              value={editValues.pmcid}
              onChange={event => setEditValues(prev => ({ ...prev, pmcid: event.target.value }))}
              placeholder="PMCID"
            />
            <Input
              value={editValues.arxivId}
              onChange={event => setEditValues(prev => ({ ...prev, arxivId: event.target.value }))}
              placeholder="arXiv ID"
            />
            <Input
              value={editValues.tags}
              onChange={event => setEditValues(prev => ({ ...prev, tags: event.target.value }))}
              placeholder="Tags (comma-separated)"
            />
          </div>

          {/* Abstract Section */}
          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Abstract</label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleFetchAbstract}
                disabled={fetchingAbstract}
                className="text-xs"
              >
                {fetchingAbstract ? (
                  <>
                    <svg className="w-3 h-3 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Fetching...
                  </>
                ) : (
                  <>🔍 Auto-fetch from web</>
                )}
              </Button>
            </div>
            <Textarea
              value={editValues.abstract}
              onChange={event => setEditValues(prev => ({ ...prev, abstract: event.target.value }))}
              placeholder="Paste or type the abstract here, or click 'Auto-fetch from web' to search academic databases..."
              rows={5}
              className="font-serif text-sm"
            />
            <p className="text-xs text-gray-500">
              {editValues.abstract.length} characters
              {editValues.abstract.length > 0 && editValues.abstract.length < 50 && ' (recommended: 50+ for better AI analysis)'}
            </p>
          </div>

          <Textarea
            value={editValues.notes}
            onChange={event => setEditValues(prev => ({ ...prev, notes: event.target.value }))}
            placeholder="Notes"
            rows={3}
          />

          <div className="flex justify-end gap-2 md:col-span-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={handleEditSave}>
              Save changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
