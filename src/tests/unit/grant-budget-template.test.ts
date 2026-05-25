import { describe, expect, it } from 'vitest'

import {
  buildBudgetDraftingPrompt,
  buildBudgetStructuredScaffold,
  validateBudgetDraftLlmResult,
} from '@/lib/grants/budgetTemplate'
import type { GrantBlueprintPlanSection, GrantBudgetTemplateScaffold } from '@/types/grant'

function budgetTemplate(): GrantBudgetTemplateScaffold {
  return {
    source: 'extracted',
    required: true,
    yearWise: true,
    fixedCategories: true,
    currency: 'USD',
    columns: [
      { key: 'category', label: 'Category', kind: 'category', required: true },
      { key: 'year_1', label: 'Year 1', kind: 'year' },
      { key: 'year_2', label: 'Year 2', kind: 'year' },
      { key: 'justification', label: 'Justification', kind: 'justification' },
    ],
    categories: [
      { key: 'equipment', label: 'Equipment', cap: '30%', notes: 'Hardware only' },
      { key: 'personnel', label: 'Personnel' },
    ],
    caps: { equipment: '30%' },
    notes: 'Use the funder budget format.',
    sourceAnchors: [{ asset_id: 'cm_asset_1' }],
    supportLevel: 'full',
    confidence: 0.9,
  }
}

function section(template = budgetTemplate()): GrantBlueprintPlanSection {
  return {
    sectionKey: 'budget',
    label: 'Budget',
    order: 1,
    sectionType: 'budget_rows',
    workflowMode: 'app_support',
    citationMode: 'no_citations',
    required: true,
    wordBudget: null,
    characterLimit: null,
    purpose: 'Provide the budget.',
    reviewerIntent: null,
    dependencies: [],
    sourceTemplatePointer: 'budget',
    templateIntent: 'budget',
    templateIntentAlternates: [],
    templateIntentConfidence: 1,
    mustCover: ['Equipment', 'Personnel'],
    mustAvoid: [],
    seededContext: '',
    budgetTemplate: template,
  }
}

describe('grant budget template scaffold and drafting contract', () => {
  it('creates a structured scaffold from extracted budget columns and categories', () => {
    const scaffold = buildBudgetStructuredScaffold({
      section: section(),
      currency: 'USD',
    })

    expect(scaffold.columns).toEqual([
      { key: 'category', label: 'Category', kind: 'category', required: true, sourceAnchors: [] },
      { key: 'year_1', label: 'Year 1', kind: 'year', required: false, sourceAnchors: [] },
      { key: 'year_2', label: 'Year 2', kind: 'year', required: false, sourceAnchors: [] },
      { key: 'justification', label: 'Justification', kind: 'justification', required: false, sourceAnchors: [] },
    ])
    expect(scaffold.rows).toEqual([
      { category: 'Equipment', year_1: null, year_2: null, justification: null },
      { category: 'Personnel', year_1: null, year_2: null, justification: null },
    ])
    expect(scaffold.constraints).toEqual({ equipment: '30%' })
  })

  it('creates one blank fallback row for required budgets without extracted categories', () => {
    const scaffold = buildBudgetStructuredScaffold({
      section: section({
        ...budgetTemplate(),
        fixedCategories: false,
        categories: [],
        columns: [],
      }),
      currency: 'USD',
    })

    expect(scaffold.columns).toMatchObject([
      { key: 'category', label: 'Category' },
      { key: 'amount', label: 'Amount' },
      { key: 'justification', label: 'Justification' },
    ])
    expect(scaffold.rows).toEqual([{ category: '', amount: null, justification: null }])
  })

  it('builds a budget-specific JSON-only prompt with the template and hard rules', () => {
    const prompt = buildBudgetDraftingPrompt({
      budgetTemplate: budgetTemplate(),
      currentData: { rows: [] },
      grantContextSummary: ['Project: Demo'],
      prepFacts: ['Use prototype hardware for Equipment.'],
      userInstructions: 'Add a short justification only.',
    })

    expect(prompt).toContain('Return ONLY raw JSON')
    expect(prompt).toContain('Preserve the provided column keys exactly')
    expect(prompt).toContain('Do not invent amounts')
    expect(prompt).toContain('"key": "year_1"')
    expect(prompt).toContain('Use prototype hardware for Equipment.')
  })

  it('validates LLM output, strips unknown columns, and preserves existing numeric values', () => {
    const result = validateBudgetDraftLlmResult({
      template: budgetTemplate(),
      currentData: {
        rows: [
          { category: 'Equipment', year_1: '1200', year_2: null, justification: '' },
          { category: 'Personnel', year_1: null, year_2: null, justification: '' },
        ],
      },
      rawOutput: JSON.stringify({
        currency: 'USD',
        columns: [{ key: 'bad', label: 'Bad' }],
        rows: [
          {
            category: 'Equipment',
            year_1: '9999',
            year_2: 'TBD',
            justification: 'Prototype hardware.',
            bad: 'remove me',
          },
          {
            category: 'Personnel',
            year_1: 'unknown',
            year_2: '5000',
            justification: 'Staff time.',
          },
        ],
        notes: 'Drafted from prep facts.',
        openQuestions: ['Confirm personnel amount.'],
      }),
      allowNewNumericValues: false,
      preserveCurrentNumericValues: true,
    })

    expect((result.columns as Array<{ key: string }>).map((column) => column.key)).toEqual([
      'category',
      'year_1',
      'year_2',
      'justification',
    ])
    expect(result.rows).toEqual([
      { category: 'Equipment', year_1: '1200', year_2: null, justification: 'Prototype hardware.' },
      { category: 'Personnel', year_1: null, year_2: null, justification: 'Staff time.' },
    ])
    expect(JSON.stringify(result.rows)).not.toContain('remove me')
    expect(result.openQuestions).toEqual(['Confirm personnel amount.'])
  })

  it('rejects malformed or prose-wrapped budget LLM output', () => {
    expect(() => validateBudgetDraftLlmResult({
      template: budgetTemplate(),
      rawOutput: 'Here is the JSON: {"rows":[]}',
    })).toThrow('single JSON object')
  })
})
