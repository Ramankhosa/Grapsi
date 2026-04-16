'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DocumentStatusBadge } from './DocumentStatusBadge';
import { DocumentUploadDialog } from './DocumentUploadDialog';

interface ReferenceManagementPageProps {
  authToken: string | null;
}

interface Library {
  id: string;
  name: string;
  description?: string;
  color?: string;
  referenceCount: number;
  isDefault?: boolean;
  createdAt: string;
}

interface Reference {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url?: string;
  isbn?: string;
  publisher?: string;
  edition?: string;
  editors?: string[];
  publicationPlace?: string;
  publicationDate?: string;
  accessedDate?: string;
  articleNumber?: string;
  issn?: string;
  journalAbbreviation?: string;
  pmid?: string;
  pmcid?: string;
  arxivId?: string;
  sourceType?: string;
  citationKey?: string;
  importSource?: string;
  importDate?: string;
  externalId?: string;
  notes?: string;
  bibtex?: string;
  abstract?: string;
  createdAt?: string;
  updatedAt?: string;
  isFavorite: boolean;
  isRead: boolean;
  tags: string[];
  collections: Array<{ collection: { id: string; name: string; color?: string } }>;
  documents?: Array<{
    document: {
      id: string;
      status: 'UPLOADED' | 'PARSING' | 'READY' | 'FAILED';
      errorCode?: string;
      originalFilename: string;
      fileSizeBytes: number;
      mimeType?: string;
      pageCount?: number;
      sourceType?: 'UPLOAD' | 'DOI_FETCH' | 'URL_IMPORT' | 'TEXT_PASTE';
      sourceIdentifier?: string;
      pdfTitle?: string;
      pdfAuthors?: string;
      pdfDoi?: string;
      createdAt: string;
    };
    isPrimary: boolean;
  }>;
}

interface ReconciliationCandidate {
  documentId: string;
  referenceId: string;
  score: number;
  confidence: 'auto_high' | 'auto_guarded' | 'review' | 'low';
  hardConflict?: boolean;
  hardConflictReason?: string;
  reasons?: string[];
  marginToNext?: number;
}

interface ReconciliationReviewItem {
  documentId: string;
  reason: string;
  topCandidates: ReconciliationCandidate[];
}

interface ReconciliationResult {
  batchId: string;
  evaluatedDocuments: number;
  evaluatedReferences: number;
  autoLinked: Array<{
    documentId: string;
    referenceId: string;
    score: number;
    confidence: 'auto_high' | 'auto_guarded' | 'review' | 'low';
    auditLogId?: string;
  }>;
  reviewQueue: ReconciliationReviewItem[];
  unmatchedDocumentIds: string[];
  skippedByHardConflict: Array<{ documentId: string; reason: string }>;
}

const LIBRARY_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#f43f5e', // Rose
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#0ea5e9', // Sky
  '#6b7280', // Gray
];

const PAGE_SIZE = 25;

// Source type options for filtering
const SOURCE_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'JOURNAL_ARTICLE', label: 'Journal Article' },
  { value: 'CONFERENCE_PAPER', label: 'Conference Paper' },
  { value: 'BOOK', label: 'Book' },
  { value: 'BOOK_CHAPTER', label: 'Book Chapter' },
  { value: 'THESIS', label: 'Thesis/Dissertation' },
  { value: 'REPORT', label: 'Technical Report' },
  { value: 'WORKING_PAPER', label: 'Working Paper' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'PATENT', label: 'Patent' },
  { value: 'OTHER', label: 'Other' },
];

const SOURCE_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  SOURCE_TYPES.filter((type) => type.value).map((type) => [type.value, type.label])
);

function formatSourceType(value?: string): string {
  if (!value) return '-';
  return SOURCE_TYPE_LABELS[value] || value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeDoi(doi?: string): string | null {
  if (!doi) return null;
  const cleaned = doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .trim();
  return cleaned || null;
}

function toDoiUrl(doi?: string): string | null {
  const cleaned = normalizeDoi(doi);
  return cleaned ? `https://doi.org/${cleaned}` : null;
}

function parseReconciliationResult(value: unknown): ReconciliationResult | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ReconciliationResult>;
  if (typeof candidate.batchId !== 'string') return null;
  if (!Array.isArray(candidate.autoLinked) || !Array.isArray(candidate.reviewQueue)) return null;
  return candidate as ReconciliationResult;
}

export default function ReferenceManagementPage({ authToken }: ReferenceManagementPageProps) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [totalReferences, setTotalReferences] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedLibrary, setSelectedLibrary] = useState<string | null>(null);
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const [expandedRefs, setExpandedRefs] = useState<Set<string>>(new Set());
  
  // Advanced filters
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceTypeFilter, setSourceTypeFilter] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [showHasAttachmentOnly, setShowHasAttachmentOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  
  // Library management
  const [showNewLibrary, setShowNewLibrary] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState('');
  const [newLibraryDesc, setNewLibraryDesc] = useState('');
  const [newLibraryColor, setNewLibraryColor] = useState(LIBRARY_COLORS[0]);
  const [editingLibrary, setEditingLibrary] = useState<Library | null>(null);
  
  // Reference management
  const [showAddRef, setShowAddRef] = useState(false);
  const [uploadDialogRef, setUploadDialogRef] = useState<{ id: string; title: string } | null>(null);
  const [uploadDialogMode, setUploadDialogMode] = useState<'attach' | 'replace'>('attach');
  const [addRefForm, setAddRefForm] = useState({
    title: '',
    authors: '',
    year: '',
    venue: '',
    doi: '',
    abstract: ''
  });

  // Count active filters
  const activeFilterCount = [
    sourceTypeFilter,
    yearFrom,
    yearTo,
    showFavoritesOnly,
    showUnreadOnly,
    showHasAttachmentOnly
  ].filter(Boolean).length;

  // Load libraries
  const loadLibraries = useCallback(async () => {
    if (!authToken) return;
    try {
      const response = await fetch('/api/library/collections', {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        setLibraries(data.collections || []);
        setTotalReferences(data.totalReferences || 0);
      }
    } catch (err) {
      console.error('Failed to load libraries:', err);
    }
  }, [authToken]);

  // Load references with pagination and filters
  const loadReferences = useCallback(async (page: number = currentPage, showLoader: boolean = true) => {
    if (!authToken) return;
    try {
      if (showLoader) setLoading(true);
      const params = new URLSearchParams();
      if (selectedLibrary) params.set('collectionId', selectedLibrary);
      if (searchQuery) params.set('search', searchQuery);
      if (sourceTypeFilter) params.set('sourceType', sourceTypeFilter);
      if (yearFrom) params.set('yearFrom', yearFrom);
      if (yearTo) params.set('yearTo', yearTo);
      if (showFavoritesOnly) params.set('isFavorite', 'true');
      if (showUnreadOnly) params.set('isRead', 'false');
      if (showHasAttachmentOnly) params.set('hasAttachment', 'true');
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String((page - 1) * PAGE_SIZE));
      
      const response = await fetch(`/api/library?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        setReferences(data.references || []);
        setTotalCount(data.total || 0);
        setTotalPages(Math.ceil((data.total || 0) / PAGE_SIZE));
      }
    } catch (err) {
      console.error('Failed to load references:', err);
    } finally {
      setLoading(false);
    }
  }, [authToken, selectedLibrary, searchQuery, sourceTypeFilter, yearFrom, yearTo, showFavoritesOnly, showUnreadOnly, showHasAttachmentOnly, currentPage]);

  useEffect(() => {
    loadLibraries();
  }, [loadLibraries]);

  useEffect(() => {
    loadReferences(currentPage);
  }, [loadReferences, currentPage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
    setSelectedRefs(new Set()); // Clear selection on filter change
    setExpandedRefs(new Set());
  }, [selectedLibrary, searchQuery, sourceTypeFilter, yearFrom, yearTo, showFavoritesOnly, showUnreadOnly, showHasAttachmentOnly]);

  // Clear all filters
  const clearFilters = () => {
    setSearchQuery('');
    setSourceTypeFilter('');
    setYearFrom('');
    setYearTo('');
    setShowFavoritesOnly(false);
    setShowUnreadOnly(false);
    setShowHasAttachmentOnly(false);
    setCurrentPage(1);
  };

  const handlePageChange = (page: number) => {
    if (page === currentPage) return;
    setCurrentPage(page);
    setSelectedRefs(new Set()); // Clear selection on page change
    setExpandedRefs(new Set());
    // Smooth scroll to reference list
    const referenceList = document.getElementById('reference-list');
    if (referenceList) {
      referenceList.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const toggleReferenceDetails = (refId: string) => {
    setExpandedRefs((prev) => {
      const next = new Set(prev);
      if (next.has(refId)) {
        next.delete(refId);
      } else {
        next.add(refId);
      }
      return next;
    });
  };

  // Create library
  const handleCreateLibrary = async () => {
    if (!authToken || !newLibraryName.trim()) return;
    try {
      const response = await fetch('/api/library/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          name: newLibraryName.trim(),
          description: newLibraryDesc.trim() || undefined,
          color: newLibraryColor
        })
      });
      if (response.ok) {
        setShowNewLibrary(false);
        setNewLibraryName('');
        setNewLibraryDesc('');
        setNewLibraryColor(LIBRARY_COLORS[0]);
        loadLibraries();
      }
    } catch (err) {
      console.error('Failed to create library:', err);
    }
  };

  // Update library
  const handleUpdateLibrary = async () => {
    if (!authToken || !editingLibrary) return;
    try {
      const response = await fetch(`/api/library/collections/${editingLibrary.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          name: newLibraryName.trim(),
          description: newLibraryDesc.trim() || undefined,
          color: newLibraryColor
        })
      });
      if (response.ok) {
        setEditingLibrary(null);
        setNewLibraryName('');
        setNewLibraryDesc('');
        loadLibraries();
      }
    } catch (err) {
      console.error('Failed to update library:', err);
    }
  };

  // Delete library
  const handleDeleteLibrary = async (libraryId: string) => {
    if (!authToken) return;
    if (!confirm('Delete this library? References will not be deleted, only removed from this library.')) return;
    try {
      await fetch(`/api/library/collections/${libraryId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (selectedLibrary === libraryId) setSelectedLibrary(null);
      loadLibraries();
    } catch (err) {
      console.error('Failed to delete library:', err);
    }
  };

  // Add reference to library with subtle refresh
  const handleAddToLibrary = async (libraryId: string) => {
    if (!authToken || selectedRefs.size === 0) return;
    
    const idsToAdd = Array.from(selectedRefs);
    setSelectedRefs(new Set());
    
    try {
      const response = await fetch(`/api/library/collections/${libraryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'addReferences',
          referenceIds: idsToAdd
        })
      });
      if (response.ok) {
        // Refresh library counts and update collection badges silently
        loadLibraries();
        loadReferences(currentPage, false); // Silent refresh to update collection badges
      }
    } catch (err) {
      console.error('Failed to add to library:', err);
    }
  };

  // Remove from library with optimistic update and pagination handling
  const handleRemoveFromLibrary = async () => {
    if (!authToken || !selectedLibrary || selectedRefs.size === 0) return;
    
    const idsToRemove = new Set(selectedRefs);
    const previousRefs = references;
    const previousCount = totalCount;
    const newRefs = references.filter(r => !idsToRemove.has(r.id));
    const newCount = totalCount - idsToRemove.size;
    
    // Optimistic update
    setReferences(newRefs);
    setTotalCount(newCount);
    setSelectedRefs(new Set());
    
    // Check if we need page adjustment
    const needsPageAdjustment = newRefs.length === 0 && newCount > 0;
    
    try {
      const response = await fetch(`/api/library/collections/${selectedLibrary}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'removeReferences',
          referenceIds: Array.from(idsToRemove)
        })
      });
      if (response.ok) {
        // Handle pagination after successful removal
        if (needsPageAdjustment) {
          const newTotalPages = Math.ceil(newCount / PAGE_SIZE);
          const targetPage = Math.min(currentPage, newTotalPages);
          if (targetPage !== currentPage) {
            setCurrentPage(targetPage);
          } else {
            loadReferences(currentPage, false);
          }
        }
        // Refresh library counts
        loadLibraries();
      } else {
        throw new Error('Remove failed');
      }
    } catch (err) {
      console.error('Failed to remove from library:', err);
      // Revert on error
      setReferences(previousRefs);
      setTotalCount(previousCount);
    }
  };

  // Add new reference
  const handleAddReference = async () => {
    if (!authToken || !addRefForm.title.trim()) return;
    try {
      const response = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          title: addRefForm.title.trim(),
          authors: addRefForm.authors.split(',').map(a => a.trim()).filter(Boolean),
          year: addRefForm.year ? parseInt(addRefForm.year, 10) : undefined,
          venue: addRefForm.venue.trim() || undefined,
          doi: addRefForm.doi.trim() || undefined,
          abstract: addRefForm.abstract.trim() || undefined,
          collectionId: selectedLibrary || undefined, // Add to selected library if one is chosen
        })
      });
      if (response.ok) {
        setShowAddRef(false);
        setAddRefForm({ title: '', authors: '', year: '', venue: '', doi: '', abstract: '' });
        // Go to page 1 to see the newly added reference (if viewing "All" or selected library)
        if (currentPage !== 1) {
          setCurrentPage(1);
        } else {
          loadReferences(1, false); // Silent refresh
        }
        loadLibraries();
      }
    } catch (err) {
      console.error('Failed to add reference:', err);
    }
  };

  // Delete reference with optimistic update
  const handleDeleteReference = async (refId: string) => {
    if (!authToken) return;
    if (!confirm('Delete this reference from your library?')) return;
    
    // Optimistic update - remove from UI immediately
    const previousRefs = references;
    const previousCount = totalCount;
    const newCount = totalCount - 1;
    const newRefs = references.filter(r => r.id !== refId);
    
    setReferences(newRefs);
    setTotalCount(newCount);
    
    // Handle empty page scenario
    if (newRefs.length === 0 && newCount > 0) {
      // Page is empty but there are more items - go to previous page or refresh
      const newTotalPages = Math.ceil(newCount / PAGE_SIZE);
      const targetPage = Math.min(currentPage, newTotalPages);
      if (targetPage !== currentPage) {
        setCurrentPage(targetPage);
      } else {
        // Refresh current page to get next items
        loadReferences(currentPage, false);
      }
    }
    
    try {
      const response = await fetch(`/api/library/${refId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!response.ok) throw new Error('Delete failed');
      // Silently refresh libraries count in background
      loadLibraries();
    } catch (err) {
      console.error('Failed to delete reference:', err);
      // Revert on error
      setReferences(previousRefs);
      setTotalCount(previousCount);
    }
  };

  // Bulk delete references with optimistic update
  const handleBulkDelete = async () => {
    if (!authToken || selectedRefs.size === 0) return;
    if (!confirm(`Delete ${selectedRefs.size} selected reference(s)? This action cannot be undone.`)) return;
    
    // Optimistic update
    const idsToDelete = new Set(selectedRefs);
    const previousRefs = references;
    const previousCount = totalCount;
    const newCount = totalCount - idsToDelete.size;
    const newRefs = references.filter(r => !idsToDelete.has(r.id));
    
    setReferences(newRefs);
    setTotalCount(newCount);
    setSelectedRefs(new Set());
    
    // Handle empty page scenario - if we deleted all items on current page
    const needsPageAdjustment = newRefs.length === 0 && newCount > 0;
    
    try {
      const response = await fetch('/api/library/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ referenceIds: Array.from(idsToDelete) })
      });
      if (response.ok) {
        const data = await response.json();
        // Silently refresh libraries count
        loadLibraries();
        
        // Handle pagination after successful delete
        if (needsPageAdjustment) {
          const newTotalPages = Math.ceil(newCount / PAGE_SIZE);
          const targetPage = Math.min(currentPage, newTotalPages);
          if (targetPage !== currentPage) {
            setCurrentPage(targetPage);
          } else {
            // Refresh current page to get next items
            loadReferences(currentPage, false);
          }
        }
        
        if (data.errors?.length > 0) {
          alert(`Deleted ${data.deleted} references. Some errors occurred.`);
        }
      } else {
        throw new Error('Bulk delete failed');
      }
    } catch (err) {
      console.error('Failed to bulk delete:', err);
      // Revert on error
      setReferences(previousRefs);
      setTotalCount(previousCount);
    }
  };

  // Move to library (remove from current, add to target) with optimistic update
  const handleMoveToLibrary = async (targetLibraryId: string) => {
    if (!authToken || selectedRefs.size === 0) return;
    
    const idsToMove = new Set(selectedRefs);
    const previousRefs = references;
    const previousCount = totalCount;
    
    // Optimistic: remove from current view if in a specific library
    let newRefs = references;
    let newCount = totalCount;
    if (selectedLibrary) {
      newRefs = references.filter(r => !idsToMove.has(r.id));
      newCount = totalCount - idsToMove.size;
      setReferences(newRefs);
      setTotalCount(newCount);
    }
    setSelectedRefs(new Set());
    
    // Check if we need page adjustment after successful operation
    const needsPageAdjustment = selectedLibrary && newRefs.length === 0 && newCount > 0;
    
    try {
      // Add to target library
      await fetch(`/api/library/collections/${targetLibraryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'addReferences',
          referenceIds: Array.from(idsToMove)
        })
      });
      
      // Remove from current library if viewing a specific library
      if (selectedLibrary) {
        await fetch(`/api/library/collections/${selectedLibrary}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({
            action: 'removeReferences',
            referenceIds: Array.from(idsToMove)
          })
        });
      }
      
      // Handle pagination after successful move
      if (needsPageAdjustment) {
        const newTotalPages = Math.ceil(newCount / PAGE_SIZE);
        const targetPage = Math.min(currentPage, newTotalPages);
        if (targetPage !== currentPage) {
          setCurrentPage(targetPage);
        } else {
          loadReferences(currentPage, false);
        }
      }
      
      // Refresh library counts in background
      loadLibraries();
    } catch (err) {
      console.error('Failed to move references:', err);
      // Revert on error
      if (selectedLibrary) {
        setReferences(previousRefs);
        setTotalCount(previousCount);
      }
    }
  };

  // Copy to library (add to target without removing from current)
  const handleCopyToLibrary = async (targetLibraryId: string) => {
    if (!authToken || selectedRefs.size === 0) return;
    
    const idsToCopy = Array.from(selectedRefs);
    setSelectedRefs(new Set());
    
    try {
      await fetch(`/api/library/collections/${targetLibraryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'addReferences',
          referenceIds: idsToCopy
        })
      });
      // Refresh library counts and update collection badges
      loadLibraries();
      loadReferences(currentPage, false); // Silent refresh to update collection badges
    } catch (err) {
      console.error('Failed to copy references:', err);
    }
  };

  // Select all / deselect all
  const handleSelectAll = () => {
    if (selectedRefs.size === references.length && references.length > 0) {
      setSelectedRefs(new Set());
    } else {
      setSelectedRefs(new Set(references.map(r => r.id)));
    }
  };

  // Toggle favorite with optimistic update
  const handleToggleFavorite = async (refId: string) => {
    if (!authToken) return;
    
    // Optimistic update
    setReferences(prev => prev.map(r => 
      r.id === refId ? { ...r, isFavorite: !r.isFavorite } : r
    ));
    
    try {
      const response = await fetch(`/api/library/${refId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'toggleFavorite' })
      });
      if (!response.ok) throw new Error('Toggle failed');
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
      // Revert on error
      setReferences(prev => prev.map(r => 
        r.id === refId ? { ...r, isFavorite: !r.isFavorite } : r
      ));
    }
  };

  // PDF Document handlers
  const handleAttachPDF = (refId: string, refTitle: string) => {
    setUploadDialogRef({ id: refId, title: refTitle });
    setUploadDialogMode('attach');
  };

  const handleReplacePDF = (refId: string, refTitle: string) => {
    setUploadDialogRef({ id: refId, title: refTitle });
    setUploadDialogMode('replace');
  };

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const openViewerWindow = (title: string, loadingMessage: string): Window | null => {
    const popup = window.open('', '_blank');
    if (!popup) return null;

    popup.opener = null;
    popup.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 20px; color: #111827; }
    </style>
  </head>
  <body>
    <p>${escapeHtml(loadingMessage)}</p>
  </body>
</html>`);
    popup.document.close();
    return popup;
  };

  const createTextViewerHtml = (title: string, text: string) => {
    const safeTitle = escapeHtml(title || 'Document Text');
    const safeText = escapeHtml(text);
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 16px; color: #111827; }
      h1 { font-size: 16px; margin: 0 0 12px; }
      pre { white-space: pre-wrap; word-wrap: break-word; line-height: 1.5; font-size: 13px; margin: 0; }
    </style>
  </head>
  <body>
    <h1>${safeTitle}</h1>
    <pre>${safeText}</pre>
  </body>
</html>`;
  };

  const handleViewPDF = async (refId: string) => {
    if (!authToken) return;
    const viewerWindow = openViewerWindow('Loading PDF', 'Loading document...');
    try {
      const response = await fetch(`/api/library/${refId}/document/serve`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || `Failed to open document (HTTP ${response.status})`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (viewerWindow && !viewerWindow.closed) {
        viewerWindow.location.replace(url);
      } else {
        window.location.assign(url);
      }

      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 60_000);
    } catch (err) {
      if (viewerWindow && !viewerWindow.closed) {
        viewerWindow.close();
      }
      console.error('Failed to view PDF:', err);
      alert(err instanceof Error ? err.message : 'Failed to open document');
    }
  };

  const handleViewText = async (refId: string, refTitle: string) => {
    if (!authToken) return;
    const viewerWindow = openViewerWindow(refTitle || 'Document Text', 'Loading full text...');
    try {
      const response = await fetch(`/api/references/${refId}/full-text`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || `Failed to open full text (HTTP ${response.status})`);
      }

      const text = String(data.text || '');
      if (!text.trim()) {
        throw new Error('No extracted text available for this document yet.');
      }

      const html = createTextViewerHtml(refTitle || 'Document Text', text);
      if (viewerWindow && !viewerWindow.closed) {
        viewerWindow.document.open();
        viewerWindow.document.write(html);
        viewerWindow.document.close();
      } else {
        const htmlBlob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(htmlBlob);
        window.location.assign(url);
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 60_000);
      }
    } catch (err) {
      if (viewerWindow && !viewerWindow.closed) {
        viewerWindow.close();
      }
      console.error('Failed to view full text:', err);
      alert(err instanceof Error ? err.message : 'Failed to open full text');
    }
  };

  const handleRemovePDF = async (refId: string) => {
    if (!authToken) return;
    if (!confirm('Remove PDF attachment from this reference?')) return;
    try {
      const response = await fetch(`/api/library/${refId}/document`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (response.ok) {
        loadReferences(currentPage, false);
      }
    } catch (err) {
      console.error('Failed to remove PDF:', err);
    }
  };

  const handleFetchOAPDF = async (refId: string, doi: string | undefined) => {
    if (!authToken || !doi) return;
    try {
      const response = await fetch(`/api/library/${refId}/document/fetch-oa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ doi })
      });
      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? await response.json()
        : response.status === 413
          ? {
            error:
              'Upload is too large for the server/proxy limit. Reduce file size or increase Nginx client_max_body_size.',
          }
          : { error: 'Server returned a non-JSON response. Check server logs for the root error.' };
      if (response.ok) {
        loadReferences(currentPage, false);
      } else {
        alert(data.error || `Failed to fetch OA PDF (HTTP ${response.status})`);
      }
    } catch (err) {
      console.error('Failed to fetch OA PDF:', err);
      alert('Failed to fetch open access PDF. Please try again.');
    }
  };



  const currentLibrary = useMemo(() => 
    libraries.find(l => l.id === selectedLibrary),
    [libraries, selectedLibrary]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
              </svg>
            </div>
            Reference Management
          </h1>
          <p className="text-gray-600 mt-2 ml-[52px]">
            Organize your references into libraries for easy access across all your papers
          </p>
        </div>

        {/* First-time user hint */}
        {libraries.length === 0 && totalReferences === 0 && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 p-6 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl text-white"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">Welcome to Reference Management!</h3>
                <p className="text-white/90 text-sm mb-4">
                  This is your personal reference library. Here&apos;s how it works:
                </p>
                <ol className="text-sm text-white/90 space-y-2 mb-4">
                  <li className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs shrink-0">1</span>
                    <span><strong>Create Libraries</strong> to organize references by topic, project, or any way you like</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs shrink-0">2</span>
                    <span><strong>Add References</strong> manually, by DOI, or import from BibTeX/RIS files</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs shrink-0">3</span>
                    <span><strong>Use in Papers</strong> - import references from your libraries when writing papers</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs shrink-0">4</span>
                    <span><strong>Save from Search</strong> - while searching literature, save useful references to your libraries</span>
                  </li>
                </ol>
                <Button 
                  onClick={() => setShowNewLibrary(true)}
                  className="bg-white text-indigo-600 hover:bg-white/90"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create Your First Library
                </Button>
              </div>
            </div>
          </motion.div>
        )}

        <div className="grid lg:grid-cols-[300px,1fr] gap-6">
          {/* Sidebar - Libraries */}
          <div className="space-y-4">
            <Card className="bg-white/80 backdrop-blur">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Libraries</CardTitle>
                  <Button size="sm" variant="ghost" onClick={() => setShowNewLibrary(true)}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-1">
                {/* All References */}
                <button
                  onClick={() => setSelectedLibrary(null)}
                  className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between transition-colors ${
                    selectedLibrary === null 
                      ? 'bg-indigo-100 text-indigo-700' 
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <span className="font-medium">All References</span>
                  </div>
                  <Badge variant="secondary" className="text-xs">{totalReferences}</Badge>
                </button>

                {/* Library list */}
                <div className="pt-2 space-y-1">
                  {libraries.map(library => (
                    <div
                      key={library.id}
                      className={`group relative rounded-lg transition-colors ${
                        selectedLibrary === library.id 
                          ? 'bg-indigo-100' 
                          : 'hover:bg-gray-100'
                      }`}
                    >
                      <button
                        onClick={() => setSelectedLibrary(library.id)}
                        className="w-full text-left px-3 py-2 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div 
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: library.color || '#6366f1' }}
                          />
                          <span className={`font-medium truncate ${
                            selectedLibrary === library.id ? 'text-indigo-700' : 'text-gray-700'
                          }`}>
                            {library.name}
                          </span>
                        </div>
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {library.referenceCount}
                        </Badge>
                      </button>
                      
                      {/* Edit/Delete buttons */}
                      <div className="absolute right-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingLibrary(library);
                            setNewLibraryName(library.name);
                            setNewLibraryDesc(library.description || '');
                            setNewLibraryColor(library.color || LIBRARY_COLORS[0]);
                          }}
                          className="p-1 hover:bg-gray-200 rounded"
                        >
                          <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        {!library.isDefault && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteLibrary(library.id);
                            }}
                            className="p-1 hover:bg-red-100 rounded"
                          >
                            <svg className="w-3 h-3 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {libraries.length === 0 && (
                  <p className="text-xs text-gray-500 text-center py-4">
                    No libraries yet. Create one to organize your references!
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Quick Stats */}
            <Card className="bg-white/80 backdrop-blur">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Quick Stats</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <div className="text-center p-3 bg-indigo-50 rounded-lg">
                  <div className="text-2xl font-bold text-indigo-600">{totalReferences}</div>
                  <div className="text-xs text-gray-600">Total References</div>
                </div>
                <div className="text-center p-3 bg-purple-50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">{libraries.length}</div>
                  <div className="text-xs text-gray-600">Libraries</div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content - References */}
          <Card className="bg-white/80 backdrop-blur">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {currentLibrary ? (
                      <>
                        <div 
                          className="w-4 h-4 rounded-full"
                          style={{ backgroundColor: currentLibrary.color || '#6366f1' }}
                        />
                        {currentLibrary.name}
                      </>
                    ) : (
                      'All References'
                    )}
                  </CardTitle>
                  <CardDescription>
                    {currentLibrary?.description || 'All references in your library'}
                  </CardDescription>
                </div>
                <Button onClick={() => setShowAddRef(true)}>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Reference
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Search and Filters */}
              <div className="space-y-3 mb-4">
                {/* Main search bar */}
                <div className="flex flex-wrap gap-3">
                  <div className="relative flex-1 min-w-[200px]">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <Input
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search title, abstract, venue, authors..."
                      className="pl-10"
                    />
                  </div>
                  
                  {/* Filter toggle button */}
                  <Button
                    variant="outline"
                    onClick={() => setShowFilters(!showFilters)}
                    className={`gap-2 ${activeFilterCount > 0 ? 'border-indigo-300 bg-indigo-50' : ''}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                    </svg>
                    Filters
                    {activeFilterCount > 0 && (
                      <Badge className="bg-indigo-600 text-white text-xs h-5 w-5 p-0 flex items-center justify-center">
                        {activeFilterCount}
                      </Badge>
                    )}
                  </Button>
                  
                  {activeFilterCount > 0 && (
                    <Button variant="ghost" size="sm" onClick={clearFilters} className="text-gray-500">
                      Clear all
                    </Button>
                  )}
                </div>

                {/* Advanced filters panel */}
                <AnimatePresence>
                  {showFilters && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="p-4 bg-gray-50 rounded-xl border space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                          {/* Source Type */}
                          <div>
                            <label className="text-xs font-medium text-gray-600 block mb-1.5">Source Type</label>
                            <select
                              value={sourceTypeFilter}
                              onChange={e => setSourceTypeFilter(e.target.value)}
                              className="w-full text-sm border rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            >
                              {SOURCE_TYPES.map(type => (
                                <option key={type.value} value={type.value}>{type.label}</option>
                              ))}
                            </select>
                          </div>
                          
                          {/* Year Range */}
                          <div>
                            <label className="text-xs font-medium text-gray-600 block mb-1.5">Year Range</label>
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                value={yearFrom}
                                onChange={e => setYearFrom(e.target.value)}
                                placeholder="From"
                                className="text-sm"
                                min="1900"
                                max="2100"
                              />
                              <span className="text-gray-400">â€“</span>
                              <Input
                                type="number"
                                value={yearTo}
                                onChange={e => setYearTo(e.target.value)}
                                placeholder="To"
                                className="text-sm"
                                min="1900"
                                max="2100"
                              />
                            </div>
                          </div>
                          
                          {/* Quick filters */}
                          <div className="sm:col-span-2 lg:col-span-2">
                            <label className="text-xs font-medium text-gray-600 block mb-1.5">Quick Filters</label>
                            <div className="flex flex-wrap gap-2">
                              <label className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                                showFavoritesOnly ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white hover:bg-gray-50'
                              }`}>
                                <Checkbox
                                  checked={showFavoritesOnly}
                                  onCheckedChange={checked => setShowFavoritesOnly(!!checked)}
                                />
                                <svg className="w-4 h-4" fill={showFavoritesOnly ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                </svg>
                                <span className="text-sm">Favorites</span>
                              </label>
                              
                              <label className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                                showUnreadOnly ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white hover:bg-gray-50'
                              }`}>
                                <Checkbox
                                  checked={showUnreadOnly}
                                  onCheckedChange={checked => setShowUnreadOnly(!!checked)}
                                />
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                </svg>
                                <span className="text-sm">Unread</span>
                              </label>

                              <label className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                                showHasAttachmentOnly ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white hover:bg-gray-50'
                              }`}>
                                <Checkbox
                                  checked={showHasAttachmentOnly}
                                  onCheckedChange={checked => setShowHasAttachmentOnly(!!checked)}
                                />
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21.44 11.05l-8.49 8.49a5 5 0 01-7.07-7.07l8.49-8.48a3 3 0 114.24 4.24l-8.49 8.49a1 1 0 01-1.41-1.42l7.78-7.78" />
                                </svg>
                                <span className="text-sm">Attachment</span>
                              </label>
                            </div>
                          </div>
                        </div>
                        
                        {/* Filter summary */}
                        {activeFilterCount > 0 && (
                          <div className="flex items-center gap-2 text-sm text-gray-600 pt-2 border-t">
                            <span className="font-medium">{totalCount} results</span>
                            <span className="text-gray-400">with {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} applied</span>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Bulk Action Bar */}
              {selectedRefs.size > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-4 p-4 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-indigo-600 text-white">
                        {selectedRefs.size} selected
                      </Badge>
                      <button 
                        onClick={() => setSelectedRefs(new Set())}
                        className="text-xs text-gray-500 hover:text-gray-700 underline"
                      >
                        Clear selection
                      </button>
                    </div>
                    
                    <div className="h-6 w-px bg-gray-300" />
                    
                    {/* Copy to Library */}
                    <div className="relative group">
                      <Button size="sm" variant="outline" className="gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        Copy to
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </Button>
                      <div className="absolute top-full left-0 mt-1 bg-white border rounded-lg shadow-xl py-1 min-w-[200px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20">
                        <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Copy to Library
                        </div>
                        {libraries.map(lib => (
                          <button
                            key={lib.id}
                            onClick={() => handleCopyToLibrary(lib.id)}
                            className="w-full text-left px-3 py-2 hover:bg-indigo-50 flex items-center gap-2 text-sm"
                          >
                            <div 
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{ backgroundColor: lib.color || '#6366f1' }}
                            />
                            <span className="truncate">{lib.name}</span>
                          </button>
                        ))}
                        {libraries.length === 0 && (
                          <p className="px-3 py-2 text-sm text-gray-500">No libraries yet</p>
                        )}
                      </div>
                    </div>

                    {/* Move to Library (only if viewing a specific library) */}
                    {selectedLibrary && (
                      <div className="relative group">
                        <Button size="sm" variant="outline" className="gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                          </svg>
                          Move to
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </Button>
                        <div className="absolute top-full left-0 mt-1 bg-white border rounded-lg shadow-xl py-1 min-w-[200px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20">
                          <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            Move to Library
                          </div>
                          {libraries.filter(lib => lib.id !== selectedLibrary).map(lib => (
                            <button
                              key={lib.id}
                              onClick={() => handleMoveToLibrary(lib.id)}
                              className="w-full text-left px-3 py-2 hover:bg-indigo-50 flex items-center gap-2 text-sm"
                            >
                              <div 
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: lib.color || '#6366f1' }}
                              />
                              <span className="truncate">{lib.name}</span>
                            </button>
                          ))}
                          {libraries.filter(lib => lib.id !== selectedLibrary).length === 0 && (
                            <p className="px-3 py-2 text-sm text-gray-500">No other libraries</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Remove from current library */}
                    {selectedLibrary && (
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={handleRemoveFromLibrary}
                        className="gap-1"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 12H6" />
                        </svg>
                        Remove from Library
                      </Button>
                    )}

                    <div className="h-6 w-px bg-gray-300" />

                    {/* Delete */}
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={handleBulkDelete}
                      className="gap-1 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Delete Selected
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* References List */}
              <div id="reference-list" className="space-y-2">
                {loading ? (
                  <div className="text-center py-12">
                    <svg className="w-8 h-8 mx-auto mb-3 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <p className="text-gray-500">Loading references...</p>
                  </div>
                ) : references.length > 0 ? (
                  <>
                    {/* Select All Header */}
                    <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 rounded-lg border">
                      <Checkbox
                        checked={selectedRefs.size === references.length && references.length > 0}
                        onCheckedChange={handleSelectAll}
                      />
                      <span className="text-sm text-gray-600 font-medium">
                        {selectedRefs.size === references.length && references.length > 0 
                          ? 'Deselect all' 
                          : `Select all (${references.length})`
                        }
                      </span>
                      {selectedRefs.size > 0 && selectedRefs.size < references.length && (
                        <span className="text-xs text-gray-400">
                          ({selectedRefs.size} of {references.length} selected)
                        </span>
                      )}
                    </div>
                    
                    <AnimatePresence mode="popLayout">
                      {references.map((ref, index) => (
                        <motion.div
                          key={ref.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ delay: index * 0.02 }}
                          className={`p-4 border rounded-xl transition-all ${
                            selectedRefs.has(ref.id) 
                              ? 'bg-indigo-50 border-indigo-200' 
                              : 'bg-white hover:shadow-md'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={selectedRefs.has(ref.id)}
                              onCheckedChange={() => {
                                setSelectedRefs(prev => {
                                  const next = new Set(prev);
                                  if (next.has(ref.id)) {
                                    next.delete(ref.id);
                                  } else {
                                    next.add(ref.id);
                                  }
                                  return next;
                                });
                              }}
                              className="mt-1"
                            />
                            
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-gray-900">{ref.title}</h4>
                              <p className="text-sm text-gray-600 mt-1">
                                {ref.authors?.slice(0, 3).join(', ')}
                                {ref.authors?.length > 3 && ' et al.'}
                                {ref.year && ` (${ref.year})`}
                              </p>
                              {ref.venue && (
                                <p className="text-xs text-gray-500 italic mt-1">{ref.venue}</p>
                              )}
                              <div className="flex flex-wrap items-center gap-2 mt-2">
                                {ref.sourceType && (
                                  <Badge variant="outline" className="text-[10px]">
                                    {formatSourceType(ref.sourceType)}
                                  </Badge>
                                )}
                                {ref.doi && (
                                  <Badge variant="secondary" className="text-[10px] font-mono">
                                    DOI: {normalizeDoi(ref.doi)}
                                  </Badge>
                                )}
                              </div>
                              
                              {/* Libraries this reference belongs to */}
                              {ref.collections && ref.collections.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {ref.collections.map(c => (
                                    <Badge 
                                      key={c.collection.id} 
                                      variant="outline"
                                      className="text-[10px]"
                                      style={{ 
                                        borderColor: c.collection.color || '#6366f1',
                                        color: c.collection.color || '#6366f1'
                                      }}
                                    >
                                      {c.collection.name}
                                    </Badge>
                                  ))}
                                </div>
                              )}

                              {expandedRefs.has(ref.id) && (
                                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 text-xs">
                                    {ref.citationKey && (
                                      <div>
                                        <p className="text-gray-500">Citation Key</p>
                                        <p className="font-mono text-gray-800">{ref.citationKey}</p>
                                      </div>
                                    )}
                                    {ref.importSource && (
                                      <div>
                                        <p className="text-gray-500">Import Source</p>
                                        <p className="text-gray-800">{ref.importSource.replace(/_/g, ' ')}</p>
                                      </div>
                                    )}
                                    {ref.importDate && (
                                      <div>
                                        <p className="text-gray-500">Imported At</p>
                                        <p className="text-gray-800">{new Date(ref.importDate).toLocaleString()}</p>
                                      </div>
                                    )}
                                    {ref.publicationDate && (
                                      <div>
                                        <p className="text-gray-500">Publication Date</p>
                                        <p className="text-gray-800">{ref.publicationDate}</p>
                                      </div>
                                    )}
                                    {ref.volume && (
                                      <div>
                                        <p className="text-gray-500">Volume</p>
                                        <p className="text-gray-800">{ref.volume}</p>
                                      </div>
                                    )}
                                    {ref.issue && (
                                      <div>
                                        <p className="text-gray-500">Issue</p>
                                        <p className="text-gray-800">{ref.issue}</p>
                                      </div>
                                    )}
                                    {ref.pages && (
                                      <div>
                                        <p className="text-gray-500">Pages</p>
                                        <p className="text-gray-800">{ref.pages}</p>
                                      </div>
                                    )}
                                    {ref.publisher && (
                                      <div>
                                        <p className="text-gray-500">Publisher</p>
                                        <p className="text-gray-800">{ref.publisher}</p>
                                      </div>
                                    )}
                                    {ref.edition && (
                                      <div>
                                        <p className="text-gray-500">Edition</p>
                                        <p className="text-gray-800">{ref.edition}</p>
                                      </div>
                                    )}
                                    {ref.publicationPlace && (
                                      <div>
                                        <p className="text-gray-500">Publication Place</p>
                                        <p className="text-gray-800">{ref.publicationPlace}</p>
                                      </div>
                                    )}
                                    {ref.articleNumber && (
                                      <div>
                                        <p className="text-gray-500">Article Number</p>
                                        <p className="text-gray-800">{ref.articleNumber}</p>
                                      </div>
                                    )}
                                    {ref.journalAbbreviation && (
                                      <div>
                                        <p className="text-gray-500">Journal Abbreviation</p>
                                        <p className="text-gray-800">{ref.journalAbbreviation}</p>
                                      </div>
                                    )}
                                    {ref.issn && (
                                      <div>
                                        <p className="text-gray-500">ISSN</p>
                                        <p className="text-gray-800">{ref.issn}</p>
                                      </div>
                                    )}
                                    {ref.isbn && (
                                      <div>
                                        <p className="text-gray-500">ISBN</p>
                                        <p className="text-gray-800">{ref.isbn}</p>
                                      </div>
                                    )}
                                    {ref.pmid && (
                                      <div>
                                        <p className="text-gray-500">PMID</p>
                                        <p className="text-gray-800">{ref.pmid}</p>
                                      </div>
                                    )}
                                    {ref.pmcid && (
                                      <div>
                                        <p className="text-gray-500">PMCID</p>
                                        <p className="text-gray-800">{ref.pmcid}</p>
                                      </div>
                                    )}
                                    {ref.arxivId && (
                                      <div>
                                        <p className="text-gray-500">arXiv ID</p>
                                        <p className="text-gray-800">{ref.arxivId}</p>
                                      </div>
                                    )}
                                    {ref.accessedDate && (
                                      <div>
                                        <p className="text-gray-500">Accessed Date</p>
                                        <p className="text-gray-800">{ref.accessedDate}</p>
                                      </div>
                                    )}
                                    {ref.externalId && (
                                      <div className="md:col-span-2">
                                        <p className="text-gray-500">External ID</p>
                                        <p className="text-gray-800 break-all">{ref.externalId}</p>
                                      </div>
                                    )}
                                    {ref.editors && ref.editors.length > 0 && (
                                      <div className="md:col-span-2">
                                        <p className="text-gray-500">Editors</p>
                                        <p className="text-gray-800">{ref.editors.join(', ')}</p>
                                      </div>
                                    )}
                                    {ref.url && (
                                      <div className="md:col-span-2">
                                        <p className="text-gray-500">Source URL</p>
                                        <a
                                          href={ref.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-blue-600 hover:text-blue-800 hover:underline break-all"
                                        >
                                          {ref.url}
                                        </a>
                                      </div>
                                    )}
                                    {ref.doi && (
                                      <div className="md:col-span-2">
                                        <p className="text-gray-500">DOI</p>
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="font-mono text-gray-800">{normalizeDoi(ref.doi)}</span>
                                          {toDoiUrl(ref.doi) && (
                                            <a
                                              href={toDoiUrl(ref.doi)!}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="text-blue-600 hover:text-blue-800 hover:underline"
                                            >
                                              Open DOI
                                            </a>
                                          )}
                                          {!ref.documents?.length && (
                                            <button
                                              onClick={(e) => { e.stopPropagation(); handleFetchOAPDF(ref.id, ref.doi); }}
                                              className="text-emerald-600 hover:text-emerald-800 hover:underline"
                                            >
                                              Fetch OA PDF
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                    {ref.documents && ref.documents.length > 0 && (
                                      <div className="md:col-span-2">
                                        <p className="text-gray-500">Attached Document</p>
                                        <p className="text-gray-800">
                                          {ref.documents[0].document.originalFilename}
                                          {ref.documents[0].document.pageCount
                                            ? ` (${ref.documents[0].document.pageCount} pages)`
                                            : ''}
                                          {ref.documents[0].document.sourceType
                                            ? ` - ${ref.documents[0].document.sourceType}`
                                            : ''}
                                        </p>
                                        {ref.documents[0].document.pdfDoi && (
                                          <p className="text-gray-600 font-mono mt-1">
                                            PDF DOI: {ref.documents[0].document.pdfDoi}
                                          </p>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  {ref.tags && ref.tags.length > 0 && (
                                    <div>
                                      <p className="text-xs text-gray-500 mb-1">Tags</p>
                                      <div className="flex flex-wrap gap-1">
                                        {ref.tags.map((tag) => (
                                          <Badge key={tag} variant="outline" className="text-[10px]">
                                            {tag}
                                          </Badge>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {ref.abstract && (
                                    <div>
                                      <p className="text-xs text-gray-500 mb-1">Abstract</p>
                                      <p className="text-xs text-gray-700 whitespace-pre-line leading-relaxed">
                                        {ref.abstract}
                                      </p>
                                    </div>
                                  )}

                                  {ref.notes && (
                                    <div>
                                      <p className="text-xs text-gray-500 mb-1">Notes</p>
                                      <p className="text-xs text-gray-700 whitespace-pre-line leading-relaxed">
                                        {ref.notes}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* PDF Document Status & Actions */}
                              <div className="flex flex-wrap items-center gap-2 mt-2">
                                {ref.documents && ref.documents.length > 0 ? (
                                  <>
                                    {(() => {
                                      const primaryDocument = ref.documents?.[0]?.document;
                                      const mimeType = String(primaryDocument?.mimeType || '').toLowerCase();
                                      const isPdfDocument = mimeType.includes('pdf');
                                      const documentLabel = isPdfDocument ? 'PDF' : 'Text';
                                      return (
                                        <>
                                          <DocumentStatusBadge
                                            status={primaryDocument.status}
                                            errorCode={primaryDocument.errorCode}
                                            filename={primaryDocument.originalFilename}
                                            fileSizeBytes={primaryDocument.fileSizeBytes}
                                            mimeType={primaryDocument.mimeType}
                                            sourceType={primaryDocument.sourceType}
                                          />
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (isPdfDocument) {
                                                handleViewPDF(ref.id);
                                              } else {
                                                handleViewText(ref.id, ref.title);
                                              }
                                            }}
                                            className="text-[11px] text-blue-600 hover:text-blue-800 hover:underline font-medium"
                                            title={isPdfDocument ? 'View PDF' : 'View Text'}
                                          >
                                            {isPdfDocument ? 'View' : 'View Text'}
                                          </button>
                                          <button
                                            onClick={(e) => { e.stopPropagation(); handleReplacePDF(ref.id, ref.title); }}
                                            className="text-[11px] text-gray-500 hover:text-gray-700 hover:underline"
                                            title={`Replace ${documentLabel}`}
                                          >
                                            Replace
                                          </button>
                                          <button
                                            onClick={(e) => { e.stopPropagation(); handleRemovePDF(ref.id); }}
                                            className="text-[11px] text-red-500 hover:text-red-700 hover:underline"
                                            title={`Remove ${documentLabel}`}
                                          >
                                            Remove
                                          </button>
                                        </>
                                      );
                                    })()}
                                  </>
                                ) : (
                                  <>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleAttachPDF(ref.id, ref.title); }}
                                      className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 font-medium px-2 py-0.5 rounded border border-indigo-200 hover:bg-indigo-50 transition-colors"
                                    >
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                      </svg>
                                      Attach PDF
                                    </button>
                                    {ref.doi && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleFetchOAPDF(ref.id, ref.doi); }}
                                        className="inline-flex items-center gap-1 text-[11px] text-emerald-600 hover:text-emerald-800 font-medium px-2 py-0.5 rounded border border-emerald-200 hover:bg-emerald-50 transition-colors"
                                        title="Fetch open access PDF via Unpaywall"
                                      >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                        </svg>
                                        Fetch OA PDF
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => toggleReferenceDetails(ref.id)}
                                className="px-2 py-1 text-[11px] rounded border border-slate-200 text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                                title={expandedRefs.has(ref.id) ? 'Hide details' : 'Show details'}
                              >
                                {expandedRefs.has(ref.id) ? 'Hide details' : 'Details'}
                              </button>
                              <button
                                onClick={() => handleToggleFavorite(ref.id)}
                                className={`p-1.5 rounded-lg transition-colors ${
                                  ref.isFavorite 
                                    ? 'text-amber-500 bg-amber-50' 
                                    : 'text-gray-400 hover:text-amber-500 hover:bg-amber-50'
                                }`}
                              >
                                <svg className="w-4 h-4" fill={ref.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => handleDeleteReference(ref.id)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </>
                ) : (
                  <div className="text-center py-12">
                    <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    <p className="text-gray-500 font-medium">No references found</p>
                    <p className="text-sm text-gray-400 mt-1">
                      {selectedLibrary 
                        ? 'This library is empty. Add references from the main library.'
                        : 'Add your first reference to get started!'
                      }
                    </p>
                  </div>
                )}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-6 pt-4 border-t">
                  <div className="text-sm text-gray-500">
                    Showing {((currentPage - 1) * PAGE_SIZE) + 1} - {Math.min(currentPage * PAGE_SIZE, totalCount)} of {totalCount} references
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
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Create/Edit Library Dialog */}
      <Dialog open={showNewLibrary || !!editingLibrary} onOpenChange={(open) => {
        if (!open) {
          setShowNewLibrary(false);
          setEditingLibrary(null);
          setNewLibraryName('');
          setNewLibraryDesc('');
        }
      }}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>{editingLibrary ? 'Edit Library' : 'Create New Library'}</DialogTitle>
            <DialogDescription>
              {editingLibrary 
                ? 'Update the library details'
                : 'Create a library to organize your references by topic, project, or any way you like'
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Library Name *</label>
              <Input
                value={newLibraryName}
                onChange={e => setNewLibraryName(e.target.value)}
                placeholder="e.g., Machine Learning, Thesis References"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Description</label>
              <Textarea
                value={newLibraryDesc}
                onChange={e => setNewLibraryDesc(e.target.value)}
                placeholder="Optional description..."
                rows={2}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Color</label>
              <div className="flex gap-2 mt-2">
                {LIBRARY_COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setNewLibraryColor(color)}
                    className={`w-8 h-8 rounded-full transition-transform ${
                      newLibraryColor === color ? 'ring-2 ring-offset-2 ring-indigo-500 scale-110' : ''
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => {
                setShowNewLibrary(false);
                setEditingLibrary(null);
              }}>
                Cancel
              </Button>
              <Button 
                onClick={editingLibrary ? handleUpdateLibrary : handleCreateLibrary}
                disabled={!newLibraryName.trim()}
              >
                {editingLibrary ? 'Save Changes' : 'Create Library'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Reference Dialog */}
      <Dialog open={showAddRef} onOpenChange={setShowAddRef}>
        <DialogContent className="bg-white max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Reference</DialogTitle>
            <DialogDescription>
              Add a reference manually, import by DOI, import citations (BibTeX/RIS/JSON), or upload one or more PDFs.
            </DialogDescription>
          </DialogHeader>
          
          <Tabs defaultValue="manual" className="mt-4">
            <TabsList className="grid grid-cols-5">
              <TabsTrigger value="manual">Manual Entry</TabsTrigger>
              <TabsTrigger value="doi">By DOI</TabsTrigger>
              <TabsTrigger value="citationImport">Citation Import</TabsTrigger>
              <TabsTrigger value="pdfUpload">PDF Upload</TabsTrigger>
              <TabsTrigger value="providerImport">Provider Sync</TabsTrigger>
            </TabsList>
            
            <TabsContent value="manual" className="space-y-4 mt-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Title *</label>
                <Input
                  value={addRefForm.title}
                  onChange={e => setAddRefForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="Paper title"
                  className="mt-1"
                />
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Authors (comma-separated)</label>
                  <Input
                    value={addRefForm.authors}
                    onChange={e => setAddRefForm(p => ({ ...p, authors: e.target.value }))}
                    placeholder="John Smith, Jane Doe"
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Year</label>
                  <Input
                    type="number"
                    value={addRefForm.year}
                    onChange={e => setAddRefForm(p => ({ ...p, year: e.target.value }))}
                    placeholder="2024"
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Journal / Conference</label>
                  <Input
                    value={addRefForm.venue}
                    onChange={e => setAddRefForm(p => ({ ...p, venue: e.target.value }))}
                    placeholder="Nature, ICML 2024"
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">DOI</label>
                  <Input
                    value={addRefForm.doi}
                    onChange={e => setAddRefForm(p => ({ ...p, doi: e.target.value }))}
                    placeholder="10.1000/xyz123"
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Abstract</label>
                <Textarea
                  value={addRefForm.abstract}
                  onChange={e => setAddRefForm(p => ({ ...p, abstract: e.target.value }))}
                  placeholder="Paper abstract (optional)"
                  rows={3}
                  className="mt-1"
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setShowAddRef(false)}>Cancel</Button>
                <Button onClick={handleAddReference} disabled={!addRefForm.title.trim()}>
                  Add Reference
                </Button>
              </div>
            </TabsContent>
            
            <TabsContent value="doi" className="mt-4">
              <DOIImportSection 
                authToken={authToken} 
                collectionId={selectedLibrary}
                onImported={() => {
                  setShowAddRef(false);
                  loadReferences();
                  loadLibraries();
                }} 
              />
            </TabsContent>
            
            <TabsContent value="citationImport" className="mt-4">
              <FileImportSection 
                authToken={authToken} 
                collectionId={selectedLibrary}
                onImported={() => {
                  loadReferences();
                  loadLibraries();
                }} 
              />
            </TabsContent>

            <TabsContent value="pdfUpload" className="mt-4">
              <PDFUploadImportSection
                authToken={authToken}
                collectionId={selectedLibrary}
                onImported={() => {
                  loadReferences();
                  loadLibraries();
                }}
              />
            </TabsContent>

            <TabsContent value="providerImport" className="mt-4">
              <ProviderImportSection
                authToken={authToken}
                collectionId={selectedLibrary}
                onImported={() => {
                  loadReferences();
                  loadLibraries();
                }}
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* PDF Upload Dialog */}
      {uploadDialogRef && (
        <DocumentUploadDialog
          open={!!uploadDialogRef}
          onClose={() => setUploadDialogRef(null)}
          referenceId={uploadDialogRef.id}
          referenceTitle={uploadDialogRef.title}
          authToken={authToken}
          onSuccess={() => {
            setUploadDialogRef(null);
            loadReferences(currentPage, false);
          }}
          mode={uploadDialogMode}
        />
      )}
    </div>
  );
}

// DOI Import Component
function DOIImportSection({ 
  authToken, 
  collectionId,
  onImported 
}: { 
  authToken: string | null; 
  collectionId?: string | null;
  onImported: () => void;
}) {
  const [doi, setDoi] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleImport = async () => {
    if (!authToken || !doi.trim()) return;
    try {
      setLoading(true);
      setMessage(null);
      const response = await fetch('/api/library/import-doi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ 
          doi: doi.trim(),
          collectionId: collectionId || undefined,  // Add to collection if one is selected
          autoFetchPdf: true,
        })
      });
      const data = await response.json();
      if (response.ok) {
        const addedTo = collectionId ? ' and added to library' : '';
        let pdfNote = '';
        if (data.oaPdf?.success) {
          pdfNote = ' OA PDF attached.';
        } else if (data.oaPdf?.attempted) {
          pdfNote = ` OA PDF not attached${data.oaPdf?.error ? `: ${data.oaPdf.error}` : '.'}`;
        }
        setMessage({
          type: 'success',
          text: `Imported: ${data.reference?.title || 'Reference'}${addedTo}.${pdfNote}`.trim(),
        });
        setDoi('');
        onImported();
      } else {
        setMessage({ type: 'error', text: data.error || 'Import failed' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Import failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Enter a DOI to fetch citation details from CrossRef and auto-attempt open-access PDF attachment.
        {collectionId && (
          <span className="block mt-1 text-indigo-600 font-medium">
            Will be added to the currently selected library
          </span>
        )}
      </p>
      <div className="flex gap-2">
        <Input
          value={doi}
          onChange={e => setDoi(e.target.value)}
          placeholder="10.1000/xyz123 or https://doi.org/10.1000/xyz123"
          className="flex-1"
        />
        <Button onClick={handleImport} disabled={loading || !doi.trim()}>
          {loading ? 'Importing...' : 'Import'}
        </Button>
      </div>
      {message && (
        <div className={`p-3 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
        }`}>
          {message.text}
        </div>
      )}
    </div>
  );
}

function ReconciliationSummaryPanel({
  reconciliation,
  title = 'Linking summary',
  authToken,
  onUpdated,
}: {
  reconciliation: ReconciliationResult;
  title?: string;
  authToken?: string | null;
  onUpdated?: () => void;
}) {
  const [localResult, setLocalResult] = useState<ReconciliationResult>(reconciliation);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setLocalResult(reconciliation);
    setNotice(null);
  }, [reconciliation]);

  const handleManualLink = async (documentId: string, referenceId: string) => {
    if (!authToken) return;
    const key = `link:${documentId}:${referenceId}`;
    try {
      setBusyKey(key);
      setNotice(null);
      const response = await fetch('/api/library/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          mode: 'link',
          batchId: localResult.batchId,
          documentId,
          referenceId,
          reason: 'Accepted from reconciliation review queue',
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to apply manual link');
      }

      const link = data.link as ReconciliationResult['autoLinked'][number];
      setLocalResult((prev) => ({
        ...prev,
        batchId: typeof data.batchId === 'string' ? data.batchId : prev.batchId,
        autoLinked: [
          ...prev.autoLinked.filter(
            (entry) => !(entry.documentId === link.documentId && entry.referenceId === link.referenceId)
          ),
          link,
        ],
        reviewQueue: prev.reviewQueue.filter((item) => item.documentId !== documentId),
      }));
      setNotice({ type: 'success', text: `Manual link applied for document ${documentId.slice(0, 8)}.` });
      onUpdated?.();
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to apply manual link',
      });
    } finally {
      setBusyKey(null);
    }
  };

  const handleReject = async (documentId: string, referenceId?: string) => {
    if (!authToken) return;
    const key = `reject:${documentId}:${referenceId || 'none'}`;
    try {
      setBusyKey(key);
      setNotice(null);
      const response = await fetch('/api/library/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          mode: 'reject',
          batchId: localResult.batchId,
          documentId,
          referenceId: referenceId || undefined,
          reason: 'Rejected from reconciliation review queue',
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to reject candidate');
      }

      setLocalResult((prev) => ({
        ...prev,
        batchId: typeof data.batchId === 'string' ? data.batchId : prev.batchId,
        reviewQueue: prev.reviewQueue.filter((item) => item.documentId !== documentId),
        unmatchedDocumentIds: Array.from(new Set([...prev.unmatchedDocumentIds, documentId])),
      }));
      setNotice({ type: 'success', text: `Rejected review candidate for document ${documentId.slice(0, 8)}.` });
      onUpdated?.();
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to reject candidate',
      });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 text-sm">
      <p className="font-medium text-indigo-900">{title}</p>
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline" className="bg-white/80 border-indigo-300 text-indigo-800">
          Batch: {localResult.batchId.slice(0, 8)}
        </Badge>
        <Badge variant="outline" className="bg-white/80 border-emerald-300 text-emerald-700">
          Linked: {localResult.autoLinked.length}
        </Badge>
        <Badge variant="outline" className="bg-white/80 border-amber-300 text-amber-700">
          Review: {localResult.reviewQueue.length}
        </Badge>
        <Badge variant="outline" className="bg-white/80 border-slate-300 text-slate-700">
          Unmatched: {localResult.unmatchedDocumentIds.length}
        </Badge>
        {localResult.skippedByHardConflict.length > 0 && (
          <Badge variant="outline" className="bg-white/80 border-red-300 text-red-700">
            Hard conflicts: {localResult.skippedByHardConflict.length}
          </Badge>
        )}
      </div>
      {notice && (
        <div className={`rounded border px-2 py-1 text-xs ${
          notice.type === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {notice.text}
        </div>
      )}
      {localResult.reviewQueue.length > 0 && (
        <div className="rounded border border-amber-200 bg-white p-2 text-xs text-amber-900">
          <p className="font-medium mb-2">Review queue</p>
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {localResult.reviewQueue.slice(0, 5).map((item) => (
              <div key={item.documentId} className="rounded border border-amber-100 bg-amber-50/40 p-2 space-y-1">
                <p className="font-medium text-amber-900">
                  Doc {item.documentId.slice(0, 8)}: {item.reason}
                </p>
                <div className="space-y-1">
                  {item.topCandidates.slice(0, 3).map((candidate) => {
                    const actionKey = `link:${item.documentId}:${candidate.referenceId}`;
                    return (
                      <div
                        key={`${item.documentId}:${candidate.referenceId}`}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <span className="text-amber-900">
                          Ref {candidate.referenceId.slice(0, 8)} score {candidate.score.toFixed(1)} ({candidate.confidence})
                        </span>
                        {authToken && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => handleManualLink(item.documentId, candidate.referenceId)}
                            disabled={busyKey !== null}
                          >
                            {busyKey === actionKey ? 'Linking...' : 'Link'}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {authToken && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px] border-red-200 text-red-700 hover:bg-red-50"
                    onClick={() => handleReject(item.documentId, item.topCandidates[0]?.referenceId)}
                    disabled={busyKey !== null}
                  >
                    {busyKey?.startsWith(`reject:${item.documentId}:`) ? 'Rejecting...' : 'Reject Document'}
                  </Button>
                )}
              </div>
            ))}
            {localResult.reviewQueue.length > 5 && (
              <p>+{localResult.reviewQueue.length - 5} more pending review</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// PDF Upload Import Component (supports multiple files)
function PDFUploadImportSection({
  authToken,
  collectionId,
  onImported
}: {
  authToken: string | null;
  collectionId?: string | null;
  onImported: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    type: 'success' | 'error';
    text: string;
    reconciliation?: ReconciliationResult | null;
  } | null>(null);
  const [selectionMode, setSelectionMode] = useState<'files' | 'folder'>('files');
  const [runReconciliation, setRunReconciliation] = useState(true);
  const [mendeleyAccessToken, setMendeleyAccessToken] = useState('');
  const [zoteroApiKey, setZoteroApiKey] = useState('');
  const [zoteroUserId, setZoteroUserId] = useState('');
  const [zoteroGroupId, setZoteroGroupId] = useState('');
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const handleSelectFromInput = (inputFiles: FileList | null, mode: 'files' | 'folder') => {
    const selected = Array.from(inputFiles || []).filter((file) =>
      file.name.toLowerCase().endsWith('.pdf')
    );
    setSelectionMode(mode);
    setFiles(selected);
    setResult(null);
  };

  const handleUpload = async () => {
    if (!authToken || files.length === 0) return;

    try {
      setLoading(true);
      setResult(null);

      const formData = new FormData();
      files.forEach((file) => formData.append('files', file));
      if (collectionId) {
        formData.append('collectionId', collectionId);
      }
      formData.append('reconcile', String(runReconciliation));
      if (mendeleyAccessToken.trim()) {
        formData.append('mendeleyAccessToken', mendeleyAccessToken.trim());
      }
      if (zoteroApiKey.trim()) {
        formData.append('zoteroApiKey', zoteroApiKey.trim());
      }
      if (zoteroUserId.trim()) {
        formData.append('zoteroUserId', zoteroUserId.trim());
      }
      if (zoteroGroupId.trim()) {
        formData.append('zoteroGroupId', zoteroGroupId.trim());
      }

      const response = await fetch('/api/library/import-pdf', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData,
      });

      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? await response.json()
        : response.status === 413
          ? {
            error:
              'Upload is too large for the server/proxy limit. Reduce file size/count or increase Nginx client_max_body_size.',
          }
          : { error: 'Server returned a non-JSON response.' };

      if (!response.ok && response.status !== 207) {
        setResult({ type: 'error', text: data.error || 'PDF import failed' });
        return;
      }

      const summary = data.summary || { total: files.length, imported: 0, failed: files.length };
      const citationsLinked = Number(summary?.citationsLinked || 0);
      const failedItems = Array.isArray(data.results)
        ? data.results.filter((item: any) => !item.success).slice(0, 3)
        : [];

      const failedText = failedItems.length > 0
        ? ` Failed: ${failedItems.map((item: any) => `${item.fileName} (${item.error || 'error'})`).join('; ')}`
        : '';
      const reconciliation = parseReconciliationResult(data.reconciliation);
      const reconcileText = reconciliation
        ? ` Linked ${reconciliation.autoLinked.length}; review ${reconciliation.reviewQueue.length}.`
        : '';

      setResult({
        type: summary.imported > 0 ? 'success' : 'error',
        text: `Imported ${summary.imported}/${summary.total} PDF file(s).`
          + `${citationsLinked > 0 ? ` Linked ${citationsLinked} citation(s).` : ''}`
          + `${reconcileText}${failedText}`,
        reconciliation,
      });

      if (summary.imported > 0) {
        setFiles([]);
        onImported();
      }
    } catch {
      setResult({ type: 'error', text: 'PDF import failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Upload one or multiple PDF files. We extract metadata, create/update citations, and attach PDFs automatically.
        {collectionId && (
          <span className="block mt-1 text-indigo-600 font-medium">
            Imported references will be added to the currently selected library
          </span>
        )}
      </p>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => filesInputRef.current?.click()}
            disabled={loading}
          >
            Select Files
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => folderInputRef.current?.click()}
            disabled={loading}
          >
            Select Folder
          </Button>
        </div>
        <input
          ref={filesInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => handleSelectFromInput(e.target.files, 'files')}
        />
        <input
          ref={folderInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => handleSelectFromInput(e.target.files, 'folder')}
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        />
        {files.length > 0 && (
          <p className="text-xs text-gray-500">
            Selected {files.length} PDF file(s) from {selectionMode === 'folder' ? 'folder' : 'file picker'}:
            {' '}
            {files
              .slice(0, 3)
              .map((f) => ((f as any).webkitRelativePath && selectionMode === 'folder'
                ? (f as any).webkitRelativePath
                : f.name))
              .join(', ')}
            {files.length > 3 ? ` +${files.length - 3} more` : ''}
          </p>
        )}
      </div>

      <div className="rounded-lg border bg-slate-50 p-3 space-y-3">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <Checkbox
            checked={runReconciliation}
            onCheckedChange={(checked) => setRunReconciliation(Boolean(checked))}
          />
          Run auto-linking after upload
        </label>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Mendeley access token (optional)</label>
            <Input
              type="password"
              value={mendeleyAccessToken}
              onChange={(e) => setMendeleyAccessToken(e.target.value)}
              placeholder="Used to search citation metadata for PDFs"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Zotero API key (optional)</label>
            <Input
              type="password"
              value={zoteroApiKey}
              onChange={(e) => setZoteroApiKey(e.target.value)}
              placeholder="Used to search your Zotero library"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Zotero user ID (optional)</label>
            <Input
              value={zoteroUserId}
              onChange={(e) => setZoteroUserId(e.target.value)}
              placeholder="Required with Zotero key if using user library"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Zotero group ID (optional)</label>
            <Input
              value={zoteroGroupId}
              onChange={(e) => setZoteroGroupId(e.target.value)}
              placeholder="Alternative to user ID"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleUpload} disabled={loading || files.length === 0}>
          {loading ? 'Importing PDFs...' : `Import ${files.length > 0 ? files.length : ''} PDF${files.length === 1 ? '' : 's'}`}
        </Button>
      </div>

      {result && (
        <div className="space-y-2">
          <div className={`p-3 rounded-lg text-sm ${
            result.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}>
            {result.text}
          </div>
          {result.reconciliation && (
            <ReconciliationSummaryPanel
              reconciliation={result.reconciliation}
              title="PDF upload reconciliation"
              authToken={authToken}
              onUpdated={onImported}
            />
          )}
        </div>
      )}
    </div>
  );
}

// File Import Component
function FileImportSection({ 
  authToken, 
  collectionId,
  onImported 
}: { 
  authToken: string | null; 
  collectionId?: string | null;
  onImported: () => void;
}) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    errors: string[];
    addedToLibrary?: boolean;
    reconciliation?: ReconciliationResult | null;
  } | null>(null);
  const [autoReconcile, setAutoReconcile] = useState(true);
  const [dryRunReconcile, setDryRunReconcile] = useState(false);
  const [mendeleyAccessToken, setMendeleyAccessToken] = useState('');
  const [zoteroApiKey, setZoteroApiKey] = useState('');
  const [zoteroUserId, setZoteroUserId] = useState('');
  const [zoteroGroupId, setZoteroGroupId] = useState('');

  const handleImport = async () => {
    if (!authToken || !content.trim()) return;
    try {
      setLoading(true);
      setResult(null);
      const providers: Record<string, string> = {};
      if (mendeleyAccessToken.trim()) providers.mendeleyAccessToken = mendeleyAccessToken.trim();
      if (zoteroApiKey.trim()) providers.zoteroApiKey = zoteroApiKey.trim();
      if (zoteroUserId.trim()) providers.zoteroUserId = zoteroUserId.trim();
      if (zoteroGroupId.trim()) providers.zoteroGroupId = zoteroGroupId.trim();

      const response = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ 
          content: content.trim(),
          collectionId: collectionId || undefined,  // Add to collection if one is selected
          autoReconcile,
          dryRunReconcile,
          providers: Object.keys(providers).length > 0 ? providers : undefined,
        })
      });
      const data = await response.json();
      setResult({ 
        imported: data.imported || 0, 
        errors: data.errors || [],
        addedToLibrary: !!collectionId && data.imported > 0,
        reconciliation: parseReconciliationResult(data.reconciliation),
      });
      if (data.imported > 0) {
        setContent('');
        onImported();
      }
    } catch (err) {
      setResult({ imported: 0, errors: ['Import failed'] });
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setContent(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Paste BibTeX, RIS, or JSON exports from Mendeley/Zotero. Or upload a file.
        {collectionId && (
          <span className="block mt-1 text-indigo-600 font-medium">
            Will be added to the currently selected library
          </span>
        )}
      </p>
      <div className="rounded-lg border bg-slate-50 p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <Checkbox
              checked={autoReconcile}
              onCheckedChange={(checked) => setAutoReconcile(Boolean(checked))}
            />
            Auto-link against uploaded PDFs
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <Checkbox
              checked={dryRunReconcile}
              onCheckedChange={(checked) => setDryRunReconcile(Boolean(checked))}
            />
            Dry run only
          </label>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Mendeley access token (optional)</label>
            <Input
              type="password"
              value={mendeleyAccessToken}
              onChange={(e) => setMendeleyAccessToken(e.target.value)}
              placeholder="Use Mendeley catalog/library as signal source"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Zotero API key (optional)</label>
            <Input
              type="password"
              value={zoteroApiKey}
              onChange={(e) => setZoteroApiKey(e.target.value)}
              placeholder="Use Zotero library as signal source"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Zotero user ID (optional)</label>
            <Input
              value={zoteroUserId}
              onChange={(e) => setZoteroUserId(e.target.value)}
              placeholder="Required with API key for user library"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Zotero group ID (optional)</label>
            <Input
              value={zoteroGroupId}
              onChange={(e) => setZoteroGroupId(e.target.value)}
              placeholder="Alternative to user ID"
            />
          </div>
        </div>
      </div>
      <Textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Paste BibTeX, RIS, or JSON content here..."
        rows={6}
        className="font-mono text-sm"
      />
      <div className="flex items-center justify-between">
        <label className="inline-flex items-center gap-2 text-sm text-indigo-600 cursor-pointer hover:underline">
          <input
            type="file"
            accept=".bib,.bibtex,.ris,.txt,.json"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
            }}
          />
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Upload file
        </label>
        <Button onClick={handleImport} disabled={loading || !content.trim()}>
          {loading ? 'Importing...' : 'Import'}
        </Button>
      </div>
      {result && (
        <div className="space-y-2">
          <div className={`p-3 rounded-lg text-sm ${
            result.imported > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}>
            {result.imported > 0 
              ? `Successfully imported ${result.imported} reference(s)${result.addedToLibrary ? ' and added to library' : ''}`
              : result.errors.join(', ') || 'Import failed'
            }
          </div>
          {result.reconciliation && (
            <ReconciliationSummaryPanel
              reconciliation={result.reconciliation}
              title="Citation import reconciliation"
              authToken={authToken}
              onUpdated={onImported}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface LibraryConnectionInfo {
  provider: 'mendeley' | 'zotero';
  displayName: string | null;
  email: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncMessage: string | null;
  totalImported: number;
  isActive: boolean;
  createdAt: string;
}

function ProviderImportSection({
  authToken,
  collectionId,
  onImported,
}: {
  authToken: string | null;
  collectionId?: string | null;
  onImported: () => void;
}) {
  const [mode, setMode] = useState<'mendeley' | 'zotero' | 'manual'>('mendeley');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [providerResult, setProviderResult] = useState<{
    reconciliation?: ReconciliationResult | null;
    batchId?: string;
  } | null>(null);

  // Connection state
  const [connections, setConnections] = useState<LibraryConnectionInfo[]>([]);
  const [mendeleyConfigured, setMendeleyConfigured] = useState(false);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);

  // Zotero connect form
  const [zoteroApiKey, setZoteroApiKey] = useState('');
  const [zoteroUserId, setZoteroUserId] = useState('');
  const [connectingZotero, setConnectingZotero] = useState(false);

  // Manual reconciliation
  const [autoReconcile, setAutoReconcile] = useState(true);
  const [dryRunReconcile, setDryRunReconcile] = useState(false);
  const [includeLinkedDocs, setIncludeLinkedDocs] = useState(true);
  const [rollbacking, setRollbacking] = useState(false);

  const mendeleyConnection = connections.find((c) => c.provider === 'mendeley');
  const zoteroConnection = connections.find((c) => c.provider === 'zotero');

  const loadConnections = useCallback(async () => {
    if (!authToken) return;
    try {
      const response = await fetch('/api/library/connections', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) {
        console.warn('Failed to load library connections:', response.status);
        // Default to configured=true so users see the connect button
        // rather than a misleading "not configured" admin message
        setMendeleyConfigured(true);
        return;
      }
      const data = await response.json();
      setConnections(data.connections || []);
      setMendeleyConfigured(data.providers?.mendeley?.configured ?? true);
    } catch (err) {
      console.warn('Failed to load library connections:', err);
      setMendeleyConfigured(true);
    } finally {
      setConnectionsLoaded(true);
    }
  }, [authToken]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  // Detect redirect back from Mendeley OAuth
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const error = params.get('error');
    if (connected === 'mendeley') {
      setMessage({ type: 'success', text: 'Mendeley account connected successfully!' });
      setMode('mendeley');
      loadConnections();
      window.history.replaceState({}, '', window.location.pathname);
    } else if (error?.startsWith('mendeley')) {
      const errorMessages: Record<string, string> = {
        mendeley_denied: 'Mendeley authorization was denied.',
        mendeley_missing_params: 'Authorization response was incomplete.',
        mendeley_invalid_state: 'Authorization state was invalid. Please try again.',
        mendeley_callback_failed: 'Mendeley connection failed. Please try again.',
      };
      setMessage({ type: 'error', text: errorMessages[error] || 'Mendeley connection failed.' });
      setMode('mendeley');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [loadConnections]);

  const resetStatus = () => {
    setMessage(null);
    setProviderResult(null);
  };

  const handleSync = async (provider: 'mendeley' | 'zotero') => {
    if (!authToken) return;
    try {
      setSyncing(true);
      resetStatus();
      const response = await fetch('/api/library/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ provider }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage({ type: 'error', text: data.error || `${provider} sync failed` });
        return;
      }
      setMessage({
        type: 'success',
        text: `Synced from ${provider}: ${data.imported || 0} new, ${data.updated || 0} updated, ${data.skipped || 0} skipped.`,
      });
      if ((data.imported || 0) > 0 || (data.updated || 0) > 0) onImported();
      loadConnections();
    } catch {
      setMessage({ type: 'error', text: `${provider} sync failed` });
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async (provider: 'mendeley' | 'zotero') => {
    if (!authToken) return;
    try {
      setLoading(true);
      resetStatus();
      const response = await fetch(`/api/library/oauth/${provider}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setMessage({ type: 'error', text: data.error || 'Disconnect failed' });
        return;
      }
      setMessage({ type: 'success', text: `${provider === 'mendeley' ? 'Mendeley' : 'Zotero'} disconnected.` });
      loadConnections();
    } catch {
      setMessage({ type: 'error', text: 'Disconnect failed' });
    } finally {
      setLoading(false);
    }
  };

  const handleConnectZotero = async () => {
    if (!authToken || !zoteroApiKey.trim() || !zoteroUserId.trim()) return;
    try {
      setConnectingZotero(true);
      resetStatus();
      const response = await fetch('/api/library/oauth/zotero', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ apiKey: zoteroApiKey.trim(), zoteroUserId: zoteroUserId.trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage({ type: 'error', text: data.error || 'Zotero connection failed' });
        return;
      }
      setMessage({ type: 'success', text: 'Zotero account connected successfully!' });
      setZoteroApiKey('');
      setZoteroUserId('');
      loadConnections();
    } catch {
      setMessage({ type: 'error', text: 'Zotero connection failed' });
    } finally {
      setConnectingZotero(false);
    }
  };

  const handleManualReconcile = async () => {
    if (!authToken) return;
    try {
      setLoading(true);
      resetStatus();
      const response = await fetch('/api/library/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          mode: 'run',
          applyAutoLinks: autoReconcile,
          dryRun: dryRunReconcile,
          includeAlreadyLinkedDocuments: includeLinkedDocs,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage({ type: 'error', text: data.error || 'Reconciliation failed' });
        return;
      }
      const reconciliation = parseReconciliationResult(data);
      if (!reconciliation) {
        setMessage({ type: 'error', text: 'Reconciliation response was invalid' });
        return;
      }
      setProviderResult({ reconciliation, batchId: reconciliation.batchId });
      setMessage({
        type: 'success',
        text: `Processed ${reconciliation.evaluatedDocuments} document(s). Auto-linked ${reconciliation.autoLinked.length}.`,
      });
      if (reconciliation.autoLinked.length > 0) onImported();
    } catch {
      setMessage({ type: 'error', text: 'Reconciliation failed' });
    } finally {
      setLoading(false);
    }
  };

  const handleRollback = async () => {
    if (!authToken || !providerResult?.batchId) return;
    try {
      setRollbacking(true);
      const response = await fetch('/api/library/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          mode: 'rollback',
          batchId: providerResult.batchId,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage({ type: 'error', text: data.error || 'Rollback failed' });
        return;
      }
      setMessage({
        type: 'success',
        text: `Rollback complete for batch ${providerResult.batchId.slice(0, 8)}. Reverted ${data.reverted || 0} link(s).`,
      });
      onImported();
    } catch {
      setMessage({ type: 'error', text: 'Rollback failed' });
    } finally {
      setRollbacking(false);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return 'Never';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  const renderConnectionCard = (
    provider: 'mendeley' | 'zotero',
    connection: LibraryConnectionInfo
  ) => (
    <div className="rounded-lg border bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            {connection.displayName || (provider === 'mendeley' ? 'Mendeley' : 'Zotero')}
          </p>
          {connection.email && (
            <p className="text-xs text-slate-500">{connection.email}</p>
          )}
        </div>
        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
          Connected
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
        <div>
          <span className="font-medium">Last sync:</span>{' '}
          {formatDate(connection.lastSyncAt)}
        </div>
        <div>
          <span className="font-medium">Total imported:</span>{' '}
          {connection.totalImported}
        </div>
        {connection.lastSyncStatus && (
          <div>
            <span className="font-medium">Status:</span>{' '}
            <span className={
              connection.lastSyncStatus === 'success' ? 'text-emerald-600' :
              connection.lastSyncStatus === 'failed' ? 'text-red-600' : 'text-amber-600'
            }>
              {connection.lastSyncStatus}
            </span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => handleSync(provider)}
          disabled={syncing || loading}
        >
          {syncing ? 'Syncing...' : 'Sync Now'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-red-600 border-red-200 hover:bg-red-50"
          onClick={() => handleDisconnect(provider)}
          disabled={syncing || loading}
        >
          Disconnect
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Connect your Mendeley or Zotero library to sync references, or run manual reconciliation for already-uploaded PDFs.
        {collectionId && (
          <span className="block mt-1 text-indigo-600 font-medium">
            Imported references are added to the currently selected library
          </span>
        )}
      </p>

      <Tabs value={mode} onValueChange={(value) => {
        setMode(value as 'mendeley' | 'zotero' | 'manual');
        resetStatus();
      }}>
        <TabsList className="grid grid-cols-3">
          <TabsTrigger value="mendeley">Mendeley</TabsTrigger>
          <TabsTrigger value="zotero">Zotero</TabsTrigger>
          <TabsTrigger value="manual">Manual Linking</TabsTrigger>
        </TabsList>

        <TabsContent value="mendeley" className="mt-4 space-y-3">
          {mendeleyConnection ? (
            renderConnectionCard('mendeley', mendeleyConnection)
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-center space-y-3">
              {mendeleyConfigured ? (
                <>
                  <p className="text-sm text-slate-600">
                    Connect your Mendeley account to import and sync your library automatically.
                  </p>
                  <Button
                    onClick={() => {
                      window.location.href = `/api/library/oauth/mendeley?authorization=${authToken}`;
                    }}
                    disabled={loading || !connectionsLoaded}
                  >
                    Connect to Mendeley
                  </Button>
                </>
              ) : (
                <p className="text-sm text-slate-500">
                  Mendeley OAuth is not configured on this server. Ask your administrator to set
                  <code className="mx-1 px-1 py-0.5 bg-slate-100 rounded text-xs">MENDELEY_CLIENT_ID</code>
                  and
                  <code className="mx-1 px-1 py-0.5 bg-slate-100 rounded text-xs">MENDELEY_CLIENT_SECRET</code>
                  environment variables.
                </p>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="zotero" className="mt-4 space-y-3">
          {zoteroConnection ? (
            renderConnectionCard('zotero', zoteroConnection)
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">Connect your Zotero library</p>
                <ol className="text-xs text-slate-600 list-decimal list-inside space-y-1">
                  <li>
                    Go to{' '}
                    <a
                      href="https://www.zotero.org/settings/keys/new"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 underline hover:text-indigo-800"
                    >
                      zotero.org/settings/keys
                    </a>{' '}
                    and create a new private key with library read access
                  </li>
                  <li>
                    Find your numeric User ID on your{' '}
                    <a
                      href="https://www.zotero.org/settings/keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 underline hover:text-indigo-800"
                    >
                      Zotero settings page
                    </a>{' '}
                    (shown as &quot;Your userID for use in API calls is ...&quot;)
                  </li>
                  <li>Paste both values below and click Connect</li>
                </ol>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-gray-700">API Key</label>
                  <Input
                    type="password"
                    value={zoteroApiKey}
                    onChange={(e) => setZoteroApiKey(e.target.value)}
                    placeholder="Paste your Zotero API key"
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">User ID</label>
                  <Input
                    value={zoteroUserId}
                    onChange={(e) => setZoteroUserId(e.target.value)}
                    placeholder="Your numeric Zotero user ID"
                    className="mt-1"
                  />
                </div>
                <Button
                  onClick={handleConnectZotero}
                  disabled={connectingZotero || !zoteroApiKey.trim() || !zoteroUserId.trim()}
                >
                  {connectingZotero ? 'Connecting...' : 'Connect Zotero'}
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="manual" className="mt-4 space-y-3">
          <p className="text-xs text-slate-600">
            Runs constrained assignment across existing references and uploaded documents.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <Checkbox
                checked={autoReconcile}
                onCheckedChange={(checked) => setAutoReconcile(Boolean(checked))}
              />
              Apply auto-links
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <Checkbox
                checked={dryRunReconcile}
                onCheckedChange={(checked) => setDryRunReconcile(Boolean(checked))}
              />
              Dry run
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <Checkbox
                checked={includeLinkedDocs}
                onCheckedChange={(checked) => setIncludeLinkedDocs(Boolean(checked))}
              />
              Include already linked docs
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleManualReconcile} disabled={loading}>
              {loading ? 'Running...' : 'Run Reconciliation'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleRollback}
              disabled={rollbacking || !providerResult?.batchId}
            >
              {rollbacking ? 'Rolling back...' : 'Rollback Last Batch'}
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {message && (
        <div className={`p-3 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
        }`}>
          {message.text}
        </div>
      )}

      {providerResult?.reconciliation && (
        <ReconciliationSummaryPanel
          reconciliation={providerResult.reconciliation}
          title="Provider reconciliation"
          authToken={authToken}
          onUpdated={onImported}
        />
      )}
    </div>
  );
}
