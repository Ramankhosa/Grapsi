import { prisma } from '../prisma';

export interface AssignedCitation {
  citationKey: string;
  title: string;
  keyFindings?: string;
  claimType: string;
  mustUse: boolean;
}

export interface CoveragePlan {
  bySection: Map<string, AssignedCitation[]>;
  unassigned: string[];
}

type CitationMetaUsage = {
  introduction?: boolean;
  literatureReview?: boolean;
  methodology?: boolean;
  comparison?: boolean;
};

type CitationMetaSnapshot = {
  keyFindings?: string;
  relevanceScore?: number;
  claimTypesSupported?: string[];
  positionalRelation?: {
    relation?: string;
    rationale?: string;
  };
  usage?: CitationMetaUsage;
};

type CoverageCitation = {
  citationKey: string;
  title: string;
  keyFindings?: string;
  relevanceScore: number;
  claimTypesSupported: string[];
  positionalRelation?: string;
  usage: Required<CitationMetaUsage>;
};

type CandidateSection = {
  sectionKey: string;
  reason: string;
  priority: number;
};

type PlannedAssignment = {
  citation: CoverageCitation;
  sectionKey: string;
  claimType: string;
};

const DEFAULT_SECTION_MAX_ASSIGN = Number.parseInt(
  process.env.SECTION_MAX_ASSIGN || '15',
  10
);

const CACHE_TTL_MS = 45_000;

const DEFAULT_SECTION_ORDER = [
  'introduction',
  'literature_review',
  'related_work',
  'methodology',
  'results',
  'discussion',
  'conclusion'
];

const FALLBACK_DISTRIBUTION_ORDER = [
  'introduction',
  'literature_review',
  'related_work',
  'methodology',
  'discussion',
  'results',
  'conclusion'
];

function normalizeSectionKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function parseRelevanceScore(aiMeta: unknown): number {
  const score = Number((aiMeta as Record<string, unknown> | null)?.relevanceScore);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, score));
}

function parseClaimTypes(aiMeta: unknown): string[] {
  const raw = (aiMeta as Record<string, unknown> | null)?.claimTypesSupported;
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map(value => String(value || '').trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function parseUsage(aiMeta: unknown): Required<CitationMetaUsage> {
  const usage = (aiMeta as Record<string, unknown> | null)?.usage;
  if (!usage || typeof usage !== 'object') {
    return {
      introduction: false,
      literatureReview: false,
      methodology: false,
      comparison: false
    };
  }

  return {
    introduction: Boolean((usage as Record<string, unknown>).introduction),
    literatureReview: Boolean((usage as Record<string, unknown>).literatureReview),
    methodology: Boolean((usage as Record<string, unknown>).methodology),
    comparison: Boolean((usage as Record<string, unknown>).comparison)
  };
}

function parsePositionalRelation(aiMeta: unknown): string | undefined {
  const raw = (aiMeta as Record<string, unknown> | null)?.positionalRelation;
  if (!raw || typeof raw !== 'object') return undefined;
  const relation = String((raw as Record<string, unknown>).relation || '').trim().toUpperCase();
  return relation || undefined;
}

function parseKeyFindings(aiMeta: unknown): string | undefined {
  const findings = String((aiMeta as Record<string, unknown> | null)?.keyFindings || '').trim();
  return findings || undefined;
}

function toCoverageCitation(row: {
  citationKey: string;
  title: string;
  aiMeta: unknown;
}): CoverageCitation {
  return {
    citationKey: row.citationKey,
    title: row.title,
    keyFindings: parseKeyFindings(row.aiMeta),
    relevanceScore: parseRelevanceScore(row.aiMeta),
    claimTypesSupported: parseClaimTypes(row.aiMeta),
    positionalRelation: parsePositionalRelation(row.aiMeta),
    usage: parseUsage(row.aiMeta)
  };
}

function clampSectionMaxAssign(value: number): number {
  if (!Number.isFinite(value)) return 15;
  return Math.max(1, Math.min(50, Math.floor(value)));
}

function getSectionOrder(sectionOrderJson: unknown): string[] {
  const fromPaperType = Array.isArray(sectionOrderJson)
    ? sectionOrderJson.map(value => normalizeSectionKey(String(value || ''))).filter(Boolean)
    : [];
  const merged = fromPaperType.length > 0
    ? [...fromPaperType, ...DEFAULT_SECTION_ORDER]
    : [...DEFAULT_SECTION_ORDER];
  return Array.from(new Set(merged));
}

function getPreferredFallbackSections(sectionOrder: string[]): string[] {
  const ordered = FALLBACK_DISTRIBUTION_ORDER.filter(section => sectionOrder.includes(section));
  return ordered.length > 0 ? ordered : sectionOrder;
}

function chooseUnderCapSection(
  candidates: string[],
  sectionLoad: Map<string, number>,
  maxPerSection: number
): string | null {
  for (const key of candidates) {
    if ((sectionLoad.get(key) || 0) < maxPerSection) {
      return key;
    }
  }
  return null;
}

function chooseLeastLoadedSection(
  candidates: string[],
  sectionLoad: Map<string, number>
): string | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const loadDiff = (sectionLoad.get(a) || 0) - (sectionLoad.get(b) || 0);
    if (loadDiff !== 0) return loadDiff;
    return a.localeCompare(b);
  })[0];
}

function chooseDistributedFallbackSection(
  citation: CoverageCitation,
  fallbackSections: string[],
  sectionLoad: Map<string, number>,
  maxPerSection: number
): string | null {
  if (fallbackSections.length === 0) return null;

  const relevance = citation.relevanceScore;
  const preferred = relevance >= 70
    ? ['introduction', 'literature_review', 'related_work', 'methodology', 'discussion']
    : relevance >= 40
      ? ['discussion', 'results', 'literature_review', 'methodology', 'conclusion']
      : ['literature_review', 'related_work', 'discussion', 'conclusion', 'introduction'];

  const ranked = [
    ...preferred.filter(section => fallbackSections.includes(section)),
    ...fallbackSections.filter(section => !preferred.includes(section))
  ];

  const underCap = chooseUnderCapSection(ranked, sectionLoad, maxPerSection);
  if (underCap) return underCap;
  return chooseLeastLoadedSection(ranked, sectionLoad);
}

function addCandidate(
  candidateMap: Map<string, CandidateSection>,
  sectionKey: string | null,
  reason: string,
  priority: number
): void {
  if (!sectionKey) return;
  const existing = candidateMap.get(sectionKey);
  if (!existing || priority < existing.priority) {
    candidateMap.set(sectionKey, { sectionKey, reason, priority });
  }
}

function resolveSection(
  sectionOrder: string[],
  options: string[]
): string | null {
  for (const option of options) {
    const normalized = normalizeSectionKey(option);
    if (sectionOrder.includes(normalized)) {
      return normalized;
    }
  }
  return null;
}

class CitationCoverageDistributor {
  private cache = new Map<string, { expiresAt: number; plan: CoveragePlan }>();

  async buildCoveragePlan(sessionId: string): Promise<CoveragePlan> {
    const cached = this.cache.get(sessionId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return {
        bySection: new Map(cached.plan.bySection),
        unassigned: [...cached.plan.unassigned]
      };
    }

    const [session, citations] = await Promise.all([
      prisma.draftingSession.findUnique({
        where: { id: sessionId },
        select: {
          paperType: {
            select: {
              sectionOrder: true
            }
          }
        }
      }),
      prisma.citation.findMany({
        where: {
          sessionId,
          isActive: true
        },
        select: {
          citationKey: true,
          title: true,
          aiMeta: true
        },
        orderBy: { createdAt: 'asc' }
      })
    ]);

    const sectionOrder = getSectionOrder(session?.paperType?.sectionOrder);
    const fallbackSections = getPreferredFallbackSections(sectionOrder);
    const bySection = new Map<string, AssignedCitation[]>();
    for (const sectionKey of sectionOrder) {
      bySection.set(sectionKey, []);
    }

    const sectionLoad = new Map<string, number>(sectionOrder.map(section => [section, 0]));
    const maxPerSection = (() => {
      const requested = clampSectionMaxAssign(DEFAULT_SECTION_MAX_ASSIGN);
      const citationCount = citations.length;
      const sectionCount = Math.max(1, sectionOrder.length);
      const minimumForCoverage = Math.ceil(citationCount / sectionCount);
      return Math.max(requested, minimumForCoverage);
    })();

    const unassigned: string[] = [];
    const assignedCount = new Map<string, number>();
    const preferencesByCitation = new Map<string, string[]>();
    const plannedAssignments: PlannedAssignment[] = [];
    const fallbackOnly: CoverageCitation[] = [];

    const introductionSection = resolveSection(sectionOrder, ['introduction']);
    const literatureSection = resolveSection(sectionOrder, ['literature_review', 'related_work']);
    const relatedWorkSection = resolveSection(sectionOrder, ['related_work', 'literature_review']);
    const methodologySection = resolveSection(sectionOrder, ['methodology']);
    const discussionSection = resolveSection(sectionOrder, ['discussion']);
    const resultsSection = resolveSection(sectionOrder, ['results']);

    for (const row of citations) {
      const citation = toCoverageCitation(row);
      const candidateMap = new Map<string, CandidateSection>();

      if (citation.usage.introduction) {
        addCandidate(candidateMap, introductionSection, 'USAGE_INTRODUCTION', 1);
      }
      if (citation.usage.literatureReview) {
        addCandidate(candidateMap, literatureSection, 'USAGE_LITERATURE_REVIEW', 2);
        addCandidate(candidateMap, relatedWorkSection, 'USAGE_LITERATURE_REVIEW', 2);
      }
      if (citation.usage.methodology) {
        addCandidate(candidateMap, methodologySection, 'USAGE_METHODOLOGY', 3);
      }
      if (citation.usage.comparison) {
        addCandidate(candidateMap, discussionSection, 'USAGE_COMPARISON', 4);
        addCandidate(candidateMap, resultsSection, 'USAGE_COMPARISON', 4);
      }

      const claimTypes = new Set(citation.claimTypesSupported);
      if (claimTypes.has('BACKGROUND') || claimTypes.has('GAP')) {
        addCandidate(candidateMap, introductionSection, 'CLAIM_BACKGROUND_GAP', 5);
        addCandidate(candidateMap, literatureSection, 'CLAIM_BACKGROUND_GAP', 5);
        addCandidate(candidateMap, relatedWorkSection, 'CLAIM_BACKGROUND_GAP', 5);
      }
      if (claimTypes.has('METHOD') || claimTypes.has('DATASET')) {
        addCandidate(candidateMap, methodologySection, 'CLAIM_METHOD_DATASET', 6);
      }

      const relation = String(citation.positionalRelation || '').trim().toUpperCase();
      if (relation === 'CONTRADICTS' || relation === 'TENSION') {
        addCandidate(candidateMap, discussionSection, 'POSITIONAL_CONTRAST', 7);
      }

      const orderedCandidates = Array.from(candidateMap.values())
        .sort((a, b) => a.priority - b.priority || a.sectionKey.localeCompare(b.sectionKey));
      const preferenceOrder = [
        ...orderedCandidates.map(candidate => candidate.sectionKey),
        ...fallbackSections.filter(section => !orderedCandidates.some(candidate => candidate.sectionKey === section))
      ];
      preferencesByCitation.set(citation.citationKey, preferenceOrder);

      if (orderedCandidates.length === 0) {
        fallbackOnly.push(citation);
        continue;
      }

      const candidateSections = orderedCandidates.map(candidate => candidate.sectionKey);
      const selectedSection = chooseUnderCapSection(candidateSections, sectionLoad, maxPerSection)
        || chooseUnderCapSection(preferenceOrder, sectionLoad, maxPerSection)
        || chooseLeastLoadedSection(preferenceOrder, sectionLoad);

      if (!selectedSection) {
        unassigned.push(citation.citationKey);
        continue;
      }

      const repeatKey = `${citation.citationKey}::${selectedSection}`;
      const repeatCount = assignedCount.get(repeatKey) || 0;
      if (repeatCount >= 2) {
        const alternativeSection = chooseUnderCapSection(
          candidateSections.filter(section => section !== selectedSection),
          sectionLoad,
          maxPerSection
        );
        if (!alternativeSection) {
          unassigned.push(citation.citationKey);
          continue;
        }
        const candidate = orderedCandidates.find(item => item.sectionKey === alternativeSection);
        plannedAssignments.push({
          citation,
          sectionKey: alternativeSection,
          claimType: candidate?.reason || 'SIGNAL_MATCH'
        });
        assignedCount.set(`${citation.citationKey}::${alternativeSection}`, 1);
        sectionLoad.set(alternativeSection, (sectionLoad.get(alternativeSection) || 0) + 1);
        continue;
      }

      const selectedCandidate = orderedCandidates.find(item => item.sectionKey === selectedSection);
      plannedAssignments.push({
        citation,
        sectionKey: selectedSection,
        claimType: selectedCandidate?.reason || 'SIGNAL_MATCH'
      });
      assignedCount.set(repeatKey, repeatCount + 1);
      sectionLoad.set(selectedSection, (sectionLoad.get(selectedSection) || 0) + 1);
    }

    for (const citation of fallbackOnly) {
      const sectionKey = chooseDistributedFallbackSection(
        citation,
        fallbackSections,
        sectionLoad,
        maxPerSection
      );
      if (!sectionKey) {
        unassigned.push(citation.citationKey);
        continue;
      }

      plannedAssignments.push({
        citation,
        sectionKey,
        claimType: 'FALLBACK_RELEVANCE'
      });
      sectionLoad.set(sectionKey, (sectionLoad.get(sectionKey) || 0) + 1);
      preferencesByCitation.set(citation.citationKey, fallbackSections);
    }

    // Cap rebalance: move low-relevance assignments out of overloaded sections.
    for (const sectionKey of sectionOrder) {
      let currentLoad = sectionLoad.get(sectionKey) || 0;
      if (currentLoad <= maxPerSection) continue;

      const candidatesToMove = plannedAssignments
        .filter(item => item.sectionKey === sectionKey)
        .sort((a, b) => a.citation.relevanceScore - b.citation.relevanceScore);

      for (const moveCandidate of candidatesToMove) {
        if (currentLoad <= maxPerSection) break;
        const preferences = preferencesByCitation.get(moveCandidate.citation.citationKey) || [];
        const alternatives = preferences.filter(pref => pref !== sectionKey);
        const target = chooseUnderCapSection(alternatives, sectionLoad, maxPerSection);
        if (!target) continue;

        const repeatKey = `${moveCandidate.citation.citationKey}::${target}`;
        if ((assignedCount.get(repeatKey) || 0) >= 2) continue;

        const oldRepeatKey = `${moveCandidate.citation.citationKey}::${sectionKey}`;
        assignedCount.set(oldRepeatKey, Math.max(0, (assignedCount.get(oldRepeatKey) || 1) - 1));
        assignedCount.set(repeatKey, (assignedCount.get(repeatKey) || 0) + 1);

        moveCandidate.sectionKey = target;
        sectionLoad.set(sectionKey, Math.max(0, (sectionLoad.get(sectionKey) || 0) - 1));
        sectionLoad.set(target, (sectionLoad.get(target) || 0) + 1);
        currentLoad = sectionLoad.get(sectionKey) || 0;
      }
    }

    for (const assignment of plannedAssignments) {
      const rows = bySection.get(assignment.sectionKey) || [];
      if (!rows.some(item => item.citationKey === assignment.citation.citationKey)) {
        rows.push({
          citationKey: assignment.citation.citationKey,
          title: assignment.citation.title,
          keyFindings: assignment.citation.keyFindings,
          claimType: assignment.claimType,
          mustUse: true
        });
      }
      rows.sort((a, b) => a.citationKey.localeCompare(b.citationKey));
      bySection.set(assignment.sectionKey, rows);
    }

    const plan: CoveragePlan = {
      bySection,
      unassigned: Array.from(new Set(unassigned))
    };

    this.cache.set(sessionId, {
      expiresAt: now + CACHE_TTL_MS,
      plan
    });

    return {
      bySection: new Map(plan.bySection),
      unassigned: [...plan.unassigned]
    };
  }
}

export const citationCoverageDistributor = new CitationCoverageDistributor();
export { CitationCoverageDistributor };
