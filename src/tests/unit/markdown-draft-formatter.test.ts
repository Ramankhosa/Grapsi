import { describe, expect, it } from 'vitest';
import {
  formatBibliographyMarkdown,
  parseGfmTableLines,
  polishDraftMarkdown,
} from '../../lib/markdown-draft-formatter';

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

  it('preserves GFM pipe tables verbatim with gaps around them', () => {
    const input = `The budget is summarized below.
| Item | Year 1 | Year 2 |
|------|-------:|-------:|
| Equipment | 40,000 | 12,000 |
| Personnel | 85,000 | 88,000 |
Totals include institutional overheads.`;

    const output = polishDraftMarkdown(input);
    const lines = output.split('\n');

    expect(lines).toContain('| Item | Year 1 | Year 2 |');
    expect(lines).toContain('|------|-------:|-------:|');
    expect(lines).toContain('| Equipment | 40,000 | 12,000 |');
    // Table separated from surrounding prose by blank lines
    expect(output).toContain('below.\n\n| Item');
    expect(output).toContain('88,000 |\n\nTotals');
  });

  it('does not promote bold table cells into headings', () => {
    const input = `| **Milestone** | Date |
|---|---|
| **Kickoff** | Jan |`;

    const output = polishDraftMarkdown(input);
    expect(output).not.toContain('###');
    expect(output).toContain('| **Milestone** | Date |');
  });

  it('parses well-formed GFM tables into headers and padded rows, rejects header-less runs', () => {
    const parsed = parseGfmTableLines([
      '| Item | Year 1 | Year 2 |',
      '|:-----|-------:|-------:|',
      '| Equipment | 40,000 |',
      '| Personnel \\| Staff | 85,000 | 88,000 |',
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.headers).toEqual(['Item', 'Year 1', 'Year 2']);
    expect(parsed!.rows).toEqual([
      ['Equipment', '40,000', ''],
      ['Personnel | Staff', '85,000', '88,000'],
    ]);

    // No separator row → not a proper table
    expect(parseGfmTableLines(['| a | b |', '| c | d |'])).toBeNull();
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
