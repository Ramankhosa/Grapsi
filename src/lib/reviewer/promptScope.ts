/**
 * Rule scoping for reviewer prompts, extracted from `lib/reviewerService.ts`
 * so pages can show the user exactly the rule set the model scores against.
 *
 * Client-safe: pure functions over the workspace's stored context
 * (`reviewer_calls.parsed_json`) and a section row — no Prisma, no LLM.
 * `reviewSection` builds its SECTION_SCORING_RULES / GLOBAL_SCORING_RULES /
 * NON_SCORING_SUPPLEMENTARY_REQUIREMENTS blocks from this exact output, so
 * whatever this returns is what the reviewer actually sees.
 */

export interface ReviewerPromptScope {
  linkedSectionKeys: string[]
  sectionRules: string[]
  globalRules: string[]
  supplementaryRules: string[]
  rulesUsedForScoring: string[]
  globalRulesConsidered: string[]
  nonScoringReminders: string[]
}

export function normalizeKey(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export function dedupeStrings(values: unknown[], limit?: number): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const value of values) {
    const text = String(value || '').trim().replace(/\s+/g, ' ')
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    next.push(text)
    if (limit && next.length >= limit) break
  }
  return next
}

export function flattenRuleProfile(profile: any): string[] {
  if (!profile || typeof profile !== 'object') return []
  return dedupeStrings([
    ...(Array.isArray(profile.requiredPoints) ? profile.requiredPoints : []),
    ...(Array.isArray(profile.evaluationFocus) ? profile.evaluationFocus : []),
    ...(Array.isArray(profile.reviewerSignals) ? profile.reviewerSignals : []),
    ...(Array.isArray(profile.avoidRules) ? profile.avoidRules.map((item: string) => `Avoid: ${item}`) : []),
    ...(Array.isArray(profile.formatConstraints) ? profile.formatConstraints.map((item: string) => `Format: ${item}`) : []),
    ...(Array.isArray(profile.narrativeConstraints) ? profile.narrativeConstraints : []),
  ])
}

export function flattenComplianceContract(contract: any): { scoring: string[]; supplementary: string[] } {
  if (!contract || typeof contract !== 'object') return { scoring: [], supplementary: [] }
  const scoringChecks = [
    ...(Array.isArray(contract.hardChecks) ? contract.hardChecks : []),
    ...(Array.isArray(contract.softChecks) ? contract.softChecks : []),
  ].filter((check: any) => {
    const mode = String(check?.draftingVsSubmission || '').toLowerCase()
    return mode === 'drafting' || mode === 'both' || !mode
  }).map((check: any) => check?.ruleText || check?.message || check?.label)

  const supplementaryChecks = [
    ...(Array.isArray(contract.submissionChecklist) ? contract.submissionChecklist : []),
    ...(Array.isArray(contract.hardChecks) ? contract.hardChecks : []),
    ...(Array.isArray(contract.softChecks) ? contract.softChecks : []),
  ].filter((check: any) => {
    if (typeof check === 'string') return true
    const mode = String(check?.draftingVsSubmission || '').toLowerCase()
    return mode === 'submission'
  }).map((check: any) => typeof check === 'string' ? check : (check?.ruleText || check?.message || check?.label))

  return {
    scoring: dedupeStrings([
      ...(Array.isArray(contract.requiredPoints) ? contract.requiredPoints : []),
      ...(Array.isArray(contract.evaluationFocus) ? contract.evaluationFocus : []),
      ...(Array.isArray(contract.reviewerSignals) ? contract.reviewerSignals : []),
      ...(Array.isArray(contract.avoidRules) ? contract.avoidRules.map((item: string) => `Avoid: ${item}`) : []),
      ...(Array.isArray(contract.formatConstraints) ? contract.formatConstraints.map((item: string) => `Format: ${item}`) : []),
      ...(Array.isArray(contract.narrativeConstraints) ? contract.narrativeConstraints : []),
      ...scoringChecks,
    ]),
    supplementary: dedupeStrings(supplementaryChecks),
  }
}

export function ruleToText(rule: any): string {
  const parts = [
    rule?.label ? `${rule.label}` : '',
    rule?.reviewerGoal ? `goal: ${rule.reviewerGoal}` : '',
    Array.isArray(rule?.guidanceText) && rule.guidanceText.length ? `guidance: ${rule.guidanceText.join('; ')}` : '',
    Array.isArray(rule?.requiredFacts) && rule.requiredFacts.length ? `required facts: ${rule.requiredFacts.join('; ')}` : '',
    Array.isArray(rule?.forbiddenMoves) && rule.forbiddenMoves.length ? `avoid: ${rule.forbiddenMoves.join('; ')}` : '',
    rule?.wordLimit ? `word limit: ${rule.wordLimit}` : '',
    rule?.charLimit ? `character limit: ${rule.charLimit}` : '',
  ].filter(Boolean)
  return parts.join(' | ')
}

export function isSupplementaryRule(rule: any): boolean {
  const workflowMode = String(rule?.workflowMode || '').toLowerCase()
  const type = normalizeKey(rule?.type)
  const bucket = normalizeKey(rule?.bucketKey)
  const text = `${rule?.label || ''} ${rule?.reviewerGoal || ''} ${(rule?.guidanceText || []).join(' ')}`.toLowerCase()
  return (
    (workflowMode && workflowMode !== 'app_draft')
    || bucket === 'attachments_submission'
    || ['attachment', 'attachments', 'submission', 'eligibility', 'checklist'].includes(type)
    || /\b(attachment|appendix|portal|upload|signature|signed|cv|biosketch|institutional|ethics|irb|declaration|certificate|budget form|workbook|invoice|quote)\b/.test(text)
  )
}

export function buildLinkedSectionRules(link: any): { scoring: string[]; supplementary: string[] } {
  const compliance = flattenComplianceContract(link?.grantSectionComplianceContract)
  const templateGuidance = link?.grantTemplateGuidance && typeof link.grantTemplateGuidance === 'object'
    ? dedupeStrings([
        ...(Array.isArray(link.grantTemplateGuidance.guidanceText) ? link.grantTemplateGuidance.guidanceText : []),
        ...(Array.isArray(link.grantTemplateGuidance.requiredFacts) ? link.grantTemplateGuidance.requiredFacts : []),
        ...(Array.isArray(link.grantTemplateGuidance.forbiddenMoves) ? link.grantTemplateGuidance.forbiddenMoves.map((item: string) => `Avoid: ${item}`) : []),
        link.grantTemplateGuidance.reviewerGoal ? `Reviewer goal: ${link.grantTemplateGuidance.reviewerGoal}` : '',
      ])
    : []

  return {
    scoring: dedupeStrings([
      link?.reviewerIntent ? `Reviewer intent: ${link.reviewerIntent}` : '',
      ...(Array.isArray(link?.mustCover) ? link.mustCover : []),
      ...(Array.isArray(link?.mustAvoid) ? link.mustAvoid.map((item: string) => `Avoid: ${item}`) : []),
      ...flattenRuleProfile(link?.grantRuleProfile),
      ...templateGuidance,
      ...compliance.scoring,
    ]),
    supplementary: compliance.supplementary,
  }
}

export function buildReviewerPromptScope(section: any, callData: any): ReviewerPromptScope {
  const templateRules = Array.isArray(callData?.template_sections) ? callData.template_sections : []
  const manualRubric = callData?.manual_rubric || {}
  const mappingJson = section?.mappingJson && typeof section.mappingJson === 'object' ? section.mappingJson : {}
  const linkedSections = Array.isArray(mappingJson.linkedSections) ? mappingJson.linkedSections : []
  const linkedKeys = new Set<string>(linkedSections.map((link: any) => normalizeKey(link?.sectionKey)).filter(Boolean))
  const bucketKey = normalizeKey(section?.reviewerBucketKey || mappingJson.bucketKey || section?.section_title)

  const sectionRules: string[] = []
  const globalRules: string[] = []
  const supplementaryRules: string[] = []
  const scoringRuleKeys: string[] = []
  const globalRuleKeys: string[] = []

  for (const link of linkedSections) {
    if (String(link?.workflowMode || 'app_draft') !== 'app_draft') continue
    const linked = buildLinkedSectionRules(link)
    sectionRules.push(...linked.scoring.map((rule) => `${link.label || link.sectionKey}: ${rule}`))
    supplementaryRules.push(...linked.supplementary.map((rule) => `${link.label || link.sectionKey}: ${rule}`))
  }

  for (const rule of templateRules) {
    const key = normalizeKey(rule?.key)
    const ruleBucket = normalizeKey(rule?.bucketKey)
    const text = ruleToText(rule)
    if (!text) continue

    if (isSupplementaryRule(rule)) {
      supplementaryRules.push(text)
      continue
    }

    const exactSectionMatch = key && linkedKeys.has(key)
    const bucketMatch = ruleBucket && bucketKey && ruleBucket === bucketKey
    const appDraft = String(rule?.workflowMode || '').toLowerCase() === 'app_draft'

    if (exactSectionMatch || (appDraft && bucketMatch)) {
      sectionRules.push(text)
      scoringRuleKeys.push(rule?.key || rule?.label || text)
      continue
    }

    const type = normalizeKey(rule?.type)
    if (type === 'rubric' || type === 'evaluation' || type === 'evaluation_criteria' || !rule?.workflowMode) {
      globalRules.push(text)
      globalRuleKeys.push(rule?.key || rule?.label || text)
    }
  }

  const sectionOverrides = manualRubric?.sectionOverrides || {}
  for (const key of linkedKeys) {
    const override = sectionOverrides[key] || sectionOverrides[normalizeKey(key)]
    if (!override || typeof override !== 'object') continue
    sectionRules.push(...dedupeStrings([
      ...(Array.isArray(override.evaluationCriteria) ? override.evaluationCriteria : []),
      ...(Array.isArray(override.reviewerSignals) ? override.reviewerSignals : []),
      ...(Array.isArray(override.mustAddress) ? override.mustAddress : []),
      ...(Array.isArray(override.avoid) ? override.avoid.map((item: string) => `Avoid: ${item}`) : []),
      ...(Array.isArray(override.formatRules) ? override.formatRules.map((item: string) => `Format: ${item}`) : []),
    ]))
  }

  globalRules.push(...dedupeStrings([
    ...(Array.isArray(callData?.evaluation_criteria) ? callData.evaluation_criteria : []),
    ...(Array.isArray(callData?.reviewer_signals) ? callData.reviewer_signals.map((item: string) => `Reviewer signal: ${item}`) : []),
    ...(Array.isArray(manualRubric?.evaluationCriteria) ? manualRubric.evaluationCriteria : []),
    ...(Array.isArray(manualRubric?.reviewerSignals) ? manualRubric.reviewerSignals.map((item: string) => `Reviewer signal: ${item}`) : []),
    ...(Array.isArray(manualRubric?.mustAddress) ? manualRubric.mustAddress : []),
    ...(Array.isArray(manualRubric?.avoid) ? manualRubric.avoid.map((item: string) => `Avoid: ${item}`) : []),
    callData?.budget_cap ? `Budget cap: ${callData.budget_cap}` : '',
    callData?.project_duration_limit ? `Project duration: ${callData.project_duration_limit}` : '',
  ]))

  return {
    linkedSectionKeys: Array.from(linkedKeys),
    sectionRules: dedupeStrings(sectionRules, 40),
    globalRules: dedupeStrings(globalRules, 30),
    supplementaryRules: dedupeStrings(supplementaryRules, 30),
    rulesUsedForScoring: dedupeStrings([...scoringRuleKeys, ...sectionRules], 40),
    globalRulesConsidered: dedupeStrings([...globalRuleKeys, ...globalRules], 30),
    nonScoringReminders: dedupeStrings(supplementaryRules, 30),
  }
}
