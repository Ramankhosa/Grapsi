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

  it('drops invalid empty sketch-only enum metadata from non-sketch suggestions', () => {
    const meta = extractFigureSuggestionMeta({
      title: 'Method flow',
      description: 'Pipeline overview',
      category: 'DIAGRAM',
      suggestedType: 'flowchart',
      sketchStyle: '' as never,
      sketchMode: '' as never,
      sketchPrompt: ''
    });

    expect(meta).toBeUndefined();
  });

  it('preserves valid sketch metadata for illustrated suggestions', () => {
    const meta = extractFigureSuggestionMeta({
      title: 'Concept overview',
      description: 'Illustrated conceptual summary',
      category: 'ILLUSTRATED_FIGURE',
      suggestedType: 'sketch-auto',
      sketchStyle: 'conceptual',
      sketchMode: 'SUGGEST',
      sketchPrompt: 'Clean conceptual academic illustration'
    });

    expect(meta).toEqual({
      sketchStyle: 'conceptual',
      sketchPrompt: 'Clean conceptual academic illustration',
      sketchMode: 'SUGGEST'
    });
  });

  it('preserves source section scope metadata', () => {
    const meta = extractFigureSuggestionMeta({
      title: 'Workplan timeline',
      description: 'Milestone sequence.',
      category: 'DIAGRAM',
      importance: 'recommended',
      relevantSection: 'workplan',
      sectionLabelEvidence: [
        { sectionKey: 'workplan', label: 'Project Timeline', interpretedIntent: 'workplan_timeline' }
      ],
      sourceSections: [
        { sectionKey: 'workplan', label: 'Workplan' },
        { sectionKey: 'impact', label: 'Impact' }
      ],
      scopeMode: 'selected_sections'
    });

    expect(meta).toMatchObject({
      relevantSection: 'workplan',
      sectionLabelEvidence: [
        { sectionKey: 'workplan', label: 'Project Timeline', interpretedIntent: 'workplan_timeline' }
      ],
      sourceSections: [
        { sectionKey: 'workplan', label: 'Workplan' },
        { sectionKey: 'impact', label: 'Impact' }
      ],
      scopeMode: 'selected_sections'
    });
  });
});
