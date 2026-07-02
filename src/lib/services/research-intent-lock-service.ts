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
    source?: string;
    version?: string;
    ideaAnchorHash?: string;
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

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function strings(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
}

function buildGrantAnchorIntentLock(freezePayload: unknown): ResearchIntentLock | null {
    const payload = asRecord(freezePayload);
    const anchor = asRecord(payload.ideaAnchor);
    const ideaAnchorHash = String(payload.ideaAnchorHash || '').trim();
    const summary = String(anchor.oneSentenceSummary || '').trim();
    if (!ideaAnchorHash || !summary) return null;

    const scopeBoundaries = strings(anchor.scopeBoundaries);
    return {
        source: 'grant_idea_anchor',
        version: String(anchor.version || 'idea_anchor_v1'),
        ideaAnchorHash,
        researchQuestions: strings(anchor.unresolvedQuestions),
        thesisStatement: summary,
        contributions: [...strings(anchor.distinguishingFeatures), ...strings(anchor.funderFit)].slice(0, 7),
        scopeBoundaries,
        allowedClaims: strings(anchor.nonNegotiables),
        forbiddenClaims: scopeBoundaries.map((item) => `Do not expand beyond: ${item}`),
        paperType: 'grant proposal',
        keywords: strings(anchor.keywords),
    };
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

        const linkedGrantSession = await prisma.grantSession.findUnique({
            where: { draftingSessionId: sessionId },
            select: { blueprint: { select: { freezePayloadJson: true } } },
        });
        const currentGrantLock = buildGrantAnchorIntentLock(linkedGrantSession?.blueprint?.freezePayloadJson);

        // Grant re-handoffs can replace the anchor after a lock was first stored.
        // Rebuild deterministically before any drafting prompt can reuse a stale lock.
        if (blueprint.intentLock && typeof blueprint.intentLock === 'object') {
            const storedLock = blueprint.intentLock as unknown as ResearchIntentLock;
            if (currentGrantLock && storedLock.ideaAnchorHash !== currentGrantLock.ideaAnchorHash) {
                await prisma.paperBlueprint.update({
                    where: { id: blueprint.id },
                    data: { intentLock: currentGrantLock as any },
                });
                return currentGrantLock;
            }
            return storedLock;
        }
        if (currentGrantLock) {
            await prisma.paperBlueprint.update({
                where: { id: blueprint.id },
                data: { intentLock: currentGrantLock as any },
            });
            return currentGrantLock;
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
        if (existing?.source === 'grant_idea_anchor') {
            throw new Error('Grant-derived intent locks are controlled by Grant Prep. Change the finalized grant idea instead.');
        }
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
