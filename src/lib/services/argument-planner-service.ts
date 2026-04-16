/**
 * Argument Planner Service
 *
 * Generates a structured section outline with paragraph-level intents
 * and citation budgets. This skeleton is injected into the Pass-1 prompt
 * so the LLM writes argument-driven prose instead of evidence dumps.
 *
 * Stored in PaperSection.argumentPlan (Json?).
 * Gated by ENABLE_ARGUMENT_PLAN feature flag.
 */

import { prisma } from '../prisma';
import { llmGateway, type TenantContext } from '../metering';
import { blueprintService, type SectionPlanItem } from './blueprint-service';
import type { EvidenceDigest } from './evidence-pack-service';
import type { ResearchIntentLock } from './research-intent-lock-service';
import crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface ParagraphPlan {
    pid: string;           // P1, P2, ...
    intent: string;        // define|contrast|justify|delimit|transition|synthesize|gap|contribution
    claim: string;         // what this paragraph argues
    maxCites: number;      // default 3
    requiredCites?: string[];
}

export interface SubsectionPlan {
    heading: string;
    paragraphs: ParagraphPlan[];
}

export interface ArgumentPlan {
    sectionKey: string;
    wordBudget: { min: number; max: number };
    mustCiteKeys: string[];
    subsections: SubsectionPlan[];
}

// ============================================================================
// Constants
// ============================================================================

const VALID_INTENTS = [
    'define', 'contrast', 'justify', 'delimit', 'transition',
    'synthesize', 'gap', 'contribution', 'contextualize', 'critique',
    'evidence', 'methodology', 'result', 'limitation', 'implication',
];

const DEFAULT_MAX_CITES_PER_PARAGRAPH = 3;

// ============================================================================
// Service
// ============================================================================

class ArgumentPlannerService {

    /**
     * Build (or retrieve cached) an ArgumentPlan for a section.
     */
    async buildArgumentPlan(
        sessionId: string,
        sectionKey: string,
        digest: EvidenceDigest,
        intentLock: ResearchIntentLock | null,
        tenantContext: TenantContext
    ): Promise<ArgumentPlan | null> {
        // Check for cached plan
        const existing = await prisma.paperSection.findUnique({
            where: { sessionId_sectionKey: { sessionId, sectionKey } },
            select: { argumentPlan: true },
        });

        if (existing?.argumentPlan && typeof existing.argumentPlan === 'object') {
            return existing.argumentPlan as unknown as ArgumentPlan;
        }

        // Get blueprint context
        const blueprintData = await blueprintService.getBlueprint(sessionId);
        if (!blueprintData) return null;

        const section = blueprintData.sectionPlan.find(s => s.sectionKey === sectionKey);
        if (!section) return null;

        const prompt = this.buildGenerationPrompt(section, digest, intentLock);

        const result = await llmGateway.executeLLMOperation(
            { tenantContext },
            {
                taskCode: 'LLM2_DRAFT',
                stageCode: 'ARGUMENT_PLAN',
                prompt,
                parameters: {
                    purpose: 'argument_plan',
                    temperature: 0.3,
                },
                idempotencyKey: crypto.randomUUID(),
                metadata: { sessionId, sectionKey, purpose: 'argument_plan' },
            }
        );

        if (!result.success || !result.response?.output) {
            console.warn(`[ArgumentPlannerService] LLM generation failed for ${sectionKey}:`, result.error?.message);
            return null;
        }

        const plan = this.parseResponse(result.response.output, sectionKey, section, digest);

        // Cache in the PaperSection row (upsert to handle first-time)
        await prisma.paperSection.upsert({
            where: { sessionId_sectionKey: { sessionId, sectionKey } },
            update: { argumentPlan: plan as any },
            create: {
                sessionId,
                sectionKey,
                displayName: section.sectionKey.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                content: '',
                status: 'DRAFT' as any,
                argumentPlan: plan as any,
            },
        });

        return plan;
    }

    /**
     * Format an ArgumentPlan as a compact skeleton for prompt injection.
     */
    formatForPrompt(plan: ArgumentPlan): string {
        const lines: string[] = [
            `ARGUMENT PLAN for [${plan.sectionKey}]:`,
            `Word budget: ${plan.wordBudget.min}–${plan.wordBudget.max}`,
            `Must-cite: ${plan.mustCiteKeys.join(', ') || '(none)'}`,
            '',
        ];

        for (const sub of plan.subsections) {
            lines.push(`### ${sub.heading}`);
            for (const para of sub.paragraphs) {
                const requiredTag = para.requiredCites?.length
                    ? ` [requires: ${para.requiredCites.join(', ')}]`
                    : '';
                lines.push(
                    `  ${para.pid}. [${para.intent}] ${para.claim} (max ${para.maxCites} cites)${requiredTag}`
                );
            }
            lines.push('');
        }

        lines.push('Follow this outline strictly. Each paragraph should fulfill its stated intent.');
        return lines.join('\n');
    }

    /**
     * Invalidate (clear) an existing argument plan for a section.
     */
    async invalidate(sessionId: string, sectionKey: string): Promise<void> {
        try {
            await prisma.paperSection.update({
                where: { sessionId_sectionKey: { sessionId, sectionKey } },
                data: { argumentPlan: null as any },
            });
        } catch {
            // Section may not exist yet — that's fine
        }
    }

    // ===========================================================================
    // Private
    // ===========================================================================

    private buildGenerationPrompt(
        section: SectionPlanItem,
        digest: EvidenceDigest,
        intentLock: ResearchIntentLock | null
    ): string {
        const digestSummary = digest.digests
            .map(d => `  - [${d.citationKey}]: ${d.claimType} | ${d.claim.slice(0, 150)}`)
            .join('\n');

        const intentContext = intentLock
            ? `\nRESEARCH INTENT LOCK:\n- Thesis: ${intentLock.thesisStatement}\n- Scope boundaries: ${intentLock.scopeBoundaries.join('; ')}\n- Forbidden claims: ${intentLock.forbiddenClaims.join('; ')}\n`
            : '';

        return `You are an academic paper structure architect. Generate a paragraph-level outline for the "${section.sectionKey}" section.

SECTION BLUEPRINT:
- Purpose: ${section.purpose}
- Must cover: ${section.mustCover.join('; ')}
- Must avoid: ${section.mustAvoid.join('; ')}
- Word budget: ~${section.wordBudget || 800} words
${intentContext}
AVAILABLE EVIDENCE (${digest.digests.length} citations):
${digestSummary || '  (no evidence available)'}

Must-cite keys: ${digest.mustCiteKeys.join(', ') || '(none)'}

Generate a JSON ArgumentPlan:
{
  "sectionKey": "${section.sectionKey}",
  "wordBudget": { "min": ${Math.round((section.wordBudget || 800) * 0.85)}, "max": ${Math.round((section.wordBudget || 800) * 1.15)} },
  "mustCiteKeys": ${JSON.stringify(digest.mustCiteKeys)},
  "subsections": [
    {
      "heading": "Subsection Title",
      "paragraphs": [
        {
          "pid": "P1",
          "intent": "define|contrast|justify|delimit|transition|synthesize|gap|contribution",
          "claim": "What this paragraph argues in one sentence",
          "maxCites": 3,
          "requiredCites": ["citationKey"]
        }
      ]
    }
  ]
}

RULES:
- Each paragraph must have a clear argumentative INTENT (not just "discuss" or "describe")
- Valid intents: define, contrast, justify, delimit, transition, synthesize, gap, contribution, contextualize, critique, evidence, methodology, result, limitation, implication
- Distribute must-cite keys across paragraphs so each appears at least once
- Max 3 citations per paragraph unless justified
- 4-8 paragraphs total (for an ~800 word section)
- Subsection headings should be thematic, not "Introduction" or "Overview"

Return ONLY valid JSON. No commentary.`;
    }

    private parseResponse(
        output: string,
        sectionKey: string,
        section: SectionPlanItem,
        digest: EvidenceDigest
    ): ArgumentPlan {
        try {
            const jsonMatch = output.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return this.validateAndNormalize(parsed, sectionKey, section, digest);
            }
        } catch (e) {
            console.warn(`[ArgumentPlannerService] Failed to parse LLM response for ${sectionKey}:`, e);
        }

        // Fallback: generate a minimal plan from blueprint data
        return this.buildFallbackPlan(sectionKey, section, digest);
    }

    private validateAndNormalize(
        raw: any,
        sectionKey: string,
        section: SectionPlanItem,
        digest: EvidenceDigest
    ): ArgumentPlan {
        const wordBudget = section.wordBudget || 800;

        const subsections: SubsectionPlan[] = [];
        if (Array.isArray(raw.subsections)) {
            for (const sub of raw.subsections) {
                const paragraphs: ParagraphPlan[] = [];
                if (Array.isArray(sub.paragraphs)) {
                    for (const para of sub.paragraphs) {
                        const intent = VALID_INTENTS.includes(para.intent) ? para.intent : 'synthesize';
                        paragraphs.push({
                            pid: String(para.pid || `P${paragraphs.length + 1}`),
                            intent,
                            claim: String(para.claim || '').slice(0, 300),
                            maxCites: Math.min(Number(para.maxCites) || DEFAULT_MAX_CITES_PER_PARAGRAPH, 5),
                            requiredCites: Array.isArray(para.requiredCites)
                                ? para.requiredCites.filter((k: string) =>
                                    digest.mustCiteKeys.includes(k) || digest.optionalCiteKeys.includes(k)
                                )
                                : undefined,
                        });
                    }
                }
                subsections.push({
                    heading: String(sub.heading || 'Untitled'),
                    paragraphs,
                });
            }
        }

        // If LLM returned no subsections, use fallback
        if (subsections.length === 0) {
            return this.buildFallbackPlan(sectionKey, section, digest);
        }

        return {
            sectionKey,
            wordBudget: {
                min: Math.round(wordBudget * 0.85),
                max: Math.round(wordBudget * 1.15),
            },
            mustCiteKeys: [...digest.mustCiteKeys],
            subsections,
        };
    }

    private buildFallbackPlan(
        sectionKey: string,
        section: SectionPlanItem,
        digest: EvidenceDigest
    ): ArgumentPlan {
        const wordBudget = section.wordBudget || 800;
        const paragraphs: ParagraphPlan[] = [];

        // Create one paragraph per mustCover item
        for (let i = 0; i < section.mustCover.length; i++) {
            const item = section.mustCover[i];
            paragraphs.push({
                pid: `P${i + 1}`,
                intent: i === 0 ? 'contextualize' : i === section.mustCover.length - 1 ? 'synthesize' : 'evidence',
                claim: item,
                maxCites: DEFAULT_MAX_CITES_PER_PARAGRAPH,
            });
        }

        // Ensure at least 3 paragraphs
        if (paragraphs.length < 3) {
            if (paragraphs.length === 0) {
                paragraphs.push({ pid: 'P1', intent: 'contextualize', claim: `Introduce the ${sectionKey} topic`, maxCites: 3 });
            }
            if (paragraphs.length === 1) {
                paragraphs.push({ pid: 'P2', intent: 'evidence', claim: 'Present key evidence and analysis', maxCites: 3 });
            }
            if (paragraphs.length === 2) {
                paragraphs.push({ pid: 'P3', intent: 'synthesize', claim: 'Synthesize findings and transition', maxCites: 2 });
            }
        }

        return {
            sectionKey,
            wordBudget: {
                min: Math.round(wordBudget * 0.85),
                max: Math.round(wordBudget * 1.15),
            },
            mustCiteKeys: [...digest.mustCiteKeys],
            subsections: [{
                heading: sectionKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                paragraphs,
            }],
        };
    }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const argumentPlannerService = new ArgumentPlannerService();
