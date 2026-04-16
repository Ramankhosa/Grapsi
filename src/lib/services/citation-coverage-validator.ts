import { prisma } from '../prisma';
import {
  buildCitationKeyLookup,
  citationKeyIdentity,
  normalizeCitationKey,
  resolveCitationKeyFromLookup,
  splitCitationKeyList
} from '@/lib/utils/citation-key-normalization';

export interface CoverageValidationResult {
  neverCited: string[];
  overUsedInSection: Array<{ citationKey: string; sectionKey: string; count: number }>;
  totalCitations: number;
  citedAtLeastOnce: number;
  coveragePercent: number;
}

function normalizeSectionKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeExtraSections(value: unknown): Record<string, string> {
  const normalize = (sections: Record<string, unknown>): Record<string, string> => {
    const normalized: Record<string, string> = {};
    for (const [key, sectionValue] of Object.entries(sections)) {
      if (typeof sectionValue === 'string' && sectionValue.trim().length > 0) {
        normalized[normalizeSectionKey(key)] = sectionValue;
      }
    }
    return normalized;
  };

  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        return normalize(parsed as Record<string, unknown>);
      }
      return {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object') {
    return normalize(value as Record<string, unknown>);
  }
  return {};
}

function splitCitationKeys(raw: string): string[] {
  return splitCitationKeyList(raw);
}

function countCitationMentionsInSection(
  content: string,
  canonicalLookup: Map<string, string>
): Map<string, number> {
  const counts = new Map<string, number>();
  const markerRegex = /\[CITE:([^\]]+)\]/gi;
  let match: RegExpExecArray | null = null;

  markerRegex.lastIndex = 0;
  while ((match = markerRegex.exec(content)) !== null) {
    const keys = splitCitationKeys(match[1] || '');
    for (const key of keys) {
      const canonical = resolveCitationKeyFromLookup(key, canonicalLookup) || key;
      counts.set(canonical, (counts.get(canonical) || 0) + 1);
    }
  }

  return counts;
}

class CitationCoverageValidator {
  async validateCoverage(sessionId: string): Promise<CoverageValidationResult> {
    const [citations, usageRows, latestDraft] = await Promise.all([
      prisma.citation.findMany({
        where: { sessionId, isActive: true },
        select: { citationKey: true },
        orderBy: { createdAt: 'asc' }
      }),
      prisma.citationUsage.findMany({
        where: {
          usageKind: 'DRAFT_CITATION',
          citation: {
            sessionId,
            isActive: true
          }
        },
        select: {
          sectionKey: true,
          citation: {
            select: { citationKey: true }
          }
        }
      }),
      prisma.annexureDraft.findFirst({
        where: {
          sessionId,
          jurisdiction: 'PAPER'
        },
        orderBy: { version: 'desc' },
        select: {
          extraSections: true
        }
      })
    ]);

    const totalCitations = citations.length;
    if (totalCitations === 0) {
      return {
        neverCited: [],
        overUsedInSection: [],
        totalCitations: 0,
        citedAtLeastOnce: 0,
        coveragePercent: 100
      };
    }

    const canonicalLookup = buildCitationKeyLookup(citations.map(citation => citation.citationKey));

    const citedIdentitySet = new Set<string>();
    for (const row of usageRows) {
      const canonical = resolveCitationKeyFromLookup(row.citation.citationKey, canonicalLookup)
        || normalizeCitationKey(row.citation.citationKey);
      if (!canonical) continue;
      citedIdentitySet.add(citationKeyIdentity(canonical));
    }

    const neverCited = citations
      .map(citation => resolveCitationKeyFromLookup(citation.citationKey, canonicalLookup) || normalizeCitationKey(citation.citationKey))
      .filter(key => key && !citedIdentitySet.has(citationKeyIdentity(key)))
      .sort((a, b) => a.localeCompare(b));

    const overUsedInSection: Array<{ citationKey: string; sectionKey: string; count: number }> = [];
    const sections = normalizeExtraSections(latestDraft?.extraSections || null);
    for (const [sectionKey, content] of Object.entries(sections)) {
      const mentionCounts = countCitationMentionsInSection(content, canonicalLookup);
      mentionCounts.forEach((count, citationKey) => {
        if (count > 2) {
          overUsedInSection.push({
            citationKey,
            sectionKey: normalizeSectionKey(sectionKey),
            count
          });
        }
      });
    }

    overUsedInSection.sort((a, b) => {
      const sectionDiff = a.sectionKey.localeCompare(b.sectionKey);
      if (sectionDiff !== 0) return sectionDiff;
      return a.citationKey.localeCompare(b.citationKey);
    });

    const citedAtLeastOnce = totalCitations - neverCited.length;
    const coveragePercent = totalCitations > 0
      ? Number(((citedAtLeastOnce / totalCitations) * 100).toFixed(2))
      : 100;

    return {
      neverCited,
      overUsedInSection,
      totalCitations,
      citedAtLeastOnce,
      coveragePercent
    };
  }
}

export const citationCoverageValidator = new CitationCoverageValidator();
export { CitationCoverageValidator };
