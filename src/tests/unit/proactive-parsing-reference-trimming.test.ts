import { describe, expect, it } from 'vitest';
import {
  HARD_STOP_HEADING,
  stripTrailingSections,
} from '../../lib/services/proactive-parsing-service';
import { TextPreparationService } from '../../lib/services/text-preparation-service';

function buildLongBody(): string {
  return Array.from({ length: 45 }, (_, i) =>
    `Section ${i + 1} discusses the experimental setup, assumptions, data processing, and observed outcomes in detail.`
  ).join('\n');
}

describe('Reference Section Trimming', () => {
  it('matches common bibliography heading variants', () => {
    expect(HARD_STOP_HEADING.test('References and Notes')).toBe(true);
    expect(HARD_STOP_HEADING.test('VII. Literature Cited:')).toBe(true);
    expect(HARD_STOP_HEADING.test('3. Reference List')).toBe(true);
  });

  it('strips bibliography when heading is "References and Notes"', () => {
    const text = `${buildLongBody()}

References and Notes
[1] A. Smith, B. Jones. Journal of Testing, 2021.
[2] C. Lee. Another Study, 2022. https://doi.org/10.1234/example`;

    const stripped = stripTrailingSections(text);

    expect(stripped).toContain('Section 1 discusses the experimental setup');
    expect(stripped).not.toContain('References and Notes');
    expect(stripped).not.toContain('[1] A. Smith');
    expect(stripped.length).toBeLessThan(text.length);
  });

  it('strips short reference lists after numbered heading variants', () => {
    const text = `${buildLongBody()}

VII. Literature Cited:
[1] Doe, J. 2020. Example.
[2] Roe, K. 2021. Example.
[3] Poe, T. 2022. Example.`;

    const stripped = stripTrailingSections(text);

    expect(stripped).not.toContain('VII. Literature Cited');
    expect(stripped).not.toContain('[3] Poe');
  });

  it('does not truncate when "references" appears in regular body text', () => {
    const text = `${buildLongBody()}

In this section, references and notes are discussed as part of design rationale.
The paper then continues with more analysis and synthesis of outcomes.`;

    expect(stripTrailingSections(text)).toBe(text);
  });

  it('text preparation regexClean applies the same hard-stop trimming', () => {
    const service = new TextPreparationService();
    const text = `${buildLongBody()}

3. Reference List
1) A. Example, 2020.
2) B. Example, 2021.
3) C. Example, 2022.`;

    const cleaned = service.regexClean(text);

    expect(cleaned).not.toContain('3. Reference List');
    expect(cleaned).not.toContain('1) A. Example');
    expect(cleaned).toContain('Section 1 discusses the experimental setup');
  });
});
