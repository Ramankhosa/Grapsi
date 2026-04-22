import { formatGrantComplianceContractForPrompt } from '@/lib/grants/compliance'
import {
  buildGrantPromptProfile,
  formatGrantPromptProfileForPrompt,
} from '@/lib/grants/promptProfile'
import { systemPromptTemplateService, TEMPLATE_KEYS } from '@/lib/services/system-prompt-template-service'
import type {
  GrantCitationMode,
  GrantPrepPromptBundle,
  GrantRuleProfile,
  GrantSectionComplianceContract,
  GrantSectionSemantic,
  GrantTemplateIntent,
} from '@/types/grant'

type GrantPromptSectionType = 'narrative' | 'short_answer' | 'checklist' | 'table' | 'budget_rows' | string

export interface GrantPromptSummary {
  projectTitle?: string | null
  fundingCallTitle?: string | null
  agencyName?: string | null
  freezeSummary?: string[]
}

export interface GrantPass1MemoryContext {
  sectionIntent?: string | null
  openingStrategy?: string | null
  closingStrategy?: string | null
  sectionOutline?: string[] | null
}

export interface GrantPromptComposerInput {
  pass: 'pass1' | 'pass2'
  outputMode?: 'markdown' | 'pass1_json'
  sectionKey: string
  displayLabel?: string | null
  sectionType?: GrantPromptSectionType | null
  reviewerIntent?: string | null
  citationMode?: GrantCitationMode | null
  grantSemantic?: GrantSectionSemantic | null
  templateIntent?: GrantTemplateIntent | null
  grantContextSummary?: GrantPromptSummary | null
  grantRuleProfile?: GrantRuleProfile | null
  grantSectionComplianceContract?: GrantSectionComplianceContract | null
  authoritativePrepBundle?: GrantPrepPromptBundle | null
  relatedPrepAwareness?: GrantPrepPromptBundle | null
  thesisStatement?: string | null
  centralObjective?: string | null
  keyContributions?: string[]
  purpose?: string | null
  mustCover?: string[]
  mustAvoid?: string[]
  wordBudget?: number | null
  characterLimit?: number | null
  topicContextBlock?: string
  evidenceBlock?: string
  coverageBlock?: string
  figureBlock?: string
  previousSectionContextBlock?: string
  styleBlock?: string
  userInstructions?: string
  baseContent?: string
  pass1Memory?: GrantPass1MemoryContext | null
  retryNoticeBlock?: string
  dimensionCitationHints?: Array<{
    dimension: string
    citationKeys: string[]
  }>
  requiredCitationKeys?: string[]
}

function normalizeScopeValue(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return normalized || null
}

function dedupeStrings(items: Array<string | null | undefined>, limit?: number): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const item of items) {
    const normalized = String(item || '').trim().replace(/\s+/g, ' ')
    const identity = normalized.toLowerCase()
    if (!normalized || seen.has(identity)) continue
    seen.add(identity)
    next.push(normalized)
    if (limit && next.length >= limit) break
  }
  return next
}

function formatSectionLabel(sectionKey: string): string {
  return String(sectionKey || '')
    .trim()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function normalizeDimensionKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function formatPromptBundle(title: string, bundle?: GrantPrepPromptBundle | null, awareness = false): string {
  const bullets = bundle?.bullets || []
  const keywords = bundle?.keywords || []
  const stageKeys = bundle?.stageKeys || []
  if (bullets.length === 0 && keywords.length === 0) {
    return awareness
      ? `${title}:\n- None captured from related sections.`
      : `${title}:\n- No finalized section-mapped Grant Prep points are available for this section.`
  }

  return [
    `${title}:`,
    awareness
      ? '- Awareness only: use this to maintain coherence, not to invent new required claims.'
      : '- Treat these as the factual backbone for this section when they apply.',
    stageKeys.length > 0 ? `- Stage families: ${stageKeys.join(', ')}` : '',
    bullets.length > 0 ? bullets.map((item) => `- ${item}`).join('\n') : '',
    keywords.length > 0 ? `- Keywords: ${keywords.join(', ')}` : '',
  ].filter(Boolean).join('\n')
}

function formatGrantRulesBlock(profile?: GrantRuleProfile | null): string {
  if (!profile) return ''
  const parts = [
    profile.requiredPoints.length > 0
      ? `Required points:\n${profile.requiredPoints.map((item) => `- ${item}`).join('\n')}`
      : '',
    profile.evaluationFocus.length > 0
      ? `Evaluation focus:\n${profile.evaluationFocus.map((item) => `- ${item}`).join('\n')}`
      : '',
    profile.reviewerSignals.length > 0
      ? `Reviewer signals:\n${profile.reviewerSignals.map((item) => `- ${item}`).join('\n')}`
      : '',
    profile.avoidRules.length > 0
      ? `Avoid:\n${profile.avoidRules.map((item) => `- ${item}`).join('\n')}`
      : '',
    profile.formatConstraints.length > 0
      ? `Format constraints:\n${profile.formatConstraints.map((item) => `- ${item}`).join('\n')}`
      : '',
    profile.narrativeConstraints.length > 0
      ? `Narrative constraints:\n${profile.narrativeConstraints.map((item) => `- ${item}`).join('\n')}`
      : '',
  ].filter(Boolean)

  return parts.length > 0 ? `GRANT RULES:\n${parts.join('\n\n')}` : ''
}

function buildBlueprintContextBlock(input: GrantPromptComposerInput): string {
  const mustCover = dedupeStrings(input.mustCover || []).slice(0, 8)
  const mustAvoid = dedupeStrings(input.mustAvoid || []).slice(0, 6)
  const contributions = dedupeStrings(input.keyContributions || []).slice(0, 5)

  return [
    'SECTION BRIEF:',
    `- Section: ${input.displayLabel || formatSectionLabel(input.sectionKey)}`,
    input.purpose ? `- Purpose: ${input.purpose}` : '',
    input.reviewerIntent ? `- Reviewer intent: ${input.reviewerIntent}` : '',
    input.wordBudget ? `- Word budget: ${input.wordBudget}` : '',
    input.characterLimit ? `- Character limit: ${input.characterLimit}` : '',
    input.thesisStatement ? `- Proposal thesis: ${input.thesisStatement}` : '',
    input.centralObjective ? `- Central objective: ${input.centralObjective}` : '',
    contributions.length > 0 ? `- Key contributions: ${contributions.join(' | ')}` : '',
    mustCover.length > 0 ? `- Must cover: ${mustCover.join(' | ')}` : '',
    mustAvoid.length > 0 ? `- Must avoid: ${mustAvoid.join(' | ')}` : '',
  ].filter(Boolean).join('\n')
}

function buildGrantContextBlock(summary?: GrantPromptSummary | null): string {
  const lines = dedupeStrings([
    summary?.projectTitle ? `Project: ${summary.projectTitle}` : '',
    summary?.fundingCallTitle ? `Funding call: ${summary.fundingCallTitle}` : '',
    summary?.agencyName ? `Agency: ${summary.agencyName}` : '',
    ...(summary?.freezeSummary || []),
  ], 8)
  return lines.length > 0
    ? `GRANT CONTEXT:\n${lines.map((line) => `- ${line}`).join('\n')}`
    : ''
}

function buildPass1PlaybookFallback(input: GrantPromptComposerInput): string {
  const profile = buildGrantPromptProfile({
    sectionType: input.sectionType,
    reviewerIntent: input.reviewerIntent,
    citationMode: input.citationMode,
    grantSemantic: input.grantSemantic,
    templateIntent: input.templateIntent,
  })

  return [
    `SECTION TASK:\n- ${profile.task}`,
    `REVIEWER QUESTION:\n- ${profile.reviewerQuestion}`,
    `OPENING MOVE:\n- ${profile.openingMove}`,
    profile.recommendedFlow.length > 0
      ? `RECOMMENDED FLOW:\n${profile.recommendedFlow.map((item) => `- ${item}`).join('\n')}`
      : '',
    profile.evidenceUseRules.length > 0
      ? `EVIDENCE USE RULES:\n${profile.evidenceUseRules.map((item) => `- ${item}`).join('\n')}`
      : '',
    profile.antiPatterns.length > 0
      ? `ANTI-PATTERNS:\n${profile.antiPatterns.map((item) => `- ${item}`).join('\n')}`
      : '',
    profile.sectionTypeRules.length > 0
      ? `SECTION-TYPE RULES:\n${profile.sectionTypeRules.map((item) => `- ${item}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n')
}

function buildPass1PrepUsageFallback(input: GrantPromptComposerInput): string {
  const usesMappedEvidence = input.citationMode === 'mapped_evidence'
  return [
    'PREP USAGE RULES:',
    '- Section-mapped covered Grant Prep points are authoritative for this section.',
    '- Keep related-section awareness secondary; use it only to maintain consistency or avoid contradiction.',
    '- Do not escalate awareness-only material into a new promise, metric, milestone, or compliance claim.',
    usesMappedEvidence
      ? '- When mapped evidence is provided, attach only the allowed citation anchors to the claims they support.'
      : '- If mapped evidence is not required, stay factual and do not invent citation placeholders.',
  ].join('\n')
}

function buildPass1ConsistencyFallback(): string {
  return [
    'CONSISTENCY RULES:',
    '- Keep terminology, beneficiaries, objectives, and delivery logic consistent with the broader proposal.',
    '- Reuse the same naming for work packages, outputs, and institutions when they already appear in prior context.',
    '- Prefer reviewer trust, feasibility clarity, and scoring alignment over academic flourish.',
  ].join('\n')
}

function buildPass2PersonaFallback(): string {
  return [
    'You are a senior grant-writing editor performing reviewer polish on a proposal section.',
    'Increase clarity, credibility, and funder alignment without inventing unsupported claims or dropping required evidence.',
  ].join('\n')
}

function buildPass2ReviewerPolishFallback(): string {
  return [
    'REVIEWER POLISH RULES:',
    '- Preserve all supported facts, all required points, and all mandatory citation anchors.',
    '- Improve reviewer scanability, confidence, and logical flow rather than chasing publication-style polish.',
    '- Tighten vague language, foreground feasibility, and keep the section directly aligned to the call logic.',
    '- Do not rewrite the section into a journal article or literature review.',
  ].join('\n')
}

function buildPass1OutputFallback(input: GrantPromptComposerInput): string {
  if (input.outputMode === 'pass1_json') {
    const mustCover = dedupeStrings(input.mustCover || [])
    const roleGuide = mustCover.length > 0
      ? mustCover.map((dimensionLabel, index) => {
          const role = mustCover.length <= 1
            ? 'intro_conclusion'
            : index === 0
              ? 'introduction'
              : index === mustCover.length - 1
                ? 'conclusion'
                : 'body'
          return `- ${normalizeDimensionKey(dimensionLabel)} | ${dimensionLabel} | role=${role}`
        }).join('\n')
      : '- (no blueprint dimensions available for this section)'
    const citationGuide = mustCover.length > 0
      ? mustCover.map((dimensionLabel) => {
          const dimensionKey = normalizeDimensionKey(dimensionLabel)
          const entry = (input.dimensionCitationHints || []).find(
            (item) => normalizeDimensionKey(item.dimension) === dimensionKey
          )
          return `- ${dimensionKey}: ${(entry?.citationKeys || []).join(', ') || '(none mapped)'}`
        }).join('\n')
      : '- (no dimension-level citation guidance available)'

    return [
      'OUTPUT FORMAT (MANDATORY):',
      'Return ONLY raw JSON. No markdown code fences. Start with { and end with }.',
      '{',
      '  "content": "<complete markdown proposal section draft>",',
      '  "memory": {',
      '    "keyPoints": ["3-5 concrete points covered by this section"],',
      '    "termsIntroduced": ["term introduced for the first time here"],',
      '    "mainClaims": ["TYPE: claim"],',
      '    "forwardReferences": ["promise or bridge to a later section"],',
      '    "sectionIntent": "Single sentence describing what this section must accomplish for the proposal.",',
      '    "openingStrategy": "How the section should open and orient the reviewer.",',
      '    "closingStrategy": "How the section should close or bridge onward.",',
      '    "sectionOutline": ["planned subsection 1", "planned subsection 2"],',
      '    "dimensionBriefs": [',
      '      {',
      '        "dimensionKey": "normalized_dimension_key",',
      '        "dimensionLabel": "Exact blueprint dimension label",',
      '        "roleHint": "introduction|body|conclusion|intro_conclusion",',
      '        "sourceSummary": "2-4 sentences summarizing only the part of the draft that belongs to this dimension.",',
      '        "claimFocus": ["specific claim or reviewer-facing angle"],',
      '        "mustUseCitationKeys": ["citationKey1", "citationKey2"],',
      '        "bridgeToNext": "Short note on how this dimension should connect to the next one."',
      '      }',
      '    ]',
      '  },',
      '  "usedPrepEvidence": ["stageKey:pointKey"],',
      '  "coveredRequiredPoints": ["required point covered in the content"],',
      '  "unmetRequiredPoints": ["required point still missing"],',
      '  "violatedAvoidRules": ["avoid rule violated by the draft"],',
      '  "openQuestions": ["factual ambiguity or reviewer risk that still needs resolution"]',
      '}',
      '',
      'PASS 1 MEMORY RULES:',
      '- "content" must be the full section draft in markdown, with headings, paragraphs, bullets, and [CITE:key] anchors when needed.',
      '- "dimensionBriefs" must follow the blueprint dimension order exactly when blueprint dimensions exist.',
      '- Each dimensionBrief must summarize only its own slice of the section draft.',
      '- "mustUseCitationKeys" should reflect mapped evidence for that dimension when available.',
      '- "openingStrategy" should help the first dimension introduce the section.',
      '- "closingStrategy" should help the last dimension conclude the section.',
      '- If no blueprint dimensions exist, return "dimensionBriefs": [].',
      '- The top-level compliance arrays must reflect the section contract accurately.',
      '',
      'BLUEPRINT DIMENSION ORDER / ROLE HINTS:',
      roleGuide,
      '',
      'MAPPED CITATION HINTS BY DIMENSION:',
      citationGuide,
    ].join('\n')
  }

  const sectionType = String(input.sectionType || '').trim().toLowerCase()
  const rules = [
    'OUTPUT FORMAT:',
    '- Return ONLY clean Markdown. No JSON, no code fences, no preamble.',
    '- Preserve [CITE:key] anchors exactly when mapped evidence is used.',
  ]

  if (sectionType === 'short_answer') {
    rules.push('- Default to a single compact block unless the template clearly requires bullets.')
  } else {
    rules.push('- Use headings only when they improve reviewer scanability; do not force academic subsection scaffolding.')
  }

  return rules.join('\n')
}

function buildPass2OutputFallback(input: GrantPromptComposerInput): string {
  const requiredCitationLine = input.requiredCitationKeys && input.requiredCitationKeys.length > 0
    ? `- Required citation anchors that must remain: ${input.requiredCitationKeys.map((key) => `[CITE:${key}]`).join(', ')}.`
    : '- Preserve citation anchors that still support surviving claims; do not invent new ones.'

  return [
    'OUTPUT FORMAT:',
    '- Return ONLY the polished reviewer-ready section in Markdown.',
    '- No JSON, no code fences, no preamble.',
    '- Preserve all required claims and required citation anchors.',
    requiredCitationLine,
  ].join('\n')
}

function buildPass1MemoryBlock(memory?: GrantPass1MemoryContext | null): string {
  if (!memory) return ''
  const outline = dedupeStrings(memory.sectionOutline || [])
  const lines = [
    memory.sectionIntent ? `- Pass 1 section intent: ${memory.sectionIntent}` : '',
    memory.openingStrategy ? `- Pass 1 opening strategy: ${memory.openingStrategy}` : '',
    memory.closingStrategy ? `- Pass 1 closing strategy: ${memory.closingStrategy}` : '',
    outline.length > 0 ? `- Pass 1 section outline: ${outline.join(' | ')}` : '',
  ].filter(Boolean)
  return lines.length > 0 ? `PASS 1 MEMORY:\n${lines.join('\n')}` : ''
}

async function resolveGrantPromptBlock(
  templateKey: string,
  context: Pick<GrantPromptComposerInput, 'sectionKey' | 'grantSemantic' | 'templateIntent' | 'sectionType'>,
  fallback: string
): Promise<string> {
  const scopes = dedupeStrings([
    normalizeScopeValue(context.sectionKey) ? `section:${normalizeScopeValue(context.sectionKey)}` : '',
    normalizeScopeValue(context.grantSemantic) ? `semantic:${normalizeScopeValue(context.grantSemantic)}` : '',
    normalizeScopeValue(context.templateIntent) ? `intent:${normalizeScopeValue(context.templateIntent)}` : '',
    normalizeScopeValue(context.sectionType) ? `type:${normalizeScopeValue(context.sectionType)}` : '',
    '*',
  ])

  for (const sectionScope of scopes) {
    const resolved = await systemPromptTemplateService.resolve({
      templateKey,
      applicationMode: 'grant',
      paperTypeScope: '*',
      sectionScope,
    })
    if (String(resolved || '').trim()) {
      return String(resolved).trim()
    }
  }

  return fallback.trim()
}

export async function buildGrantDraftingPrompt(input: GrantPromptComposerInput): Promise<string> {
  const profile = buildGrantPromptProfile({
    sectionType: input.sectionType,
    reviewerIntent: input.reviewerIntent,
    citationMode: input.citationMode,
    grantSemantic: input.grantSemantic,
    templateIntent: input.templateIntent,
  })

  if (input.pass === 'pass2') {
    const [persona, polishRules, outputRules] = await Promise.all([
      resolveGrantPromptBlock(TEMPLATE_KEYS.GRANT_PASS2_PERSONA, input, buildPass2PersonaFallback()),
      resolveGrantPromptBlock(TEMPLATE_KEYS.GRANT_PASS2_REVIEWER_POLISH_RULES, input, buildPass2ReviewerPolishFallback()),
      resolveGrantPromptBlock(TEMPLATE_KEYS.GRANT_PASS2_OUTPUT_FORMAT, input, buildPass2OutputFallback(input)),
    ])

    return [
      `TASK: REVIEWER POLISH - ${(input.displayLabel || formatSectionLabel(input.sectionKey)).toUpperCase()}`,
      persona,
      input.retryNoticeBlock || '',
      buildGrantContextBlock(input.grantContextSummary),
      buildBlueprintContextBlock(input),
      formatGrantPromptProfileForPrompt(profile),
      formatGrantRulesBlock(input.grantRuleProfile),
      formatGrantComplianceContractForPrompt(input.grantSectionComplianceContract),
      formatPromptBundle('AUTHORITATIVE SECTION PREP POINTS', input.authoritativePrepBundle),
      formatPromptBundle('RELATED SECTION AWARENESS', input.relatedPrepAwareness, true),
      buildPass1MemoryBlock(input.pass1Memory),
      input.topicContextBlock || '',
      input.previousSectionContextBlock || '',
      input.evidenceBlock || '',
      input.coverageBlock || '',
      input.figureBlock || '',
      polishRules,
      'DRAFT TO REFINE:',
      String(input.baseContent || '').trim(),
      outputRules,
    ].filter(Boolean).join('\n\n')
  }

  const [persona, playbook, prepUsageRules, consistencyRules, outputRules] = await Promise.all([
    resolveGrantPromptBlock(TEMPLATE_KEYS.GRANT_PASS1_PERSONA, input, [
      'You are writing a grant proposal section for reviewers inside Grapsi.',
      'Write reviewer-facing proposal prose, not a journal manuscript section.',
    ].join('\n')),
    resolveGrantPromptBlock(TEMPLATE_KEYS.GRANT_PASS1_SECTION_PLAYBOOK, input, buildPass1PlaybookFallback(input)),
    resolveGrantPromptBlock(TEMPLATE_KEYS.GRANT_PASS1_PREP_USAGE_RULES, input, buildPass1PrepUsageFallback(input)),
    resolveGrantPromptBlock(TEMPLATE_KEYS.GRANT_PASS1_CONSISTENCY_RULES, input, buildPass1ConsistencyFallback()),
    resolveGrantPromptBlock(TEMPLATE_KEYS.GRANT_PASS1_OUTPUT_FORMAT, input, buildPass1OutputFallback(input)),
  ])

  return [
    `TASK: GRANT SECTION DRAFT - ${(input.displayLabel || formatSectionLabel(input.sectionKey)).toUpperCase()}`,
    persona,
    buildGrantContextBlock(input.grantContextSummary),
    buildBlueprintContextBlock(input),
    formatGrantPromptProfileForPrompt(profile),
    playbook,
    prepUsageRules,
    consistencyRules,
    formatGrantRulesBlock(input.grantRuleProfile),
    formatGrantComplianceContractForPrompt(input.grantSectionComplianceContract),
    formatPromptBundle('AUTHORITATIVE SECTION PREP POINTS', input.authoritativePrepBundle),
    formatPromptBundle('RELATED SECTION AWARENESS', input.relatedPrepAwareness, true),
    input.topicContextBlock || '',
    input.previousSectionContextBlock || '',
    input.evidenceBlock || '',
    input.coverageBlock || '',
    input.figureBlock || '',
    input.styleBlock ? `WRITING STYLE GUIDANCE:\n${input.styleBlock}` : '',
    input.userInstructions ? `USER INSTRUCTIONS:\n${input.userInstructions}` : '',
    outputRules,
  ].filter(Boolean).join('\n\n')
}
