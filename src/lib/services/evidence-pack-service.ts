import { prisma } from '../prisma';
import { blueprintService } from './blueprint-service';
import { citationMappingService, type CitationMetaSnapshot, type PaperBlueprintMapping } from './citation-mapping-service';
import { citationCoverageDistributor, type AssignedCitation } from './citation-coverage-distributor';

export interface EvidenceCardSnippet {
  cardId: string;
  claim: string;
  claimType: string;
  referenceArchetype?: string | null;
  deepAnalysisLabel?: string | null;
  sourceSection?: string | null;
  quantitativeDetail: string | null;
  conditions: string | null;
  comparableMetrics?: Record<string, string | number | boolean | null> | null;
  doesNotSupport: string | null;
  scopeCondition?: string | null;
  studyDesign: string | null;
  rigorIndicators: string | null;
  sourceFragment: string;
  pageHint: string | null;
  quoteVerified: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  useAs: 'SUPPORT' | 'CONTRAST' | 'CONTEXT' | 'DEFINITION';
  mappingConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface EvidenceCitation {
  citationId: string;
  citationKey: string;
  title: string;
  year: number | null;
  referenceArchetype?: string | null;
  deepAnalysisLabel?: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  relevanceScore: number;
  remark: string;
  keyContribution?: string;
  keyFindings?: string;
  methodologicalApproach?: string | null;
  relevanceToResearch?: string;
  limitationsOrGaps?: string | null;
  claimTypesSupported?: Array<
    'BACKGROUND' |
    'GAP' |
    'METHOD' |
    'LIMITATION' |
    'DATASET' |
    'IMPLEMENTATION_CONSTRAINT'
  >;
  evidenceBoundary?: string | null;
  positionalRelation?: {
    relation?: 'REINFORCES' | 'CONTRADICTS' | 'EXTENDS' | 'QUALIFIES' | 'TENSION';
    rationale?: string;
  } | null;
  hasDeepAnalysis?: boolean;
  evidenceCards?: EvidenceCardSnippet[];
}

export interface DimensionEvidence {
  dimension: string;
  citations: EvidenceCitation[];
}

export interface SectionEvidencePack {
  sectionKey: string;
  hasBlueprint: boolean;
  allowedCitationKeys: string[];
  dimensionEvidence: DimensionEvidence[];
  gaps: string[];
  coverageAssignments: AssignedCitation[];
  evidenceDigest: EvidenceDigest;
}

// ============================================================================
// Evidence Digest — Compact prompt-safe evidence representation
// ============================================================================

export interface EvidenceDigestEntry {
  citationKey: string;
  claimType: string;   // BACKGROUND|GAP|METHOD|RESULT|LIMITATION|DEFINITION
  claim: string;       // 1–2 sentence compressed claim
  method?: string;     // method tag
  evidenceStrength: 'weak' | 'medium' | 'strong';
  confidence: number;  // 0.0–1.0
  stance?: 'supports' | 'contradicts' | 'extends' | 'neutral';
  mustCite: boolean;
}

export interface EvidenceDigest {
  digests: EvidenceDigestEntry[];
  mustCiteKeys: string[];
  optionalCiteKeys: string[];
}

const CONFIDENCE_WEIGHT: Record<'HIGH' | 'MEDIUM' | 'LOW', number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1
};

const CLAIM_TYPE_VALUES = [
  'BACKGROUND',
  'GAP',
  'METHOD',
  'LIMITATION',
  'DATASET',
  'IMPLEMENTATION_CONSTRAINT'
] as const;
const CLAIM_TYPE_SET = new Set<string>(CLAIM_TYPE_VALUES);
const POSITIONAL_RELATION_VALUES = [
  'REINFORCES',
  'CONTRADICTS',
  'EXTENDS',
  'QUALIFIES',
  'TENSION'
] as const;
const POSITIONAL_RELATION_SET = new Set<string>(POSITIONAL_RELATION_VALUES);

const normalizeDimension = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const normalizeSectionKey = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, '_');
const normalizeDoi = (value?: string | null) =>
  typeof value === 'string'
    ? value.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:/, '').replace(/\s+/g, '')
    : '';
const normalizeProvider = (value?: string | null) =>
  typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, '_') : '';
const normalizeTitleFingerprint = (value?: string | null) =>
  typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
const normalizeAuthor = (value?: string | null) =>
  typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
    : '';

type EvidencePackSelectionLimits = {
  perDimensionTopK: number;
  maxAllowedCitationKeys: number;
  minAllowedCitationKeys: number;
};

function getEvidencePackSelectionLimits(sectionKey: string): EvidencePackSelectionLimits {
  const normalized = normalizeSectionKey(sectionKey);
  if (normalized === 'literature_review' || normalized === 'related_work') {
    return {
      perDimensionTopK: 3,
      maxAllowedCitationKeys: 70,
      minAllowedCitationKeys: 25,
    };
  }

  if (normalized === 'introduction' || normalized === 'methodology') {
    return {
      perDimensionTopK: 3,
      maxAllowedCitationKeys: 40,
      minAllowedCitationKeys: 12,
    };
  }

  return {
    perDimensionTopK: 3,
    maxAllowedCitationKeys: 25,
    minAllowedCitationKeys: 0,
  };
}

function strongerConfidence(
  a: 'HIGH' | 'MEDIUM' | 'LOW',
  b: 'HIGH' | 'MEDIUM' | 'LOW'
): 'HIGH' | 'MEDIUM' | 'LOW' {
  return CONFIDENCE_WEIGHT[a] >= CONFIDENCE_WEIGHT[b] ? a : b;
}

function mergeEvidenceCards(
  existing: EvidenceCardSnippet[] | undefined,
  incoming: EvidenceCardSnippet[] | undefined
): EvidenceCardSnippet[] | undefined {
  const rows = [...(existing || []), ...(incoming || [])];
  if (!rows.length) return undefined;
  const byId = new Map<string, EvidenceCardSnippet>();
  for (const row of rows) {
    if (!byId.has(row.cardId)) {
      byId.set(row.cardId, row);
      continue;
    }
    const current = byId.get(row.cardId)!;
    const confidence = strongerConfidence(current.confidence, row.confidence);
    byId.set(row.cardId, { ...current, ...row, confidence });
  }
  return Array.from(byId.values());
}

function mergeEvidenceCitationEntry(existing: EvidenceCitation, incoming: EvidenceCitation): EvidenceCitation {
  return {
    ...existing,
    remark: existing.remark || incoming.remark,
    confidence: strongerConfidence(existing.confidence, incoming.confidence),
    relevanceScore: Math.max(existing.relevanceScore || 0, incoming.relevanceScore || 0),
    keyContribution: existing.keyContribution || incoming.keyContribution,
    keyFindings: existing.keyFindings || incoming.keyFindings,
    methodologicalApproach: existing.methodologicalApproach || incoming.methodologicalApproach || null,
    relevanceToResearch: existing.relevanceToResearch || incoming.relevanceToResearch,
    limitationsOrGaps: existing.limitationsOrGaps || incoming.limitationsOrGaps || null,
    claimTypesSupported: existing.claimTypesSupported?.length
      ? existing.claimTypesSupported
      : incoming.claimTypesSupported,
    evidenceBoundary: existing.evidenceBoundary || incoming.evidenceBoundary || null,
    positionalRelation: existing.positionalRelation || incoming.positionalRelation || null,
    hasDeepAnalysis: Boolean(existing.hasDeepAnalysis || incoming.hasDeepAnalysis),
    referenceArchetype: existing.referenceArchetype || incoming.referenceArchetype || null,
    deepAnalysisLabel: existing.deepAnalysisLabel || incoming.deepAnalysisLabel || null,
    evidenceCards: mergeEvidenceCards(existing.evidenceCards, incoming.evidenceCards),
  };
}

function upsertDimensionCitation(
  perDimension: Map<string, EvidenceCitation[]>,
  normalizedDimension: string,
  citation: EvidenceCitation
): void {
  if (!perDimension.has(normalizedDimension)) {
    perDimension.set(normalizedDimension, []);
  }

  const rows = perDimension.get(normalizedDimension)!;
  const existingIndex = rows.findIndex(row => row.citationId === citation.citationId);
  if (existingIndex === -1) {
    rows.push(citation);
    return;
  }

  rows[existingIndex] = mergeEvidenceCitationEntry(rows[existingIndex], citation);
}

function clampText(value: unknown, max = 500): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.trim();
  return text ? text.slice(0, max) : undefined;
}

function extractCitationMeta(aiMeta: unknown): {
  keyContribution?: string;
  keyFindings?: string;
  methodologicalApproach?: string | null;
  relevanceToResearch?: string;
  limitationsOrGaps?: string | null;
  claimTypesSupported?: Array<
    'BACKGROUND' |
    'GAP' |
    'METHOD' |
    'LIMITATION' |
    'DATASET' |
    'IMPLEMENTATION_CONSTRAINT'
  >;
  evidenceBoundary?: string | null;
  positionalRelation?: {
    relation?: 'REINFORCES' | 'CONTRADICTS' | 'EXTENDS' | 'QUALIFIES' | 'TENSION';
    rationale?: string;
  } | null;
  relevanceScore: number;
} {
  const meta = (aiMeta || {}) as Record<string, unknown>;
  const relevanceScore = Number(meta.relevanceScore);
  const claimTypesSupported = Array.isArray(meta.claimTypesSupported)
    ? Array.from(
      new Set(
        meta.claimTypesSupported
          .map(value => String(value).trim().toUpperCase())
          .filter(value => CLAIM_TYPE_SET.has(value))
      )
    ).slice(0, 3) as Array<
      'BACKGROUND' |
      'GAP' |
      'METHOD' |
      'LIMITATION' |
      'DATASET' |
      'IMPLEMENTATION_CONSTRAINT'
    >
    : undefined;
  const rawPositionalRelation = meta.positionalRelation && typeof meta.positionalRelation === 'object'
    ? meta.positionalRelation as Record<string, unknown>
    : null;
  const relation = typeof rawPositionalRelation?.relation === 'string'
    ? rawPositionalRelation.relation.trim().toUpperCase()
    : '';
  const rationale = clampText(rawPositionalRelation?.rationale, 300);
  return {
    keyContribution: clampText(meta.keyContribution, 400),
    keyFindings: clampText(meta.keyFindings, 400),
    methodologicalApproach: clampText(meta.methodologicalApproach, 400) ?? null,
    relevanceToResearch: clampText(meta.relevanceToResearch, 500),
    limitationsOrGaps: clampText(meta.limitationsOrGaps, 500) ?? null,
    claimTypesSupported,
    evidenceBoundary: clampText(meta.evidenceBoundary, 400) ?? null,
    positionalRelation: POSITIONAL_RELATION_SET.has(relation) || rationale
      ? {
        relation: POSITIONAL_RELATION_SET.has(relation)
          ? relation as 'REINFORCES' | 'CONTRADICTS' | 'EXTENDS' | 'QUALIFIES' | 'TENSION'
          : undefined,
        rationale: rationale || undefined
      }
      : null,
    relevanceScore: Number.isFinite(relevanceScore) ? relevanceScore : 0
  };
}

type CitationLookupRow = {
  id: string;
  citationKey: string;
  doiNormalized: string | null;
  paperIdentityKey: string | null;
  importProvider: string | null;
  importProviderPaperId: string | null;
  titleFingerprint: string | null;
  year: number | null;
  firstAuthorNormalized: string | null;
};

type SuggestionForBackfill = {
  paperId?: string;
  paperDoi?: string;
  paperSource?: string;
  providerPaperId?: string;
  paperIdentityKey?: string;
  paperTitle?: string;
  relevanceScore?: number;
  citationMeta?: Record<string, unknown>;
  dimensionMappings?: Array<{
    sectionKey?: string;
    dimension?: string;
    remark?: string;
    confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | string;
  }>;
};

type CitationLookupIndex = {
  byId: Map<string, CitationLookupRow>;
  byIdentity: Map<string, CitationLookupRow[]>;
  byDoi: Map<string, CitationLookupRow[]>;
  byProviderAndPaperId: Map<string, CitationLookupRow[]>;
  byProviderPaperId: Map<string, CitationLookupRow[]>;
  byTitleFingerprint: Map<string, CitationLookupRow[]>;
};

function pushLookup(map: Map<string, CitationLookupRow[]>, key: string, row: CitationLookupRow) {
  if (!key) return;
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key)!.push(row);
}

function buildLookupIndex(rows: CitationLookupRow[]): CitationLookupIndex {
  const byId = new Map<string, CitationLookupRow>();
  const byIdentity = new Map<string, CitationLookupRow[]>();
  const byDoi = new Map<string, CitationLookupRow[]>();
  const byProviderAndPaperId = new Map<string, CitationLookupRow[]>();
  const byProviderPaperId = new Map<string, CitationLookupRow[]>();
  const byTitleFingerprint = new Map<string, CitationLookupRow[]>();

  for (const row of rows) {
    byId.set(row.id, row);
    if (row.paperIdentityKey) {
      pushLookup(byIdentity, row.paperIdentityKey, row);
    }
    if (row.doiNormalized) {
      pushLookup(byDoi, row.doiNormalized, row);
    }
    if (row.importProviderPaperId) {
      pushLookup(byProviderPaperId, row.importProviderPaperId, row);
      pushLookup(
        byProviderAndPaperId,
        `${normalizeProvider(row.importProvider)}::${row.importProviderPaperId}`,
        row
      );
    }
    if (row.titleFingerprint) {
      pushLookup(byTitleFingerprint, row.titleFingerprint, row);
    }
  }

  return {
    byId,
    byIdentity,
    byDoi,
    byProviderAndPaperId,
    byProviderPaperId,
    byTitleFingerprint
  };
}

function narrowCandidates(candidates: CitationLookupRow[], suggestion: SuggestionForBackfill): CitationLookupRow[] {
  if (candidates.length <= 1) {
    return candidates;
  }
  const identity = suggestion.paperIdentityKey || '';
  const yearMatch = identity.match(/\|y:([^|]+)/);
  const authorMatch = identity.match(/\|fa:([^|]+)/);
  const expectedYear = yearMatch && yearMatch[1] !== 'na' ? Number(yearMatch[1]) : undefined;
  const expectedAuthor = authorMatch && authorMatch[1] !== 'na' ? authorMatch[1] : '';

  let narrowed = candidates;
  if (typeof expectedYear === 'number' && Number.isFinite(expectedYear)) {
    const yearFiltered = narrowed.filter(c => c.year === expectedYear);
    if (yearFiltered.length > 0) {
      narrowed = yearFiltered;
    }
  }
  if (expectedAuthor) {
    const authorFiltered = narrowed.filter(c => (c.firstAuthorNormalized || '') === expectedAuthor);
    if (authorFiltered.length > 0) {
      narrowed = authorFiltered;
    }
  }
  return narrowed;
}

function resolveSuggestionCitation(suggestion: SuggestionForBackfill, lookup: CitationLookupIndex): CitationLookupRow | null {
  if (suggestion.paperId && lookup.byId.has(suggestion.paperId)) {
    return lookup.byId.get(suggestion.paperId) || null;
  }

  if (suggestion.paperIdentityKey) {
    const byIdentity = narrowCandidates(lookup.byIdentity.get(suggestion.paperIdentityKey) || [], suggestion);
    if (byIdentity.length > 0) {
      return byIdentity[0];
    }
  }

  const doi = normalizeDoi(suggestion.paperDoi);
  if (doi) {
    const byDoi = narrowCandidates(lookup.byDoi.get(doi) || [], suggestion);
    if (byDoi.length > 0) {
      return byDoi[0];
    }
  }

  const providerPaperId = suggestion.providerPaperId || suggestion.paperId || '';
  if (providerPaperId) {
    const providerPairKey = `${normalizeProvider(suggestion.paperSource)}::${providerPaperId}`;
    const byPair = narrowCandidates(lookup.byProviderAndPaperId.get(providerPairKey) || [], suggestion);
    if (byPair.length > 0) {
      return byPair[0];
    }

    const byProviderId = narrowCandidates(lookup.byProviderPaperId.get(providerPaperId) || [], suggestion);
    if (byProviderId.length > 0) {
      return byProviderId[0];
    }
  }

  const tf = normalizeTitleFingerprint(suggestion.paperTitle);
  if (tf) {
    const byTitle = narrowCandidates(lookup.byTitleFingerprint.get(tf) || [], suggestion);
    if (byTitle.length > 0) {
      return byTitle[0];
    }
  }

  return null;
}

function toSnapshotFromSuggestion(suggestion: SuggestionForBackfill): CitationMetaSnapshot | undefined {
  const meta = suggestion.citationMeta || {};
  const rawPositionalRelation = meta.positionalRelation && typeof meta.positionalRelation === 'object'
    ? meta.positionalRelation as Record<string, unknown>
    : null;
  const positionalRelation = rawPositionalRelation
    ? {
      relation: POSITIONAL_RELATION_SET.has(String(rawPositionalRelation.relation || '').trim().toUpperCase())
        ? String(rawPositionalRelation.relation).trim().toUpperCase() as NonNullable<CitationMetaSnapshot['positionalRelation']>['relation']
        : undefined,
      rationale: clampText(rawPositionalRelation.rationale, 300)
    }
    : undefined;
  const snapshot: CitationMetaSnapshot = {
    keyContribution: clampText(meta.keyContribution, 400),
    keyFindings: clampText(meta.keyFindings, 400),
    methodologicalApproach: clampText(meta.methodologicalApproach, 400) ?? null,
    relevanceToResearch: clampText(meta.relevanceToResearch, 500),
    limitationsOrGaps: clampText(meta.limitationsOrGaps, 500) ?? null,
    claimTypesSupported: Array.isArray(meta.claimTypesSupported)
      ? Array.from(
        new Set(
          meta.claimTypesSupported
            .map(value => String(value).trim().toUpperCase())
            .filter(value => CLAIM_TYPE_SET.has(value))
        )
      ).slice(0, 3) as CitationMetaSnapshot['claimTypesSupported']
      : undefined,
    evidenceBoundary: clampText(meta.evidenceBoundary, 400) ?? null,
    positionalRelation: positionalRelation?.relation || positionalRelation?.rationale
      ? positionalRelation
      : undefined,
    usage: meta.usage && typeof meta.usage === 'object'
      ? {
        introduction: Boolean((meta.usage as Record<string, unknown>).introduction),
        literatureReview: Boolean((meta.usage as Record<string, unknown>).literatureReview),
        methodology: Boolean((meta.usage as Record<string, unknown>).methodology),
        comparison: Boolean((meta.usage as Record<string, unknown>).comparison)
      }
      : undefined,
    relevanceScore: Number.isFinite(Number(suggestion.relevanceScore))
      ? Math.max(0, Math.min(100, Number(suggestion.relevanceScore)))
      : undefined,
    analyzedAt: new Date().toISOString()
  };

  return Object.values(snapshot).some(v => v !== undefined) ? snapshot : undefined;
}

class EvidencePackService {
  private async loadDeepCardMappings(sessionId: string) {
    return prisma.evidenceCardMapping.findMany({
      where: {
        card: {
          sessionId,
        }
      },
      include: {
        card: {
          include: {
            citation: {
              select: {
                id: true,
                citationKey: true,
                title: true,
                year: true,
                aiMeta: true,
                deepAnalysisLabel: true
              }
            }
          }
        }
      }
    });
  }

  private async loadDimensionMappings(sessionId: string) {
    return prisma.citationUsage.findMany({
      where: {
        citation: {
          sessionId,
          isActive: true
        },
        usageKind: 'DIMENSION_MAPPING',
        dimension: { not: null },
        inclusionStatus: 'INCLUDED'
      },
      include: {
        citation: {
          select: {
            id: true,
            citationKey: true,
            title: true,
            year: true,
            aiMeta: true,
            deepAnalysisLabel: true
          }
        }
      }
    });
  }

  private async backfillMappingsFromLatestAnalysis(sessionId: string): Promise<number> {
    const latestAnalyzedRun = await prisma.literatureSearchRun.findFirst({
      where: {
        sessionId,
        aiAnalyzedAt: { not: null }
      },
      orderBy: [{ aiAnalyzedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        aiAnalysis: true
      }
    });

    if (!latestAnalyzedRun?.aiAnalysis) {
      return 0;
    }

    const suggestions = Array.isArray((latestAnalyzedRun.aiAnalysis as any)?.suggestions)
      ? ((latestAnalyzedRun.aiAnalysis as any).suggestions as SuggestionForBackfill[])
      : [];
    if (suggestions.length === 0) {
      return 0;
    }

    const citations = await prisma.citation.findMany({
      where: { sessionId, isActive: true },
      select: {
        id: true,
        citationKey: true,
        doiNormalized: true,
        paperIdentityKey: true,
        importProvider: true,
        importProviderPaperId: true,
        titleFingerprint: true,
        year: true,
        firstAuthorNormalized: true
      }
    });
    if (citations.length === 0) {
      return 0;
    }

    const lookup = buildLookupIndex(citations as CitationLookupRow[]);
    const mappings: PaperBlueprintMapping[] = [];
    const citationIds = new Set<string>();

    for (const suggestion of suggestions) {
      const citation = resolveSuggestionCitation(suggestion, lookup);
      if (!citation) {
        continue;
      }

      citationIds.add(citation.id);
      const citationMeta = toSnapshotFromSuggestion(suggestion);
      const dims = Array.isArray(suggestion.dimensionMappings) ? suggestion.dimensionMappings : [];
      if (dims.length === 0) {
        mappings.push({
          paperId: citation.id,
          citationKey: citation.citationKey,
          sectionKey: null,
          dimensionMappings: [],
          mappingStatus: 'UNMAPPED',
          citationMeta
        });
        continue;
      }

      const bySection = new Map<string, Array<{ dimension: string; remark: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW' }>>();
      for (const dim of dims) {
        const sectionKey = typeof dim.sectionKey === 'string' ? dim.sectionKey.trim() : '';
        const dimension = typeof dim.dimension === 'string' ? dim.dimension.trim() : '';
        if (!sectionKey || !dimension) {
          continue;
        }
        const remark = typeof dim.remark === 'string' && dim.remark.trim()
          ? dim.remark.trim().slice(0, 500)
          : 'No remark provided';
        const confidence = dim.confidence === 'HIGH' || dim.confidence === 'MEDIUM' || dim.confidence === 'LOW'
          ? dim.confidence
          : 'MEDIUM';
        if (!bySection.has(sectionKey)) {
          bySection.set(sectionKey, []);
        }
        bySection.get(sectionKey)!.push({ dimension, remark, confidence });
      }

      if (bySection.size === 0) {
        mappings.push({
          paperId: citation.id,
          citationKey: citation.citationKey,
          sectionKey: null,
          dimensionMappings: [],
          mappingStatus: 'UNMAPPED',
          citationMeta
        });
        continue;
      }

      for (const [sectionKey, sectionDims] of Array.from(bySection.entries())) {
        const highMediumCount = sectionDims.filter(d => d.confidence === 'HIGH' || d.confidence === 'MEDIUM').length;
        const mappingStatus: PaperBlueprintMapping['mappingStatus'] = highMediumCount >= 2
          ? 'MAPPED'
          : highMediumCount >= 1
            ? 'WEAK'
            : sectionDims.length > 0
              ? 'WEAK'
              : 'UNMAPPED';

        mappings.push({
          paperId: citation.id,
          citationKey: citation.citationKey,
          sectionKey,
          dimensionMappings: sectionDims,
          mappingStatus,
          citationMeta
        });
      }
    }

    if (mappings.length === 0) {
      return 0;
    }

    const ids = Array.from(citationIds);
    await citationMappingService.clearMappingsForCitations(sessionId, ids);
    await citationMappingService.storeMappings(sessionId, mappings);
    return mappings.length;
  }

  /**
   * Build a compact EvidenceDigest from the rich dimensionEvidence data.
   * This is the prompt-safe representation — no quotes, no full card text.
   */
  buildEvidenceDigest(
    dimensionEvidence: DimensionEvidence[],
    allowedCitationKeys: string[]
  ): EvidenceDigest {
    const seenKeys = new Set<string>();
    const entries: EvidenceDigestEntry[] = [];
    const relevanceScores = new Map<string, number>();

    // Collect all citations across dimensions
    for (const dim of dimensionEvidence) {
      for (const citation of dim.citations) {
        // Track best relevance score per key
        const prev = relevanceScores.get(citation.citationKey) || 0;
        if (citation.relevanceScore > prev) {
          relevanceScores.set(citation.citationKey, citation.relevanceScore);
        }

        if (seenKeys.has(citation.citationKey)) continue;
        seenKeys.add(citation.citationKey);

        // Pick the best claim source: evidence card claim > key contribution > key findings > title
        const topCard = citation.evidenceCards?.[0];
        const claim = topCard?.claim
          || citation.keyContribution
          || citation.keyFindings
          || citation.remark
          || citation.title;

        // Derive claimType from card or citation meta
        const claimType = topCard?.claimType
          || citation.claimTypesSupported?.[0]
          || 'BACKGROUND';

        // Map confidence to strength
        const strengthMap: Record<string, 'weak' | 'medium' | 'strong'> = {
          HIGH: 'strong', MEDIUM: 'medium', LOW: 'weak'
        };
        const evidenceStrength = strengthMap[citation.confidence] || 'medium';

        // Map positional relation to stance
        const stanceMap: Record<string, 'supports' | 'contradicts' | 'extends' | 'neutral'> = {
          REINFORCES: 'supports', SUPPORTS: 'supports',
          CONTRADICTS: 'contradicts',
          EXTENDS: 'extends',
          QUALIFIES: 'neutral', TENSION: 'contradicts'
        };
        const stance = citation.positionalRelation?.relation
          ? stanceMap[citation.positionalRelation.relation] || 'neutral'
          : 'neutral';

        entries.push({
          citationKey: citation.citationKey,
          claimType,
          claim: String(claim || '').slice(0, 300),
          method: citation.methodologicalApproach || topCard?.studyDesign || undefined,
          evidenceStrength,
          confidence: CONFIDENCE_WEIGHT[citation.confidence] / 3, // normalize to 0–1
          stance,
          mustCite: false, // assigned below
        });
      }
    }

    // Select must-cite keys: top N by relevance + deep-anchor citations
    const MAX_MUST_CITE = Math.min(5, Math.ceil(entries.length * 0.3));
    const sortedByRelevance = [...entries]
      .sort((a, b) => (relevanceScores.get(b.citationKey) || 0) - (relevanceScores.get(a.citationKey) || 0));

    const mustCiteKeys: string[] = [];
    for (const entry of sortedByRelevance) {
      if (mustCiteKeys.length >= MAX_MUST_CITE) break;
      entry.mustCite = true;
      mustCiteKeys.push(entry.citationKey);
    }

    const mustCiteSet = new Set(mustCiteKeys);
    const optionalCiteKeys = allowedCitationKeys.filter(k => !mustCiteSet.has(k));

    return {
      digests: entries,
      mustCiteKeys,
      optionalCiteKeys,
    };
  }

  async getEvidencePack(sessionId: string, sectionKey: string): Promise<SectionEvidencePack> {
    const requestedSectionKey = sectionKey;
    const normalizedRequestedSectionKey = normalizeSectionKey(requestedSectionKey);
    const blueprint = await blueprintService.getBlueprint(sessionId);
    const coveragePlan = await citationCoverageDistributor.buildCoveragePlan(sessionId);

    const resolveCoverageAssignments = (resolvedSectionKey: string): AssignedCitation[] => {
      const normalized = normalizeSectionKey(resolvedSectionKey);
      return coveragePlan.bySection.get(normalized) || [];
    };

    if (!blueprint) {
      return {
        sectionKey: requestedSectionKey,
        hasBlueprint: false,
        allowedCitationKeys: [],
        dimensionEvidence: [],
        gaps: [],
        coverageAssignments: resolveCoverageAssignments(requestedSectionKey),
        evidenceDigest: { digests: [], mustCiteKeys: [], optionalCiteKeys: [] },
      };
    }

    const section = blueprint.sectionPlan.find(
      s => normalizeSectionKey(s.sectionKey) === normalizedRequestedSectionKey
    );
    const resolvedSectionKey = section?.sectionKey || requestedSectionKey;
    const mustCover = section?.mustCover || [];

    if (!section || mustCover.length === 0) {
      return {
        sectionKey: resolvedSectionKey,
        hasBlueprint: true,
        allowedCitationKeys: [],
        dimensionEvidence: [],
        gaps: [],
        coverageAssignments: resolveCoverageAssignments(resolvedSectionKey),
        evidenceDigest: { digests: [], mustCiteKeys: [], optionalCiteKeys: [] },
      };
    }

    const perDimension = new Map<string, EvidenceCitation[]>();
    const sectionKeyNormalized = normalizeSectionKey(section.sectionKey);
    const selectionLimits = getEvidencePackSelectionLimits(sectionKeyNormalized);

    // Deep evidence cards are primary evidence. They are linked by section/dimension via EvidenceCardMapping.
    const deepMappings = await this.loadDeepCardMappings(sessionId);
    const deepRowsForSection = deepMappings.filter(
      mapping => normalizeSectionKey(mapping.sectionKey) === sectionKeyNormalized
    );

    for (const mapping of deepRowsForSection) {
      const normalized = normalizeDimension(mapping.dimension || '');
      if (!normalized) continue;

      const card = mapping.card;
      const citation = card.citation;
      const citationMeta = extractCitationMeta(citation.aiMeta);
      const cardConfidence = card.confidence === 'HIGH' || card.confidence === 'MEDIUM' || card.confidence === 'LOW'
        ? card.confidence
        : 'MEDIUM';
      const mappingConfidence = mapping.mappingConfidence === 'HIGH'
        || mapping.mappingConfidence === 'MEDIUM'
        || mapping.mappingConfidence === 'LOW'
        ? mapping.mappingConfidence
        : 'MEDIUM';
      const useAs = mapping.useAs === 'SUPPORT'
        || mapping.useAs === 'CONTRAST'
        || mapping.useAs === 'CONTEXT'
        || mapping.useAs === 'DEFINITION'
        ? mapping.useAs
        : 'CONTEXT';

      const supportNote = card.claim
        || citationMeta.relevanceToResearch
        || citationMeta.keyFindings
        || citationMeta.keyContribution
        || citation.title;

      const cardSnippet: EvidenceCardSnippet = {
        cardId: card.id,
        claim: card.claim,
        claimType: card.claimType,
        referenceArchetype: card.referenceArchetype || null,
        deepAnalysisLabel: card.deepAnalysisLabel || null,
        sourceSection: card.sourceSection || null,
        quantitativeDetail: card.quantitativeDetail,
        conditions: card.conditions,
        comparableMetrics: (card.comparableMetrics && typeof card.comparableMetrics === 'object' && !Array.isArray(card.comparableMetrics))
          ? card.comparableMetrics as Record<string, string | number | boolean | null>
          : null,
        doesNotSupport: card.doesNotSupport,
        scopeCondition: card.scopeCondition || null,
        studyDesign: card.studyDesign,
        rigorIndicators: card.rigorIndicators,
        sourceFragment: card.sourceFragment,
        pageHint: card.pageHint,
        quoteVerified: Boolean(card.quoteVerified),
        confidence: cardConfidence,
        useAs,
        mappingConfidence,
      };

      const entry: EvidenceCitation = {
        citationId: citation.id,
        citationKey: citation.citationKey,
        title: citation.title,
        year: citation.year,
        referenceArchetype: card.referenceArchetype || null,
        deepAnalysisLabel: card.deepAnalysisLabel || citation.deepAnalysisLabel || null,
        confidence: strongerConfidence(cardConfidence, mappingConfidence),
        relevanceScore: Math.max(citationMeta.relevanceScore, 50),
        remark: supportNote,
        keyContribution: citationMeta.keyContribution,
        keyFindings: citationMeta.keyFindings,
        methodologicalApproach: citationMeta.methodologicalApproach,
        relevanceToResearch: citationMeta.relevanceToResearch,
        limitationsOrGaps: citationMeta.limitationsOrGaps,
        claimTypesSupported: citationMeta.claimTypesSupported,
        evidenceBoundary: citationMeta.evidenceBoundary,
        positionalRelation: citationMeta.positionalRelation || null,
        hasDeepAnalysis: true,
        evidenceCards: [cardSnippet],
      };

      upsertDimensionCitation(perDimension, normalized, entry);
    }

    // Legacy citation usage mappings are fallback for LIT_ONLY papers or dimensions with no deep cards.
    let allUsages = await this.loadDimensionMappings(sessionId);
    if (allUsages.length === 0) {
      const backfilled = await this.backfillMappingsFromLatestAnalysis(sessionId);
      if (backfilled > 0) {
        allUsages = await this.loadDimensionMappings(sessionId);
      }
    }

    const usages = allUsages.filter(
      usage => normalizeSectionKey(usage.sectionKey) === sectionKeyNormalized
    );

    for (const usage of usages) {
      const normalized = normalizeDimension(usage.dimension || '');
      if (!normalized) continue;

      const citation = usage.citation;
      const citationMeta = extractCitationMeta(citation.aiMeta);
      const confidence = usage.confidence === 'HIGH' || usage.confidence === 'MEDIUM' || usage.confidence === 'LOW'
        ? usage.confidence
        : 'MEDIUM';
      const supportNote = usage.remark
        || citationMeta.relevanceToResearch
        || citationMeta.evidenceBoundary
        || citationMeta.keyFindings
        || citationMeta.keyContribution
        || citation.title;

      const entry: EvidenceCitation = {
        citationId: citation.id,
        citationKey: citation.citationKey,
        title: citation.title,
        year: citation.year,
        deepAnalysisLabel: citation.deepAnalysisLabel || null,
        confidence,
        relevanceScore: citationMeta.relevanceScore,
        remark: supportNote,
        keyContribution: citationMeta.keyContribution,
        keyFindings: citationMeta.keyFindings,
        methodologicalApproach: citationMeta.methodologicalApproach,
        relevanceToResearch: citationMeta.relevanceToResearch,
        limitationsOrGaps: citationMeta.limitationsOrGaps,
        claimTypesSupported: citationMeta.claimTypesSupported,
        evidenceBoundary: citationMeta.evidenceBoundary,
        positionalRelation: citationMeta.positionalRelation || null,
        hasDeepAnalysis: false,
      };

      upsertDimensionCitation(perDimension, normalized, entry);
    }

    const dimensionEvidence: DimensionEvidence[] = [];
    const gaps: string[] = [];
    const allowedScore = new Map<string, number>();
    const candidateScore = new Map<string, number>();

    const scoreCitation = (citation: EvidenceCitation): number =>
      (citation.hasDeepAnalysis ? 1_000_000 : 0)
      + (citation.evidenceCards?.length || 0) * 50_000
      + CONFIDENCE_WEIGHT[citation.confidence] * 10_000
      + citation.relevanceScore * 100
      + (citation.year || 0);

    for (const dim of mustCover) {
      const normalized = normalizeDimension(dim);
      const rows = (perDimension.get(normalized) || [])
        .sort((a, b) => {
          const deep = Number(Boolean(b.hasDeepAnalysis)) - Number(Boolean(a.hasDeepAnalysis));
          if (deep !== 0) return deep;
          const cards = (b.evidenceCards?.length || 0) - (a.evidenceCards?.length || 0);
          if (cards !== 0) return cards;
          const c = CONFIDENCE_WEIGHT[b.confidence] - CONFIDENCE_WEIGHT[a.confidence];
          if (c !== 0) return c;
          const r = b.relevanceScore - a.relevanceScore;
          if (r !== 0) return r;
          const y = (b.year || 0) - (a.year || 0);
          if (y !== 0) return y;
          return a.citationKey.localeCompare(b.citationKey);
        });

      for (const citation of rows) {
        const score = scoreCitation(citation);
        const prev = candidateScore.get(citation.citationKey) || 0;
        if (score > prev) {
          candidateScore.set(citation.citationKey, score);
        }
      }

      const top = rows.slice(0, selectionLimits.perDimensionTopK);
      if (!top.length) {
        gaps.push(dim);
      }

      dimensionEvidence.push({
        dimension: dim,
        citations: top
      });

      for (const citation of top) {
        const score = scoreCitation(citation);
        const prev = allowedScore.get(citation.citationKey) || 0;
        if (score > prev) {
          allowedScore.set(citation.citationKey, score);
        }
      }
    }

    // For citation-dense sections (e.g., literature review), ensure the
    // allowed-key pool is broad enough even when top per-dimension picks overlap.
    if (
      selectionLimits.minAllowedCitationKeys > 0 &&
      allowedScore.size < selectionLimits.minAllowedCitationKeys
    ) {
      const rankedCandidates = Array.from(candidateScore.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      for (const [key, score] of rankedCandidates) {
        if (allowedScore.size >= selectionLimits.minAllowedCitationKeys) break;
        if (!allowedScore.has(key)) {
          allowedScore.set(key, score);
        }
      }
    }

    const allowedCitationKeys = Array.from(allowedScore.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, selectionLimits.maxAllowedCitationKeys)
      .map(([key]) => key);

    const evidenceDigest = this.buildEvidenceDigest(dimensionEvidence, allowedCitationKeys);

    return {
      sectionKey: resolvedSectionKey,
      hasBlueprint: true,
      allowedCitationKeys,
      dimensionEvidence,
      gaps,
      coverageAssignments: resolveCoverageAssignments(resolvedSectionKey),
      evidenceDigest,
    };
  }
}

export const evidencePackService = new EvidencePackService();
export { EvidencePackService };
