import { describe, expect, it } from 'vitest'

import {
  buildDraftOneQueue,
  buildRepairInstructions,
  countWords,
  normalizeDraftOneSection,
  shouldAutoRepair,
  summarizeDraftOneSections,
} from '@/lib/draftOne/logic'
import type { GrantComplianceReport } from '@/types/grant'

function makeRawSection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sectionKey: 'problem_need',
    label: 'Problem & Need',
    sectionOrder: 2,
    sectionType: 'narrative',
    workflowMode: 'app_draft',
    citationMode: 'mapped_evidence',
    required: true,
    wordBudget: 800,
    characterLimit: null,
    content: '',
    isStale: false,
    grantComplianceReport: null,
    reviewerReadinessReport: null,
    grantRuleProfile: {
      requiredPoints: ['Name the beneficiary group'],
      evaluationFocus: [],
      reviewerSignals: [],
      avoidRules: ['No unsupported claims'],
      formatConstraints: [],
    },
    ...overrides,
  }
}

function makeComplianceReport(overrides: Partial<GrantComplianceReport> = {}): GrantComplianceReport {
  return {
    stage: 'pass2',
    passed: false,
    coveredRequiredPoints: [],
    unmetRequiredPoints: ['Name the beneficiary group'],
    violatedAvoidRules: [],
    missingEvidence: [],
    hardFailures: [
      { key: 'word_budget', message: 'Section exceeds the word budget of 800.', ruleText: null, source: 'template' },
    ],
    softWarnings: [],
    usedPrepEvidence: [],
    generatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('draft one section normalization', () => {
  it('derives status from content, staleness, and compliance', () => {
    expect(normalizeDraftOneSection(makeRawSection()).status).toBe('pending')
    expect(normalizeDraftOneSection(makeRawSection({ content: 'Drafted text.' })).status).toBe('unvalidated')
    expect(
      normalizeDraftOneSection(
        makeRawSection({ content: 'Drafted text.', grantComplianceReport: makeComplianceReport({ passed: true, hardFailures: [] }) })
      ).status
    ).toBe('passed')
    expect(
      normalizeDraftOneSection(makeRawSection({ content: 'Drafted text.', grantComplianceReport: makeComplianceReport() })).status
    ).toBe('issues')
    expect(normalizeDraftOneSection(makeRawSection({ content: 'Drafted text.', isStale: true })).status).toBe('stale')
    expect(normalizeDraftOneSection(makeRawSection({ workflowMode: 'team_manual' })).status).toBe('manual')
    expect(normalizeDraftOneSection(makeRawSection({ sectionKey: 'bibliography' })).status).toBe('manual')
  })
})

describe('draft one queue', () => {
  it('queues only auto-draftable sections without content (or stale), in template order', () => {
    const sections = [
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'summary', sectionOrder: 1 })),
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'methodology', sectionOrder: 3 })),
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'drafted', sectionOrder: 2, content: 'Done already.' })),
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'stale_one', sectionOrder: 4, content: 'Old.', isStale: true })),
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'attachments', sectionOrder: 5, workflowMode: 'team_manual' })),
    ]
    const queue = buildDraftOneQueue(sections)
    expect(queue.map((section) => section.sectionKey)).toEqual(['summary', 'methodology', 'stale_one'])
    const full = buildDraftOneQueue(sections, { includeDrafted: true })
    expect(full.map((section) => section.sectionKey)).toEqual(['summary', 'drafted', 'methodology', 'stale_one'])
  })
})

describe('repair instructions', () => {
  it('folds unmet points, violations, word overage, and reviewer actions into the instruction, capped for the engine', () => {
    const content = Array.from({ length: 900 }, (_, index) => `word${index}`).join(' ')
    const instructions = buildRepairInstructions({
      section: { label: 'Problem & Need', wordBudget: 800, characterLimit: null, content },
      compliance: makeComplianceReport({ violatedAvoidRules: ['Do not promise regulatory approval'] }),
      readiness: {
        score: 55,
        strengths: [],
        risks: [],
        missingSignals: [],
        recommendedActions: ['Quantify the baseline need'],
        generatedAt: new Date().toISOString(),
      },
      userNote: 'Keep the One Health framing.',
    })
    expect(instructions).toContain('REPAIR PASS')
    expect(instructions).toContain('Name the beneficiary group')
    expect(instructions).toContain('Do not promise regulatory approval')
    expect(instructions).toContain('the agency limit is 800')
    expect(instructions).toContain('Quantify the baseline need')
    expect(instructions).toContain('Keep the One Health framing.')
    expect(instructions.length).toBeLessThanOrEqual(4900)
  })

  it('shouldAutoRepair fires only on actionable failed reports', () => {
    expect(shouldAutoRepair(null)).toBe(false)
    expect(shouldAutoRepair(makeComplianceReport({ passed: true, hardFailures: [] }))).toBe(false)
    expect(shouldAutoRepair(makeComplianceReport())).toBe(true)
    expect(
      shouldAutoRepair(makeComplianceReport({ unmetRequiredPoints: [], hardFailures: [], violatedAvoidRules: [] }))
    ).toBe(false)
  })
})

describe('summary + words', () => {
  it('summarizes drafting state across sections', () => {
    const sections = [
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'a', content: 'Text', grantComplianceReport: makeComplianceReport({ passed: true, hardFailures: [] }) })),
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'b', content: 'Text', grantComplianceReport: makeComplianceReport() })),
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'c' })),
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'attachments', workflowMode: 'team_manual' })),
    ]
    const summary = summarizeDraftOneSections(sections)
    expect(summary).toMatchObject({ total: 4, draftable: 3, drafted: 2, passed: 1, withIssues: 1, manual: 1 })
  })

  it('counts words robustly', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('  one   two\nthree ')).toBe(3)
  })
})
