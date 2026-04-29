import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { extractGrantDimensionTargets, isGrantBackedPaperTypeCode } from '@/lib/grants/blueprintMetadata';
import { getDraftingSessionForUser } from '@/lib/grants/shadowSessionAccess';
import { llmGateway } from '@/lib/metering/gateway';
import type { Prisma } from '@prisma/client';
import type { GrantBlueprintDimensionTarget } from '@/types/grant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Schema for generating strategy
const generateSchema = z.object({
  regenerate: z.boolean().optional().default(false)
});

const searchQueryCategorySchema = z.enum([
  'CORE_CONCEPTS', 'DOMAIN_APPLICATION', 'METHODOLOGY',
  'THEORETICAL_FOUNDATION', 'SURVEYS_REVIEWS', 'COMPETING_APPROACHES',
  'RECENT_ADVANCES', 'GAP_IDENTIFICATION', 'CUSTOM'
]);

// Schema for updating query status
const updateQuerySchema = z.object({
  queryId: z.string().min(1),
  status: z.enum(['PENDING', 'SEARCHING', 'SEARCHED', 'COMPLETED', 'SKIPPED']).optional(),
  resultsCount: z.number().int().nonnegative().optional(),
  importedCount: z.number().int().nonnegative().optional(),
  userNotes: z.string().optional(),
  queryText: z.string().min(2).max(300).optional(),
  description: z.string().max(500).optional(),
  category: searchQueryCategorySchema.optional(),
  priority: z.number().int().positive().optional(),
  suggestedSources: z.array(z.string().min(1).max(50)).optional(),
  suggestedYearFrom: z.union([z.number().int().min(1900).max(2100), z.null()]).optional(),
  suggestedYearTo: z.union([z.number().int().min(1900).max(2100), z.null()]).optional()
});

// Schema for adding custom query
const addQuerySchema = z.object({
  queryText: z.string().min(2),
  description: z.string().max(500).optional(),
  category: searchQueryCategorySchema.optional().default('CUSTOM')
});

interface GeneratedQuery {
  queryText: string;
  category: string;
  description: string;
  priority: number;
  suggestedSources: string[];
  suggestedYearFrom?: number;
  suggestedYearTo?: number;
  searchIntent?: string;
  resultLimit?: number;
  targetIds?: string[];
  dimensionTargets?: GrantBlueprintDimensionTarget[];
}

interface LLMStrategyResponse {
  summary: string;
  estimatedPapers: number;
  queries: GeneratedQuery[];
}

type IndexedGrantDimensionTarget = GrantBlueprintDimensionTarget & { id: string };
type GrantDimensionTargetBundle = {
  id: string;
  theme: string;
  queryFocus: string;
  targets: IndexedGrantDimensionTarget[];
};

const GRANT_STRATEGY_MAX_QUERY_COUNT = 10;
const GRANT_STRATEGY_MAX_TARGETS_PER_QUERY = 4;
const GRANT_STRATEGY_RESULTS_PER_QUERY = 10;

const VALID_SEARCH_QUERY_CATEGORIES = [
  'CORE_CONCEPTS',
  'DOMAIN_APPLICATION',
  'METHODOLOGY',
  'THEORETICAL_FOUNDATION',
  'SURVEYS_REVIEWS',
  'COMPETING_APPROACHES',
  'RECENT_ADVANCES',
  'GAP_IDENTIFICATION',
  'CUSTOM',
];

const DEFAULT_SEARCH_SOURCES = ['semantic_scholar', 'openalex', 'crossref'];

const GRANT_QUERY_STOP_WORDS = new Set([
  'and', 'the', 'for', 'with', 'that', 'this', 'from', 'into', 'using', 'based',
  'proposal', 'proposed', 'project', 'program', 'grant', 'section', 'part',
  'evidence', 'effectiveness', 'analysis', 'review', 'study', 'studies',
  'systems', 'system', 'methods', 'method', 'approach', 'approaches',
]);

const GRANT_ADMIN_QUERY_PATTERN = /\b(?:crore|lakh|lakhs|budget|manpower|travel|year\s*\d+|timeline|stipend|stipends|capital assets|no international|ratio|date|202\d-\d{2}-\d{2}|operational|certifications?|users?|trainers?)\b/i;

const GRANT_SEARCH_THEMES: Array<{
  key: string;
  label: string;
  queryFocus: string;
  patterns: RegExp[];
}> = [
  {
    key: 'community_baseline',
    label: 'Community baseline and socio-economic evidence',
    queryFocus: 'population baseline, socio-economic status, health, education, livelihood, geography, and infrastructure evidence',
    patterns: [
      /\b(?:pvtg|tribal|tribe|baiga|mandla|madhya pradesh|bichhiya|mawai|socio.?economic|livelihood|poverty|demographic|health|education|infrastructure|geographical|rural|district|block)\b/i,
    ],
  },
  {
    key: 'indigenous_knowledge',
    label: 'Indigenous knowledge preservation evidence',
    queryFocus: 'oral indigenous knowledge, traditional healers, ethnobotany, cultural heritage preservation, and knowledge erosion evidence',
    patterns: [
      /\b(?:indigenous knowledge|traditional knowledge|oral|healer|healers|ethnobotany|ethnobotanical|medicinal|biocultural|cultural heritage|knowledge loss|knowledge preservation|traditional medicine)\b/i,
    ],
  },
  {
    key: 'existing_solutions',
    label: 'Existing solution and repository comparison evidence',
    queryFocus: 'traditional knowledge databases, digital libraries, repositories, archives, and comparative solution gaps',
    patterns: [
      /\b(?:tkdl|maori|unesco|repository|repositories|database|databases|digital librar|archive|archives|existing solution|comparison|comparative)\b/i,
    ],
  },
  {
    key: 'low_resource_ai',
    label: 'Low-resource AI and language technology evidence',
    queryFocus: 'large language models, low-resource languages, Llama/open-source models, fine-tuning, vernacular NLP, and specialized-domain adaptation',
    patterns: [
      /\b(?:llm|large language model|llama|open-source llm|fine.?tun|low.?resource|language model|nlp|vernacular|bilingual|specialized domain)\b/i,
    ],
  },
  {
    key: 'inclusive_digital_delivery',
    label: 'Inclusive digital delivery and learning evidence',
    queryFocus: 'voice interfaces, low-literacy mobile applications, adaptive learning, query-based retrieval, blended learning, and digital inclusion evidence',
    patterns: [
      /\b(?:voice|mobile app|mobile application|low.?literacy|adaptive learning|query.?based retrieval|blended learning|digital literacy|digital divide|community knowledge dissemination|bilingual module|vernacular audio)\b/i,
    ],
  },
  {
    key: 'participatory_methodology',
    label: 'Participatory implementation methodology evidence',
    queryFocus: 'participatory rural appraisal, train-the-trainer, community mobilization, validation, knowledge transfer, and capacity-building methodology evidence',
    patterns: [
      /\b(?:participatory|pra|rural appraisal|train.?the.?trainer|community mobilization|capacity building|capacity enhancement|validation|knowledge transfer|community trainer)\b/i,
    ],
  },
  {
    key: 'gap_and_impact',
    label: 'Problem gap and outcome evidence',
    queryFocus: 'documented gaps, disparities, sustainability risks, adverse outcomes, and measurable development impact evidence',
    patterns: [
      /\b(?:gap|gaps|disparit|adverse|outcome|impact|sustainability|erosion|loss|challenge|limitation|risk)\b/i,
    ],
  },
];

function strategyQueriesHaveProgress(
  queries: Array<{ status?: string | null; resultsCount?: number | null; importedCount?: number | null }>
): boolean {
  return queries.some((query) =>
    query.status !== 'PENDING'
    || (query.resultsCount || 0) > 0
    || (query.importedCount || 0) > 0
  );
}

function normalizeGrantSearchText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function grantSearchTokens(value: unknown): Set<string> {
  return new Set(
    normalizeGrantSearchText(value)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2 && !GRANT_QUERY_STOP_WORDS.has(token))
  );
}

function resolveGrantSearchTheme(target: GrantBlueprintDimensionTarget) {
  const text = `${target.sectionKey} ${target.dimension} ${target.dimensionType || ''}`;
  const scored = GRANT_SEARCH_THEMES
    .map((theme) => ({
      theme,
      score: theme.patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored[0]) return scored[0].theme;

  switch (target.dimensionType) {
    case 'methodological':
      return GRANT_SEARCH_THEMES.find((theme) => theme.key === 'participatory_methodology')!;
    case 'comparative':
      return GRANT_SEARCH_THEMES.find((theme) => theme.key === 'existing_solutions')!;
    case 'gap':
      return GRANT_SEARCH_THEMES.find((theme) => theme.key === 'gap_and_impact')!;
    case 'foundational':
      return GRANT_SEARCH_THEMES.find((theme) => theme.key === 'indigenous_knowledge')!;
    default:
      return {
        key: 'empirical_evidence',
        label: 'Empirical evidence',
        queryFocus: 'empirical studies and citeable evidence for the mapped grant dimension',
        patterns: [],
      };
  }
}

function splitGrantThemeTargets(targets: IndexedGrantDimensionTarget[]): IndexedGrantDimensionTarget[][] {
  const chunks: IndexedGrantDimensionTarget[][] = [];
  let current: IndexedGrantDimensionTarget[] = [];

  for (const target of targets) {
    if (current.length >= GRANT_STRATEGY_MAX_TARGETS_PER_QUERY) {
      chunks.push(current);
      current = [];
    }
    current.push(target);
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

function mergeSmallGrantBundles(bundles: GrantDimensionTargetBundle[]): GrantDimensionTargetBundle[] {
  const merged = [...bundles];

  while (merged.length > GRANT_STRATEGY_MAX_QUERY_COUNT) {
    let smallestIndex = 0;
    for (let index = 1; index < merged.length; index += 1) {
      if (merged[index].targets.length < merged[smallestIndex].targets.length) {
        smallestIndex = index;
      }
    }

    const [smallest] = merged.splice(smallestIndex, 1);
    const smallestTokens = grantSearchTokens(smallest.targets.map((target) => target.dimension).join(' '));
    let bestIndex = 0;
    let bestScore = -1;

    for (let index = 0; index < merged.length; index += 1) {
      const candidate = merged[index];
      const candidateTokens = grantSearchTokens(candidate.targets.map((target) => target.dimension).join(' '));
      const overlap = [...smallestTokens].filter((token) => candidateTokens.has(token)).length;
      const sameThemeBonus = candidate.theme === smallest.theme ? 3 : 0;
      const capacityPenalty = candidate.targets.length >= GRANT_STRATEGY_MAX_TARGETS_PER_QUERY ? -2 : 0;
      const score = overlap + sameThemeBonus + capacityPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    merged[bestIndex] = {
      ...merged[bestIndex],
      theme: merged[bestIndex].theme === smallest.theme ? merged[bestIndex].theme : `${merged[bestIndex].theme} / ${smallest.theme}`,
      queryFocus: `${merged[bestIndex].queryFocus}; ${smallest.queryFocus}`,
      targets: [...merged[bestIndex].targets, ...smallest.targets],
    };
  }

  return merged.map((bundle, index) => ({ ...bundle, id: `B${index + 1}` }));
}

function bundleGrantDimensionTargets(targets: IndexedGrantDimensionTarget[]): GrantDimensionTargetBundle[] {
  if (targets.length === 0) return [];

  const groups = new Map<string, { label: string; queryFocus: string; targets: IndexedGrantDimensionTarget[]; firstIndex: number }>();

  targets.forEach((target, index) => {
    const theme = resolveGrantSearchTheme(target);
    const current = groups.get(theme.key);
    if (current) {
      current.targets.push(target);
      return;
    }
    groups.set(theme.key, {
      label: theme.label,
      queryFocus: theme.queryFocus,
      targets: [target],
      firstIndex: index,
    });
  });

  const bundles = [...groups.values()]
    .sort((left, right) => left.firstIndex - right.firstIndex)
    .flatMap((group) =>
      splitGrantThemeTargets(group.targets).map((chunk) => ({
        id: '',
        theme: group.label,
        queryFocus: group.queryFocus,
        targets: chunk,
      }))
    )
    .map((bundle, index) => ({ ...bundle, id: `B${index + 1}` }));

  return mergeSmallGrantBundles(bundles);
}

function selectGrantSearchContextKeywords(
  keywords: string[],
  bundles: GrantDimensionTargetBundle[]
): string[] {
  const dimensionTokens = grantSearchTokens(
    bundles.flatMap((bundle) => bundle.targets.map((target) => target.dimension)).join(' ')
  );
  const seen = new Set<string>();
  const selected: string[] = [];

  for (const keyword of keywords) {
    const clean = String(keyword || '').trim().replace(/\s+/g, ' ');
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    if (clean.length > 60 || GRANT_ADMIN_QUERY_PATTERN.test(clean)) continue;
    if (/^\d+[%\s\w-]*$/.test(clean)) continue;

    const tokens = grantSearchTokens(clean);
    const overlapsDimension = [...tokens].some((token) => dimensionTokens.has(token));
    if (!overlapsDimension && selected.length >= 3) continue;

    seen.add(key);
    selected.push(clean);
    if (selected.length >= 8) break;
  }

  return selected;
}

async function getSessionForUser(
  sessionId: string,
  user: { id: string; roles?: string[]; tenantId?: string | null },
  capability: 'read' | 'editContent' = 'read'
) {
  return getDraftingSessionForUser(sessionId, user, capability, {
    include: { 
      researchTopic: true, 
      ideaRecord: true,
      paperType: true,
      paperBlueprint: true,
        citationSearchStrategy: {
          include: { queries: { orderBy: { priority: 'asc' } } }
        }
      }
  });
}

function buildStrategyPrompt(
  paperTitle: string,
  paperAbstract: string,
  keywords: string[],
  researchFocus: string
): string {
  return `You are an expert research librarian helping generate a systematic literature search strategy for academic paper writing.

PAPER INFORMATION:
Title: ${paperTitle}
Abstract/Description: ${paperAbstract}
Keywords: ${keywords.join(', ')}
Research Focus: ${researchFocus}

TASK:
Generate a comprehensive set of 6-10 search queries that will help find ALL relevant papers needed to write a complete academic manuscript. The queries should cover:

1. CORE_CONCEPTS - Main topic keywords and concepts
2. DOMAIN_APPLICATION - Field-specific and application papers
3. METHODOLOGY - Methods, techniques, algorithms relevant to the research
4. THEORETICAL_FOUNDATION - Foundational and seminal works (can be older)
5. SURVEYS_REVIEWS - Existing review papers and surveys
6. COMPETING_APPROACHES - Alternative methods, baselines, comparisons
7. RECENT_ADVANCES - Latest papers (2023-2024)
8. GAP_IDENTIFICATION - Papers that highlight limitations and gaps

For each query:
- Create SHORT, keyword-focused queries (3-7 words) optimized for academic search
- Do NOT use question format - use keyword combinations
- Suggest which search sources work best (semantic_scholar, openalex, pubmed, arxiv, crossref, core)
- Suggest year ranges where appropriate

Respond in JSON format ONLY:
{
  "summary": "<1-2 sentence overview of the search strategy>",
  "estimatedPapers": <estimated total papers to find across all queries>,
  "queries": [
    {
      "queryText": "<search query keywords>",
      "category": "<CORE_CONCEPTS|DOMAIN_APPLICATION|METHODOLOGY|THEORETICAL_FOUNDATION|SURVEYS_REVIEWS|COMPETING_APPROACHES|RECENT_ADVANCES|GAP_IDENTIFICATION>",
      "description": "<why this query is important, what papers it will find>",
      "priority": <1-10, execution order>,
      "suggestedSources": ["semantic_scholar", "openalex", ...],
      "suggestedYearFrom": <optional, e.g., 2020>,
      "suggestedYearTo": <optional, e.g., 2024>
    }
  ]
}

Generate queries that together provide COMPLETE coverage for writing Introduction, Literature Review, and Methodology sections.`;
}

function buildGrantDimensionStrategyPrompt(input: {
  paperTitle: string;
  paperAbstract: string;
  keywords: string[];
  researchFocus: string;
  bundles: GrantDimensionTargetBundle[];
}): string {
  const contextKeywords = selectGrantSearchContextKeywords(input.keywords, input.bundles);
  const bundlePayload = input.bundles.map((bundle) => ({
    bundleId: bundle.id,
    evidenceTheme: bundle.theme,
    queryFocus: bundle.queryFocus,
    targetIds: bundle.targets.map((target) => target.id),
    dimensions: bundle.targets.map((target) => ({
      id: target.id,
      sectionKey: target.sectionKey,
      dimensionType: target.dimensionType || 'empirical',
      dimension: target.dimension,
    })),
  }));
  const queryCount = input.bundles.length;
  const targetPaperCount = queryCount * GRANT_STRATEGY_RESULTS_PER_QUERY;

  return `You are an expert academic research librarian creating a literature search strategy for a grant-backed literature review.

The grant blueprint already exists. Your job is only to generate search queries that will retrieve papers useful for the listed blueprint dimensions.

PROJECT CONTEXT:
Title: ${input.paperTitle}
Abstract/Description: ${input.paperAbstract || 'Not provided'}
Research Focus: ${input.researchFocus || 'Not provided'}
Optional domain anchors: ${contextKeywords.join(', ') || 'Use the blueprint dimensions only'}

BLUEPRINT DIMENSION BUNDLES:
${JSON.stringify(bundlePayload)}

TASK:
Generate exactly ${queryCount} high-quality academic search queries, one query per evidence-theme bundle.
The app will retrieve about ${GRANT_STRATEGY_RESULTS_PER_QUERY} papers per query, so the total search pool should stay around ${targetPaperCount} papers before deduplication and relevance filtering.

Rules:
- Each output query must use one bundleId from the input.
- Each bundleId must be used exactly once.
- Use the bundle's targetIds exactly. Do not invent ids and do not split a bundle into multiple queries.
- Write short keyword search phrases, usually 4-8 words.
- Do not use question format.
- Build the query from the bundle evidenceTheme, queryFocus, and dimensions. Optional domain anchors are context, not a checklist.
- Do not stuff keywords from the grant prep. Never paste long lists of project-specific phrases into a query.
- Avoid administrative grant terms, dates, budgets, output counts, internal milestones, section labels, and exact proposal deliverables.
- Avoid generic phrases like "literature review", "grant", "proposal", or "project" unless genuinely useful.
- Prefer terms that will find empirical evidence, intervention studies, implementation evidence, comparisons, policy evidence, or evaluation metrics relevant to the targetIds.
- A good query should have one clear academic construct plus one domain/population/method anchor.
- If a bundle contains multiple dimensions, write the query around their shared evidence family. Do not combine unrelated concepts in one phrase.
- Keep the strategy selective. It should support selecting 20-30 final grant citations from roughly ${targetPaperCount} candidate papers, not broad harvesting.

Respond in JSON format ONLY:
{
  "summary": "<1-2 sentence overview of how the queries cover the grant dimensions>",
  "estimatedPapers": ${targetPaperCount},
  "queries": [
    {
      "bundleId": "B1",
      "queryText": "<keyword search phrase>",
      "category": "<CORE_CONCEPTS|DOMAIN_APPLICATION|METHODOLOGY|THEORETICAL_FOUNDATION|SURVEYS_REVIEWS|COMPETING_APPROACHES|RECENT_ADVANCES|GAP_IDENTIFICATION>",
      "description": "<what evidence this query should find for the mapped dimensions>",
      "priority": <1-${queryCount}>,
      "suggestedSources": ["semantic_scholar", "openalex", "crossref"],
      "suggestedYearFrom": <optional year>,
      "suggestedYearTo": <optional year>,
      "searchIntent": "<short snake_case intent>",
      "targetIds": ["exact ids from that bundle"]
    }
  ]
}`;
}

function parseJsonFromOutput(output: string): any {
  let cleaned = output.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const objectStart = cleaned.indexOf('{');
    const objectEnd = cleaned.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(cleaned.slice(objectStart, objectEnd + 1));
    }

    const arrayStart = cleaned.indexOf('[');
    const arrayEnd = cleaned.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1));
    }

    throw error;
  }
}

function normalizeSearchCategory(value: unknown): string {
  const category = String(value || '').trim();
  return VALID_SEARCH_QUERY_CATEGORIES.includes(category) ? category : 'CUSTOM';
}

function normalizeGrantGeneratedQueryText(value: unknown): string {
  const clean = String(value || '')
    .replace(/[“”"']/g, '')
    .replace(/\b(?:grant|proposal|project|literature review)\b/gi, ' ')
    .replace(/\b(?:crore|lakhs?|budget|manpower|stipends?|capital assets)\b/gi, ' ')
    .replace(/\b20[2-9]\d-\d{2}-\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= 10) return clean.slice(0, 200);
  return words.slice(0, 10).join(' ').slice(0, 200);
}

function parseStrategyResponse(output: string): LLMStrategyResponse {
  const parsed = parseJsonFromOutput(output);
  
  if (!parsed.queries || !Array.isArray(parsed.queries)) {
    throw new Error('Invalid response: missing queries array');
  }

  const queries: GeneratedQuery[] = parsed.queries.map((q: any, idx: number) => ({
    queryText: String(q.queryText || '').slice(0, 200),
    category: normalizeSearchCategory(q.category),
    description: String(q.description || 'Search query').slice(0, 500),
    priority: Number(q.priority) || idx + 1,
    suggestedSources: Array.isArray(q.suggestedSources) ? q.suggestedSources : DEFAULT_SEARCH_SOURCES,
    suggestedYearFrom: q.suggestedYearFrom ? Number(q.suggestedYearFrom) : undefined,
    suggestedYearTo: q.suggestedYearTo ? Number(q.suggestedYearTo) : undefined
  }));

  return {
    summary: String(parsed.summary || 'Search strategy generated'),
    estimatedPapers: Number(parsed.estimatedPapers) || 50,
    queries
  };
}

function parseGrantDimensionStrategyResponse(
  output: string,
  bundles: GrantDimensionTargetBundle[]
): LLMStrategyResponse {
  const parsed = parseJsonFromOutput(output);
  const rawQueries = Array.isArray(parsed) ? parsed : parsed.queries;
  if (!Array.isArray(rawQueries)) {
    throw new Error('Invalid response: missing queries array');
  }

  if (rawQueries.length < bundles.length) {
    throw new Error(`Invalid response: expected ${bundles.length} bundled queries, received ${rawQueries.length}`);
  }

  const targetById = new Map(bundles.flatMap((bundle) => bundle.targets).map((target) => [target.id, target]));
  const coveredTargetIds = new Set<string>();

  const queries = bundles
    .map((expectedBundle, idx): GeneratedQuery => {
      const q = rawQueries.find((candidate: any) =>
        String(candidate?.bundleId || '').trim() === expectedBundle.id
      ) || rawQueries[idx];

      const rawTargetIds = Array.isArray(q?.targetIds)
        ? q.targetIds
            .map((value: unknown) => String(value || '').trim())
            .filter((targetId: string) => targetById.has(targetId))
        : [];
      const rawTargetSet = new Set(rawTargetIds);
      const expectedTargetIds = expectedBundle.targets.map((target) => target.id);
      const targetIds = expectedTargetIds.every((targetId) => rawTargetSet.has(targetId))
        ? rawTargetIds.filter((targetId: string) => expectedTargetIds.includes(targetId))
        : expectedTargetIds;

      targetIds.forEach((targetId: string) => coveredTargetIds.add(targetId));

      return {
        queryText: normalizeGrantGeneratedQueryText(q?.queryText),
        category: normalizeSearchCategory(q?.category),
        description: String(q?.description || 'Search query').slice(0, 500),
        priority: idx + 1,
        suggestedSources: Array.isArray(q?.suggestedSources) && q.suggestedSources.length > 0
          ? q.suggestedSources.map((source: unknown) => String(source || '').trim()).filter(Boolean)
          : DEFAULT_SEARCH_SOURCES,
        suggestedYearFrom: q?.suggestedYearFrom ? Number(q.suggestedYearFrom) : undefined,
        suggestedYearTo: q?.suggestedYearTo ? Number(q.suggestedYearTo) : undefined,
        searchIntent: q?.searchIntent ? String(q.searchIntent).slice(0, 80) : undefined,
        resultLimit: GRANT_STRATEGY_RESULTS_PER_QUERY,
        targetIds,
        dimensionTargets: targetIds.map((targetId: string) => {
          const target = targetById.get(targetId)!;
          return {
            sectionKey: target.sectionKey,
            dimension: target.dimension,
            ...(target.dimensionType ? { dimensionType: target.dimensionType } : {}),
          };
        }),
      };
    })

  const emptyQuery = queries.find((query) => query.queryText.trim().length < 2);
  if (emptyQuery) {
    throw new Error('Invalid response: one or more bundled queries omitted queryText');
  }

  if (coveredTargetIds.size < targetById.size) {
    throw new Error(`Invalid response: omitted ${targetById.size - coveredTargetIds.size} blueprint dimension targets`);
  }

  return {
    summary: String(parsed.summary || `Search strategy covering ${targetById.size} blueprint dimensions`),
    estimatedPapers: queries.length * GRANT_STRATEGY_RESULTS_PER_QUERY,
    queries,
  };
}

function buildSuggestedFilters(query: GeneratedQuery): Prisma.InputJsonObject {
  const filters: Record<string, unknown> = {};
  if (query.searchIntent) {
    filters.searchIntent = query.searchIntent;
  }
  if (query.resultLimit) {
    filters.resultLimit = query.resultLimit;
  }
  if (query.dimensionTargets?.length) {
    filters.strategyVersion = 'grant_search_v2';
    filters.dimensionTargets = query.dimensionTargets.map((target) => ({
      sectionKey: target.sectionKey,
      dimension: target.dimension,
      ...(target.dimensionType ? { dimensionType: target.dimensionType } : {}),
    }));
  }
  return filters as Prisma.InputJsonObject;
}

// GET - Retrieve existing search strategy
export async function GET(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user, 'read');
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    if (!session.citationSearchStrategy) {
      return NextResponse.json({ 
        strategy: null,
        message: 'No search strategy generated yet'
      });
    }

    // Calculate progress
    const queries = session.citationSearchStrategy.queries;
    const hasGrantSearchV2Query = queries.some((query) =>
      (query.suggestedFilters as { strategyVersion?: string } | null)?.strategyVersion === 'grant_search_v2'
    );
    const isUnusedLegacyGrantStrategy =
      isGrantBackedPaperTypeCode(session.paperBlueprint?.paperTypeCode)
      && !hasGrantSearchV2Query
      && !strategyQueriesHaveProgress(queries);

    if (isUnusedLegacyGrantStrategy) {
      return NextResponse.json({
        strategy: null,
        message: 'Existing rule-built grant search strategy needs regeneration from the blueprint dimensions.',
        needsRegeneration: true,
      });
    }

    const completedQueries = queries.filter(q => 
      q.status === 'COMPLETED' || q.status === 'SKIPPED'
    ).length;
    const totalQueries = queries.length;
    const progress = totalQueries > 0 ? Math.round((completedQueries / totalQueries) * 100) : 0;
    const hydratedQueries = session.citationSearchStrategy.queries.map((q) => ({
      ...q,
      searchIntent: (q.suggestedFilters as { searchIntent?: string } | null)?.searchIntent || null,
      resultLimit: (q.suggestedFilters as { resultLimit?: number } | null)?.resultLimit || null,
      dimensionTargets: (q.suggestedFilters as { dimensionTargets?: unknown[] } | null)?.dimensionTargets || [],
    }));

    return NextResponse.json({
      strategy: {
        ...session.citationSearchStrategy,
        progress,
        completedQueries,
        totalQueries,
        queries: hydratedQueries,
      }
    });

  } catch (error) {
    console.error('[SearchStrategy] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch search strategy' }, { status: 500 });
  }
}

// POST - Generate new search strategy or add custom query
export async function POST(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user, 'editContent');
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const body = await request.json();
    
    // Check if this is adding a custom query
    if (body.queryText) {
      const data = addQuerySchema.parse(body);
      
      if (!session.citationSearchStrategy) {
        return NextResponse.json({ error: 'Generate a search strategy first' }, { status: 400 });
      }

      const maxPriority = Math.max(
        ...session.citationSearchStrategy.queries.map(q => q.priority),
        0
      );

      const newQuery = await prisma.citationSearchQuery.create({
        data: {
          strategyId: session.citationSearchStrategy.id,
          queryText: data.queryText,
          category: data.category as any,
          description: data.description || 'Custom search query',
          priority: maxPriority + 1,
          suggestedSources: ['semantic_scholar', 'openalex', 'crossref'],
          status: 'PENDING'
        }
      });

      return NextResponse.json({ query: newQuery }, { status: 201 });
    }

    // Generate new strategy
    const data = generateSchema.parse(body);

    // Get paper information for strategy generation
    const paperTitle = session.researchTopic?.title 
      || session.ideaRecord?.title 
      || 'Untitled Research';
    
    const paperAbstract = session.researchTopic?.abstractDraft
      || session.researchTopic?.researchQuestion
      || session.researchTopic?.problemStatement
      || session.ideaRecord?.problem
      || '';
    
    const keywords = session.researchTopic?.keywords || [];
    
    const researchFocus = session.researchTopic?.topicDescription
      || session.researchTopic?.researchGaps
      || session.researchTopic?.methodologyApproach
      || session.ideaRecord?.objectives
      || session.ideaRecord?.logic
      || '';

    const blueprintSectionPlan = Array.isArray(session.paperBlueprint?.sectionPlan)
      ? session.paperBlueprint.sectionPlan as any[]
      : [];
    const isGrantBackedBlueprint = isGrantBackedPaperTypeCode(session.paperBlueprint?.paperTypeCode);
    const grantDimensionTargets = isGrantBackedBlueprint
      ? extractGrantDimensionTargets(blueprintSectionPlan)
      : [];
    const indexedGrantDimensionTargets: IndexedGrantDimensionTarget[] = grantDimensionTargets.map((target, index) => ({
      ...target,
      id: `D${index + 1}`,
    }));
    const grantDimensionBundles = bundleGrantDimensionTargets(indexedGrantDimensionTargets);

    const existingGrantStrategyIsLegacy =
      isGrantBackedBlueprint
      && session.citationSearchStrategy?.aiModelUsed === 'grant_blueprint_bundle'
      && !strategyQueriesHaveProgress(session.citationSearchStrategy.queries);

    // Check if strategy already exists and regenerate is not requested.
    // Legacy grant_blueprint_bundle strategies are replaced automatically because they were rule-built.
    if (session.citationSearchStrategy && !data.regenerate && !existingGrantStrategyIsLegacy) {
      return NextResponse.json({ 
        error: 'Search strategy already exists. Set regenerate: true to create a new one.',
        strategy: session.citationSearchStrategy
      }, { status: 409 });
    }

    if (isGrantBackedBlueprint && grantDimensionTargets.length === 0) {
      return NextResponse.json({
        error: 'Generate literature-review dimensions in the Blueprint stage before creating a grant-backed search strategy.'
      }, { status: 400 });
    }

    if (!paperAbstract && !researchFocus && !isGrantBackedBlueprint) {
      return NextResponse.json({ 
        error: 'Please complete the Research Topic stage first to generate search strategy' 
      }, { status: 400 });
    }

    let strategyData: LLMStrategyResponse;
    let aiModelUsed = 'unknown';
    const authHeader = request.headers.get('authorization') || '';

    if (isGrantBackedBlueprint) {
      const prompt = buildGrantDimensionStrategyPrompt({
        paperTitle,
        paperAbstract,
        keywords,
        researchFocus,
        bundles: grantDimensionBundles,
      });

      const llmResult = await llmGateway.executeLLMOperation(
        { headers: { authorization: authHeader } },
        {
          taskCode: 'SEARCH_STRATEGY_GEN',
          stageCode: 'LITERATURE_SEARCH',
          prompt,
          parameters: { temperature: 0.25 },
          idempotencyKey: `grant-search-strategy-${sessionId}-${Date.now()}`,
          metadata: {
            sessionId,
            skipFeaturePolicy: true,
            primaryModelCode: 'gemini-2.5-pro',
            disableModelFallbacks: true,
          }
        }
      );

      if (!llmResult.success || !llmResult.response) {
        console.error('[SearchStrategy] Grant dimension LLM call failed:', llmResult.error);
        return NextResponse.json({ 
          error: llmResult.error?.message || 'Failed to generate grant dimension search strategy' 
        }, { status: 500 });
      }

      try {
        strategyData = parseGrantDimensionStrategyResponse(
          llmResult.response.output,
          grantDimensionBundles
        );
        aiModelUsed = llmResult.response.modelClass || 'gemini-2.5-pro';
      } catch (parseError) {
        console.error('[SearchStrategy] Grant dimension parse error:', parseError);
        return NextResponse.json({
          error: parseError instanceof Error
            ? `Failed to parse AI dimension search strategy response: ${parseError.message}`
            : 'Failed to parse AI dimension search strategy response'
        }, { status: 500 });
      }
    } else {
      const prompt = buildStrategyPrompt(paperTitle, paperAbstract, keywords, researchFocus);

      const llmResult = await llmGateway.executeLLMOperation(
        { headers: { authorization: authHeader } },
        {
          taskCode: 'SEARCH_STRATEGY_GEN',
          stageCode: 'LITERATURE_SEARCH',
          prompt,
          parameters: { temperature: 0.4 },
          idempotencyKey: `search-strategy-${sessionId}-${Date.now()}`,
          metadata: {
            sessionId,
            skipFeaturePolicy: true,
          }
        }
      );

      if (!llmResult.success || !llmResult.response) {
        console.error('[SearchStrategy] LLM call failed:', llmResult.error);
        return NextResponse.json({ 
          error: llmResult.error?.message || 'Failed to generate search strategy' 
        }, { status: 500 });
      }

      try {
        strategyData = parseStrategyResponse(llmResult.response.output);
        aiModelUsed = llmResult.response.modelClass || 'unknown';
      } catch (parseError) {
        console.error('[SearchStrategy] Parse error:', parseError);
        return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
      }
    }

    // Delete existing strategy if regenerating
    if (session.citationSearchStrategy) {
      await prisma.citationSearchStrategy.delete({
        where: { id: session.citationSearchStrategy.id }
      });
    }

    // Create new strategy with queries
    const strategy = await prisma.citationSearchStrategy.create({
      data: {
        sessionId,
        paperTitle,
        paperAbstract,
        keywords,
        researchFocus,
        summary: strategyData.summary,
        estimatedPapers: strategyData.estimatedPapers,
        aiModelUsed,
        status: 'READY',
        queries: {
          create: strategyData.queries.map(q => ({
            queryText: q.queryText,
            category: q.category as any,
            description: q.description,
            priority: q.priority,
            suggestedSources: q.suggestedSources,
            suggestedYearFrom: q.suggestedYearFrom,
            suggestedYearTo: q.suggestedYearTo,
            suggestedFilters: buildSuggestedFilters(q),
            status: 'PENDING'
          }))
        }
      },
      include: {
        queries: { orderBy: { priority: 'asc' } }
      }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        tenantId: user.tenantId || null,
        action: 'SEARCH_STRATEGY_GENERATED',
        resource: `drafting_session:${sessionId}`,
        meta: {
          strategyId: strategy.id,
          queryCount: strategy.queries.length,
          estimatedPapers: strategy.estimatedPapers
        }
      }
    });

    return NextResponse.json({
      strategy: {
        ...strategy,
        progress: 0,
        completedQueries: 0,
        totalQueries: strategy.queries.length,
        queries: strategy.queries.map((q) => ({
          ...q,
          searchIntent: (q.suggestedFilters as { searchIntent?: string } | null)?.searchIntent || null,
          resultLimit: (q.suggestedFilters as { resultLimit?: number } | null)?.resultLimit || null,
          dimensionTargets: (q.suggestedFilters as { dimensionTargets?: unknown[] } | null)?.dimensionTargets || [],
        })),
      }
    }, { status: 201 });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }
    console.error('[SearchStrategy] POST error:', error);
    return NextResponse.json({ error: 'Failed to generate search strategy' }, { status: 500 });
  }
}

// PATCH - Update query status
export async function PATCH(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user, 'editContent');
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    if (!session.citationSearchStrategy) {
      return NextResponse.json({ error: 'No search strategy found' }, { status: 404 });
    }

    const body = await request.json();
    const data = updateQuerySchema.parse(body);

    if (
      data.suggestedYearFrom !== undefined &&
      data.suggestedYearTo !== undefined &&
      data.suggestedYearFrom !== null &&
      data.suggestedYearTo !== null &&
      data.suggestedYearFrom > data.suggestedYearTo
    ) {
      return NextResponse.json(
        { error: 'suggestedYearFrom must be less than or equal to suggestedYearTo' },
        { status: 400 }
      );
    }

    // Verify query belongs to this strategy
    const query = await prisma.citationSearchQuery.findFirst({
      where: {
        id: data.queryId,
        strategyId: session.citationSearchStrategy.id
      }
    });

    if (!query) {
      return NextResponse.json({ error: 'Query not found' }, { status: 404 });
    }

    // Update query
    const updateData: any = {};
    if (data.status) {
      updateData.status = data.status;
      if (data.status === 'SEARCHED' || data.status === 'COMPLETED') {
        updateData.searchedAt = new Date();
      }
    }
    if (data.resultsCount !== undefined) updateData.resultsCount = data.resultsCount;
    if (data.importedCount !== undefined) updateData.importedCount = data.importedCount;
    if (data.userNotes !== undefined) updateData.userNotes = data.userNotes;
    if (data.queryText !== undefined) updateData.queryText = data.queryText.trim();
    if (data.description !== undefined) updateData.description = data.description.trim();
    if (data.category !== undefined) updateData.category = data.category;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.suggestedSources !== undefined) updateData.suggestedSources = data.suggestedSources;
    if (data.suggestedYearFrom !== undefined) updateData.suggestedYearFrom = data.suggestedYearFrom;
    if (data.suggestedYearTo !== undefined) updateData.suggestedYearTo = data.suggestedYearTo;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No query fields provided to update' }, { status: 400 });
    }

    const updatedQuery = await prisma.citationSearchQuery.update({
      where: { id: data.queryId },
      data: updateData
    });

    // Check if all queries are completed to update strategy status
    const allQueries = await prisma.citationSearchQuery.findMany({
      where: { strategyId: session.citationSearchStrategy.id }
    });

    const allCompleted = allQueries.every(q => 
      q.status === 'COMPLETED' || q.status === 'SKIPPED'
    );
    const anyInProgress = allQueries.some(q => 
      q.status === 'SEARCHING' || q.status === 'SEARCHED'
    );

    let newStrategyStatus = session.citationSearchStrategy.status;
    if (allCompleted) {
      newStrategyStatus = 'COMPLETED';
    } else if (anyInProgress || allQueries.some(q => q.status === 'COMPLETED')) {
      newStrategyStatus = 'IN_PROGRESS';
    }

    if (newStrategyStatus !== session.citationSearchStrategy.status) {
      await prisma.citationSearchStrategy.update({
        where: { id: session.citationSearchStrategy.id },
        data: { 
          status: newStrategyStatus as any,
          completedAt: allCompleted ? new Date() : null
        }
      });
    }

    return NextResponse.json({ 
      query: updatedQuery,
      strategyStatus: newStrategyStatus
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }
    console.error('[SearchStrategy] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update query' }, { status: 500 });
  }
}

// DELETE - Delete a custom query
export async function DELETE(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user, 'editContent');
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    if (!session.citationSearchStrategy) {
      return NextResponse.json({ error: 'No search strategy found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const queryId = searchParams.get('queryId');

    if (!queryId) {
      return NextResponse.json({ error: 'queryId is required' }, { status: 400 });
    }

    // Verify query belongs to this strategy and is custom
    const query = await prisma.citationSearchQuery.findFirst({
      where: {
        id: queryId,
        strategyId: session.citationSearchStrategy.id
      }
    });

    if (!query) {
      return NextResponse.json({ error: 'Query not found' }, { status: 404 });
    }

    await prisma.citationSearchQuery.delete({
      where: { id: queryId }
    });

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('[SearchStrategy] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete query' }, { status: 500 });
  }
}

