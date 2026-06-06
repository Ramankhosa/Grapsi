import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { extractGrantDimensionTargets, isGrantBackedPaperTypeCode } from '@/lib/grants/blueprintMetadata';
import {
  GRANT_SEARCH_RESULT_LIMIT,
  GRANT_SEARCH_STRATEGY_VERSION,
} from '@/lib/grants/searchStrategy';
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
  mode: 'focused' | 'broad';
  targets: IndexedGrantDimensionTarget[];
};

const GRANT_STRATEGY_MAX_QUERY_COUNT = 14;
const GRANT_STRATEGY_MAX_TARGETS_PER_QUERY = 4;
const GRANT_STRATEGY_FOCUSED_QUERY_RESERVE = 8;
const GRANT_STRATEGY_RESULTS_PER_QUERY = GRANT_SEARCH_RESULT_LIMIT;

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
    key: 'need_baseline',
    label: 'Need, burden, and baseline evidence',
    queryFocus: 'prevalence, burden, incidence, costs, affected population, baseline conditions, and urgency evidence',
    patterns: [
      /\b(?:need|burden|baseline|prevalence|incidence|morbidity|mortality|cost|affected|population|demographic|socio.?economic|urgency|demand|underserved|vulnerable|rural|urban|community)\b/i,
    ],
  },
  {
    key: 'gap_landscape',
    label: 'Gap, barrier, and current landscape evidence',
    queryFocus: 'current state of practice, evidence gaps, barriers, limitations, unmet needs, and insufficiency of existing responses',
    patterns: [
      /\b(?:gap|barrier|limitation|challenge|constraint|unmet|insufficient|shortfall|bottleneck|state of art|state of the art|current landscape|existing evidence|evidence landscape)\b/i,
    ],
  },
  {
    key: 'approach_feasibility',
    label: 'Implementation feasibility and adoption evidence',
    queryFocus: 'implementation studies, pilot programs, deployment, adoption, delivery models, operational feasibility, and scale-up precedent',
    patterns: [
      /\b(?:feasib|implementation|pilot|deployment|delivery|adoption|uptake|operational|scale.?up|scaling|readiness|workflow|field implementation)\b/i,
    ],
  },
  {
    key: 'method_validation',
    label: 'Method validation and benchmark evidence',
    queryFocus: 'validation studies, measurement reliability, evaluation methods, benchmarks, indicators, protocols, and methodological evidence',
    patterns: [
      /\b(?:validation|validated|benchmark|reliability|measurement|indicator|protocol|evaluation design|method|methodology|assessment|metric)\b/i,
    ],
  },
  {
    key: 'precedent_comparison',
    label: 'Precedent, comparison, and current practice evidence',
    queryFocus: 'comparable interventions, alternative approaches, current practice, benchmarks, precedent, and comparative evidence',
    patterns: [
      /\b(?:comparison|comparative|precedent|current practice|alternative|benchmark against|advantage|existing solution|similar intervention|related intervention)\b/i,
    ],
  },
  {
    key: 'impact_outcomes',
    label: 'Impact and outcome evidence',
    queryFocus: 'measurable outcomes, effect sizes, impact metrics, improvements, benefits, success rates, and adoption results',
    patterns: [
      /\b(?:outcome|impact|effect size|improvement|reduction|increase|success rate|result metric|benefit|performance|development|growth|adoption result)\b/i,
    ],
  },
  {
    key: 'policy_alignment',
    label: 'Policy, framework, and priority evidence',
    queryFocus: 'policy frameworks, strategies, priorities, roadmaps, institutional programs, and funder or mission alignment evidence',
    patterns: [
      /\b(?:policy|strategy|framework|priority|mission|roadmap|scheme|guideline|program alignment|institutional|government|agency)\b/i,
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
      return GRANT_SEARCH_THEMES.find((theme) => theme.key === 'method_validation')!;
    case 'comparative':
      return GRANT_SEARCH_THEMES.find((theme) => theme.key === 'precedent_comparison')!;
    case 'gap':
      return GRANT_SEARCH_THEMES.find((theme) => theme.key === 'gap_landscape')!;
    case 'foundational':
      return GRANT_SEARCH_THEMES.find((theme) => theme.key === 'need_baseline')!;
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

function mergeSmallGrantBundles(
  bundles: GrantDimensionTargetBundle[],
  maxCount: number = GRANT_STRATEGY_MAX_QUERY_COUNT
): GrantDimensionTargetBundle[] {
  const merged = [...bundles];

  while (merged.length > maxCount) {
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
        mode: 'focused' as const,
        targets: chunk,
      }))
    )
    .map((bundle, index) => ({ ...bundle, id: `B${index + 1}` }));

  const focusedBundles = mergeSmallGrantBundles(
    bundles,
    Math.min(GRANT_STRATEGY_FOCUSED_QUERY_RESERVE, GRANT_STRATEGY_MAX_QUERY_COUNT)
  );
  const broadBundles = buildBroadGrantDiscoveryBundles(
    targets,
    GRANT_STRATEGY_MAX_QUERY_COUNT - focusedBundles.length
  );

  return [...focusedBundles, ...broadBundles].map((bundle, index) => ({ ...bundle, id: `B${index + 1}` }));
}

function buildBroadGrantDiscoveryBundles(
  targets: IndexedGrantDimensionTarget[],
  availableSlots: number
): GrantDimensionTargetBundle[] {
  if (availableSlots <= 0 || targets.length === 0) return [];

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

  return [...groups.values()]
    .sort((left, right) => right.targets.length - left.targets.length || left.firstIndex - right.firstIndex)
    .slice(0, Math.min(2, availableSlots))
    .map((group, index) => ({
      id: `BROAD${index + 1}`,
      theme: `Broad discovery: ${group.label}`,
      queryFocus: `Use academic title/abstract language to find ${group.queryFocus}. Do not rely on exact proposal wording.`,
      mode: 'broad' as const,
      targets: group.targets.slice(0, 6),
    }));
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
    bundleMode: bundle.mode,
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
  const minimumQueryCount = Math.min(
    GRANT_STRATEGY_MAX_QUERY_COUNT,
    Math.max(
      input.bundles.length,
      input.bundles.length + Math.min(4, Math.ceil(input.bundles.length / 2))
    )
  );
  const maximumQueryCount = GRANT_STRATEGY_MAX_QUERY_COUNT;
  const targetPaperCountMin = minimumQueryCount * GRANT_STRATEGY_RESULTS_PER_QUERY;
  const targetPaperCountMax = maximumQueryCount * GRANT_STRATEGY_RESULTS_PER_QUERY;

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
Generate ${minimumQueryCount}-${maximumQueryCount} high-quality academic search queries.
The app will retrieve about ${GRANT_STRATEGY_RESULTS_PER_QUERY} papers per query, so the total search pool should stay around ${targetPaperCountMin}-${targetPaperCountMax} papers before deduplication and relevance filtering.

Rules:
- Each output query must use one bundleId from the input.
- Each bundleId must appear at least once. Important bundles may appear 2-3 times using different wording.
- Use only targetIds from the selected bundleId. Do not invent ids.
- Write short keyword search phrases, usually 3-8 words.
- Do not use question format.
- Build the query from the bundle evidenceTheme, queryFocus, bundleMode, and dimensions. Optional domain anchors are context, not a checklist.
- Do not stuff keywords from the grant prep. Never paste long lists of project-specific phrases into a query.
- Avoid administrative grant terms, dates, budgets, output counts, internal milestones, section labels, and exact proposal deliverables.
- Avoid generic phrases like "literature review", "grant", "proposal", or "project" unless genuinely useful.
- Generate a recall-first variant before a highly specific variant for the central evidence theme. Use researcher search vocabulary likely to appear in titles and abstracts.
- Include synonym variants for the core technical/social construct when relevant. Examples: "generative AI", "ChatGPT", "large language models", "LLM", "GPT", "automation", "AI tools".
- Include domain/labor vocabulary when relevant. Examples: "job market", "employment", "workforce", "occupational exposure", "job displacement", "augmentation", "skills", "reskilling", "software developers", "coding jobs", "programmers".
- Keep geography such as India, Taiwan, district names, or institution names out of the first recall query unless the bundle specifically needs country-policy evidence. Put geography in a separate policy/comparative query.
- For bundleMode "focused", make at least one selective query tied to the target dimensions and one evidence role such as need, gap, feasibility, validation, impact, precedent, policy fit, or evidence boundary.
- For bundleMode "broad", use academic title/abstract language that may not match the proposal wording exactly. Prefer broader population, setting, intervention, method, policy, evaluation, or outcome terms.
- Prefer terms that will find empirical evidence, intervention studies, implementation evidence, comparisons, policy evidence, evaluation metrics, or evidence boundaries relevant to the targetIds.
- A good query should have one clear academic construct plus one domain/population/method anchor.
- If a bundle contains multiple dimensions, write each query around their shared evidence family or a valid subset of targetIds. Do not combine unrelated concepts in one phrase.
- Do not overfit to proposal wording like "socio-technical resilience" if papers are more likely indexed under "labor market adjustment", "occupational exposure", "workforce transition", or another standard academic phrase.
- The strategy should support selecting 20-30 final Grant Citations from roughly ${targetPaperCountMin}-${targetPaperCountMax} candidate papers with enough recall to avoid missing obvious relevant work.
- searchIntent must start with "focused_" for focused bundles and "broad_discovery_" for broad bundles.

Respond in JSON format ONLY:
{
  "summary": "<1-2 sentence overview of how the queries cover the grant dimensions>",
  "estimatedPapers": <number between ${targetPaperCountMin} and ${targetPaperCountMax}>,
  "queries": [
    {
      "bundleId": "B1",
      "queryText": "<keyword search phrase>",
      "category": "<CORE_CONCEPTS|DOMAIN_APPLICATION|METHODOLOGY|THEORETICAL_FOUNDATION|SURVEYS_REVIEWS|COMPETING_APPROACHES|RECENT_ADVANCES|GAP_IDENTIFICATION>",
      "description": "<what evidence this query should find for the mapped dimensions>",
      "priority": <1-${maximumQueryCount}>,
      "suggestedSources": ["semantic_scholar", "openalex", "crossref"],
      "suggestedYearFrom": <optional year>,
      "suggestedYearTo": <optional year>,
      "searchIntent": "<focused_or_broad_discovery_snake_case_intent>",
      "targetIds": ["one or more exact ids from that bundle"]
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

function normalizeGrantSearchIntent(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 70);
}

function resolveGrantSearchIntent(value: unknown, bundle: GrantDimensionTargetBundle): string {
  const prefix = bundle.mode === 'broad' ? 'broad_discovery' : 'focused';
  const normalized = normalizeGrantSearchIntent(value);
  if (!normalized) {
    return `${prefix}_${normalizeGrantSearchIntent(bundle.theme || bundle.queryFocus) || 'grant_evidence'}`.slice(0, 80);
  }
  if (normalized.startsWith(`${prefix}_`)) {
    return normalized.slice(0, 80);
  }
  const unprefixed = normalized
    .replace(/^focused_/, '')
    .replace(/^broad_discovery_/, '');
  return `${prefix}_${unprefixed || 'grant_evidence'}`.slice(0, 80);
}

function buildGrantFallbackQueryText(bundle: GrantDimensionTargetBundle): string {
  const text = normalizeGrantSearchText([
    bundle.theme,
    bundle.queryFocus,
    ...bundle.targets.map((target) => target.dimension),
  ].join(' '));

  const phrases: string[] = [];
  if (/\b(?:generative|chatgpt|gpt|llm|language models?)\b/i.test(text)) {
    phrases.push('generative AI');
  } else if (/\bai\b|artificial intelligence/i.test(text)) {
    phrases.push('artificial intelligence');
  }

  if (/\b(?:labor|labour|employment|jobs?|workforce|occupational)\b/i.test(text)) {
    phrases.push('labor market workforce');
  }
  if (/\b(?:software|coding|programmer|developer|it sector)\b/i.test(text)) {
    phrases.push('software developers jobs');
  }
  if (/\b(?:skill|reskill|upskill|training)\b/i.test(text)) {
    phrases.push('reskilling skills');
  }
  if (/\b(?:policy|roadmap|framework|government|institutional)\b/i.test(text)) {
    phrases.push('policy framework');
  }
  if (/\b(?:barrier|gap|challenge|constraint)\b/i.test(text)) {
    phrases.push('barriers challenges');
  }
  if (/\b(?:survey|methodology|method|evaluation|assessment)\b/i.test(text)) {
    phrases.push('survey methodology');
  }

  const fallbackTokens = [...grantSearchTokens(text)].slice(0, 7);
  const query = [...phrases.join(' ').split(/\s+/), ...fallbackTokens]
    .map((token) => token.trim())
    .filter(Boolean);

  return Array.from(new Set(query)).slice(0, 8).join(' ') || 'grant evidence implementation outcomes';
}

function limitGrantQueriesPreservingCoverage(
  queries: GeneratedQuery[],
  bundles: GrantDimensionTargetBundle[]
): GeneratedQuery[] {
  const sorted = [...queries].sort((left, right) => left.priority - right.priority);
  if (sorted.length <= GRANT_STRATEGY_MAX_QUERY_COUNT) {
    return sorted.map((query, index) => ({ ...query, priority: index + 1 }));
  }

  const selected: GeneratedQuery[] = [];
  const selectedKeys = new Set<string>();
  const uncoveredTargetIds = new Set(bundles.flatMap((bundle) => bundle.targets.map((target) => target.id)));

  const addQuery = (query: GeneratedQuery | undefined) => {
    if (!query) return;
    const key = query.queryText.toLowerCase();
    if (selectedKeys.has(key)) return;
    selected.push(query);
    selectedKeys.add(key);
    for (const targetId of query.targetIds || []) {
      uncoveredTargetIds.delete(targetId);
    }
  };

  while (uncoveredTargetIds.size > 0 && selected.length < GRANT_STRATEGY_MAX_QUERY_COUNT) {
    const next = sorted
      .filter((query) => !selectedKeys.has(query.queryText.toLowerCase()))
      .map((query) => ({
        query,
        coverage: (query.targetIds || []).filter((targetId) => uncoveredTargetIds.has(targetId)).length,
      }))
      .filter((candidate) => candidate.coverage > 0)
      .sort((left, right) => right.coverage - left.coverage || left.query.priority - right.query.priority)[0]?.query;
    if (!next) break;
    addQuery(next);
  }

  for (const query of sorted) {
    if (selected.length >= GRANT_STRATEGY_MAX_QUERY_COUNT) break;
    addQuery(query);
  }

  return selected
    .slice(0, GRANT_STRATEGY_MAX_QUERY_COUNT)
    .map((query, index) => ({ ...query, priority: index + 1 }));
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

  const targetById = new Map(bundles.flatMap((bundle) => bundle.targets).map((target) => [target.id, target]));
  const bundleById = new Map(bundles.map((bundle) => [bundle.id, bundle]));
  const coveredTargetIds = new Set<string>();
  const seenQueryTexts = new Set<string>();

  const queries: GeneratedQuery[] = [];

  rawQueries.forEach((q: any, idx: number) => {
    const requestedBundleId = String(q?.bundleId || '').trim();
    const expectedBundle = bundleById.get(requestedBundleId) || bundles[idx % bundles.length];
    if (!expectedBundle) return;

    const expectedTargetIds = expectedBundle.targets.map((target) => target.id);
    const expectedTargetSet = new Set(expectedTargetIds);
    const rawTargetIds: string[] = Array.isArray(q?.targetIds)
      ? q.targetIds
          .map((value: unknown) => String(value || '').trim())
          .filter((targetId: string) => targetById.has(targetId) && expectedTargetSet.has(targetId))
      : [];
    const targetIds: string[] = rawTargetIds.length > 0 ? Array.from(new Set(rawTargetIds)) : expectedTargetIds;
    const queryText = normalizeGrantGeneratedQueryText(q?.queryText);
    const queryKey = queryText.toLowerCase();
    if (queryText.trim().length < 2 || seenQueryTexts.has(queryKey)) return;

    seenQueryTexts.add(queryKey);
    targetIds.forEach((targetId: string) => coveredTargetIds.add(targetId));

    queries.push({
      queryText,
      category: normalizeSearchCategory(q?.category),
      description: String(q?.description || 'Search query').slice(0, 500),
      priority: Number(q?.priority) || idx + 1,
      suggestedSources: Array.isArray(q?.suggestedSources) && q.suggestedSources.length > 0
        ? q.suggestedSources.map((source: unknown) => String(source || '').trim()).filter(Boolean)
        : DEFAULT_SEARCH_SOURCES,
      suggestedYearFrom: q?.suggestedYearFrom ? Number(q.suggestedYearFrom) : undefined,
      suggestedYearTo: q?.suggestedYearTo ? Number(q.suggestedYearTo) : undefined,
      searchIntent: resolveGrantSearchIntent(q?.searchIntent || expectedBundle.theme, expectedBundle),
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
    });
  });

  for (const bundle of bundles) {
    const missingTargetIds = bundle.targets
      .map((target) => target.id)
      .filter((targetId) => !coveredTargetIds.has(targetId));
    if (missingTargetIds.length === 0) continue;

    const queryText = normalizeGrantGeneratedQueryText(buildGrantFallbackQueryText(bundle));
    const queryKey = queryText.toLowerCase();
    if (seenQueryTexts.has(queryKey)) continue;

    seenQueryTexts.add(queryKey);
    missingTargetIds.forEach((targetId) => coveredTargetIds.add(targetId));
    queries.push({
      queryText,
      category: normalizeSearchCategory(bundle.targets[0]?.dimensionType === 'gap' ? 'GAP_IDENTIFICATION' : 'CORE_CONCEPTS'),
      description: `Fallback recall query for ${bundle.theme}.`.slice(0, 500),
      priority: queries.length + 1,
      suggestedSources: DEFAULT_SEARCH_SOURCES,
      searchIntent: resolveGrantSearchIntent(bundle.theme, bundle),
      resultLimit: GRANT_STRATEGY_RESULTS_PER_QUERY,
      targetIds: missingTargetIds,
      dimensionTargets: missingTargetIds.map((targetId: string) => {
        const target = targetById.get(targetId)!;
        return {
          sectionKey: target.sectionKey,
          dimension: target.dimension,
          ...(target.dimensionType ? { dimensionType: target.dimensionType } : {}),
        };
      }),
    });
  }

  const limitedQueries = limitGrantQueriesPreservingCoverage(queries, bundles);

  const emptyQuery = limitedQueries.find((query) => query.queryText.trim().length < 2);
  if (emptyQuery) {
    throw new Error('Invalid response: one or more bundled queries omitted queryText');
  }

  const finalCoveredTargetIds = new Set(limitedQueries.flatMap((query) => query.targetIds || []));
  if (finalCoveredTargetIds.size < targetById.size) {
    throw new Error(`Invalid response: omitted ${targetById.size - finalCoveredTargetIds.size} blueprint dimension targets`);
  }

  return {
    summary: String(parsed.summary || `Search strategy covering ${targetById.size} blueprint dimensions`),
    estimatedPapers: Number(parsed.estimatedPapers) || limitedQueries.length * GRANT_STRATEGY_RESULTS_PER_QUERY,
    queries: limitedQueries,
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
    filters.strategyVersion = GRANT_SEARCH_STRATEGY_VERSION;
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
    const hasCurrentGrantSearchQuery = queries.some((query) =>
      (query.suggestedFilters as { strategyVersion?: string } | null)?.strategyVersion === GRANT_SEARCH_STRATEGY_VERSION
    );
    const isUnusedLegacyGrantStrategy =
      isGrantBackedPaperTypeCode(session.paperBlueprint?.paperTypeCode)
      && !hasCurrentGrantSearchQuery
      && !strategyQueriesHaveProgress(queries);

    if (isUnusedLegacyGrantStrategy) {
      return NextResponse.json({
        strategy: null,
        message: 'Existing grant search strategy needs regeneration from the current grant-aligned strategy.',
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
      && !!session.citationSearchStrategy
      && !session.citationSearchStrategy.queries.some((query) =>
        (query.suggestedFilters as { strategyVersion?: string } | null)?.strategyVersion === GRANT_SEARCH_STRATEGY_VERSION
      )
      && !strategyQueriesHaveProgress(session.citationSearchStrategy.queries);

    // Check if strategy already exists and regenerate is not requested.
    // Legacy grant strategies are replaced automatically before they have user progress.
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

