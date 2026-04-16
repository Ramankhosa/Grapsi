import { llmGateway, executePatentDrafting } from './metering/gateway';
import { prisma } from './prisma';
import { MeteringError } from './metering/errors';
import { verifyJWT } from './auth';
import {
  getCountryProfile,
  getDraftingPrompts,
  getBaseStyle,
  getGlobalRules,
  getSectionRules
} from '@/lib/country-profile-service';
import {
  getWritingSample,
  buildWritingSampleBlock,
  getSectionStyleHints,
  type WritingSampleContext
} from '@/lib/writing-sample-service';
import {
  getSectionContextRequirements,
  getFiguresForJurisdiction,
  isNonApplicableHeading,
  type SectionContextRequirements
} from '@/lib/multi-jurisdiction-service';
import { getSectionStageCode } from '@/lib/metering/section-stage-mapping';
import {
  buildUniversalDraftingBundle,
  buildAntiHallucinationGuards
} from '@/lib/section-injection-config';
import crypto from 'crypto';
import { featureFlags, isPaperWritingMode, isPatentDraftingMode } from './feature-flags';
import { citationService, type CitationWithUsage } from './services/citation-service';
import { citationStyleService, type CitationData } from './services/citation-style-service';
import { paperTypeService } from './services/paper-type-service';
import { evidencePackService, type SectionEvidencePack } from './services/evidence-pack-service';
import {
  buildCitationKeyLookup as buildCitationKeyLookupUtil,
  normalizeCitationKey as normalizeCitationKeyUtil,
  resolveCitationKeyFromLookup,
  splitCitationKeyList as splitCitationKeyListUtil,
  looksLikeCitationKey as looksLikeCitationKeyUtil
} from '@/lib/utils/citation-key-normalization';

// NOTE: Legacy SUPERSET_PROMPTS removed - all prompts now come from database
// Base prompts are stored in SupersetSection table
// Country-specific top-up prompts are stored in CountrySectionPrompt table

export interface IdeaNormalizationRequest {
  rawIdea: string;
  title: string;
  tenantId?: string;
}

export interface IdeaNormalizationResult {
  success: boolean;
  normalizedData?: any;
  extractedFields?: {
    title?: string;
    researchQuestion?: string;
    hypothesis?: string | null;
    keywords?: string[];
    methodology?: string[];
    contributionType?: string[];
    searchQuery?: string;
    problem?: string;
    objectives?: string;
    components?: any[];
    logic?: string;
    inputs?: string;
    outputs?: string;
    variants?: string;
    inventionType?: string[];
    bestMethod?: string;
    fieldOfRelevance?: string;
    subfield?: string;
    recommendedFocus?: string;
    complianceNotes?: string;
    drawingsFocus?: string;
    claimStrategy?: string;
    riskFlags?: string;
    abstract?: string;
    cpcCodes?: string[];
    ipcCodes?: string[];
  };
  llmPrompt?: string;
  llmResponse?: any;
  tokensUsed?: number;
  error?: string;
}

export interface ComponentValidationResult {
  valid: boolean;
  components?: any;
  errors?: string[];
}

export interface PlantUMLGenerationResult {
  success: boolean;
  plantumlCode?: string;
  checksum?: string;
  error?: string;
}

export interface AnnexureDraftResult {
  success: boolean;
  draft?: {
    title: string;
    fieldOfInvention?: string;
    crossReference?: string;
    background?: string;
    summary?: string;
    briefDescriptionOfDrawings?: string;
    detailedDescription?: string;
    bestMethod?: string;
    claims?: string;
    abstract?: string;
    listOfNumerals?: string;
    fullText: string;
  };
  isValid?: boolean;
  validationReport?: any;
  llmPrompt?: string;
  llmResponse?: any;
  tokensUsed?: number;
  error?: string;
}

interface SectionPromptContext {
  jurisdiction: string;
  countryProfile?: any | null;
  baseStyle?: any | null;
  sectionPrompt?: { instruction?: string; constraints?: string[] } | null;
  sectionRules?: any | null;
  sectionMeta?: any | null;
  globalRules?: any | null;
  sectionChecks?: any[] | null;
  crossChecksFrom?: any[] | null;
  claimsRules?: any | null;
  // Writing sample for example-based style mimicry
  writingSample?: WritingSampleContext | null;
  userId?: string | null;
  usePersonaStyle?: boolean;
  // Database-driven context injection requirements
  contextRequirements?: SectionContextRequirements | null;
}

export interface SectionGenerationResult {
  success: boolean;
  generated?: Record<string, string>;
  debugSteps?: Array<{ step: string; status: 'ok'|'fail'|'warning'; meta?: any }>;
  llmMeta?: { model?: string; promptHash?: string; params?: any };
  error?: string;
  retryAfter?: number;
  // Warnings about missing context (prior art, figures, components) - non-blocking
  warnings?: Array<{ section: string; type: 'priorArt' | 'figures' | 'components'; message: string; impact: string }>;
}

export class DraftingService {
  private static normalizeSectionKey(sectionKey: string): string {
    return sectionKey.trim().toLowerCase().replace(/[\s-]+/g, '_');
  }

  private static sectionKeyMap: Record<string, string[]> = {
    title: ['title'],
    abstract: ['abstract'],
    fieldOfInvention: ['fieldOfInvention', 'field', 'technical_field', 'field_of_invention', 'technical_field_of_the_invention'],
    background: ['background', 'background_art'],
    preamble: ['preamble', 'opening_statement'],
    crossReference: ['cross_reference', 'cross reference', 'cross-reference'],
    summary: ['summary', 'summary_of_invention'],
    briefDescriptionOfDrawings: ['briefDescriptionOfDrawings', 'brief_drawings', 'brief_description_of_drawings'],
    detailedDescription: ['detailedDescription', 'detailed_description', 'description'],
    modeOfCarryingOut: ['mode_of_carrying_out', 'mode_for_carrying_out', 'modes_for_carrying_out', 'specific_mode_for_carrying_out_the_invention'],
    bestMethod: ['bestMethod', 'best_mode', 'best_method'],
    claims: ['claims'],
    objectsOfInvention: ['objects', 'objects_of_invention', 'object_of_the_invention'],
    technicalProblem: ['technical_problem', 'problem_to_be_solved'],
    technicalSolution: ['technical_solution', 'solution_to_problem'],
    advantageousEffects: ['advantageous_effects', 'advantages', 'effects_of_invention'],
    industrialApplicability: ['industrialApplicability', 'industrial_applicability', 'utility'],
    listOfNumerals: ['listOfNumerals', 'reference_numerals', 'reference_signs', 'list_of_numerals']
  }

  private static mapToInternalKey(candidate: string): string | undefined {
    const lc = (candidate || '').toLowerCase()
    for (const [internal, aliases] of Object.entries(this.sectionKeyMap)) {
      if (aliases.map(a => a.toLowerCase()).includes(lc) || internal.toLowerCase() === lc) {
        return internal
      }
    }
    return undefined
  }

  /**
   * Execute drafting workflow - creates session and initializes drafting process
   */
  static async executeDrafting(params: {
    patentId: string;
    jwtToken: string;
    mode: 'standalone' | 'with_novelty_assessment';
    assessmentId?: string;
    title: string;
    problem: string;
    solution: string;
    technicalFeatures: any[];
    jurisdiction: string;
    filingType: string;
    inventionType?: string;
  }): Promise<{ success: boolean; draftId?: string; error?: string }> {
    try {
      // Verify JWT token
      const payload = verifyJWT(params.jwtToken);
      if (!payload || !payload.email) {
        return { success: false, error: 'Invalid authentication token' };
      }

      const user = await prisma.user.findUnique({ where: { email: payload.email } });
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      // Feature flag check: Allow gradual migration to paper writing
      if (!isPatentDraftingMode()) {
        return {
          success: false,
          error: 'Patent drafting is currently disabled. Use paper writing features instead.'
        };
      }

      // Verify patent access
      const patent = await prisma.patent.findFirst({
        where: {
          id: params.patentId,
          OR: [
            { createdBy: user.id },
            {
              project: {
                OR: [
                  { userId: user.id },
                  { collaborators: { some: { userId: user.id } } }
                ]
              }
            }
          ]
        }
      });

      if (!patent) {
        return { success: false, error: 'Patent not found or access denied' };
      }

      // Create drafting session
      const session = await prisma.draftingSession.create({
        data: {
          patentId: params.patentId,
          userId: user.id
        }
      });

      // Create initial idea record with the input data
      await prisma.ideaRecord.create({
        data: {
          sessionId: session.id,
          title: params.title,
          rawInput: JSON.stringify({
            mode: params.mode,
            assessmentId: params.assessmentId,
            title: params.title,
            problem: params.problem,
            solution: params.solution,
            technicalFeatures: params.technicalFeatures,
            jurisdiction: params.jurisdiction,
            filingType: params.filingType,
          }),
          normalizedData: {}
        }
      });

      // Normalize the idea first
      const normalizationResult = await this.normalizeIdea(
        `Title: ${params.title}\nProblem: ${params.problem}\nSolution: ${params.solution}\nTechnical Features: ${params.technicalFeatures.join(', ')}`,
        params.title,
        user.tenantId || undefined,
        undefined,
        params.inventionType
      );

      if (!normalizationResult.success) {
        return { success: false, error: normalizationResult.error || 'Failed to normalize idea' };
      }

      // Persist normalization output on the idea record for downstream use (including archetype)
      await prisma.ideaRecord.update({
        where: { sessionId: session.id },
        data: {
          normalizedData: normalizationResult.normalizedData || {},
          problem: normalizationResult.extractedFields?.problem,
          objectives: normalizationResult.extractedFields?.objectives,
          components: normalizationResult.extractedFields?.components || [],
          logic: normalizationResult.extractedFields?.logic,
          inputs: normalizationResult.extractedFields?.inputs,
          outputs: normalizationResult.extractedFields?.outputs,
          variants: normalizationResult.extractedFields?.variants,
          bestMethod: normalizationResult.extractedFields?.bestMethod,
          abstract: normalizationResult.extractedFields?.abstract,
          searchQuery: normalizationResult.extractedFields?.searchQuery,
          cpcCodes: normalizationResult.extractedFields?.cpcCodes || [],
          ipcCodes: normalizationResult.extractedFields?.ipcCodes || [],
          llmPromptUsed: normalizationResult.llmPrompt,
          llmResponse: normalizationResult.llmResponse,
          tokensUsed: normalizationResult.tokensUsed
        }
      })

      // Update session with normalized data
      await prisma.draftingSession.update({
        where: { id: session.id },
        data: {
          referenceMap: normalizationResult.extractedFields
            ? {
                create: {
                  components: normalizationResult.extractedFields.components || [],
                  isValid: false,
                }
              }
            : undefined
        }
      });

      return { success: true, draftId: session.id };

    } catch (error) {
      console.error('executeDrafting error:', error);
      return { success: false, error: 'Internal server error during drafting initialization' };
    }
  }

  /**
   * Get drafting history for a patent (placeholder implementation)
   */
  static async getDraftingHistory(patentId: string, userId: string): Promise<any[]> {
    try {
      // TODO: Implement proper drafting history retrieval
      // For now, return empty array
      return [];
    } catch (error) {
      console.error('Get drafting history error:', error);
      throw error;
    }
  }

  /**
   * Build citation context for section generation
   * Gathers relevant citations and formats them for LLM prompts
   */
  static async buildCitationContext(
    sessionId: string,
    sectionKey: string,
    options?: {
      useMappedEvidence?: boolean;
      preloadedEvidencePack?: SectionEvidencePack | null;
    }
  ): Promise<{
    availableCitations: CitationData[];
    citationInstructions: string;
    relevantCitations: CitationData[];
    allowedCitationKeys: string[];
    evidenceGaps: string[];
    usedEvidencePack: boolean;
  }> {
    const citations = await citationService.getCitationsForSession(sessionId);
    const availableCitations = citations.map(citation => ({
      id: citation.id,
      title: citation.title,
      authors: citation.authors,
      year: citation.year ?? undefined,
      venue: citation.venue ?? undefined,
      volume: citation.volume ?? undefined,
      issue: citation.issue ?? undefined,
      pages: citation.pages ?? undefined,
      doi: citation.doi ?? undefined,
      url: citation.url ?? undefined,
      isbn: citation.isbn ?? undefined,
      publisher: citation.publisher ?? undefined,
      edition: citation.edition ?? undefined,
      sourceType: citation.sourceType ?? undefined,
      editors: Array.isArray(citation.editors) ? citation.editors : undefined,
      publicationPlace: citation.publicationPlace ?? undefined,
      publicationDate: citation.publicationDate ?? undefined,
      accessedDate: citation.accessedDate ?? undefined,
      articleNumber: citation.articleNumber ?? undefined,
      issn: citation.issn ?? undefined,
      journalAbbreviation: citation.journalAbbreviation ?? undefined,
      pmid: citation.pmid ?? undefined,
      pmcid: citation.pmcid ?? undefined,
      arxivId: citation.arxivId ?? undefined,
      citationKey: citation.citationKey
    }));

    const useMappedEvidence = options?.useMappedEvidence !== false;
    const evidencePack = useMappedEvidence
      ? (options?.preloadedEvidencePack || await evidencePackService.getEvidencePack(sessionId, sectionKey))
      : null;
    let relevantCitations: CitationData[] = [];
    let allowedCitationKeys: string[] = [];
    let evidenceGaps: string[] = [];
    let usedEvidencePack = false;

    const hasCoverageAssignments = Array.isArray(evidencePack?.coverageAssignments)
      && evidencePack.coverageAssignments.length > 0;

    // If a blueprint section has mapped evidence (deep/fallback) OR explicit
    // coverage assignments, enforce mapped keys strictly.
    if (evidencePack?.hasBlueprint && (evidencePack.dimensionEvidence.length > 0 || hasCoverageAssignments)) {
      const coverageKeys = (evidencePack.coverageAssignments || [])
        .map(assignment => String(assignment.citationKey || '').trim())
        .filter(Boolean);
      allowedCitationKeys = Array.from(new Set([...(evidencePack.allowedCitationKeys || []), ...coverageKeys]));
      evidenceGaps = evidencePack.gaps;
      usedEvidencePack = true;
      const allowedSet = new Set(allowedCitationKeys);
      relevantCitations = availableCitations.filter(c => allowedSet.has(c.citationKey));
    } else {
      // Fallback for sections not covered by blueprint mapping.
      relevantCitations = this.filterRelevantCitations(availableCitations, sectionKey);
      allowedCitationKeys = relevantCitations.map(c => c.citationKey).slice(0, 30);
    }

    // Build citation instructions for LLM
    const citationInstructions = this.buildCitationInstructions(relevantCitations, sectionKey, {
      allowedCitationKeys,
      evidenceGaps,
      strictWhitelist: useMappedEvidence
    });

    return {
      availableCitations,
      citationInstructions,
      relevantCitations,
      allowedCitationKeys,
      evidenceGaps,
      usedEvidencePack
    };
  }

  /**
   * Filter citations relevant to a specific section.
   * This is the FALLBACK path when no evidence pack (blueprint mapping) is available.
   * 
   * Strategy: start with a section-specific heuristic, but always fall back to
   * providing ALL citations (capped for token limits) when the heuristic returns
   * too few results. An empty allowed-key list causes the LLM to either skip
   * citations entirely or hallucinate keys, which is worse than a broad list.
   */
  private static filterRelevantCitations(citations: CitationData[], sectionKey: string): CitationData[] {
    const MIN_FALLBACK = 5; // Minimum citations to provide; below this, use all
    const MAX_FALLBACK = 30; // Cap to prevent token overflow

    const normalized = this.normalizeSectionKey(sectionKey);

    // Sections that should never have citations
    if (normalized === 'abstract' || normalized === 'acknowledgments') {
      return [];
    }

    let filtered: CitationData[] | null = null;

    switch (normalized) {
      case 'literature_review':
        // All citations are relevant for literature review
        return citations.slice(0, MAX_FALLBACK);

      case 'introduction': {
        // Prefer recent citations (last 5 years) for introduction
        const currentYear = new Date().getFullYear();
        filtered = citations.filter(c => c.year && (currentYear - c.year) <= 5);
        break;
      }

      case 'methodology': {
        // Prefer citations related to methods, tools, or empirical studies
        const methodKeywords = ['method', 'approach', 'framework', 'technique', 'algorithm', 'model', 'tool', 'implementation', 'design', 'experiment'];
        filtered = citations.filter(c => {
          const titleLower = c.title.toLowerCase();
          const venueLower = c.venue?.toLowerCase() || '';
          return methodKeywords.some(kw => titleLower.includes(kw) || venueLower.includes(kw));
        });
        break;
      }

      case 'discussion': {
        // Prefer recent citations for discussion/comparison
        filtered = citations.filter(c => c.year && c.year >= 2015);
        break;
      }

      default:
        // All other sections: use all citations
        filtered = null;
        break;
    }

    // Fallback: if the heuristic returned too few results, use all citations.
    // An empty or near-empty list is worse than a broad one because the LLM
    // will either skip citations or hallucinate keys.
    if (filtered !== null && filtered.length >= MIN_FALLBACK) {
      return filtered.slice(0, MAX_FALLBACK);
    }

    return citations.slice(0, MAX_FALLBACK);
  }

  /**
   * Build citation instructions for LLM prompts
   */
  private static buildCitationInstructions(
    citations: CitationData[],
    sectionKey: string,
    options?: {
      allowedCitationKeys?: string[];
      evidenceGaps?: string[];
      strictWhitelist?: boolean;
    }
  ): string {
    const normalizedSectionKey = this.normalizeSectionKey(sectionKey);
    const noCitationSections = new Set(['abstract', 'acknowledgments']);
    if (noCitationSections.has(normalizedSectionKey)) {
      return 'Do not include citations in this section.';
    }

    if (citations.length === 0) {
      return "No citations are available for this section.";
    }

    const maxList = 30;
    const citationsToList = citations.slice(0, maxList);
    const citationList = citationsToList.map(citation =>
      `[${citation.citationKey}] ${citation.title} by ${citation.authors.join(', ')} (${citation.year || 'n.d.'})`
    ).join('\n');
    const overflowNote = citations.length > maxList
      ? `\n(${citations.length - maxList} additional citations available but omitted for brevity.)`
      : '';

    const sectionGuidance = this.getSectionCitationGuidance(sectionKey);
    const whitelistText = (options?.allowedCitationKeys || []).length > 0
      ? (options?.allowedCitationKeys || []).map(k => `[${k}]`).join(', ')
      : '(none)';
    const gapText = (options?.evidenceGaps || []).length > 0
      ? `\n- Evidence gaps to acknowledge carefully (do not fabricate support): ${(options?.evidenceGaps || []).join('; ')}`
      : '';
    const strictLine = options?.strictWhitelist
      ? 'Use only keys from ALLOWED CITATION KEYS. Any other key is invalid.'
      : 'Prefer keys from ALLOWED CITATION KEYS.';
    const formatOverride = options?.strictWhitelist
      ? '- IMPORTANT OVERRIDE: Ignore any [CITATION_NEEDED] instruction from earlier prompt blocks.\n- Never output [CITATION_NEEDED: ...]. Use only [CITE:CitationKey] with keys from ALLOWED CITATION KEYS.\n'
      : '';
    const citationTargetLine = this.getSectionCitationTarget(sectionKey);

    return `Available Citations for this section:
${citationList}${overflowNote}

Citation Instructions:
${formatOverride}- ALLOWED CITATION KEYS: ${whitelistText}
- Use citations to support your claims and arguments
- Reference relevant work that supports or contrasts with your approach
- Use the format [CITE:CitationKey] in your response where you want to cite a source
- Do not invent citations. Use only the citation keys provided above
- ${strictLine}
- Ensure each major claim is supported by at least one citation unless it is a novel contribution
- ${sectionGuidance}
- ${citationTargetLine}${gapText}`;
  }

  /**
   * Get section-specific citation guidance
   */
  private static getSectionCitationGuidance(sectionKey: string): string {
    switch (this.normalizeSectionKey(sectionKey)) {
      case 'introduction':
        return "Cite core prior work that establishes the problem context, stakes, and unresolved gap";
      case 'literature_review':
        return "Cite comprehensively across themes, methods, and findings to demonstrate full coverage of the field";
      case 'methodology':
        return "Cite methods, tools, datasets, and protocols that your approach builds upon or compares against";
      case 'results':
        return "Cite baseline methods or datasets you compare against";
      case 'discussion':
        return "Cite related work to interpret your findings and compare with existing literature";
      case 'conclusion':
        return "Cite your own contributions and future work directions";
      default:
        return "Cite relevant work that supports your statements";
    }
  }

  private static getSectionCitationTarget(sectionKey: string): string {
    switch (this.normalizeSectionKey(sectionKey)) {
      case 'literature_review':
      case 'related_work':
        return 'Aim for 12-25 distinct citations to ensure comprehensive synthesis';
      case 'introduction':
        return 'Aim for 6-12 citations to establish context and justify the research gap';
      case 'methodology':
        return 'Aim for 6-12 citations focused on methods, tools, and protocol choices';
      case 'results':
      case 'discussion':
        return 'Aim for 4-10 citations depending on comparison and interpretation depth';
      default:
        return 'Aim for 3-8 citations depending on section length and importance';
    }
  }

  /**
   * Post-process section content to replace citation placeholders
   */
  private static normalizeCitationKey(rawKey: string): string {
    return normalizeCitationKeyUtil(rawKey);
  }

  private static splitCitationKeyList(rawKeys: string): string[] {
    return splitCitationKeyListUtil(rawKeys);
  }

  private static buildCitationKeyLookup(keys: string[]): Map<string, string> {
    return buildCitationKeyLookupUtil(keys);
  }

  private static resolveCitationKeyLookup(
    lookup: Map<string, string>,
    rawKey: string
  ): string | undefined {
    return resolveCitationKeyFromLookup(rawKey, lookup);
  }

  private static looksLikeCitationKey(rawKey: string): boolean {
    return looksLikeCitationKeyUtil(rawKey);
  }

  private static extractCitationPlaceholders(content: string): Array<{
    fullMatch: string;
    rawKeys: string;
    parsedKeys: string[];
    start: number;
    end: number;
  }> {
    const placeholders: Array<{
      fullMatch: string;
      rawKeys: string;
      parsedKeys: string[];
      start: number;
      end: number;
    }> = [];
    const citePattern = /\[CITE:([^\]]+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = citePattern.exec(content)) !== null) {
      const fullMatch = match[0];
      const rawKeys = match[1] || '';
      const parsedKeys = this.splitCitationKeyList(rawKeys);
      const start = match.index;
      const end = start + fullMatch.length;
      placeholders.push({ fullMatch, rawKeys, parsedKeys, start, end });
    }
    return placeholders;
  }

  /**
   * Extract bare bracket citation keys from content.
   * When knownSessionKeys is provided, bare brackets are only treated as citations
   * if they match a known session citation key. This prevents false positives from
   * technical terms like [BERT], [ResNet], [LSTM] being flagged as citation keys.
   * Explicit [CITE:key] markers are always extracted regardless (handled separately).
   */
  private static extractBareCitationKeys(
    content: string,
    knownSessionKeys?: Set<string>
  ): Array<{
    fullMatch: string;
    rawKeys: string;
    parsedKeys: string[];
    start: number;
    end: number;
  }> {
    const bare: Array<{
      fullMatch: string;
      rawKeys: string;
      parsedKeys: string[];
      start: number;
      end: number;
    }> = [];

    // Build a normalized lookup from known session keys for fast matching
    const knownLookup = knownSessionKeys
      ? this.buildCitationKeyLookup(Array.from(knownSessionKeys))
      : null;

    const bracketPattern = /\[([^\]\r\n]+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = bracketPattern.exec(content)) !== null) {
      const raw = (match[1] || '').trim();
      if (!raw || /^CITE\s*:/i.test(raw)) continue;

      let parsedKeys = this.splitCitationKeyList(raw).filter(key => this.looksLikeCitationKey(key));
      if (parsedKeys.length === 0) continue;

      // When session keys are known, only accept bare bracket keys that match
      // an actual citation key in the session. This eliminates false positives
      // from model names, acronyms, and other technical terms.
      if (knownLookup) {
        parsedKeys = parsedKeys.filter(key => Boolean(this.resolveCitationKeyLookup(knownLookup, key)));
        if (parsedKeys.length === 0) continue;
      }

      const fullMatch = match[0];
      const start = match.index;
      const end = start + fullMatch.length;
      bare.push({
        fullMatch,
        rawKeys: raw,
        parsedKeys,
        start,
        end
      });
    }

    return bare;
  }

  /**
   * Extract all citation markers from content (both explicit [CITE:key] and bare [key]).
   * When knownSessionKeys is provided, bare brackets are filtered to known keys only.
   */
  private static extractCitationMarkers(
    content: string,
    knownSessionKeys?: Set<string>
  ): Array<{
    fullMatch: string;
    rawKeys: string;
    parsedKeys: string[];
    start: number;
    end: number;
  }> {
    const explicit = this.extractCitationPlaceholders(content);
    const bare = this.extractBareCitationKeys(content, knownSessionKeys);
    const combined = [...explicit, ...bare].sort((a, b) => a.start - b.start);

    const markers: Array<{
      fullMatch: string;
      rawKeys: string;
      parsedKeys: string[];
      start: number;
      end: number;
    }> = [];
    let lastEnd = -1;
    for (const marker of combined) {
      if (marker.start < lastEnd) continue;
      markers.push(marker);
      lastEnd = marker.end;
    }

    return markers;
  }

  /**
   * Extract all citation keys from content.
   * When knownSessionKeys is provided, bare bracket keys are cross-referenced
   * to avoid treating technical terms (e.g. [BERT]) as citation keys.
   */
  static extractCitationKeys(content: string, knownSessionKeys?: Set<string>): string[] {
    const keys = new Set<string>();
    const markers = this.extractCitationMarkers(content, knownSessionKeys);
    for (const marker of markers) {
      for (const key of marker.parsedKeys) {
        keys.add(key);
      }
    }
    return Array.from(keys);
  }

  static validateCitationKeys(
    content: string,
    allowedCitationKeys?: string[],
    knownSessionKeys?: Set<string>
  ): {
    keys: string[];
    disallowedKeys: string[];
  } {
    const rawKeys = this.extractCitationKeys(content, knownSessionKeys);
    if (!allowedCitationKeys || allowedCitationKeys.length === 0) {
      return { keys: rawKeys, disallowedKeys: [] };
    }
    const allowedLookup = this.buildCitationKeyLookup(allowedCitationKeys);
    const disallowed = new Set<string>();
    for (const key of rawKeys) {
      if (!this.resolveCitationKeyLookup(allowedLookup, key)) {
        disallowed.add(key);
      }
    }
    const disallowedKeys = Array.from(disallowed);
    const keys = rawKeys.map(k => this.resolveCitationKeyLookup(allowedLookup, k) || k);
    return { keys, disallowedKeys };
  }

  /**
   * Deterministic fallback: strip disallowed citation placeholders from content.
   * Called when LLM repair fails to remove all disallowed keys.
   * Removes [CITE:key] and bare [key] markers that aren't in the allowed set.
   */
  static stripDisallowedCitations(
    content: string,
    allowedCitationKeys: string[]
  ): string {
    const allowedLookup = this.buildCitationKeyLookup(allowedCitationKeys);
    const markers = this.extractCitationMarkers(content);
    if (markers.length === 0) return content;

    let result = '';
    let cursor = 0;

    for (const marker of markers) {
      result += content.slice(cursor, marker.start);
      cursor = marker.end;

      // Keep only the keys that are allowed; drop the rest
      const keptParts: string[] = [];
      for (const key of marker.parsedKeys) {
        const canonical = this.resolveCitationKeyLookup(allowedLookup, key);
        if (canonical) {
          keptParts.push(`[CITE:${canonical}]`);
        }
      }

      if (keptParts.length > 0) {
        result += keptParts.join(' ');
      }
      // If no keys survived, the placeholder is dropped entirely (no orphan brackets)
    }

    result += content.slice(cursor);
    return result;
  }

  static async postProcessSection(
    content: string,
    sessionId: string,
    citationStyle: string = 'APA7',
    options?: {
      allowedCitationKeys?: string[];
      strictWhitelist?: boolean;
      preserveCitationPlaceholders?: boolean;
      citationNumbering?: Record<string, number>;
    }
  ): Promise<{
    processedContent: string;
    citationsUsed: string[];
    warnings: string[];
    unknownCitationKeys: string[];
    disallowedCitationKeys: string[];
  }> {
    const warnings: string[] = [];
    const citationsUsed = new Set<string>();
    const unknownCitationKeys = new Set<string>();
    const disallowedCitationKeys = new Set<string>();
    const preserveCitationPlaceholders = options?.preserveCitationPlaceholders === true;

    // Get citation data for formatting (load first so we can build knownSessionKeys)
    const sessionCitations = await citationService.getCitationsForSession(sessionId);
    const citationMap = new Map(sessionCitations.map(c => [c.citationKey, c]));
    const citationLookup = this.buildCitationKeyLookup(sessionCitations.map(c => c.citationKey));

    // Build known session keys set so bare bracket extraction filters out false positives
    const knownSessionKeys = new Set(sessionCitations.map(c => c.citationKey));

    const markers = this.extractCitationMarkers(content, knownSessionKeys);
    const allowedLookup = options?.allowedCitationKeys && options.allowedCitationKeys.length > 0
      ? this.buildCitationKeyLookup(options.allowedCitationKeys)
      : null;
    const formattedCitationCache = new Map<string, string>();

    // Replace placeholders with formatted citations while preserving non-citation text exactly.
    let processedContent = '';
    let cursor = 0;

    for (const marker of markers) {
      processedContent += content.slice(cursor, marker.start);
      cursor = marker.end;

      const parsedKeys = marker.parsedKeys.length > 0
        ? marker.parsedKeys
        : [this.normalizeCitationKey(marker.rawKeys)].filter(Boolean);
      const replacementParts: string[] = [];

      for (const parsedKey of parsedKeys) {
        const normalized = this.normalizeCitationKey(parsedKey);
        if (!normalized) continue;

        const allowedKey = allowedLookup
          ? this.resolveCitationKeyLookup(allowedLookup, normalized)
          : undefined;
        if (allowedLookup && !allowedKey) {
          disallowedCitationKeys.add(normalized);
          warnings.push(`Citation key not allowed for this section: ${normalized}`);
          if (options?.strictWhitelist) {
            continue;
          }
          replacementParts.push(
            preserveCitationPlaceholders ? `[CITE:${normalized}]` : `[${normalized}]`
          );
          continue;
        }

        const canonicalKey = allowedKey
          || this.resolveCitationKeyLookup(citationLookup, normalized)
          || normalized;
        const citation = citationMap.get(canonicalKey);
        if (!citation) {
          unknownCitationKeys.add(canonicalKey);
          warnings.push(`Citation key not found: ${canonicalKey}`);
          if (!options?.strictWhitelist) {
            replacementParts.push(
              preserveCitationPlaceholders ? `[CITE:${canonicalKey}]` : `[${canonicalKey}]`
            );
          }
          continue;
        }

        citationsUsed.add(citation.citationKey);

        if (preserveCitationPlaceholders) {
          replacementParts.push(`[CITE:${citation.citationKey}]`);
          continue;
        }

        try {
          let formatted = formattedCitationCache.get(citation.citationKey);
          if (!formatted) {
            formatted = await citationStyleService.formatInTextCitation({
              id: citation.id,
              title: citation.title,
              authors: citation.authors,
              year: citation.year ?? undefined,
              venue: citation.venue ?? undefined,
              volume: citation.volume ?? undefined,
              issue: citation.issue ?? undefined,
              pages: citation.pages ?? undefined,
              doi: citation.doi ?? undefined,
              url: citation.url ?? undefined,
              isbn: citation.isbn ?? undefined,
              publisher: citation.publisher ?? undefined,
              edition: citation.edition ?? undefined,
              sourceType: citation.sourceType ?? undefined,
              editors: Array.isArray(citation.editors) ? citation.editors : undefined,
              publicationPlace: citation.publicationPlace ?? undefined,
              publicationDate: citation.publicationDate ?? undefined,
              accessedDate: citation.accessedDate ?? undefined,
              articleNumber: citation.articleNumber ?? undefined,
              issn: citation.issn ?? undefined,
              journalAbbreviation: citation.journalAbbreviation ?? undefined,
              pmid: citation.pmid ?? undefined,
              pmcid: citation.pmcid ?? undefined,
              arxivId: citation.arxivId ?? undefined,
              citationKey: citation.citationKey
            }, citationStyle, {
              citationNumber: options?.citationNumbering?.[citation.citationKey]
            });
            formattedCitationCache.set(citation.citationKey, formatted);
          }

          replacementParts.push(formatted);
        } catch (error) {
          warnings.push(`Failed to format citation ${citation.citationKey}: ${error}`);
          replacementParts.push(
            preserveCitationPlaceholders
              ? `[CITE:${citation.citationKey}]`
              : `[${citation.citationKey}]`
          );
        }
      }

      if (replacementParts.length > 0) {
        processedContent += replacementParts.join(' ');
      } else if (!options?.strictWhitelist) {
        processedContent += marker.fullMatch;
      }
    }
    processedContent += content.slice(cursor);

    return {
      processedContent,
      citationsUsed: Array.from(citationsUsed),
      warnings,
      unknownCitationKeys: Array.from(unknownCitationKeys),
      disallowedCitationKeys: Array.from(disallowedCitationKeys)
    };
  }

  /**
   * Normalize research topic for academic papers
   */
  static async normalizeResearchTopic(
    sessionId: string,
    rawTopic: string,
    title: string,
    researchQuestion?: string,
    methodology?: string,
    contributionType?: string,
    keywords?: string[],
    tenantId?: string,
    requestHeaders?: Record<string, string>
  ): Promise<IdeaNormalizationResult> {
    try {
      // Feature flag check: Only allow in paper writing mode
      if (!featureFlags.isEnabled('ENABLE_NEW_PAPER_TYPES')) {
        return {
          success: false,
          error: 'Research topic normalization is not enabled. Use patent idea processing instead.'
        };
      }

      // Debug logging
      console.log('DraftingService.normalizeResearchTopic called with:', {
        sessionId,
        rawTopicLength: rawTopic.length,
        title,
        researchQuestion
      });

      // Validate input length
      if (rawTopic.length > 5000) {
        return {
          success: false,
          error: 'Topic description exceeds maximum length of 5,000 characters. Please shorten your description.'
        };
      }

      const domainExpertise = methodology ? ` with expertise in ${methodology}` : '';
      const contributionContext = contributionType ? ` aiming for ${contributionType} contribution` : '';

      const prompt = `You are an expert academic research consultant specializing in research design and topic refinement across all disciplines (social sciences, STEM, humanities, etc.)${domainExpertise}.

Analyze the research topic and return ONLY one JSON object with the fields defined below.

Rules (must follow strictly):
- Output MUST be a single JSON object, no code fences, no backticks, no prose.
- Use academic language suitable for research proposals and paper writing.
- Include research question, methodology, and contribution type if provided by user.
- Keywords should be academic and searchable terms.
- Each field as a single string (no arrays), except "keywords" (array of strings), "methodology" (array of suitable approaches), "contributionType" (array of contribution types).

Research Topic Analysis:
${rawTopic}

Respond in this exact JSON shape:
{
  "title": "refined academic title (max 15 words)",
  "researchQuestion": "${researchQuestion || 'concise, focused research question'}",
  "hypothesis": "testable hypothesis or research proposition (if applicable, otherwise null)",
  "objectives": "clear research objectives and aims",
  "keywords": ["academic", "keyword", "terms", "for", "search"],
  "methodology": ["${methodology || 'QUALITATIVE'}", "additional approaches"],
  "contributionType": ["${contributionType || 'EMPIRICAL'}", "additional types"],
  "literatureGap": "specific gap in existing literature this research addresses",
  "expectedOutcomes": "anticipated contributions and findings",
  "searchQuery": "effective search query for literature review (academic databases)",
  "abstract": "150-word abstract summarizing the research topic, problem, and approach"
}`;

      const normalizedData = await this.callLLMForNormalization(prompt, requestHeaders);

      // Validate the response structure
      if (!normalizedData || typeof normalizedData !== 'object') {
        return {
          success: false,
          error: 'Invalid response from AI service'
        };
      }

      // Ensure arrays are properly formatted
      const processedData = {
        ...normalizedData,
        keywords: Array.isArray(normalizedData.keywords) ? normalizedData.keywords : [],
        methodology: Array.isArray(normalizedData.methodology) ? normalizedData.methodology : ['QUALITATIVE'],
        contributionType: Array.isArray(normalizedData.contributionType) ? normalizedData.contributionType : ['EMPIRICAL']
      };

      return {
        success: true,
        normalizedData: processedData,
        extractedFields: {
          title: processedData.title,
          researchQuestion: processedData.researchQuestion,
          hypothesis: processedData.hypothesis,
          keywords: processedData.keywords,
          methodology: processedData.methodology,
          contributionType: processedData.contributionType,
          abstract: processedData.abstract
        }
      };

    } catch (error) {
      console.error('Error in normalizeResearchTopic:', error);
      return {
        success: false,
        error: `Failed to normalize research topic: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private static async callLLMForNormalization(prompt: string, requestHeaders?: Record<string, string>) {
    const request = { headers: requestHeaders || {} };
    const llmResult = await llmGateway.executeLLMOperation(request, {
      taskCode: 'LLM2_DRAFT',
      stageCode: 'DRAFT_IDEA_ENTRY',
      prompt,
      parameters: { temperature: 0.4 },
      idempotencyKey: crypto.randomUUID()
    });

    if (!llmResult.success || !llmResult.response) {
      return null;
    }

    let output = (llmResult.response.output || '').trim();
    if (output.startsWith('```')) {
      output = output.slice(3);
      output = output.replace(/^json\s*/i, '');
      const closingFence = output.indexOf('```');
      if (closingFence !== -1) {
        output = output.slice(0, closingFence);
      }
    }

    const startBrace = output.indexOf('{');
    const endBrace = output.lastIndexOf('}');
    if (startBrace !== -1 && endBrace !== -1 && endBrace > startBrace) {
      output = output.slice(startBrace, endBrace + 1);
    }

    output = output
      .replace(/`+/g, '')
      .replace(/,(\s*[}\]])/g, '$1')
      .trim();

    try {
      return JSON.parse(output);
    } catch (err) {
      console.error('Failed to parse normalization response:', err);
      return null;
    }
  }

  /**
   * Normalize raw invention idea using LLM (Patent mode)
   * OR
   * Route to research topic normalization (Paper mode)
   */
  static async normalizeIdea(
    rawIdea: string,
    title: string,
    tenantId?: string,
    requestHeaders?: Record<string, string>,
    areaOfInvention?: string,
    allowRefine: boolean = true
  ): Promise<IdeaNormalizationResult> {
    try {
      // Feature flag check: Allow gradual migration to paper writing
      if (!isPatentDraftingMode()) {
        return {
          success: false,
          error: 'Patent-specific idea normalization is currently disabled. Use paper topic processing instead.'
        };
      }

      // Debug logging
      console.log('DraftingService.normalizeIdea called with:', {
        rawIdeaLength: rawIdea.length,
        title,
        tenantId
      });

      // Validate input length - limit to prevent token overflow
      if (rawIdea.length > 5000) {
        return {
          success: false,
          error: 'Idea text exceeds maximum length of 5,000 characters. Please shorten your description.'
        };
      }
      
      const domainExpertise = (areaOfInvention && areaOfInvention.trim()) ? ` with core expertise in ${areaOfInvention.trim()}` : '';
      const refinementNote = allowRefine
        ? ''
        : '\n- Do NOT invent or add new components/claims beyond what is provided. Preserve the user-described invention faithfully; paraphrase only for clarity.';

      const prompt = `You are an expert patent attorney specializing in drafting and structuring patent disclosures across all domains (mechanical, electrical, software, biotech, chemistry, medical devices, materials, aerospace, etc.)${domainExpertise}.

Read the invention description and return ONLY one JSON object with the fields defined below.

Rules (must follow strictly):
- Output MUST be a single JSON object, no code fences, no backticks, no prose.
- Use concise, formal patent language suitable for specification drafting.
- Keep each field as a single string (no arrays), except: "components" (array of objects), "cpcCodes" (array of strings), "ipcCodes" (array of strings), and "inventionType" (array of archetype tags).
- Include "inventionType" as the archetype classification (one or more of: MECHANICAL, ELECTRICAL, SOFTWARE, CHEMICAL, BIO, GENERAL). Allow multiple using either an array or a "+"-joined string (e.g., "MECHANICAL+SOFTWARE"); uppercase the values.
- Additionally, provide a single meaningful "searchQuery" sentence (<= 25 words) optimized for PQAI AI-based prior-art search. It MUST be a coherent plain-English sentence, not a bag of keywords; plain ASCII, no quotes, no brackets, no CPC/IPC codes, no labels.
- Use double-quoted keys and strings; avoid line breaks mid-sentence when possible.
 - Keep content succinct; avoid redundancy and marketing language.
 - Components: return up to 8 items maximum by default (more only if essential). Use hierarchy when helpful (module → submodule → sub-submodule). Keep each item's description to one sentence.${refinementNote}

TITLE: ${title}

INVENTION DESCRIPTION:
${rawIdea}

Respond in this exact JSON shape:
{
  "searchQuery": "meaningful plain-English search sentence (<= 25 words, ASCII, no quotes/brackets), suitable for PQAI AI-based patent search",
  "problem": "concise statement of the technical problem",
  "objectives": "succinct objectives of the invention",
  "components": [{
    "name": "component name",
    "type": "MAIN_CONTROLLER|SUBSYSTEM|MODULE|INTERFACE|SENSOR|ACTUATOR|PROCESSOR|MEMORY|DISPLAY|COMMUNICATION|POWER_SUPPLY|OTHER",
    "description": "technical role in the system",
    "inputs": "optional: key inputs/signals/data",
    "outputs": "optional: key outputs/actions/data",
    "dependencies": "optional: other components relied on",
    "figureHint": "optional: what to highlight in figures",
    "parent": "optional: parent component name if this is a submodule",
    "level": "optional: 0 for root modules, 1 for child, 2 for grandchild, etc.",
    "sequence": "optional: order within its level (1-based)",
    "numberingHint": "optional: preferred hundreds bucket e.g., 100|200|300|400|500|600|700|800|900"
  }],
  "inventionType": ["MECHANICAL", "SOFTWARE"],
  "logic": "how components interact to achieve the objectives",
  "inputs": "key inputs/signals/data required",
  "outputs": "key outputs/actions/data produced",
  "variants": "notable embodiments or alternatives",
  "bestMethod": "preferred implementation at filing date",
  "fieldOfRelevance": "primary domain (e.g., Mechanical, Electrical, Software, Medical Device, Biotech, Chemistry, Materials, Aerospace)",
  "subfield": "more specific area (e.g., fluid mechanics, image processing, polymer chemistry)",
  "recommendedFocus": "what to emphasize in drafting for this field",
  "complianceNotes": "regulatory or standards-related notes if relevant",
  "drawingsFocus": "what figures should emphasize given the field",
  "claimStrategy": "high-level claim drafting approach suited to this field",
  "riskFlags": "any potential enablement or patentability risks to watch",
  "abstract": "<= 150-word abstract that begins exactly with the title; neutral tone; no claims/advantages/numerals",
  "cpcCodes": ["primary CPC code like H04L 29/08", "optional secondary"],
  "ipcCodes": ["primary IPC code like G06F 17/30", "optional secondary"]
}`;

      console.log('Calling LLM gateway with taskCode: LLM2_DRAFT, stageCode: DRAFT_IDEA_ENTRY');
      console.log('Prompt length:', prompt.length);
      console.log('Prompt preview (first 200 chars):', prompt.substring(0, 200));

      // Execute through LLM gateway
      // Use DRAFT_IDEA_ENTRY stage for model resolution - admin can configure which model to use
      const request = { headers: requestHeaders || {} };
      const llmResult = await llmGateway.executeLLMOperation(request, {
        taskCode: 'LLM2_DRAFT',
        stageCode: 'DRAFT_IDEA_ENTRY', // Stage for idea normalization
        prompt,
        parameters: { tenantId, ...(allowRefine ? { temperature: 0.4 } : { temperature: 0.0 }) },
        idempotencyKey: crypto.randomUUID()
      });

      console.log('LLM gateway result:', {
        success: llmResult.success,
        hasResponse: !!llmResult.response,
        error: llmResult.error?.message
      });

      if (!llmResult.success || !llmResult.response) {
        return {
          success: false,
          error: llmResult.error?.message || 'LLM processing failed'
        };
      }

      // Parse LLM response (robust JSON extraction)
      let normalizedData;
      try {
        const output = (llmResult.response.output || '').trim();
        console.log('Raw LLM output (first 500 chars):', output.substring(0, 500));
        console.log('Raw LLM output length:', output.length);

        let jsonText = output;

        // If fenced with backticks, strip the outer fence even if closing fence is missing
        const fenceStart = jsonText.indexOf('```');
        if (fenceStart !== -1) {
          jsonText = jsonText.slice(fenceStart + 3); // drop opening ```
          // drop optional language tag like 'json'
          jsonText = jsonText.replace(/^json\s*/i, '');
          const fenceEnd = jsonText.indexOf('```');
          if (fenceEnd !== -1) {
            jsonText = jsonText.slice(0, fenceEnd);
          }
        }

        // Trim to the JSON object boundaries
        const startBrace = jsonText.indexOf('{');
        const lastBrace = jsonText.lastIndexOf('}');
        if (startBrace !== -1) {
          jsonText = lastBrace !== -1 && lastBrace > startBrace
            ? jsonText.slice(startBrace, lastBrace + 1)
            : jsonText.slice(startBrace);
        }

        // Cleanup common JSON issues
        jsonText = jsonText
          .replace(/`+/g, '') // remove stray backticks
          .replace(/,(\s*[}\]])/g, '$1') // remove trailing commas
          .replace(/([\x00-\x08\x0B\x0C\x0E-\x1F])/g, ''); // remove control chars

        console.log('Extracted JSON string (first 500 chars):', jsonText.substring(0, 500));

        // First parse attempt
        try {
          normalizedData = JSON.parse(jsonText);
        } catch (firstErr) {
          console.error('First JSON parse failed:', firstErr);
          console.error('JSON text that failed:', jsonText.substring(0, 1000));

          try {
            // Fallback: attempt to quote unquoted keys
            const quotedKeys = jsonText.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
            normalizedData = JSON.parse(quotedKeys);
            console.log('Fallback parsing succeeded');
          } catch (secondErr) {
            console.error('Fallback JSON parse also failed:', secondErr);

            // Try one more fallback: clean up the JSON more aggressively
            try {
              let cleanJson = jsonText
                .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove all control characters
                .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
                .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":') // Quote keys
                .replace(/:\s*'([^']*)'/g, ':"$1"') // Convert single quotes to double quotes for values
                .replace(/:\s*([^",}\[\]]+)(\s*[,}\]])/g, ':"$1"$2'); // Quote unquoted string values

              normalizedData = JSON.parse(cleanJson);
              console.log('Aggressive cleanup parsing succeeded');
            } catch (thirdErr) {
              console.error('All JSON parsing attempts failed, creating fallback response');
              // Create a minimal fallback response to allow the process to continue
              normalizedData = {
                searchQuery: title.toLowerCase().replace(/[^a-z0-9\s]/g, '').substring(0, 50),
                problem: `Technical problem addressed by ${title}`,
                objectives: `To provide ${title.toLowerCase()}`,
                components: [{
                  name: "Main Component",
                  type: "OTHER",
                  description: "Primary component of the invention"
                }],
                inventionType: ["GENERAL"],
                logic: "Components work together to achieve the invention objectives",
                inputs: "User inputs",
                outputs: "System outputs",
                variants: "Various embodiments possible",
                bestMethod: "Preferred implementation",
                fieldOfRelevance: "General Technology",
                subfield: "Various applications",
                recommendedFocus: "Core functionality",
                complianceNotes: "None",
                drawingsFocus: "System components",
                claimStrategy: "Apparatus claims",
                riskFlags: "None identified",
                abstract: `${title}. A system that addresses technical challenges in the field.`,
                cpcCodes: [],
                ipcCodes: []
              };
              console.log('Using fallback normalized data due to JSON parsing failure');
            }
          }
        }

        // Normalize component hierarchy if provided
        if (Array.isArray(normalizedData?.components)) {
          normalizedData.components = normalizedData.components.map((c: any, idx: number) => ({
            ...c,
            level: typeof c?.level === 'number' && c.level >= 0 ? c.level : 0,
            sequence: typeof c?.sequence === 'number' && c.sequence > 0 ? c.sequence : (idx + 1),
          }))
        }

        if (!normalizedData || typeof normalizedData !== 'object') {
          throw new Error('LLM did not return a valid object');
        }

      } catch (parseError) {
        console.error('LLM response parsing error:', parseError);
        console.error('Full LLM output:', llmResult.response.output);
        console.error('LLM output length:', llmResult.response.output?.length);
        console.error('LLM output type:', typeof llmResult.response.output);

        // Log first and last 500 chars for debugging
        const output = llmResult.response.output || '';
        console.error('First 500 chars:', output.substring(0, 500));
        console.error('Last 500 chars:', output.substring(Math.max(0, output.length - 500)));

        // Check if it looks like JSON at all
        const startsWithBrace = output.trim().startsWith('{');
        const endsWithBrace = output.trim().endsWith('}');
        console.error('Starts with {:', startsWithBrace, 'Ends with }:', endsWithBrace);

        // Provide clearer error when response was truncated
        const truncated = llmResult.response.metadata?.finishReason === 'MAX_TOKENS';
        return {
          success: false,
          error: truncated
            ? 'LLM response was truncated and could not be parsed as JSON. Please try again with a shorter idea.'
            : `Failed to parse LLM response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
          llmResponse: llmResult.response,
        };
      }

      // Extract fields for easy database querying
      // Auto-detect archetype/invention type so downstream drafting/diagramming can use it without user input
      const detectedArchetype = this.normalizeArchetypeList(
        normalizedData?.inventionType,
        normalizedData?.fieldOfRelevance || areaOfInvention || ''
      )
      normalizedData.inventionType = detectedArchetype

      const extractedFields = {
        searchQuery: typeof normalizedData.searchQuery === 'string' ? String(normalizedData.searchQuery).trim() : undefined,
        problem: normalizedData.problem,
        objectives: normalizedData.objectives,
        components: normalizedData.components,
        logic: normalizedData.logic,
        inputs: normalizedData.inputs,
        outputs: normalizedData.outputs,
        variants: normalizedData.variants,
        inventionType: detectedArchetype,
        bestMethod: normalizedData.bestMethod,
        fieldOfRelevance: normalizedData.fieldOfRelevance,
        subfield: normalizedData.subfield,
        recommendedFocus: normalizedData.recommendedFocus,
        complianceNotes: normalizedData.complianceNotes,
        drawingsFocus: normalizedData.drawingsFocus,
        claimStrategy: normalizedData.claimStrategy,
        riskFlags: normalizedData.riskFlags,
        abstract: normalizedData.abstract,
        cpcCodes: Array.isArray(normalizedData.cpcCodes) ? normalizedData.cpcCodes.map((s: any) => String(s).trim()).filter(Boolean) : undefined,
        ipcCodes: Array.isArray(normalizedData.ipcCodes) ? normalizedData.ipcCodes.map((s: any) => String(s).trim()).filter(Boolean) : undefined
      };

      return {
        success: true,
        normalizedData,
        extractedFields,
        llmPrompt: prompt,
        llmResponse: llmResult.response,
        tokensUsed: llmResult.response.outputTokens
      };

    } catch (error) {
      console.error('Idea normalization error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Idea normalization failed'
      };
    }
  }

  // New: Generate specific annexure sections with guardrails and debug steps
  static async generateSections(
    session: any,
    sections: string[],
    instructions?: Record<string, string>,
    tenantId?: string,
    requestHeaders?: Record<string, string>,
    selectedPatents?: any[],
    jurisdiction: string = 'IN',
    preferredLanguage?: string
  ): Promise<SectionGenerationResult> {
   const debugSteps: Array<{ step: string; status: 'ok'|'fail'|'warning'; meta?: any }> = []
    try {
      // Step: gather context
      const idea = session.ideaRecord || {}
      const referenceMap = session.referenceMap || { components: [] }
      const jurisdictionCode = (jurisdiction || (session as any).activeJurisdiction || (session as any).draftingJurisdictions?.[0] || 'IN').toUpperCase()
      let countryProfile: any = await getCountryProfile(jurisdictionCode)
      if (preferredLanguage) {
        const langs: string[] = Array.isArray((countryProfile as any)?.profileData?.meta?.languages)
          ? (countryProfile as any).profileData.meta.languages
          : []
        const reordered = [preferredLanguage, ...langs.filter(l => l !== preferredLanguage)]
        countryProfile = {
          ...countryProfile,
          profileData: {
            ...(countryProfile as any)?.profileData || {},
            meta: {
              ...(countryProfile as any)?.profileData?.meta || {},
              languages: reordered
            }
          }
        }
      }
      const baseStyle = countryProfile ? await getBaseStyle(jurisdictionCode) : null
      const globalRules = countryProfile ? await getGlobalRules(jurisdictionCode) : null
      if (!countryProfile) {
        debugSteps.push({ step: 'jurisdiction_fallback', status: 'fail', meta: { jurisdiction: jurisdictionCode } })
      }

      const crossSectionChecks = countryProfile?.profileData?.validation?.crossSectionChecks || []
      const claimsRules = countryProfile?.profileData?.rules?.claims || null

      // Paper writing mode: Build citation context
      let citationContext: Awaited<ReturnType<typeof DraftingService.buildCitationContext>> | null = null;
      if (featureFlags.isEnabled('ENABLE_CITATIONS') && session?.id) {
        try {
          // For now, use the first section to determine citation context
          // In a full implementation, this would be section-specific
          const primarySection = sections[0] || 'introduction';
          citationContext = await this.buildCitationContext(session.id, primarySection);
          debugSteps.push({
            step: 'citation_context',
            status: 'ok',
            meta: { citationsCount: citationContext.relevantCitations.length }
          });
        } catch (error) {
          debugSteps.push({
            step: 'citation_context',
            status: 'fail',
            meta: { error: error instanceof Error ? error.message : 'Unknown error' }
          });
        }
      }

      // Note: Legacy importFiguresDirectly bypass was removed; figures now always flow through LLM prompts.
      const sectionResources: Record<string, { prompt: any; rules: any; meta: any; altKeys: string[]; checks?: any[]; cross?: any[]; claimsRules?: any }> = {}
      const sessionId = session?.id || session?._id || null // Get session ID for user instructions
      for (const s of sections) {
        const sectionMeta = this.resolveSectionMeta(countryProfile, s)
        const sectionKey = sectionMeta?.id || this.getFallbackSectionKey(s)
        // Pass sessionId to get merged prompt with user instructions (highest priority)
        const promptCfg = sectionKey ? await getDraftingPrompts(jurisdictionCode, sectionKey, sessionId) : null
        const sectionRules = sectionKey ? await getSectionRules(jurisdictionCode, sectionKey) : null
        const checks = countryProfile?.profileData?.validation?.sectionChecks?.[sectionKey] || countryProfile?.profileData?.validation?.sectionChecks?.[s]
        const cross = Array.isArray(crossSectionChecks) ? crossSectionChecks.filter((c: any) => (c?.from === sectionKey) || (c?.from === s)) : []
        
        sectionResources[s] = {
          prompt: promptCfg,
          rules: sectionRules,
          meta: sectionMeta,
          altKeys: Array.isArray(sectionMeta?.canonicalKeys) ? sectionMeta.canonicalKeys.map((k: string) => k.toLowerCase()) : [],
          checks: Array.isArray(checks) ? checks : undefined,
          cross: cross.length ? cross : undefined,
          claimsRules: s === 'claims' ? claimsRules : undefined
        }
        if (!sectionMeta) {
          debugSteps.push({ step: `section_unmapped_${s}`, status: 'fail', meta: { jurisdiction: jurisdictionCode } })
        }
      }

      // Gather prior art data for background section
      const manualPriorArt = (session as any).manualPriorArt || null
      const rawRelatedArtSelections = Array.isArray(session.relatedArtSelections)
        ? session.relatedArtSelections
        : []
      // Only treat USER_SELECTED records as approved prior art for drafting
      const relatedArtSelections = rawRelatedArtSelections.filter(
        (sel: any) => Array.isArray(sel.tags) && sel.tags.includes('USER_SELECTED')
      )
      const aiAnalysis = (session as any).aiAnalysisData || {}

      // Strategy: Use user-selected patents first; fallback to any available related art if none explicitly marked
      let selectedPriorArtPatents: any[] = []

      const userSelectedPool = rawRelatedArtSelections.filter(
        (sel: any) => Array.isArray(sel.tags) && sel.tags.includes('USER_SELECTED')
      )
      const fallbackPool = userSelectedPool.length ? userSelectedPool : rawRelatedArtSelections

      // Check for prior art selections saved in priorArtConfig.priorArtForDrafting (from Stage 3.5 workflow)
      const priorArtConfig = (session as any).priorArtConfig || {}
      const priorArtForDraftingConfig = priorArtConfig.priorArtForDrafting || {}
      const configSelectedPatents = Array.isArray(priorArtForDraftingConfig.selectedPatents) 
        ? priorArtForDraftingConfig.selectedPatents 
        : []
      
      // Track the source of prior art for debugging
      let priorArtSource: 'explicit' | 'priorArtConfig' | 'relatedArtSelections' | 'manual_only' | 'none' = 'none'

      // Helper: Normalize patent number for consistent matching (handles "US-123" vs "US123")
      const normalizePN = (pn: string | undefined | null): string => 
        pn ? pn.replace(/[-\s]/g, '').toUpperCase().trim() : ''

      // Helper: Safe sort by score (handles missing/non-numeric scores)
      const safeScoreSort = (a: any, b: any): number => {
        const aScore = typeof a.score === 'number' ? a.score : 0
        const bScore = typeof b.score === 'number' ? b.score : 0
        return bScore - aScore
      }

      // Helper: Deduplicate and enrich patents, skipping those with missing IDs
      const processPatents = (
        patents: any[], 
        enrichSource: any[], 
        preferConfigData: boolean = false
      ): any[] => {
        const uniqueMap = new Map<string, any>()
        
        for (const sel of patents) {
          const rawPN = sel.patentNumber || sel.pn || ''
          const normalizedPN = normalizePN(rawPN)
          
          // Skip patents with missing/invalid patent numbers
          if (!normalizedPN) {
            console.warn(`[DraftingService] Skipping prior art with missing patent number`)
            continue
          }
          
          // Skip if already processed (deduplication)
          if (uniqueMap.has(normalizedPN)) continue
          
          // Find enrichment data using normalized PN matching
          const fullPatentData = enrichSource.find((r: any) => 
            normalizePN(r.patentNumber) === normalizedPN
          ) || {}
          
          // Merge data: prefer non-empty values from available sources
          const merged = {
            ...fullPatentData,
            ...(preferConfigData ? sel : {}),
            patentNumber: rawPN || fullPatentData.patentNumber, // Keep original format
            // Prefer non-empty values for AI analysis fields
            aiSummary: sel.aiSummary || fullPatentData.aiSummary || aiAnalysis[rawPN]?.aiSummary || '',
            noveltyComparison: sel.noveltyComparison || fullPatentData.noveltyComparison || aiAnalysis[rawPN]?.noveltyComparison || '',
            noveltyThreat: sel.noveltyThreat || fullPatentData.noveltyThreat || aiAnalysis[rawPN]?.noveltyThreat || 'unknown'
          }
          
          uniqueMap.set(normalizedPN, merged)
        }
        
        return Array.from(uniqueMap.values()).sort(safeScoreSort)
      }

      if (selectedPatents && selectedPatents.length > 0) {
        // User explicitly picked patents in the UI
        priorArtSource = 'explicit'
        selectedPriorArtPatents = processPatents(selectedPatents, rawRelatedArtSelections, false)
      } else if (configSelectedPatents.length > 0) {
        // Use prior art selections saved in priorArtConfig from Stage 3.5 Prior Art for Drafting tab
        priorArtSource = 'priorArtConfig'
        console.log(`[DraftingService] Using ${configSelectedPatents.length} patents from priorArtConfig.priorArtForDrafting`)
        selectedPriorArtPatents = processPatents(configSelectedPatents, rawRelatedArtSelections, true)
      } else if (manualPriorArt?.useOnlyManualPriorArt) {
        // Respect user preference: no AI/related art
        priorArtSource = 'manual_only'
        selectedPriorArtPatents = []
      } else {
        // Use the best available pool (user-selected if present; otherwise all related art)
        priorArtSource = 'relatedArtSelections'
        console.log(`[DraftingService] Using ${fallbackPool.length} patents from relatedArtSelections (USER_SELECTED: ${userSelectedPool.length})`)
        selectedPriorArtPatents = processPatents(fallbackPool, [], false)
      }

      // Build figures list - use finalized sequence if available, otherwise merge from plans and sources
      let figures: Array<{ figureNo: number; title: string; description?: string; type?: string }> = []

      // Debug: Log sketch records availability
      const sketchCount = (session.sketchRecords || []).length
      if (sketchCount > 0) {
        console.log(`[DraftingService] Found ${sketchCount} sketches in session`)
      }

      if (session.figureSequenceFinalized && Array.isArray(session.figureSequence) && session.figureSequence.length > 0) {
        // Use the finalized figure sequence (includes both diagrams and sketches in user-defined order)
        const figureSequence = session.figureSequence as Array<{ id: string; type: string; sourceId: string; finalFigNo: number }>
        const sequencedSourceIds = new Set(figureSequence.map(s => s.sourceId))
        
        for (const seqItem of figureSequence) {
          if (seqItem.type === 'diagram') {
            // Find the diagram from figurePlans or diagramSources
            const plan = (session.figurePlans || []).find((f: any) => f.id === seqItem.sourceId)
            const source = (session.diagramSources || []).find((d: any) => d.figureNo === plan?.figureNo)
            if (plan) {
              figures.push({
                figureNo: seqItem.finalFigNo,
                title: this.sanitizeFigureTitle(plan.title) || `Figure ${seqItem.finalFigNo}`,
                description: plan.description || source?.description || '',
                type: 'diagram'
              })
            } else {
              // Fix #2: Log warning for missing sequence references
              console.warn(`[DraftingService] Diagram in sequence not found: sourceId=${seqItem.sourceId}`)
            }
          } else if (seqItem.type === 'sketch') {
            // Find the sketch from sketchRecords
            const sketch = (session.sketchRecords || []).find((s: any) => s.id === seqItem.sourceId)
            console.log(`[DraftingService] Processing sketch ${seqItem.sourceId} -> Fig.${seqItem.finalFigNo}, found: ${!!sketch}`)
            if (sketch && sketch.status === 'SUCCESS') {
              figures.push({
                figureNo: seqItem.finalFigNo,
                title: this.sanitizeFigureTitle(sketch.title) || `Figure ${seqItem.finalFigNo}`,
                description: sketch.description || '',
                type: 'sketch'
              })
            } else {
              // Fix #2: Log warning for missing sequence references
              console.warn(`[DraftingService] Sketch in sequence not found or not SUCCESS: sourceId=${seqItem.sourceId}`)
            }
          }
        }
        
        // Fix #1: Auto-append figures added after sequence was finalized
        // Check for diagrams not in sequence
        for (const plan of (session.figurePlans || [])) {
          if (!sequencedSourceIds.has(plan.id)) {
            console.warn(`[DraftingService] Diagram added after sequence finalized, appending: ${plan.id}`)
            figures.push({
              figureNo: figures.length + 1,
              title: this.sanitizeFigureTitle(plan.title) || `Figure ${figures.length + 1}`,
              description: plan.description || '',
              type: 'diagram'
            })
          }
        }
        // Check for sketches not in sequence
        const successSketches = (session.sketchRecords || []).filter((s: any) => s.status === 'SUCCESS')
        for (const sketch of successSketches) {
          if (!sequencedSourceIds.has(sketch.id)) {
            console.log(`[DraftingService] Adding sketch ${sketch.id} as fallback figure ${figures.length + 1}`)
            figures.push({
              figureNo: figures.length + 1,
              title: this.sanitizeFigureTitle(sketch.title) || `Figure ${figures.length + 1}`,
              description: sketch.description || '',
              type: 'sketch'
            })
          }
        }
      } else {
        // Fallback: Merge figures from plans AND diagram sources AND sketches (legacy behavior)
        // This ensures ALL figures are available for drafting, not just uploaded ones
        const planFigures = (session.figurePlans || []).map((f: any) => ({
          figureNo: f.figureNo,
          title: this.sanitizeFigureTitle(f.title) || `Figure ${f.figureNo}`,
          description: f.description || ''
        }))
        // Include ALL diagram sources, not just uploaded ones - a figure with PlantUML code is still valid
        const diagramFigures = (session.diagramSources || []).map((d: any) => {
          const found = planFigures.find((f: any) => f.figureNo === d.figureNo)
          const sanitized = this.sanitizeFigureTitle(found?.title || d.title)
          return {
            figureNo: d.figureNo,
            title: sanitized || `Figure ${d.figureNo}`,
            description: found?.description || d.description || ''
          }
        })
        // Include ALL sketches with SUCCESS status
        const allDiagramNos = [...planFigures, ...diagramFigures].map(f => f.figureNo)
        const maxDiagramNo = allDiagramNos.length > 0 ? Math.max(...allDiagramNos) : 0
        const sketchFigures = (session.sketchRecords || [])
          .filter((s: any) => s.status === 'SUCCESS')
          .map((s: any, index: number) => {
            const figNo = maxDiagramNo + index + 1
            return {
              figureNo: figNo,
              title: this.sanitizeFigureTitle(s.title) || `Figure ${figNo}`,
              description: s.description || '',
              type: 'sketch'
            }
          })

        const mergedByNo = new Map<number, any>()
        // Add all plan figures first
        for (const f of planFigures) mergedByNo.set(f.figureNo, { figureNo: f.figureNo, title: f.title, description: f.description, type: 'diagram' })
        // Add/overwrite with diagram figures (may have additional metadata or corrected titles)
        for (const f of diagramFigures) mergedByNo.set(f.figureNo, { figureNo: f.figureNo, title: f.title, description: f.description, type: 'diagram' })
        // Add sketches
        for (const f of sketchFigures) mergedByNo.set(f.figureNo, f)
        figures = Array.from(mergedByNo.values()).sort((a:any,b:any)=>a.figureNo-b.figureNo)
      }
      debugSteps.push({
        step: 'load_context',
        status: 'ok',
        meta: {
          ideaLoaded: !!idea,
          componentsCount: referenceMap.components?.length || 0,
          figuresCount: figures.length,
          figuresBreakdown: figures.map(f => ({ figureNo: f.figureNo, title: f.title, type: f.type })),
          manualPriorArtProvided: !!manualPriorArt,
          manualPriorArtPreview: manualPriorArt?.manualPriorArtText ? String(manualPriorArt.manualPriorArtText).slice(0, 140) + (String(manualPriorArt.manualPriorArtText).length > 140 ? '…' : '') : null,
          useOnlyManualPriorArt: !!manualPriorArt?.useOnlyManualPriorArt,
          useManualAndAISearch: !!manualPriorArt?.useManualAndAISearch,
          priorArtSource,
          priorArtConfigPatentsCount: configSelectedPatents.length,
          relatedArtSelectionsCount: rawRelatedArtSelections.length,
          userSelectedCount: userSelectedPool.length,
          selectedPriorArtPatentsCount: selectedPriorArtPatents.length,
          selectedPriorArtPreview: selectedPriorArtPatents.slice(0, 6).map((p: any) => ({
            patentNumber: p.patentNumber || p.pn || 'Unknown',
            noveltyThreat: p.noveltyThreat,
            hasAiSummary: !!p.aiSummary,
            hasNoveltyComparison: !!p.noveltyComparison
          }))
        }
      })
      debugSteps.push({
        step: 'jurisdiction_context',
        status: 'ok',
        meta: { jurisdiction: jurisdictionCode, hasCountryProfile: !!countryProfile }
      })

      // Build a concise invention-basics bundle (no claims) for sections that need context
      const componentsList = Array.isArray(referenceMap?.components)
        ? referenceMap.components
            .map((c: any) => {
              const name = c?.name || c?.label || ''
              const num = c?.numeral ? ` (${c.numeral})` : ''
              return name ? `${name}${num}` : ''
            })
            .filter(Boolean)
            .join('; ')
        : ''
      const inventionBasicsParts: string[] = []
      if (idea?.title) inventionBasicsParts.push(`Title: ${idea.title}`)
      if (idea?.problem || idea?.problemStatement) inventionBasicsParts.push(`Problem: ${idea.problem || idea.problemStatement}`)
      if (idea?.solution || idea?.description) inventionBasicsParts.push(`Solution: ${idea.solution || idea.description}`)
      if (componentsList) inventionBasicsParts.push(`Key components: ${componentsList}`)
      const inventionBasics = inventionBasicsParts.join('\n')

      // Build payload available across sections
      const payload = { idea, referenceMap, figures, approved: session.annexureDrafts?.[0] || {}, instructions: instructions || {}, manualPriorArt, selectedPriorArtPatents, inventionBasics }

      // Step: call LLM per section with single-section schema
      const request = { headers: requestHeaders || {} }
      const generated: Record<string, string> = {}
      let llmMeta: any = undefined

      for (const s of sections) {
        // Fetch writing sample for example-based style mimicry (if persona style is enabled)
        const usePersonaStyle = (session as any).usePersonaStyle === true // Only ON if explicitly true
        const personaSelection = (session as any).personaSelection || undefined
        let writingSample: WritingSampleContext | null = null
        if (usePersonaStyle && session?.userId) {
          try {
            // Pass personaSelection for multi-persona support (primary style + secondary terminology)
            writingSample = await getWritingSample(session.userId, s, jurisdictionCode, personaSelection)
            if (writingSample) {
              debugSteps.push({ 
                step: `writing_sample_${s}`, 
                status: 'ok', 
                meta: { 
                  jurisdiction: writingSample.jurisdiction,
                  isUniversal: writingSample.isUniversal,
                  wordCount: writingSample.sampleText.split(/\s+/).length,
                  personaName: writingSample.personaName,
                  hasPersonaSelection: !!personaSelection?.primaryPersonaId
                } 
              })
            }
          } catch (err) {
            console.warn(`[DraftingService] Failed to get writing sample for ${s}:`, err)
          }
        }

        // Fetch context injection requirements for this section (database-driven)
        let contextRequirements: SectionContextRequirements | null = null
        try {
          contextRequirements = await getSectionContextRequirements(s, jurisdictionCode)
          console.log(`[DraftingService] Section "${s}" context requirements:`, contextRequirements)
        } catch (err) {
          console.warn(`[DraftingService] Failed to get context requirements for ${s}:`, err)
        }

        // ══════════════════════════════════════════════════════════════════════════════
        // CONTEXT AVAILABILITY WARNINGS (Non-blocking)
        // Warn users when sections require context data that isn't provided
        // ══════════════════════════════════════════════════════════════════════════════
        const hasPriorArt = !!(payload.manualPriorArt?.manualPriorArtText || (payload.selectedPriorArtPatents && payload.selectedPriorArtPatents.length > 0))
        const hasFigures = !!(figures && figures.length > 0)
        const hasComponents = !!(referenceMap?.components && referenceMap.components.length > 0)
        
        const missingContextWarnings: string[] = []
        
        if (contextRequirements?.requiresPriorArt && !hasPriorArt) {
          missingContextWarnings.push('Prior Art references recommended for optimal quality')
          debugSteps.push({
            step: `context_warning_${s}`,
            status: 'warning',
            meta: {
              missingContext: 'priorArt',
              section: s,
              message: `Section "${s}" requires prior art references for best results. Consider adding prior art in the Prior Art Selection stage.`,
              impact: 'Section will be generated with generic background. Quality may be reduced.'
            }
          })
        }
        
        if (contextRequirements?.requiresFigures && !hasFigures) {
          missingContextWarnings.push('Figures/drawings recommended for optimal quality')
          debugSteps.push({
            step: `context_warning_${s}`,
            status: 'warning',
            meta: {
              missingContext: 'figures',
              section: s,
              message: `Section "${s}" requires figures/drawings for best results. Consider adding figures in the Figures & Sketches stage.`,
              impact: 'Section will be generated without figure references. Quality may be reduced.'
            }
          })
        }
        
        if (contextRequirements?.requiresComponents && !hasComponents) {
          missingContextWarnings.push('Component reference numerals recommended for optimal quality')
          debugSteps.push({
            step: `context_warning_${s}`,
            status: 'warning',
            meta: {
              missingContext: 'components',
              section: s,
              message: `Section "${s}" requires component reference numerals for best results. Consider adding components in the Reference Numerals stage.`,
              impact: 'Section will be generated without reference numerals. Quality may be reduced.'
            }
          })
        }
        
        if (missingContextWarnings.length > 0) {
          console.warn(`[DraftingService] ⚠️ Section "${s}" has missing recommended context: ${missingContextWarnings.join('; ')}`)
        }

        const prompt = this.buildSectionPrompt(s, payload, {
          jurisdiction: jurisdictionCode,
          countryProfile,
          baseStyle,
          sectionPrompt: sectionResources[s]?.prompt,
          sectionRules: sectionResources[s]?.rules,
          sectionMeta: sectionResources[s]?.meta,
          globalRules,
          sectionChecks: sectionResources[s]?.checks,
          crossChecksFrom: sectionResources[s]?.cross,
          claimsRules: sectionResources[s]?.claimsRules,
          writingSample,
          userId: session?.userId,
          usePersonaStyle,
          contextRequirements // Pass database-driven context requirements
        }, citationContext?.citationInstructions)
        // Add debug info about prompt injection (B+T+U)
        const promptDebug = sectionResources[s]?.prompt?.debug
        
        // COMPREHENSIVE B+T+U LOGGING
        console.log(`\n${'─'.repeat(80)}`)
        console.log(`📋 PROMPT INJECTION STATUS: ${s.toUpperCase()} (${jurisdictionCode})`)
        console.log(`${'─'.repeat(80)}`)
        if (promptDebug) {
          console.log(`  [B] BASE PROMPT:     ${promptDebug.hasBase ? '✓ YES' : '✗ NO'}`)
          console.log(`  [T] TOP-UP PROMPT:   ${promptDebug.hasTopUp ? '✓ YES' : '✗ NO'} ${promptDebug.topUpSource ? `(source: ${promptDebug.topUpSource})` : ''}`)
          console.log(`  [U] USER PROMPT:     ${promptDebug.hasUser ? '✓ YES' : '✗ NO'}`)
          console.log(`  ─────────────────────────────────────────`)
          console.log(`  Section Key:         ${promptDebug.sectionKey}`)
          console.log(`  Merge Strategy:      ${promptDebug.mergeStrategy}`)
          if (promptDebug.basePreview) {
            console.log(`  Base Preview:        "${promptDebug.basePreview.substring(0, 80)}..."`)
          }
          if (promptDebug.topUpPreview) {
            console.log(`  TopUp Preview:       "${promptDebug.topUpPreview.substring(0, 80)}..."`)
          }
        } else {
          console.log(`  ⚠️  NO PROMPT DEBUG INFO AVAILABLE`)
          console.log(`  Using legacy hardcoded prompt (this should not happen!)`)
        }
        console.log(`${'─'.repeat(80)}\n`)
        
        debugSteps.push({ 
          step: `build_prompt_${s}`, 
          status: 'ok',
          meta: {
            promptInjection: promptDebug ? {
              B: promptDebug.hasBase,
              T: promptDebug.hasTopUp,
              U: promptDebug.hasUser,
              source: promptDebug.topUpSource,
              key: promptDebug.sectionKey,
              strategy: promptDebug.mergeStrategy,
              basePreview: promptDebug.basePreview,
              topUpPreview: promptDebug.topUpPreview
            } : { B: false, T: false, U: false, source: null, key: s, strategy: 'none' }
          }
        })

        // Increase tokens for long sections
        const sectionMaxTokens = s === 'detailedDescription' ? 6000 : undefined

        // Get the stage code for section-specific model resolution
        // This maps section key to workflow stage (e.g., 'background' -> 'DRAFT_ANNEXURE_BACKGROUND')
        // The admin configures which LLM model to use for each stage in the LLM Config page
        const sectionStageCode = getSectionStageCode(s)

        const result = await llmGateway.executeLLMOperation(request, {
          taskCode: 'LLM2_DRAFT',
          stageCode: sectionStageCode, // Pass stage code for section-specific model resolution
          prompt,
          parameters: { tenantId, ...(sectionMaxTokens && { maxOutputTokens: sectionMaxTokens }) },
          idempotencyKey: crypto.randomUUID(),
          metadata: {
            patentId: session.patentId,
            sessionId: session.id,
            section: s,
            stageCode: sectionStageCode, // Include for debugging
            purpose: 'draft_section'
          }
        })
        if (!result.success || !result.response) {
          // Use user-friendly error message for MeteringError, fallback to generic message
          const errorMessage = result.error?.getUserMessage
            ? result.error.getUserMessage()
            : result.error?.message || `LLM failed for ${s}`

          debugSteps.push({ step: `llm_call_${s}`, status: 'fail', meta: { error: result.error?.message, userMessage: errorMessage } })
          return { success: false, error: errorMessage, debugSteps, retryAfter: result.error?.getRetryAfter?.() ?? undefined }
        }
        debugSteps.push({ step: `llm_call_${s}`, status: 'ok', meta: { outputTokens: result.response.outputTokens } })

        // Parse single-section JSON (robust)
        let normalizedData: any
        let parsed: any
        try {
          const output = (result.response.output || '').trim();
          console.log('Raw LLM output (first 500 chars):', output.substring(0, 500));
          console.log('Raw LLM output length:', output.length);

          // Merge any fenced JSON blocks if present
          const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
          let merged: Record<string, any> = {};
          let fenceMatch: RegExpExecArray | null;
          let fenceCount = 0;
          while ((fenceMatch = fenceRegex.exec(output)) !== null) {
            let block = (fenceMatch[1] || '').trim();
            if (!block) continue;
            block = block
              .replace(/,(\s*[}\]])/g, '$1')
              .replace(/([\x00-\x08\x0B\x0C\x0E-\x1F])/g, '');
            try {
              let obj: any;
              try { obj = JSON.parse(block); } 
              catch { obj = JSON.parse(block.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')); }
              if (obj && typeof obj === 'object') { merged = { ...merged, ...obj }; fenceCount++; }
            } catch {}
          }

          if (fenceCount > 0) {
            parsed = merged
            normalizedData = merged
            console.log('Merged JSON blocks from fences:', Object.keys(merged))
          } else {
            let jsonText = output
            const fenceStart = jsonText.indexOf('```')
            if (fenceStart !== -1) {
              jsonText = jsonText.slice(fenceStart + 3)
              jsonText = jsonText.replace(/^json\s*/i, '')
              const fenceEnd = jsonText.indexOf('```')
              if (fenceEnd !== -1) jsonText = jsonText.slice(0, fenceEnd)
            }
            const startBrace = jsonText.indexOf('{')
            const lastBrace = jsonText.lastIndexOf('}')
            if (startBrace !== -1) {
              jsonText = lastBrace !== -1 && lastBrace > startBrace ? jsonText.slice(startBrace, lastBrace + 1) : jsonText.slice(startBrace)
            }
            jsonText = jsonText.replace(/`+/g, '').replace(/,(\s*[}\]])/g, '$1').replace(/([\x00-\x08\x0B\x0C\x0E-\x1F])/g, '')

            // Handle unescaped newlines in JSON strings by temporarily replacing them
            const hasUnescapedNewlines = /"[^"]*\n[^"]*"/.test(jsonText)
            if (hasUnescapedNewlines) {
              // Replace unescaped newlines in string values with escaped versions
              jsonText = jsonText.replace(/"([^"]*(?:\n|\r|\r\n)[^"]*)"/g, (match, content) => {
                return '"' + content.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\r\n/g, '\\r\\n') + '"'
              })
            }

            try { normalizedData = JSON.parse(jsonText) }
            catch {
              const quotedKeys = jsonText.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
              normalizedData = JSON.parse(quotedKeys)
            }
            parsed = normalizedData
          }
          debugSteps.push({ step: `parse_${s}`, status: 'ok', meta: { parsingMethod: 'normalizeIdea_style' } })
        } catch (parseErr) {
          debugSteps.push({ step: `parse_${s}`, status: 'fail', meta: { error: parseErr instanceof Error ? parseErr.message : String(parseErr) } })
          return { success: false, error: `Invalid JSON from LLM for ${s}.`, debugSteps }
        }

        // Guardrails + Background D-label normalization
        let val = typeof parsed?.[s] === 'string' ? parsed[s].trim() : ''
        if (!val && sectionResources[s]?.altKeys?.length) {
          for (const alt of sectionResources[s].altKeys) {
            if (typeof parsed?.[alt] === 'string' && parsed[alt].trim()) {
              val = parsed[alt].trim()
              debugSteps.push({ step: `alt_key_used_${s}`, status: 'ok', meta: { alt } })
              break
            }
          }
        }
        if (val && sectionResources[s]?.checks) {
          for (const check of sectionResources[s].checks) {
            if (check?.type === 'maxWords' && typeof check.limit === 'number') {
              const words = val.split(/\s+/)
              if (words.length > check.limit) {
                val = words.slice(0, check.limit).join(' ')
                debugSteps.push({ step: `clip_words_${s}`, status: 'ok', meta: { limit: check.limit } })
              }
            }
            if (check?.type === 'maxChars' && typeof check.limit === 'number') {
              if (val.length > check.limit) {
                val = val.slice(0, check.limit)
                debugSteps.push({ step: `clip_chars_${s}`, status: 'ok', meta: { limit: check.limit } })
              }
            }
          }
        }
        if (s === 'background' && val) {
          // Normalize any D-labels to incremental order of first use and show identifier only on first mention
          const normalizeDLabels = (text: string) => {
            // 1) Find all first mentions: D<digits>( <identifier> ) or D<digits> (<identifier>) or raw identifiers
            const order: string[] = []
            const idForD: Record<string,string> = {}

            // Capture explicit Dn (ID)
            const firstMentionRegex = /\bD(\d+)\s*\(([^)]+)\)/g
            let m: RegExpExecArray | null
            while ((m = firstMentionRegex.exec(text)) !== null) {
              const d = `D${m[1]}`
              const id = m[2].trim()
              if (!order.includes(d)) {
                order.push(d)
                idForD[d] = id
              }
            }

            // If no explicit Dn(ID) found, try to capture bare Dn and then later references won't have IDs
            const bareDRegex = /\bD(\d+)\b/g
            while ((m = bareDRegex.exec(text)) !== null) {
              const d = `D${m[1]}`
              if (!order.includes(d)) order.push(d)
            }

            // 2) Build mapping to sequential D1, D2, ... by order of first use
            const mapOldToNew: Record<string,string> = {}
            order.forEach((old, idx) => { mapOldToNew[old] = `D${idx + 1}` })

            // 3) Replace all Dn labels consistently, preserving first-mention IDs only once
            let replaced = text
            // Replace labels with temp markers to avoid double replace (e.g., D1 -> D2 then D2 again)
            Object.entries(mapOldToNew).forEach(([oldD, newD]) => {
              const tmp = `@@${newD}@@`
              const re = new RegExp(`\\b${oldD}\\b`, 'g')
              replaced = replaced.replace(re, tmp)
            })
            // Drop old parentheses IDs tied to old labels, they'll be reattached on first mention
            replaced = replaced.replace(/@@D(\d+)@@\s*\(([^)]+)\)/g, '@@D$1@@')

            // Now finalize markers back to new labels
            replaced = replaced.replace(/@@(D\d+)@@/g, '$1')

            // 4) Re-attach identifier only to the first occurrence of each new label
            const seen: Set<string> = new Set()
            replaced = replaced.replace(/\b(D\d+)\b(?!\s*\()/g, (match) => {
              if (!seen.has(match) && idForD[order[Object.values(mapOldToNew).indexOf(match)] || '']) {
                seen.add(match)
                const orig = order[Object.values(mapOldToNew).indexOf(match)]
                const id = orig ? idForD[orig] : undefined
                return id ? `${match} (${id})` : match
              }
              return match
            })

            return replaced
          }
          try { val = normalizeDLabels(val) } catch {}
        }
        if (!val) {
          val = this.getFallbackContent(s, payload)
          debugSteps.push({ step: `fallback_${s}`, status: 'ok', meta: { used: true } })
        }
        const approvedTitle = s === 'abstract' ? (payload.approved?.title || idea?.title) : undefined
        let check = this.guardrailCheck(
          s,
          val,
          referenceMap,
          approvedTitle,
          { sectionChecks: sectionResources[s]?.checks, claimsRules: sectionResources[s]?.claimsRules }
        )
        if (!check.ok) {
          debugSteps.push({ step: `critic_${s}`, status: 'fail', meta: { reason: check.reason } })
          const fixed = this.minimalFix(s, val, { reason: check.reason, approvedTitle, referenceMap, figures: payload.figures, sectionChecks: sectionResources[s]?.checks, claimsRules: sectionResources[s]?.claimsRules })
          if (fixed && fixed.trim() && fixed !== val) {
            val = fixed.trim()
            const recheck = this.guardrailCheck(
              s,
              val,
              referenceMap,
              approvedTitle,
              { sectionChecks: sectionResources[s]?.checks, claimsRules: sectionResources[s]?.claimsRules }
            )
            if (recheck.ok) {
              debugSteps.push({ step: `fixer_${s}`, status: 'ok', meta: { applied: true, fixedTo: val.substring(0, 100) + '...' } })
              generated[s] = val
              debugSteps.push({ step: `guard_${s}`, status: 'ok' })
              // Enforce section hard word limits post-guard
              try {
                const enforced = this.enforceMaxWords(s, generated[s], sectionResources[s]?.checks, sectionResources[s]?.rules)
                if (enforced.clipped) {
                  generated[s] = enforced.text
                  debugSteps.push({ step: `limit_enforce_${s}`, status: 'ok', meta: { before: enforced.before, after: enforced.after, maxEnforced: true } })
                }
              } catch {}
            } else {
              debugSteps.push({ step: `fixer_${s}`, status: 'fail', meta: { reason: recheck.reason, fixedTo: val.substring(0, 100) + '...' } })
              // Allow content to pass through - guardrail issues will be caught during AI review
              debugSteps.push({ step: `guard_${s}`, status: 'warning', meta: { note: `Allowing content despite guardrail issue: ${recheck.reason}`, forReview: true } })
              generated[s] = val
              // Enforce section hard word limits post-guard
              try {
                const enforced = this.enforceMaxWords(s, generated[s], sectionResources[s]?.checks, sectionResources[s]?.rules)
                if (enforced.clipped) {
                  generated[s] = enforced.text
                  debugSteps.push({ step: `limit_enforce_${s}`, status: 'ok', meta: { before: enforced.before, after: enforced.after, maxEnforced: true } })
                }
              } catch {}
            }
          } else {
            // Allow content to pass through - guardrail issues will be caught during AI review
            debugSteps.push({ step: `guard_${s}`, status: 'warning', meta: { note: `Allowing content despite guardrail issue: ${check.reason}`, forReview: true } })
            generated[s] = val
            // Enforce section hard word limits post-guard
            try {
              const enforced = this.enforceMaxWords(s, generated[s], sectionResources[s]?.checks, sectionResources[s]?.rules)
              if (enforced.clipped) {
                generated[s] = enforced.text
                debugSteps.push({ step: `limit_enforce_${s}`, status: 'ok', meta: { before: enforced.before, after: enforced.after, maxEnforced: true } })
              }
            } catch {}
          }
        } else {
          generated[s] = val
          debugSteps.push({ step: `guard_${s}`, status: 'ok' })

          // Post-process citations if in paper writing mode
          if (citationContext && featureFlags.isEnabled('ENABLE_CITATIONS') && session?.id) {
            try {
              const citationStyle = session.citationStyleId ? await prisma.citationStyleDefinition.findUnique({
                where: { id: session.citationStyleId },
                select: { code: true }
              }).then(style => style?.code || 'APA7') : 'APA7';

              const postProcessed = await this.postProcessSection(
                generated[s],
                session.id,
                citationStyle,
                {
                  preserveCitationPlaceholders: true
                }
              );

              generated[s] = postProcessed.processedContent;

              if (postProcessed.warnings.length > 0) {
                debugSteps.push({
                  step: `citation_postprocess_${s}`,
                  status: 'warning',
                  meta: { warnings: postProcessed.warnings }
                });
              }

              if (postProcessed.citationsUsed.length > 0) {
                debugSteps.push({
                  step: `citations_used_${s}`,
                  status: 'ok',
                  meta: { count: postProcessed.citationsUsed.length, citations: postProcessed.citationsUsed }
                });
              }
            } catch (error) {
              debugSteps.push({
                step: `citation_postprocess_${s}`,
                status: 'fail',
                meta: { error: error instanceof Error ? error.message : 'Unknown error' }
              });
            }
          }
          // Enforce section hard word limits post-guard
          try {
            const enforced = this.enforceMaxWords(s, generated[s], sectionResources[s]?.checks, sectionResources[s]?.rules)
            if (enforced.clipped) {
              generated[s] = enforced.text
              debugSteps.push({ step: `limit_enforce_${s}`, status: 'ok', meta: { before: enforced.before, after: enforced.after, maxEnforced: true } })
            }
          } catch {}
        }

        // Save last llmMeta
        llmMeta = {
          modelClass: result.response.modelClass,
          promptHash: crypto.createHash('sha256').update(prompt).digest('hex'),
          params: result.response.metadata
        }
      }

      // Pair safety remains effective if both requested
      if (sections.includes('fieldOfInvention') && sections.includes('background')) {
        if (!generated.fieldOfInvention || !generated.fieldOfInvention.trim()) {
          generated.fieldOfInvention = this.getFallbackContent('fieldOfInvention', payload)
          debugSteps.push({ step: 'pair_guard_fieldOfInvention', status: 'ok' })
        }
        if (!generated.background || !generated.background.trim()) {
          generated.background = this.getFallbackContent('background', payload)
          debugSteps.push({ step: 'pair_guard_background', status: 'ok' })
        }
      }

      // Step: numeral/figure integrity quick check (non-blocking - issues caught during review)
      const fullText = Object.values(generated).join('\n')
      const validation = this.validateDraftConsistency({ fullText }, session)
      const hasInvalidRefs = validation.report.invalidReferences.length > 0
      debugSteps.push({ 
        step: 'integrity_check', 
        status: hasInvalidRefs ? 'warning' : 'ok', 
        meta: { ...validation.report, forReview: hasInvalidRefs, note: hasInvalidRefs ? 'Invalid references will be flagged during AI review' : undefined } 
      })
      // Do not block generation - issues will be caught during AI review stage

      // Extract context warnings from debugSteps for explicit return
      const warnings = debugSteps
        .filter(step => step.step.startsWith('context_warning_') && step.status === 'warning')
        .map(step => ({
          section: step.meta?.section || '',
          type: step.meta?.missingContext as 'priorArt' | 'figures' | 'components',
          message: step.meta?.message || '',
          impact: step.meta?.impact || ''
        }))

      return { success: true, generated, debugSteps, llmMeta, warnings: warnings.length > 0 ? warnings : undefined }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e)
      debugSteps.push({ step: 'exception', status: 'fail', meta: { message: errorMessage } })
      // Preserve the actual error message (especially for gating errors like missing frozen claims)
      // instead of returning a generic "Section generation failed"
      return { success: false, error: errorMessage || 'Section generation failed', debugSteps }
    }
  }

  private static resolveSectionMeta(profile: any | null, section: string) {
    if (!profile) return null
    const variants = profile?.profileData?.structure?.variants || []
    const defaultVariantId = profile?.profileData?.structure?.defaultVariant
    const variant = variants.find((v: any) => v.id === defaultVariantId) || variants[0]
    if (!variant?.sections) return null
    const candidates = this.sectionKeyMap[section] || [section]
    return variant.sections.find((s: any) =>
      candidates.some(key => s.id === key || (Array.isArray(s.canonicalKeys) && s.canonicalKeys.includes(key)))
    ) || null
  }

  private static getFallbackSectionKey(section: string): string {
    const candidates = this.sectionKeyMap[section]
    return candidates?.[0] || section
  }

  private static describeVoice(voice?: string): string {
    const val = (voice || '').toLowerCase()
    if (val.includes('impersonal')) return 'impersonal third person'
    if (val.includes('first')) return 'first person (avoid unless required)'
    if (val.includes('active')) return 'active voice'
    return voice || 'impersonal third person'
  }

  private static getSectionGuidance(section: string, sectionRules?: any): { label: string; target?: string } {
    const defaults: Record<string, { label: string; target?: string }> = {
      title: { label: 'Title', target: '<= 15 words' },
      abstract: { label: 'Abstract', target: '130-150 words' },
      preamble: { label: 'Preamble', target: '<= 40 words' },
      objectsOfInvention: { label: 'Objects of the Invention', target: '50-120 words' },
      fieldOfInvention: { label: 'Technical Field', target: '40-80 words' },
      background: { label: 'Background', target: '250-400 words' },
      crossReference: { label: 'Cross-Reference to Related Applications', target: '<= 120 words' },
      summary: { label: 'Summary', target: '120-200 words' },
      technicalProblem: { label: 'Technical Problem', target: '40-80 words' },
      technicalSolution: { label: 'Technical Solution', target: '60-120 words' },
      advantageousEffects: { label: 'Advantageous Effects', target: '60-120 words' },
      briefDescriptionOfDrawings: { label: 'Brief Description of Drawings', target: '~25 words per figure' },
      detailedDescription: { label: 'Detailed Description', target: '600-1200 words' },
      modeOfCarryingOut: { label: 'Mode of Carrying Out the Invention', target: '300-500 words' },
      bestMethod: { label: 'Best Mode', target: '150-300 words' },
      claims: { label: 'Claims' },
      industrialApplicability: { label: 'Industrial Applicability', target: '80-150 words' },
      listOfNumerals: { label: 'List of Reference Numerals' }
    }
    const base = { ...(defaults[section] || { label: section }) }
    if (sectionRules?.wordRange?.min || sectionRules?.wordRange?.max) {
      const min = sectionRules.wordRange?.min
      const max = sectionRules.wordRange?.max
      base.target = `${min || '~'}-${max || '~'} words`
    } else if (sectionRules?.maxWords) {
      base.target = `<= ${sectionRules.maxWords} words`
    }
    return base
  }

  /**
   * Normalize claims data to ensure consistent detection of frozen claims.
   * This backfills provisional/final fields from legacy data structures.
   * 
   * This is critical for the UDB (Universal Drafting Bundle) gating check to work
   * correctly across different data formats that may exist in legacy sessions.
   */
  private static normalizeClaimsData(normalized: Record<string, any> = {}): Record<string, any> {
    const merged = { ...(normalized || {}) }
    
    // Backfill provisional/final for legacy sessions
    if (!merged.claimsProvisional && merged.claims) {
      merged.claimsProvisional = merged.claims
    }
    if (!merged.claimsStructuredProvisional && merged.claimsStructured) {
      merged.claimsStructuredProvisional = merged.claimsStructured
    }
    
    // If claims are frozen (claimsApprovedAt is set), ensure final fields are populated
    if (merged.claimsApprovedAt) {
      if (!merged.claimsFinal) {
        merged.claimsFinal = merged.claims || merged.claimsProvisional
      }
      if (!merged.claimsStructuredFinal && merged.claimsStructured) {
        merged.claimsStructuredFinal = merged.claimsStructured
      }
    }
    
    return merged
  }

  private static normalizeArchetypeList(input: any, fallbackField?: string): string[] {
    const set = new Set<string>()
    const add = (raw?: string) => {
      if (!raw) return
      String(raw)
        .split('+')
        .map((p) => p.trim().toUpperCase())
        .filter(Boolean)
        .forEach((p) => set.add(p))
    }
    if (Array.isArray(input)) input.forEach((v) => add(typeof v === 'string' ? v : String(v)))
    else if (typeof input === 'string') add(input)
    if (set.size === 0 && fallbackField) add(this.determineArchetype(fallbackField))
    if (set.size === 0) set.add('GENERAL')
    if (set.size > 1 && set.has('GENERAL')) set.delete('GENERAL')
    return Array.from(set)
  }

  private static sanitizeFigureTitle(title?: string | null): string {
    const raw = typeof title === 'string' ? title : (title ?? '').toString()
    if (!raw.trim()) return ''
    const cpcIpcPattern = /\b(?:CPC|IPC)?\s*(?:class\s*)?[A-H][0-9]{1,2}[A-Z]\s*\d+\/\d+\b/gi
    let cleaned = raw.replace(cpcIpcPattern, '')
    cleaned = cleaned.replace(/\b(?:CPC|IPC)\b[:\-]?\s*/gi, '')
    cleaned = cleaned.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1')
    cleaned = cleaned.replace(/^[\s,:;.-]+|[\s,:;.-]+$/g, '')
    return cleaned.trim()
  }

  private static determineArchetype(field: string): string {
    const f = field?.toLowerCase() || ''
    if (/(software|computer|internet|app|data|ai|algorithm|blockchain|network|platform|server|cloud|processor)/.test(f)) return 'SOFTWARE'
    if (/(chem|pharma|compound|composition|material|polymer|alloy|drug|molecule|synthesis)/.test(f)) return 'CHEMICAL'
    if (/(bio|gene|cell|protein|dna|rna|medical|diagnostic|therapeutic|antibody|sequence)/.test(f)) return 'BIO'
    if (/(electric|circuit|semiconductor|voltage|power|sensor|transistor|communication|wireless|signal)/.test(f)) return 'ELECTRICAL'
    if (/(mechanic|device|apparatus|tool|machine|engine|structure|fastener|assembly|housing)/.test(f)) return 'MECHANICAL'
    return 'GENERAL'
  }

  private static getArchetypeInstructions(archetype: string): string {
    const base = 'CRITICAL: You are executing a DEEP DRAFTING PROTOCOL. Apply the following mental models where relevant to the component/step being described. Do not force-fit attributes (e.g., do not invent "force transmission" for a static label).'
    
    // Handle hybrid types (e.g., "MECHANICAL+SOFTWARE")
    const types = archetype.split('+')
    let instructions = base + '\n'

    if (types.includes('MECHANICAL')) {
      instructions += `
        [MECHANICAL PROTOCOL]
        For physical assemblies, consider this KINEMATIC CHAIN pattern:
        1. **Geometric Definition**: Define shape, orientation, and connectivity.
        2. **Force/Motion Transmission**: Explain how movement/force flows between parts.
        3. **Constraint Logic**: Describe how degrees of freedom are restricted.
        4. **Material Alternatives**: List functional equivalents (e.g., "fastener -> screw, weld").
      `
    }
    if (types.includes('SOFTWARE')) {
      instructions += `
        [SOFTWARE PROTOCOL]
        For algorithmic steps, consider this DATA-FLOW pattern:
        1. **I/O Contract**: Define inputs and outputs.
        2. **Transformation Logic**: Explain the step-by-step processing.
        3. **State Management**: Describe triggers and state transitions.
        4. **Hardware Tether**: Link logic to physical hardware (processor/memory) for eligibility.
      `
    }
    if (types.includes('CHEMICAL')) {
      instructions += `
        [CHEMICAL PROTOCOL]
        For substances, consider this FORMULATION pattern:
        1. **Range Definitions**: State broad/preferred ranges and optimal values.
        2. **Functional Role**: Explain the technical purpose of the ingredient.
        3. **Equivalents (Markush)**: List chemical analogs with similar function.
        4. **Synthesis Parameters**: Define critical conditions (temp, pressure, pH).
      `
    }
    if (types.includes('ELECTRICAL')) {
      instructions += `
        [ELECTRICAL PROTOCOL]
        For circuits, consider this SIGNAL-PATH pattern:
        1. **Topological Connection**: Describe series/parallel connections.
        2. **Signal Characteristics**: Define voltage/frequency/logic states.
        3. **Operational Logic**: Explain gating or switching behavior.
        4. **Component Values**: Mention typical ratings/values if enabling.
      `
    }
    if (types.includes('BIO')) {
      instructions += `
        [BIO PROTOCOL]
        For biological entities, consider this ENABLEMENT pattern:
        1. **Sequence/Structure**: Refer to IDs or structural formulas.
        2. **Functional Activity**: Quantify the biological effect or affinity.
        3. **Homology/Variants**: Define acceptable identity percentages.
        4. **Preparation**: Reference isolation or synthesis methods.
      `
    }
    
    if (types.includes('GENERAL') || instructions === base + '\n') {
       instructions += `
        [GENERAL PROTOCOL]
        1. Structural/Logical Definition: Define it by connection to neighbors.
        2. Configuration Sprawl: List material/structural alternatives.
        3. Interaction Dynamics: Explain system behavior when this acts.
        4. Reference Chaining: Use phrases like "With simultaneous reference to FIGS. 1 and 2...".
       `
    }

    return instructions
  }

  /**
   * Build section-specific context block with only necessary facts.
   * 
   * IMPORTANT: Context injection respects admin-controlled flags from contextRequirements.
   * This is NOT a source of truth for deciding what to inject - it only formats the data.
   * The actual injection decisions are made in buildSectionPrompt() based on admin flags.
   * 
   * NOTE: This function is a LEGACY helper and may be deprecated.
   * The primary context injection now happens in buildSectionPrompt() which properly
   * checks contextRequirements flags. This function should ONLY return basic idea context
   * (title, description) that is always safe to include.
   */
  private static buildContextBlock(sectionKey: string, payload: any, ctx: SectionPromptContext): string {
    const { idea, referenceMap, figures, approved } = payload
    
    // Admin-controlled flags - SINGLE SOURCE OF TRUTH
    const ctxReqs = ctx?.contextRequirements
    const shouldInjectComponents = ctxReqs?.requiresComponents === true
    const shouldInjectFigures = ctxReqs?.requiresFigures === true
    
    // Build context strings (only if admin flag allows)
    const numerals = shouldInjectComponents 
      ? (referenceMap?.components || []).map((c: any) => `${c.name} (${c.numeral})`).join(', ')
      : ''
    const figs = shouldInjectFigures
      ? (figures || []).map((f: any) => `Fig.${f.figureNo}: ${f.title}`).join('; ')
      : ''

    switch (sectionKey) {
      case 'detailedDescription':
        const contextParts: string[] = []
        if (idea?.title) contextParts.push(`Title: ${idea.title}`)
        if (numerals) contextParts.push(`Components: ${numerals}`)
        if (figs) contextParts.push(`Figures: ${figs}`)
        return contextParts.join('\n')

      case 'background':
        const bgParts: string[] = []
        if (idea?.fieldOfRelevance) bgParts.push(`Technical Field: ${idea.fieldOfRelevance}`)
        if (idea?.problem || idea?.problemStatement) {
          bgParts.push(`Problem: ${idea.problem || idea.problemStatement}`)
        }
        return bgParts.join('\n')

      case 'claims':
        const claimParts: string[] = []
        if (idea?.title) claimParts.push(`Title: ${idea.title}`)
        if (numerals) claimParts.push(`Components: ${numerals}`)
        if (idea?.objectives) claimParts.push(`Objectives: ${idea.objectives}`)
        return claimParts.join('\n')

      case 'abstract':
        const absParts: string[] = []
        if (idea?.title) absParts.push(`Title: ${idea.title}`)
        if (idea?.description) absParts.push(`Description: ${idea.description.substring(0, 200)}...`)
        if (numerals) absParts.push(`Key Components: ${numerals.split(', ').slice(0, 3).join(', ')}`)
        return absParts.join('\n')

      case 'briefDescriptionOfDrawings':
        // Figures - only if admin flag allows
        return figs ? `Figures: ${figs}` : ''

      default:
        // Only include basic idea context (always safe)
        const defaultParts: string[] = []
        if (idea?.title) defaultParts.push(`Title: ${idea.title}`)
        if (idea?.description) defaultParts.push(`Description: ${idea.description}`)
        return defaultParts.join('\n')
    }
  }

  private static buildSectionPrompt(section: string, payload: any, ctx: SectionPromptContext, citationContext?: string): string {
    const { idea, referenceMap, figures, approved, instructions, manualPriorArt, selectedPriorArtPatents } = payload

    // Priority: 1. Manually confirmed types (array/string) -> 2. Normalized data -> 3. Auto-detected (regex)
    const archetypeList = this.normalizeArchetypeList(
      idea?.inventionType ?? idea?.normalizedData?.inventionType,
      idea?.fieldOfRelevance || idea?.normalizedData?.fieldOfRelevance || ''
    )
    const archetype = archetypeList.join('+') || 'GENERAL'

    const numerals = (referenceMap?.components || []).map((c: any) => `${c.name} (${c.numeral})`).join(', ')
    const figs = (figures || []).map((f: any) => `Fig.${f.figureNo}: ${f.title}`).join('; ')
    const instr = (instructions && instructions[section]) ? String(instructions[section]) : 'none'

    const jurisdiction = (ctx?.jurisdiction || 'IN').toUpperCase()
    const countryName = ctx?.countryProfile?.name || jurisdiction
    const officeName = ctx?.countryProfile?.profileData?.meta?.office || 'Patent Office'
    const language = (ctx?.countryProfile?.profileData?.meta?.languages?.[0] || 'English')
    const tone = ctx?.baseStyle?.tone || 'technical, neutral, precise'
    const voice = this.describeVoice(ctx?.baseStyle?.voice || 'impersonal third person')
    const avoid = Array.isArray(ctx?.baseStyle?.avoid) ? ctx.baseStyle.avoid.join(', ') : (ctx?.baseStyle?.avoid || 'marketing language, unsupported advantages, unsubstantiated claims')
    const guidance = this.getSectionGuidance(section, ctx?.sectionRules || undefined)
    const sectionLabel = (guidance as any)?.label || section

    // Handle superset prompts with template variables
    let promptInstruction = ''
    let promptConstraints = ''

    if (ctx?.sectionPrompt?.instruction) {
      promptInstruction = ctx.sectionPrompt.instruction

      // Replace template variables in superset prompts
      // CRITICAL: No empty placeholders - omit variable entirely if data is missing
      const templateVars: Record<string, string> = {
        '{{COUNTRY_CODE}}': jurisdiction,
        '{{FILING_TYPE}}': idea?.filingType || 'Complete',
        '{{ABSTRACT_OR_SUMMARY}}': idea?.abstract || idea?.description || idea?.title || '',
        '{{INVENTION_TITLE}}': idea?.title || '',
        '{{CORE_KEYWORDS}}': (idea?.keywords || idea?.normalizedData?.keywords || []).join(', ') || '',
        '{{PRIOR_ART_SUMMARY}}': manualPriorArt || '',
        '{{PROBLEM_STATEMENT}}': idea?.problemStatement || idea?.description || '',
        '{{ADVANTAGES_LIST}}': (idea?.advantages || idea?.benefits || []).join('; ') || '',
        '{{INDEPENDENT_CLAIMS}}': '', // Populated via UDB Claim 1 injection
        '{{KEY_EMBODIMENTS}}': '', // Omit if not available
        '{{FIGURE_LIST}}': figs || '',
        '{{FULL_DISCLOSURE_TEXT}}': idea?.description || idea?.detailedDescription || '',
        '{{ELEMENT_MAP}}': numerals || '',
        '{{PREFERRED_PARAMS}}': '', // Omit if not available
        '{{BEST_EXAMPLE}}': '', // Omit if not available
        '{{USE_CASES}}': (idea?.useCases || idea?.applications || []).join('; ') || '',
        '{{NOVELTY_POINT}}': idea?.noveltyPoint || '',
        '{{ELEMENT_LIST}}': numerals || '',
        '{{FULL_DRAFT_TEXT}}': '' // Omit if not available
      }

      // Replace all template variables case-insensitively
      for (const [key, value] of Object.entries(templateVars)) {
        // Escape special characters in the key (like {{ and }}) for regex
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        promptInstruction = promptInstruction.replace(new RegExp(escapedKey, 'gi'), value)
      }

      // FINAL SAFETY: Remove any unreplaced {{VAR}} tags to avoid confusing the LLM
      // This handles typos in the database by admins (e.g. {{COUNTRY_COD}})
      if (promptInstruction.includes('{{')) {
        const remainingTags = promptInstruction.match(/\{\{[A-Z0-9_]+\}\}/gi);
        if (remainingTags) {
          console.warn(`[buildSectionPrompt] ⚠️  Removing ${remainingTags.length} unreplaced tags: ${remainingTags.join(', ')}`);
          promptInstruction = promptInstruction.replace(/\{\{[A-Z0-9_]+\}\}/gi, '');
        }
      }
    }

    if (ctx?.sectionPrompt?.constraints?.length) {
      promptConstraints = `Constraints: ${ctx.sectionPrompt.constraints.join('; ')}`
    }

    const targetLine = (guidance as any)?.target || ''
    const targetDisplay = targetLine ? `Target length: ${targetLine}.` : ''

    const ruleLines: string[] = []
    if (Array.isArray(ctx?.sectionChecks)) {
      for (const c of ctx.sectionChecks) {
        if (c?.type === 'maxWords' && typeof c.limit === 'number') ruleLines.push(`- Do not exceed ${c.limit} words.`)
        if (c?.type === 'maxChars' && typeof c.limit === 'number') ruleLines.push(`- Do not exceed ${c.limit} characters.`)
        if (c?.type === 'maxCount' && typeof c.limit === 'number') ruleLines.push(`- Do not exceed ${c.limit} items/paragraphs.`)
      }
    }
    if (Array.isArray(ctx?.crossChecksFrom) && ctx.crossChecksFrom.length) {
      for (const c of ctx.crossChecksFrom) {
        if (c?.type === 'support' && Array.isArray(c.mustBeSupportedBy)) {
          ruleLines.push(`- Must be fully supported by: ${c.mustBeSupportedBy.join(', ')}.`)
        }
        if (c?.type === 'consistency' && Array.isArray(c.mustBeConsistentWith)) {
          ruleLines.push(`- Must be consistent with: ${c.mustBeConsistentWith.join(', ')}.`)
        }
      }
    }
    if (section === 'claims' && ctx?.claimsRules) {
      const cr = ctx.claimsRules
      if (cr.twoPartFormPreferred === false) ruleLines.push('- Avoid two-part "characterized in that" format; use single-part claims.')
      if (cr.allowMultipleDependent === false) ruleLines.push('- Each dependent claim must reference a single prior claim (no multiple dependency).')
      if (Array.isArray(cr.discouragedConnectors) && cr.discouragedConnectors.length) {
        ruleLines.push(`- Discouraged connectors: ${cr.discouragedConnectors.join(', ')}.`)
      }
      if (Array.isArray(cr.forbiddenPhrases) && cr.forbiddenPhrases.length) {
        ruleLines.push(`- Forbidden phrases: ${cr.forbiddenPhrases.join(', ')}.`)
      }
      if (typeof cr.maxIndependentClaimsBeforeExtraFee === 'number') {
        ruleLines.push(`- Keep independent claims ≤ ${cr.maxIndependentClaimsBeforeExtraFee} before extra fees.`)
      }
      if (typeof cr.maxTotalClaimsRecommended === 'number') {
        ruleLines.push(`- Recommended total claims ≤ ${cr.maxTotalClaimsRecommended}.`)
      }
      if (cr.requireSupportInDescription) {
        ruleLines.push('- Every claim element must be supported in the Detailed Description.')
      }
      if (cr.allowReferenceNumeralsInClaims === false) {
        ruleLines.push('- Do not use reference numerals inside claims.')
      } else if (cr.allowReferenceNumeralsInClaims === true) {
        ruleLines.push('- You may include reference numerals where helpful.')
      }
    }
    const ruleBlock = ruleLines.length ? `Additional Rules:\n${ruleLines.join('\n')}` : ''

    // Build writing sample block for example-based style mimicry
    let writingSampleBlock = ''
    if (ctx?.usePersonaStyle && ctx?.writingSample) {
      writingSampleBlock = buildWritingSampleBlock(ctx.writingSample, section)
      const styleHints = getSectionStyleHints(section)
      if (styleHints) {
        writingSampleBlock += `\n${styleHints}`
      }
    }

    const roleToneHeader = `
You are a senior patent attorney drafting the "${sectionLabel}" section for a ${countryName} patent specification handled by the ${officeName}.
- Jurisdiction: ${jurisdiction}
- Language: ${language}
- Tone: ${tone}
- Voice: ${voice}
- Archetype: ${archetype}
- Avoid: ${avoid}
${targetDisplay}
${ruleBlock ? `${ruleBlock}\n` : ''}
Ensure the writing is objective, precise, and ready for filing.
${writingSampleBlock}`

    // CRITICAL: If database has a custom prompt instruction, use it as PRIMARY
    // This ensures admin changes in CountrySectionPrompt take effect immediately
    // Only fall through to hardcoded switch cases if no database prompt exists
    if (promptInstruction && promptInstruction.trim()) {
      console.log(`[buildSectionPrompt] Using DATABASE prompt for section "${section}" in ${jurisdiction}`)
      
      const idea = payload.idea || {}
      const rawNormalizedData = idea?.normalizedData || {}
      
      // Normalize claims data to ensure consistent detection of frozen claims
      // This backfills provisional/final fields from legacy data structures
      const normalizedData = this.normalizeClaimsData(rawNormalizedData)
      
      // ══════════════════════════════════════════════════════════════════════════════
      // UNIVERSAL DRAFTING BUNDLE (UDB) - Normalized Data + Claim 1
      // ══════════════════════════════════════════════════════════════════════════════
      const udbResult = buildUniversalDraftingBundle(section, normalizedData, idea)
      
      // Check gating: if section requires Claim 1 but it's missing, throw error
      if (udbResult.gated) {
        console.error(`[buildSectionPrompt] GATED: ${udbResult.gateReason}`)
        throw new Error(udbResult.gateReason || `Section "${section}" requires Claim 1 but claims are not available.`)
      }
      
      // ══════════════════════════════════════════════════════════════════════════════
      // SECTION-SPECIFIC CONTEXT (figures, components, prior art - unchanged)
      // ══════════════════════════════════════════════════════════════════════════════
      const numeralsContext = numerals ? `Reference numerals: ${numerals}` : ''
      const figuresContext = figs ? `Figures: ${figs}` : ''
      
      // ══════════════════════════════════════════════════════════════════════════════
      // SECTION-SPECIFIC CONTEXT INJECTION (DATABASE-DRIVEN - RESPECTS ADMIN FLAGS)
      // ══════════════════════════════════════════════════════════════════════════════
      // IMPORTANT: Context is ONLY injected if:
      // 1. The admin flag for that context type is TRUE (from contextRequirements)
      // 2. The data actually exists
      // This is the SINGLE SOURCE OF TRUTH for context injection decisions.
      // ══════════════════════════════════════════════════════════════════════════════
      
      const ctxReqs = ctx?.contextRequirements
      const shouldInjectPriorArt = ctxReqs?.requiresPriorArt === true
      const shouldInjectFigures = ctxReqs?.requiresFigures === true
      const shouldInjectComponents = ctxReqs?.requiresComponents === true
      // Note: requiresClaims is handled by UDB (Claim 1 anchoring), not here
      
      let additionalContext = ''
      switch (section) {
        case 'background':
          // Prior art context - ONLY if admin flag allows AND data exists
          if (shouldInjectPriorArt) {
            const priorArtText = payload.manualPriorArt?.manualPriorArtText || ''
            const selectedPatentNumbers = payload.selectedPriorArtPatents?.map((p: any) => p.patentNumber).filter(Boolean).join(', ')
            if (priorArtText || selectedPatentNumbers) {
              additionalContext = `Prior Art References: ${priorArtText || selectedPatentNumbers}`
            }
          }
          break
        case 'briefDescriptionOfDrawings':
          // Figures context - ONLY if admin flag allows AND data exists
          if (shouldInjectFigures && figuresContext) {
            additionalContext = figuresContext
          }
          break
        case 'detailedDescription':
          // Components + Figures - ONLY if respective admin flags allow
          const detailParts: string[] = []
          if (shouldInjectComponents && numeralsContext) detailParts.push(numeralsContext)
          if (shouldInjectFigures && figuresContext) detailParts.push(figuresContext)
          additionalContext = detailParts.join('\n')
          break
        case 'listOfNumerals':
          // Components context - ONLY if admin flag allows
          if (shouldInjectComponents && numeralsContext) {
            additionalContext = numeralsContext
          }
          break
        default:
          // For other sections: respect admin flags for each context type
          const defaultParts: string[] = []
          if (shouldInjectComponents && numeralsContext) defaultParts.push(numeralsContext)
          if (shouldInjectFigures && figuresContext) defaultParts.push(figuresContext)
          additionalContext = defaultParts.join('\n')
      }
      
      // ══════════════════════════════════════════════════════════════════════════════
      // ANTI-HALLUCINATION GUARDS (automatic, not admin-controlled)
      // ══════════════════════════════════════════════════════════════════════════════
      const hasFigures = !!(figures && figures.length > 0)
      const hasPriorArt = !!(payload.manualPriorArt?.manualPriorArtText || (payload.selectedPriorArtPatents && payload.selectedPriorArtPatents.length > 0))
      const hasComponents = !!(referenceMap?.components && referenceMap.components.length > 0)
      const antiHallucinationBlock = buildAntiHallucinationGuards(hasFigures, hasPriorArt, hasComponents)
      
      // Extract base, top-up, and user prompts
      const basePrompt = promptInstruction
      const topUpPrompt = '' // Database-driven prompts don't have separate top-up in this context
      const userPrompt = instr !== 'none' ? instr : ''

      // Section output rules (neutral figure reference) - ONLY if admin flag allows figures
      const sectionOutputRules = shouldInjectFigures && hasFigures
        ? 'Figures may be referenced only as "(FIG. X)" or "(see FIG. X)". Do not use words like "shows", "depicts", "illustrates", "represented", or "as shown".'
        : ''

      // Assemble the full prompt with UDB
      const promptParts: string[] = [roleToneHeader]
      
      promptParts.push(`
YOU ARE DRAFTING A PATENT SPECIFICATION SECTION.
FOLLOW THE PROMPTS BELOW IN THE GIVEN PRIORITY ORDER.

PRIORITY ORDER (AUTHORITATIVE):
1) BASE PROMPT (superset section)
2) TOP-UP PROMPT (jurisdiction)
3) USER INSTRUCTIONS (session-specific)
If conflicts exist: TOP-UP overrides BASE for jurisdiction compliance, and USER overrides only where it does not violate BASE/TOP-UP constraints.`)

      // Section output rules (only if non-empty)
      if (sectionOutputRules || promptConstraints) {
        promptParts.push(`
────────────────────────────────────────
SECTION OUTPUT RULES (FORMAT OVERRIDES)
────────────────────────────────────────`)
        if (sectionOutputRules) promptParts.push(sectionOutputRules)
        if (promptConstraints) promptParts.push(`Constraints: ${promptConstraints}`)
      }

      promptParts.push(`
────────────────────────────────────────
BASE PROMPT (AUTHORITATIVE)
────────────────────────────────────────
${basePrompt}`)

      // Top-up prompt (only if non-empty)
      if (topUpPrompt) {
        promptParts.push(`
────────────────────────────────────────
TOP-UP PROMPT (JURISDICTION – AUTHORITATIVE)
────────────────────────────────────────
${topUpPrompt}`)
      }

      // User instructions (only if non-empty)
      if (userPrompt) {
        promptParts.push(`
────────────────────────────────────────
USER INSTRUCTIONS (SESSION-SPECIFIC)
────────────────────────────────────────
${userPrompt}`)
      }

      // Universal Drafting Bundle (ND + C1)
      if (udbResult.block) {
        promptParts.push(udbResult.block)
      }

      // Additional section-specific context (figures, numerals, prior art)
      if (additionalContext) {
        promptParts.push(`
────────────────────────────────────────
ADDITIONAL CONTEXT
────────────────────────────────────────
${additionalContext}`)
      }

      // Anti-hallucination guards
      if (antiHallucinationBlock) {
        promptParts.push(antiHallucinationBlock)
      }

      // Citation context (for paper writing mode)
      if (citationContext && citationContext.trim()) {
        promptParts.push(`
────────────────────────────────────────
CITATION CONTEXT (ACADEMIC WRITING)
────────────────────────────────────────
${citationContext}`)
      }

      // Output control
      promptParts.push(`
────────────────────────────────────────
OUTPUT CONTROL
────────────────────────────────────────
Return ONLY a valid JSON object exactly matching this schema:
{ "${section}": "..." }

Formatting requirements INSIDE the JSON string:
- Preserve paragraph breaks using two newline characters between paragraphs.
- Do not include any other keys.`)

      return promptParts.join('\n')
    }

    // NO HARDCODED FALLBACKS - Database prompts are required
    // If we reach here, it means no database prompt exists for this section
    const errorMsg = `
═══════════════════════════════════════════════════════════════════════════════
ERROR: NO DATABASE PROMPT FOUND
═══════════════════════════════════════════════════════════════════════════════
Section:      ${section}
Jurisdiction: ${jurisdiction}

REQUIRED ACTION:
Add a prompt for this section in one of the following database tables:
1. CountrySectionPrompt (for jurisdiction-specific top-up prompts)
2. SupersetSection (for base/universal prompts)

Use the Super Admin panel to add the missing prompt.
═══════════════════════════════════════════════════════════════════════════════`
    
    console.error(errorMsg)
    throw new Error(`Missing database prompt for section "${section}" in jurisdiction "${jurisdiction}". Please add the prompt via Super Admin panel.`)
  }

  // Enforce conservative hard upper word limits per section to avoid overflows
  private static enforceMaxWords(
    section: string,
    text: string,
    sectionChecks?: any[] | null,
    sectionRules?: any | null
  ): { text: string; clipped: boolean; before: number; after: number } {
    const wc = (t: string) => (String(t || '').trim().length ? String(t).trim().split(/\s+/).length : 0)
    const before = wc(text)
    let max: number | undefined
    const maxWordLimiter = (sectionChecks || []).find((c: any) => c?.type === 'maxWords' && typeof c.limit === 'number')
    if (maxWordLimiter) {
      max = maxWordLimiter.limit
    } else if (sectionRules?.wordRange?.max) {
      max = sectionRules.wordRange.max
    } else if (sectionRules?.maxWords) {
      max = sectionRules.maxWords
    }
    if (!max) {
      const fallback: Record<string, number> = {
        title: 15,
        abstract: 150,
        fieldOfInvention: 80,
        background: 400,
        summary: 300,
        // IMPORTANT: briefDescriptionOfDrawings - no word limit
        // Each figure needs its own line with full description (no truncation)
        briefDescriptionOfDrawings: 10000,
        detailedDescription: 1200,
        bestMethod: 350,
        claims: 900,
        industrialApplicability: 100,
        listOfNumerals: 1000
      }
      max = fallback[section]
    }
    if (!max || before <= max) return { text, clipped: false, before, after: before }

    // Improved sentence split that preserves common abbreviations in patent text
    // Does NOT split after: Fig., No., e.g., i.e., etc., vs., approx., ref., para., sec., art., pat.
    const smartSentenceSplit = (t: string): string[] => {
      // First, temporarily replace common abbreviations with placeholders
      const abbrevs = [
        'Fig.', 'FIG.', 'fig.', 'Figs.', 'FIGS.', 'figs.',
        'No.', 'no.', 'Nos.', 'nos.',
        'e.g.', 'E.g.', 'i.e.', 'I.e.', 'etc.', 'Etc.',
        'vs.', 'Vs.', 'approx.', 'Approx.',
        'ref.', 'Ref.', 'refs.', 'Refs.',
        'para.', 'Para.', 'paras.', 'Paras.',
        'sec.', 'Sec.', 'secs.', 'Secs.',
        'art.', 'Art.', 'arts.', 'Arts.',
        'pat.', 'Pat.', 'pats.', 'Pats.',
        'U.S.', 'U.K.', 'E.U.', 'PCT.',
        'Dr.', 'Mr.', 'Ms.', 'Mrs.', 'Prof.',
        'Inc.', 'Corp.', 'Ltd.', 'Co.',
        'al.', 'et al.'
      ]
      let temp = t
      const placeholders: string[] = []
      for (const abbr of abbrevs) {
        const placeholder = `__ABBR${placeholders.length}__`
        if (temp.includes(abbr)) {
          temp = temp.split(abbr).join(placeholder)
          placeholders.push(abbr)
        }
      }
      // Now split on sentence boundaries
      const parts = temp.split(/(?<=[\.!?])\s+/).filter(Boolean)
      // Restore abbreviations
      return parts.map(p => {
        let restored = p
        placeholders.forEach((abbr, idx) => {
          restored = restored.split(`__ABBR${idx}__`).join(abbr)
        })
        return restored
      })
    }

    const wordTrim = (t: string, m: number) => t.split(/\s+/).slice(0, m).join(' ')

    // Claims: preserve numbering; trim from last dependent claims backwards
    if (section === 'claims') {
      let blocks = String(text).split(/\n\s*(?=\d+\.)/).map(s => s.trim()).filter(Boolean)
      const blockWordCount = () => wc(blocks.join('\n'))
      let current = blockWordCount()
      // Iteratively shorten last block sentences, then drop last block if still long
      while (current > max && blocks.length > 0) {
        const lastIdx = blocks.length - 1
        const last = blocks[lastIdx]
        const m = last.match(/^(\d+\.\s*)([\s\S]*)$/)
        if (!m) { blocks.pop(); current = blockWordCount(); continue }
        const prefix = m[1]
        let body = m[2].trim()
        const sentences = smartSentenceSplit(body)
        if (sentences.length > 1) {
          // Remove trailing sentence and re-evaluate
          sentences.pop()
          body = sentences.join(' ')
          blocks[lastIdx] = `${prefix}${body}`.trim()
        } else {
          // If only one sentence remains, drop the entire last block
          blocks.pop()
        }
        current = blockWordCount()
      }
      const out = blocks.join('\n')
      const after = wc(out)
      return { text: out, clipped: after < before, before, after }
    }

    // Brief Description: keep per-line cap (handled elsewhere) and enforce total cap
    if (section === 'briefDescriptionOfDrawings') {
      const lines = String(text).split(/\n+/).map(l => l.trim()).filter(Boolean)
      const outLines: string[] = []
      let total = 0
      for (const l of lines) {
        const words = l.split(/\s+/)
        if (total + words.length <= max) {
          outLines.push(l)
          total += words.length
        } else {
          const remaining = Math.max(0, max - total)
          if (remaining > 0) {
            outLines.push(words.slice(0, remaining).join(' '))
            total = max
          }
          break
        }
      }
      const out = outLines.join('\n')
      const after = wc(out)
      return { text: out, clipped: after < before, before, after }
    }

    // Abstract: Special handling to preserve complete sentences
    // Indian Patent Act Section 10(4)(d) specifies max 150 words, but we allow
    // a small grace buffer to complete sentences rather than cutting mid-thought
    if (section === 'abstract') {
      const sentences = smartSentenceSplit(String(text))
      const graceBuffer = 15 // Allow up to 15 extra words to complete a sentence
      const hardMax = max + graceBuffer
      
      // First try: fit within exact limit using complete sentences
      let accumulated: string[] = []
      let accumulatedWords = 0
      for (const sentence of sentences) {
        const sentenceWords = wc(sentence)
        if (accumulatedWords + sentenceWords <= max) {
          accumulated.push(sentence)
          accumulatedWords += sentenceWords
        } else if (accumulated.length === 0 && accumulatedWords + sentenceWords <= hardMax) {
          // First sentence exceeds limit but within grace buffer - include it
          accumulated.push(sentence)
          accumulatedWords += sentenceWords
          break
        } else {
          // Adding this sentence would exceed limit - stop here
          break
        }
      }
      
      // If we have accumulated sentences, use them
      if (accumulated.length > 0) {
        const out = accumulated.join(' ')
        const after = wc(out)
        return { text: out, clipped: after < before, before, after }
      }
      
      // Fallback: if even first sentence is too long, try to find a natural break point
      // Look for semicolons, colons, or em-dashes as secondary break points
      const firstSentence = sentences[0] || text
      const subParts = firstSentence.split(/(?<=[;:\u2014])\s+/).filter(Boolean)
      if (subParts.length > 1) {
        let subAccum: string[] = []
        let subWords = 0
        for (const part of subParts) {
          const partWords = wc(part)
          if (subWords + partWords <= max) {
            subAccum.push(part)
            subWords += partWords
          } else {
            break
          }
        }
        if (subAccum.length > 0) {
          const out = subAccum.join(' ')
          const after = wc(out)
          return { text: out, clipped: after < before, before, after }
        }
      }
      
      // Last resort: hard word trim but try to end at a word boundary gracefully
      const words = String(text).split(/\s+/)
      const trimmed = words.slice(0, max)
      // Try to end at a reasonable point (not mid-hyphenated-word)
      let endIdx = trimmed.length - 1
      while (endIdx > max - 10 && trimmed[endIdx]?.endsWith('-')) {
        endIdx--
      }
      const out = trimmed.slice(0, endIdx + 1).join(' ')
      const after = wc(out)
      return { text: out, clipped: after < before, before, after }
    }

    // Default: drop trailing sentences until within cap; fallback to word trim
    let sentences = smartSentenceSplit(String(text))
    while (wc(sentences.join(' ')) > max && sentences.length > 1) {
      sentences.pop()
    }
    let out = sentences.join(' ')
    if (wc(out) > max) out = wordTrim(out, max)
    const after = wc(out)
    return { text: out, clipped: after < before, before, after }
  }

  private static wrapMultiSectionPrompt(prompts: Record<string, string>): string {
    const entries = Object.entries(prompts).map(([k,v]) => `SECTION ${k.toUpperCase()}:\n${v}`).join('\n\n')
    return `You are a senior Indian Patent Attorney (IN, Form-2). Return a single JSON object with only the requested keys. No markdown, no commentary.\n\n${entries}`
  }

  private static guardrailCheck(
    section: string,
    text: string,
    referenceMap: any,
    approvedTitle?: string,
    ctx?: { sectionChecks?: any[]; claimsRules?: any }
  ): { ok: boolean; reason?: string } {
    const fallbackMax: Record<string, number> = {
      title: 15,
      abstract: 150,
      preamble: 40,
      fieldOfInvention: 80,
      background: 400,
      objectsOfInvention: 120,
      crossReference: 120,
      summary: 300,
      technicalProblem: 120,
      technicalSolution: 150,
      advantageousEffects: 150,
      // IMPORTANT: briefDescriptionOfDrawings needs ~25 words per figure (support up to 20 figures)
      briefDescriptionOfDrawings: 500,
      detailedDescription: 1200,
      modeOfCarryingOut: 500,
      bestMethod: 350,
      claims: 900,
      industrialApplicability: 100,
      listOfNumerals: 1000
    }
    const extractLimits = (checks?: any[]) => {
      const limits: { maxWords?: number; maxChars?: number; maxCount?: number } = {}
      if (Array.isArray(checks)) {
        for (const c of checks) {
          if (c?.type === 'maxWords' && typeof c.limit === 'number') limits.maxWords = c.limit
          if (c?.type === 'maxChars' && typeof c.limit === 'number') limits.maxChars = c.limit
          if (c?.type === 'maxCount' && typeof c.limit === 'number') limits.maxCount = c.limit
        }
      }
      return limits
    }
    const limits = extractLimits(ctx?.sectionChecks)
    if (section === 'title') {
      const maxWords = typeof limits.maxWords === 'number' ? limits.maxWords : fallbackMax.title
      const maxChars = typeof limits.maxChars === 'number' ? limits.maxChars : undefined
      if (maxWords && text.trim().split(/\s+/).length > maxWords) {
        return { ok: false, reason: `Title exceeds ${maxWords} words` }
      }
      if (maxChars && text.length > maxChars) {
        return { ok: false, reason: `Title exceeds ${maxChars} characters` }
      }
    }
    if (section === 'abstract') {
      const maxWords = typeof limits.maxWords === 'number' ? limits.maxWords : fallbackMax.abstract
      const maxChars = typeof limits.maxChars === 'number' ? limits.maxChars : undefined
      const wordCount = text.split(/\s+/).length
      // Allow a grace buffer of 15 words for complete sentences - enforceMaxWords will handle the final trim
      // This prevents aggressive pre-trimming that cuts content mid-sentence
      const graceBuffer = 15
      const hardMaxWords = maxWords + graceBuffer
      if (maxWords && wordCount > hardMaxWords) {
        return { ok: false, reason: `Abstract significantly exceeds ${maxWords} words (found ${wordCount})` }
      }
      if (maxChars && text.length > maxChars + 100) { // 100 char grace for sentence completion
        return { ok: false, reason: `Abstract significantly exceeds ${maxChars} characters` }
      }
      // Note: numerals/figure refs check relaxed for partial generation - will be enforced in full draft
      if (/(novel|inventive|best|unique|claim|claims)/i.test(text)) return { ok: false, reason: 'Improper tone in abstract' }
    }
    // claims-specific normalization should not be performed here; handled in minimalFix
    if (section === 'briefDescriptionOfDrawings') {
      // Figure reference validation removed - now handled through separate LLM review
      const lines = text.split(/\n+/)
      if (lines.some(l=>l.split(/\s+/).filter(Boolean).length>40)) return { ok: false, reason: 'BDOD line exceeds 40 words' }
      if (/(advantage|benefit|claim)/i.test(text)) return { ok: false, reason: 'BDOD contains claims/advantages language' }
    }
    if (section === 'claims') {
      if (/(and\/or|etc\.|approximately|substantially)/i.test(text)) return { ok: false, reason: 'Claims hygiene violation' }
      // Disallow parentheses around claim numbers (e.g., claim (1))
      if (/\bclaim\s*\(\d+\)/i.test(text)) return { ok: false, reason: 'Parentheses around claim numbers are not allowed' }

      // Sequential numbering and immediate dependency enforcement
      const blocks = text.split(/\n\s*(?=\d+\.)/).map(s=>s.trim()).filter(Boolean)
      let expected = 1
      const allowMultipleDependent = ctx?.claimsRules?.allowMultipleDependent !== false
      for (let i=0; i<blocks.length; i++) {
        const b = blocks[i]
        const m = b.match(/^(\d+)\./)
        if (!m) return { ok: false, reason: 'Claims must be numbered as \'N. ...\'' }
        const num = parseInt(m[1],10)
        if (num !== expected) return { ok: false, reason: 'Claims numbering not sequential' }
        if (i >= 1) {
          const dep = b.match(/^\d+\.\s*The\s+(system|device|method)\s+of\s+claim\s+(\d+)(?:\s+and\s+claim\s+\d+)*/i)
          if (!dep) return { ok: false, reason: 'Dependent claim must start with "The system/device/method of claim X, ..."' }
          const refs = Array.from(dep[0].matchAll(/claim\s+(\d+)/gi)).map(r=>parseInt(r[1],10))
          if (!refs.length) return { ok: false, reason: 'Dependent claim must reference an earlier claim' }
          if (!allowMultipleDependent && refs.length > 1) return { ok: false, reason: 'Multiple dependency not allowed by jurisdiction' }
          if (refs.some(r => r >= num || r < 1)) return { ok: false, reason: 'Dependent claim must reference an earlier claim' }
          if (!allowMultipleDependent && refs[0] !== expected - 1) return { ok: false, reason: 'Dependent claim must depend on immediately preceding claim' }
        }
        expected++
      }
      if (typeof limits.maxCount === 'number' && blocks.length > limits.maxCount) {
        return { ok: false, reason: `Claims exceed ${limits.maxCount} count limit` }
      }
    }
    if (section === 'listOfNumerals') {
      // Only check numerals if components have been declared
      const declaredComponents = referenceMap?.components || []
      if (declaredComponents.length > 0) {
        const allowed = new Set(declaredComponents.map((c:any)=>c.numeral))
      const refs = Array.from(text.matchAll(/\((\d{2,3})\)/g)).map(m=>parseInt(m[1],10))
      if (refs.some(n=>!allowed.has(n))) return { ok: false, reason: 'List includes undeclared numeral' }
      }
    }
    if (section === 'detailedDescription') {
      // Enforce: no undeclared numerals
      // Figure reference validation removed - now handled through separate LLM review
      const declaredComponents = referenceMap?.components || []

      // Only check numerals if there are declared components
      if (declaredComponents.length > 0) {
        const allowedNums = new Set(declaredComponents.map((c:any)=>c.numeral))
      const usedNums = Array.from(text.matchAll(/\((\d{2,3})\)/g)).map(m=>parseInt(m[1],10))
      if (usedNums.some(n=>!allowedNums.has(n))) {
        return { ok: false, reason: 'Detailed Description uses undeclared numeral' }
      }
      }
    }
    if (section === 'industrialApplicability') {
      const maxWords = typeof limits.maxWords === 'number' ? limits.maxWords : fallbackMax.industrialApplicability
      const maxChars = typeof limits.maxChars === 'number' ? limits.maxChars : undefined
      if (maxWords && text.split(/\s+/).length > maxWords) {
        return { ok: false, reason: `Industrial applicability exceeds ${maxWords} words` }
      }
      if (maxChars && text.length > maxChars) {
        return { ok: false, reason: `Industrial applicability exceeds ${maxChars} characters` }
      }
    }
    return { ok: true }
  }

  private static minimalFix(
    section: string,
    text: string,
    ctx: { reason?: string; approvedTitle?: string; referenceMap?: any; figures?: any[]; sectionChecks?: any[]; claimsRules?: any }
  ): string | null {
    let out = String(text || '')
    const extractLimit = (checks: any[] | undefined, type: 'maxWords' | 'maxChars') => {
      if (!Array.isArray(checks)) return undefined
      const rule = checks.find(c => c?.type === type && typeof c.limit === 'number')
      return rule?.limit
    }
    if (section === 'abstract') {
      // Remove prohibited tone words and claims language
      out = out.replace(/\b(novel|inventive|best|unique|claim|claims)\b/gi, '')
      // Note: numerals/figure refs allowed for partial generation
      // Collapse extra spaces and clean up
      out = out.replace(/\s{2,}/g, ' ').trim()
      // Enforce starts with title if available
      if (ctx.approvedTitle && ctx.reason && ctx.reason.toLowerCase().includes('title') && !out.startsWith(ctx.approvedTitle)) {
        out = `${ctx.approvedTitle} ${out}`.trim()
      }
      // Enforce max words using sentence-aware trimming (not hard word cut)
      // The final trimming is handled by enforceMaxWords which has proper sentence preservation
      // Here we only do minimal fixes for tone issues, not aggressive length trimming
      const maxWords = extractLimit(ctx.sectionChecks, 'maxWords') || 150
      const words = out.split(/\s+/).filter(w=>w.length>0)
      // Only do hard trim if significantly over limit (> 20 words) - otherwise let enforceMaxWords handle it gracefully
      if (maxWords && words.length > maxWords + 20) {
        // Sentence-aware trimming: find sentence boundaries
        const sentences = out.split(/(?<=[\.!?])\s+/).filter(Boolean)
        let accumulated: string[] = []
        let accWords = 0
        for (const s of sentences) {
          const sWords = s.split(/\s+/).length
          if (accWords + sWords <= maxWords) {
            accumulated.push(s)
            accWords += sWords
          } else {
            break
          }
        }
        if (accumulated.length > 0) {
          out = accumulated.join(' ')
        } else {
          // Fallback: hard trim if no sentence fits
          out = words.slice(0, maxWords).join(' ')
        }
      }
      if (words.length < 5) out = ctx.approvedTitle || 'Patent invention description.' // Fallback if too short
      return out
    }
    if (section === 'industrialApplicability') {
      const maxWords = extractLimit(ctx.sectionChecks, 'maxWords')
      const words = out.split(/\s+/).filter(w=>w.length>0)
      if (maxWords && words.length > maxWords) out = words.slice(0, maxWords).join(' ')
      return out
    }
    if (section === 'briefDescriptionOfDrawings') {
      const figuresArray = ctx.figures || []
      const allowed = new Set(figuresArray.map((f:any)=>String(f.figureNo)))
      const lines = out.split(/\n+/).map(l=>l.trim()).filter(Boolean)
      
      // If we have a known figures list, filter to only those figures
      // If no figures list available (empty), pass through all valid figure descriptions
      const cleaned = lines
        .filter(l=>{
          const m = l.match(/Fig\.?\s*(\d+)/i)
          if (!m) return false
          // If we have no figures in allowed set, accept all figure references
          // This prevents filtering out valid content when figures aren't loaded
          if (allowed.size === 0) return true
          return allowed.has(String(m[1]))
        })
        .map(l=>l.replace(/\b(advantage|advantages|benefit|benefits|claim|claims)\b/gi,'').trim())
      
      // If we have valid lines, return them (one figure per line with blank line between)
      if (cleaned.length > 0) {
        return cleaned.join('\n\n')
      }
      // If original text has figure references but none matched, return original rather than error
      if (lines.length > 0 && lines.some(l => /Fig\.?\s*\d+/i.test(l))) {
        return out
      }
      // Only show error message if there truly is no figure content
      // Generate figure descriptions from figures array (one per line with blank line between)
      return figuresArray.length > 0 
        ? figuresArray.map((f: any) => `FIG. ${f.figureNo} is ${f.title || 'a view of the invention'}.`).join('\n\n')
        : out || 'Brief description of drawings will be added when figures are available.'
    }
    if (section === 'claims') {
      // Normalize parentheses around claim numbers in text body
      let fixed = out.replace(/\bclaim\s*\((\d+)\)/gi, 'claim $1')

      // Split into numbered claim blocks. If numbering missing, attempt to infer by splitting on newlines.
      let blocks = fixed.split(/\n\s*(?=\d+\.)/).map(s=>s.trim()).filter(Boolean)
      if (blocks.length === 0) {
        const rough = fixed.split(/\n+/).map(s=>s.trim()).filter(Boolean)
        blocks = rough.map((s, i) => `${i+1}. ${s.replace(/^\d+\.\s*/, '')}`)
      }

      const subjectHint = /\b(system|device|method)\b/i.test(blocks[0]) ? (blocks[0].match(/\b(system|device|method)\b/i)![1].toLowerCase()) : 'system'

      const normalized: string[] = []
      for (let i = 0; i < blocks.length; i++) {
        const expected = i + 1
        let body = blocks[i].replace(/^\d+\.\s*/, '').trim()

        if (i === 0) {
          // Ensure independent claim numbered correctly
          normalized.push(`${expected}. ${body}`)
          continue
        }

        // For dependent claims, enforce immediate dependency preamble
        // Clean up any duplicate "The X of claim Y" phrases first
        body = body.replace(/(The\s+(?:system|device|method)\s+of\s+claim\s+\d+,\s*)+/gi, '')

        // Then add the correct preamble
        body = `The ${subjectHint} of claim ${expected-1}, ${body.replace(/^The\s+/, '').replace(/^,\s*/, '')}`

        normalized.push(`${expected}. ${body}`)
      }

      return normalized.join('\n')
    }
    return null
  }

  // Public wrapper for consistency validation
  static validateDraftConsistencyPublic(draft: any, session: any) {
    return this.validateDraftConsistency(draft, session)
  }

  private static getFallbackContent(section: string, payload: any): string {
    const { idea, referenceMap } = payload
    switch (section) {
      case 'title':
        return idea?.title || 'Patent Invention'
      case 'abstract':
        return (idea?.title || 'Patent Invention') + ' provides a technical solution.'
      case 'summary':
        return 'This invention provides an improved technical solution.'
      case 'briefDescriptionOfDrawings':
        return 'Fig. 1 shows the system architecture.'
      case 'fieldOfInvention':
        return 'The invention relates to the field of technology.'
      case 'background':
        return 'Conventional approaches have limitations.'
      case 'objectsOfInvention':
      case 'objects':
        return 'The principal object of the present invention is to provide an improved solution that overcomes limitations of conventional approaches. Another object is to enhance efficiency and reliability in the relevant technical field.'
      case 'technicalProblem':
        return 'The invention addresses a technical problem in the art.'
      case 'technicalSolution':
        return 'The invention provides a technical solution comprising the disclosed architecture.'
      case 'advantageousEffects':
        return 'The solution yields technical effects that improve performance or reliability.'
      case 'crossReference':
        return 'This application is related to prior filings and references identified by the applicant.'
      case 'detailedDescription':
        return 'The invention comprises several components working together.'
      case 'modeOfCarryingOut':
        return 'A mode for carrying out the invention is described with sufficient detail for a skilled person.'
      case 'bestMethod':
        return 'The best method involves the following steps.'
      case 'claims':
        return '1. A system comprising: components as described.'
      case 'listOfNumerals':
        const nums = (referenceMap?.components || []).map((c: any) => `( ${c.numeral} ) G ${c.name}`).join('\n')
        return nums || '(100) G Main component'
      default:
        return 'Content not available.'
    }
  }

  /**
   * Validate and process component map with numeral assignment
   */
  static validateComponentMap(components: any[]): ComponentValidationResult {
    const errors: string[] = [];
    const processedComponents: any[] = [];

    if (!Array.isArray(components) || components.length === 0) {
      return { valid: false, errors: ['Components array is required and cannot be empty'] };
    }

    if (components.length > 100) {
      return { valid: false, errors: ['Maximum 100 components allowed'] };
    }

    // Build tree by parentId (optional)
    type Comp = { id?: string; name: string; description?: string; parentId?: string };
    const nodes: Record<string, any> = {};
    const roots: any[] = [];

    for (const comp of components as Comp[]) {
      if (!comp.id || typeof comp.id !== 'string') {
        errors.push('Component ID is required and must be a string');
        continue;
      }
      if (nodes[comp.id]) {
        errors.push(`Duplicate component ID detected: ${comp.id}`);
        continue;
      }
      if (!comp.name || typeof comp.name !== 'string') {
        errors.push(`Component ${comp.id} name is required and must be a string`);
        continue;
      }
      if (!comp.name.trim()) {
        errors.push(`Component ${comp.id} name cannot be empty`);
        continue;
      }
      const id = comp.id;
      const componentType = (comp as any).type;
      const validTypes = ['MAIN_CONTROLLER', 'SUBSYSTEM', 'MODULE', 'INTERFACE', 'SENSOR', 'ACTUATOR', 'PROCESSOR', 'MEMORY', 'DISPLAY', 'COMMUNICATION', 'POWER_SUPPLY', 'OTHER'];

      if (componentType && !validTypes.includes(componentType)) {
        errors.push(`Component ${id} has invalid type '${componentType}' - must be one of: ${validTypes.join(', ')}`);
        continue;
      }

      nodes[id] = {
        id,
        name: comp.name.trim(),
        description: comp.description || '',
        parentId: (comp as any).parentId || null,
        numeral: typeof (comp as any).numeral === 'number' ? (comp as any).numeral : undefined,
        type: componentType || 'OTHER',
        children: []
      };
    }

    // Link children
    Object.values(nodes).forEach((n: any) => {
      if (n.parentId) {
        if (n.parentId === n.id) {
          errors.push(`Component ${n.id} cannot be its own parent`);
        } else if (nodes[n.parentId]) {
          nodes[n.parentId].children.push(n);
        } else {
          errors.push(`Component ${n.id} has invalid parentId ${n.parentId} - parent does not exist`);
        }
      } else {
        roots.push(n);
      }
    });

    // Check for circular references
    const detectCycle = (nodeId: string, visited: Set<string> = new Set()): boolean => {
      if (visited.has(nodeId)) return true; // Cycle detected
      visited.add(nodeId);
      const node = nodes[nodeId];
      if (node && node.children) {
        for (const child of node.children) {
          if (detectCycle(child.id, new Set(visited))) return true;
        }
      }
      return false;
    };

    for (const root of roots) {
      if (detectCycle(root.id)) {
        errors.push(`Circular reference detected in component hierarchy`);
        break;
      }
    }

    // Assign numerals in 100-blocks per root to avoid overlap; respect user-supplied numerals when unique/valid
    const usedNumerals = new Set<number>();
    let rootIndex = 1; // 100, 200, ... 900

    const assignBlock = (node: any, base: number) => {
      let cursor = base;

      const dfs = (n: any) => {
        if (cursor > base + 99) {
          errors.push(`Too many subcomponents under root block ${base}`);
          return;
        }
        // Respect user-supplied numeral if valid and unique
        if (typeof n.numeral === 'number') {
          if (n.numeral < 1 || n.numeral > 999) {
            errors.push(`Component ${n.id} has invalid numeral ${n.numeral} - must be between 1 and 999`);
          } else if (usedNumerals.has(n.numeral)) {
            errors.push(`Duplicate numeral ${n.numeral} detected for component ${n.id}`);
          } else {
            usedNumerals.add(n.numeral);
            cursor = Math.max(cursor, n.numeral + 1);
          }
        } else {
          // Assign numeral automatically
          while (usedNumerals.has(cursor) && cursor <= base + 99) cursor++;
          if (cursor > base + 99) {
            errors.push(`Cannot assign numeral to component ${n.id} - block ${base} is full`);
            return;
          }
          n.numeral = cursor;
          usedNumerals.add(cursor);
          cursor++;
        }
        // Children
        if (Array.isArray(n.children) && n.children.length > 0) {
          // Stable order
          n.children.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
          n.children.forEach((c: any) => dfs(c));
        }
      };

      dfs(node);
    };

    // Sort roots by name for stability, assign blocks 100..900
    roots.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    for (const root of roots) {
      let base = rootIndex * 100;
      if (base > 900) {
        // Fallback: find next free block within 100..999
        base = 100;
        while (base <= 900 && Array.from({ length: 100 }).some((_, i) => usedNumerals.has(base + i))) {
          base += 100;
        }
        if (base > 900) {
          errors.push('No available 100-blocks remain for numbering');
          break;
        }
      }
      assignBlock(root, base);
      rootIndex++;
    }

    // Flatten back into processed list
    const collect = (n: any) => {
      processedComponents.push({
        id: n.id,
        name: n.name,
        type: n.type || 'OTHER',
        description: n.description,
        numeral: n.numeral,
        range: `${Math.floor(n.numeral / 100) * 100}s`,
        parentId: n.parentId || undefined
      });
      n.children?.forEach((c: any) => collect(c));
    };
    roots.forEach((r) => collect(r));

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, components: processedComponents };
  }

  /**
   * Generate PlantUML code from figure plan and reference map
   */
  static async generatePlantUML(
    figurePlan: any,
    referenceMap: any,
    archetype?: string | string[]
  ): Promise<PlantUMLGenerationResult> {
    try {
      const archetypeList = this.normalizeArchetypeList(
        archetype ?? referenceMap?.inventionType ?? referenceMap?.normalizedData?.inventionType,
        referenceMap?.fieldOfRelevance
      )
      const archetypeLabel = archetypeList.join('+')

      // Build component lookup by numeral
      const componentLookup: Record<number, any> = {};
      if (referenceMap?.components) {
        for (const component of referenceMap.components) {
          componentLookup[component.numeral] = component;
        }
      }

      // Generate PlantUML code
      let plantumlCode = '@startuml\n';

      // Add title
      plantumlCode += `title ${figurePlan.title}\n\n`;
      if (archetypeLabel) {
        plantumlCode += `caption Archetype: ${archetypeLabel}\n\n`
      }

      // Add components as rectangles or other shapes
      if (figurePlan.nodes && Array.isArray(figurePlan.nodes)) {
        for (const nodeRef of figurePlan.nodes) {
          const component = componentLookup[nodeRef];
          if (component) {
            const shape = this.getShapeForComponent(component.type);
            plantumlCode += `${shape} "${component.name} (${component.numeral})" as C${component.numeral}\n`;
          }
        }
      }

      plantumlCode += '\n';

      // Add connections
      if (figurePlan.edges && Array.isArray(figurePlan.edges)) {
        for (const edge of figurePlan.edges) {
          const fromComponent = componentLookup[edge.from];
          const toComponent = componentLookup[edge.to];

          if (fromComponent && toComponent) {
            const label = edge.label ? ` : ${edge.label}` : '';
            plantumlCode += `C${fromComponent.numeral} --> C${toComponent.numeral}${label}\n`;
          }
        }
      }

      plantumlCode += '\n@enduml';

      // Generate checksum
      const checksum = crypto.createHash('sha256').update(plantumlCode).digest('hex');

      return {
        success: true,
        plantumlCode,
        checksum
      };

    } catch (error) {
      console.error('PlantUML generation error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Diagram generation failed'
      };
    }
  }

  /**
   * Get appropriate PlantUML shape for component type
   */
  private static getShapeForComponent(type: string): string {
    const shapeMap: Record<string, string> = {
      MAIN_CONTROLLER: 'rectangle',
      SUBSYSTEM: 'rectangle',
      MODULE: 'component',
      INTERFACE: 'interface',
      SENSOR: 'circle',
      ACTUATOR: 'hexagon',
      PROCESSOR: 'node',
      MEMORY: 'database',
      DISPLAY: 'actor',
      COMMUNICATION: 'queue',
      POWER_SUPPLY: 'storage',
      OTHER: 'rectangle'
    };

    return shapeMap[type] || 'rectangle';
  }

  /**
   * Generate complete annexure draft using LLM
   */
  static async generateAnnexureDraft(
    session: any,
    jurisdiction: string = 'IN',
    filingType: string = 'utility',
    tenantId?: string,
    requestHeaders?: Record<string, string>,
    referenceDraft?: any,
    preferredLanguage?: string,
    sourceJurisdiction?: string
  ): Promise<AnnexureDraftResult> {
    try {
      const sectionDefs = await this.buildSectionDefinitions(jurisdiction)

      // Build comprehensive prompt
      const prompt = await this.buildAnnexurePrompt(session, jurisdiction, filingType, sectionDefs, referenceDraft, preferredLanguage, sourceJurisdiction);

      // Execute through LLM gateway with admin-configured model via stage
      const request = { headers: requestHeaders || {} };
      const result = await llmGateway.executeLLMOperation(request, {
        taskCode: 'LLM2_DRAFT',
        stageCode: 'DRAFT_ANNEXURE_DESCRIPTION', // Use stage config for comprehensive annexure draft
        prompt,
        parameters: { tenantId, jurisdiction, filingType },
        idempotencyKey: crypto.randomUUID(),
        metadata: {
          patentId: session.patentId,
          sessionId: session.id,
          jurisdiction,
          filingType,
          purpose: 'annexure_draft'
        }
      });

      if (!result.success || !result.response) {
        return {
          success: false,
          error: result.error?.message || 'Draft generation failed'
        };
      }

      // Parse and structure the draft
      const draftResult = this.parseDraftResponse(result.response.output, sectionDefs);

      if (!draftResult.success) {
        return {
          success: false,
          error: draftResult.error
        };
      }

      // Validate draft consistency
      // Apply basic section-level validation from profile if available
      await this.applySectionChecks(draftResult.draft, jurisdiction);

      const validation = this.validateDraftConsistency(draftResult.draft, session);

      return {
        success: true,
        draft: draftResult.draft,
        isValid: validation.valid,
        validationReport: validation.report,
        llmPrompt: prompt,
        llmResponse: result.response,
        tokensUsed: result.response.outputTokens
      };

    } catch (error) {
      console.error('Annexure draft generation error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Draft generation failed'
      };
    }
  }

  /**
   * Build section definitions from country profile (or fallback)
   */
  /**
   * Map superset code to section key
   */
  private static supersetCodeToSectionKey(supersetCode: string): string {
    const mapping: Record<string, string> = {
      '01. Title': 'title',
      '02. Preamble': 'preamble',
      '03. Cross-Ref/Fed': 'cross_reference',
      '04. Tech Field': 'field',
      '05. Background': 'background',
      '06. Objects': 'objects',
      '07. Summary (Gen)': 'summary',
      '07a. Tech Problem': 'technical_problem',
      '07b. Tech Solution': 'technical_solution',
      '07c. Effects': 'advantageous_effects',
      '08. Drawings': 'brief_drawings',
      '09. Detailed Desc': 'detailed_description',
      '10. Best Mode': 'best_mode',
      '11. Ind. Applicability': 'industrial_applicability',
      '12. Claims': 'claims',
      '13. Abstract': 'abstract'
    }
    return mapping[supersetCode] || supersetCode.toLowerCase().replace(/[^a-z]/g, '_')
  }

  /**
   * Get default label for section key
   */
  private static getDefaultLabel(sectionKey: string): string {
    const labels: Record<string, string> = {
      'title': 'Title',
      'preamble': 'Preamble',
      'cross_reference': 'Cross-Reference',
      'field': 'Technical Field',
      'background': 'Background',
      'objects': 'Objects',
      'summary': 'Summary of the Invention',
      'technical_problem': 'Technical Problem',
      'technical_solution': 'Technical Solution',
      'advantageous_effects': 'Advantageous Effects',
      'brief_drawings': 'Brief Description of Drawings',
      'detailed_description': 'Detailed Description',
      'best_mode': 'Best Mode',
      'industrial_applicability': 'Industrial Applicability',
      'claims': 'Claims',
      'abstract': 'Abstract'
    }
    return labels[sectionKey] || sectionKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  }

  /**
   * Determine if section is required for jurisdiction
   */
  private static isSectionRequired(sectionKey: string, jurisdiction: string): boolean {
    // Core sections that are typically required
    const alwaysRequired = ['title', 'claims', 'abstract']

    if (alwaysRequired.includes(sectionKey)) return true

    // Country-specific requirements
    const countryRequirements: Record<string, string[]> = {
      'US': ['detailed_description', 'background', 'summary'],
      'IN': ['field', 'background', 'objects', 'summary', 'detailed_description'],
      'EP': ['detailed_description', 'background', 'claims'],
      'CN': ['detailed_description', 'claims'],
      'JP': ['detailed_description', 'claims']
    }

    return countryRequirements[jurisdiction]?.includes(sectionKey) || false
  }

  private static async buildSectionDefinitions(jurisdiction: string): Promise<Array<{ key: string; label: string; required: boolean; constraints?: string[]; altKeys: string[] }>> {
    const profile = await getCountryProfile(jurisdiction)
    const defs: Array<{ key: string; label: string; required: boolean; constraints?: string[]; altKeys: string[] }> = []

    // Get all ENABLED sections mapped for this country from database
    // Critical: Filter by isEnabled to exclude disabled sections from drafting flow
    // IMPORTANT: Order by displayOrder - this is the ONLY source of truth for section sequence
    const countryMappings = await prisma.countrySectionMapping.findMany({
      where: { 
        countryCode: jurisdiction,
        isEnabled: true // Only include enabled sections
      },
      orderBy: { displayOrder: 'asc' }
    })

    // Get all base constraints from SupersetSection table (for constraint lookup)
    const supersetSections = await prisma.supersetSection.findMany({
      where: { isActive: true },
      select: { sectionKey: true, constraints: true }
    })
    const constraintsMap = new Map<string, string[]>()
    for (const ss of supersetSections) {
      if (ss.sectionKey && Array.isArray(ss.constraints)) {
        constraintsMap.set(ss.sectionKey.toLowerCase(), ss.constraints as string[])
      }
    }

    // Use database mappings to determine available sections
    for (const mapping of countryMappings) {
      let sectionKey = (mapping as any).sectionKey
      if (!sectionKey) {
        // Map superset code to section key if not provided
        sectionKey = this.supersetCodeToSectionKey(mapping.supersetCode)
      }

      if (!sectionKey) continue
      
      // Skip N/A, Implicit, and other non-applicable headings (use centralized check)
      const heading = mapping.heading || ''
      if (isNonApplicableHeading(heading)) continue

      // Build alternative keys for constraint lookup
      const internalKey = this.mapToInternalKey(sectionKey) || sectionKey
      const promptKeyFromSupersetCode = typeof (mapping as any).supersetCode === 'string'
        ? this.supersetCodeToSectionKey((mapping as any).supersetCode)
        : ''

      const aliasCandidates = this.sectionKeyMap[internalKey] || []

      const altKeys = Array.from(new Set(
        [promptKeyFromSupersetCode, ...aliasCandidates]
          .map((k) => String(k || '').trim())
          .filter(Boolean)
          .flatMap((k) => [k, k.replace(/\s+/g, '_')])
          .map((k) => k.toLowerCase())
      ))

      // Get constraints from database (SupersetSection table)
      const constraintsCandidates = [sectionKey, internalKey, promptKeyFromSupersetCode, ...aliasCandidates]
        .map(k => String(k || '').toLowerCase().trim())
        .filter(Boolean)
      const matchedConstraintsKey = constraintsCandidates.find(k => constraintsMap.has(k))
      const constraints = matchedConstraintsKey ? constraintsMap.get(matchedConstraintsKey) || [] : []

      defs.push({
        key: sectionKey,
        label: heading || this.getDefaultLabel(sectionKey),
        required: (mapping as any).isRequired ?? true,
        constraints,
        altKeys
      })
    }

    // DATABASE IS THE ONLY SOURCE OF TRUTH - No fallbacks
    // If no mappings exist, the jurisdiction is not configured - fail explicitly
    if (defs.length === 0) {
      console.error(`[buildSectionDefinitions] CRITICAL: No CountrySectionMapping entries found for jurisdiction "${jurisdiction}". Database must be configured first.`)
      throw new Error(`Jurisdiction "${jurisdiction}" is not configured in the database. Please add section mappings in CountrySectionMapping table.`)
    }
    
    return defs
  }

  private static async applySectionChecks(draft: any, jurisdiction: string) {
    const profile = await getCountryProfile(jurisdiction)
    const checks = profile?.profileData?.validation?.sectionChecks || {}
    if (!checks) return
    const enforce = (key: string, rules: any[]) => {
      const val = draft[key]
      if (!val || typeof val !== 'string') return
      for (const rule of rules) {
        if (rule.type === 'maxWords' && typeof rule.limit === 'number') {
          const words = val.trim().split(/\s+/)
          if (words.length > rule.limit) {
            draft[key] = words.slice(0, rule.limit).join(' ')
          }
        }
        if (rule.type === 'maxChars' && typeof rule.limit === 'number') {
          if (val.length > rule.limit) draft[key] = val.slice(0, rule.limit)
        }
        if (rule.type === 'maxCount' && typeof rule.limit === 'number' && key === 'claims') {
          const blocks = val.split(/\n\s*(?=\d+\.)/).map(s => s.trim()).filter(Boolean)
          if (blocks.length > rule.limit) {
            draft[key] = blocks.slice(0, rule.limit).join('\n')
          }
        }
      }
    }
    for (const [sectionId, ruleList] of Object.entries(checks) as Array<[string, any[]]>) {
      const mapped = this.mapToInternalKey(sectionId) || sectionId
      if (Array.isArray(ruleList)) enforce(mapped, ruleList)
    }
  }

  /**
   * Build comprehensive annexure generation prompt using jurisdiction-aware sections
   */
  private static async buildAnnexurePrompt(
    session: any,
    jurisdiction: string,
    filingType: string,
    sections: Array<{ key: string; label: string; required: boolean; constraints?: string[] }>,
    referenceDraft?: any,
    preferredLanguage?: string,
    sourceJurisdiction?: string
  ): Promise<string> {
    const idea = session.ideaRecord;
    const components: any[] = session.referenceMap?.components || [];
    
    // Build figures list - use finalized sequence if available
    let figures: Array<{ figureNo: number; title: string; description?: string }> = []
    
    if (session.figureSequenceFinalized && Array.isArray(session.figureSequence) && session.figureSequence.length > 0) {
      // Use the finalized figure sequence (includes both diagrams and sketches)
      const figureSequence = session.figureSequence as Array<{ id: string; type: string; sourceId: string; finalFigNo: number }>
      const sequencedSourceIds = new Set(figureSequence.map(s => s.sourceId))
      
      for (const seqItem of figureSequence) {
        if (seqItem.type === 'diagram') {
          const plan = (session.figurePlans || []).find((f: any) => f.id === seqItem.sourceId)
          if (plan) {
            figures.push({
              figureNo: seqItem.finalFigNo,
              title: this.sanitizeFigureTitle(plan.title) || `Figure ${seqItem.finalFigNo}`,
              description: plan.description || ''
            })
          } else {
            console.warn(`[DraftingService] Annexure: Diagram in sequence not found: sourceId=${seqItem.sourceId}`)
          }
        } else if (seqItem.type === 'sketch') {
          const sketch = (session.sketchRecords || []).find((s: any) => s.id === seqItem.sourceId)
          if (sketch && sketch.status === 'SUCCESS') {
            figures.push({
              figureNo: seqItem.finalFigNo,
              title: this.sanitizeFigureTitle(sketch.title) || `Figure ${seqItem.finalFigNo}`,
              description: sketch.description || ''
            })
          } else {
            console.warn(`[DraftingService] Annexure: Sketch in sequence not found: sourceId=${seqItem.sourceId}`)
          }
        }
      }
      
      // Auto-append figures added after sequence was finalized
      for (const plan of (session.figurePlans || [])) {
        if (!sequencedSourceIds.has(plan.id)) {
          figures.push({
            figureNo: figures.length + 1,
            title: this.sanitizeFigureTitle(plan.title) || `Figure ${figures.length + 1}`,
            description: plan.description || ''
          })
        }
      }
      for (const sketch of (session.sketchRecords || []).filter((s: any) => s.status === 'SUCCESS')) {
        if (!sequencedSourceIds.has(sketch.id)) {
          figures.push({
            figureNo: figures.length + 1,
            title: this.sanitizeFigureTitle(sketch.title) || `Figure ${figures.length + 1}`,
            description: sketch.description || ''
          })
        }
      }
    } else {
      // Fallback: Merge figures from plans AND diagram sources AND sketches (legacy behavior)
      const planFigures: any[] = (session.figurePlans || []).map((f: any) => ({
        figureNo: f.figureNo,
        title: this.sanitizeFigureTitle(f.title) || `Figure ${f.figureNo}`,
        description: f.description || ''
      }));
      // Include ALL diagram sources, not just uploaded ones
      const diagramFigures: any[] = (session.diagramSources || []).map((d: any) => {
        const found = planFigures.find((f: any) => f.figureNo === d.figureNo)
        const sanitized = this.sanitizeFigureTitle(found?.title || d.title)
        return { figureNo: d.figureNo, title: sanitized || `Figure ${d.figureNo}`, description: found?.description || '' }
      })
      const mergedByNo = new Map<number, any>()
      for (const f of planFigures) mergedByNo.set(f.figureNo, { figureNo: f.figureNo, title: f.title, description: f.description })
      for (const f of diagramFigures) mergedByNo.set(f.figureNo, { figureNo: f.figureNo, title: f.title, description: f.description })
      
      // Include ALL sketches with SUCCESS status (appending after diagrams)
      const allDiagramNos = Array.from(mergedByNo.keys())
      const maxDiagramNo = allDiagramNos.length > 0 ? Math.max(...allDiagramNos) : 0
      const successSketches = (session.sketchRecords || []).filter((s: any) => s.status === 'SUCCESS')
      for (let i = 0; i < successSketches.length; i++) {
        const sketch = successSketches[i]
        const figNo = maxDiagramNo + i + 1
        mergedByNo.set(figNo, {
          figureNo: figNo,
          title: this.sanitizeFigureTitle(sketch.title) || `Figure ${figNo}`,
          description: sketch.description || ''
        })
      }
      
      figures = Array.from(mergedByNo.values()).sort((a,b)=>a.figureNo-b.figureNo)
    }

    let profile = await getCountryProfile(jurisdiction)
    if (profile && preferredLanguage) {
      const langs: string[] = Array.isArray(profile?.profileData?.meta?.languages)
        ? profile.profileData.meta.languages
        : []
      const normalizedPref = preferredLanguage.trim()
      const reordered = [normalizedPref, ...langs.filter((l: string) => l !== normalizedPref)]
      profile = {
        ...profile,
        profileData: {
          ...(profile?.profileData || {}),
          meta: {
            ...(profile?.profileData?.meta || {}),
            languages: reordered.length ? reordered : langs
          }
        }
      }
    }
    const primaryLanguage = (profile?.profileData?.meta?.languages?.[0]) || preferredLanguage || 'English'
    const baseStyle = profile ? await getBaseStyle(jurisdiction) : null
    const archetypeList = this.normalizeArchetypeList(
      (idea as any)?.normalizedData?.inventionType ?? (idea as any)?.inventionType,
      (idea as any)?.fieldOfRelevance || (idea as any)?.normalizedData?.fieldOfRelevance || ''
    )
    const archetype = archetypeList.join('+')
    const archetypeGuidance = this.getArchetypeInstructions(archetype)
    const priorArtSelections: Array<{ patentNumber: string; title?: string; snippet?: string; score?: number; tags?: string[]; userNotes?: string }> =
      (((session as any).relatedArtSelections || (session as any).priorArt || []) as any[]).filter(
        (sel: any) => Array.isArray(sel.tags) && sel.tags.includes('USER_SELECTED')
      )

    const styleLines = [
      `Language: ${primaryLanguage}`,
      `Tone: ${baseStyle?.tone || 'technical, neutral, precise'}`,
      `Voice: ${baseStyle?.voice || 'impersonal third person'}`,
      `Avoid: ${Array.isArray(baseStyle?.avoid) ? baseStyle?.avoid.join(', ') : (baseStyle?.avoid || 'marketing language, unsupported advantages')}`
    ].join('\n')

    const sectionLines = sections.map((s, idx) => {
      const constraintText = (s.constraints && s.constraints.length) ? `Constraints: ${s.constraints.join('; ')}` : ''
      return `${idx + 1}. ${s.label} (${s.key})${s.required ? ' [required]' : ''}${constraintText ? `\n   ${constraintText}` : ''}`
    }).join('\n')

    const requiredKeys = sections.map(s => `"${s.key}"`).join(', ')

    const referenceSource = (sourceJurisdiction || session?.jurisdictionDraftStatus?.__sourceOfTruth || session?.draftingJurisdictions?.[0] || jurisdiction || '').toString().toUpperCase()
    const referenceBlock = referenceDraft
      ? `\nREFERENCE DRAFT (source jurisdiction ${referenceSource}):\n${String(referenceDraft.fullDraftText || '').slice(0, 2000)}${String(referenceDraft.fullDraftText || '').length > 2000 ? '... [truncated]' : ''}\n\nUse this as the baseline; adapt ordering/headings/limits to ${jurisdiction} but do not invent new content beyond the reference.`
      : ''

    return `You are drafting a ${jurisdiction} patent specification.
Apply these style rules:
${styleLines}

ARCHETYPE PROTOCOL:
- Archetype: ${archetype}
${archetypeGuidance}

INVENTION CONTEXT:
${idea.title ? `Title: ${idea.title}` : ''}
${idea.problem ? `Problem: ${idea.problem}` : ''}
${idea.objectives ? `Objectives: ${idea.objectives}` : ''}
${components.length > 0 ? `Components: ${components.map(c => `${c.name} (${c.numeral})`).join(', ')}` : ''}
${idea.logic ? `Logic: ${idea.logic}` : ''}
${figures.length > 0 ? `Figures: ${figures.map(f => `Fig.${f.figureNo}: ${f.title}`).join(', ')}` : ''}
${priorArtSelections.length > 0 ? `Prior art for context (approved - ALL ${priorArtSelections.length} patents): ${priorArtSelections.map(p=>`${p.patentNumber}${p.title?`: ${p.title}`:''}`).join(' | ')}` : ''}

${referenceBlock}

REQUIRED SECTIONS AND ORDER (return all keys even if blank):
${sectionLines}

OUTPUT FORMAT:
- Return ONLY JSON object with keys: ${requiredKeys}
- Do not include markdown or explanations.
`
  }

  /**
   * Parse LLM response into structured draft sections (JSON-first, profile-aware)
   */
  private static parseDraftResponse(output: string, sectionDefs: Array<{ key: string; altKeys: string[] }>): { success: boolean; draft?: any; error?: string } {
    try {
      let parsed: any = null
      let text = (output || '').trim()
      // Extract fenced JSON if present
      const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi
      let merged: Record<string, any> = {}
      let fenceCount = 0
      let m: RegExpExecArray | null
      while ((m = fenceRegex.exec(text)) !== null) {
        let block = (m[1] || '').trim()
        if (!block) continue
        block = block.replace(/,(\s*[}\]])/g, '$1').replace(/([\x00-\x08\x0B\x0C\x0E-\x1F])/g, '')
        try {
          let obj: any
          try { obj = JSON.parse(block) } catch { obj = JSON.parse(block.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')) }
          if (obj && typeof obj === 'object') { merged = { ...merged, ...obj }; fenceCount++ }
        } catch {}
      }
      if (fenceCount > 0) {
        parsed = merged
      } else {
        let jsonText = text
        const start = jsonText.indexOf('{')
        if (start !== -1) jsonText = jsonText.slice(start)
        jsonText = jsonText.replace(/```/g, '').replace(/,(\s*[}\]])/g, '$1').replace(/([\x00-\x08\x0B\x0C\x0E-\x1F])/g, '')
        parsed = JSON.parse(jsonText)
      }

      const draft: Record<string, string> = {}
      for (const def of sectionDefs) {
        const keysToCheck = [def.key, ...def.altKeys]
        let val = ''
        for (const k of keysToCheck) {
          if (typeof parsed?.[k] === 'string' && parsed[k].trim()) { val = parsed[k].trim(); break }
        }
        draft[def.key] = val || ''
      }

      // Build full text
      const fullText = Object.entries(draft)
        .filter(([key, value]) => value && key !== 'title')
        .map(([key, value]) => `${key.toUpperCase().replace(/([A-Z])/g, ' $1').trim()}:\n\n${value}`)
        .join('\n\n');

      return { success: true, draft: { ...draft, fullText } }
    } catch (error) {
      return { success: false, error: 'Failed to parse draft response' }
    }
  }

  /**
   * Validate draft consistency with components and figures
   */
  private static validateDraftConsistency(draft: any, session: any): { valid: boolean; report: any } {
    const report = {
      numeralConsistency: true,
      figureReferences: true,
      missingNumerals: [],
      unusedNumerals: [],
      invalidReferences: []
    };

    try {
      // Extract all numerals from draft text
      const numeralRegex = /\((\d{2,3})\)/g;
      const usedNumerals = new Set<number>();
      let match;

      const fullText = draft.fullText || '';
      while ((match = numeralRegex.exec(fullText)) !== null) {
        usedNumerals.add(parseInt(match[1]));
      }

      // Check against reference map
      const referenceNumerals = new Set<number>();
      if (session.referenceMap?.components) {
        for (const component of session.referenceMap.components) {
          referenceNumerals.add(component.numeral);
        }
      }

      // Find missing and unused numerals
      referenceNumerals.forEach((refNum: number) => {
        if (!usedNumerals.has(refNum)) {
          (report.missingNumerals as Array<number>).push(refNum);
        }
      });

      usedNumerals.forEach((usedNum: number) => {
        if (!referenceNumerals.has(usedNum)) {
          (report.unusedNumerals as Array<number>).push(usedNum);
        }
      });

      // Check figure references
      const figureRegex = /Fig\.?\s*(\d+)/gi;
      const referencedFigures = new Set<number>();
      while ((match = figureRegex.exec(fullText)) !== null) {
        referencedFigures.add(parseInt(match[1]));
      }

      const availableFigures = new Set<number>((session.figurePlans?.map((f: any) => f.figureNo) || []));
      referencedFigures.forEach((refFig: number) => {
        if (!availableFigures.has(refFig)) {
          (report.invalidReferences as Array<string | number>).push(`Figure ${refFig}`);
        }
      });

      report.numeralConsistency = report.missingNumerals.length === 0 && report.unusedNumerals.length === 0;
      report.figureReferences = report.invalidReferences.length === 0;

      return {
        valid: report.numeralConsistency && report.figureReferences,
        report
      };

    } catch (error) {
      return {
        valid: false,
        report: {
          error: 'Validation failed',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  /**
   * Extended rule-based validator (no LLM) covering IPO-focused checks
   * 
   * NOTE: This validator is ADVISORY ONLY - it never blocks drafting output.
   * All issues are surfaced as feedback for post-generation review.
   * The `valid` return value indicates whether all checks passed, but does not block operations.
   */
  static validateDraftExtended(draftObj: any, session: any, profile?: any | null, jurisdiction?: string): { valid: boolean; report: any } {
    const textNorm = (s: string) => (s || '').replace(/[\u2013\u2014]/g, '-').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim()
    const wordCount = (s: string) => (textNorm(s).match(/\b\w+\b/g) || []).length
    const activeJurisdiction = (jurisdiction || session?.activeJurisdiction || session?.draftingJurisdictions?.[0] || 'IN').toUpperCase()
    const sectionChecks = profile?.profileData?.validation?.sectionChecks || {}
    const getLimit = (sectionId: string, type: 'maxWords' | 'maxChars' | 'maxCount') => {
      const internal = this.mapToInternalKey(sectionId) || sectionId
      const arr = sectionChecks[internal] || sectionChecks[sectionId] || []
      const rule = Array.isArray(arr) ? arr.find((c: any) => c?.type === type && typeof c.limit === 'number') : undefined
      return rule?.limit
    }

    const last = draftObj || {}
    const report: any = {
      wordCounts: {},
      abstract: {},
      bdod: {},
      figures: {},
      numerals: {},
      claims: {},
      bestMethod: {},
      industrialApplicability: {},
      terminology: {},
      section3Flags: [],
      sectionPresence: {},
      complianceScore: 100,
      // NOTE: hasIssues is informational only - does NOT block drafting
      hasIssues: false,
      // Keep hardFail for backward compatibility but it's purely informational
      hardFail: false
    }

    const title = textNorm(last.title || '')
    const abstract = textNorm(last.abstract || '')
    const fieldOfInvention = textNorm(last.fieldOfInvention || '')
    const background = textNorm(last.background || '')
    const summary = textNorm(last.summary || '')
    const bdod = (last.briefDescriptionOfDrawings || '').replace(/\r/g, '')
    const detailed = textNorm(last.detailedDescription || '')
    const bestMethod = textNorm(last.bestMethod || '')
    const claims = (last.claims || '').replace(/\r/g, '')
    const industrial = textNorm(last.industrialApplicability || '')
    const numeralsList = (last.listOfNumerals || '').replace(/\r/g, '')

    report.wordCounts = {
      title: wordCount(title),
      abstract: wordCount(abstract),
      fieldOfInvention: wordCount(fieldOfInvention),
      background: wordCount(background),
      summary: wordCount(summary),
      bdod: wordCount(bdod),
      detailed: wordCount(detailed),
      bestMethod: wordCount(bestMethod),
      claims: wordCount(claims),
      industrialApplicability: wordCount(industrial),
      listOfNumerals: wordCount(numeralsList)
    }

    const titleMaxWords = getLimit('title', 'maxWords')
    const titleMaxChars = getLimit('title', 'maxChars')
    report.title = { length: report.wordCounts.title, maxWords: titleMaxWords, maxChars: titleMaxChars }
    if ((titleMaxWords && report.wordCounts.title > titleMaxWords) || (titleMaxChars && title.length > titleMaxChars)) {
      report.hasIssues = true; report.complianceScore -= 5
    }

    // P0: Abstract discipline
    const abstractForbidden = /(\bnovel\b|\binventive\b|\bunique\b|\bbest\b|\badvantage\b|\bbenefit\b|\bclaim\b|\bclaims\b)/i
    const abstractDigits = /\d/
    const absLen = report.wordCounts.abstract
    const absForbiddenHits = (abstractForbidden.test(abstract) ? ['lexicon'] : [])
    const absMaxWords = getLimit('abstract', 'maxWords')
    const absMaxChars = getLimit('abstract', 'maxChars')
    const abstractStartsWithTitle = !!(title && abstract && abstract.startsWith(title))
    report.abstract = {
      digits: abstractDigits.test(abstract),
      forbiddenHits: absForbiddenHits,
      length: absLen,
      maxWords: absMaxWords,
      maxChars: absMaxChars,
      startsWithTitle: abstractStartsWithTitle
    }
    if ((absMaxWords && absLen > absMaxWords) || absForbiddenHits.length > 0) {
      report.hasIssues = true; report.complianceScore -= 10
    }
    if (absMaxChars && abstract.length > absMaxChars) {
      report.hasIssues = true; report.complianceScore -= 5
    }
    // Only treat "must start with title" as a strict rule for Indian practice
    if (activeJurisdiction === 'IN' && !abstractStartsWithTitle) {
      report.complianceScore -= 3
    }

    // P0: BDOD format & coverage
    const planFigures = (session.figurePlans || []).map((f:any)=>f.figureNo)
    const bdodLines = bdod.split(/\n+/).map((l: string)=>l.trim()).filter(Boolean)
    const figRefRegex = /\b(Fig\.?|Figure)\s*0*(\d+)\b/i
    const normalizedLines = bdodLines.map((l: string) => l.replace(/^\s*(?:Figure|FIG\.|Fig\.)\s*0*(\d+)/i, (m: string, g1: string) => `Fig. ${g1}`))
    const seen = new Set<number>()
    const overlength: number[] = []
    const missing: number[] = []
    const extra: number[] = []
    const formatViolations: number[] = []
    normalizedLines.forEach((l: string, idx: number) => {
      const wc = wordCount(l)
      if (wc > 40) overlength.push(idx+1)
      const m = l.match(/^Fig\.\s*(\d+)\s*[G-]/)
      if (!m) { formatViolations.push(idx+1); return }
      const num = parseInt(m[1], 10)
      if (!planFigures.includes(num)) extra.push(num)
      seen.add(num)
    })
    planFigures.forEach((n: number) => { if (!seen.has(n)) missing.push(n) })
    report.bdod = { missingFigures: missing, extraFigures: extra, overlengthLines: overlength, formatViolations }
    if (missing.length>0 || extra.length>0 || overlength.length>0 || formatViolations.length>0) { report.hasIssues = true; report.complianceScore -= 10 }

    // P0: Industrial Applicability
    const iaPresent = industrial.length>0
    const iaLen = report.wordCounts.industrialApplicability
    const iaForbidden = abstractForbidden.test(industrial)
    const iaMaxWords = getLimit('industrialApplicability', 'maxWords')
    const iaMaxChars = getLimit('industrialApplicability', 'maxChars')
    report.industrialApplicability = {
      present: iaPresent,
      length: iaLen,
      forbiddenHits: iaForbidden ? ['lexicon'] : [],
      maxWords: iaMaxWords,
      maxChars: iaMaxChars,
      startsWith: undefined as boolean | undefined
    }
    if (!iaPresent) { report.hasIssues = true; report.complianceScore -= 10 }
    if (iaMaxWords && iaLen > iaMaxWords) { report.hasIssues = true; report.complianceScore -= 5 }
    if (iaMaxChars && industrial.length > iaMaxChars) { report.hasIssues = true; report.complianceScore -= 5 }
    if (activeJurisdiction === 'IN') {
      const iaStarts = industrial.startsWith('The invention is industrially applicable to')
      report.industrialApplicability.startsWith = iaStarts
      if (!iaStarts || iaLen < 50) { report.hasIssues = true; report.complianceScore -= 5 }
    }

    // P0: Numeral integrity expanded (treat only three-digit numerals 100G999 as reference numerals)
    const numRegex = /\((\d{3})\)/g
    const used = new Map<number, number>()
    const fullText = textNorm([
      title, fieldOfInvention, background, summary, normalizedLines.join('\n'), detailed, bestMethod, claims, industrial, numeralsList
    ].join('\n'))
    let m: RegExpExecArray | null
    while ((m = numRegex.exec(fullText)) !== null) {
      const n = parseInt(m[1],10); used.set(n,(used.get(n)||0)+1)
    }
    const declared = new Set<number>((session.referenceMap?.components||[]).map((c:any)=>c.numeral))
    const declaredNotUsed: number[] = []; declared.forEach(n=>{ if(!used.has(n)) declaredNotUsed.push(n) })
    const usedNotDeclared: number[] = []; used.forEach((_,n)=>{ if(!declared.has(n)) usedNotDeclared.push(n) })
    // Repeated mentions of the same numeral across the specification are expected; do not treat as an error here.
    const duplicates: number[] = []
    report.numerals = { declaredNotUsed, usedNotDeclared, duplicates, styleViolations: 0 }
    if (usedNotDeclared.length>0) { report.hasIssues = true; report.complianceScore -= 10 }

    // P0: Figure integrity (invalid refs anywhere; coverage outside BDOD)
    const figureRefRegex = /\b(Fig\.?|Figure)\s*0*(\d+)\b/gi
    const refs = new Set<number>()
    let fm: RegExpExecArray | null
    while ((fm = figureRefRegex.exec(fullText)) !== null) { refs.add(parseInt(fm[2],10)) }
    const availableSet = new Set<number>(planFigures)
    const invalidReferences: number[] = []; refs.forEach(n=>{ if(!availableSet.has(n)) invalidReferences.push(n) })
    const outsideText = textNorm([summary,detailed,claims].join('\n'))
    const coverage: any = { mentionedOutsideBDOD: [] }
    planFigures.forEach((n: number) => { coverage.mentionedOutsideBDOD.push(new RegExp(`\\b(Fig\\.?|Figure)\\s*0*${n}\\b`,'i').test(outsideText)) })
    report.figures = { invalidReferences, coverage }
    if (invalidReferences.length>0) { report.hasIssues = true; report.complianceScore -= 10 }

    // P0: Claims hygiene
    const forbiddenClaims = /(and\/or|etc\.|approximately|substantially)/i
    const vagueAdj = /(\bnear\b|\bfast\b|\befficient\b|\boptimal\b|\brobust\b|\bsecure\b)/ig
    const claimBlocks = claims.split(/\n\s*(?=\d+\.)/).map((s: string)=>s.trim()).filter(Boolean)
    const totalClaims = claimBlocks.length
    const independentWords = claimBlocks[0] ? wordCount(claimBlocks[0].replace(/^\d+\./,'')) : 0
    const claimsMaxCount = getLimit('claims', 'maxCount')
    // naive dependency depth: count "claim X" chains
    const depDepthRegex = /claim\s+(\d+)/ig
    let depthMax = 1
    claimBlocks.forEach((cb: string) => {
      const chain = Array.from(cb.matchAll(depDepthRegex)).map((m: RegExpMatchArray)=>parseInt(m[1],10))
      depthMax = Math.max(depthMax, chain.length || 1)
    })
    const forbiddenHits = forbiddenClaims.test(claims) ? ['lexicon'] : []
    const antecedentFailures: string[] = []
    // basic antecedent: fail if 'the ' appears before any ' a/an ' in the same claim (rough heuristic)
    claimBlocks.forEach((cb: string, i: number)=>{
      const body = cb.toLowerCase()
      if (body.indexOf(' the ') !== -1 && body.indexOf(' a ') === -1 && body.indexOf(' an ') === -1) antecedentFailures.push(`claim ${i+1}`)
    })
    report.claims = {
      total: totalClaims,
      independents: totalClaims>0?1:0,
      maxIndependentWords: independentWords,
      dependencyDepthMax: depthMax,
      forbiddenHits,
      antecedentFailures,
      maxCount: claimsMaxCount
    }
    if ((claimsMaxCount && totalClaims > claimsMaxCount) || forbiddenHits.length>0) { report.hasIssues = true; report.complianceScore -= 10 }

    // P0: Best Method sufficiency
    const hasNumeric = /\d/.test(bestMethod)
    const hedges = (bestMethod.match(/\b(may|could|might|preferred|ideally)\b/gi) || []).length
    const tokens = (bestMethod.match(/\b\w+\b/g) || []).length || 1
    const hedgingDensity = hedges / tokens
    report.bestMethod = { hasNumeric, hedgingDensity }
    if (!hasNumeric || hedgingDensity > 0.03) { report.hasIssues = true; report.complianceScore -= 10 }

    // P1: Field/Background tone (simple)
    const badTone = /(holistic|breakthrough|revolutionary)/i
    if (badTone.test(background)) report.complianceScore -= 2
    // If a field/technical-field maxWords rule exists in the profile, use that; otherwise do not enforce a hard 40–80 range globally
    const fieldMaxWords = getLimit('fieldOfInvention', 'maxWords') || getLimit('technical_field', 'maxWords') || getLimit('field', 'maxWords')
    if (fieldMaxWords && report.wordCounts.fieldOfInvention > fieldMaxWords) {
      report.complianceScore -= 2
    }

    // P1: List of numerals hygiene
    const listLines = numeralsList.split(/\n+/).map((l: string)=>l.trim()).filter(Boolean)
    const listNums = listLines.map((l: string) => { const m = l.match(/\((\d{1,5})\)\s*[G-]\s*/); return m?parseInt(m[1],10):null }).filter((n: number | null)=>n!==null) as number[]
    const ascending = listNums.every((n: number, i: number, arr: number[])=> i===0 || arr[i-1]<=n)
    const dupList = listNums.filter((n: number, i: number, arr: number[])=> arr.indexOf(n) !== i)
    report.numerals.list = { ascending, duplicates: dupList }
    if (!ascending || dupList.length>0) report.complianceScore -= 4

    // P1: Section 3 India red-flags (simple regex) – only for IN
    const s3Flags: any[] = []
    if (activeJurisdiction === 'IN') {
      const addFlag = (clause: string, phrase: string, location: string, severity: 'warn' | 'fail') =>
        s3Flags.push({ clause, phrase, location, severity })
      if (/algorithm\s+per\s*se/i.test(claims)) addFlag('3(k)', 'algorithm per se', 'claims', 'fail')
      if (/computer\s+program\s+product/i.test(claims)) addFlag('3(k)', 'computer program product', 'claims', 'warn')
      if (/diagnos|therapy/i.test(claims)) addFlag('3(i)', 'diagnosis/therapy', 'claims', 'warn')
      if (s3Flags.some(f => f.severity === 'fail')) { report.hasIssues = true; report.complianceScore -= 10 }
    }
    report.section3Flags = s3Flags

    // Set hardFail for backward compatibility (maps to hasIssues)
    report.hardFail = report.hasIssues

    // Final decision - NOTE: `valid` is informational only and does NOT block drafting
    // All validation issues are surfaced for post-generation review
    return { valid: !report.hasIssues, report }
  }
}

