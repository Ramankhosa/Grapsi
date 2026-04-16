/**
 * Paper Section Service
 * Generates paper sections with inline memory for coherence
 * 
 * Supports two generation modes:
 *   single_pass — original flow (prompt → content + memory)
 *   two_pass    — Pass 1 (evidence draft with [CITE:key]) → Pass 2 (publication polish)
 * 
 * Pass 1 preserves all [CITE:key] anchors and is stored internally for audit.
 * Pass 2 polishes prose while retaining every citation anchor; downstream
 * formatting (DraftingService.formatContent) converts them to styled citations.
 */

import { prisma } from '../prisma';
import { llmGateway, type TenantContext } from '../metering';
import { blueprintService, type BlueprintContext, type SectionPlanItem } from './blueprint-service';
import { sectionTemplateService } from './section-template-service';
import { getMethodologyConstraints } from '../prompts/methodology-constraints';
import {
  getPaperWritingSample,
  buildPaperWritingSampleBlock,
  getPaperSectionStyleHints,
  type PaperPersonaSelection
} from '../paper-writing-sample-service';
import {
  paperPromptDebug,
  buildPromptDebugInfo,
  buildLLMDebugInfo,
  logFullReport,
  isDebugEnabled,
  type PromptDebugInfo,
  type LLMDebugInfo,
  type FullDebugReport
} from './paper-prompt-debug';
import { sectionPolishService, type DriftReport } from './section-polish-service';
import { evidencePackService, type SectionEvidencePack, type EvidenceDigest } from './evidence-pack-service';
import type { AssignedCitation } from './citation-coverage-distributor';
import { isFeatureEnabled } from '../feature-flags';
import { researchIntentLockService, type ResearchIntentLock } from './research-intent-lock-service';
import { argumentPlannerService } from './argument-planner-service';
import { citationValidator } from './citation-validator';
import { buildRhetoricalPromptBlock } from './rhetorical-blueprint-service';
import { systemPromptTemplateService, TEMPLATE_KEYS } from './system-prompt-template-service';
import { applyLengthControlToWordBudget } from '../paper-length-control';
import {
  buildPass1FigureGroundingSnapshot,
  formatSelectedFigureContext,
  loadFigurePromptContext,
  type FigurePromptContext,
  type Pass1FigureGroundingSnapshot
} from './paper-figure-grounding-service';
import type { PaperSection, PaperSectionStatus } from '@prisma/client';
import crypto from 'crypto';
import { polishDraftMarkdown } from '../markdown-draft-formatter';

const DEFAULT_BG_PASS1_CONCURRENCY = Number.parseInt(
  process.env.BG_PASS1_CONCURRENCY || '10',
  10
);

function clampBgPass1Concurrency(value?: number): number {
  const parsed = Number.isFinite(Number(value)) ? Number(value) : DEFAULT_BG_PASS1_CONCURRENCY;
  return Math.max(1, Math.min(20, parsed || DEFAULT_BG_PASS1_CONCURRENCY || 10));
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const workerCount = Math.min(limit, items.length);
  let cursor = 0;

  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });

  await Promise.all(runners);
}

// ============================================================================
// Types
// ============================================================================

export interface SectionDimensionBrief {
  dimensionKey: string;
  dimensionLabel: string;
  roleHint?: 'introduction' | 'body' | 'conclusion' | 'intro_conclusion';
  sourceSummary: string;
  claimFocus?: string[];
  mustUseCitationKeys?: string[];
  bridgeToNext?: string;
}

export interface SectionMemory {
  keyPoints: string[];      // 3-5 bullets summarizing what this section covers
  termsIntroduced: string[]; // Technical terms/concepts first defined here
  mainClaims: string[];      // Key assertions (labeled: BACKGROUND/GAP/THESIS/METHOD/RESULT)
  forwardReferences: string[]; // Promises to address something in later sections
  sectionIntent?: string;
  openingStrategy?: string;
  closingStrategy?: string;
  sectionOutline?: string[];
  dimensionBriefs?: SectionDimensionBrief[];
}

export interface PaperSectionWithMemory extends Omit<PaperSection, 'memory'> {
  memory: SectionMemory | null;
}

export interface SectionGenerationInput {
  sessionId: string;
  sectionKey: string;
  userInstructions?: string; // Optional user-provided guidance (one-time override)
  useStoredInstructions?: boolean; // If true, also fetch from UserSectionInstruction table
  usePersonaStyle?: boolean; // If true, fetch and inject user's writing style samples
  personaSelection?: PaperPersonaSelection; // Optional persona selection (primary + secondary)
  regenerate?: boolean;      // If true, regenerate even if exists
  tenantContext?: TenantContext | null; // Optional tenant context for metering-aware LLM calls
  useFigures?: boolean;
  selectedFigureIds?: string[];
  requestHeaders?: Record<string, string>;
}

export interface UserSectionInstructionData {
  instruction?: string;
  emphasis?: string;
  avoid?: string;
  style?: string;
  wordCount?: number;
}

export interface SectionGenerationResult {
  success: boolean;
  section?: PaperSectionWithMemory;
  error?: string;
}

export interface PreviousSectionSummary {
  sectionKey: string;
  displayName: string;
  memory: SectionMemory;
}

export interface BackgroundGenProgress {
  total: number;
  completed: number;
  failed: number;
  sections: Record<string, 'pending' | 'running' | 'done' | 'failed'>;
}

export interface BackgroundGenResult {
  success: boolean;
  progress: BackgroundGenProgress;
  error?: string;
}

interface StoredPass1Artifact {
  version: number;
  content: string;
  memory?: SectionMemory | null;
  contentFingerprint: string;
  wordCount: number;
  generatedAt?: string;
  promptUsed?: string;
  tokensUsed?: number;
  figureGrounding?: Pass1FigureGroundingSnapshot | null;
}

interface BackgroundPass1FigureSelection {
  useFigures?: boolean;
  selectedFigureIds?: string[];
}

function computeStoredPass1Fingerprint(content: string): string {
  const normalized = String(content || '').replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

function countStoredPass1Words(text: string): number {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.split(' ').length : 0;
}

function buildStoredPass1Artifact(params: {
  content: string;
  memory?: SectionMemory | null;
  generatedAt?: Date | string | null;
  promptUsed?: string;
  tokensUsed?: number | null;
  figureGrounding?: Pass1FigureGroundingSnapshot | null;
}): StoredPass1Artifact | null {
  const content = String(params.content || '').trim();
  if (!content) return null;
  const generatedAt = params.generatedAt instanceof Date
    ? params.generatedAt.toISOString()
    : String(params.generatedAt || '').trim() || undefined;

  return {
    version: 1,
    content,
    memory: params.memory || null,
    contentFingerprint: computeStoredPass1Fingerprint(content),
    wordCount: countStoredPass1Words(content),
    generatedAt,
    promptUsed: String(params.promptUsed || '').trim() || undefined,
    tokensUsed: Number(params.tokensUsed) > 0 ? Number(params.tokensUsed) : undefined,
    figureGrounding: params.figureGrounding || null
  };
}

function readStoredPass1Content(section: Pick<PaperSection, 'baseContentInternal' | 'pass1Artifact'> | null | undefined): string {
  const artifact = section?.pass1Artifact && typeof section.pass1Artifact === 'object' && !Array.isArray(section.pass1Artifact)
    ? section.pass1Artifact as Record<string, unknown>
    : null;
  const artifactContent = artifact ? String(artifact.content || '').trim() : '';
  return artifactContent || String(section?.baseContentInternal || '').trim();
}

function normalizeSectionKey(sectionKey: string): string {
  return String(sectionKey || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

const PASS1_EXCLUDED_SECTION_KEYS = new Set(['references', 'reference', 'bibliography']);

function isPass1ExcludedSection(sectionKey: string): boolean {
  return PASS1_EXCLUDED_SECTION_KEYS.has(normalizeSectionKey(sectionKey));
}

function supportsPass1FigureInjection(sectionKey: string): boolean {
  const normalized = normalizeSectionKey(sectionKey);
  return normalized !== 'abstract' && !isPass1ExcludedSection(normalized);
}

// ============================================================================
// Section Names Map
// ============================================================================

const SECTION_DISPLAY_NAMES: Record<string, string> = {
  abstract: 'Abstract',
  introduction: 'Introduction',
  literature_review: 'Literature Review',
  related_work: 'Related Work',
  methodology: 'Methodology',
  results: 'Results',
  discussion: 'Discussion',
  conclusion: 'Conclusion',
  acknowledgments: 'Acknowledgments',
  references: 'References',
  future_directions: 'Future Directions',
  future_work: 'Future Work',
  case_description: 'Case Description',
  analysis: 'Analysis',
  recommendations: 'Recommendations',
  main_content: 'Main Content',
  case_studies: 'Case Studies',
  main_findings: 'Main Findings',
  appendix: 'Appendix'
};

interface Pass1EvidencePromptContext {
  useMappedEvidence: boolean;
  allowedCitationKeys: string[];
  dimensionEvidence: SectionEvidencePack['dimensionEvidence'];
  gaps: string[];
  coverageAssignments: AssignedCitation[];
  evidenceDigest: EvidenceDigest;
}

function formatDimensionEvidence(
  evidence: SectionEvidencePack['dimensionEvidence']
): string {
  if (!evidence || evidence.length === 0) {
    return '(No dimension evidence available)';
  }

  const lines: string[] = [
    'VERIFIED DIMENSION EVIDENCE:',
    '- Use these mapped citations as primary support for this section.',
    '- Do not invent findings outside the cards/metadata below.',
    '- Prefer HIGH-confidence and quote-verified cards when available.',
    '- SYNTHESIS INSTRUCTION: Within each dimension, weave citations into a coherent analytical narrative — do not list them sequentially.',
    '- Use positional relations (REINFORCES/CONTRADICTS/EXTENDS/QUALIFIES) to structure comparisons between cited works.',
    '',
  ];

  for (const dim of evidence) {
    lines.push(`Dimension: "${dim.dimension}"`);

    if (!dim.citations.length) {
      lines.push('  (no citations mapped)');
      lines.push('');
      continue;
    }

    const reinforcing: string[] = [];
    const contradicting: string[] = [];
    const extending: string[] = [];
    const other: string[] = [];

    for (const citation of dim.citations) {
      const cards = Array.isArray(citation.evidenceCards) ? citation.evidenceCards : [];
      const relation = citation.positionalRelation?.relation;
      const rationale = citation.positionalRelation?.rationale;
      const relationTag = relation ? ` [${relation}]` : '';
      const baseLine = `  [${citation.citationKey}]${relationTag} (${citation.year || 'n.d.'}, ${citation.confidence}) "${citation.title}"`;
      const citLines: string[] = [baseLine];

      if (rationale) {
        citLines.push(`    Relation rationale: ${rationale}`);
      }
      if (citation.remark) {
        citLines.push(`    Relevance: ${citation.remark}`);
      }
      if (citation.evidenceBoundary) {
        citLines.push(`    Boundary: ${citation.evidenceBoundary}`);
      }

      for (const card of cards.slice(0, 3)) {
        citLines.push(`    Claim: ${card.claim}`);
        if (card.quantitativeDetail) {
          citLines.push(`    Detail: ${card.quantitativeDetail}`);
        }
        if (card.conditions) {
          citLines.push(`    Conditions: ${card.conditions}`);
        }
        if (card.doesNotSupport) {
          citLines.push(`    Does NOT support: ${card.doesNotSupport}`);
        }
      }

      const block = citLines.join('\n');
      if (relation === 'CONTRADICTS' || relation === 'TENSION') contradicting.push(block);
      else if (relation === 'EXTENDS' || relation === 'QUALIFIES') extending.push(block);
      else if (relation === 'REINFORCES') reinforcing.push(block);
      else other.push(block);
    }

    if (reinforcing.length > 0) {
      lines.push(`  ── Supporting evidence (use to build your core argument) ──`);
      lines.push(...reinforcing);
    }
    if (contradicting.length > 0) {
      lines.push(`  ── Contrasting evidence (must be explicitly discussed — show tension) ──`);
      lines.push(...contradicting);
    }
    if (extending.length > 0) {
      lines.push(`  ── Extending/qualifying evidence (use to refine or bound claims) ──`);
      lines.push(...extending);
    }
    if (other.length > 0) {
      if (reinforcing.length > 0 || contradicting.length > 0 || extending.length > 0) {
        lines.push(`  ── Additional evidence ──`);
      }
      lines.push(...other);
    }

    const totalCites = dim.citations.length;
    const contrastCount = contradicting.length;
    if (totalCites >= 3) {
      lines.push(`  SYNTHESIS HINT: This dimension has ${totalCites} citations${contrastCount > 0 ? ` (${contrastCount} contrasting)` : ''}. Synthesize them thematically — show what they collectively establish, where they diverge, and what remains unresolved.`);
    }

    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Format evidence digest into a compact prompt block.
 * One line per citation — claim type, claim, strength, stance.
 * Replaces the verbose formatRelevanceNotes().
 */
function formatEvidenceDigest(digest: EvidenceDigest): string {
  if (!digest || digest.digests.length === 0) {
    return '(No evidence digest available)';
  }

  const lines: string[] = [
    'EVIDENCE DIGEST (one line per citation — use these as grounding, not verbatim sources):',
    ''
  ];

  for (const entry of digest.digests) {
    const mustTag = entry.mustCite ? ' [MUST-CITE]' : '';
    const methodTag = entry.method ? ` | method: ${entry.method.slice(0, 80)}` : '';
    lines.push(
      `- [${entry.citationKey}]${mustTag}: ${entry.claimType} | ${entry.claim.slice(0, 200)} | ` +
      `strength: ${entry.evidenceStrength} | stance: ${entry.stance || 'neutral'}${methodTag}`
    );
  }

  return lines.join('\n');
}

/**
 * Format citation budget rules for prompt injection.
 * Replaces the "MUST use each one at least once" mandate.
 */
function formatCitationBudgetRules(digest: EvidenceDigest): string {
  const lines: string[] = [
    'CITATION BUDGET RULES:',
    `- Must-cite keys (MUST appear at least once): ${digest.mustCiteKeys.length > 0 ? digest.mustCiteKeys.join(', ') : '(none)'}`,
    `- Optional pool (use where contextually appropriate): ${digest.optionalCiteKeys.length > 0 ? digest.optionalCiteKeys.join(', ') : '(none)'}`,
    `- Max citations per paragraph: 3`,
    `- Do NOT cite-dump. Each citation must serve a distinct argumentative purpose.`,
    `- Use [CITE:key] format for all citations.`,
  ];

  return lines.join('\n');
}

// ============================================================================
// Paper Section Service Class
// ============================================================================

class PaperSectionService {

  /**
   * Generate a single paper section with memory
   */
  async generateSection(input: SectionGenerationInput): Promise<SectionGenerationResult> {
    const {
      sessionId,
      sectionKey,
      userInstructions,
      useStoredInstructions = true,
      usePersonaStyle = false,
      personaSelection,
      regenerate,
      tenantContext,
    } = input;

    const twoPassEnabled = isFeatureEnabled('ENABLE_TWO_PASS_GENERATION');
    const effectiveTwoPass = twoPassEnabled && !isPass1ExcludedSection(sectionKey);

    try {
      // Check if blueprint is ready
      const blueprintReady = await blueprintService.isBlueprintReady(sessionId);
      if (!blueprintReady.ready) {
        return {
          success: false,
          error: blueprintReady.reason || 'Blueprint not ready'
        };
      }

      // Check for existing section
      const existingSection = await prisma.paperSection.findUnique({
        where: { sessionId_sectionKey: { sessionId, sectionKey } }
      });

      const storedPass1Content = readStoredPass1Content(existingSection);
      const reuseStatuses = ['DRAFT', 'REVIEWED', 'APPROVED'];
      if (effectiveTwoPass) {
        if (!existingSection || !storedPass1Content) {
          return {
            success: false,
            error: `Pass 1 reference draft is missing for "${sectionKey}". Generate Pass 1 first.`
          };
        }

        if (!regenerate && !existingSection.isStale && reuseStatuses.includes(existingSection.status)) {
          return {
            success: true,
            section: this.transformSection(existingSection)
          };
        }

        return this.runPass2Only(existingSection, undefined, tenantContext || null);
      }

      if (existingSection && !regenerate && !existingSection.isStale && reuseStatuses.includes(existingSection.status)) {
        return {
          success: true,
          section: this.transformSection(existingSection)
        };
      }

      // Get blueprint context for this section
      const blueprintContext = await blueprintService.getSectionContext(sessionId, sectionKey);
      if (!blueprintContext) {
        return {
          success: false,
          error: `Section ${sectionKey} not found in blueprint`
        };
      }

      // Get previous sections' memories
      const previousMemories = await this.getPreviousSectionMemories(sessionId, sectionKey);

      // Get the session to fetch paper type and research topic
      const session = await prisma.draftingSession.findUnique({
        where: { id: sessionId },
        include: {
          researchTopic: true,
          paperType: true
        }
      });

      if (!session || !session.researchTopic) {
        return {
          success: false,
          error: 'Session or research topic not found'
        };
      }

      const paperTypeCode = session.paperType?.code || 'JOURNAL_ARTICLE';

      // Get methodology type from blueprint
      const blueprint = await blueprintService.getBlueprint(sessionId);
      const methodologyType = (blueprint as any)?.methodologyType || null;

      // Fetch and combine user instructions (paper-type-specific)
      let combinedUserInstructions = '';

      if (useStoredInstructions) {
        const storedInstructions = await this.getUserSectionInstructions(
          session.userId,
          sessionId,
          sectionKey,
          paperTypeCode
        );
        if (storedInstructions) {
          combinedUserInstructions = this.formatUserInstructions(storedInstructions);
        }
      }

      if (userInstructions) {
        if (combinedUserInstructions) {
          combinedUserInstructions += `\n\nADDITIONAL ONE-TIME INSTRUCTIONS:\n${userInstructions}`;
        } else {
          combinedUserInstructions = userInstructions;
        }
      }

      // Fetch writing style sample if persona style is enabled
      let writingStyleBlock = '';
      if (usePersonaStyle) {
        const sample = await getPaperWritingSample(
          session.userId,
          sectionKey,
          paperTypeCode,
          personaSelection
        );
        if (sample) {
          writingStyleBlock = buildPaperWritingSampleBlock(sample, sectionKey);
          const styleHints = getPaperSectionStyleHints(sectionKey);
          if (styleHints) {
            writingStyleBlock += `\n${styleHints}`;
          }
        }
      }

      // Build the generation prompt with debug info
      const { prompt, debugInfo } = await this.buildSectionPromptWithDebug(
        blueprintContext,
        previousMemories,
        session.researchTopic,
        paperTypeCode,
        methodologyType,
        combinedUserInstructions || undefined,
        writingStyleBlock || undefined,
        sessionId,
        sectionKey,
        tenantContext || undefined
      );

      if (isDebugEnabled() && debugInfo) {
        paperPromptDebug.logPromptHierarchy(debugInfo);
      }

      const llmStartTime = Date.now();

      // Call LLM (Pass 1 in two-pass mode, or the only pass in single-pass)
      const llmRequestContext = tenantContext ? { tenantContext } : { headers: {} };
      const result = await llmGateway.executeLLMOperation(
        llmRequestContext,
        {
          taskCode: 'LLM2_DRAFT',
          stageCode: effectiveTwoPass ? 'PAPER_SECTION_DRAFT' : 'PAPER_SECTION_GEN',
          prompt,
          parameters: {
            purpose: effectiveTwoPass ? 'paper_section_pass1' : 'paper_section_generation',
            temperature: 0.65,
          },
          idempotencyKey: crypto.randomUUID(),
          metadata: {
            sessionId,
            sectionKey,
            purpose: effectiveTwoPass ? 'paper_section_pass1' : 'paper_section_generation'
          }
        }
      );

      const llmEndTime = Date.now();
      const llmLatencyMs = llmEndTime - llmStartTime;

      if (isDebugEnabled()) {
        const llmDebugInfo = buildLLMDebugInfo(
          result.response?.modelClass || 'unknown',
          (result.response?.metadata as any)?.inputTokens || 0,
          result.response?.outputTokens || 0,
          (result.response?.metadata as any)?.inputCostPer1M || 0,
          (result.response?.metadata as any)?.outputCostPer1M || 0,
          llmLatencyMs,
          result.success,
          result.error?.message
        );
        paperPromptDebug.logLLMResult(llmDebugInfo);

        if (result.response?.output) {
          const preview = result.response.output.substring(0, 500);
          console.log(`\n\x1b[33m\x1b[1mOUTPUT PREVIEW\x1b[0m`);
          console.log(`\x1b[2m${'─'.repeat(80)}\x1b[0m`);
          console.log(`\x1b[2m${preview}${result.response.output.length > 500 ? '...' : ''}\x1b[0m`);
          console.log(`\n\x1b[34m${'═'.repeat(80)}\x1b[0m`);
          console.log(`\x1b[44m\x1b[37m END DEBUG - ${sectionKey.toUpperCase()} \x1b[0m\n`);
        }
      }

      if (!result.success || !result.response) {
        return {
          success: false,
          error: result.error?.message || 'Section generation failed'
        };
      }

      let parsed = this.parseSectionResponse(result.response.output);
      if (effectiveTwoPass) {
        parsed = {
          ...parsed,
          content: await this.enforceCitationBudgetValidator({
            sessionId,
            sectionKey,
            content: parsed.content,
            llmRequestContext,
            purpose: 'paper_section_pass1_citation_budget_rewrite'
          })
        };
      }
      const blueprintVersion = blueprint?.version || 1;

      // ── Single-pass path ──
      if (!effectiveTwoPass) {
        const sectionData = {
          sectionKey,
          displayName: SECTION_DISPLAY_NAMES[sectionKey] || sectionKey,
          content: parsed.content,
          wordCount: this.countWords(parsed.content),
          memory: parsed.memory as any,
          blueprintVersion,
          promptUsed: prompt,
          llmResponse: result.response.output,
          tokensUsed: result.response.outputTokens,
          generationMode: 'single_pass',
          status: 'DRAFT' as PaperSectionStatus,
          isStale: false,
          generatedAt: new Date()
        };

        const section = await this.upsertSection(sessionId, sectionKey, sectionData, existingSection);
        return { success: true, section: this.transformSection(section) };
      }

      // ── Two-pass path: persist Pass 1, then run Pass 2 ──
      const pass1CompletedAt = new Date();
      const pass1Artifact = buildStoredPass1Artifact({
        content: parsed.content,
        memory: parsed.memory,
        generatedAt: pass1CompletedAt,
        promptUsed: prompt,
        tokensUsed: result.response.outputTokens
      });
      const pass1Data = {
        sectionKey,
        displayName: SECTION_DISPLAY_NAMES[sectionKey] || sectionKey,
        content: existingSection?.content || '',
        wordCount: existingSection?.content ? this.countWords(existingSection.content) : 0,
        memory: parsed.memory as any,
        baseContentInternal: parsed.content,
        baseMemory: parsed.memory as any,
        pass1Artifact: pass1Artifact as any,
        blueprintVersion,
        pass1PromptUsed: prompt,
        pass1LlmResponse: result.response.output,
        pass1TokensUsed: result.response.outputTokens,
        pass1CompletedAt,
        generationMode: 'two_pass',
        status: 'BASE_READY' as PaperSectionStatus,
        isStale: false,
        generatedAt: pass1CompletedAt
      };

      const pass1Section = await this.upsertSection(sessionId, sectionKey, pass1Data, existingSection);

      // Immediately run Pass 2 polish (pass paperTypeCode to avoid re-lookup)
      return this.runPass2Only(pass1Section, paperTypeCode, tenantContext || null);

    } catch (error) {
      console.error('Section generation error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Run Pass 2 (polish) on a section that already has Pass 1 content.
   * Preserves all [CITE:key] anchors from the base content.
   *
   * paperTypeCode is optional — if not provided, it is resolved from the
   * session so callers on the fast path (line 164) don't need to pre-load it.
   */
  private async runPass2Only(
    section: PaperSection,
    paperTypeCode?: string,
    tenantContext?: TenantContext | null
  ): Promise<SectionGenerationResult> {
    const baseContent = readStoredPass1Content(section);
    if (!baseContent) {
      return {
        success: false,
        error: `Pass 1 reference draft is missing for "${section.sectionKey}". Generate Pass 1 first.`
      };
    }

    if (!paperTypeCode) {
      const session = await prisma.draftingSession.findUnique({
        where: { id: section.sessionId },
        include: { paperType: true }
      });
      paperTypeCode = session?.paperType?.code || 'JOURNAL_ARTICLE';
    }

    await prisma.paperSection.update({
      where: { id: section.id },
      data: { status: 'POLISHING' as PaperSectionStatus }
    });

    const blueprintContext = await blueprintService.getSectionContext(section.sessionId, section.sectionKey);

    const polishResult = await sectionPolishService.polishWithRetry({
      sectionKey: section.sectionKey,
      displayName: section.displayName,
      baseContent,
      sessionId: section.sessionId,
      paperTypeCode,
      targetWordCount: applyLengthControlToWordBudget(
        section.sectionKey,
        blueprintContext?.currentSection.wordBudget
      ),
      tenantContext: tenantContext || null,
    });

    if (!polishResult.success || !polishResult.polishedContent) {
      // Revert status — never expose Pass 1 as final
      await prisma.paperSection.update({
        where: { id: section.id },
        data: {
          status: 'BASE_READY' as PaperSectionStatus,
          validationReport: polishResult.driftReport as any,
        }
      });
      return {
        success: false,
        error: polishResult.error || 'Polish pass failed',
      };
    }

    let finalContent = polishResult.polishedContent;
    let finalPromptUsed = polishResult.promptUsed;
    let finalTokensUsed = Number(polishResult.tokensUsed || 0);
    let validationReport: Record<string, unknown> = (
      polishResult.driftReport
      && typeof polishResult.driftReport === 'object'
      && !Array.isArray(polishResult.driftReport)
    )
      ? { ...(polishResult.driftReport as unknown as Record<string, unknown>) }
      : {};

    const updated = await prisma.paperSection.update({
      where: { id: section.id },
      data: {
        content: finalContent,
        wordCount: this.countWords(finalContent),
        promptUsed: finalPromptUsed,
        llmResponse: finalContent,
        tokensUsed: finalTokensUsed > 0 ? finalTokensUsed : undefined,
        pass2PromptUsed: finalPromptUsed,
        pass2TokensUsed: finalTokensUsed > 0 ? finalTokensUsed : undefined,
        pass2CompletedAt: new Date(),
        validationReport: Object.keys(validationReport).length > 0 ? validationReport as any : null,
        status: 'DRAFT' as PaperSectionStatus,
        version: { increment: 1 },
      }
    });

    return { success: true, section: this.transformSection(updated) };
  }

  // ============================================================================
  // Background Parallel Pass 1 (manual trigger from UI)
  // ============================================================================

  /**
   * Run Pass 1 for ALL sections in parallel. Each section gets its own
   * blueprint context but no cross-section memory (traded for speed).
   * Results are stored as BASE_READY for fast Pass 2 when the user arrives.
   */
  async runParallelPass1(
    sessionId: string,
    tenantContext?: TenantContext | null,
    options?: {
      forceRerun?: boolean;
      sectionKeys?: string[];
      figureSelections?: Record<string, BackgroundPass1FigureSelection>;
      requestHeaders?: Record<string, string>;
    }
  ): Promise<BackgroundGenResult> {
    const forceRerun = options?.forceRerun === true;
    const progress: BackgroundGenProgress = { total: 0, completed: 0, failed: 0, sections: {} };

    try {
      const blueprintReady = await blueprintService.isBlueprintReady(sessionId);
      if (!blueprintReady.ready) {
        return { success: false, progress, error: blueprintReady.reason || 'Blueprint not ready' };
      }

      const fullGenerationOrder = (await this.getSectionGenerationOrder(sessionId))
        .filter((sectionKey) => !isPass1ExcludedSection(sectionKey));
      if (fullGenerationOrder.length === 0) {
        return { success: false, progress, error: 'No sections in blueprint' };
      }

      const requestedSectionKeys = Array.isArray(options?.sectionKeys)
        ? options.sectionKeys
          .map(key => String(key || '').trim())
          .filter(Boolean)
          .filter((sectionKey) => !isPass1ExcludedSection(sectionKey))
        : [];
      const requestedSectionSet = requestedSectionKeys.length > 0
        ? new Set(requestedSectionKeys)
        : null;
      const figureSelections = options?.figureSelections || {};

      const generationOrder = requestedSectionSet
        ? fullGenerationOrder.filter(sectionKey => requestedSectionSet.has(sectionKey))
        : fullGenerationOrder;

      if (generationOrder.length === 0) {
        return {
          success: false,
          progress,
          error: 'No eligible sections selected for Pass 1 run. References are excluded from Pass 1.'
        };
      }

      progress.total = generationOrder.length;
      for (const key of generationOrder) progress.sections[key] = 'pending';

      // Mark session as running
      await prisma.draftingSession.update({
        where: { id: sessionId },
        data: {
          bgGenStatus: 'RUNNING',
          bgGenStartedAt: new Date(),
          bgGenCompletedAt: null,
          bgGenProgress: progress as any,
        }
      });

      // Load shared context once
      const session = await prisma.draftingSession.findUnique({
        where: { id: sessionId },
        include: { researchTopic: true, paperType: true }
      });
      if (!session || !session.researchTopic) {
        await this.updateBgGenStatus(sessionId, 'FAILED', progress);
        return { success: false, progress, error: 'Session or research topic not found' };
      }

      const paperTypeCode = session.paperType?.code || 'JOURNAL_ARTICLE';
      const blueprint = await blueprintService.getBlueprint(sessionId);
      const methodologyType = (blueprint as any)?.methodologyType || null;
      const blueprintVersion = blueprint?.version || 1;
      const bgPass1Concurrency = clampBgPass1Concurrency(DEFAULT_BG_PASS1_CONCURRENCY);
      const llmRequestContext = tenantContext ? { tenantContext } : { headers: {} };

      // Fire Pass 1 calls in a bounded worker pool (default concurrency: 10)
      await runWithConcurrency(generationOrder, bgPass1Concurrency, async (sectionKey) => {
        try {
          progress.sections[sectionKey] = 'running';
          await this.flushBgProgress(sessionId, progress);

          const existing = await prisma.paperSection.findUnique({
            where: { sessionId_sectionKey: { sessionId, sectionKey } }
          });

          // Skip sections that are actively mutating. In force-rerun mode we still
          // refresh Pass 1 base content for finalized sections (DRAFT/REVIEWED/APPROVED)
          // without changing their visible content/status.
          const activeMutationStatuses = ['POLISHING', 'REGENERATING'] as const;
          const finalizedStatuses = ['DRAFT', 'REVIEWED', 'APPROVED'] as const;
          const refreshBaseOnly = Boolean(
            forceRerun &&
            existing &&
            finalizedStatuses.includes(existing.status as any)
          );
          if (
            (!forceRerun && existing && (
              (readStoredPass1Content(existing) && existing.status === 'BASE_READY' && !existing.isStale)
              || finalizedStatuses.includes(existing.status as any)
            ))
            || (existing && activeMutationStatuses.includes(existing.status as any))
          ) {
            progress.sections[sectionKey] = 'done';
            progress.completed++;
            return;
          }

          const blueprintContext = await blueprintService.getSectionContext(sessionId, sectionKey);
          if (!blueprintContext) {
            throw new Error(`Section ${sectionKey} not in blueprint`);
          }

          const figureSelection = figureSelections[normalizeSectionKey(sectionKey)] || {};
          const figurePromptContext = supportsPass1FigureInjection(sectionKey) && figureSelection.useFigures
            ? await loadFigurePromptContext({
                sessionId,
                sectionKey,
                useFigures: true,
                selectedFigureIds: figureSelection.selectedFigureIds,
                requestHeaders: options?.requestHeaders,
                waitForPendingMetadata: true,
              })
            : null;

          // No previous memories in parallel mode — traded for speed
          const { prompt } = await this.buildSectionPromptWithDebug(
            blueprintContext,
            [],
            session.researchTopic,
            paperTypeCode,
            methodologyType,
            undefined,
            undefined,
            sessionId,
            sectionKey,
            tenantContext || undefined,
            figurePromptContext
          );

          // Mark section as PREPARING unless we are only refreshing Pass 1 base
          // for an already visible/finalized section.
          if (!refreshBaseOnly) {
            await this.upsertSection(sessionId, sectionKey, {
              sectionKey,
              displayName: SECTION_DISPLAY_NAMES[sectionKey] || sectionKey,
              content: '',
              wordCount: 0,
              generationMode: 'two_pass',
              status: 'PREPARING' as PaperSectionStatus,
              isStale: false,
              generatedAt: new Date(),
            }, existing);
          }

          const result = await llmGateway.executeLLMOperation(
            llmRequestContext,
            {
              taskCode: 'LLM2_DRAFT',
              stageCode: 'PAPER_SECTION_DRAFT',
              prompt,
              parameters: { purpose: 'paper_section_pass1_bg', temperature: 0.65 },
              idempotencyKey: crypto.randomUUID(),
              metadata: { sessionId, sectionKey, purpose: 'paper_section_pass1_bg' }
            }
          );

          if (!result.success || !result.response) {
            throw new Error(result.error?.message || 'LLM call failed');
          }

          let parsed = this.parseSectionResponse(result.response.output);
          parsed = {
            ...parsed,
            content: await this.enforceCitationBudgetValidator({
              sessionId,
              sectionKey,
              content: parsed.content,
              llmRequestContext,
              purpose: 'paper_section_pass1_bg_citation_budget_rewrite'
            })
          };
          const pass1CompletedAt = new Date();
          const pass1Artifact = buildStoredPass1Artifact({
            content: parsed.content,
            memory: parsed.memory,
            generatedAt: pass1CompletedAt,
            promptUsed: prompt,
            tokensUsed: result.response.outputTokens,
            figureGrounding: buildPass1FigureGroundingSnapshot(figurePromptContext)
          });

          await prisma.paperSection.update({
            where: { sessionId_sectionKey: { sessionId, sectionKey } },
            data: refreshBaseOnly
              ? {
                baseContentInternal: parsed.content,
                baseMemory: parsed.memory as any,
                pass1Artifact: pass1Artifact as any,
                memory: parsed.memory as any,
                blueprintVersion,
                pass1PromptUsed: prompt,
                pass1LlmResponse: result.response.output,
                pass1TokensUsed: result.response.outputTokens,
                pass1CompletedAt,
                isStale: false,
              }
              : {
                baseContentInternal: parsed.content,
                baseMemory: parsed.memory as any,
                pass1Artifact: pass1Artifact as any,
                memory: parsed.memory as any,
                content: existing?.content || '',
                wordCount: existing?.content ? this.countWords(existing.content) : 0,
                blueprintVersion,
                pass1PromptUsed: prompt,
                pass1LlmResponse: result.response.output,
                pass1TokensUsed: result.response.outputTokens,
                pass1CompletedAt,
                status: 'BASE_READY' as PaperSectionStatus,
                generatedAt: pass1CompletedAt,
              }
          });

          progress.sections[sectionKey] = 'done';
          progress.completed++;
        } catch (err) {
          console.error(`[BgGen] Pass 1 failed for ${sectionKey}:`, err);
          progress.sections[sectionKey] = 'failed';
          progress.failed++;
        }
      });

      const finalStatus = progress.failed === 0
        ? 'COMPLETED'
        : progress.completed > 0
          ? 'PARTIAL'
          : 'FAILED';
      await this.updateBgGenStatus(sessionId, finalStatus, progress);

      return { success: progress.failed === 0, progress };
    } catch (error) {
      console.error('[BgGen] runParallelPass1 error:', error);
      await this.updateBgGenStatus(sessionId, 'FAILED', progress);
      return { success: false, progress, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get background generation status for a session.
   */
  async getBackgroundGenStatus(sessionId: string): Promise<{
    status: string;
    progress: BackgroundGenProgress | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }> {
    const session = await prisma.draftingSession.findUnique({
      where: { id: sessionId },
      select: { bgGenStatus: true, bgGenStartedAt: true, bgGenCompletedAt: true, bgGenProgress: true }
    });
    return {
      status: session?.bgGenStatus || 'IDLE',
      progress: (session?.bgGenProgress as unknown as BackgroundGenProgress) || null,
      startedAt: session?.bgGenStartedAt || null,
      completedAt: session?.bgGenCompletedAt || null,
    };
  }

  private async updateBgGenStatus(sessionId: string, status: string, progress: BackgroundGenProgress) {
    await prisma.draftingSession.update({
      where: { id: sessionId },
      data: {
        bgGenStatus: status,
        bgGenCompletedAt: status !== 'RUNNING' ? new Date() : undefined,
        bgGenProgress: progress as any,
      }
    });
  }

  private async flushBgProgress(sessionId: string, progress: BackgroundGenProgress) {
    await prisma.draftingSession.update({
      where: { id: sessionId },
      data: { bgGenProgress: progress as any }
    }).catch(() => { /* non-critical */ });
  }

  private async upsertSection(
    sessionId: string,
    sectionKey: string,
    data: Record<string, any>,
    existing: PaperSection | null
  ): Promise<PaperSection> {
    if (existing) {
      return prisma.paperSection.update({
        where: { sessionId_sectionKey: { sessionId, sectionKey } },
        data: { ...data, version: { increment: 1 } }
      });
    }
    return prisma.paperSection.create({
      data: { sessionId, ...data } as any
    });
  }

  /**
   * Get a section by key
   */
  async getSection(sessionId: string, sectionKey: string): Promise<PaperSectionWithMemory | null> {
    const section = await prisma.paperSection.findUnique({
      where: { sessionId_sectionKey: { sessionId, sectionKey } }
    });

    if (!section) {
      return null;
    }

    return this.transformSection(section);
  }

  /**
   * Get all sections for a session
   */
  async getAllSections(sessionId: string): Promise<PaperSectionWithMemory[]> {
    const sections = await prisma.paperSection.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' }
    });

    return sections.map(s => this.transformSection(s));
  }

  /**
   * Update section content (manual edit)
   */
  async updateSectionContent(
    sessionId: string,
    sectionKey: string,
    content: string
  ): Promise<PaperSectionWithMemory | null> {
    const section = await prisma.paperSection.findUnique({
      where: { sessionId_sectionKey: { sessionId, sectionKey } }
    });

    if (!section) {
      return null;
    }

    const polishedContent = polishDraftMarkdown(content);

    // When content is manually edited, we should re-extract memory
    // For now, mark memory as potentially stale
    const updated = await prisma.paperSection.update({
      where: { sessionId_sectionKey: { sessionId, sectionKey } },
      data: {
        content: polishedContent,
        wordCount: this.countWords(polishedContent),
        status: 'DRAFT',
        version: { increment: 1 }
      }
    });

    return this.transformSection(updated);
  }

  /**
   * Re-extract memory from section content
   * (Used after manual edits)
   */
  async reExtractMemory(
    sessionId: string,
    sectionKey: string,
    tenantContext?: TenantContext | null
  ): Promise<PaperSectionWithMemory | null> {
    const section = await prisma.paperSection.findUnique({
      where: { sessionId_sectionKey: { sessionId, sectionKey } }
    });

    if (!section) {
      return null;
    }

    // Build memory extraction prompt
    const prompt = this.buildMemoryExtractionPrompt(section.content, sectionKey);

    const result = await llmGateway.executeLLMOperation(
      tenantContext ? { tenantContext } : { headers: {} },
      {
        taskCode: 'LLM2_DRAFT',
        stageCode: 'PAPER_MEMORY_EXTRACT',
        prompt,
        // maxTokensOut is controlled via super admin LLM config for PAPER_MEMORY_EXTRACT stage
        parameters: {
          purpose: 'memory_extraction',
          temperature: 0.2,
        },
        idempotencyKey: crypto.randomUUID(),
        metadata: {
          sessionId,
          sectionKey,
          purpose: 'memory_extraction'
        }
      }
    );

    if (!result.success || !result.response) {
      console.error('Memory extraction failed:', result.error);
      return this.transformSection(section);
    }

    const memory = this.parseMemoryResponse(result.response.output);

    const updated = await prisma.paperSection.update({
      where: { sessionId_sectionKey: { sessionId, sectionKey } },
      data: { memory: memory as any }
    });

    return this.transformSection(updated);
  }

  /**
   * Mark section as approved
   */
  async approveSection(sessionId: string, sectionKey: string): Promise<PaperSectionWithMemory | null> {
    const section = await prisma.paperSection.findUnique({
      where: { sessionId_sectionKey: { sessionId, sectionKey } }
    });

    if (!section) {
      return null;
    }

    const updated = await prisma.paperSection.update({
      where: { sessionId_sectionKey: { sessionId, sectionKey } },
      data: { status: 'APPROVED' }
    });

    return this.transformSection(updated);
  }

  /**
   * Get generation order for sections based on dependencies
   */
  async getSectionGenerationOrder(sessionId: string): Promise<string[]> {
    const blueprint = await blueprintService.getBlueprint(sessionId);
    if (!blueprint) {
      return [];
    }

    // Topological sort based on dependencies
    const sections = blueprint.sectionPlan;
    const order: string[] = [];
    const visited = new Set<string>();
    const temp = new Set<string>();

    const visit = (sectionKey: string) => {
      if (visited.has(sectionKey)) return;
      if (temp.has(sectionKey)) {
        throw new Error(`Circular dependency detected: ${sectionKey}`);
      }

      temp.add(sectionKey);

      const section = sections.find(s => s.sectionKey === sectionKey);
      if (section) {
        for (const dep of section.dependencies) {
          if (sections.some(s => s.sectionKey === dep)) {
            visit(dep);
          }
        }
      }

      temp.delete(sectionKey);
      visited.add(sectionKey);
      order.push(sectionKey);
    };

    for (const section of sections) {
      visit(section.sectionKey);
    }

    return order;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Fetch user's section instructions from database
   * Checks in order of specificity:
   * 1. Session-level + paper-type-specific
   * 2. Session-level + universal
   * 3. User-level + paper-type-specific
   * 4. User-level + universal
   */
  private async getUserSectionInstructions(
    userId: string,
    sessionId: string,
    sectionKey: string,
    paperTypeCode?: string
  ): Promise<UserSectionInstructionData | null> {
    try {
      const normalizedType = paperTypeCode?.toUpperCase();

      // 1. Session-level + paper-type-specific
      if (normalizedType) {
        const sessionTypeSpecific = await prisma.userSectionInstruction.findFirst({
          where: {
            userId,
            sessionId,
            sectionKey,
            paperTypeCode: normalizedType,
            isActive: true
          }
        });
        if (sessionTypeSpecific) {
          return this.mapInstructionToData(sessionTypeSpecific);
        }
      }

      // 2. Session-level + universal (any paper type)
      const sessionUniversal = await prisma.userSectionInstruction.findFirst({
        where: {
          userId,
          sessionId,
          sectionKey,
          OR: [
            { paperTypeCode: '*' },
            { paperTypeCode: null }
          ],
          isActive: true
        }
      });
      if (sessionUniversal) {
        return this.mapInstructionToData(sessionUniversal);
      }

      // 3. User-level + paper-type-specific
      if (normalizedType) {
        const userTypeSpecific = await prisma.userSectionInstruction.findFirst({
          where: {
            userId,
            sessionId: null,
            sectionKey,
            paperTypeCode: normalizedType,
            isActive: true
          }
        });
        if (userTypeSpecific) {
          return this.mapInstructionToData(userTypeSpecific);
        }
      }

      // 4. User-level + universal
      const userUniversal = await prisma.userSectionInstruction.findFirst({
        where: {
          userId,
          sessionId: null,
          sectionKey,
          OR: [
            { paperTypeCode: '*' },
            { paperTypeCode: null }
          ],
          isActive: true
        }
      });
      if (userUniversal) {
        return this.mapInstructionToData(userUniversal);
      }

      return null;
    } catch (error) {
      console.error('Failed to fetch user section instructions:', error);
      return null;
    }
  }

  private mapInstructionToData(instruction: any): UserSectionInstructionData {
    return {
      instruction: instruction.instruction,
      emphasis: instruction.emphasis || undefined,
      avoid: instruction.avoid || undefined,
      style: instruction.style || undefined,
      wordCount: instruction.wordCount || undefined
    };
  }

  /**
   * Format user instructions into a readable block for the prompt
   */
  private formatUserInstructions(data: UserSectionInstructionData): string {
    const parts: string[] = [];

    if (data.instruction) {
      parts.push(`MAIN INSTRUCTION:\n${data.instruction}`);
    }

    if (data.emphasis) {
      parts.push(`EMPHASIZE:\n${data.emphasis}`);
    }

    if (data.avoid) {
      parts.push(`AVOID:\n${data.avoid}`);
    }

    if (data.style) {
      parts.push(`WRITING STYLE: ${data.style}`);
    }

    if (data.wordCount) {
      parts.push(`TARGET WORD COUNT: ~${data.wordCount} words`);
    }

    return parts.join('\n\n');
  }

  private async getPreviousSectionMemories(
    sessionId: string,
    currentSectionKey: string
  ): Promise<PreviousSectionSummary[]> {
    const blueprint = await blueprintService.getBlueprint(sessionId);
    if (!blueprint) {
      return [];
    }

    // Get the current section's dependencies
    const currentPlan = blueprint.sectionPlan.find(s => s.sectionKey === currentSectionKey);
    const dependencies = currentPlan?.dependencies || [];

    // Get sections that should come before this one
    const generationOrder = await this.getSectionGenerationOrder(sessionId);
    const currentIndex = generationOrder.indexOf(currentSectionKey);
    const previousKeys = currentIndex > 0 ? generationOrder.slice(0, currentIndex) : [];

    // Get sections with memory
    const sections = await prisma.paperSection.findMany({
      where: {
        sessionId,
        sectionKey: { in: previousKeys },
        memory: { not: null as any }
      }
    });

    // Sort by generation order
    const sortedSections = previousKeys
      .map(key => sections.find(s => s.sectionKey === key))
      .filter((s): s is PaperSection => s !== null && s !== undefined);

    return sortedSections.map(s => ({
      sectionKey: s.sectionKey,
      displayName: SECTION_DISPLAY_NAMES[s.sectionKey] || s.sectionKey,
      memory: s.memory as any as SectionMemory
    }));
  }

  private async getPass1EvidencePromptContext(
    sessionId?: string,
    sectionKey?: string
  ): Promise<Pass1EvidencePromptContext> {
    if (!sessionId || !sectionKey) {
      return {
        useMappedEvidence: false,
        allowedCitationKeys: [],
        dimensionEvidence: [],
        gaps: [],
        coverageAssignments: [],
        evidenceDigest: { digests: [], mustCiteKeys: [], optionalCiteKeys: [] },
      };
    }

    try {
      const evidencePack = await evidencePackService.getEvidencePack(sessionId, sectionKey);
      const coverageKeys = (evidencePack.coverageAssignments || [])
        .map(assignment => String(assignment.citationKey || '').trim())
        .filter(Boolean);
      const allowedCitationKeys = Array.from(
        new Set([
          ...(evidencePack.allowedCitationKeys || []).map(key => String(key || '').trim()).filter(Boolean),
          ...coverageKeys
        ])
      );

      return {
        useMappedEvidence: evidencePack.hasBlueprint
          && (evidencePack.dimensionEvidence.length > 0 || (evidencePack.coverageAssignments?.length || 0) > 0)
          && allowedCitationKeys.length > 0,
        allowedCitationKeys,
        dimensionEvidence: evidencePack.dimensionEvidence || [],
        gaps: evidencePack.gaps || [],
        coverageAssignments: evidencePack.coverageAssignments || [],
        evidenceDigest: evidencePack.evidenceDigest,
      };
    } catch (error) {
      console.warn(`[PaperSectionService] Failed to load evidence pack for ${sectionKey}:`, error);
      return {
        useMappedEvidence: false,
        allowedCitationKeys: [],
        dimensionEvidence: [],
        gaps: [],
        coverageAssignments: [],
        evidenceDigest: { digests: [], mustCiteKeys: [], optionalCiteKeys: [] },
      };
    }
  }

  /**
   * Build section prompt with debug information
   */
  private async buildSectionPromptWithDebug(
    blueprintContext: BlueprintContext,
    previousMemories: PreviousSectionSummary[],
    researchTopic: any,
    paperTypeCode: string,
    methodologyType: string | null,
    userInstructions?: string,
    writingStyleBlock?: string,
    sessionId?: string,
    sectionKey?: string,
    tenantContext?: TenantContext,
    figurePromptContext?: FigurePromptContext | null
  ): Promise<{ prompt: string; debugInfo: PromptDebugInfo | null }> {
    const { thesisStatement, centralObjective, keyContributions, currentSection, preferredTerms } = blueprintContext;

    // Track components for debug
    const debugComponents: {
      basePrompt: string;
      paperTypeOverride?: string;
      methodologyConstraints?: string;
      blueprintContext?: string;
      intentLock?: string;
      rhetoricalBlueprint?: string;
      argumentPlan?: string;
      figureGrounding?: string;
      previousMemories?: string;
      preferredTerms?: string;
      writingPersona?: string;
      userInstructions?: string;
    } = { basePrompt: '' };

    // Pass 1: base section prompt only — paper-type-specific guidance is
    // deferred to Pass 2 (the polish pipeline reads it from the database).
    let basePrompt = '';
    try {
      basePrompt = await sectionTemplateService.getPass1PromptForSection(
        currentSection.sectionKey,
        { researchTopic }
      );
      debugComponents.basePrompt = basePrompt;
    } catch (e) {
      basePrompt = `Write the ${currentSection.sectionKey} section for an academic paper.`;
      debugComponents.basePrompt = basePrompt;
    }

    // Inject evidence-pack placeholders and build fallback evidence blocks.
    const citationBudgetValidatorEnabled = isFeatureEnabled('ENABLE_CITATION_BUDGET_VALIDATOR');
    const hasCitationModePlaceholders = /\{\{AUTO_CITATION_MODE\}\}|\{\{ALLOWED_CITATION_KEYS\}\}/.test(basePrompt);
    const hasEvidencePlaceholders = /\{\{DIMENSION_EVIDENCE_NOTES\}\}|\{\{RELEVANCE_NOTES\}\}|\{\{EVIDENCE_GAPS\}\}|\{\{EVIDENCE_DIGEST\}\}/.test(basePrompt);
    const hasDigestPlaceholders = /\{\{RELEVANCE_NOTES\}\}|\{\{EVIDENCE_DIGEST\}\}/.test(basePrompt);
    const hasCoveragePlaceholders = /\{\{CITATION_COVERAGE_ASSIGNMENTS\}\}|\{\{CITATION_BUDGET_RULES\}\}/.test(basePrompt);
    const evidenceContext = await this.getPass1EvidencePromptContext(sessionId, currentSection.sectionKey);
    const autoCitationMode = evidenceContext.useMappedEvidence ? 'ON' : 'OFF';
    const allowedKeys = evidenceContext.allowedCitationKeys.length > 0
      ? evidenceContext.allowedCitationKeys.join(', ')
      : '(none)';
    const dimensionEvidenceNotes = citationBudgetValidatorEnabled
      ? ''
      : (
        evidenceContext.dimensionEvidence.length > 0
          ? formatDimensionEvidence(evidenceContext.dimensionEvidence)
          : '(no evidence pack available)'
      );
    const evidenceDigestBlock = evidenceContext.evidenceDigest.digests.length > 0
      ? formatEvidenceDigest(evidenceContext.evidenceDigest)
      : '(no evidence digest available)';
    const evidenceGaps = evidenceContext.gaps.length > 0
      ? evidenceContext.gaps.join('; ')
      : '(none detected)';
    const citationBudgetBlock = evidenceContext.evidenceDigest.digests.length > 0
      ? formatCitationBudgetRules(evidenceContext.evidenceDigest)
      : '(no citation budget rules)';

    // Replace both new and legacy placeholders for backward compatibility
    basePrompt = basePrompt.replace(/\{\{AUTO_CITATION_MODE\}\}/g, autoCitationMode);
    basePrompt = basePrompt.replace(/\{\{ALLOWED_CITATION_KEYS\}\}/g, allowedKeys);
    basePrompt = basePrompt.replace(/\{\{DIMENSION_EVIDENCE_NOTES\}\}/g, dimensionEvidenceNotes);
    basePrompt = basePrompt.replace(/\{\{RELEVANCE_NOTES\}\}/g, evidenceDigestBlock);
    basePrompt = basePrompt.replace(/\{\{EVIDENCE_DIGEST\}\}/g, evidenceDigestBlock);
    basePrompt = basePrompt.replace(/\{\{EVIDENCE_GAPS\}\}/g, evidenceGaps);
    basePrompt = basePrompt.replace(/\{\{CITATION_COVERAGE_ASSIGNMENTS\}\}/g, citationBudgetBlock);
    basePrompt = basePrompt.replace(/\{\{CITATION_BUDGET_RULES\}\}/g, citationBudgetBlock);

    const citationModeFallbackBlock = !hasCitationModePlaceholders
      ? `AUTO_CITATION_MODE: ${autoCitationMode}
ALLOWED_CITATION_KEYS: ${allowedKeys}

Citation Rules:
- Use inline citations in [CITE:key] format only.
- Never output [CITATION_NEEDED] placeholders.
- Do not invent keys; use only ALLOWED_CITATION_KEYS when mode is ON.
- If mode is OFF and no valid key applies, write the claim without citation.`
      : '';

    const evidenceFallbackBody = citationBudgetValidatorEnabled
      ? evidenceDigestBlock
      : (dimensionEvidenceNotes || evidenceDigestBlock);
    const evidenceFallbackBlock = evidenceContext.useMappedEvidence
      && evidenceContext.evidenceDigest.digests.length > 0
      && (citationBudgetValidatorEnabled ? !hasDigestPlaceholders : !hasEvidencePlaceholders)
      ? `${evidenceFallbackBody}

EVIDENCE GAPS:
${evidenceGaps}`
      : '';
    const coverageFallbackBlock = evidenceContext.useMappedEvidence
      && evidenceContext.evidenceDigest.digests.length > 0
      && !hasCoveragePlaceholders
      ? citationBudgetBlock
      : '';
    const figureContextBlockText = sectionKey
      ? formatSelectedFigureContext(
          figurePromptContext || { useFigures: false, selectedFigureIds: [], figures: [], effectiveFigureIds: [], waitedForMetadata: false },
          sectionKey
        )
      : '';
    const figureGroundingFallback = `FIGURE GROUNDING RULES:
- Use only the figure metadata supplied below; do not infer visual details beyond it.
- Mention figures only when they materially support the section's claims.
- Refer to them only as [Figure N].
- Do not output markdown image syntax, raw URLs, or invented figure numbers.
- Place [Figure N] inline in the sentence or clause that is grounded by that figure.
- In Methodology, use figures only for setup, architecture, flow, instrumentation, or procedure details.
- In Results, prioritize numeric highlights, observed patterns, compared groups, and results-ready details.
- In Discussion, interpret only patterns already grounded in the selected figures or reported results.
- Treat claimsToAvoid as hard exclusions.`;
    const figureGroundingBlock = figureContextBlockText && sectionKey
      ? await systemPromptTemplateService.resolveWithFallback(
          {
            templateKey: TEMPLATE_KEYS.FIGURE_GROUNDING_BLOCK,
            applicationMode: 'paper',
            sectionScope: sectionKey,
            paperTypeScope: paperTypeCode
          },
          figureGroundingFallback
        )
      : '';
    if (figureContextBlockText) {
      debugComponents.figureGrounding = `${figureGroundingBlock}\n\n${figureContextBlockText}`.trim();
    }

    // Tier 2: Generate ResearchIntentLock + ArgumentPlan (gated by ENABLE_ARGUMENT_PLAN)
    let intentLockBlock = '';
    let rhetoricalBlock = '';
    let argumentPlanBlock = '';
    let intentLock: ResearchIntentLock | null = null;
    const rhetoricalBlueprintEnabled = isFeatureEnabled('ENABLE_RHETORICAL_BLUEPRINT');
    const argumentPlanEnabled = isFeatureEnabled('ENABLE_ARGUMENT_PLAN');

    if ((argumentPlanEnabled || rhetoricalBlueprintEnabled) && sessionId && sectionKey && tenantContext) {
      try {
        intentLock = await researchIntentLockService.getOrCreateIntentLock(sessionId, tenantContext);
        if (intentLock) {
          intentLockBlock = researchIntentLockService.formatForPrompt(intentLock);
          debugComponents.intentLock = intentLockBlock;
        }
      } catch (e) {
        console.warn('[PaperSectionService] Tier 2 generation failed (non-fatal):', e);
      }
    }

    if (rhetoricalBlueprintEnabled) {
      rhetoricalBlock = buildRhetoricalPromptBlock({
        sectionKey: currentSection.sectionKey,
        rhetoricalBlueprint: currentSection.rhetoricalBlueprint,
        researchIntentLock: intentLock,
        fallbackContributions: keyContributions
      });
      if (rhetoricalBlock) {
        debugComponents.rhetoricalBlueprint = rhetoricalBlock;
      }
    }

    if (argumentPlanEnabled && sessionId && sectionKey && tenantContext) {
      try {
        const argumentPlan = await argumentPlannerService.buildArgumentPlan(
          sessionId,
          sectionKey,
          evidenceContext.evidenceDigest,
          intentLock,
          tenantContext
        );
        if (argumentPlan) {
          argumentPlanBlock = argumentPlannerService.formatForPrompt(argumentPlan);
          debugComponents.argumentPlan = argumentPlanBlock;
        }
      } catch (e) {
        console.warn('[PaperSectionService] Argument plan generation failed (non-fatal):', e);
      }
    }

    // Get methodology-specific constraints to inject
    const methodologyBlock = getMethodologyConstraints(methodologyType, currentSection.sectionKey);
    if (methodologyBlock) {
      debugComponents.methodologyConstraints = methodologyBlock;
    }

    // Build previous sections summary
    let previousSectionsSummary = '';
    if (previousMemories.length > 0) {
      previousSectionsSummary = previousMemories.map(pm => `
### ${pm.displayName}
- Key Points: ${pm.memory.keyPoints.join('; ')}
- Terms Introduced: ${pm.memory.termsIntroduced.join(', ')}
- Claims Made: ${pm.memory.mainClaims.join('; ')}
${pm.memory.forwardReferences.length > 0 ? `- Promises: ${pm.memory.forwardReferences.join('; ')}` : ''}`
      ).join('\n');
      debugComponents.previousMemories = previousSectionsSummary;
    }

    // Build preferred terms block
    let termsBlock = '';
    if (Object.keys(preferredTerms).length > 0) {
      termsBlock = Object.entries(preferredTerms)
        .map(([term, def]) => `- ${term}: ${def}`)
        .join('\n');
      debugComponents.preferredTerms = termsBlock;
    }

    // Build blueprint context for debug
    debugComponents.blueprintContext = `Thesis: ${thesisStatement}\nObjective: ${centralObjective}\nContributions: ${keyContributions.join('; ')}\nSection Purpose: ${currentSection.purpose}\nEvidence: mode=${autoCitationMode}, allowedKeys=${evidenceContext.allowedCitationKeys.length}, dimensions=${evidenceContext.dimensionEvidence.length}, coverageAssignments=${evidenceContext.coverageAssignments.length}, gaps=${evidenceContext.gaps.length}`;

    // Track writing style and user instructions for debug
    if (writingStyleBlock) {
      debugComponents.writingPersona = writingStyleBlock;
    }
    if (userInstructions) {
      debugComponents.userInstructions = userInstructions;
    }

    // Resolve intellectual rigor block from DB (falls back to hardcoded default)
    const FALLBACK_RIGOR = `═══════════════════════════════════════════════════════════════════════════════
INTELLECTUAL RIGOR & ANALYTICAL DEPTH
═══════════════════════════════════════════════════════════════════════════════
NOVELTY FRAMING
- Frame contributions as resolving a specific limitation, tension, or contested assumption.
- State clearly what prior work could not achieve — this is the foundation of your argument.
- If noveltyType = TRANSLATIONAL: frame as validation, feasibility, adaptation, or contextual testing.

ANALYTICAL LITERATURE
- Organize by analytical themes — synthesize, compare, and contrast across sources.
- Use positional relations to structure arguments: cite what reinforces, contradicts, extends, or qualifies your claims.
- Surface boundary conditions when they strengthen analytical depth.

EVIDENCE-CALIBRATED CONFIDENCE
- Strong evidence → confident language ("demonstrates", "confirms", "establishes")
- Moderate evidence → calibrated language ("suggests", "is consistent with", "indicates")
- Limited evidence → appropriately hedged ("one interpretation", "preliminary findings suggest")
- Distinguish between cited findings, your findings, and analytical inferences.
- Treat "Not extracted from source" as absence of extracted evidence, not evidence of absence.

METHODOLOGY POSITIONING
- Justify chosen approach relative to at least one named alternative.
- State assumptions and constraints transparently — this builds reviewer trust.

ARGUMENT CRAFT
- Vary paragraph structures and sentence lengths — monotony signals shallow thinking.
- Include genuine analytical tension where evidence supports it — tension is depth, not weakness.
- Mix short analytical pivots with longer evidence-grounded paragraphs.

COHERENCE RULES (Always Apply)
═══════════════════════════════════════════════════════════════════════════════
1. Support the thesis statement in all assertions
2. Maintain terminological consistency with previous sections
3. Reference previous sections naturally where appropriate
4. Explicitly discuss evidence mapped as CONTRAST — this is where analytical depth lives
5. Clearly distinguish YOUR claims from CITED claims
6. Strong claims require supporting evidence; acknowledge gaps where they exist`;

    const [intellectualRigorBlock, persuasionBlock, reviewerLensBlock] = await Promise.all([
      systemPromptTemplateService.resolveWithFallback(
        { templateKey: TEMPLATE_KEYS.INTELLECTUAL_RIGOR_BLOCK, applicationMode: 'paper', sectionScope: sectionKey },
        FALLBACK_RIGOR
      ),
      systemPromptTemplateService.resolveWithFallback(
        { templateKey: TEMPLATE_KEYS.PERSUASION_BLOCK, applicationMode: 'paper', sectionScope: sectionKey },
        ''
      ),
      systemPromptTemplateService.resolveWithFallback(
        { templateKey: TEMPLATE_KEYS.REVIEWER_LENS, applicationMode: 'paper', sectionScope: sectionKey },
        ''
      ),
    ]);

    // Build prompt with EXPLICIT PRIORITY ORDERING
    // Priority: Lower numbers = lower priority, Higher numbers = higher priority
    // When contradictions exist, HIGHER PRIORITY WINS

    const effectiveSectionKey = sectionKey || currentSection.sectionKey || 'manuscript';
    const controlledWordBudget = applyLengthControlToWordBudget(
      effectiveSectionKey,
      currentSection.wordBudget
    );

    const prompt = `
╔═══════════════════════════════════════════════════════════════════════════════╗
║  PROMPT PRIORITY GUIDE                                                        ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  Priority increases from top to bottom. When instructions conflict:           ║
║  • Later sections OVERRIDE earlier sections                                   ║
║  • User instructions have HIGHEST priority                                    ║
║  • Writing style preferences override generic academic style                  ║
╚═══════════════════════════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════════════════════════
[PRIORITY 1 - BASE] SECTION WRITING TASK
═══════════════════════════════════════════════════════════════════════════════
${basePrompt}

═══════════════════════════════════════════════════════════════════════════════
[PRIORITY 2 - CONTEXT] PAPER BLUEPRINT (Frozen Plan)
═══════════════════════════════════════════════════════════════════════════════
Thesis Statement: ${thesisStatement}

Central Objective: ${centralObjective}

Key Contributions:
${keyContributions.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Section: ${currentSection.sectionKey}
Purpose: ${currentSection.purpose}

MUST COVER (Required):
${currentSection.mustCover.map(c => `✓ ${c}`).join('\n')}

MUST AVOID (Prevent duplication):
${currentSection.mustAvoid.map(c => `✗ ${c}`).join('\n')}

${controlledWordBudget
  ? `Word Budget: ~${controlledWordBudget} words`
  : ''}

${citationModeFallbackBlock ? `
[PRIORITY 2.5 - CITATION MODE] SECTION CITATION CONTROL
${citationModeFallbackBlock}
` : ''}
${intentLockBlock ? `
[PRIORITY 2.55 - RESEARCH INTENT LOCK] THESIS GUARDRAILS
${intentLockBlock}
` : ''}
${rhetoricalBlock ? `
${rhetoricalBlock}
` : ''}

${evidenceFallbackBlock ? `
[PRIORITY 2.6 - EVIDENCE PACK] DIMENSION MAPPINGS, RELEVANCE, AND GAPS
${evidenceFallbackBlock}
` : ''}
${coverageFallbackBlock ? `
[PRIORITY 2.7 - CITATION COVERAGE] CITATION BUDGET RULES
${coverageFallbackBlock}
` : ''}
${figureContextBlockText ? `
[PRIORITY 2.75 - FIGURE GROUNDING] SELECTED FIGURES
${figureGroundingBlock}

${figureContextBlockText}
` : ''}
${argumentPlanBlock ? `
[PRIORITY 2.8 - ARGUMENT PLAN] SECTION OUTLINE (follow this structure)
${argumentPlanBlock}
` : ''}
${previousSectionsSummary ? `
═══════════════════════════════════════════════════════════════════════════════
[PRIORITY 3 - CONTINUITY] PREVIOUS SECTIONS MEMORY
═══════════════════════════════════════════════════════════════════════════════
${previousSectionsSummary}
` : ''}

${termsBlock ? `
═══════════════════════════════════════════════════════════════════════════════
[PRIORITY 4 - TERMINOLOGY] PREFERRED TERMS (Use These Exact Terms)
═══════════════════════════════════════════════════════════════════════════════
${termsBlock}
` : ''}

${methodologyBlock ? `
═══════════════════════════════════════════════════════════════════════════════
[PRIORITY 5 - METHODOLOGY] ${methodologyType?.toUpperCase() || 'GENERAL'} REQUIREMENTS
═══════════════════════════════════════════════════════════════════════════════
These methodology-specific requirements OVERRIDE generic section guidance.
${methodologyBlock}
` : ''}

${writingStyleBlock ? `
═══════════════════════════════════════════════════════════════════════════════
[PRIORITY 6 - STYLE] YOUR WRITING PERSONA (Override Generic Style)
═══════════════════════════════════════════════════════════════════════════════
${writingStyleBlock}
` : ''}

${userInstructions ? `
═══════════════════════════════════════════════════════════════════════════════
[PRIORITY 7 - HIGHEST] USER INSTRUCTIONS (OVERRIDE EVERYTHING ABOVE)
═══════════════════════════════════════════════════════════════════════════════
⚠️ These instructions have the HIGHEST PRIORITY.
When these conflict with any guidance above, FOLLOW THESE INSTRUCTIONS.

${userInstructions}
` : ''}

${intellectualRigorBlock}

${persuasionBlock ? `
═══════════════════════════════════════════════════════════════════════════════
[QUALITY STANDARD] ARGUMENTATIVE QUALITY — Q1 JOURNAL STANDARD
═══════════════════════════════════════════════════════════════════════════════
${persuasionBlock}
` : ''}

${reviewerLensBlock ? `
═══════════════════════════════════════════════════════════════════════════════
[QUALITY STANDARD] REVIEWER EVALUATION CRITERIA
═══════════════════════════════════════════════════════════════════════════════
${reviewerLensBlock}
` : ''}

═══════════════════════════════════════════════════════════════════════════════
CONTENT STRUCTURE (Use proper academic formatting)
═══════════════════════════════════════════════════════════════════════════════
Your content MUST be well-organized with:

1. SUBSECTION HEADINGS (use ### for subsections):
   - Divide the section into 2-4 logical subsections
   - Example: "### Background and Motivation", "### Problem Formulation"
   
2. BULLET POINTS (use - for unordered, 1. for ordered):
   - Use bullets for: criteria, findings, requirements, comparisons
   - Keep each bullet concise (1-2 sentences)
   - Example: "Key challenges include:\\n- Challenge 1\\n- Challenge 2"

3. PARAGRAPH STRUCTURE:
   - Start subsections with topic sentences
   - Use transition phrases between paragraphs
   - End with summary or bridge to next topic

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT (Return ONLY valid JSON)
═══════════════════════════════════════════════════════════════════════════════

{
  "content": "<section with ### subsections, paragraphs, and bullet points>",
  "memory": {
    "keyPoints": ["point1", "point2", "point3"],
    "termsIntroduced": ["term1", "term2"],
    "mainClaims": ["BACKGROUND: claim1", "GAP: claim2", "THESIS: claim3"],
    "forwardReferences": ["will discuss X in methodology"],
    "sectionIntent": "What this section must accomplish for the paper",
    "openingStrategy": "How the section should open",
    "closingStrategy": "How the section should close or bridge onward",
    "sectionOutline": ["planned subsection 1", "planned subsection 2"],
    "dimensionBriefs": [
      {
        "dimensionKey": "normalized_dimension_key",
        "dimensionLabel": "Exact blueprint dimension label",
        "roleHint": "introduction|body|conclusion|intro_conclusion",
        "sourceSummary": "2-4 sentences summarizing only this dimension's slice of the section draft",
        "claimFocus": ["specific analytical angle"],
        "mustUseCitationKeys": ["citationKey1", "citationKey2"],
        "bridgeToNext": "How this dimension should connect to the next one"
      }
    ]
  }
}

CONTENT FIELD RULES:
- Use ### for subsection headings (2-4 per section)
- Use - for bullet lists, 1. for numbered lists
- Use \\n for line breaks
- Write flowing paragraphs for explanations
- Preserve [Figure N] markers exactly when figure grounding is used.
- Use only [Figure N] markers from the supplied figure block.
- Do not emit markdown image syntax or raw image URLs.

MEMORY FIELD RULES:
- keyPoints: 3-5 bullets summarizing what this section covers
- termsIntroduced: Terms FIRST defined in THIS section only
- mainClaims: Key assertions with type prefix (BACKGROUND/GAP/THESIS/METHOD/RESULT)
- forwardReferences: Promises to address something in later sections
- sectionIntent/openingStrategy/closingStrategy: concise downstream guidance for Pass 2 refinement
- sectionOutline: planned subsection flow for the section draft
- dimensionBriefs: align to blueprint mustCover order when available and summarize only that dimension's portion of the draft

⚠️ CRITICAL: Output ONLY raw JSON. No markdown code fences. Start with { and end with }`;

    // Build debug info if debug is enabled
    let debugInfo: PromptDebugInfo | null = null;
    if (isDebugEnabled() && sessionId && sectionKey) {
      debugInfo = buildPromptDebugInfo(
        sessionId,
        sectionKey,
        paperTypeCode,
        methodologyType,
        debugComponents,
        prompt
      );
    }

    return { prompt, debugInfo };
  }

  private extractCitationKeySet(content: string): Set<string> {
    const { keys } = citationValidator.countCitesInText(String(content || ''));
    return new Set(
      keys
        .map((key) => String(key || '').trim())
        .filter(Boolean)
    );
  }

  private extractRewriteContent(output: string): string {
    const raw = String(output || '').trim();
    if (!raw) return '';
    try {
      const parsed = this.parseSectionResponse(raw);
      if (parsed.content?.trim()) {
        return parsed.content;
      }
    } catch {
      // fall through to raw markdown
    }
    return polishDraftMarkdown(raw);
  }

  private async enforceCitationBudgetValidator(params: {
    sessionId: string;
    sectionKey: string;
    content: string;
    llmRequestContext: { tenantContext: TenantContext } | { headers: Record<string, string> };
    purpose: string;
  }): Promise<string> {
    if (!isFeatureEnabled('ENABLE_CITATION_BUDGET_VALIDATOR')) {
      return params.content;
    }

    let currentContent = polishDraftMarkdown(String(params.content || '').trim());
    if (!currentContent) {
      return currentContent;
    }

    const initialCitationKeys = this.extractCitationKeySet(currentContent);
    const evidenceContext = await this.getPass1EvidencePromptContext(params.sessionId, params.sectionKey);
    const mustCiteKeys = evidenceContext.evidenceDigest.mustCiteKeys
      .map((key) => String(key || '').trim())
      .filter((key) => key && initialCitationKeys.has(key));

    const report = citationValidator.validate(currentContent, { mustCiteKeys });

    if (!report.passed) {
      console.warn(
        `[PaperSectionService] Citation budget validator reports lint issues for ${params.sectionKey}; preserving original draft.`,
        report.rewriteDirectives
      );
    }

    return currentContent;
  }

  private buildMemoryExtractionPrompt(content: string, sectionKey: string): string {
    return `Extract a structured memory summary from the following ${sectionKey} section.

═══════════════════════════════════════════════════════════════════════════════
SECTION CONTENT
═══════════════════════════════════════════════════════════════════════════════
${content}

═══════════════════════════════════════════════════════════════════════════════
EXTRACTION TASK
═══════════════════════════════════════════════════════════════════════════════
Extract and return a JSON object with:

{
  "keyPoints": ["point1", "point2", "point3"],
  "termsIntroduced": ["term1", "term2"],
  "mainClaims": ["TYPE: claim1", "TYPE: claim2"],
  "forwardReferences": ["reference1"]
}

FIELD DEFINITIONS:
- keyPoints: 3-5 crisp bullets capturing what this section covers
- termsIntroduced: Technical terms or concepts that are defined/introduced here
- mainClaims: Key assertions made, prefixed with type:
  - BACKGROUND: Facts about the field/domain
  - GAP: What's missing or problematic
  - THESIS: Central argument or position
  - METHOD: Methodological choices
  - RESULT: Findings or observations
  - LIMITATION: Constraints or caveats
- forwardReferences: Promises to cover something in later sections

⚠️ Output ONLY raw JSON. No markdown. Start with { end with }`;
  }

  private parseSectionResponse(output: string): { content: string; memory: SectionMemory } {
    let text = (output || '').trim();

    // Remove code fences if present
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      text = fenceMatch[1].trim();
    }

    // Find JSON object
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');

    if (start === -1 || end === -1 || end < start) {
      // If no JSON found, treat entire output as content with empty memory
      console.warn('No JSON structure found in section response, using raw output as content');
      return {
        content: polishDraftMarkdown(text),
        memory: {
          keyPoints: [],
          termsIntroduced: [],
          mainClaims: [],
          forwardReferences: []
        }
      };
    }

    text = text.slice(start, end + 1);

    try {
      const parsed = JSON.parse(text);

      const content = polishDraftMarkdown(parsed.content || '');
      const dimensionBriefs = Array.isArray(parsed.memory?.dimensionBriefs)
        ? parsed.memory.dimensionBriefs
          .map((entry: any) => ({
            dimensionKey: String(entry?.dimensionKey || '').trim(),
            dimensionLabel: String(entry?.dimensionLabel || '').trim(),
            roleHint: typeof entry?.roleHint === 'string' ? entry.roleHint : undefined,
            sourceSummary: String(entry?.sourceSummary || '').trim(),
            claimFocus: Array.isArray(entry?.claimFocus) ? entry.claimFocus : [],
            mustUseCitationKeys: Array.isArray(entry?.mustUseCitationKeys) ? entry.mustUseCitationKeys : [],
            bridgeToNext: String(entry?.bridgeToNext || '').trim() || undefined
          }))
          .filter((entry: SectionDimensionBrief) => entry.dimensionKey && entry.dimensionLabel && entry.sourceSummary)
        : [];
      const memory: SectionMemory = {
        keyPoints: Array.isArray(parsed.memory?.keyPoints) ? parsed.memory.keyPoints : [],
        termsIntroduced: Array.isArray(parsed.memory?.termsIntroduced) ? parsed.memory.termsIntroduced : [],
        mainClaims: Array.isArray(parsed.memory?.mainClaims) ? parsed.memory.mainClaims : [],
        forwardReferences: Array.isArray(parsed.memory?.forwardReferences) ? parsed.memory.forwardReferences : [],
        sectionIntent: typeof parsed.memory?.sectionIntent === 'string' ? parsed.memory.sectionIntent.trim() : undefined,
        openingStrategy: typeof parsed.memory?.openingStrategy === 'string' ? parsed.memory.openingStrategy.trim() : undefined,
        closingStrategy: typeof parsed.memory?.closingStrategy === 'string' ? parsed.memory.closingStrategy.trim() : undefined,
        sectionOutline: Array.isArray(parsed.memory?.sectionOutline) ? parsed.memory.sectionOutline : [],
        dimensionBriefs
      };

      return { content, memory };
    } catch (error) {
      console.error('Section parse error:', error);
      console.error('Raw output:', output.substring(0, 500));

      // Try to extract content even if JSON is malformed
      const contentMatch = output.match(/"content"\s*:\s*"([\s\S]*?)(?:","memory"|"})/);
      if (contentMatch) {
        return {
          content: polishDraftMarkdown(contentMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')),
          memory: {
            keyPoints: [],
            termsIntroduced: [],
            mainClaims: [],
            forwardReferences: []
          }
        };
      }

      throw new Error(`Failed to parse section response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private parseMemoryResponse(output: string): SectionMemory {
    let text = (output || '').trim();

    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      text = fenceMatch[1].trim();
    }

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');

    if (start === -1 || end === -1) {
      return {
        keyPoints: [],
        termsIntroduced: [],
        mainClaims: [],
        forwardReferences: []
      };
    }

    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return {
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
        termsIntroduced: Array.isArray(parsed.termsIntroduced) ? parsed.termsIntroduced : [],
        mainClaims: Array.isArray(parsed.mainClaims) ? parsed.mainClaims : [],
        forwardReferences: Array.isArray(parsed.forwardReferences) ? parsed.forwardReferences : []
      };
    } catch (error) {
      console.error('Memory parse error:', error);
      return {
        keyPoints: [],
        termsIntroduced: [],
        mainClaims: [],
        forwardReferences: []
      };
    }
  }

  private countWords(text: string): number {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  }

  private transformSection(section: PaperSection): PaperSectionWithMemory {
    return {
      ...section,
      memory: section.memory as unknown as SectionMemory | null
    };
  }
}

// Export singleton instance
export const paperSectionService = new PaperSectionService();

// Export class for testing
export { PaperSectionService };
