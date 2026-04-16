import { describe, expect, it } from 'vitest';

import { extractFigureSuggestionMeta } from '../suggestion-meta';

describe('extractFigureSuggestionMeta', () => {
  it('preserves chart and plot routing metadata for generation', () => {
    const meta = extractFigureSuggestionMeta({
      title: 'Results comparison',
      description: 'Compare accuracy across datasets.',
      category: 'DATA_CHART',
      suggestedType: 'bar',
      rendererPreference: 'auto',
      relevantSection: 'results',
      figureRole: 'SHOW_RESULTS',
      sectionFitJustification: 'Results figures should foreground quantitative evidence.',
      expectedByReviewers: false,
      importance: 'required',
      dataNeeded: 'Accuracy by dataset',
      whyThisFigure: 'Shows the main benchmark comparison.',
      renderSpec: {
        kind: 'chart',
        chartSpec: {
          chartType: 'bar',
          xAxisLabel: 'Dataset',
          yAxisLabel: 'Accuracy (%)',
          xField: 'dataset',
          yField: 'accuracy'
        }
      },
      chartSpec: {
        chartType: 'bar',
        xAxisLabel: 'Dataset',
        yAxisLabel: 'Accuracy (%)',
        xField: 'dataset',
        yField: 'accuracy'
      },
      paperProfile: {
        paperGenre: 'empirical',
        studyType: 'experimental',
        dataAvailability: 'provided'
      }
    });

    expect(meta).toMatchObject({
      relevantSection: 'results',
      figureRole: 'SHOW_RESULTS',
      expectedByReviewers: false,
      importance: 'required',
      dataNeeded: 'Accuracy by dataset',
      whyThisFigure: 'Shows the main benchmark comparison.',
      chartSpec: {
        chartType: 'bar',
        xAxisLabel: 'Dataset',
        yAxisLabel: 'Accuracy (%)',
        xField: 'dataset',
        yField: 'accuracy'
      },
      renderSpec: {
        kind: 'chart',
        chartSpec: {
          chartType: 'bar',
          xAxisLabel: 'Dataset',
          yAxisLabel: 'Accuracy (%)',
          xField: 'dataset',
          yField: 'accuracy'
        }
      },
      paperProfile: {
        paperGenre: 'empirical',
        studyType: 'experimental',
        dataAvailability: 'provided'
      }
    });
  });

  it('drops nullish values but keeps explicit false booleans', () => {
    const meta = extractFigureSuggestionMeta({
      title: 'Method flow',
      description: 'Pipeline overview',
      category: 'DIAGRAM',
      suggestedType: 'flowchart',
      expectedByReviewers: false,
      rendererPreference: null as never,
      chartSpec: undefined
    });

    expect(meta).toEqual({
      expectedByReviewers: false
    });
  });
});
