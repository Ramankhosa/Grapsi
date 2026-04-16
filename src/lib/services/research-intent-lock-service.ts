/**
 * Research Intent Lock Service
 *
 * Generates and manages thesis guardrails for a paper session.
 * The intent lock constrains what the paper can and cannot claim,
 * preventing scope creep and claim overextension across sections.
 *
 * Stored in PaperBlueprint.intentLock (Json?).
 */

import { prisma } from '../prisma';
import { llmGateway, type TenantContext } from '../metering';
import { blueprintService } from './blueprint-service';
import crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface ResearchIntentLock {
    researchQuestions: string[];
    thesisStatement: string;
    contributions: string[];
    scopeBoundaries: string[];
    allowedClaims: string[];
    forbiddenClaims: string[];
    paperType: string;
    targetVenue?: { name: string; quartile?: string };
    keywords: string[];
}

// ============================================================================
// Service
// ============================================================================

class ResearchIntentLockService {

    /**
     * Get the intent lock for a session, generating one from the blueprint if absent.
     */
    async getOrCreateIntentLock(
        sessionId: string,
        tenantContext: TenantContext
    ): Promise<ResearchIntentLock | null> {
        // Check for existing lock
        const blueprint = await prisma.paperBlueprint.findFirst({
            where: { sessionId },
            orderBy: { version: 'desc' },
        });

        if (!blueprint) return null;

        // If already generated, return it
        if (blueprint.intentLock && typeof blueprint.intentLock === 'object') {
            return blueprint.intentLock as unknown as ResearchIntentLock;
        }

        // Generate from blueprint + research topic
        const session = await prisma.draftingSession.findUnique({
            where: { id: sessionId },
            select: {
                researchTopic: true,
                paperTypeId: true,
                paperType: { select: { name: true, code: true } },
            },
        });

        if (!session) return null;

        const blueprintData = await blueprintService.getBlueprint(sessionId);
        if (!blueprintData) return null;

        const topic = session.researchTopic as any;
        const prompt = this.buildGenerationPrompt(
            blueprintData.thesisStatement,
            blueprintData.centralObjective,
            blueprintData.keyContributions,
            topic?.title || '',
            topic?.description || '',
            session.paperType?.name || 'academic paper',
            blueprintData.sectionPlan.map(s => s.sectionKey)
        );

        const result = await llmGateway.executeLLMOperation(
            { tenantContext },
            {
                taskCode: 'LLM2_DRAFT',
                stageCode: 'RESEARCH_INTENT_LOCK',
                prompt,
                parameters: {
                    purpose: 'research_intent_lock',
                    temperature: 0.3,
                },
                idempotencyKey: crypto.randomUUID(),
                metadata: { sessionId, purpose: 'research_intent_lock' },
            }
        );

        if (!result.success || !result.response?.output) {
            console.warn('[ResearchIntentLockService] LLM generation failed:', result.error?.message);
            return null;
        }

        const lock = this.parseResponse(
            result.response.output,
            blueprintData.thesisStatement,
            blueprintData.keyContributions,
            session.paperType?.name || 'academic paper'
        );

        // Store in blueprint
        await prisma.paperBlueprint.update({
            where: { id: blueprint.id },
            data: { intentLock: lock as any },
        });

        return lock;
    }

    /**
     * Update the intent lock with partial data.
     */
    async updateIntentLock(
        sessionId: string,
        updates: Partial<ResearchIntentLock>
    ): Promise<ResearchIntentLock | null> {
        const blueprint = await prisma.paperBlueprint.findFirst({
            where: { sessionId },
            orderBy: { version: 'desc' },
        });

        if (!blueprint) return null;

        const existing = (blueprint.intentLock as unknown as ResearchIntentLock) || {};
        const merged = { ...existing, ...updates };

        await prisma.paperBlueprint.update({
            where: { id: blueprint.id },
            data: { intentLock: merged as any },
        });

        return merged;
    }

    /**
     * Format the intent lock as a compact prompt block for Pass-1 injection.
     */
    formatForPrompt(lock: ResearchIntentLock): string {
        const lines: string[] = [
            'RESEARCH INTENT LOCK (these guardrails constrain ALL sections):',
            '',
            `Thesis: ${lock.thesisStatement}`,
            `Research Questions: ${lock.researchQuestions.join(' | ')}`,
            `Contributions: ${lock.contributions.join('; ')}`,
            '',
            `Scope Boundaries (do NOT exceed):`,
            ...lock.scopeBoundaries.map(b => `  - ${b}`),
            '',
            `Allowed Claims: ${lock.allowedClaims.join('; ')}`,
            `Forbidden Claims (NEVER make these): ${lock.forbiddenClaims.join('; ')}`,
        ];

        if (lock.targetVenue?.name) {
            lines.push(`Target Venue: ${lock.targetVenue.name}${lock.targetVenue.quartile ? ` (${lock.targetVenue.quartile})` : ''}`);
        }

        return lines.join('\n');
    }

    // ===========================================================================
    // Private
    // ===========================================================================

    private buildGenerationPrompt(
        thesis: string,
        objective: string,
        contributions: string[],
        topicTitle: string,
        topicDescription: string,
        paperType: string,
        sectionKeys: string[]
    ): string {
        return `You are an academic research scope analyst. Given the following paper blueprint, generate a Research Intent Lock — a set of guardrails that constrain what the paper can and cannot claim.

PAPER BLUEPRINT:
- Title/Topic: ${topicTitle}
- Description: ${topicDescription}
- Paper Type: ${paperType}
- Thesis: ${thesis}
- Objective: ${objective}
- Key Contributions: ${contributions.join('; ')}
- Sections: ${sectionKeys.join(', ')}

Generate a JSON object with these fields:
{
  "researchQuestions": ["RQ1: ...", "RQ2: ..."],
  "thesisStatement": "${thesis}",
  "contributions": ${JSON.stringify(contributions)},
  "scopeBoundaries": ["This paper does NOT attempt to...", "Findings are bounded to..."],
  "allowedClaims": ["We demonstrate that...", "Evidence suggests..."],
  "forbiddenClaims": ["We prove that... (too strong)", "This is the first/only... (unverifiable)"],
  "paperType": "${paperType}",
  "keywords": ["keyword1", "keyword2"]
}

RULES:
- scopeBoundaries: 3-5 explicit limits on what the paper does NOT cover
- allowedClaims: 3-5 claim templates that match the study's validated impact
- forbiddenClaims: 3-5 claim types that would overextend the evidence
- Keep everything concise and specific to THIS paper

Return ONLY valid JSON. No commentary.`;
    }

    private parseResponse(
        output: string,
        fallbackThesis: string,
        fallbackContributions: string[],
        fallbackPaperType: string
    ): ResearchIntentLock {
        try {
            // Try to extract JSON from the response
            const jsonMatch = output.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    researchQuestions: Array.isArray(parsed.researchQuestions) ? parsed.researchQuestions : [],
                    thesisStatement: parsed.thesisStatement || fallbackThesis,
                    contributions: Array.isArray(parsed.contributions) ? parsed.contributions : fallbackContributions,
                    scopeBoundaries: Array.isArray(parsed.scopeBoundaries) ? parsed.scopeBoundaries : [],
                    allowedClaims: Array.isArray(parsed.allowedClaims) ? parsed.allowedClaims : [],
                    forbiddenClaims: Array.isArray(parsed.forbiddenClaims) ? parsed.forbiddenClaims : [],
                    paperType: parsed.paperType || fallbackPaperType,
                    targetVenue: parsed.targetVenue || undefined,
                    keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
                };
            }
        } catch (e) {
            console.warn('[ResearchIntentLockService] Failed to parse LLM response:', e);
        }

        // Fallback: return a minimal lock from blueprint data
        return {
            researchQuestions: [],
            thesisStatement: fallbackThesis,
            contributions: fallbackContributions,
            scopeBoundaries: [],
            allowedClaims: [],
            forbiddenClaims: [],
            paperType: fallbackPaperType,
            keywords: [],
        };
    }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const researchIntentLockService = new ResearchIntentLockService();
