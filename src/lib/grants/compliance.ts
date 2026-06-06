import type {
  GrantBlueprintPlanSection,
  GrantComplianceFinding,
  GrantComplianceReport,
  GrantGenerationTrace,
  GrantPrepEvidenceItem,
  GrantSectionComplianceCheck,
  GrantSectionComplianceContract,
  ReviewerReadinessReport,
} from '@/types/grant'
import { isGrantSectionAutoDraftable } from '@/lib/grants/workflowMode'

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'your', 'their', 'must',
  'should', 'shall', 'will', 'have', 'has', 'been', 'being', 'show', 'state', 'provide',
  'describe', 'explain', 'use', 'keep', 'align', 'proposal', 'section', 'grant', 'project',
  'reviewer', 'reviewers', 'avoid', 'ensure', 'clearly', 'explicitly', 'through', 'within',
  'about', 'each', 'only', 'than', 'then', 'them', 'they', 'what', 'when', 'where', 'which',
])

function normalizeText(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(value: unknown) {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
}

export function dedupeGrantStrings(values: unknown, limit = 24): string[] {
  const source = Array.isArray(values)
    ? values
    : typeof values === 'string'
      ? [values]
      : []

  const seen = new Set<string>()
  const next: string[] = []
  for (const item of source) {
    const normalized = String(item || '').trim().replace(/\s+/g, ' ')
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    next.push(normalized)
    if (next.length >= limit) break
  }
  return next
}

function countWords(text: string) {
  const normalized = String(text || '').trim()
  return normalized ? normalized.split(/\s+/).filter(Boolean).length : 0
}

function asCleanText(value: unknown) {
  return String(value || '').trim()
}

function stripDirectiveLead(value: string) {
  return value
    .replace(/^(avoid|do not|don't|never|ensure|include|state|show|provide|describe|explain|highlight|demonstrate|link|align)\b[:\s-]*/i, '')
    .trim()
}

function phraseCoverageScore(text: string, phrase: string) {
  const normalizedText = normalizeText(text)
  const normalizedPhrase = normalizeText(stripDirectiveLead(phrase))
  if (!normalizedPhrase) return 0
  if (normalizedText.includes(normalizedPhrase)) return 1

  const phraseTokens = tokenize(normalizedPhrase)
  if (phraseTokens.length === 0) return 0
  const textTokens = new Set(tokenize(normalizedText))
  let matched = 0
  for (const token of phraseTokens) {
    if (textTokens.has(token)) matched += 1
  }
  return matched / phraseTokens.length
}

function isPhraseCovered(text: string, phrase: string) {
  const score = phraseCoverageScore(text, phrase)
  if (score >= 0.75) return true
  const phraseTokens = tokenize(phrase)
  if (phraseTokens.length <= 2) return score >= 1
  return score >= 0.6
}

function isAvoidRuleViolated(text: string, rule: string) {
  const stripped = stripDirectiveLead(rule)
  if (!stripped) return false
  return phraseCoverageScore(text, stripped) >= 0.6
}

function inferPrepEvidenceUsage(text: string, evidence: GrantPrepEvidenceItem[]) {
  return evidence
    .filter((item) => {
      const evidencePhrases = [
        ...item.factBullets,
        ...item.keywords,
        ...item.thrustLinkage,
      ]
      return evidencePhrases.some((phrase) => isPhraseCovered(text, phrase))
    })
    .map((item) => `${item.stageKey}:${item.pointKey}`)
}

function makeFinding(
  key: string,
  message: string,
  source: GrantComplianceFinding['source'],
  ruleText?: string | null
): GrantComplianceFinding {
  return { key, message, source, ruleText: ruleText || null }
}

export function normalizeGrantGenerationTrace(value: unknown): GrantGenerationTrace {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  return {
    usedPrepEvidence: dedupeGrantStrings(record.usedPrepEvidence, 16),
    coveredRequiredPoints: dedupeGrantStrings(record.coveredRequiredPoints, 16),
    unmetRequiredPoints: dedupeGrantStrings(record.unmetRequiredPoints, 16),
    violatedAvoidRules: dedupeGrantStrings(record.violatedAvoidRules, 16),
    openQuestions: dedupeGrantStrings(record.openQuestions, 12),
  }
}

function evaluateChecklistCoverage(
  text: string,
  items: string[]
) {
  const covered: string[] = []
  const missing: string[] = []
  for (const item of dedupeGrantStrings(items)) {
    if (isPhraseCovered(text, item)) covered.push(item)
    else missing.push(item)
  }
  return { covered, missing }
}

function buildCheckFailure(
  text: string,
  check: GrantSectionComplianceCheck
): GrantComplianceFinding | null {
  if (check.draftingVsSubmission === 'submission') {
    return null
  }

  if (
    (check.ruleClass === 'avoid' || check.ruleClass === 'template_forbidden_move')
    && isAvoidRuleViolated(text, check.ruleText)
  ) {
    return makeFinding(check.key, `Avoided move was violated: ${check.label}`, check.source, check.ruleText)
  }

  if (
    (check.ruleClass === 'must_address'
      || check.ruleClass === 'template_required_fact'
      || check.ruleClass === 'deliverable'
      || check.ruleClass === 'evaluation'
      || check.ruleClass === 'priority'
      || check.ruleClass === 'reviewer_signal'
      || check.ruleClass === 'prep_evidence')
    && !isPhraseCovered(text, check.ruleText)
  ) {
    return makeFinding(check.key, `Required grant constraint is missing: ${check.label}`, check.source, check.ruleText)
  }

  return null
}

export function buildGrantComplianceReport(input: {
  stage: GrantComplianceReport['stage']
  content: string
  contract?: GrantSectionComplianceContract | null
  trace?: unknown
  wordBudget?: number | null
  characterLimit?: number | null
}): GrantComplianceReport {
  const contract = input.contract || null
  const content = String(input.content || '')
  const trace = normalizeGrantGenerationTrace(input.trace)

  if (!contract) {
    return {
      stage: input.stage,
      passed: true,
      coveredRequiredPoints: [],
      unmetRequiredPoints: [],
      violatedAvoidRules: [],
      missingEvidence: [],
      hardFailures: [],
      softWarnings: [],
      usedPrepEvidence: [],
      generatedAt: new Date().toISOString(),
    }
  }

  const requiredCoverage = evaluateChecklistCoverage(content, contract.requiredPoints)
  const reviewerSignalCoverage = evaluateChecklistCoverage(content, contract.reviewerSignals)
  const evaluationCoverage = evaluateChecklistCoverage(content, contract.evaluationFocus)
  const requiredFactCoverage = evaluateChecklistCoverage(content, contract.templateGuidance?.requiredFacts || [])
  const narrativeCoverage = evaluateChecklistCoverage(content, contract.narrativeConstraints)

  const coveredRequiredPoints = dedupeGrantStrings([
    ...trace.coveredRequiredPoints,
    ...requiredCoverage.covered,
  ], 32)

  const unmetRequiredPoints = dedupeGrantStrings([
    ...requiredCoverage.missing,
    ...requiredFactCoverage.missing,
    ...trace.unmetRequiredPoints,
  ], 32)

  const violatedAvoidRules = dedupeGrantStrings([
    ...trace.violatedAvoidRules,
    ...contract.avoidRules.filter((rule) => isAvoidRuleViolated(content, rule)),
    ...(contract.templateGuidance?.forbiddenMoves || []).filter((rule) => isAvoidRuleViolated(content, rule)),
  ], 24)

  const inferredPrepEvidenceUsage = inferPrepEvidenceUsage(content, contract.prepEvidence || [])
  const usedPrepEvidence = dedupeGrantStrings([
    ...trace.usedPrepEvidence,
    ...inferredPrepEvidenceUsage,
  ], 24)

  const missingEvidence = dedupeGrantStrings([
    ...requiredFactCoverage.missing,
    ...(contract.prepEvidence.length > 0 && usedPrepEvidence.length === 0
      ? ['No preserved Grant Prep evidence is reflected in the section draft.']
      : []),
  ], 24)

  const hardFailures: GrantComplianceFinding[] = []
  const softWarnings: GrantComplianceFinding[] = []

  if (typeof input.wordBudget === 'number' && input.wordBudget > 0 && countWords(content) > input.wordBudget) {
    hardFailures.push(
      makeFinding('word_budget', `Section exceeds the word budget of ${input.wordBudget}.`, 'system')
    )
  }
  if (typeof input.characterLimit === 'number' && input.characterLimit > 0 && content.length > input.characterLimit) {
    hardFailures.push(
      makeFinding('character_limit', `Section exceeds the character limit of ${input.characterLimit}.`, 'system')
    )
  }

  for (const check of contract.hardChecks || []) {
    const failure = buildCheckFailure(content, check)
    if (failure) hardFailures.push(failure)
  }

  for (const check of contract.softChecks || []) {
    const failure = buildCheckFailure(content, check)
    if (failure) softWarnings.push(failure)
  }

  for (const rule of violatedAvoidRules) {
    hardFailures.push(
      makeFinding(`avoid_${normalizeText(rule).slice(0, 24)}`, `Section appears to violate an avoid rule: ${rule}`, 'guideline', rule)
    )
  }

  for (const rule of reviewerSignalCoverage.missing) {
    softWarnings.push(
      makeFinding(`reviewer_${normalizeText(rule).slice(0, 24)}`, `Reviewer-facing signal is weak or missing: ${rule}`, 'guideline', rule)
    )
  }

  for (const rule of evaluationCoverage.missing) {
    softWarnings.push(
      makeFinding(`evaluation_${normalizeText(rule).slice(0, 24)}`, `Evaluation focus is not clearly reflected: ${rule}`, 'guideline', rule)
    )
  }

  for (const rule of narrativeCoverage.missing.slice(0, 4)) {
    softWarnings.push(
      makeFinding(`narrative_${normalizeText(rule).slice(0, 24)}`, `Narrative guidance is not clearly reflected: ${rule}`, 'template', rule)
    )
  }

  for (const missing of unmetRequiredPoints) {
    hardFailures.push(
      makeFinding(`required_${normalizeText(missing).slice(0, 24)}`, `Required point is still missing: ${missing}`, 'guideline', missing)
    )
  }

  for (const missing of missingEvidence) {
    hardFailures.push(
      makeFinding(`evidence_${normalizeText(missing).slice(0, 24)}`, `Required drafting evidence is missing: ${missing}`, missing.startsWith('No preserved Grant Prep') ? 'prep' : 'template', missing)
    )
  }

  const dedupedHardFailures = dedupeFindings(hardFailures)
  const dedupedSoftWarnings = dedupeFindings(softWarnings)

  return {
    stage: input.stage,
    passed: dedupedHardFailures.length === 0,
    coveredRequiredPoints,
    unmetRequiredPoints,
    violatedAvoidRules,
    missingEvidence,
    hardFailures: dedupedHardFailures,
    softWarnings: dedupedSoftWarnings,
    usedPrepEvidence,
    generatedAt: new Date().toISOString(),
  }
}

function dedupeFindings(findings: GrantComplianceFinding[]) {
  const seen = new Set<string>()
  const next: GrantComplianceFinding[] = []
  for (const finding of findings) {
    const key = `${finding.key}::${finding.message}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    next.push(finding)
  }
  return next
}

export function buildReviewerReadinessReport(input: {
  contract?: GrantSectionComplianceContract | null
  report: GrantComplianceReport
  content?: string | null
}): ReviewerReadinessReport {
  const contract = input.contract || null
  const report = input.report
  const content = String(input.content || '')
  const missingSignals = dedupeGrantStrings(
    contract
      ? contract.reviewerSignals.filter((signal) => !report.coveredRequiredPoints.some((item) => isPhraseCovered(item, signal)))
      : [],
    12
  )
  const competitiveSignals = content
    ? {
        missingStatistics: !/\b\d[\d,]*(?:\.\d+)?\s*(%|percent|million|billion|thousand|participants|patients|schools|states|years)?\b/i.test(content),
        missingComparison: !/\b(compared with|versus|relative to|unlike|current practice|standard of care|benchmark|existing (approach|program|method)|alternative)\b/i.test(content),
        missingFeasibility: !/\b(feasib|pilot|implemented|deployment|achieved|validated|prototype|delivery readiness|operational readiness)\b/i.test(content),
        missingMetric: !/\b(metric|indicator|milestone|target|baseline|endpoint|success criteri(?:on|a)|kpi|measur(?:e|able)|outcome measure|deliverable)\b/i.test(content),
      }
    : {
        missingStatistics: false,
        missingComparison: false,
        missingFeasibility: false,
        missingMetric: false,
      }

  const score = Math.max(
    0,
    100
    - report.hardFailures.length * 18
    - report.softWarnings.length * 7
    - report.missingEvidence.length * 8
    - missingSignals.length * 5
    - (competitiveSignals.missingStatistics ? 6 : 0)
    - (competitiveSignals.missingComparison ? 6 : 0)
    - (competitiveSignals.missingFeasibility ? 6 : 0)
    - (competitiveSignals.missingMetric ? 5 : 0)
  )

  const strengths = dedupeGrantStrings([
    ...report.coveredRequiredPoints.slice(0, 4),
    ...(report.usedPrepEvidence.length > 0 ? ['Structured Grant Prep evidence is reflected in the draft.'] : []),
    ...(!competitiveSignals.missingStatistics ? ['Draft contains concrete statistics rather than generic burden language.'] : []),
    ...(!competitiveSignals.missingComparison ? ['Draft names a comparison point or current-practice contrast.'] : []),
    ...(!competitiveSignals.missingFeasibility ? ['Draft includes explicit feasibility evidence or implementation precedent.'] : []),
    ...(!competitiveSignals.missingMetric ? ['Draft includes a measurable metric, milestone, target, or deliverable.'] : []),
  ], 6)

  const risks = dedupeGrantStrings([
    ...report.hardFailures.map((item) => item.message),
    ...report.softWarnings.map((item) => item.message),
    ...(competitiveSignals.missingStatistics ? ['Reviewer-facing statistics are missing or too vague.'] : []),
    ...(competitiveSignals.missingComparison ? ['The draft does not name a concrete comparison point or current-practice contrast.'] : []),
    ...(competitiveSignals.missingFeasibility ? ['Feasibility is asserted without explicit precedent or validation language.'] : []),
    ...(competitiveSignals.missingMetric ? ['The draft does not give reviewers a measurable metric, milestone, target, or deliverable to score.'] : []),
  ], 8)

  const recommendedActions = dedupeGrantStrings([
    ...report.unmetRequiredPoints.map((item) => `Add explicit coverage for: ${item}`),
    ...report.missingEvidence.map((item) => `Restore required drafting evidence: ${item}`),
    ...missingSignals.map((item) => `Strengthen the reviewer signal around: ${item}`),
    ...report.violatedAvoidRules.map((item) => `Remove or reframe content that violates: ${item}`),
    ...(competitiveSignals.missingStatistics ? ['Add at least one concrete burden, prevalence, cost, or baseline statistic.'] : []),
    ...(competitiveSignals.missingComparison ? ['Name the current practice, comparator, or benchmark the proposal is differentiating from.'] : []),
    ...(competitiveSignals.missingFeasibility ? ['Add explicit feasibility evidence, pilot precedent, or validation language.'] : []),
    ...(competitiveSignals.missingMetric ? ['Add a measurable success metric, milestone, baseline, target, or deliverable the reviewer can score.'] : []),
  ], 8)

  return {
    score,
    strengths,
    risks,
    missingSignals: dedupeGrantStrings([
      ...missingSignals,
      ...(competitiveSignals.missingStatistics ? ['Specific statistics are missing.'] : []),
      ...(competitiveSignals.missingComparison ? ['Named comparisons are missing.'] : []),
      ...(competitiveSignals.missingFeasibility ? ['Feasibility evidence is missing.'] : []),
      ...(competitiveSignals.missingMetric ? ['Measurable metrics or milestones are missing.'] : []),
    ], 12),
    recommendedActions,
    generatedAt: new Date().toISOString(),
  }
}

type ProposalReportSection = Pick<
  GrantBlueprintPlanSection,
  'sectionKey' | 'label' | 'required' | 'workflowMode' | 'grantSemantic' | 'grantComplianceReport' | 'reviewerReadinessReport'
> & {
  sectionType?: GrantBlueprintPlanSection['sectionType']
  content?: string | null
  status?: string | null
}

function buildProposalSectionMaps(sections: ProposalReportSection[]) {
  const byKey = new Map<string, ProposalReportSection>()
  for (const section of sections) {
    byKey.set(String(section.sectionKey || '').trim(), section)
  }
  return byKey
}

function isDraftableProposalSection(section: ProposalReportSection) {
  return section.sectionType
    ? isGrantSectionAutoDraftable({
        sectionKey: section.sectionKey,
        sectionType: section.sectionType,
        workflowMode: section.workflowMode,
      })
    : section.workflowMode === 'app_draft'
}

function semanticGroupMatches(
  semantic: GrantBlueprintPlanSection['grantSemantic'] | undefined | null,
  group: 'need' | 'delivery' | 'outcomes'
) {
  if (!semantic) return false
  if (group === 'need') {
    return semantic === 'summary' || semantic === 'problem_need' || semantic === 'objectives' || semantic === 'alignment'
  }
  if (group === 'delivery') {
    return semantic === 'methodology' || semantic === 'workplan'
  }
  return semantic === 'impact_outcomes' || semantic === 'evaluation' || semantic === 'sustainability'
}

function pickSemanticContent(
  sections: ProposalReportSection[],
  group: 'need' | 'delivery' | 'outcomes'
) {
  return sections
    .filter((section) => semanticGroupMatches(section.grantSemantic, group))
    .map((section) => asCleanText(section.content))
    .filter(Boolean)
    .join('\n\n')
}

function makeProposalAction(message: string) {
  return message
    .replace(/^Section /i, 'Revise section ')
    .replace(/^Proposal foundation /i, 'Update proposal foundation ')
}

export function buildProposalGrantComplianceReport(input: {
  sections: ProposalReportSection[]
  foundation?: {
    thesisStatement?: string | null
    centralObjective?: string | null
    keyContributions?: string[]
  } | null
}): GrantComplianceReport {
  const allSections = input.sections || []
  const draftableSections = allSections.filter(isDraftableProposalSection)
  const sectionByKey = buildProposalSectionMaps(draftableSections)
  const hardFailures: GrantComplianceFinding[] = []
  const softWarnings: GrantComplianceFinding[] = []

  const thesisStatement = asCleanText(input.foundation?.thesisStatement)
  const centralObjective = asCleanText(input.foundation?.centralObjective)
  const keyContributions = dedupeGrantStrings(input.foundation?.keyContributions || [], 12)

  if (!thesisStatement) {
    hardFailures.push(makeFinding('proposal_thesis_missing', 'Proposal foundation is missing the thesis statement.', 'system'))
  }
  if (!centralObjective) {
    hardFailures.push(makeFinding('proposal_objective_missing', 'Proposal foundation is missing the central objective.', 'system'))
  }

  for (const section of draftableSections.filter((entry) => entry.required)) {
    if (!asCleanText(section.content)) {
      hardFailures.push(
        makeFinding(
          `section_missing_${section.sectionKey}`,
          `Section ${section.label || section.sectionKey} does not have a finalized draft yet.`,
          'system',
          section.label || section.sectionKey
        )
      )
    }
  }

  const sectionReports = draftableSections
    .map((section) => sectionByKey.get(section.sectionKey))
    .filter((section): section is ProposalReportSection => Boolean(section))

  const coveredRequiredPoints = dedupeGrantStrings(
    sectionReports.flatMap((section) => section.grantComplianceReport?.coveredRequiredPoints || []),
    48
  )
  const unmetRequiredPoints = dedupeGrantStrings(
    sectionReports.flatMap((section) => section.grantComplianceReport?.unmetRequiredPoints || []),
    48
  )
  const violatedAvoidRules = dedupeGrantStrings(
    sectionReports.flatMap((section) => section.grantComplianceReport?.violatedAvoidRules || []),
    32
  )
  const missingEvidence = dedupeGrantStrings(
    sectionReports.flatMap((section) => section.grantComplianceReport?.missingEvidence || []),
    32
  )
  const usedPrepEvidence = dedupeGrantStrings(
    sectionReports.flatMap((section) => section.grantComplianceReport?.usedPrepEvidence || []),
    48
  )

  for (const section of sectionReports) {
    const sectionCompliance = section.grantComplianceReport
    if (sectionCompliance && !sectionCompliance.passed) {
      hardFailures.push(
        makeFinding(
          `section_noncompliant_${section.sectionKey}`,
          `Section ${section.label || section.sectionKey} still has grant compliance failures.`,
          'system',
          section.label || section.sectionKey
        )
      )
    }
  }

  const needContent = pickSemanticContent(draftableSections, 'need')
  const deliveryContent = pickSemanticContent(draftableSections, 'delivery')
  const outcomesContent = pickSemanticContent(draftableSections, 'outcomes')

  if (centralObjective && needContent && !isPhraseCovered(needContent, centralObjective)) {
    softWarnings.push(
      makeFinding(
        'proposal_need_alignment',
        'Problem framing sections do not clearly restate the central objective.',
        'system',
        centralObjective
      )
    )
  }

  if (centralObjective && deliveryContent && !isPhraseCovered(deliveryContent, centralObjective)) {
    softWarnings.push(
      makeFinding(
        'proposal_delivery_alignment',
        'Methodology and workplan sections are weakly aligned to the central objective.',
        'system',
        centralObjective
      )
    )
  }

  if (keyContributions.length > 0 && outcomesContent) {
    const missingContributions = keyContributions.filter((item) => !isPhraseCovered(outcomesContent, item))
    if (missingContributions.length > 0) {
      softWarnings.push(
        makeFinding(
          'proposal_outcome_traceability',
          `Outcome-oriented sections do not clearly trace these promised contributions: ${missingContributions.join('; ')}`,
          'system',
          missingContributions.join('; ')
        )
      )
    }
  }

  if (draftableSections.length > 0 && usedPrepEvidence.length === 0) {
    hardFailures.push(
      makeFinding(
        'proposal_prep_evidence_missing',
        'No preserved Grant Prep evidence is visible across the current proposal draft.',
        'prep'
      )
    )
  }

  return {
    stage: 'proposal',
    passed: hardFailures.length === 0,
    coveredRequiredPoints,
    unmetRequiredPoints,
    violatedAvoidRules,
    missingEvidence,
    hardFailures: Array.from(new Map(hardFailures.map((item) => [`${item.key}:${item.message}`, item])).values()),
    softWarnings: Array.from(new Map(softWarnings.map((item) => [`${item.key}:${item.message}`, item])).values()),
    usedPrepEvidence,
    generatedAt: new Date().toISOString(),
  }
}

export function buildProposalReviewerReadinessReport(input: {
  report: GrantComplianceReport
  sections: ProposalReportSection[]
}): ReviewerReadinessReport {
  const sectionReadiness = input.sections
    .filter(isDraftableProposalSection)
    .flatMap((section) => (section.reviewerReadinessReport ? [section.reviewerReadinessReport] : []))

  const strengths = dedupeGrantStrings(
    sectionReadiness.flatMap((report) => report.strengths),
    12
  )
  const risks = dedupeGrantStrings(
    [
      ...input.report.hardFailures.map((item) => item.message),
      ...input.report.softWarnings.map((item) => item.message),
      ...sectionReadiness.flatMap((report) => report.risks),
    ],
    14
  )
  const missingSignals = dedupeGrantStrings(
    [
      ...input.report.unmetRequiredPoints,
      ...input.report.missingEvidence,
      ...sectionReadiness.flatMap((report) => report.missingSignals),
    ],
    14
  )
  const recommendedActions = dedupeGrantStrings(
    [
      ...input.report.hardFailures.map((item) => makeProposalAction(item.message)),
      ...input.report.softWarnings.map((item) => makeProposalAction(item.message)),
      ...sectionReadiness.flatMap((report) => report.recommendedActions),
    ],
    14
  )

  const score = Math.max(
    0,
    Math.min(
      100,
      100
        - input.report.hardFailures.length * 15
        - input.report.softWarnings.length * 5
        - Math.min(15, missingSignals.length * 2)
    )
  )

  return {
    score,
    strengths,
    risks,
    missingSignals,
    recommendedActions,
    generatedAt: new Date().toISOString(),
  }
}

export function formatGrantComplianceContractForPrompt(contract?: GrantSectionComplianceContract | null) {
  if (!contract) return ''

  const prepEvidenceBlock = contract.prepEvidence.length > 0
    ? contract.prepEvidence
      .slice(0, 8)
      .map((item) => {
        const facts = item.factBullets.length > 0
          ? item.factBullets.slice(0, 2).join(' ; ')
          : item.keywords.slice(0, 5).join(', ')
        const notes = item.ruleNotes.length > 0 ? ` | Rule notes: ${item.ruleNotes.join(' ; ')}` : ''
        return `- ${item.label}: ${facts || 'captured in grant prep'}${notes}`
      })
      .join('\n')
    : '- No section-scoped Grant Prep evidence was mapped.'

  return [
    'GRANT SECTION COMPLIANCE CONTRACT:',
    contract.fundingCallSummary.length > 0
      ? `Funding-call summary:\n${contract.fundingCallSummary.map((item) => `- ${item}`).join('\n')}`
      : '',
    contract.requiredPoints.length > 0
      ? `Required points:\n${contract.requiredPoints.map((item) => `- ${item}`).join('\n')}`
      : '',
    contract.evaluationFocus.length > 0
      ? `Evaluation focus:\n${contract.evaluationFocus.map((item) => `- ${item}`).join('\n')}`
      : '',
    contract.reviewerSignals.length > 0
      ? `Reviewer signals:\n${contract.reviewerSignals.map((item) => `- ${item}`).join('\n')}`
      : '',
    contract.avoidRules.length > 0
      ? `Avoid rules:\n${contract.avoidRules.map((item) => `- ${item}`).join('\n')}`
      : '',
    contract.formatConstraints.length > 0
      ? `Format constraints:\n${contract.formatConstraints.map((item) => `- ${item}`).join('\n')}`
      : '',
    contract.narrativeConstraints.length > 0
      ? `Narrative constraints:\n${contract.narrativeConstraints.map((item) => `- ${item}`).join('\n')}`
      : '',
    contract.templateGuidance
      ? [
          'Template guidance:',
          contract.templateGuidance.reviewerGoal
            ? `Reviewer goal: ${contract.templateGuidance.reviewerGoal}`
            : '',
          contract.templateGuidance.guidanceText.length > 0
            ? `Guidance text:\n${contract.templateGuidance.guidanceText.map((item) => `- ${item}`).join('\n')}`
            : '',
          contract.templateGuidance.requiredFacts.length > 0
            ? `Template-required facts:\n${contract.templateGuidance.requiredFacts.map((item) => `- ${item}`).join('\n')}`
            : '',
          contract.templateGuidance.forbiddenMoves.length > 0
            ? `Template forbidden moves:\n${contract.templateGuidance.forbiddenMoves.map((item) => `- ${item}`).join('\n')}`
            : '',
        ].filter(Boolean).join('\n')
      : '',
    contract.submissionChecklist.length > 0
      ? `Submission checklist (visible but not prose requirements):\n${contract.submissionChecklist.map((item) => `- ${item}`).join('\n')}`
      : '',
    `Prep evidence:\n${prepEvidenceBlock}`,
    contract.hardChecks.length > 0
      ? `Hard checks:\n${contract.hardChecks.map((item) => `- ${item.label}: ${item.ruleText}`).join('\n')}`
      : '',
    contract.softChecks.length > 0
      ? `Soft checks:\n${contract.softChecks.map((item) => `- ${item.label}: ${item.ruleText}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n')
}
