import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { citationService } from '@/lib/services/citation-service';
import { citationStyleService, type CitationData } from '@/lib/services/citation-style-service';
import { citationMappingService, type CitationMetaSnapshot, type PaperBlueprintMapping } from '@/lib/services/citation-mapping-service';
import { paperLibraryService } from '@/lib/services/paper-library-service';
import { normalizeDoi as normalizeDoiValue } from '@/lib/utils/reference-matching-normalization';
import {
  buildCitationKeyLookup,
  citationKeyIdentity,
  resolveCitationKeyFromLookup,
  splitCitationKeyList
} from '@/lib/utils/citation-key-normalization';

export const runtime = 'nodejs';

const manualCitationSchema = z.object({
  sourceType: z.enum([
    'JOURNAL_ARTICLE',
    'CONFERENCE_PAPER',
    'BOOK',
    'BOOK_CHAPTER',
    'THESIS',
    'WORKING_PAPER',
    'REPORT',
    'WEBSITE',
    'PATENT',
    'OTHER'
  ]),
  title: z.string().min(1),
  authors: z.array(z.string().min(1)).min(1),
  year: z.number().int().optional(),
  venue: z.string().optional(),
  volume: z.string().optional(),
  issue: z.string().optional(),
  pages: z.string().optional(),
  doi: z.string().optional(),
  url: z.string().optional(),
  isbn: z.string().optional(),
  publisher: z.string().optional(),
  edition: z.string().optional(),
  editors: z.array(z.string().min(1)).optional(),
  publicationPlace: z.string().optional(),
  publicationDate: z.string().optional(),
  accessedDate: z.string().optional(),
  articleNumber: z.string().optional(),
  issn: z.string().optional(),
  journalAbbreviation: z.string().optional(),
  pmid: z.string().optional(),
  pmcid: z.string().optional(),
  arxivId: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional()
});

// Schema for AI-generated citation metadata
const citationMetaSchema = z.object({
  keyContribution: z.string().optional(),
  keyFindings: z.string().optional(),
  methodologicalApproach: z.string().nullable().optional(),
  relevanceToResearch: z.string().optional(),
  limitationsOrGaps: z.string().nullable().optional(),
  claimTypesSupported: z.array(z.string()).optional(),
  evidenceBoundary: z.string().nullable().optional(),
  positionalRelation: z.object({
    relation: z.string().optional(),
    rationale: z.string().optional()
  }).optional(),
  referenceArchetype: z.string().nullable().optional(),
  archetypeSignal: z.string().nullable().optional(),
  usage: z.object({
    introduction: z.boolean().optional(),
    literatureReview: z.boolean().optional(),
    methodology: z.boolean().optional(),
    comparison: z.boolean().optional()
  }).optional(),
  relevanceScore: z.number().optional(),
  analyzedAt: z.string().optional()
}).optional().nullable();

const createCitationSchema = z.object({
  citation: manualCitationSchema.optional(),
  searchResult: z.any().optional(),
  citationMeta: citationMetaSchema // AI-generated metadata for section generation
});

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: {
      citationStyle: true,
      paperType: true
    }
  });
}

function toCitationData(citation: any): CitationData {
  return {
    id: citation.id,
    title: citation.title,
    authors: citation.authors,
    year: citation.year || undefined,
    venue: citation.venue || undefined,
    volume: citation.volume || undefined,
    issue: citation.issue || undefined,
    pages: citation.pages || undefined,
    doi: citation.doi || undefined,
    url: citation.url || undefined,
    isbn: citation.isbn || undefined,
    publisher: citation.publisher || undefined,
    edition: citation.edition || undefined,
    sourceType: citation.sourceType || undefined,
    editors: Array.isArray(citation.editors) ? citation.editors : undefined,
    publicationPlace: citation.publicationPlace || undefined,
    publicationDate: citation.publicationDate || undefined,
    accessedDate: citation.accessedDate || undefined,
    articleNumber: citation.articleNumber || undefined,
    issn: citation.issn || undefined,
    journalAbbreviation: citation.journalAbbreviation || undefined,
    pmid: citation.pmid || undefined,
    pmcid: citation.pmcid || undefined,
    arxivId: citation.arxivId || undefined,
    citationKey: citation.citationKey
  };
}

function getDefaultStyleCode(session: any): string {
  return session?.citationStyle?.code
    || process.env.DEFAULT_CITATION_STYLE
    || 'APA7';
}

const NUMERIC_ORDER_STYLES = new Set(['IEEE', 'VANCOUVER']);
const CITE_MARKER_REGEX = /\[CITE:([^\]]+)\]/gi;
const LEGACY_CITATION_SPAN_REGEX = /<span\b[^>]*data-cite-key=(?:"([^"]+)"|'([^']+)')[^>]*>[\s\S]*?<\/span>/gi;

type CitationStyleMeta = {
  styleCode: string;
  sortOrder: 'alphabetical' | 'order_of_appearance';
  isNumericStyle: boolean;
  orderedCitationKeys: string[];
  numberingByKey: Record<string, number>;
};

function splitCitationKeys(rawKeys: string): string[] {
  return splitCitationKeyList(rawKeys);
}

function normalizeCitationMarkupForExtraction(content: string): string {
  const raw = String(content || '');
  if (!raw) return '';

  const replaceLegacySpans = (value: string): string => value.replace(
    LEGACY_CITATION_SPAN_REGEX,
    (_full, keyA, keyB) => {
      const citationKey = String(keyA || keyB || '').trim();
      return citationKey ? `[CITE:${citationKey}]` : _full;
    }
  );

  const decoded = raw
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');

  return replaceLegacySpans(replaceLegacySpans(decoded));
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

function buildCanonicalCitationLookup(citations: Array<{ citationKey: string }>): Map<string, string> {
  return buildCitationKeyLookup(citations.map(citation => citation.citationKey));
}

function mergeSectionOrder(preferredOrder: string[], extraSections: Record<string, string>): string[] {
  const actualByLower = new Map<string, string>();
  for (const key of Object.keys(extraSections)) {
    const normalized = key.trim().toLowerCase();
    if (normalized && !actualByLower.has(normalized)) {
      actualByLower.set(normalized, key);
    }
  }

  const seen = new Set<string>();
  const ordered: string[] = [];
  const append = (sectionKey: string) => {
    const normalized = String(sectionKey || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    ordered.push(actualByLower.get(normalized) || sectionKey);
  };

  for (const key of preferredOrder) append(key);
  for (const key of Object.keys(extraSections)) append(key);
  return ordered;
}

function extractOrderedCitationKeysFromSections(
  extraSections: Record<string, string>,
  orderedSections: string[],
  canonicalLookup: Map<string, string>
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const sectionKey of orderedSections) {
    const content = normalizeCitationMarkupForExtraction(extraSections[sectionKey] || '');
    if (!content.trim()) continue;

    CITE_MARKER_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = CITE_MARKER_REGEX.exec(content)) !== null) {
      const keys = splitCitationKeys(match[1] || '');
      for (const key of keys) {
        const canonical = resolveCitationKeyFromLookup(key, canonicalLookup);
        if (!canonical || seen.has(canonical)) continue;
        seen.add(canonical);
        ordered.push(canonical);
      }
    }

    const bareMarkerRegex = /\[([^\[\]]+)\]/g;
    bareMarkerRegex.lastIndex = 0;
    while ((match = bareMarkerRegex.exec(content)) !== null) {
      const token = String(match[1] || '').trim();
      if (!token || /^CITE:/i.test(token) || /^Figure\s+\d+/i.test(token)) continue;
      const keys = splitCitationKeys(token);
      for (const key of keys) {
        const canonical = resolveCitationKeyFromLookup(key, canonicalLookup);
        if (!canonical || seen.has(canonical)) continue;
        seen.add(canonical);
        ordered.push(canonical);
      }
    }
  }

  return ordered;
}

function mergeCitationOrder(primaryOrder: string[], fallbackOrder: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  const append = (citationKey: string) => {
    const key = String(citationKey || '').trim();
    const normalized = citationKeyIdentity(key);
    if (!key || !normalized || seen.has(normalized)) return;
    seen.add(normalized);
    merged.push(key);
  };

  for (const key of primaryOrder) append(key);
  for (const key of fallbackOrder) append(key);

  return merged;
}

function buildCitationNumberingMap(orderedCitationKeys: string[]): Record<string, number> {
  return Object.fromEntries(
    orderedCitationKeys.map((citationKey, index) => [citationKey, index + 1])
  );
}

async function buildCitationStyleMeta(params: {
  sessionId: string;
  styleCode: string;
  sectionOrder: string[];
  citations: Array<{ citationKey: string }>;
}): Promise<CitationStyleMeta> {
  const normalizedStyleCode = String(params.styleCode || '').trim().toUpperCase();
  const isNumericStyle = NUMERIC_ORDER_STYLES.has(normalizedStyleCode);

  if (!isNumericStyle) {
    return {
      styleCode: normalizedStyleCode,
      sortOrder: 'alphabetical',
      isNumericStyle: false,
      orderedCitationKeys: [],
      numberingByKey: {}
    };
  }

  const draft = await prisma.annexureDraft.findFirst({
    where: {
      sessionId: params.sessionId,
      jurisdiction: 'PAPER'
    },
    orderBy: { version: 'desc' },
    select: { extraSections: true }
  });

  const extraSections = normalizeExtraSections(draft?.extraSections);
  const canonicalLookup = buildCanonicalCitationLookup(params.citations);
  const orderedSections = mergeSectionOrder(params.sectionOrder, extraSections);
  const orderedFromDraft = extractOrderedCitationKeysFromSections(
    extraSections,
    orderedSections,
    canonicalLookup
  );
  const fallbackOrder = params.citations.map((citation) => citation.citationKey);
  const orderedCitationKeys = mergeCitationOrder(orderedFromDraft, fallbackOrder);

  return {
    styleCode: normalizedStyleCode,
    sortOrder: 'order_of_appearance',
    isNumericStyle: true,
    orderedCitationKeys,
    numberingByKey: buildCitationNumberingMap(orderedCitationKeys)
  };
}

async function buildCitationPreview(
  citation: any,
  styleCode: string,
  styleMeta: CitationStyleMeta
): Promise<{ inText: string; bibliography: string }> {
  const citationData = toCitationData(citation);
  const mappedNumber = Number(styleMeta.numberingByKey[citation.citationKey]);
  const citationNumber = Number.isFinite(mappedNumber) && mappedNumber > 0
    ? Math.trunc(mappedNumber)
    : undefined;

  let inText = '';
  let bibliography = '';

  try {
    inText = await citationStyleService.formatInTextCitation(citationData, styleCode, {
      citationNumber,
      citationNumbering: styleMeta.numberingByKey
    });

    const bibliographyEntry = await citationStyleService.formatBibliographyEntry(citationData, styleCode);
    if (styleMeta.isNumericStyle) {
      const resolvedNumber = citationNumber || 1;
      bibliography = styleMeta.styleCode === 'VANCOUVER'
        ? `${resolvedNumber}. ${bibliographyEntry}`
        : `[${resolvedNumber}] ${bibliographyEntry}`;
    } else {
      bibliography = bibliographyEntry;
    }
  } catch (formatError) {
    console.warn('[Citations] Format preview failed:', formatError);
  }

  return { inText, bibliography };
}

function normalizeDoi(doi?: string | null): string {
  return normalizeDoiValue(doi) || '';
}

function normalizeTitleFingerprint(title?: string | null): string {
  return typeof title === 'string'
    ? title.trim().toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

function normalizeAuthor(author?: string | null): string {
  return typeof author === 'string'
    ? author.trim().toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

function normalizeProvider(provider?: string | null): string {
  return typeof provider === 'string'
    ? provider.trim().toLowerCase().replace(/\s+/g, '_')
    : '';
}

function buildPaperIdentityKey(input: {
  doi?: string | null;
  title?: string | null;
  year?: number | null;
  firstAuthor?: string | null;
}): string | undefined {
  const doi = normalizeDoi(input.doi);
  if (doi) {
    return `doi:${doi}`;
  }
  const titleFingerprint = normalizeTitleFingerprint(input.title);
  if (!titleFingerprint) {
    return undefined;
  }
  const yearPart = input.year ? String(input.year) : 'na';
  const authorPart = normalizeAuthor(input.firstAuthor) || 'na';
  return `tfp:${titleFingerprint}|y:${yearPart}|fa:${authorPart}`;
}

function toCitationMetaSnapshot(raw: any, fallbackRelevanceScore?: number): CitationMetaSnapshot | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const positionalRelationSet = new Set([
    'REINFORCES',
    'CONTRADICTS',
    'EXTENDS',
    'QUALIFIES',
    'TENSION'
  ]);
  const result: CitationMetaSnapshot = {};
  if (typeof raw.keyContribution === 'string' && raw.keyContribution.trim()) {
    result.keyContribution = raw.keyContribution.trim().slice(0, 400);
  }
  if (typeof raw.keyFindings === 'string' && raw.keyFindings.trim()) {
    result.keyFindings = raw.keyFindings.trim().slice(0, 400);
  }
  if (typeof raw.methodologicalApproach === 'string') {
    const value = raw.methodologicalApproach.trim();
    result.methodologicalApproach = value ? value.slice(0, 400) : null;
  } else if (raw.methodologicalApproach === null) {
    result.methodologicalApproach = null;
  }
  if (typeof raw.relevanceToResearch === 'string' && raw.relevanceToResearch.trim()) {
    result.relevanceToResearch = raw.relevanceToResearch.trim().slice(0, 500);
  }
  if (typeof raw.limitationsOrGaps === 'string') {
    const value = raw.limitationsOrGaps.trim();
    result.limitationsOrGaps = value ? value.slice(0, 500) : null;
  } else if (raw.limitationsOrGaps === null) {
    result.limitationsOrGaps = null;
  }
  if (raw.usage && typeof raw.usage === 'object') {
    result.usage = {
      introduction: Boolean(raw.usage.introduction),
      literatureReview: Boolean(raw.usage.literatureReview),
      methodology: Boolean(raw.usage.methodology),
      comparison: Boolean(raw.usage.comparison)
    };
  }
  if (raw.positionalRelation && typeof raw.positionalRelation === 'object') {
    const relationCandidate = typeof raw.positionalRelation.relation === 'string'
      ? raw.positionalRelation.relation.trim().toUpperCase()
      : '';
    const rationaleCandidate = typeof raw.positionalRelation.rationale === 'string'
      ? raw.positionalRelation.rationale.trim().slice(0, 300)
      : '';
    if (positionalRelationSet.has(relationCandidate) || rationaleCandidate) {
      result.positionalRelation = {
        relation: positionalRelationSet.has(relationCandidate)
          ? relationCandidate as NonNullable<CitationMetaSnapshot['positionalRelation']>['relation']
          : undefined,
        rationale: rationaleCandidate || undefined
      };
    }
  }
  const relevanceScore = Number(raw.relevanceScore ?? fallbackRelevanceScore);
  if (Number.isFinite(relevanceScore)) {
    result.relevanceScore = Math.max(0, Math.min(100, relevanceScore));
  }
  result.analyzedAt = new Date().toISOString();

  return Object.keys(result).length > 0 ? result : undefined;
}

function buildMappingsForCitation(
  citation: { id: string; citationKey: string },
  suggestion: any
): PaperBlueprintMapping[] {
  const citationMeta = toCitationMetaSnapshot(suggestion.citationMeta, Number(suggestion.relevanceScore));
  const rawMappings = Array.isArray(suggestion.dimensionMappings) ? suggestion.dimensionMappings : [];
  if (rawMappings.length === 0) {
    return [{
      paperId: citation.id,
      citationKey: citation.citationKey,
      sectionKey: null,
      dimensionMappings: [],
      mappingStatus: 'UNMAPPED',
      citationMeta
    }];
  }

  const bySection = new Map<string, Array<{
    dimension: string;
    remark: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  }>>();

  for (const raw of rawMappings) {
    const sectionKey = typeof raw?.sectionKey === 'string' ? raw.sectionKey.trim() : '';
    const dimension = typeof raw?.dimension === 'string' ? raw.dimension.trim() : '';
    if (!sectionKey || !dimension) {
      continue;
    }
    const remark = typeof raw?.remark === 'string' && raw.remark.trim()
      ? raw.remark.trim().slice(0, 500)
      : 'No remark provided';
    const confidence = raw?.confidence === 'HIGH' || raw?.confidence === 'MEDIUM' || raw?.confidence === 'LOW'
      ? raw.confidence
      : 'MEDIUM';

    if (!bySection.has(sectionKey)) {
      bySection.set(sectionKey, []);
    }
    bySection.get(sectionKey)!.push({ dimension, remark, confidence });
  }

  if (bySection.size === 0) {
    return [{
      paperId: citation.id,
      citationKey: citation.citationKey,
      sectionKey: null,
      dimensionMappings: [],
      mappingStatus: 'UNMAPPED',
      citationMeta
    }];
  }

  const mappings: PaperBlueprintMapping[] = [];
  for (const [sectionKey, dims] of Array.from(bySection.entries())) {
    const highMedium = dims.filter((d: { confidence: 'HIGH' | 'MEDIUM' | 'LOW' }) => d.confidence === 'HIGH' || d.confidence === 'MEDIUM').length;
    const mappingStatus: PaperBlueprintMapping['mappingStatus'] = highMedium >= 2
      ? 'MAPPED'
      : highMedium >= 1
        ? 'WEAK'
        : dims.length > 0
          ? 'WEAK'
          : 'UNMAPPED';

    mappings.push({
      paperId: citation.id,
      citationKey: citation.citationKey,
      sectionKey,
      dimensionMappings: dims,
      mappingStatus,
      citationMeta
    });
  }

  return mappings;
}

async function hydrateCitationMappingsFromAnalysis(
  sessionId: string,
  citation: {
    id: string;
    citationKey: string;
    doi?: string | null;
    year?: number | null;
    title?: string | null;
    authors?: string[] | null;
    doiNormalized?: string | null;
    paperIdentityKey?: string | null;
  },
  searchResult: any
): Promise<void> {
  const providerPaperId = typeof searchResult?.id === 'string' ? searchResult.id : '';
  const provider = normalizeProvider(searchResult?.source);
  const normalizedDoi = normalizeDoi(searchResult?.doi || citation.doi || citation.doiNormalized || '');
  const identityKey = buildPaperIdentityKey({
    doi: searchResult?.doi || citation.doi,
    title: searchResult?.title || citation.title,
    year: searchResult?.year || citation.year,
    firstAuthor: Array.isArray(searchResult?.authors) && searchResult.authors.length > 0
      ? searchResult.authors[0]
      : Array.isArray(citation.authors) && citation.authors.length > 0
        ? citation.authors[0]
        : undefined
  }) || citation.paperIdentityKey || undefined;
  const titleFingerprint = normalizeTitleFingerprint(searchResult?.title || citation.title || '');

  const searchRuns = await prisma.literatureSearchRun.findMany({
    where: { sessionId },
    orderBy: [
      { aiAnalyzedAt: 'desc' },
      { createdAt: 'desc' }
    ],
    take: 30,
    select: {
      id: true,
      aiAnalysis: true
    }
  });

  let matchedSuggestion: any = null;
  for (const run of searchRuns) {
    if (!run.aiAnalysis) {
      continue;
    }
    const suggestions = Array.isArray((run.aiAnalysis as any)?.suggestions)
      ? (run.aiAnalysis as any).suggestions
      : [];
    for (const suggestion of suggestions) {
      const suggestionIdentity = typeof suggestion?.paperIdentityKey === 'string' ? suggestion.paperIdentityKey : '';
      const suggestionDoi = normalizeDoi(suggestion?.paperDoi);
      const suggestionProviderPaperId = typeof suggestion?.providerPaperId === 'string'
        ? suggestion.providerPaperId
        : (typeof suggestion?.paperId === 'string' ? suggestion.paperId : '');
      const suggestionProvider = normalizeProvider(suggestion?.paperSource);
      const suggestionTitleFingerprint = normalizeTitleFingerprint(suggestion?.paperTitle);

      const matchesIdentity = Boolean(identityKey && suggestionIdentity && identityKey === suggestionIdentity);
      const matchesDoi = Boolean(normalizedDoi && suggestionDoi && normalizedDoi === suggestionDoi);
      const matchesProviderPaper = Boolean(
        providerPaperId
        && suggestionProviderPaperId
        && providerPaperId === suggestionProviderPaperId
        && (!provider || !suggestionProvider || provider === suggestionProvider)
      );
      const matchesTitle = Boolean(titleFingerprint && suggestionTitleFingerprint && titleFingerprint === suggestionTitleFingerprint);

      if (matchesIdentity || matchesDoi || matchesProviderPaper || matchesTitle) {
        matchedSuggestion = suggestion;
        break;
      }
    }
    if (matchedSuggestion) {
      break;
    }
  }

  if (!matchedSuggestion) {
    return;
  }

  const mappings = buildMappingsForCitation(citation, matchedSuggestion);
  if (mappings.length === 0) {
    return;
  }

  await citationMappingService.clearMappingsForCitations(sessionId, [citation.id]);
  await citationMappingService.storeMappings(sessionId, mappings);
}

export async function GET(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const citations = await citationService.getCitationsForSession(sessionId);
    const styleCode = getDefaultStyleCode(session);
    const sectionOrder = Array.isArray(session.paperType?.sectionOrder)
      ? (session.paperType.sectionOrder as string[])
      : [];
    const styleMeta = await buildCitationStyleMeta({
      sessionId,
      styleCode,
      sectionOrder,
      citations
    });

    const formatted = await Promise.all(citations.map(async citation => {
      const preview = await buildCitationPreview(citation, styleCode, styleMeta);

      return {
        ...citation,
        preview
      };
    }));

    return NextResponse.json({
      citations: formatted,
      citationStyle: styleCode,
      citationStyleMeta: styleMeta
    });
  } catch (error) {
    console.error('[Citations] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch citations' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const body = await request.json();
    const data = createCitationSchema.parse(body);

    let citation;
    if (data.searchResult) {
      // Pass AI-generated citation metadata if available
      citation = await citationService.importFromSearchResult(
        sessionId, 
        data.searchResult,
        data.citationMeta || undefined
      );

      try {
        await hydrateCitationMappingsFromAnalysis(sessionId, citation, data.searchResult);
      } catch (mappingHydrationError) {
        console.warn('[Citations] Failed to hydrate mapping metadata for imported citation:', mappingHydrationError);
      }
    } else if (data.citation) {
      citation = await citationService.addManualCitation(sessionId, data.citation);
    } else {
      return NextResponse.json({ error: 'Citation payload is required' }, { status: 400 });
    }

    // Keep paper citations synced into the account-level reference library.
    try {
      await paperLibraryService.syncCitationToLibraryAndCollection(user.id, sessionId, citation);
    } catch (syncError) {
      console.warn('[Citations] Failed to sync citation to paper library collection:', syncError);
    }

    const styleCode = getDefaultStyleCode(session);
    const citations = await citationService.getCitationsForSession(sessionId);
    const sectionOrder = Array.isArray(session.paperType?.sectionOrder)
      ? (session.paperType.sectionOrder as string[])
      : [];
    const styleMeta = await buildCitationStyleMeta({
      sessionId,
      styleCode,
      sectionOrder,
      citations
    });
    const preview = await buildCitationPreview(citation, styleCode, styleMeta);

    return NextResponse.json({
      citation: {
        ...citation,
        preview
      },
      citationStyleMeta: styleMeta
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : 'Failed to add citation';
    const status = message.toLowerCase().includes('already exists') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
