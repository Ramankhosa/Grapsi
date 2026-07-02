import { describe, expect, it } from 'vitest';

import { chunkFundingDocumentSections } from '@/lib/fundingDocuments/chunker';
import { classifyQuestionCategoryHeuristic, sectionTypesForQuestionCategory } from '@/lib/fundingDocuments/constants';
import { cleanFundingDocumentPages } from '@/lib/fundingDocuments/parser';
import { runFundingDocumentQualityChecks } from '@/lib/fundingDocuments/qualityChecks';
import { isFundingDocumentHeadingLine, sectionizeFundingDocument } from '@/lib/fundingDocuments/sectionizer';

describe('funding document parsing helpers', () => {
  it('cleans repeated headers, page numbers, duplicate lines, and hyphenated line breaks', () => {
    const pages = cleanFundingDocumentPages([
      {
        pageNumber: 1,
        rawText: 'Funding Call 2026\n1\nELIGIBILITY\nexam-\nple applicant\nexample applicant\nFooter',
      },
      {
        pageNumber: 2,
        rawText: 'Funding Call 2026\n2\nBUDGET\nTotal support INR 10 lakh\nFooter',
      },
      {
        pageNumber: 3,
        rawText: 'Funding Call 2026\n3\nDATES\nDeadline 31 Dec 2026\nFooter',
      },
    ]);

    expect(pages[0].cleanedText).toContain('example applicant');
    expect(pages[0].cleanedText).not.toContain('Funding Call 2026');
    expect(pages[0].cleanedText).not.toContain('\n1\n');
    expect(pages[0].cleanedText.match(/example applicant/g)).toHaveLength(1);
  });
});

describe('funding document sectionizer', () => {
  it('detects headings and maps section types without crossing page boundaries', async () => {
    expect(isFundingDocumentHeadingLine('3. Eligibility')).toBe(true);
    const sections = await sectionizeFundingDocument([
      {
        pageNumber: 1,
        rawText: '',
        cleanedText: '1. Overview\nThis scheme supports research.\n2. Eligibility\nUniversities can apply.',
        extractionConfidence: 0.95,
      },
      {
        pageNumber: 2,
        rawText: '',
        cleanedText: '3. Important dates\nDeadline 31 Dec 2026.',
        extractionConfidence: 0.95,
      },
    ]);

    expect(sections.map((section) => section.sectionType)).toEqual(['overview', 'eligibility', 'important_dates']);
    expect(sections[1]).toMatchObject({ startPage: 1, endPage: 1, classificationMethod: 'heading' });
    expect(sections[2]).toMatchObject({ startPage: 2, endPage: 2 });
  });
});

describe('funding document chunker', () => {
  it('keeps protected short sections as single chunks and preserves section metadata', () => {
    const chunks = chunkFundingDocumentSections([
      {
        sectionType: 'eligibility',
        sectionTitle: 'Eligibility',
        sectionText: 'Eligible applicants must be accredited universities.',
        startPage: 4,
        endPage: 5,
        orderIndex: 0,
        confidence: 0.9,
        classificationMethod: 'heading',
      },
      {
        sectionType: 'overview',
        sectionTitle: 'Overview',
        sectionText: Array.from({ length: 200 }, (_, index) => `Paragraph ${index} explains the programme.`).join('\n\n'),
        startPage: 6,
        endPage: 8,
        orderIndex: 1,
        confidence: 0.8,
        classificationMethod: 'heading',
      },
    ]);

    expect(chunks[0]).toMatchObject({
      sourceSectionOrderIndex: 0,
      sectionType: 'eligibility',
      pageStart: 4,
      pageEnd: 5,
    });
    expect(chunks.filter((chunk) => chunk.sourceSectionOrderIndex === 0)).toHaveLength(1);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe('funding document quality checks', () => {
  it('flags deadline and budget conflicts without mutating structured data', () => {
    const report = runFundingDocumentQualityChecks(
      {
        open_date: new Date('2026-01-01'),
        close_date: new Date('2026-06-30'),
        is_rolling: false,
        amount_min: null,
        amount_max: 1000,
        is_active: true,
      } as any,
      [
        {
          sectionType: 'important_dates',
          sectionTitle: 'Important dates',
          sectionText: 'The last date for submission is 31 Dec 2026.',
          startPage: 2,
          endPage: 2,
          orderIndex: 0,
          confidence: 0.9,
          classificationMethod: 'heading',
        },
        {
          sectionType: 'budget_rules',
          sectionTitle: 'Budget',
          sectionText: 'Maximum support is INR 10 lakh.',
          startPage: 3,
          endPage: 3,
          orderIndex: 1,
          confidence: 0.9,
          classificationMethod: 'heading',
        },
      ]
    );

    expect(report.needsManualReview).toBe(true);
    expect(report.conflicts.map((flag) => flag.code)).toContain('close_date_conflict');
    expect(report.conflicts.map((flag) => flag.code)).toContain('budget_amount_conflict');
  });
});

describe('funding document question routing', () => {
  it('routes common Q&A categories to expected section types', () => {
    expect(classifyQuestionCategoryHeuristic('Can early career researchers apply?')).toBe('eligibility');
    expect(sectionTypesForQuestionCategory('eligibility')).toEqual([
      'eligibility',
      'consortium_partner_rules',
      'exclusions',
    ]);
    expect(classifyQuestionCategoryHeuristic('What documents must I upload?')).toBe('documents');
    expect(sectionTypesForQuestionCategory('dates')).toContain('important_dates');
  });
});
