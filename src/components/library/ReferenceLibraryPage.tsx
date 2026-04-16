'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface ReferenceLibraryPageProps {
  authToken: string | null;
  sessionId?: string; // If provided, enables "Add to Paper" functionality
  onCitationsImported?: (citations: any[]) => void;
}

interface Reference {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  abstract?: string;
  doi?: string;
  url?: string;
  sourceType: string;
  tags: string[];
  isFavorite: boolean;
  isRead: boolean;
  collections?: Array<{ collection: { id: string; name: string; color?: string } }>;
}

interface Collection {
  id: string;
  name: string;
  description?: string;
  color?: string;
  referenceCount: number;
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  JOURNAL_ARTICLE: 'Journal Article',
  CONFERENCE_PAPER: 'Conference Paper',
  BOOK: 'Book',
  BOOK_CHAPTER: 'Book Chapter',
  THESIS: 'Thesis',
  REPORT: 'Report',
  WEBSITE: 'Website',
  PATENT: 'Patent',
  WORKING_PAPER: 'Working Paper',
  OTHER: 'Other',
};

const SOURCE_TYPE_COLORS: Record<string, string> = {
  JOURNAL_ARTICLE: 'bg-emerald-100 text-emerald-800',
  CONFERENCE_PAPER: 'bg-blue-100 text-blue-800',
  BOOK: 'bg-amber-100 text-amber-800',
  BOOK_CHAPTER: 'bg-orange-100 text-orange-800',
  THESIS: 'bg-purple-100 text-purple-800',
  REPORT: 'bg-slate-100 text-slate-800',
  WEBSITE: 'bg-cyan-100 text-cyan-800',
  PATENT: 'bg-rose-100 text-rose-800',
  WORKING_PAPER: 'bg-gray-100 text-gray-800',
  OTHER: 'bg-gray-100 text-gray-600',
};

const PAGE_SIZE = 25;

export default function ReferenceLibraryPage({
  authToken,
  sessionId,
  onCitationsImported,
}: ReferenceLibraryPageProps) {
  const [references, setReferences] = useState<Reference[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [totalReferences, setTotalReferences] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [selectedSourceType, setSelectedSourceType] = useState<string | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modals
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [addReferenceModalOpen, setAddReferenceModalOpen] = useState(false);
  const [createCollectionModalOpen, setCreateCollectionModalOpen] = useState(false);
  const [editingReference, setEditingReference] = useState<Reference | null>(null);

  // Import state
  const [importContent, setImportContent] = useState('');
  const [doiInput, setDoiInput] = useState('');
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // New collection state
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionColor, setNewCollectionColor] = useState('#6366f1');

  // Expanded abstracts
  const [expandedAbstracts, setExpandedAbstracts] = useState<Set<string>>(new Set());

  const toggleAbstract = useCallback((id: string) => {
    setExpandedAbstracts(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Load references with pagination
  const loadReferences = useCallback(async (page: number = currentPage, showLoader: boolean = true) => {
    if (!authToken) return;
    try {
      if (showLoader) setLoading(true);
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (selectedCollection) params.set('collectionId', selectedCollection);
      if (selectedSourceType) params.set('sourceType', selectedSourceType);
      if (showFavoritesOnly) params.set('isFavorite', 'true');
      if (showUnreadOnly) params.set('isRead', 'false');
      if (yearFrom) params.set('yearFrom', yearFrom);
      if (yearTo) params.set('yearTo', yearTo);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String((page - 1) * PAGE_SIZE));

      const response = await fetch(`/api/library?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (!response.ok) throw new Error('Failed to load references');
      const data = await response.json();
      setReferences(data.references || []);
      setTotalReferences(data.total || 0);
      setTotalPages(Math.ceil((data.total || 0) / PAGE_SIZE));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load references');
    } finally {
      setLoading(false);
    }
  }, [authToken, searchQuery, selectedCollection, selectedSourceType, showFavoritesOnly, showUnreadOnly, yearFrom, yearTo, currentPage]);

  // Load collections
  const loadCollections = useCallback(async () => {
    if (!authToken) return;
    try {
      const response = await fetch('/api/library/collections', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) throw new Error('Failed to load collections');
      const data = await response.json();
      setCollections(data.collections || []);
    } catch (err) {
      console.error('Failed to load collections:', err);
    }
  }, [authToken]);

  useEffect(() => {
    loadReferences(currentPage);
    loadCollections();
  }, [loadReferences, loadCollections, currentPage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set()); // Clear selection on filter change
  }, [searchQuery, selectedCollection, selectedSourceType, showFavoritesOnly, showUnreadOnly, yearFrom, yearTo]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    setSelectedIds(new Set()); // Clear selection on page change
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Toggle selection
  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selectedIds.size === references.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(references.map(r => r.id)));
    }
  }, [references, selectedIds.size]);

  // Toggle favorite with optimistic update
  const toggleFavorite = useCallback(async (id: string) => {
    if (!authToken) return;
    
    // Optimistic update
    setReferences(prev => prev.map(r => 
      r.id === id ? { ...r, isFavorite: !r.isFavorite } : r
    ));
    
    try {
      const response = await fetch(`/api/library/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'toggleFavorite' }),
      });
      if (!response.ok) throw new Error('Toggle failed');
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
      // Revert on error
      setReferences(prev => prev.map(r => 
        r.id === id ? { ...r, isFavorite: !r.isFavorite } : r
      ));
    }
  }, [authToken]);

  // Toggle read with optimistic update
  const toggleRead = useCallback(async (id: string) => {
    if (!authToken) return;
    
    // Optimistic update
    setReferences(prev => prev.map(r => 
      r.id === id ? { ...r, isRead: !r.isRead } : r
    ));
    
    try {
      const response = await fetch(`/api/library/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'toggleRead' }),
      });
      if (!response.ok) throw new Error('Toggle failed');
    } catch (err) {
      console.error('Failed to toggle read:', err);
      // Revert on error
      setReferences(prev => prev.map(r => 
        r.id === id ? { ...r, isRead: !r.isRead } : r
      ));
    }
  }, [authToken]);

  // Import from content (BibTeX, RIS, etc.)
  const handleImport = useCallback(async () => {
    if (!authToken || !importContent.trim()) return;
    try {
      setImportMessage(null);
      const response = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ content: importContent }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Import failed');

      setImportMessage({
        type: 'success',
        message: `Imported ${data.imported} references${data.skipped ? `, ${data.skipped} skipped` : ''}`,
      });
      setImportContent('');
      loadReferences();
    } catch (err) {
      setImportMessage({ type: 'error', message: err instanceof Error ? err.message : 'Import failed' });
    }
  }, [authToken, importContent, loadReferences]);

  // Import from DOI
  const handleDoiImport = useCallback(async () => {
    if (!authToken || !doiInput.trim()) return;
    try {
      setImportMessage(null);
      const response = await fetch('/api/library/import-doi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ doi: doiInput.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'DOI import failed');

      setImportMessage({ type: 'success', message: 'Reference imported from DOI' });
      setDoiInput('');
      loadReferences();
    } catch (err) {
      setImportMessage({ type: 'error', message: err instanceof Error ? err.message : 'DOI import failed' });
    }
  }, [authToken, doiInput, loadReferences]);

  // Create collection
  const handleCreateCollection = useCallback(async () => {
    if (!authToken || !newCollectionName.trim()) return;
    try {
      const response = await fetch('/api/library/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ name: newCollectionName.trim(), color: newCollectionColor }),
      });
      if (!response.ok) throw new Error('Failed to create collection');

      setNewCollectionName('');
      setCreateCollectionModalOpen(false);
      loadCollections();
    } catch (err) {
      console.error('Failed to create collection:', err);
    }
  }, [authToken, newCollectionName, newCollectionColor, loadCollections]);

  // Add selected to collection
  const handleAddToCollection = useCallback(async (collectionId: string) => {
    if (!authToken || selectedIds.size === 0) return;
    try {
      const response = await fetch(`/api/library/collections/${collectionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'addReferences', referenceIds: Array.from(selectedIds) }),
      });
      if (!response.ok) throw new Error('Failed to add to collection');
      setSelectedIds(new Set());
      loadReferences();
    } catch (err) {
      console.error('Failed to add to collection:', err);
    }
  }, [authToken, selectedIds, loadReferences]);

  // Copy to session (paper)
  const handleCopyToSession = useCallback(async () => {
    if (!authToken || !sessionId || selectedIds.size === 0) return;
    try {
      const response = await fetch('/api/library/copy-to-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ sessionId, referenceIds: Array.from(selectedIds) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to copy references');

      setSelectedIds(new Set());
      onCitationsImported?.(data.citations);
      alert(`Added ${data.imported} citations to your paper${data.skipped ? `, ${data.skipped} skipped (duplicates)` : ''}`);
    } catch (err) {
      console.error('Failed to copy to session:', err);
    }
  }, [authToken, sessionId, selectedIds, onCitationsImported]);

  // Export selected
  const handleExport = useCallback(async () => {
    if (!authToken) return;
    try {
      const idsParam = selectedIds.size > 0 ? `?ids=${Array.from(selectedIds).join(',')}` : '';
      const response = await fetch(`/api/library/export${idsParam}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const bibtex = await response.text();

      // Copy to clipboard
      await navigator.clipboard.writeText(bibtex);
      alert('BibTeX copied to clipboard!');
    } catch (err) {
      console.error('Failed to export:', err);
    }
  }, [authToken, selectedIds]);

  // Delete reference with optimistic update
  const handleDelete = useCallback(async (id: string) => {
    if (!authToken) return;
    if (!confirm('Delete this reference?')) return;
    
    // Optimistic update
    const previousRefs = references;
    const previousTotal = totalReferences;
    const newTotal = totalReferences - 1;
    const newRefs = references.filter(r => r.id !== id);
    
    setReferences(newRefs);
    setTotalReferences(newTotal);
    
    // Check if page becomes empty after deletion
    const needsPageAdjustment = newRefs.length === 0 && newTotal > 0;
    
    try {
      const response = await fetch(`/api/library/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) throw new Error('Delete failed');
      
      // Handle pagination after successful delete
      if (needsPageAdjustment) {
        const newTotalPages = Math.ceil(newTotal / PAGE_SIZE);
        const targetPage = Math.min(currentPage, newTotalPages);
        if (targetPage !== currentPage) {
          setCurrentPage(targetPage);
        } else {
          loadReferences(currentPage);
        }
      }
      
      // Update collections in background
      loadCollections();
    } catch (err) {
      console.error('Failed to delete:', err);
      // Revert on error
      setReferences(previousRefs);
      setTotalReferences(previousTotal);
    }
  }, [authToken, references, totalReferences, currentPage, loadReferences, loadCollections]);

  // Bulk delete selected references with optimistic update
  const handleBulkDelete = useCallback(async () => {
    if (!authToken || selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected reference(s)? This action cannot be undone.`)) return;
    
    // Optimistic update
    const idsToDelete = new Set(selectedIds);
    const previousRefs = references;
    const previousTotal = totalReferences;
    const newTotal = totalReferences - idsToDelete.size;
    const newRefs = references.filter(r => !idsToDelete.has(r.id));
    
    setReferences(newRefs);
    setTotalReferences(newTotal);
    setSelectedIds(new Set());
    
    // Check if page becomes empty after bulk deletion
    const needsPageAdjustment = newRefs.length === 0 && newTotal > 0;
    
    try {
      const response = await fetch('/api/library/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ referenceIds: Array.from(idsToDelete) }),
      });
      if (!response.ok) throw new Error('Bulk delete failed');
      
      // Handle pagination after successful bulk delete
      if (needsPageAdjustment) {
        const newTotalPages = Math.ceil(newTotal / PAGE_SIZE);
        const targetPage = Math.min(currentPage, newTotalPages);
        if (targetPage !== currentPage) {
          setCurrentPage(targetPage);
        } else {
          loadReferences(currentPage);
        }
      }
      
      // Update collections in background
      loadCollections();
    } catch (err) {
      console.error('Failed to bulk delete:', err);
      // Revert on error
      setReferences(previousRefs);
      setTotalReferences(previousTotal);
    }
  }, [authToken, selectedIds, references, totalReferences, currentPage, loadReferences, loadCollections]);

  // Remove from current collection with optimistic update
  const handleRemoveFromCollection = useCallback(async () => {
    if (!authToken || !selectedCollection || selectedIds.size === 0) return;
    
    // Optimistic update
    const idsToRemove = new Set(selectedIds);
    const previousRefs = references;
    const previousTotal = totalReferences;
    const newTotal = totalReferences - idsToRemove.size;
    const newRefs = references.filter(r => !idsToRemove.has(r.id));
    
    setReferences(newRefs);
    setTotalReferences(newTotal);
    setSelectedIds(new Set());
    
    // Check if page becomes empty after removal
    const needsPageAdjustment = newRefs.length === 0 && newTotal > 0;
    
    try {
      const response = await fetch(`/api/library/collections/${selectedCollection}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'removeReferences', referenceIds: Array.from(idsToRemove) }),
      });
      if (response.ok) {
        // Handle pagination after successful removal
        if (needsPageAdjustment) {
          const newTotalPages = Math.ceil(newTotal / PAGE_SIZE);
          const targetPage = Math.min(currentPage, newTotalPages);
          if (targetPage !== currentPage) {
            setCurrentPage(targetPage);
          } else {
            loadReferences(currentPage);
          }
        }
        loadCollections();
      } else {
        throw new Error('Remove failed');
      }
    } catch (err) {
      console.error('Failed to remove from collection:', err);
      // Revert on error
      setReferences(previousRefs);
      setTotalReferences(previousTotal);
    }
  }, [authToken, selectedCollection, selectedIds, references, totalReferences, currentPage, loadReferences, loadCollections]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Reference Library
            </h1>
            <p className="text-gray-500 mt-1">
              {totalReferences} references • Organize, import, and manage your citations
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setImportModalOpen(true)} className="bg-indigo-600 hover:bg-indigo-700">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Import
            </Button>
            <Button variant="outline" onClick={() => setAddReferenceModalOpen(true)}>
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Manually
            </Button>
          </div>
        </div>

        <div className="grid lg:grid-cols-[280px,1fr] gap-6">
          {/* Sidebar */}
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search references..."
                className="pl-10"
              />
            </div>

            {/* Collections */}
            <Card>
              <CardHeader className="py-3 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Collections</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCreateCollectionModalOpen(true)}
                    className="h-7 w-7 p-0"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="py-2 px-2">
                <button
                  onClick={() => setSelectedCollection(null)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    !selectedCollection ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-gray-100'
                  }`}
                >
                  <span className="flex items-center justify-between">
                    <span>All References</span>
                    <Badge variant="secondary" className="text-xs">{totalReferences}</Badge>
                  </span>
                </button>
                {collections.map(collection => (
                  <button
                    key={collection.id}
                    onClick={() => setSelectedCollection(collection.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedCollection === collection.id ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-gray-100'
                    }`}
                  >
                    <span className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: collection.color || '#6366f1' }}
                        />
                        {collection.name}
                      </span>
                      <Badge variant="secondary" className="text-xs">{collection.referenceCount}</Badge>
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* Filters */}
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-semibold">Filters</CardTitle>
              </CardHeader>
              <CardContent className="py-2 px-4 space-y-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={showFavoritesOnly}
                    onCheckedChange={checked => setShowFavoritesOnly(!!checked)}
                  />
                  <span>Favorites only</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={showUnreadOnly}
                    onCheckedChange={checked => setShowUnreadOnly(!!checked)}
                  />
                  <span>Unread only</span>
                </label>
                <div className="pt-2 border-t">
                  <label className="text-xs text-gray-500 block mb-2">Source Type</label>
                  <select
                    value={selectedSourceType || ''}
                    onChange={e => setSelectedSourceType(e.target.value || null)}
                    className="w-full text-sm border rounded-lg px-3 py-2"
                  >
                    <option value="">All types</option>
                    {Object.entries(SOURCE_TYPE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div className="pt-2 border-t">
                  <label className="text-xs text-gray-500 block mb-2">Year Range</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={yearFrom}
                      onChange={e => setYearFrom(e.target.value)}
                      placeholder="From"
                      className="text-sm h-9"
                      min="1900"
                      max="2100"
                    />
                    <span className="text-gray-400 text-sm">–</span>
                    <Input
                      type="number"
                      value={yearTo}
                      onChange={e => setYearTo(e.target.value)}
                      placeholder="To"
                      className="text-sm h-9"
                      min="1900"
                      max="2100"
                    />
                  </div>
                </div>
                {/* Clear filters button */}
                {(showFavoritesOnly || showUnreadOnly || selectedSourceType || yearFrom || yearTo) && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full mt-2 text-gray-500"
                    onClick={() => {
                      setShowFavoritesOnly(false);
                      setShowUnreadOnly(false);
                      setSelectedSourceType(null);
                      setYearFrom('');
                      setYearTo('');
                    }}
                  >
                    Clear all filters
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <div className="space-y-4">
            {/* Action Bar */}
            {selectedIds.size > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="sticky top-4 z-10 bg-gradient-to-r from-indigo-50/95 to-purple-50/95 backdrop-blur-lg border border-indigo-200 rounded-xl p-4 shadow-lg"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-indigo-700">{selectedIds.size} selected</span>
                    <button 
                      onClick={() => setSelectedIds(new Set())}
                      className="text-xs text-gray-500 hover:text-gray-700 underline"
                    >
                      Clear
                    </button>
                  </div>
                  
                  <div className="h-5 w-px bg-gray-300" />
                  
                  {sessionId && (
                    <Button size="sm" onClick={handleCopyToSession} className="bg-emerald-600 hover:bg-emerald-700 gap-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add to Paper
                    </Button>
                  )}
                  
                  <Button size="sm" variant="outline" onClick={handleExport} className="gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Export BibTeX
                  </Button>
                  
                  {collections.length > 0 && (
                    <div className="relative group">
                      <Button size="sm" variant="outline" className="gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        Add to Collection
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </Button>
                      <div className="absolute top-full left-0 mt-1 bg-white border rounded-lg shadow-xl py-1 min-w-[200px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20">
                        {collections.map(c => (
                          <button
                            key={c.id}
                            onClick={() => handleAddToCollection(c.id)}
                            className="w-full text-left px-3 py-2 hover:bg-indigo-50 flex items-center gap-2 text-sm"
                          >
                            <div 
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{ backgroundColor: c.color || '#6366f1' }}
                            />
                            <span className="truncate">{c.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {selectedCollection && (
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={handleRemoveFromCollection}
                      className="gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 12H6" />
                      </svg>
                      Remove from Collection
                    </Button>
                  )}
                  
                  <div className="h-5 w-px bg-gray-300" />
                  
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={handleBulkDelete}
                    className="gap-1 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete
                  </Button>
                </div>
              </motion.div>
            )}

            {/* References List */}
            <div className="space-y-3">
              {loading ? (
                <div className="text-center py-12">
                  <div className="animate-spin w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto" />
                  <p className="text-gray-500 mt-4">Loading references...</p>
                </div>
              ) : references.length === 0 ? (
                <Card className="text-center py-12">
                  <CardContent>
                    <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    <h3 className="text-lg font-semibold text-gray-700">No references yet</h3>
                    <p className="text-gray-500 mt-2">Import from BibTeX, Mendeley, Zotero, or add manually</p>
                    <Button onClick={() => setImportModalOpen(true)} className="mt-4">
                      Import References
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Select All */}
                  <div className="flex items-center gap-3 px-1">
                    <Checkbox
                      checked={selectedIds.size === references.length && references.length > 0}
                      onCheckedChange={selectAll}
                    />
                    <span className="text-sm text-gray-500">Select all</span>
                  </div>

                  <AnimatePresence mode="popLayout">
                    {references.map((ref, index) => (
                      <motion.div
                        key={ref.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ delay: index * 0.02 }}
                      >
                        <ReferenceCard
                          reference={ref}
                          isSelected={selectedIds.has(ref.id)}
                          isExpanded={expandedAbstracts.has(ref.id)}
                          onToggleSelect={() => toggleSelection(ref.id)}
                          onToggleFavorite={() => toggleFavorite(ref.id)}
                          onToggleRead={() => toggleRead(ref.id)}
                          onToggleAbstract={() => toggleAbstract(ref.id)}
                          onEdit={() => setEditingReference(ref)}
                          onDelete={() => handleDelete(ref.id)}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between mt-6 pt-4 border-t">
                      <div className="text-sm text-gray-500">
                        Showing {((currentPage - 1) * PAGE_SIZE) + 1} - {Math.min(currentPage * PAGE_SIZE, totalReferences)} of {totalReferences} references
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handlePageChange(1)}
                          disabled={currentPage === 1}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                          </svg>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handlePageChange(currentPage - 1)}
                          disabled={currentPage === 1}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                        </Button>
                        
                        <div className="flex items-center gap-1">
                          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                            let pageNum;
                            if (totalPages <= 5) {
                              pageNum = i + 1;
                            } else if (currentPage <= 3) {
                              pageNum = i + 1;
                            } else if (currentPage >= totalPages - 2) {
                              pageNum = totalPages - 4 + i;
                            } else {
                              pageNum = currentPage - 2 + i;
                            }
                            return (
                              <Button
                                key={pageNum}
                                variant={currentPage === pageNum ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => handlePageChange(pageNum)}
                                className="w-8 h-8 p-0"
                              >
                                {pageNum}
                              </Button>
                            );
                          })}
                        </div>
                        
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handlePageChange(currentPage + 1)}
                          disabled={currentPage === totalPages}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handlePageChange(totalPages)}
                          disabled={currentPage === totalPages}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                          </svg>
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Import Modal */}
        <Dialog open={importModalOpen} onOpenChange={setImportModalOpen}>
          <DialogContent className="max-w-2xl bg-white border-gray-200 shadow-2xl">
            <DialogHeader>
              <DialogTitle>Import References</DialogTitle>
              <DialogDescription>
                Import from BibTeX, RIS (EndNote/Mendeley), or Zotero CSL-JSON
              </DialogDescription>
            </DialogHeader>

            <Tabs defaultValue="paste" className="mt-4">
              <TabsList>
                <TabsTrigger value="paste">Paste Content</TabsTrigger>
                <TabsTrigger value="doi">Import by DOI</TabsTrigger>
                <TabsTrigger value="file">Upload File</TabsTrigger>
              </TabsList>

              <TabsContent value="paste" className="space-y-4">
                <Textarea
                  value={importContent}
                  onChange={e => setImportContent(e.target.value)}
                  placeholder="Paste BibTeX, RIS, or JSON content here..."
                  rows={10}
                  className="font-mono text-sm"
                />
                <Button onClick={handleImport} disabled={!importContent.trim()} className="w-full">
                  Import
                </Button>
              </TabsContent>

              <TabsContent value="doi" className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    value={doiInput}
                    onChange={e => setDoiInput(e.target.value)}
                    placeholder="e.g., 10.1000/xyz123"
                  />
                  <Button onClick={handleDoiImport} disabled={!doiInput.trim()}>
                    Import
                  </Button>
                </div>
                <p className="text-xs text-gray-500">
                  Enter a DOI to automatically fetch metadata from CrossRef
                </p>
              </TabsContent>

              <TabsContent value="file" className="space-y-4">
                <label className="block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:border-indigo-400 transition-colors">
                  <input
                    type="file"
                    accept=".bib,.bibtex,.ris,.json,.txt"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = () => {
                          setImportContent(reader.result as string);
                        };
                        reader.readAsText(file);
                      }
                    }}
                  />
                  <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-gray-600">Click to upload or drag and drop</p>
                  <p className="text-xs text-gray-400 mt-1">.bib, .ris, .json files supported</p>
                </label>
                {importContent && (
                  <Button onClick={handleImport} className="w-full">
                    Import {importContent.length} characters
                  </Button>
                )}
              </TabsContent>
            </Tabs>

            {importMessage && (
              <div className={`p-3 rounded-lg text-sm ${
                importMessage.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
              }`}>
                {importMessage.message}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Create Collection Modal */}
        <Dialog open={createCollectionModalOpen} onOpenChange={setCreateCollectionModalOpen}>
          <DialogContent className="bg-white border-gray-200 shadow-2xl">
            <DialogHeader>
              <DialogTitle>Create Collection</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <Input
                value={newCollectionName}
                onChange={e => setNewCollectionName(e.target.value)}
                placeholder="Collection name"
              />
              <div>
                <label className="text-sm text-gray-500 block mb-2">Color</label>
                <div className="flex gap-2">
                  {['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'].map(color => (
                    <button
                      key={color}
                      onClick={() => setNewCollectionColor(color)}
                      className={`w-8 h-8 rounded-full transition-transform ${
                        newCollectionColor === color ? 'scale-110 ring-2 ring-offset-2 ring-gray-400' : ''
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <Button onClick={handleCreateCollection} disabled={!newCollectionName.trim()} className="w-full">
                Create Collection
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Add Reference Modal - Manual Entry */}
        <ManualReferenceModal
          open={addReferenceModalOpen}
          onOpenChange={setAddReferenceModalOpen}
          authToken={authToken}
          onSuccess={loadReferences}
        />
      </div>
    </div>
  );
}

// Reference Card Component
function ReferenceCard({
  reference,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleFavorite,
  onToggleRead,
  onToggleAbstract,
  onEdit,
  onDelete,
}: {
  reference: Reference;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onToggleFavorite: () => void;
  onToggleRead: () => void;
  onToggleAbstract: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hasAbstract = !!reference.abstract;
  const abstractPreview = reference.abstract?.slice(0, 200);
  const needsExpansion = reference.abstract && reference.abstract.length > 200;

  return (
    <Card className={`transition-all ${isSelected ? 'ring-2 ring-indigo-500 bg-indigo-50/50' : ''}`}>
      <CardContent className="p-4">
        <div className="flex gap-4">
          {/* Checkbox */}
          <div className="pt-1">
            <Checkbox checked={isSelected} onCheckedChange={onToggleSelect} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                {/* Title */}
                <h3 className="font-semibold text-gray-900 leading-tight">{reference.title}</h3>

                {/* Authors & Year */}
                <p className="text-sm text-gray-600 mt-1">
                  {reference.authors.slice(0, 3).join(', ')}
                  {reference.authors.length > 3 && ' et al.'}
                  {reference.year && ` (${reference.year})`}
                </p>

                {/* Venue */}
                {reference.venue && (
                  <p className="text-sm text-gray-500 italic">{reference.venue}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={onToggleFavorite}
                  className={`p-2 rounded-lg transition-colors ${
                    reference.isFavorite ? 'text-amber-500' : 'text-gray-300 hover:text-amber-500'
                  }`}
                >
                  <svg className="w-5 h-5" fill={reference.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                </button>
                <button
                  onClick={onToggleRead}
                  className={`p-2 rounded-lg transition-colors ${
                    reference.isRead ? 'text-emerald-500' : 'text-gray-300 hover:text-emerald-500'
                  }`}
                  title={reference.isRead ? 'Mark as unread' : 'Mark as read'}
                >
                  <svg className="w-5 h-5" fill={reference.isRead ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Abstract */}
            {hasAbstract && (
              <div className="mt-3">
                <p className="text-sm text-gray-600">
                  {isExpanded ? reference.abstract : abstractPreview}
                  {!isExpanded && needsExpansion && '...'}
                </p>
                {needsExpansion && (
                  <button
                    onClick={onToggleAbstract}
                    className="text-sm text-indigo-600 hover:text-indigo-700 mt-1 font-medium"
                  >
                    {isExpanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            )}

            {/* Tags & Metadata */}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Badge className={SOURCE_TYPE_COLORS[reference.sourceType] || SOURCE_TYPE_COLORS.OTHER}>
                {SOURCE_TYPE_LABELS[reference.sourceType] || 'Other'}
              </Badge>
              {reference.doi && (
                <a
                  href={`https://doi.org/${reference.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 hover:underline"
                >
                  DOI: {reference.doi}
                </a>
              )}
              {reference.tags.map(tag => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>

            {/* Collection badges */}
            {reference.collections && reference.collections.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {reference.collections.map(({ collection }) => (
                  <Badge
                    key={collection.id}
                    variant="secondary"
                    className="text-xs"
                    style={{ borderLeftColor: collection.color || '#6366f1', borderLeftWidth: 3 }}
                  >
                    {collection.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Manual Reference Entry Modal
function ManualReferenceModal({
  open,
  onOpenChange,
  authToken,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authToken: string | null;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    title: '',
    authors: '',
    year: '',
    venue: '',
    doi: '',
    url: '',
    abstract: '',
    sourceType: 'JOURNAL_ARTICLE',
    tags: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!authToken || !formData.title.trim()) return;
    try {
      setSaving(true);
      const response = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          ...formData,
          authors: formData.authors.split(',').map(a => a.trim()).filter(Boolean),
          year: formData.year ? parseInt(formData.year, 10) : undefined,
          tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
        }),
      });
      if (!response.ok) throw new Error('Failed to save');
      onOpenChange(false);
      setFormData({
        title: '',
        authors: '',
        year: '',
        venue: '',
        doi: '',
        url: '',
        abstract: '',
        sourceType: 'JOURNAL_ARTICLE',
        tags: '',
      });
      onSuccess();
    } catch (err) {
      console.error('Failed to save reference:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-white border-gray-200 shadow-2xl">
        <DialogHeader>
          <DialogTitle>Add Reference Manually</DialogTitle>
          <DialogDescription>Enter the bibliographic details</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 mt-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Title *</label>
              <Input
                value={formData.title}
                onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Paper title"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Authors (comma-separated)</label>
              <Input
                value={formData.authors}
                onChange={e => setFormData(prev => ({ ...prev, authors: e.target.value }))}
                placeholder="John Smith, Jane Doe"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Year</label>
              <Input
                type="number"
                value={formData.year}
                onChange={e => setFormData(prev => ({ ...prev, year: e.target.value }))}
                placeholder="2024"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Type</label>
              <select
                value={formData.sourceType}
                onChange={e => setFormData(prev => ({ ...prev, sourceType: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2"
              >
                {Object.entries(SOURCE_TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Journal / Conference / Publisher</label>
              <Input
                value={formData.venue}
                onChange={e => setFormData(prev => ({ ...prev, venue: e.target.value }))}
                placeholder="Nature, ICML 2024, etc."
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">DOI</label>
              <Input
                value={formData.doi}
                onChange={e => setFormData(prev => ({ ...prev, doi: e.target.value }))}
                placeholder="10.1000/xyz123"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">URL</label>
              <Input
                value={formData.url}
                onChange={e => setFormData(prev => ({ ...prev, url: e.target.value }))}
                placeholder="https://..."
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Abstract</label>
              <Textarea
                value={formData.abstract}
                onChange={e => setFormData(prev => ({ ...prev, abstract: e.target.value }))}
                placeholder="Paper abstract..."
                rows={4}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Tags (comma-separated)</label>
              <Input
                value={formData.tags}
                onChange={e => setFormData(prev => ({ ...prev, tags: e.target.value }))}
                placeholder="machine learning, NLP, transformers"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !formData.title.trim()}>
              {saving ? 'Saving...' : 'Save Reference'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

