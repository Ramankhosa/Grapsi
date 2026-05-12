import { describe, expect, it } from 'vitest';

import { buildScopedPaperContext } from '../paper-context';

describe('buildScopedPaperContext', () => {
  const session = {
    researchTopic: { title: 'Community AI Hub' },
    paperSections: [
      { sectionKey: 'need', content: 'Problem gap content that should not be included.' },
      { sectionKey: 'methodology', displayName: 'Methodology', content: 'Selected workflow content for the figure.' },
      { sectionKey: 'impact', content: 'Impact pathway content that should not be included.' },
    ]
  };

  it('includes only the selected source section when suggestion metadata has sourceSections', () => {
    const context = buildScopedPaperContext(session, {
      relevantSection: 'methodology',
      sourceSections: [{ sectionKey: 'methodology', label: 'Methodology' }],
      scopeMode: 'selected_sections'
    });

    expect(context).toContain('[methodology] Selected workflow content');
    expect(context).not.toContain('[need]');
    expect(context).not.toContain('[impact]');
  });

  it('does not include title or abstract in selected-section generation context', () => {
    const context = buildScopedPaperContext({
      researchTopic: {
        title: 'Broad title that should not steer generation',
        abstractDraft: 'Broad abstract that should not steer generation.'
      },
      paperBlueprint: {
        thesisStatement: 'Broad thesis that should not steer generation.',
        centralObjective: 'Broad objective that should not steer generation.'
      },
      paperSections: [
        { sectionKey: 'methodology', displayName: 'Methodology', content: 'Selected methodology section content for the figure.' },
      ]
    }, {
      relevantSection: 'methodology',
      sourceSections: [{ sectionKey: 'methodology', label: 'Methodology' }],
      scopeMode: 'selected_sections'
    });

    expect(context).toContain('[methodology] Selected methodology section content');
    expect(context).not.toContain('Broad title');
    expect(context).not.toContain('Broad abstract');
    expect(context).not.toContain('Broad thesis');
    expect(context).not.toContain('Broad objective');
  });

  it('uses persisted focused source text before loading section text', () => {
    const context = buildScopedPaperContext(session, {
      relevantSection: 'methodology',
      sourceSections: [{ sectionKey: 'methodology', label: 'Methodology' }],
      scopeMode: 'focused_text',
      sourceText: 'Highlighted excerpt only.'
    });

    expect(context).toContain('Highlighted excerpt only.');
    expect(context).not.toContain('Selected workflow content for the figure.');
    expect(context).not.toContain('Community AI Hub');
  });

  it('falls back to concise multi-section context when no source section exists', () => {
    const context = buildScopedPaperContext(session);

    expect(context).toContain('[need]');
    expect(context).toContain('[methodology]');
    expect(context).toContain('[impact]');
  });
});
