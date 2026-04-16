import { describe, it, expect } from 'vitest';
import {
    parseParagraphs,
    countCitesInText,
    collectAllCiteKeys,
    validate,
    buildRewritePrompt,
} from '../../lib/services/citation-validator';

describe('Citation Budget Validator', () => {

    // =========================================================================
    // parseParagraphs
    // =========================================================================

    describe('parseParagraphs', () => {
        it('should split markdown by double newlines', () => {
            const content = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
            const result = parseParagraphs(content);
            expect(result).toHaveLength(3);
            expect(result[0]).toBe('First paragraph.');
            expect(result[1]).toBe('Second paragraph.');
            expect(result[2]).toBe('Third paragraph.');
        });

        it('should exclude heading-only blocks', () => {
            const content = '### Heading\n\nA real paragraph.\n\n## Another Heading\n\nAnother paragraph.';
            const result = parseParagraphs(content);
            expect(result).toHaveLength(2);
            expect(result[0]).toBe('A real paragraph.');
            expect(result[1]).toBe('Another paragraph.');
        });

        it('should keep heading + text blocks', () => {
            const content = '### Heading\nWith some text below it.\n\nStandalone paragraph.';
            const result = parseParagraphs(content);
            expect(result).toHaveLength(2);
            expect(result[0]).toContain('Heading');
            expect(result[0]).toContain('With some text below it.');
        });

        it('should return empty array for empty/null input', () => {
            expect(parseParagraphs('')).toEqual([]);
            expect(parseParagraphs(null as any)).toEqual([]);
            expect(parseParagraphs(undefined as any)).toEqual([]);
        });
    });

    // =========================================================================
    // countCitesInText
    // =========================================================================

    describe('countCitesInText', () => {
        it('should count single [CITE:key] markers', () => {
            const text = 'Some finding [CITE:Smith2023] and more text [CITE:Jones2024].';
            const { count, keys } = countCitesInText(text);
            expect(count).toBe(2);
            expect(keys).toContain('Smith2023');
            expect(keys).toContain('Jones2024');
        });

        it('should handle compound citations [CITE:a, b]', () => {
            const text = 'Evidence supports this [CITE:Smith2023, Jones2024].';
            const { count, keys } = countCitesInText(text);
            expect(count).toBe(2);
            expect(keys).toContain('Smith2023');
            expect(keys).toContain('Jones2024');
        });

        it('should return 0 for text without citations', () => {
            const text = 'No citations here.';
            const { count, keys } = countCitesInText(text);
            expect(count).toBe(0);
            expect(keys).toEqual([]);
        });

        it('should handle case-insensitive [CITE:] and [cite:]', () => {
            const text = 'Some text [cite:abc] and [CITE:def].';
            const { count, keys } = countCitesInText(text);
            expect(count).toBe(2);
            expect(keys).toContain('abc');
            expect(keys).toContain('def');
        });
    });

    // =========================================================================
    // collectAllCiteKeys
    // =========================================================================

    describe('collectAllCiteKeys', () => {
        it('should collect unique keys across paragraphs', () => {
            const paragraphs = [
                'Text [CITE:A] and [CITE:B].',
                'More text [CITE:B] and [CITE:C].',
            ];
            const keys = collectAllCiteKeys(paragraphs);
            expect(keys.size).toBe(3);
            expect(keys.has('A')).toBe(true);
            expect(keys.has('B')).toBe(true);
            expect(keys.has('C')).toBe(true);
        });
    });

    // =========================================================================
    // validate
    // =========================================================================

    describe('validate', () => {
        it('should PASS when under budget', () => {
            const content = [
                'First paragraph [CITE:A] with one cite.',
                '',
                'Second paragraph [CITE:B] also one.',
            ].join('\n');

            const report = validate(content, {
                maxCitesPerParagraph: 3,
                mustCiteKeys: [],
            });

            expect(report.passed).toBe(true);
            expect(report.budgetViolations).toHaveLength(0);
            expect(report.totalCitations).toBe(2);
            expect(report.totalParagraphs).toBe(2);
        });

        it('should FAIL when paragraph exceeds max cites', () => {
            const content = [
                'Heavy paragraph [CITE:A] [CITE:B] [CITE:C] [CITE:D] [CITE:E].',
                '',
                'Light paragraph [CITE:F].',
            ].join('\n');

            const report = validate(content, {
                maxCitesPerParagraph: 3,
                mustCiteKeys: ['A'],
            });

            expect(report.passed).toBe(false);
            expect(report.budgetViolations).toHaveLength(1);
            expect(report.budgetViolations[0].paragraphIndex).toBe(0);
            expect(report.budgetViolations[0].used).toBe(5);
            expect(report.budgetViolations[0].maxAllowed).toBe(3);
            // Must-cite key A should NOT be in the drop list
            expect(report.budgetViolations[0].citationsToDrop).not.toContain('A');
        });

        it('should detect missing must-cite keys', () => {
            const content = [
                'Text with [CITE:A].',
                '',
                'More text [CITE:B].',
            ].join('\n');

            const report = validate(content, {
                maxCitesPerParagraph: 5,
                mustCiteKeys: ['A', 'C', 'D'],
            });

            expect(report.passed).toBe(false);
            expect(report.mustCiteCheck.passed).toBe(false);
            expect(report.mustCiteCheck.missing).toContain('C');
            expect(report.mustCiteCheck.missing).toContain('D');
            expect(report.mustCiteCheck.missing).not.toContain('A');
        });

        it('should PASS when all must-cites are present and under budget', () => {
            const content = [
                'First [CITE:X] point.',
                '',
                'Second [CITE:Y] point.',
            ].join('\n');

            const report = validate(content, {
                maxCitesPerParagraph: 3,
                mustCiteKeys: ['X', 'Y'],
            });

            expect(report.passed).toBe(true);
            expect(report.mustCiteCheck.passed).toBe(true);
        });
    });

    // =========================================================================
    // buildRewritePrompt
    // =========================================================================

    describe('buildRewritePrompt', () => {
        it('should format directives for violations', () => {
            const report = validate(
                'Heavy [CITE:A] [CITE:B] [CITE:C] [CITE:D].\n\nOK [CITE:E].',
                { maxCitesPerParagraph: 2, mustCiteKeys: ['A'] }
            );

            const prompt = buildRewritePrompt('original content', report);
            expect(prompt).toContain('citation budget violations');
            expect(prompt).toContain('REWRITE DIRECTIVES');
            expect(prompt).toContain('original content');
        });
    });
});
