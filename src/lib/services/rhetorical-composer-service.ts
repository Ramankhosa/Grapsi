import crypto from 'crypto';
import { llmGateway, type TenantContext } from '../metering';
import type { ResearchIntentLock } from './research-intent-lock-service';
import type { RhetoricalBlueprint, RhetoricalSlot } from './rhetorical-blueprint-service';

export interface ContributionLockValidation {
  passed: boolean;
  violations: string[];
  inspectedParagraphs: number;
  requiredSlotsChecked: number;
  slotViolations: Array<{
    slotKey: string;
    issue: string;
    expectedPlacement?: string;
    matchedParagraphIndex?: number;
  }>;
}

export interface RhetoricalComposerResult {
  applied: boolean;
  content: string;
  promptUsed?: string;
  tokensUsed?: number;
  validation: ContributionLockValidation;
  retries: number;
}

function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function splitParagraphs(content: string): string[] {
  return String(content || '')
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function normalizePhrase(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeLoose(text: string): string[] {
  return normalizePhrase(text)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);
}

function splitCamelTokens(text: string): string[] {
  return String(text || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/g)
    .map((token) => normalizePhrase(token))
    .filter((token) => token.length >= 3);
}

function toSlotLookupKey(text: string): string {
  return normalizePhrase(text).replace(/\s+/g, '_');
}

function isContributionSlot(slot: RhetoricalSlot): boolean {
  return /contribution/i.test(String(slot.key || ''));
}

const SLOT_HINTS: Record<string, string[]> = {
  // Introduction slots
  contextbackground: ['context', 'background', 'domain context'],
  gapresearchquestion: ['gap', 'research question', 'unresolved', 'unknown'],
  contributions: ['contribution', 'we contribute', 'this paper contributes', 'our contributions'],
  paperstructure: ['paper is organized', 'remainder of this paper', 'the rest of this paper'],
  // Literature review slots
  researchlandscape: ['research landscape', 'prior work', 'literature'],
  thematicsynthesis: ['thematic synthesis', 'themes', 'synthesis'],
  limitations: ['limitation', 'shortcoming', 'constraint'],
  studypositioning: ['position this study', 'we position', 'situate this study'],
  // Methodology slots
  researchdesign: ['research design', 'design rationale', 'method design'],
  systemarchitecture: ['system architecture', 'architecture', 'framework'],
  dataprotocol: ['data protocol', 'dataset', 'sampling', 'preprocessing'],
  evaluationstrategy: ['evaluation strategy', 'metrics', 'baseline', 'evaluation protocol'],
  implementationdetails: ['implementation details', 'tooling', 'runtime environment'],
  // Results slots
  experimentalcontext: ['experimental context', 'experimental setup', 'setup'],
  empiricalfindings: ['empirical findings', 'results show', 'findings'],
  comparativeanalysis: ['comparative analysis', 'comparison', 'baseline comparison'],
  robustness: ['robustness', 'sensitivity', 'ablation'],
  // Discussion slots
  interpretation: ['interpretation', 'we interpret', 'meaning of results'],
  relationtoliterature: ['relation to literature', 'prior work', 'consistent with', 'contradict'],
  implications: ['implications', 'practical implications', 'theoretical implications'],
  limitationsfuture: ['limitations', 'future work', 'future research'],
  // Conclusion slots
  synthesisrecap: ['in summary', 'this study', 'this paper', 'we have shown', 'our findings', 'key findings', 'this work'],
  contributionsignificance: ['contribution', 'significance', 'advance', 'we contribute', 'novel', 'this work contributes'],
  practicalimplications: ['practical implications', 'practitioners', 'policy', 'applied', 'real-world'],
  limitationsandfuturedirections: ['limitation', 'future work', 'future research', 'further investigation', 'remains to be'],
  closingstatement: ['in conclusion', 'concluding', 'ultimately', 'taken together', 'overall'],
  // Abstract slots
  backgroundmotivation: ['background', 'motivation', 'growing', 'increasing', 'despite', 'challenge'],
  objectivescope: ['this study', 'this paper', 'we propose', 'aim', 'objective', 'purpose'],
  methodapproach: ['method', 'approach', 'using', 'employ', 'conduct', 'analyze'],
  keyfindings: ['results', 'findings', 'show', 'demonstrate', 'reveal', 'indicate'],
  significanceimplication: ['significance', 'implications', 'contributes to', 'advance', 'suggest'],
};

function normalizePlacement(placement: string): 'start' | 'middle' | 'end' | 'final' {
  const value = normalizePhrase(placement);
  if (value.includes('final')) return 'final';
  if (value.includes('start') || value.includes('opening') || value.includes('begin')) return 'start';
  if (value.includes('end') || value.includes('close') || value.includes('conclusion')) return 'end';
  return 'middle';
}

function isIndexWithinPlacement(index: number, paragraphCount: number, placement: string): boolean {
  if (paragraphCount <= 1) return true;

  const zone = normalizePlacement(placement);
  const edgeSize = Math.max(1, Math.ceil(paragraphCount * 0.34));
  const startMax = edgeSize - 1;
  const endMin = Math.max(0, paragraphCount - edgeSize);

  if (zone === 'final') return index === paragraphCount - 1;
  if (zone === 'start') return index <= startMax;
  if (zone === 'end') return index >= endMin;

  if (paragraphCount <= 2) return true;
  const middleStart = Math.floor(paragraphCount * 0.25);
  const middleEnd = Math.max(middleStart, Math.ceil(paragraphCount * 0.75) - 1);
  return index >= middleStart && index <= middleEnd;
}

function buildSlotHints(slot: RhetoricalSlot): string[] {
  const lookupKey = toSlotLookupKey(slot.key).replace(/_/g, '');
  const mapped = SLOT_HINTS[lookupKey] || [];
  const keyTokens = splitCamelTokens(slot.key);
  const intentTokens = splitCamelTokens(slot.intent).slice(0, 4);
  const hints = dedupe([
    ...mapped.map(entry => normalizePhrase(entry)),
    ...keyTokens,
    ...intentTokens,
  ]);
  return hints.filter(Boolean);
}

function scoreSlotParagraph(slot: RhetoricalSlot, paragraph: string): number {
  const normalizedParagraph = normalizePhrase(paragraph);
  const paragraphTokens = new Set(tokenizeLoose(paragraph));
  const hints = buildSlotHints(slot);

  let score = 0;
  for (const hint of hints) {
    const normalizedHint = normalizePhrase(hint);
    if (!normalizedHint) continue;
    const parts = normalizedHint.split(' ').filter(Boolean);
    if (parts.length > 1) {
      if (normalizedParagraph.includes(normalizedHint)) score += 3;
      continue;
    }
    if (paragraphTokens.has(normalizedHint)) score += 2;
  }

  if (isContributionSlot(slot) && hasContributionSignal(paragraph)) {
    score += 3;
  }

  return score;
}

function findBestSlotParagraphIndex(slot: RhetoricalSlot, paragraphs: string[]): number | null {
  let bestIndex: number | null = null;
  let bestScore = 0;

  for (let index = 0; index < paragraphs.length; index += 1) {
    const score = scoreSlotParagraph(slot, paragraphs[index]);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestScore >= 3 ? bestIndex : null;
}

function hasContributionSignal(paragraph: string): boolean {
  return /(contribution|we\s+(contribute|propose|present|introduce)|this\s+paper\s+(contributes|proposes|presents|introduces))/i
    .test(paragraph);
}

function contributionSimilarity(paragraph: string, contribution: string): number {
  const pTokens = new Set(tokenize(paragraph));
  const cTokens = dedupe(tokenize(contribution));
  if (pTokens.size === 0 || cTokens.length === 0) return 0;

  let overlap = 0;
  for (const token of cTokens) {
    if (pTokens.has(token)) overlap += 1;
  }

  return overlap / cTokens.length;
}

function buildContributionValidation(
  content: string,
  allowedContributions: string[],
  rhetoricalBlueprint: RhetoricalBlueprint | null | undefined
): ContributionLockValidation {
  const paragraphs = splitParagraphs(content);
  const contributionParagraphIndexes = paragraphs
    .map((paragraph, index) => ({ paragraph, index }))
    .filter((entry) => hasContributionSignal(entry.paragraph))
    .map((entry) => entry.index);

  const requiredSlots = (rhetoricalBlueprint?.slots || []).filter((slot) => slot.required);
  const violations: string[] = [];
  const slotViolations: ContributionLockValidation['slotViolations'] = [];
  const contributionSlotIndexes: number[] = [];

  for (const slot of requiredSlots) {
    const matchedIndex = findBestSlotParagraphIndex(slot, paragraphs);
    if (matchedIndex === null) {
      const issue = `Missing required rhetorical slot "${slot.key}".`;
      violations.push(issue);
      slotViolations.push({
        slotKey: slot.key,
        issue: 'missing_required_slot',
        expectedPlacement: slot.placement,
      });
      continue;
    }

    if (isContributionSlot(slot)) {
      contributionSlotIndexes.push(matchedIndex);
    }

    if (!isIndexWithinPlacement(matchedIndex, paragraphs.length, slot.placement)) {
      const issue = `Rhetorical slot "${slot.key}" is outside expected ${slot.placement} placement window.`;
      violations.push(issue);
      slotViolations.push({
        slotKey: slot.key,
        issue: 'placement_mismatch',
        expectedPlacement: slot.placement,
        matchedParagraphIndex: matchedIndex,
      });
    }
  }

  const allContributionIndexes = dedupe([
    ...contributionParagraphIndexes.map((index) => String(index)),
    ...contributionSlotIndexes.map((index) => String(index)),
  ]).map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
  const contributionParagraphs = allContributionIndexes
    .map((index) => paragraphs[index])
    .filter(Boolean);

  const requireContributionParagraph = requiredSlots.some(isContributionSlot);
  if (requireContributionParagraph && contributionParagraphs.length === 0) {
    violations.push('Missing contributions paragraph required by rhetorical blueprint.');
  }

  if (allowedContributions.length > 0) {
    for (const paragraph of contributionParagraphs) {
      let maxSimilarity = 0;
      for (const contribution of allowedContributions) {
        const similarity = contributionSimilarity(paragraph, contribution);
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
        }
      }

      if (maxSimilarity < 0.2) {
        violations.push('Contribution paragraph contains claims outside ResearchIntentLock.');
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    inspectedParagraphs: contributionParagraphs.length,
    requiredSlotsChecked: requiredSlots.length,
    slotViolations,
  };
}

function buildComposerPrompt(params: {
  sectionKey: string;
  currentContent: string;
  rhetoricalBlueprint: RhetoricalBlueprint;
  thesisStatement?: string;
  allowedContributions: string[];
  evidenceDigestSummary?: string;
}): string {
  const slots = params.rhetoricalBlueprint.slots.map((slot, index) => ({
    order: index + 1,
    key: slot.key,
    required: slot.required,
    placement: slot.placement,
    intent: slot.intent,
    constraints: slot.constraints,
    citationPolicy: slot.citationPolicy,
  }));

  return `You are a rhetorical-composer pass. Repair the section so required rhetorical moves are present while preserving existing thematic content and citations.

SECTION KEY: ${params.sectionKey}

Rhetorical blueprint:
${JSON.stringify(slots, null, 2)}

ResearchIntentLock contributions (hard boundary):
Thesis: ${String(params.thesisStatement || '(not provided)')}
${params.allowedContributions.length > 0 ? params.allowedContributions.map((entry, index) => `${index + 1}. ${entry}`).join('\n') : '(none provided)'}

Evidence digest summary (optional grounding):
${String(params.evidenceDigestSummary || '(not provided)')}

Current section draft:
${params.currentContent}

Rules:
- Keep thematic paragraphs and citation anchors intact as much as possible.
- Insert or repair rhetorical paragraphs only where needed.
- Do not add claims outside ResearchIntentLock contributions.
- Respect slot placement intent (start/middle/end/final).
- Keep changes minimal and coherent.
- Rhetorical citations are optional and must obey slot citation policy.

Return ONLY clean markdown section text.`;
}

function buildContributionRewritePrompt(params: {
  sectionKey: string;
  content: string;
  thesisStatement?: string;
  allowedContributions: string[];
  violations: string[];
}): string {
  return `Fix contribution-lock violations in this section.

SECTION KEY: ${params.sectionKey}
Thesis boundary: ${String(params.thesisStatement || '(not provided)')}

Allowed contributions (use only these):
${params.allowedContributions.map((entry, index) => `${index + 1}. ${entry}`).join('\n')}

Detected issues:
${params.violations.map((entry, index) => `${index + 1}. ${entry}`).join('\n')}

Current section:
${params.content}

Rewrite rules:
- Rewrite only rhetorical-slot and contribution-oriented sentences/paragraphs.
- Keep all non-contribution content and citation anchors stable.
- Do not introduce new contribution claims.
- If needed, replace contribution wording with lock-aligned phrasing.

Return ONLY clean markdown section text.`;
}

async function executeRewrite(params: {
  sessionId: string;
  sectionKey: string;
  prompt: string;
  purpose: string;
  tenantContext?: TenantContext | null;
  requestHeaders?: Record<string, string>;
  attempt?: number;
}): Promise<{ content: string; tokensUsed?: number }> {
  const response = await llmGateway.executeLLMOperation(
    params.tenantContext ? { tenantContext: params.tenantContext } : { headers: params.requestHeaders || {} },
    {
      taskCode: 'LLM2_DRAFT',
      stageCode: 'PAPER_SECTION_DRAFT',
      prompt: params.prompt,
      parameters: {
        purpose: params.purpose,
        temperature: 0.2,
      },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        sessionId: params.sessionId,
        sectionKey: params.sectionKey,
        purpose: params.purpose,
        attempt: params.attempt || 0,
      },
    }
  );

  if (!response.success || !response.response?.output) {
    throw new Error(response.error?.message || `${params.purpose} failed`);
  }

  return {
    content: String(response.response.output || '').trim(),
    tokensUsed: response.response.outputTokens,
  };
}

class RhetoricalComposerService {
  async applyPass2B(params: {
    sessionId: string;
    sectionKey: string;
    content: string;
    rhetoricalBlueprint: RhetoricalBlueprint | null | undefined;
    researchIntentLock?: ResearchIntentLock | null;
    fallbackContributions?: string[];
    evidenceDigestSummary?: string;
    tenantContext?: TenantContext | null;
    requestHeaders?: Record<string, string>;
  }): Promise<RhetoricalComposerResult> {
    const initialContent = String(params.content || '').trim();
    const rhetorical = params.rhetoricalBlueprint;
    if (!initialContent || !rhetorical?.enabled || !rhetorical.slots?.length) {
      return {
        applied: false,
        content: initialContent,
        validation: {
          passed: true,
          violations: [],
          inspectedParagraphs: 0,
          requiredSlotsChecked: 0,
          slotViolations: []
        },
        retries: 0,
      };
    }

    const lockContributions = Array.isArray(params.researchIntentLock?.contributions)
      ? params.researchIntentLock!.contributions.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const fallbackContributions = Array.isArray(params.fallbackContributions)
      ? params.fallbackContributions.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const allowedContributions = lockContributions.length > 0 ? lockContributions : fallbackContributions;
    const thesisStatement = String(params.researchIntentLock?.thesisStatement || '').trim();

    let content = initialContent;
    let tokensUsed = 0;
    let retries = 0;
    let promptUsed: string | undefined;

    const composePrompt = buildComposerPrompt({
      sectionKey: params.sectionKey,
      currentContent: content,
      rhetoricalBlueprint: rhetorical,
      thesisStatement,
      allowedContributions,
      evidenceDigestSummary: params.evidenceDigestSummary,
    });

    const composed = await executeRewrite({
      sessionId: params.sessionId,
      sectionKey: params.sectionKey,
      prompt: composePrompt,
      purpose: 'paper_section_rhetorical_pass2b',
      tenantContext: params.tenantContext,
      requestHeaders: params.requestHeaders,
      attempt: 0,
    });
    content = composed.content;
    tokensUsed += composed.tokensUsed || 0;
    promptUsed = composePrompt;

    let validation = buildContributionValidation(
      content,
      allowedContributions,
      rhetorical
    );

    const maxRetries = 2;
    while (!validation.passed && retries < maxRetries) {
      retries += 1;
      const rewritePrompt = buildContributionRewritePrompt({
        sectionKey: params.sectionKey,
        content,
        thesisStatement,
        allowedContributions,
        violations: validation.violations,
      });
      const rewritten = await executeRewrite({
        sessionId: params.sessionId,
        sectionKey: params.sectionKey,
        prompt: rewritePrompt,
        purpose: 'paper_section_rhetorical_contribution_rewrite',
        tenantContext: params.tenantContext,
        requestHeaders: params.requestHeaders,
        attempt: retries,
      });
      content = rewritten.content;
      tokensUsed += rewritten.tokensUsed || 0;
      promptUsed = rewritePrompt;

      validation = buildContributionValidation(
        content,
        allowedContributions,
        rhetorical
      );
    }

    return {
      applied: true,
      content,
      promptUsed,
      tokensUsed: tokensUsed > 0 ? tokensUsed : undefined,
      validation,
      retries,
    };
  }

  async enforceContributionLock(params: {
    sessionId: string;
    sectionKey: string;
    content: string;
    rhetoricalBlueprint: RhetoricalBlueprint | null | undefined;
    researchIntentLock?: ResearchIntentLock | null;
    fallbackContributions?: string[];
    tenantContext?: TenantContext | null;
    requestHeaders?: Record<string, string>;
  }): Promise<RhetoricalComposerResult> {
    const initialContent = String(params.content || '').trim();
    const rhetorical = params.rhetoricalBlueprint;
    if (!initialContent || !rhetorical?.enabled || !rhetorical.slots?.length) {
      return {
        applied: false,
        content: initialContent,
        validation: {
          passed: true,
          violations: [],
          inspectedParagraphs: 0,
          requiredSlotsChecked: 0,
          slotViolations: []
        },
        retries: 0,
      };
    }

    const lockContributions = Array.isArray(params.researchIntentLock?.contributions)
      ? params.researchIntentLock!.contributions.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const fallbackContributions = Array.isArray(params.fallbackContributions)
      ? params.fallbackContributions.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const allowedContributions = lockContributions.length > 0 ? lockContributions : fallbackContributions;
    const thesisStatement = String(params.researchIntentLock?.thesisStatement || '').trim();

    let content = initialContent;
    let validation = buildContributionValidation(content, allowedContributions, rhetorical);
    let retries = 0;
    let tokensUsed = 0;
    let promptUsed: string | undefined;

    const maxRetries = 2;
    while (!validation.passed && retries < maxRetries) {
      retries += 1;
      const rewritePrompt = buildContributionRewritePrompt({
        sectionKey: params.sectionKey,
        content,
        thesisStatement,
        allowedContributions,
        violations: validation.violations,
      });

      const rewritten = await executeRewrite({
        sessionId: params.sessionId,
        sectionKey: params.sectionKey,
        prompt: rewritePrompt,
        purpose: 'paper_section_contribution_lock_rewrite',
        tenantContext: params.tenantContext,
        requestHeaders: params.requestHeaders,
        attempt: retries,
      });

      content = rewritten.content;
      tokensUsed += rewritten.tokensUsed || 0;
      promptUsed = rewritePrompt;
      validation = buildContributionValidation(content, allowedContributions, rhetorical);
    }

    return {
      applied: retries > 0,
      content,
      promptUsed,
      tokensUsed: tokensUsed > 0 ? tokensUsed : undefined,
      validation,
      retries,
    };
  }
}

export const rhetoricalComposerService = new RhetoricalComposerService();
export { RhetoricalComposerService, buildContributionValidation };
