import { describe, expect, it } from 'vitest';
import {
  hasMeaningfulTopicContent,
  mergePersistableTopic,
  normalizeTopicExtraction,
  prepareDocumentContentForExtraction
} from '@/lib/paper-topic-extraction';

describe('paper-topic-extraction', () => {
  it('normalizes snake_case fields, aliases, and confidence bounds', () => {
    const normalized = normalizeTopicExtraction({
      title: '  Adaptive Crop Monitoring  ',
      research_question: '  How accurately can the system detect crop stress?  ',
      methodology: 'mixed methods',
      contribution_type: 'applied',
      methodology_justification: '  Fits the field deployment and survey evidence.  ',
      abstract_draft: '  This paper proposes a hybrid monitoring workflow.  ',
      source_highlights: ['Accuracy 91%', 'accuracy 91%', '', 'Uses drone imagery'],
      expected_results: '  Improves F1 to 0.92 over the baseline.  ',
      confidence: '1.4'
    });

    expect(normalized.title).toBe('Adaptive Crop Monitoring');
    expect(normalized.researchQuestion).toBe('How accurately can the system detect crop stress?');
    expect(normalized.methodology).toBe('MIXED_METHODS');
    expect(normalized.contributionType).toBe('APPLIED');
    expect(normalized.methodologyJustification).toBe('Fits the field deployment and survey evidence.');
    expect(normalized.abstractDraft).toBe('This paper proposes a hybrid monitoring workflow.');
    expect(normalized.expectedResults).toBe('Improves F1 to 0.92 over the baseline.');
    expect(normalized.sourceHighlights).toEqual(['Accuracy 91%', 'Uses drone imagery']);
    expect(normalized.confidence).toBe(1);
  });

  it('merges extracted topic data without wiping existing content', () => {
    const merged = mergePersistableTopic(
      {
        title: 'Existing Paper Title',
        field: 'Computer Science',
        subfield: null,
        topicDescription: null,
        researchQuestion: 'What improves the robustness of the detector?',
        subQuestions: [],
        problemStatement: null,
        researchGaps: null,
        methodology: 'OTHER',
        methodologyApproach: null,
        techniques: [],
        methodologyJustification: 'Chosen to match the real-world deployment setting.',
        datasetDescription: null,
        dataCollection: null,
        sampleSize: null,
        tools: [],
        experiments: null,
        hypothesis: null,
        expectedResults: null,
        contributionType: 'EMPIRICAL',
        novelty: null,
        limitations: null,
        keywords: ['detector'],
        abstractDraft: null
      },
      {
        title: null,
        field: null,
        subfield: null,
        topicDescription: 'Introduces a robustness-aware detection pipeline.',
        researchQuestion: 'Which robustness controls improve detector stability in deployment?',
        subQuestions: ['How do controls affect false positives?'],
        problemStatement: null,
        researchGaps: null,
        methodology: 'QUANTITATIVE',
        methodologyApproach: null,
        techniques: [],
        methodologyJustification: null,
        datasetDescription: null,
        dataCollection: null,
        sampleSize: null,
        tools: ['Python'],
        experiments: null,
        hypothesis: null,
        expectedResults: null,
        contributionType: null,
        novelty: null,
        limitations: null,
        keywords: [],
        abstractDraft: null
      }
    );

    expect(merged.title).toBe('Existing Paper Title');
    expect(merged.field).toBe('Computer Science');
    expect(merged.topicDescription).toBe('Introduces a robustness-aware detection pipeline.');
    expect(merged.researchQuestion).toBe('Which robustness controls improve detector stability in deployment?');
    expect(merged.subQuestions).toEqual(['How do controls affect false positives?']);
    expect(merged.methodology).toBe('QUANTITATIVE');
    expect(merged.methodologyJustification).toBe('Chosen to match the real-world deployment setting.');
    expect(merged.tools).toEqual(['Python']);
    expect(merged.keywords).toEqual(['detector']);
    expect(merged.contributionType).toBe('EMPIRICAL');
  });

  it('preserves the beginning and end of long source documents', () => {
    const content = `${'BEGIN '.repeat(80)}${'MIDDLE '.repeat(300)}${'END '.repeat(80)}`;
    const prepared = prepareDocumentContentForExtraction(content, 240);

    expect(prepared).toContain('[... middle of document omitted for extraction, beginning and ending preserved ...]');
    expect(prepared.startsWith('BEGIN BEGIN')).toBe(true);
    expect(prepared.endsWith('END END END END END')).toBe(true);
    expect(prepared.length).toBeLessThanOrEqual(240);
  });

  it('does not treat placeholder topic rows as meaningful topic content', () => {
    expect(
      hasMeaningfulTopicContent({
        title: 'My Paper',
        researchQuestion: 'To be defined',
        methodology: 'OTHER',
        keywords: []
      })
    ).toBe(false);

    expect(
      hasMeaningfulTopicContent({
        title: 'My Paper',
        researchQuestion: 'To be defined',
        keywords: ['crop monitoring']
      })
    ).toBe(true);
  });
});
