import { describe, expect, it } from 'vitest';
import { formatBibliographyMarkdown, polishDraftMarkdown } from '../../lib/markdown-draft-formatter';

describe('polishDraftMarkdown', () => {
  it('extracts fenced markdown and normalizes list markers', () => {
    const input = `\`\`\`markdown
## Findings
\u2022 first point
* second point
  + nested point
\`\`\``;

    const output = polishDraftMarkdown(input);

    expect(output).toContain('## Findings');
    expect(output).toContain('- first point');
    expect(output).toContain('- second point');
    expect(output).toContain('  - nested point');
    expect(output).not.toContain('```');
  });

  it('normalizes ordered list formats and preserves citation placeholders', () => {
    const input = `1) Intro [CITE:Smith2024]
2) Method [CITE:Lee2023]`;

    const output = polishDraftMarkdown(input);

    expect(output).toContain('1. Intro [CITE:Smith2024]');
    expect(output).toContain('2. Method [CITE:Lee2023]');
  });

  it('promotes standalone bold text into markdown headings', () => {
    const input = `**Related Work**
Prior studies indicate strong baseline results.`;

    const output = polishDraftMarkdown(input);
    expect(output).toContain('### Related Work');
  });

  it('does NOT promote bold labels with trailing prose into headings', () => {
    const input = `**Data Sources:** We collected data from three hospitals.
**Sample Size:** The total sample included 500 patients.`;

    const output = polishDraftMarkdown(input);
    // These should remain as bold labels, not promoted to headings
    expect(output).not.toContain('### Data Sources');
    expect(output).not.toContain('### Sample Size');
    expect(output).toContain('**Data Sources:**');
    expect(output).toContain('**Sample Size:**');
  });

  it('promotes ALL-CAPS colon headings but not mixed-case labels', () => {
    const input = `METHODOLOGY:
1) Collect data
2) Evaluate`;

    const output = polishDraftMarkdown(input);
    expect(output).toContain('### METHODOLOGY');
    expect(output).toContain('1. Collect data');
    expect(output).toContain('2. Evaluate');
  });

  it('preserves blockquotes with > prefix', () => {
    const input = `Some text before.

> This is a blockquote from a notable researcher.
> It spans multiple lines.

Some text after.`;

    const output = polishDraftMarkdown(input);
    expect(output).toContain('> This is a blockquote from a notable researcher.');
    expect(output).toContain('> It spans multiple lines.');
  });

  it('decodes literal escaped newlines from JSON content strings', () => {
    const input = '### Problem Context\\nFirst paragraph.\\n\\n- Contribution A\\n- Contribution B';
    const output = polishDraftMarkdown(input);

    expect(output).toContain('### Problem Context');
    expect(output).toContain('- Contribution A');
    expect(output).toContain('- Contribution B');
    expect(output).not.toContain('\\n');
  });

  it('formats alphabetical bibliography as markdown bullets', () => {
    const input = `Smith, J. (2024). Paper A.

Lee, K. (2023). Paper B.`;

    const output = formatBibliographyMarkdown(input, 'alphabetical');

    expect(output).toContain('- Smith, J. (2024). Paper A.');
    expect(output).toContain('- Lee, K. (2023). Paper B.');
  });

  it('formats order-of-appearance bibliography as numbered markdown list', () => {
    const input = `[1] Smith, J. (2024). Paper A.

[2] Lee, K. (2023). Paper B.`;

    const output = formatBibliographyMarkdown(input, 'order_of_appearance');

    expect(output).toContain('1. Smith, J. (2024). Paper A.');
    expect(output).toContain('2. Lee, K. (2023). Paper B.');
  });
});
