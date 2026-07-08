import { describe, expect, it } from 'vitest'

import {
  createEmptyGuidelinePack,
  hasGuidelineRules,
  shouldAutoApplyGuidelineExtraction,
} from '@/lib/fundingGuidelines/utils'

function packWithPriority() {
  return {
    ...createEmptyGuidelinePack(),
    priorities: [{ key: 'p1', text: 'Advance equitable health outcomes' }],
  }
}

describe('hasGuidelineRules', () => {
  it('is false for empty, missing, and malformed input', () => {
    expect(hasGuidelineRules(createEmptyGuidelinePack())).toBe(false)
    expect(hasGuidelineRules(null)).toBe(false)
    expect(hasGuidelineRules(undefined)).toBe(false)
  })

  it('is true when any block contains a rule', () => {
    expect(hasGuidelineRules(packWithPriority())).toBe(true)
    expect(
      hasGuidelineRules({
        ...createEmptyGuidelinePack(),
        mustAddress: [{ key: 'm1', text: 'Include a data management plan' }],
      })
    ).toBe(true)
  })
})

describe('shouldAutoApplyGuidelineExtraction', () => {
  it('auto-applies a non-empty run onto an empty current pack', () => {
    expect(shouldAutoApplyGuidelineExtraction(createEmptyGuidelinePack(), packWithPriority())).toBe(true)
    expect(shouldAutoApplyGuidelineExtraction(null, packWithPriority())).toBe(true)
  })

  it('never auto-applies over an existing pack with rules', () => {
    expect(shouldAutoApplyGuidelineExtraction(packWithPriority(), packWithPriority())).toBe(false)
  })

  it('never auto-applies an empty run result', () => {
    expect(shouldAutoApplyGuidelineExtraction(createEmptyGuidelinePack(), createEmptyGuidelinePack())).toBe(false)
  })
})
