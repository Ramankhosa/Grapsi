import crypto from 'crypto';
import { llmGateway, type TenantContext } from '../metering';
import type { BlueprintWithSectionPlan } from './blueprint-service';
import {
  BATCH_MAPPING_CHUNK_SIZE,
  mappingResponseSchema,
  NOT_EXTRACTED_FROM_SOURCE,
  type ExtractedCardWithIdentity,
  type EvidenceMappingUseAs,
  type EvidenceConfidenceLevel,
} from './deep-analysis-types';

interface MappingPrompt {
  system: string;
  user: string;
}

export interface CardDimensionMapping {
  cardId: string;
  sectionKey: string;
  dimension: string;
  useAs: EvidenceMappingUseAs;
  mappingConfidence: EvidenceConfidenceLevel;
}

const MAPPING_SYSTEM_PROMPT = `You are mapping extracted evidence cards to sections and dimensions of an academic paper.

INPUT:
1. Evidence cards (with cardId, claim, claimType, quantitativeDetail, citationKey, archetype, and optional tradeOff/competingExplanation)
2. Blueprint sections with mustCover dimensions

TASK:
For each card, map it to relevant section/dimension pairs and assign:
- useAs: SUPPORT | CONTRAST | CONTEXT | DEFINITION
- mappingConfidence: HIGH | MEDIUM | LOW

RULES:
1. A card can map to multiple section/dimension pairs.
2. Only map when relevance is genuine; do not force mappings.
3. Return each cardId exactly as provided in the input cards. Do not invent, truncate, or reformat IDs.
4. UseAs guidance:
   - SUPPORT: backs a claim in that dimension
   - CONTRAST: challenges or differs from expected approach/result
   - CONTEXT: background framing evidence
   - DEFINITION: formal definition or framework card
5. CONTRAST PREFERENCE:
   If tradeOff or competingExplanation contain substantive content (not default string),
   consider useAs = CONTRAST.
6. DIVERSITY GUIDANCE:
   For dimensions with 3+ cards:
   - Include CONTRAST or CONTEXT if genuine qualifying evidence exists.
   - Do NOT manufacture contrast.
   - If all evidence genuinely supports the claim, map all as SUPPORT.
7. Output JSON only.

OUTPUT FORMAT:
[
  {
    "cardId": "<cardId from input>",
    "mappings": [
      {
        "sectionKey": "methodology",
        "dimension": "Evaluation protocol and baseline comparisons",
        "useAs": "SUPPORT",
        "mappingConfidence": "HIGH"
      }
    ]
  }
]`;

function hasSubstantiveExtractionField(value: string | null | undefined): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  return Boolean(trimmed) && trimmed.toLowerCase() !== NOT_EXTRACTED_FROM_SOURCE.toLowerCase();
}

function buildMappingPrompt(
  cards: ExtractedCardWithIdentity[],
  blueprint: BlueprintWithSectionPlan
): MappingPrompt {
  const cardSummaries = cards.map((card, inputIndex) => {
    const summary: Record<string, unknown> = {
      inputIndex,
      cardId: card.cardId,
      claim: card.claim,
      claimType: card.claimType,
      quantitativeDetail: card.quantitativeDetail,
      citationKey: card.citationKey,
      archetype: card.referenceArchetype,
    };

    if (hasSubstantiveExtractionField(card.tradeOff)) {
      summary.tradeOff = card.tradeOff;
    }
    if (hasSubstantiveExtractionField(card.competingExplanation)) {
      summary.competingExplanation = card.competingExplanation;
    }

    return summary;
  });

  const blueprintStructure = blueprint.sectionPlan.map(section => ({
    sectionKey: section.sectionKey,
    sectionLabel: section.purpose,
    dimensions: section.mustCover,
  }));

  const user = [
    '=== EVIDENCE CARDS ===',
    JSON.stringify(cardSummaries, null, 2),
    '',
    '=== ALLOWED CARD IDS (COPY EXACTLY) ===',
    JSON.stringify(cards.map(card => card.cardId), null, 2),
    '',
    '=== PAPER BLUEPRINT ===',
    JSON.stringify(blueprintStructure, null, 2),
  ].join('\n');

  return {
    system: MAPPING_SYSTEM_PROMPT,
    user,
  };
}

function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2);
}

function normalizeSectionKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function normalizeDimension(value: string): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeCardId(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function inferUseAs(card: ExtractedCardWithIdentity): EvidenceMappingUseAs {
  if (hasSubstantiveExtractionField(card.tradeOff) || hasSubstantiveExtractionField(card.competingExplanation)) {
    return 'CONTRAST';
  }
  if (card.claimType === 'DEFINITION' || card.claimType === 'FRAMEWORK') {
    return 'DEFINITION';
  }
  if (card.claimType === 'LIMITATION' || card.claimType === 'GAP') {
    return 'CONTRAST';
  }
  return 'SUPPORT';
}

function heuristicMapCards(
  cards: ExtractedCardWithIdentity[],
  blueprint: BlueprintWithSectionPlan
): CardDimensionMapping[] {
  const mappings: CardDimensionMapping[] = [];

  for (const card of cards) {
    const cardTokens = new Set(tokenize(`${card.claim} ${card.quantitativeDetail || ''} ${card.studyDesign || ''}`));
    const candidates: Array<{
      sectionKey: string;
      dimension: string;
      score: number;
    }> = [];

    for (const section of blueprint.sectionPlan) {
      for (const dimension of section.mustCover || []) {
        const dimensionTokens = tokenize(dimension);
        if (dimensionTokens.length === 0) continue;
        const overlap = dimensionTokens.filter(token => cardTokens.has(token)).length;
        const score = overlap / dimensionTokens.length;
        if (score > 0) {
          candidates.push({ sectionKey: section.sectionKey, dimension, score });
        }
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score || a.sectionKey.localeCompare(b.sectionKey) || a.dimension.localeCompare(b.dimension));
      const bestScore = candidates[0].score;
      const minScore = Math.max(0.2, bestScore * 0.45);
      const maxMappings = card.claimType === 'DEFINITION' || card.claimType === 'FRAMEWORK' ? 2 : 3;

      let added = 0;
      for (const candidate of candidates) {
        if (candidate.score < minScore || added >= maxMappings) {
          continue;
        }
        mappings.push({
          cardId: card.cardId,
          sectionKey: candidate.sectionKey,
          dimension: candidate.dimension,
          useAs: inferUseAs(card),
          mappingConfidence: candidate.score >= 0.6 ? 'HIGH' : candidate.score >= 0.3 ? 'MEDIUM' : 'LOW',
        });
        added += 1;
      }
    }

    if (!mappings.some(mapping => mapping.cardId === card.cardId) && candidates.length > 0) {
      const best = candidates[0];
      mappings.push({
        cardId: card.cardId,
        sectionKey: best.sectionKey,
        dimension: best.dimension,
        useAs: inferUseAs(card),
        mappingConfidence: best.score >= 0.6 ? 'HIGH' : best.score >= 0.3 ? 'MEDIUM' : 'LOW',
      });
    }
  }

  return mappings;
}

function dedupeMappings(mappings: CardDimensionMapping[]): CardDimensionMapping[] {
  const rank: Record<EvidenceConfidenceLevel, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const byKey = new Map<string, CardDimensionMapping>();

  for (const mapping of mappings) {
    const key = `${mapping.cardId}::${mapping.sectionKey}::${mapping.dimension}`;
    const existing = byKey.get(key);
    if (!existing || rank[mapping.mappingConfidence] > rank[existing.mappingConfidence]) {
      byKey.set(key, mapping);
    }
  }

  return Array.from(byKey.values());
}

const MAPPING_MAX_RETRIES = 1;
const MAPPING_RETRY_DELAY_MS = 2_000;

class EvidenceMappingService {
  private async callMappingLLM(
    prompt: MappingPrompt,
    idempotencyKey: string,
    cards: ExtractedCardWithIdentity[],
    blueprint: BlueprintWithSectionPlan,
    tenantContext?: TenantContext | null
  ): Promise<{ rawOutput: string; usage: { inputTokens: number; outputTokens: number } }> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAPPING_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`[EvidenceMapping] Retrying mapping (attempt ${attempt}/${MAPPING_MAX_RETRIES}) after ${MAPPING_RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, MAPPING_RETRY_DELAY_MS));
      }

      try {
        const attemptKey = attempt > 0 ? `${idempotencyKey}_r${attempt}` : idempotencyKey;

        const response = await llmGateway.executeLLMOperation(
          tenantContext ? { tenantContext } : { headers: {} },
          {
            taskCode: 'LLM2_DRAFT',
            stageCode: 'PAPER_REVIEW_COHERENCE',
            prompt: `${prompt.system}\n\n${prompt.user}`,
            parameters: {
              purpose: 'evidence_dimension_mapping',
              temperature: 0,
            },
            idempotencyKey: attemptKey,
            metadata: {
              purpose: 'evidence_dimension_mapping',
              cards: cards.length,
              sections: blueprint.sectionPlan.length,
              attempt,
            },
          }
        );

        if (!response.success || !response.response) {
          const err = new Error(response.error?.message || 'Mapping LLM call failed');
          console.error(`[EvidenceMapping] LLM call failed (attempt ${attempt}):`, response.error?.message);
          if (attempt < MAPPING_MAX_RETRIES) {
            lastError = err;
            continue;
          }
          throw err;
        }

        return {
          rawOutput: String(response.response.output || '').trim(),
          usage: {
            inputTokens: Number((response.response.metadata as any)?.inputTokens || 0),
            outputTokens: Number(response.response.outputTokens || 0),
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[EvidenceMapping] Attempt ${attempt} failed: ${lastError.message}`);
        if (attempt < MAPPING_MAX_RETRIES) {
          continue;
        }
        throw lastError;
      }
    }

    throw lastError || new Error('Mapping LLM call failed after retries');
  }

  async mapCardsToDimensions(
    cards: ExtractedCardWithIdentity[],
    blueprint: BlueprintWithSectionPlan,
    tenantContext?: TenantContext | null
  ): Promise<{ mappings: CardDimensionMapping[]; warnings: string[]; usage: { inputTokens: number; outputTokens: number } }> {
    if (!cards.length || !blueprint.sectionPlan.length) {
      return {
        mappings: [],
        warnings: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    const warnings: string[] = [];
    const prompt = buildMappingPrompt(cards, blueprint);

    const cardFingerprint = cards.map(c => c.cardId).sort().join(',');
    const sectionFingerprint = blueprint.sectionPlan.map(s => s.sectionKey).sort().join(',');
    const mappingIdempotencyKey = `evidence_map_${crypto.createHash('md5').update(`${cardFingerprint}|${sectionFingerprint}`).digest('hex').slice(0, 16)}`;

    let rawOutput: string;
    let usage = { inputTokens: 0, outputTokens: 0 };

    try {
      const llmResult = await this.callMappingLLM(prompt, mappingIdempotencyKey, cards, blueprint, tenantContext);
      rawOutput = llmResult.rawOutput;
      usage = llmResult.usage;
    } catch (llmError) {
      const message = llmError instanceof Error ? llmError.message : 'Unknown error';
      warnings.push(`Mapping LLM failed after retry: ${message.slice(0, 200)}. Used heuristic fallback.`);
      const fallback = heuristicMapCards(cards, blueprint);
      return {
        mappings: dedupeMappings(fallback),
        warnings,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    let parsedRaw: unknown;
    const fenced = rawOutput.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : rawOutput;

    try {
      parsedRaw = JSON.parse(candidate);
    } catch {
      const start = candidate.indexOf('[');
      const end = candidate.lastIndexOf(']');
      if (start !== -1 && end > start) {
        parsedRaw = JSON.parse(candidate.slice(start, end + 1));
        warnings.push('Mapping JSON recovered from partial response');
      } else {
        warnings.push('Mapping output could not be parsed, used heuristic fallback');
        const fallback = heuristicMapCards(cards, blueprint);
        return {
          mappings: dedupeMappings(fallback),
          warnings,
          usage,
        };
      }
    }

    const parsed = mappingResponseSchema.safeParse(parsedRaw);
    if (!parsed.success) {
      warnings.push(`Mapping validation failed (${parsed.error.errors[0]?.message || 'invalid output'}), used heuristic fallback`);
      const fallback = heuristicMapCards(cards, blueprint);
      return {
        mappings: dedupeMappings(fallback),
        warnings,
        usage,
      };
    }

    const idMap = new Map<string, string>();
    const normalizedIdMap = new Map<string, string>();
    cards.forEach((card, index) => {
      const aliases = new Set([
        card.cardId,
        `card_${index}`,
      ]);
      aliases.forEach(alias => {
        const clean = String(alias || '').trim();
        if (!clean) return;
        if (!idMap.has(clean)) {
          idMap.set(clean, card.cardId);
        }
        const normalized = normalizeCardId(clean);
        if (normalized && !normalizedIdMap.has(normalized)) {
          normalizedIdMap.set(normalized, card.cardId);
        }
      });
    });

    const sectionKeyMap = new Map<string, string>();
    const dimensionsBySection = new Map<string, Map<string, string>>();
    blueprint.sectionPlan.forEach(section => {
      sectionKeyMap.set(section.sectionKey, section.sectionKey);
      sectionKeyMap.set(normalizeSectionKey(section.sectionKey), section.sectionKey);

      const dimMap = new Map<string, string>();
      for (const dimension of section.mustCover || []) {
        const normalized = normalizeDimension(dimension);
        if (!dimMap.has(normalized)) {
          dimMap.set(normalized, dimension);
        }
      }
      dimensionsBySection.set(section.sectionKey, dimMap);
    });

    const mappings: CardDimensionMapping[] = [];

    for (const cardMapping of parsed.data) {
      const rawCardId = String(cardMapping.cardId || '').trim();
      const resolvedCardId = idMap.get(rawCardId) || normalizedIdMap.get(normalizeCardId(rawCardId));
      if (!resolvedCardId) {
        warnings.push(`Dropped mapping for unknown card id: ${rawCardId || '(empty)'}`);
        continue;
      }

      for (const mapping of cardMapping.mappings) {
        const sectionKeyInput = String(mapping.sectionKey || '').trim();
        const resolvedSectionKey = sectionKeyMap.get(sectionKeyInput) || sectionKeyMap.get(normalizeSectionKey(sectionKeyInput));
        if (!resolvedSectionKey) {
          warnings.push(`Dropped mapping with invalid sectionKey: ${mapping.sectionKey}`);
          continue;
        }

        const validDimensions = dimensionsBySection.get(resolvedSectionKey);
        const resolvedDimension = validDimensions?.get(normalizeDimension(mapping.dimension));
        if (!resolvedDimension) {
          warnings.push(`Dropped mapping with invalid dimension for section ${resolvedSectionKey}`);
          continue;
        }

        mappings.push({
          cardId: resolvedCardId,
          sectionKey: resolvedSectionKey,
          dimension: resolvedDimension,
          useAs: mapping.useAs,
          mappingConfidence: mapping.mappingConfidence,
        });
      }
    }

    if (mappings.length === 0) {
      warnings.push('LLM mapping returned no valid rows, used heuristic fallback');
      mappings.push(...heuristicMapCards(cards, blueprint));
    }

    return {
      mappings: dedupeMappings(mappings),
      warnings,
      usage,
    };
  }

  async batchMapMultipleCitations(
    cards: ExtractedCardWithIdentity[],
    blueprint: BlueprintWithSectionPlan,
    tenantContext?: TenantContext | null
  ): Promise<{ mappings: CardDimensionMapping[]; warnings: string[]; usage: { inputTokens: number; outputTokens: number } }> {
    if (!cards.length || !blueprint.sectionPlan.length) {
      return { mappings: [], warnings: [], usage: { inputTokens: 0, outputTokens: 0 } };
    }

    const chunkSize = BATCH_MAPPING_CHUNK_SIZE;
    const chunks: ExtractedCardWithIdentity[][] = [];
    for (let i = 0; i < cards.length; i += chunkSize) {
      chunks.push(cards.slice(i, i + chunkSize));
    }

    console.log(`[EvidenceMapping] Batch mapping ${cards.length} cards in ${chunks.length} chunk(s) (chunkSize=${chunkSize})`);

    const results = await Promise.all(
      chunks.map(chunk => this.mapCardsToDimensions(chunk, blueprint, tenantContext))
    );

    const allMappings: CardDimensionMapping[] = [];
    const allWarnings: string[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const result of results) {
      allMappings.push(...result.mappings);
      allWarnings.push(...result.warnings);
      totalInputTokens += result.usage.inputTokens;
      totalOutputTokens += result.usage.outputTokens;
    }

    return {
      mappings: dedupeMappings(allMappings),
      warnings: allWarnings,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    };
  }
}

export const evidenceMappingService = new EvidenceMappingService();
export { EvidenceMappingService, buildMappingPrompt };
