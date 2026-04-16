'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Search, Globe, BookOpen } from 'lucide-react'

interface CitationPickerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  authToken: string | null
  citations: any[]
  onInsert: (citationKeys: string[]) => void
  onCitationsUpdated?: (citations: any[]) => void
}

interface SearchResult {
  id: string
  title: string
  authors: string[]
  year?: number
  venue?: string
  volume?: string
  issue?: string
  pages?: string
  publisher?: string
  isbn?: string
  edition?: string
  editors?: string[]
  publicationPlace?: string
  publicationDate?: string
  accessedDate?: string
  articleNumber?: string
  issn?: string
  journalAbbreviation?: string
  pmid?: string
  pmcid?: string
  arxivId?: string
  doi?: string
  abstract?: string
  citationCount?: number
  source: string
}

const RECENT_STORAGE_PREFIX = 'paper_recent_citations_'

export default function CitationPickerModal({
  open,
  onOpenChange,
  sessionId,
  authToken,
  citations,
  onInsert,
  onCitationsUpdated
}: CitationPickerModalProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [doiInput, setDoiInput] = useState('')
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [recentKeys, setRecentKeys] = useState<string[]>([])
  
  // Web search state
  const [activeTab, setActiveTab] = useState<'library' | 'search'>('library')
  const [webQuery, setWebQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [addingCitation, setAddingCitation] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setSelected([])
      setImportMessage(null)
      setWebQuery('')
      setSearchResults([])
      setSearchError(null)
    }
  }, [open])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = localStorage.getItem(`${RECENT_STORAGE_PREFIX}${sessionId}`)
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          setRecentKeys(parsed)
        }
      } catch {
        setRecentKeys([])
      }
    }
  }, [sessionId])

  const filtered = useMemo(() => {
    if (!query.trim()) return citations
    const lower = query.toLowerCase()
    return citations.filter(citation => {
      return (
        citation.title?.toLowerCase().includes(lower) ||
        citation.authors?.join(' ').toLowerCase().includes(lower) ||
        citation.citationKey?.toLowerCase().includes(lower) ||
        String(citation.year || '').includes(lower)
      )
    })
  }, [citations, query])

  const recentCitations = useMemo(() => {
    if (recentKeys.length === 0) return []
    const map = new Map(citations.map(citation => [citation.citationKey, citation]))
    return recentKeys.map(key => map.get(key)).filter(Boolean)
  }, [citations, recentKeys])

  const toggleSelection = (key: string) => {
    setSelected(prev => prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key])
  }

  const handleInsert = () => {
    if (selected.length === 0) return
    onInsert(selected)
    const merged = Array.from(new Set([...selected, ...recentKeys])).slice(0, 8)
    setRecentKeys(merged)
    if (typeof window !== 'undefined') {
      localStorage.setItem(`${RECENT_STORAGE_PREFIX}${sessionId}`, JSON.stringify(merged))
    }
    onOpenChange(false)
  }

  const handleImportDoi = async () => {
    if (!doiInput.trim()) return
    try {
      setImportMessage(null)
      const response = await fetch(`/api/papers/${sessionId}/citations/import-doi`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ doi: doiInput.trim() })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'DOI import failed')
      }

      setImportMessage('DOI imported.')
      setDoiInput('')
      if (onCitationsUpdated) {
        const updated = [...citations, data.citation]
        onCitationsUpdated(updated)
      }
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'DOI import failed')
    }
  }

  // Search academic databases
  const handleWebSearch = async () => {
    if (!webQuery.trim() || webQuery.trim().length < 3) {
      setSearchError('Please enter at least 3 characters to search')
      return
    }
    
    setSearching(true)
    setSearchError(null)
    setSearchResults([])
    
    try {
      const response = await fetch(`/api/papers/${sessionId}/literature/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ 
          query: webQuery.trim(),
          limit: 20
        })
      })
      
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Search failed')
      }
      
      setSearchResults(data.results || [])
      if ((data.results || []).length === 0) {
        setSearchError('No results found. Try different keywords.')
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  // Add a search result to the citation library
  const handleAddFromSearch = async (result: SearchResult) => {
    setAddingCitation(result.id)
    try {
      const response = await fetch(`/api/papers/${sessionId}/citations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          searchResult: {
            title: result.title,
            authors: result.authors,
            year: result.year,
            venue: result.venue,
            volume: result.volume,
            issue: result.issue,
            pages: result.pages,
            publisher: result.publisher,
            isbn: result.isbn,
            edition: result.edition,
            editors: result.editors,
            publicationPlace: result.publicationPlace,
            publicationDate: result.publicationDate,
            accessedDate: result.accessedDate,
            articleNumber: result.articleNumber,
            issn: result.issn,
            journalAbbreviation: result.journalAbbreviation,
            pmid: result.pmid,
            pmcid: result.pmcid,
            arxivId: result.arxivId,
            doi: result.doi,
            abstract: result.abstract,
            source: result.source
          }
        })
      })
      
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to add citation')
      }
      
      // Update citations list
      if (onCitationsUpdated) {
        onCitationsUpdated([...citations, data.citation])
      }
      
      // Auto-select the newly added citation
      if (data.citation?.citationKey) {
        setSelected(prev => [...prev, data.citation.citationKey])
      }
      
      // Remove from search results (it's now in the library)
      setSearchResults(prev => prev.filter(r => r.id !== result.id))
      
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Failed to add citation')
    } finally {
      setAddingCitation(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-white border-gray-200 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Insert citations</DialogTitle>
          <DialogDescription>Select from your library or search academic databases.</DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('library')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'library' 
                ? 'border-indigo-500 text-indigo-600' 
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            My Library ({citations.length})
          </button>
          <button
            onClick={() => setActiveTab('search')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'search' 
                ? 'border-indigo-500 text-indigo-600' 
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Globe className="w-4 h-4" />
            Search Web
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === 'library' ? (
            <div className="grid gap-4 p-1">
              {/* Quick DOI Import */}
              <div className="grid gap-2">
                <div className="text-xs font-semibold text-gray-600">Quick add DOI</div>
                <div className="flex gap-2">
                  <Input
                    value={doiInput}
                    onChange={event => setDoiInput(event.target.value)}
                    placeholder="10.xxxx/xxxxx"
                  />
                  <Button variant="secondary" onClick={handleImportDoi} disabled={!doiInput.trim()}>
                    Import
                  </Button>
                </div>
                {importMessage && <div className="text-xs text-gray-600">{importMessage}</div>}
              </div>

              {/* Library Search */}
              <Input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search by title, author, year, or key"
              />

              {/* Recently Used */}
              {recentCitations.length > 0 && (
                <div className="grid gap-2">
                  <div className="text-xs font-semibold text-gray-600">Recently used</div>
                  <div className="grid gap-2">
                    {recentCitations.map(citation => (
                      <label key={citation.id} className="flex items-start gap-2 rounded border border-gray-200 p-2 text-sm hover:bg-gray-50 cursor-pointer">
                        <Checkbox
                          checked={selected.includes(citation.citationKey)}
                          onCheckedChange={() => toggleSelection(citation.citationKey)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 truncate">{citation.title}</div>
                          <div className="text-xs text-gray-500">{citation.preview?.inText || citation.citationKey}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Citation List */}
              <div className="grid gap-2 max-h-[280px] overflow-y-auto border border-gray-200 rounded-md p-2">
                {filtered.length === 0 && (
                  <div className="text-sm text-gray-500 p-4 text-center">
                    {citations.length === 0 
                      ? 'No citations in your library. Search the web to add papers.' 
                      : 'No citations match your search.'}
                  </div>
                )}
                {filtered.map(citation => (
                  <label key={citation.id} className="flex items-start gap-2 rounded border border-gray-100 p-2 text-sm hover:bg-gray-50 cursor-pointer">
                    <Checkbox
                      checked={selected.includes(citation.citationKey)}
                      onCheckedChange={() => toggleSelection(citation.citationKey)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900">{citation.title}</div>
                      <div className="text-xs text-gray-500">
                        {(citation.authors || []).slice(0, 2).join(', ')}{citation.authors?.length > 2 ? ' et al.' : ''} • {citation.year || 'n.d.'}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 p-1">
              {/* Web Search */}
              <div className="grid gap-2">
                <div className="text-xs font-semibold text-gray-600">Search Semantic Scholar, CrossRef & OpenAlex</div>
                <div className="flex gap-2">
                  <Input
                    value={webQuery}
                    onChange={event => setWebQuery(event.target.value)}
                    placeholder="Search by title, author, keywords..."
                    onKeyDown={e => e.key === 'Enter' && handleWebSearch()}
                  />
                  <Button onClick={handleWebSearch} disabled={searching || webQuery.trim().length < 3}>
                    {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </Button>
                </div>
                {searchError && <div className="text-xs text-amber-600">{searchError}</div>}
              </div>

              {/* Search Results */}
              <div className="grid gap-2 max-h-[320px] overflow-y-auto border border-gray-200 rounded-md p-2">
                {searching && (
                  <div className="flex items-center justify-center gap-2 p-8 text-gray-500">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Searching academic databases...</span>
                  </div>
                )}
                {!searching && searchResults.length === 0 && (
                  <div className="text-sm text-gray-500 p-4 text-center">
                    Enter keywords to search academic databases for papers to cite.
                  </div>
                )}
                {searchResults.map(result => {
                  const alreadyInLibrary = citations.some(c => 
                    c.doi === result.doi || 
                    c.title?.toLowerCase() === result.title?.toLowerCase()
                  )
                  return (
                    <div key={result.id} className="rounded border border-gray-100 p-3 text-sm hover:bg-gray-50">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900">{result.title}</div>
                          <div className="text-xs text-gray-500 mt-1">
                            {result.authors?.slice(0, 3).join(', ')}{result.authors?.length > 3 ? ' et al.' : ''} • {result.year || 'n.d.'}
                            {result.venue && <span className="text-gray-400"> • {result.venue}</span>}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{result.source}</span>
                            {result.citationCount !== undefined && result.citationCount > 0 && (
                              <span className="text-[10px] text-gray-400">{result.citationCount} citations</span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0">
                          {alreadyInLibrary ? (
                            <span className="text-xs text-green-600 font-medium">✓ In library</span>
                          ) : (
                            <Button 
                              size="sm" 
                              variant="secondary"
                              onClick={() => handleAddFromSearch(result)}
                              disabled={addingCitation === result.id}
                            >
                              {addingCitation === result.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                'Add & Select'
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Preview & Actions */}
        <div className="border-t pt-4 space-y-4">
          <div className="grid gap-2">
            <div className="text-xs font-semibold text-gray-600">Selected ({selected.length})</div>
            <Textarea
              value={
                selected.length === 0
                  ? 'Select citations to preview.'
                  : selected.map(key => citations.find(c => c.citationKey === key)?.preview?.inText || `[CITE:${key}]`).join(' ')
              }
              readOnly
              rows={2}
              className="text-sm"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleInsert} disabled={selected.length === 0}>
              Insert {selected.length > 0 ? `(${selected.length})` : ''}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
