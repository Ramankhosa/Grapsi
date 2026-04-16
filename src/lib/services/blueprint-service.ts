/**
 * Blueprint Service
 * Generates and manages Paper Blueprints for coherence-by-construction
 * 
 * The Blueprint is a frozen plan that governs all section generation:
 * - Thesis statement and central objective
 * - Section-by-section requirements (mustCover, mustAvoid)
 * - Terminology policy
 * - Methodology-specific structure
 */

import { prisma } from '../prisma';
import { llmGateway, type TenantContext } from '../metering';
import { paperTypeService } from './paper-type-service';
import {
  getDefaultRhetoricalBlueprint,
  normalizeRhetoricalBlueprint,
  type RhetoricalBlueprint
} from './rhetorical-blueprint-service';
import type { 
  PaperBlueprint, 
  ResearchTopic, 
  BlueprintStatus,
  MethodologyType 
} from '@prisma/client';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * Dimension type for citation mapping - indicates what kind of evidence is needed
 */
export type DimensionType = 
  | 'foundational'   // Seminal/historical papers establishing concepts
  | 'methodological' // Papers describing techniques/approaches used
  | 'empirical'      // Papers providing evidence/data for claims
  | 'comparative'    // Papers comparing alternative approaches
  | 'gap';           // Papers identifying limitations or research gaps

export interface ThematicBlueprint {
  mustCover: string[];
  mustAvoid: string[];
  mustCoverTyping?: Record<string, DimensionType>;
  suggestedCitationCount?: number;
}

export interface SectionPlanItem {
  sectionKey: string;
  purpose: string;
  mustCover: string[];
  mustAvoid: string[];
  wordBudget?: number;
  dependencies: string[]; // Which sections must come before
  outputsPromised: string[]; // What this section will provide for later sections
  
  // Citation mapping support (Part B integration)
  mustCoverTyping?: Record<string, DimensionType>; // Maps each mustCover dimension to its type
  suggestedCitationCount?: number; // Minimum citations expected for this section
  thematicBlueprint?: ThematicBlueprint;
  rhetoricalBlueprint?: RhetoricalBlueprint;
}

export type RhetoricalBlueprintBySection = Record<string, RhetoricalBlueprint>;

export interface BlueprintGenerationInput {
  sessionId: string;
  researchTopic: ResearchTopic;
  paperTypeCode: string;
  targetWordCount?: number;
  tenantContext: TenantContext;
}

export interface BlueprintWithSectionPlan extends Omit<PaperBlueprint, 'sectionPlan' | 'preferredTerms' | 'changeLog'> {
  sectionPlan: SectionPlanItem[];
  preferredTerms: Record<string, string> | null;
  changeLog: Array<{ version: number; changedAt: string; changes: string[] }> | null;
  blueprintSchemaVersion: number;
}

export interface SectionContext {
  sectionKey: string;
  purpose: string;
  mustCover: string[];
  mustAvoid: string[];
  wordBudget?: number;
  dependencies: string[];
  mustCoverTyping?: Record<string, DimensionType>;
  suggestedCitationCount?: number;
  thematicBlueprint?: ThematicBlueprint;
  rhetoricalBlueprint?: RhetoricalBlueprint;
}

export interface BlueprintContext {
  thesisStatement: string;
  centralObjective: string;
  keyContributions: string[];
  currentSection: SectionContext;
  preferredTerms: Record<string, string>;
}

// ============================================================================
// Methodology-Specific Section Patterns
// ============================================================================

const METHODOLOGY_SECTION_PATTERNS: Record<string, {
  requiredSections: string[];
  optionalSections: string[];
  sectionGuidance: Record<string, { mustCover: string[]; mustAvoid: string[] }>;
}> = {
  QUANTITATIVE: {
    requiredSections: ['introduction', 'methodology', 'results', 'discussion', 'conclusion'],
    optionalSections: ['literature_review', 'related_work'],
    sectionGuidance: {
      methodology: {
        mustCover: ['research design', 'variables and hypotheses', 'sample size and selection', 'data collection methods', 'analysis techniques', 'validity threats'],
        mustAvoid: ['interpretation of results', 'literature synthesis']
      },
      results: {
        mustCover: ['statistical findings', 'hypothesis testing outcomes', 'effect sizes', 'tables/figures references'],
        mustAvoid: ['interpretation', 'literature comparisons', 'implications']
      }
    }
  },
  QUALITATIVE: {
    requiredSections: ['introduction', 'methodology', 'results', 'discussion', 'conclusion'],
    optionalSections: ['literature_review', 'related_work'],
    sectionGuidance: {
      methodology: {
        mustCover: ['research design rationale', 'participant selection', 'data collection approach', 'coding/analysis method', 'trustworthiness strategy (credibility, transferability, dependability, confirmability)'],
        mustAvoid: ['quantitative metrics', 'hypothesis testing language']
      },
      results: {
        mustCover: ['themes identified', 'participant perspectives', 'exemplar quotes', 'pattern descriptions'],
        mustAvoid: ['statistical language', 'generalization claims']
      }
    }
  },
  MIXED_METHODS: {
    requiredSections: ['introduction', 'methodology', 'results', 'discussion', 'conclusion'],
    optionalSections: ['literature_review'],
    sectionGuidance: {
      methodology: {
        mustCover: ['mixed methods design justification', 'quantitative component', 'qualitative component', 'integration strategy'],
        mustAvoid: ['treating methods as separate studies']
      },
      results: {
        mustCover: ['quantitative findings', 'qualitative findings', 'integrated analysis'],
        mustAvoid: ['complete separation of findings']
      }
    }
  },
  THEORETICAL: {
    requiredSections: ['introduction', 'literature_review', 'analysis', 'discussion', 'conclusion'],
    optionalSections: ['methodology'],
    sectionGuidance: {
      analysis: {
        mustCover: ['theoretical constructs', 'propositions', 'argument development', 'boundary conditions'],
        mustAvoid: ['empirical claims without theoretical backing']
      }
    }
  },
  CASE_STUDY: {
    requiredSections: ['introduction', 'methodology', 'case_description', 'analysis', 'discussion', 'conclusion'],
    optionalSections: ['literature_review', 'recommendations'],
    sectionGuidance: {
      case_description: {
        mustCover: ['case context', 'setting description', 'key actors', 'timeline of events'],
        mustAvoid: ['analysis', 'interpretation', 'conclusions']
      },
      analysis: {
        mustCover: ['theoretical lens application', 'pattern identification', 'cross-case comparison (if applicable)'],
        mustAvoid: ['new case information', 'unsupported claims']
      }
    }
  },
  REVIEW: {
    requiredSections: ['introduction', 'methodology', 'results', 'discussion', 'conclusion'],
    optionalSections: ['future_directions'],
    sectionGuidance: {
      methodology: {
        mustCover: ['search strategy', 'databases searched', 'inclusion/exclusion criteria', 'screening process', 'quality assessment', 'synthesis approach'],
        mustAvoid: ['presenting findings', 'interpretation']
      },
      results: {
        mustCover: ['taxonomy/themes', 'synthesis of findings', 'gaps identified', 'trend analysis'],
        mustAvoid: ['new primary research', 'unsupported recommendations']
      }
    }
  }
};

// ============================================================================
// Blueprint Service Class
// ============================================================================

class BlueprintService {
  
  /**
   * Generate a draft blueprint from research topic
   */
  async generateBlueprint(input: BlueprintGenerationInput): Promise<BlueprintWithSectionPlan> {
    const { sessionId, researchTopic, paperTypeCode, targetWordCount, tenantContext } = input;

    // Check if blueprint already exists
    const existingBlueprint = await prisma.paperBlueprint.findUnique({
      where: { sessionId }
    });

    if (existingBlueprint) {
      return this.transformBlueprint(existingBlueprint);
    }

    // Get paper type configuration
    const paperType = await paperTypeService.getPaperType(paperTypeCode);
    if (!paperType) {
      throw new Error(`Paper type not found: ${paperTypeCode}`);
    }

    // Map methodology to pattern key
    const methodologyKey = this.mapMethodologyToPattern(researchTopic.methodology);

    // Build the generation prompt
    const prompt = this.buildBlueprintGenerationPrompt(
      researchTopic,
      paperType,
      methodologyKey,
      targetWordCount
    );

    // Call LLM to generate blueprint
    const result = await llmGateway.executeLLMOperation(
      { tenantContext },
      {
        taskCode: 'LLM2_DRAFT',
        stageCode: 'PAPER_BLUEPRINT_GEN',
        prompt,
        // maxTokensOut is controlled via super admin LLM config for PAPER_BLUEPRINT_GEN stage
        parameters: {
          purpose: 'blueprint_generation',
          temperature: 0.4,
        },
        idempotencyKey: crypto.randomUUID(),
        metadata: {
          sessionId,
          purpose: 'paper_blueprint_generation',
          paperType: paperTypeCode,
          methodology: methodologyKey
        }
      }
    );

    if (!result.success || !result.response) {
      throw new Error(result.error?.message || 'Blueprint generation failed');
    }

    // Parse the LLM response
    const blueprintData = this.parseBlueprintResponse(result.response.output);
    const normalizedSectionPlan = this.normalizeSectionPlan(blueprintData.sectionPlan);

    // Create blueprint in database
    const blueprint = await prisma.paperBlueprint.create({
      data: {
        sessionId,
        thesisStatement: blueprintData.thesisStatement,
        centralObjective: blueprintData.centralObjective,
        keyContributions: blueprintData.keyContributions,
        sectionPlan: normalizedSectionPlan as any,
        preferredTerms: blueprintData.preferredTerms || {},
        narrativeArc: blueprintData.narrativeArc,
        paperTypeCode,
        methodologyType: methodologyKey,
        blueprintSchemaVersion: 2,
        status: 'DRAFT',
        llmPromptUsed: prompt,
        llmResponse: result.response.output,
        llmTokensUsed: result.response.outputTokens
      }
    });

    return this.transformBlueprint(blueprint);
  }

  /**
   * Get blueprint for a session
   */
  async getBlueprint(sessionId: string): Promise<BlueprintWithSectionPlan | null> {
    const blueprint = await prisma.paperBlueprint.findUnique({
      where: { sessionId }
    });

    if (!blueprint) {
      return null;
    }

    return this.transformBlueprint(blueprint);
  }

  /**
   * Freeze a blueprint (lock for section generation)
   */
  async freezeBlueprint(sessionId: string): Promise<BlueprintWithSectionPlan> {
    const blueprint = await prisma.paperBlueprint.findUnique({
      where: { sessionId }
    });

    if (!blueprint) {
      throw new Error('Blueprint not found');
    }

    if (blueprint.status === 'FROZEN') {
      return this.transformBlueprint(blueprint);
    }

    // Validate blueprint before freezing
    this.validateBlueprintForFreeze(blueprint);

    const updated = await prisma.paperBlueprint.update({
      where: { sessionId },
      data: {
        status: 'FROZEN',
        frozenAt: new Date()
      }
    });

    return this.transformBlueprint(updated);
  }

  /**
   * Unfreeze blueprint for edits (creates revision)
   */
  async unfreezeBlueprint(sessionId: string): Promise<BlueprintWithSectionPlan> {
    const blueprint = await prisma.paperBlueprint.findUnique({
      where: { sessionId }
    });

    if (!blueprint) {
      throw new Error('Blueprint not found');
    }

    if (blueprint.status !== 'FROZEN') {
      return this.transformBlueprint(blueprint);
    }

    // Mark all existing sections as stale
    await prisma.paperSection.updateMany({
      where: { sessionId },
      data: { isStale: true }
    });

    const updated = await prisma.paperBlueprint.update({
      where: { sessionId },
      data: {
        status: 'REVISION_PENDING',
        version: { increment: 1 }
      }
    });

    return this.transformBlueprint(updated);
  }

  /**
   * Update blueprint (only when not frozen)
   */
  async updateBlueprint(
    sessionId: string,
    updates: Partial<{
      thesisStatement: string;
      centralObjective: string;
      keyContributions: string[];
      sectionPlan: SectionPlanItem[];
      preferredTerms: Record<string, string>;
      rhetoricalBlueprints: RhetoricalBlueprintBySection;
    }>
  ): Promise<BlueprintWithSectionPlan> {
    const blueprint = await prisma.paperBlueprint.findUnique({
      where: { sessionId }
    });

    if (!blueprint) {
      throw new Error('Blueprint not found');
    }

    if (blueprint.status === 'FROZEN') {
      throw new Error('Cannot update frozen blueprint. Unfreeze first.');
    }

    const currentBlueprint = this.transformBlueprint(blueprint);
    let normalizedSectionPlan = currentBlueprint.sectionPlan;

    if (updates.sectionPlan) {
      normalizedSectionPlan = this.normalizeSectionPlan(updates.sectionPlan);
    }

    if (updates.rhetoricalBlueprints && Object.keys(updates.rhetoricalBlueprints).length > 0) {
      normalizedSectionPlan = this.applyRhetoricalOverrides(
        normalizedSectionPlan,
        updates.rhetoricalBlueprints
      );
    }

    // Build change log entry
    const changes: string[] = [];
    if (updates.thesisStatement) changes.push('thesis statement');
    if (updates.centralObjective) changes.push('central objective');
    if (updates.keyContributions) changes.push('key contributions');
    if (updates.sectionPlan) changes.push('section plan');
    if (updates.preferredTerms) changes.push('preferred terms');
    if (updates.rhetoricalBlueprints) changes.push('rhetorical blueprint');

    const existingLog = (blueprint.changeLog as any[]) || [];
    const newLogEntry = {
      version: blueprint.version + 1,
      changedAt: new Date().toISOString(),
      changes
    };

    const updated = await prisma.paperBlueprint.update({
      where: { sessionId },
      data: {
        ...(updates.thesisStatement && { thesisStatement: updates.thesisStatement }),
        ...(updates.centralObjective && { centralObjective: updates.centralObjective }),
        ...(updates.keyContributions && { keyContributions: updates.keyContributions }),
        ...((updates.sectionPlan || updates.rhetoricalBlueprints) && { sectionPlan: normalizedSectionPlan as any }),
        ...(updates.preferredTerms && { preferredTerms: updates.preferredTerms }),
        blueprintSchemaVersion: 2,
        status: 'DRAFT',
        version: { increment: 1 },
        changeLog: [...existingLog, newLogEntry]
      }
    });

    return this.transformBlueprint(updated);
  }

  /**
   * Get section context for prompt injection
   */
  async getSectionContext(sessionId: string, sectionKey: string): Promise<BlueprintContext | null> {
    const blueprint = await this.getBlueprint(sessionId);
    if (!blueprint) {
      return null;
    }

    const sectionPlan = blueprint.sectionPlan.find(s => s.sectionKey === sectionKey);
    if (!sectionPlan) {
      return null;
    }

    return {
      thesisStatement: blueprint.thesisStatement,
      centralObjective: blueprint.centralObjective,
      keyContributions: blueprint.keyContributions,
      currentSection: {
        sectionKey: sectionPlan.sectionKey,
        purpose: sectionPlan.purpose,
        mustCover: sectionPlan.mustCover,
        mustAvoid: sectionPlan.mustAvoid,
        wordBudget: sectionPlan.wordBudget,
        dependencies: sectionPlan.dependencies,
        mustCoverTyping: sectionPlan.mustCoverTyping,
        suggestedCitationCount: sectionPlan.suggestedCitationCount,
        thematicBlueprint: sectionPlan.thematicBlueprint,
        rhetoricalBlueprint: sectionPlan.rhetoricalBlueprint
      },
      preferredTerms: blueprint.preferredTerms || {}
    };
  }

  /**
   * Check if blueprint is ready for section generation
   */
  async isBlueprintReady(sessionId: string): Promise<{ ready: boolean; reason?: string }> {
    const blueprint = await prisma.paperBlueprint.findUnique({
      where: { sessionId }
    });

    if (!blueprint) {
      return { ready: false, reason: 'No blueprint exists for this session' };
    }

    if (blueprint.status !== 'FROZEN') {
      return { ready: false, reason: 'Blueprint must be frozen before generating sections' };
    }

    return { ready: true };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private mapMethodologyToPattern(methodology: MethodologyType): string {
    const mapping: Record<MethodologyType, string> = {
      QUANTITATIVE: 'QUANTITATIVE',
      QUALITATIVE: 'QUALITATIVE',
      MIXED_METHODS: 'MIXED_METHODS',
      THEORETICAL: 'THEORETICAL',
      CASE_STUDY: 'CASE_STUDY',
      ACTION_RESEARCH: 'QUALITATIVE',
      EXPERIMENTAL: 'QUANTITATIVE',
      SURVEY: 'QUANTITATIVE',
      OTHER: 'QUANTITATIVE'
    };
    return mapping[methodology] || 'QUANTITATIVE';
  }

  private buildBlueprintGenerationPrompt(
    topic: ResearchTopic,
    paperType: any,
    methodologyKey: string,
    targetWordCount?: number
  ): string {
    const methodologyPattern = METHODOLOGY_SECTION_PATTERNS[methodologyKey] || METHODOLOGY_SECTION_PATTERNS.QUANTITATIVE;
    
    // Merge paper type sections with methodology requirements
    const requiredSections = Array.from(new Set([
      ...paperType.requiredSections,
      ...methodologyPattern.requiredSections
    ]));

    return `You are an expert academic writing advisor. Generate a comprehensive paper blueprint based on the research topic below.

═══════════════════════════════════════════════════════════════════════════════
RESEARCH TOPIC INPUT
═══════════════════════════════════════════════════════════════════════════════
Title: ${topic.title}
Research Question: ${topic.researchQuestion}
${topic.hypothesis ? `Hypothesis: ${topic.hypothesis}` : ''}
Methodology: ${topic.methodology}
Contribution Type: ${topic.contributionType}
Keywords: ${topic.keywords.join(', ')}
${topic.datasetDescription ? `Dataset: ${topic.datasetDescription}` : ''}
${topic.abstractDraft ? `Draft Abstract: ${topic.abstractDraft}` : ''}

═══════════════════════════════════════════════════════════════════════════════
PAPER CONFIGURATION
═══════════════════════════════════════════════════════════════════════════════
Paper Type: ${paperType.name}
Methodology Pattern: ${methodologyKey}
Required Sections: ${requiredSections.join(', ')}
${targetWordCount ? `Target Word Count: ${targetWordCount}` : ''}

═══════════════════════════════════════════════════════════════════════════════
METHODOLOGY-SPECIFIC GUIDANCE
═══════════════════════════════════════════════════════════════════════════════
${JSON.stringify(methodologyPattern.sectionGuidance, null, 2)}

═══════════════════════════════════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════════════════════════════════
Generate a paper blueprint with:

1. THESIS STATEMENT: A single clear sentence stating the paper's central claim or argument.

2. CENTRAL OBJECTIVE: 1-2 sentences describing what the paper will achieve.

3. KEY CONTRIBUTIONS: 3-5 specific, testable contributions the paper will make.

4. SECTION PLAN: For each required section, provide:
   - sectionKey: the section identifier
   - purpose: one sentence describing what this section achieves
   - mustCover: 4-8 CITATION-MAPPABLE dimensions (see rules below)
   - mustCoverTyping: (ADVISORY METADATA) For each mustCover item, indicate its likely evidence type:
     * "foundational" - seminal/historical papers establishing concepts
     * "methodological" - papers describing techniques/approaches used
     * "empirical" - papers providing evidence/data for claims
     * "comparative" - papers comparing alternative approaches
     * "gap" - papers identifying limitations or research gaps
   - mustAvoid: 2-4 things this section should NOT include (to prevent overlap)
   - wordBudget: suggested word count
   - dependencies: which sections must come before this one
   - outputsPromised: what this section provides for later sections
   - suggestedCitationCount: (OPTIONAL, NON-BINDING) estimated citations for this section

5. PREFERRED TERMS: Key terminology that should be used consistently throughout.

6. NARRATIVE ARC: Brief description of the paper's flow (gap → approach → result → implication).

═══════════════════════════════════════════════════════════════════════════════
CITATION-MAPPABLE DIMENSION RULES (MANDATORY)
═══════════════════════════════════════════════════════════════════════════════
Each mustCover dimension MUST be:

1. A CONCRETE, EVIDENCE-REQUIRING TOPIC OR CLAIM
   - GOOD: "effectiveness of attention mechanisms in reducing sequence modeling errors"
   - BAD: "overview of attention" (editorial task, not evidence-requiring)

2. CONTAIN AT LEAST ONE NOUN PHRASE LIKELY TO APPEAR IN PAPER TITLES/ABSTRACTS
   - GOOD: "transformer architecture self-attention for machine translation"
   - BAD: "modern approaches" (no searchable noun phrase)

3. SPECIFIC ENOUGH TO BE SUPPORTED BY MULTIPLE INDEPENDENT PAPERS
   - GOOD: "benchmark performance of BERT-based models on sentiment analysis"
   - BAD: "Devlin et al. BERT paper" (too narrow - only one paper)
   - BAD: "deep learning methods" (too broad - matches everything)

4. NOT AN EDITORIAL TASK
   - AVOID these words in dimensions: overview, discussion, synthesis, coverage, summary, introduction
   - GOOD: "computational complexity of quadratic attention in long sequences"
   - BAD: "discussion of attention complexity" (editorial framing)

EXAMPLES OF WELL-FORMED DIMENSIONS:
✓ "recurrent neural network vanishing gradient problem mitigation techniques"
✓ "pre-training corpus size impact on downstream task generalization"
✓ "positional encoding strategies for sequence order preservation"
✓ "multi-head attention parallelization for training efficiency"

EXAMPLES OF POORLY-FORMED DIMENSIONS (DO NOT USE):
✗ "literature review of transformers"
✗ "methodology overview"
✗ "comparison and analysis"
✗ "background and context"

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT (Return ONLY valid JSON)
═══════════════════════════════════════════════════════════════════════════════
{
  "thesisStatement": "...",
  "centralObjective": "...",
  "keyContributions": ["...", "...", "..."],
  "sectionPlan": [
    {
      "sectionKey": "literature_review",
      "purpose": "Establish theoretical foundations and identify the research gap",
      "mustCover": [
        "foundational deep learning architectures for sequence modeling",
        "attention mechanism evolution from RNNs to transformers",
        "pre-training and transfer learning effectiveness in NLP",
        "benchmark datasets and evaluation metrics for language tasks",
        "computational efficiency challenges in large language models"
      ],
      "mustCoverTyping": {
        "foundational deep learning architectures for sequence modeling": "foundational",
        "attention mechanism evolution from RNNs to transformers": "foundational",
        "pre-training and transfer learning effectiveness in NLP": "empirical",
        "benchmark datasets and evaluation metrics for language tasks": "methodological",
        "computational efficiency challenges in large language models": "gap"
      },
      "mustAvoid": ["methodology details", "results interpretation", "future work"],
      "wordBudget": 1500,
      "dependencies": ["introduction"],
      "outputsPromised": ["research gap", "theoretical framework", "key terminology"],
      "suggestedCitationCount": 15
    }
  ],
  "preferredTerms": {
    "term1": "definition1"
  },
  "narrativeArc": "..."
}

CRITICAL RULES:
- Output ONLY raw JSON, no markdown code fences
- Ensure mustAvoid prevents duplication between sections
- Make thesis statement specific and testable
- Key contributions should be concrete and verifiable
- Each mustCover dimension MUST follow the citation-mappable rules above
- mustCoverTyping is ADVISORY metadata only (include for all items, but it will not be enforced as a filter)
- suggestedCitationCount is INFORMATIONAL only (will not be used to drive search or validate completeness)`;
  }

  private parseBlueprintResponse(output: string): {
    thesisStatement: string;
    centralObjective: string;
    keyContributions: string[];
    sectionPlan: SectionPlanItem[];
    preferredTerms: Record<string, string>;
    narrativeArc: string;
  } {
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
      throw new Error('Invalid blueprint response: no JSON object found');
    }

    text = text.slice(start, end + 1);

    try {
      const parsed = JSON.parse(text);

      // Validate required fields
      if (!parsed.thesisStatement || typeof parsed.thesisStatement !== 'string') {
        throw new Error('Missing or invalid thesisStatement');
      }

      if (!parsed.centralObjective || typeof parsed.centralObjective !== 'string') {
        throw new Error('Missing or invalid centralObjective');
      }

      if (!Array.isArray(parsed.keyContributions) || parsed.keyContributions.length === 0) {
        throw new Error('Missing or invalid keyContributions');
      }

      if (!Array.isArray(parsed.sectionPlan) || parsed.sectionPlan.length === 0) {
        throw new Error('Missing or invalid sectionPlan');
      }

      // Validate and normalize section plan items
      const sectionPlan: SectionPlanItem[] = parsed.sectionPlan.map((item: any) => {
        const mustCover = Array.isArray(item.mustCover) ? item.mustCover : [];
        
        // Validate and normalize mustCoverTyping
        let mustCoverTyping: Record<string, DimensionType> | undefined;
        if (item.mustCoverTyping && typeof item.mustCoverTyping === 'object') {
          const validTypes = ['foundational', 'methodological', 'empirical', 'comparative', 'gap'];
          mustCoverTyping = {};
          for (const [dimension, type] of Object.entries(item.mustCoverTyping)) {
            if (validTypes.includes(type as string)) {
              mustCoverTyping[dimension] = type as DimensionType;
            } else {
              // Default to 'empirical' if invalid type
              mustCoverTyping[dimension] = 'empirical';
            }
          }
        }
        
        return {
          sectionKey: item.sectionKey || 'unknown',
          purpose: item.purpose || '',
          mustCover,
          mustAvoid: Array.isArray(item.mustAvoid) ? item.mustAvoid : [],
          wordBudget: typeof item.wordBudget === 'number' ? item.wordBudget : undefined,
          dependencies: Array.isArray(item.dependencies) ? item.dependencies : [],
          outputsPromised: Array.isArray(item.outputsPromised) ? item.outputsPromised : [],
          mustCoverTyping,
          suggestedCitationCount: typeof item.suggestedCitationCount === 'number' 
            ? item.suggestedCitationCount 
            : undefined
        };
      });

      return {
        thesisStatement: parsed.thesisStatement,
        centralObjective: parsed.centralObjective,
        keyContributions: parsed.keyContributions,
        sectionPlan,
        preferredTerms: typeof parsed.preferredTerms === 'object' ? parsed.preferredTerms : {},
        narrativeArc: parsed.narrativeArc || ''
      };
    } catch (error) {
      console.error('Blueprint parse error:', error);
      console.error('Raw output:', output.substring(0, 500));
      throw new Error(`Failed to parse blueprint response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private validateBlueprintForFreeze(blueprint: PaperBlueprint): void {
    if (!blueprint.thesisStatement || blueprint.thesisStatement.trim().length < 20) {
      throw new Error('Thesis statement is too short or missing');
    }

    if (!blueprint.centralObjective || blueprint.centralObjective.trim().length < 20) {
      throw new Error('Central objective is too short or missing');
    }

    if (!blueprint.keyContributions || blueprint.keyContributions.length < 2) {
      throw new Error('At least 2 key contributions are required');
    }

    const sectionPlan = this.normalizeSectionPlan(blueprint.sectionPlan as unknown as SectionPlanItem[]);
    if (!sectionPlan || sectionPlan.length < 3) {
      throw new Error('Section plan must have at least 3 sections');
    }

    // Validate no circular dependencies
    this.validateNoCyclicDependencies(sectionPlan);

    // Validate mustCover items don't heavily overlap
    this.validateNoHeavyOverlap(sectionPlan);
  }

  private validateNoCyclicDependencies(sectionPlan: SectionPlanItem[]): void {
    const sectionKeys = new Set(sectionPlan.map(s => s.sectionKey));
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (sectionKey: string): boolean => {
      if (recursionStack.has(sectionKey)) return true;
      if (visited.has(sectionKey)) return false;

      visited.add(sectionKey);
      recursionStack.add(sectionKey);

      const section = sectionPlan.find(s => s.sectionKey === sectionKey);
      if (section) {
        for (const dep of section.dependencies) {
          if (sectionKeys.has(dep) && hasCycle(dep)) {
            return true;
          }
        }
      }

      recursionStack.delete(sectionKey);
      return false;
    };

    for (const section of sectionPlan) {
      if (hasCycle(section.sectionKey)) {
        throw new Error(`Circular dependency detected involving section: ${section.sectionKey}`);
      }
    }
  }

  private validateNoHeavyOverlap(sectionPlan: SectionPlanItem[]): void {
    for (let i = 0; i < sectionPlan.length; i++) {
      for (let j = i + 1; j < sectionPlan.length; j++) {
        const section1 = sectionPlan[i];
        const section2 = sectionPlan[j];

        const set1 = new Set(section1.mustCover.map(c => c.toLowerCase()));
        const set2 = new Set(section2.mustCover.map(c => c.toLowerCase()));

        let overlap = 0;
        for (const item of Array.from(set1)) {
          if (set2.has(item)) overlap++;
        }

        const overlapRatio = overlap / Math.min(set1.size, set2.size);
        if (overlapRatio > 0.5 && overlap >= 2) {
          console.warn(`Warning: High overlap between ${section1.sectionKey} and ${section2.sectionKey} mustCover items`);
        }
      }
    }
  }

  private normalizeSectionPlan(rawSectionPlan: unknown): SectionPlanItem[] {
    const rows = Array.isArray(rawSectionPlan) ? rawSectionPlan : [];
    const normalized: SectionPlanItem[] = [];

    for (let index = 0; index < rows.length; index += 1) {
      const entry = rows[index];
      const raw = (entry && typeof entry === 'object' && !Array.isArray(entry))
        ? entry as Record<string, unknown>
        : {};

      const sectionKey = String(raw.sectionKey || `section_${index + 1}`).trim();
      if (!sectionKey) {
        continue;
      }

      const thematicRaw = (
        raw.thematicBlueprint
        && typeof raw.thematicBlueprint === 'object'
        && !Array.isArray(raw.thematicBlueprint)
      )
        ? raw.thematicBlueprint as Record<string, unknown>
        : null;

      const mustCover = Array.isArray(raw.mustCover)
        ? raw.mustCover.map(item => String(item || '').trim()).filter(Boolean)
        : Array.isArray(thematicRaw?.mustCover)
          ? thematicRaw.mustCover.map(item => String(item || '').trim()).filter(Boolean)
          : [];
      const mustAvoid = Array.isArray(raw.mustAvoid)
        ? raw.mustAvoid.map(item => String(item || '').trim()).filter(Boolean)
        : Array.isArray(thematicRaw?.mustAvoid)
          ? thematicRaw.mustAvoid.map(item => String(item || '').trim()).filter(Boolean)
          : [];

      const mustCoverTypingRaw = (
        raw.mustCoverTyping
        && typeof raw.mustCoverTyping === 'object'
        && !Array.isArray(raw.mustCoverTyping)
      )
        ? raw.mustCoverTyping as Record<string, unknown>
        : (
          thematicRaw?.mustCoverTyping
          && typeof thematicRaw.mustCoverTyping === 'object'
          && !Array.isArray(thematicRaw.mustCoverTyping)
        )
          ? thematicRaw.mustCoverTyping as Record<string, unknown>
          : {};

      const mustCoverTyping: Record<string, DimensionType> = {};
      for (const [dimension, type] of Object.entries(mustCoverTypingRaw)) {
        const normalizedType = String(type || '').trim().toLowerCase();
        if (
          normalizedType === 'foundational'
          || normalizedType === 'methodological'
          || normalizedType === 'empirical'
          || normalizedType === 'comparative'
          || normalizedType === 'gap'
        ) {
          mustCoverTyping[String(dimension || '').trim()] = normalizedType as DimensionType;
        }
      }

      const suggestedCitationCountRaw = raw.suggestedCitationCount ?? thematicRaw?.suggestedCitationCount;
      const suggestedCitationCount = Number.isFinite(Number(suggestedCitationCountRaw))
        ? Number(suggestedCitationCountRaw)
        : undefined;

      const thematicBlueprint: ThematicBlueprint = {
        mustCover,
        mustAvoid,
        ...(Object.keys(mustCoverTyping).length > 0 ? { mustCoverTyping } : {}),
        ...(typeof suggestedCitationCount === 'number' ? { suggestedCitationCount } : {}),
      };

      const rhetoricalBlueprint = normalizeRhetoricalBlueprint(
        sectionKey,
        raw.rhetoricalBlueprint
      );

      const wordBudget = Number.isFinite(Number(raw.wordBudget))
        ? Number(raw.wordBudget)
        : undefined;

      const normalizedSection: SectionPlanItem = {
        sectionKey,
        purpose: String(raw.purpose || '').trim(),
        mustCover,
        mustAvoid,
        ...(typeof wordBudget === 'number' ? { wordBudget } : {}),
        dependencies: Array.isArray(raw.dependencies)
          ? raw.dependencies.map(item => String(item || '').trim()).filter(Boolean)
          : [],
        outputsPromised: Array.isArray(raw.outputsPromised)
          ? raw.outputsPromised.map(item => String(item || '').trim()).filter(Boolean)
          : [],
        ...(Object.keys(mustCoverTyping).length > 0 ? { mustCoverTyping } : {}),
        ...(typeof suggestedCitationCount === 'number' ? { suggestedCitationCount } : {}),
        thematicBlueprint,
        rhetoricalBlueprint,
      };

      normalized.push(normalizedSection);
    }

    return normalized;
  }

  private applyRhetoricalOverrides(
    sectionPlan: SectionPlanItem[],
    overrides: RhetoricalBlueprintBySection
  ): SectionPlanItem[] {
    const normalizedOverrides = new Map<string, RhetoricalBlueprint>();
    for (const [sectionKey, blueprint] of Object.entries(overrides || {})) {
      const normalized = String(sectionKey || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
      if (!normalized) continue;
      normalizedOverrides.set(
        normalized,
        normalizeRhetoricalBlueprint(sectionKey, blueprint)
      );
    }

    return sectionPlan.map((section) => {
      const normalizedSectionKey = String(section.sectionKey || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
      const override = normalizedOverrides.get(normalizedSectionKey);
      if (!override) return section;
      return {
        ...section,
        rhetoricalBlueprint: override,
      };
    });
  }

  private transformBlueprint(blueprint: PaperBlueprint): BlueprintWithSectionPlan {
    const normalizedSectionPlan = this.normalizeSectionPlan(blueprint.sectionPlan as unknown);
    const sectionPlan = normalizedSectionPlan.map((entry) => ({
      ...entry,
      rhetoricalBlueprint: entry.rhetoricalBlueprint || getDefaultRhetoricalBlueprint(entry.sectionKey),
    }));

    return {
      ...blueprint,
      sectionPlan,
      preferredTerms: (blueprint.preferredTerms as Record<string, string>) || null,
      changeLog: (blueprint.changeLog as Array<{ version: number; changedAt: string; changes: string[] }>) || null,
      blueprintSchemaVersion: Number((blueprint as any).blueprintSchemaVersion) > 0
        ? Number((blueprint as any).blueprintSchemaVersion)
        : 2
    };
  }
}

// Export singleton instance
export const blueprintService = new BlueprintService();

// Export class for testing
export { BlueprintService };

