/**
 * API Route: Panel Citations
 * Fetches paper session citations and user's reference library for the floating panel
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT, type JWTPayload } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  buildCitationKeyLookup,
  citationKeyIdentity,
  normalizeCitationKey,
  resolveCitationKeyFromLookup,
  splitCitationKeyList
} from '@/lib/utils/citation-key-normalization';

// ============================================================================
// Types
// ============================================================================

interface CitationItem {
  id: string;
  title: string;
  authors: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
  citationKey: string;
  source: 'paper' | 'library';
  sourceType: string;
  usageCount?: number;
  abstract?: string | null;
}

function normalizeCitationSearchTerm(input: string): string {
  const value = String(input || '').trim();
  if (!value) return '';
  return value
    .replace(/^\[\s*CITE\s*:/i, '')
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .trim();
}

function splitCitationKeys(rawKeys: string): string[] {
  return splitCitationKeyList(rawKeys);
}

function normalizeCitationMarkupForExtraction(content: string): string {
  const raw = String(content || '');
  if (!raw) return '';

  const decoded = raw
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');

  return decoded.replace(
    /<span\b[^>]*data-cite-key=(?:"([^"]+)"|'([^']+)')[^>]*>[\s\S]*?<\/span>/gi,
    (_full, keyA, keyB) => {
      const citationKey = String(keyA || keyB || '').trim();
      return citationKey ? `[CITE:${citationKey}]` : _full;
    }
  );
}

function normalizeExtraSections(value: unknown): Record<string, string> {
  const normalize = (sections: Record<string, unknown>): Record<string, string> => {
    const normalized: Record<string, string> = {};
    for (const [key, sectionValue] of Object.entries(sections)) {
      if (typeof sectionValue === 'string') {
        normalized[key] = sectionValue;
      }
    }
    return normalized;
  };

  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? normalize(parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return normalize(value as Record<string, unknown>);
  }
  return {};
}

async function buildUsageCountByCitationKey(sessionId: string, citationKeys: string[]): Promise<Record<string, number>> {
  if (citationKeys.length === 0) return {};

  const canonicalLookup = buildCitationKeyLookup(citationKeys);

  const usageCountByKey: Record<string, number> = {};
  for (const rawKey of citationKeys) {
    const canonical = resolveCitationKeyFromLookup(rawKey, canonicalLookup) || normalizeCitationKey(rawKey);
    if (!canonical) continue;
    usageCountByKey[citationKeyIdentity(canonical)] = 0;
  }
  canonicalLookup.forEach((canonical) => {
    if (canonical) {
      const identity = citationKeyIdentity(canonical);
      usageCountByKey[identity] = usageCountByKey[identity] || 0;
    }
  });

  const latestPaperDraft = await prisma.annexureDraft.findFirst({
    where: {
      sessionId,
      jurisdiction: 'PAPER'
    },
    orderBy: { version: 'desc' },
    select: { extraSections: true }
  });

  const latestAnyDraft = latestPaperDraft
    ? null
    : await prisma.annexureDraft.findFirst({
        where: { sessionId },
        orderBy: { updatedAt: 'desc' },
        select: { extraSections: true }
      });

  const extraSections = normalizeExtraSections(latestPaperDraft?.extraSections ?? latestAnyDraft?.extraSections);
  const markerRegex = /\[CITE:([^\]]+)\]/gi;
  const bareMarkerRegex = /\[([^\[\]]+)\]/g;

  for (const rawContent of Object.values(extraSections)) {
    const content = normalizeCitationMarkupForExtraction(rawContent || '');
    if (!content.trim()) continue;

    markerRegex.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = markerRegex.exec(content)) !== null) {
      const keys = splitCitationKeys(String(match[1] || ''));
      for (const rawKey of keys) {
        const canonical = resolveCitationKeyFromLookup(rawKey, canonicalLookup);
        if (!canonical) continue;
        const identity = citationKeyIdentity(canonical);
        usageCountByKey[identity] = (usageCountByKey[identity] || 0) + 1;
      }
    }

    bareMarkerRegex.lastIndex = 0;
    while ((match = bareMarkerRegex.exec(content)) !== null) {
      const token = String(match[1] || '').trim();
      if (!token || /^CITE:/i.test(token) || /^Figure\s+\d+/i.test(token)) continue;
      const keys = splitCitationKeys(token);
      for (const rawKey of keys) {
        const canonical = resolveCitationKeyFromLookup(rawKey, canonicalLookup);
        if (!canonical) continue;
        const identity = citationKeyIdentity(canonical);
        usageCountByKey[identity] = (usageCountByKey[identity] || 0) + 1;
      }
    }
  }

  return usageCountByKey;
}

// ============================================================================
// GET - Fetch citations for the panel
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> }
) {
  try {
    // Authenticate
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const token = authHeader.slice(7);
    const decoded = await verifyJWT(token) as JWTPayload | null;
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }
    
    const { paperId: sessionId } = await params;
    const userId = decoded.sub;

    // Get search query if provided
    const url = new URL(request.url);
    const rawSearchQuery = url.searchParams.get('q') || '';
    const searchQuery = normalizeCitationSearchTerm(rawSearchQuery);
    const sourceFilter = url.searchParams.get('source') || 'all'; // 'all', 'paper', 'library'
    // Library limit - paper citations are never truncated (user's working set)
    const libraryLimit = parseInt(url.searchParams.get('limit') || '50', 10);

    // Build search condition
    const searchCondition = searchQuery
      ? {
          OR: [
            { title: { contains: searchQuery, mode: 'insensitive' as const } },
            { venue: { contains: searchQuery, mode: 'insensitive' as const } },
            { citationKey: { contains: searchQuery, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const results: CitationItem[] = [];
    let usageByKey: Record<string, number> = {};

    // Fetch ALL paper citations (from session) - never truncate the user's working set
    if (sourceFilter === 'all' || sourceFilter === 'paper') {
      const allPaperCitationKeys = await prisma.citation.findMany({
        where: {
          sessionId,
          isActive: true
        },
        select: {
          citationKey: true
        }
      });

      const usageCountByCitationKey = await buildUsageCountByCitationKey(
        sessionId,
        allPaperCitationKeys.map((citation) => citation.citationKey)
      );
      usageByKey = usageCountByCitationKey;

      const paperCitations = await prisma.citation.findMany({
        where: {
          sessionId,
          isActive: true,
          ...searchCondition,
        },
        orderBy: { createdAt: 'desc' },
        // No take limit for paper citations - return all of them
      });

      for (const c of paperCitations) {
        const usageCount = usageCountByCitationKey[citationKeyIdentity(String(c.citationKey || ''))] || 0;
        results.push({
          id: c.id,
          title: c.title,
          authors: c.authors.join(', '),
          year: c.year,
          venue: c.venue,
          doi: c.doi,
          citationKey: c.citationKey,
          source: 'paper',
          sourceType: c.sourceType,
          usageCount,
          abstract: c.abstract,
        });
      }
    }

    // Fetch user's reference library (limited to avoid large payloads)
    if (sourceFilter === 'all' || sourceFilter === 'library') {
      const libraryRefs = await prisma.referenceLibrary.findMany({
        where: {
          userId,
          isActive: true,
          ...searchCondition,
        },
        orderBy: [
          { isFavorite: 'desc' },
          { createdAt: 'desc' },
        ],
        take: libraryLimit,
      });

      for (const r of libraryRefs) {
        // Skip if this reference is already in paper citations (by DOI or title)
        const alreadyInPaper = results.some(
          (c) => 
            (c.doi && r.doi && c.doi === r.doi) ||
            c.title.toLowerCase() === r.title.toLowerCase()
        );
        
        if (!alreadyInPaper) {
          results.push({
            id: r.id,
            title: r.title,
            authors: r.authors.join(', '),
            year: r.year,
            venue: r.venue,
            doi: r.doi,
            citationKey: r.citationKey || `${r.authors[0]?.split(' ').pop() || 'Unknown'}${r.year || ''}`,
            source: 'library',
            sourceType: r.sourceType,
          });
        }
      }
    }

    // Get total counts
    const [paperCount, libraryCount] = await Promise.all([
      prisma.citation.count({ where: { sessionId, isActive: true } }),
      prisma.referenceLibrary.count({ where: { userId, isActive: true } }),
    ]);

    return NextResponse.json({
      citations: results,
      counts: {
        paper: paperCount,
        library: libraryCount,
        total: paperCount + libraryCount,
      },
      usageByKey,
    });
  } catch (error) {
    console.error('Failed to fetch panel citations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch citations' },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - Import citation from library to paper
// ============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> }
) {
  try {
    // Authenticate
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const token = authHeader.slice(7);
    const decoded = await verifyJWT(token) as JWTPayload | null;
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }
    
    const { paperId: sessionId } = await params;
    const userId = decoded.sub;

    const body = await request.json();
    const { referenceId } = body;

    if (!referenceId) {
      return NextResponse.json({ error: 'Reference ID required' }, { status: 400 });
    }

    // Fetch the reference from library
    const reference = await prisma.referenceLibrary.findUnique({
      where: { id: referenceId },
    });

    if (!reference || reference.userId !== userId) {
      return NextResponse.json({ error: 'Reference not found' }, { status: 404 });
    }

    // Check if already imported (by DOI or title)
    const existing = await prisma.citation.findFirst({
      where: {
        sessionId,
        OR: [
          ...(reference.doi ? [{ doi: reference.doi }] : []),
          { title: reference.title },
        ],
      },
    });

    if (existing) {
      return NextResponse.json({
        citation: {
          id: existing.id,
          title: existing.title,
          authors: existing.authors.join(', '),
          year: existing.year,
          venue: existing.venue,
          doi: existing.doi,
          citationKey: existing.citationKey,
          source: 'paper',
          sourceType: existing.sourceType,
        },
        imported: false,
        message: 'Citation already exists in paper',
      });
    }

    // Generate unique citation key
    const authorLastName = reference.authors[0]?.split(' ').pop() || 'Unknown';
    let baseCitationKey = `${authorLastName}${reference.year || ''}`;
    let citationKey = baseCitationKey;
    let suffix = 'a';
    
    while (await prisma.citation.findFirst({ where: { sessionId, citationKey } })) {
      citationKey = `${baseCitationKey}${suffix}`;
      suffix = String.fromCharCode(suffix.charCodeAt(0) + 1);
    }

    // Create citation from reference
    const newCitation = await prisma.citation.create({
      data: {
        sessionId,
        sourceType: reference.sourceType,
        title: reference.title,
        authors: reference.authors,
        year: reference.year,
        venue: reference.venue,
        volume: reference.volume,
        issue: reference.issue,
        pages: reference.pages,
        doi: reference.doi,
        url: reference.url,
        isbn: reference.isbn,
        publisher: reference.publisher,
        edition: reference.edition,
        editors: reference.editors,
        publicationPlace: reference.publicationPlace,
        publicationDate: reference.publicationDate,
        accessedDate: reference.accessedDate,
        articleNumber: reference.articleNumber,
        issn: reference.issn,
        journalAbbreviation: reference.journalAbbreviation,
        pmid: reference.pmid,
        pmcid: reference.pmcid,
        arxivId: reference.arxivId,
        abstract: reference.abstract,
        citationKey,
        bibtex: reference.bibtex,
        importSource: 'MANUAL',
        notes: reference.notes,
        tags: reference.tags,
        isActive: true,
      },
    });

    return NextResponse.json({
      citation: {
        id: newCitation.id,
        title: newCitation.title,
        authors: newCitation.authors.join(', '),
        year: newCitation.year,
        venue: newCitation.venue,
        doi: newCitation.doi,
        citationKey: newCitation.citationKey,
        source: 'paper' as const,
        sourceType: newCitation.sourceType,
      },
      imported: true,
      message: 'Citation imported successfully',
    });
  } catch (error) {
    console.error('Failed to import citation:', error);
    return NextResponse.json(
      { error: 'Failed to import citation' },
      { status: 500 }
    );
  }
}
