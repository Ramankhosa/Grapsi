import { describe, expect, it } from 'vitest';
import {
  buildBudgetPriorityOverride,
  buildDriftReport,
  collectRequiredCitationKeys,
} from '../../lib/services/section-polish-service';

describe('buildDriftReport', () => {
  it('passes when required citation coverage is preserved even if other drift exists', () => {
    const base = 'The method improved accuracy to 92% [CITE:Smith2024].';
    const polished = 'The method improved performance [CITE:Smith2024] and [CITE:Lee2025].';

    const report = buildDriftReport(base, polished, [
      {
        dimensionKey: 'accuracy',
        dimensionLabel: 'Accuracy',
        expectedCitationKeys: ['Smith2024']
      }
    ]);

    expect(report.citationParity.passed).toBe(false);
    expect(report.numberPreservation.passed).toBe(false);
    expect(report.dimensionCoverage?.passed).toBe(true);
    expect(report.passed).toBe(true);
  });

  it('fails when required citation coverage is missing', () => {
    const base = 'The method improved accuracy [CITE:Smith2024].';
    const polished = 'The method improved accuracy substantially.';

    const report = buildDriftReport(base, polished, [
      {
        dimensionKey: 'accuracy',
        dimensionLabel: 'Accuracy',
        expectedCitationKeys: ['Smith2024']
      }
    ]);

    expect(report.dimensionCoverage?.passed).toBe(false);
    expect(report.dimensionCoverage?.uncoveredDimensions).toEqual(['Accuracy']);
    expect(report.passed).toBe(false);
  });

  it('passes when no must-cite expectations are provided', () => {
    const base = 'Baseline value was 42 [CITE:Smith2024].';
    const polished = 'Baseline findings changed.';

    const report = buildDriftReport(base, polished);

    expect(report.citationParity.passed).toBe(false);
    expect(report.numberPreservation.passed).toBe(false);
    expect(report.dimensionCoverage).toBeUndefined();
    expect(report.passed).toBe(true);
  });
});

describe('buildBudgetPriorityOverride', () => {
  it('treats length as higher priority when the base draft exceeds budget', () => {
    const base = Array.from({ length: 1600 }, (_, index) => `word${index}`).join(' ');

    const block = buildBudgetPriorityOverride(base, 1000, ['Smith2024', 'Lee2025']);

    expect(block).toContain('BUDGET PRIORITY OVERRIDE');
    expect(block).toContain('exceeds the intended budget by 600 words');
    expect(block).toContain('Length discipline overrides');
    expect(block).toContain('[CITE:Smith2024]');
    expect(block).toContain('optional citations');
  });

  it('prevents expansion when the source draft is already within budget', () => {
    const base = Array.from({ length: 900 }, (_, index) => `word${index}`).join(' ');

    const block = buildBudgetPriorityOverride(base, 1000, ['Smith2024']);

    expect(block).toContain('BUDGET DISCIPLINE');
    expect(block).toContain('Source draft length: 900 words');
    expect(block).toContain('do not expand the draft');
    expect(block).toContain('[CITE:Smith2024]');
  });
});

describe('collectRequiredCitationKeys', () => {
  it('deduplicates must-cite keys while preserving first-seen order', () => {
    const keys = collectRequiredCitationKeys([
      {
        dimensionKey: 'dim_a',
        dimensionLabel: 'Dimension A',
        expectedCitationKeys: ['Smith2024', 'Lee2025']
      },
      {
        dimensionKey: 'dim_b',
        dimensionLabel: 'Dimension B',
        expectedCitationKeys: ['Lee2025', 'Patel2023', '']
      }
    ]);

    expect(keys).toEqual(['Smith2024', 'Lee2025', 'Patel2023']);
  });
});
