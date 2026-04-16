import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CitationStyleService, type CitationData } from '../../lib/services/citation-style-service';

// Mock prisma
vi.mock('../../lib/prisma', () => ({
  prisma: {
    citationStyleDefinition: {
      findUnique: vi.fn()
    }
  }
}));

import { prisma } from '../../lib/prisma';

describe('CitationStyleService', () => {
  let service: CitationStyleService;
  let mockCitation: CitationData;

  beforeEach(() => {
    service = new CitationStyleService();
    service.invalidateCache(); // Clear cache between tests

  mockCitation = {
    id: 'test-citation-1',
    title: 'Deep Learning Approaches for Natural Language Processing: A Comprehensive Survey',
    authors: ['John A. Smith', 'Emily R. Johnson', 'Michael K. Brown'],
    year: 2023,
    venue: 'Journal of Artificial Intelligence Research',
    volume: '67',
    issue: '2',
    pages: '145-189',
    doi: '10.5555/12345678',
    citationKey: 'Smith2023a'
  };

    // Reset mocks
    vi.clearAllMocks();
  });

  describe('formatInTextCitation', () => {
    it('should format APA7 in-text citation correctly', async () => {
      // Mock APA7 style
      (prisma.citationStyleDefinition.findUnique as any).mockResolvedValue({
        id: 'apa7-style',
        code: 'APA7',
        name: 'APA 7th Edition',
        inTextFormatTemplate: '(Author, Year)',
        bibliographyRules: {},
        bibliographySortOrder: 'alphabetical',
        isActive: true,
        maxAuthorsBeforeEtAl: 3,
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const result = await service.formatInTextCitation(mockCitation, 'APA7');
      expect(result).toBe('(Smith et al., 2023)');
    });

    it('should format single author APA7 citation', async () => {
      (prisma.citationStyleDefinition.findUnique as any).mockResolvedValue({
        code: 'APA7',
        name: 'APA 7th Edition',
        inTextFormatTemplate: '(Author, Year)',
        bibliographyRules: {},
        bibliographySortOrder: 'alphabetical',
        isActive: true,
        maxAuthorsBeforeEtAl: 3
      });

      const singleAuthorCitation = { ...mockCitation, authors: ['John A. Smith'] };
      const result = await service.formatInTextCitation(singleAuthorCitation, 'APA7');
      expect(result).toBe('(Smith, 2023)');
    });

    it('should format two authors APA7 citation', async () => {
      (prisma.citationStyleDefinition.findUnique as any).mockResolvedValue({
        code: 'APA7',
        name: 'APA 7th Edition',
        inTextFormatTemplate: '(Author, Year)',
        bibliographyRules: {},
        bibliographySortOrder: 'alphabetical',
        isActive: true,
        maxAuthorsBeforeEtAl: 3
      });

      const twoAuthorsCitation = { ...mockCitation, authors: ['John A. Smith', 'Emily R. Johnson'] };
      const result = await service.formatInTextCitation(twoAuthorsCitation, 'APA7');
      expect(result).toBe('(Smith & Johnson, 2023)');
    });

    it('should handle missing year', async () => {
      (prisma.citationStyleDefinition.findUnique as any).mockResolvedValue({
        code: 'APA7',
        name: 'APA 7th Edition',
        inTextFormatTemplate: '(Author, Year)',
        bibliographyRules: {},
        bibliographySortOrder: 'alphabetical',
        isActive: true,
        maxAuthorsBeforeEtAl: 3
      });

      const noYearCitation = { ...mockCitation, year: undefined };
      const result = await service.formatInTextCitation(noYearCitation, 'APA7');
      expect(result).toBe('(Smith et al., n.d.)');
    });

    it('should handle missing authors', async () => {
      (prisma.citationStyleDefinition.findUnique as any).mockResolvedValue({
        code: 'APA7',
        name: 'APA 7th Edition',
        inTextFormatTemplate: '(Author, Year)',
        bibliographyRules: {},
        bibliographySortOrder: 'alphabetical',
        isActive: true,
        maxAuthorsBeforeEtAl: 3
      });

      const noAuthorsCitation = { ...mockCitation, authors: [] };
      const result = await service.formatInTextCitation(noAuthorsCitation, 'APA7');
      expect(result).toBe('(Anonymous, 2023)');
    });

    it('should format IEEE in-text citation', async () => {
      (prisma.citationStyleDefinition.findUnique as any).mockResolvedValue({
        code: 'IEEE',
        name: 'IEEE',
        inTextFormatTemplate: '[Number]',
        bibliographyRules: {},
        bibliographySortOrder: 'order_of_appearance',
        isActive: true,
        maxAuthorsBeforeEtAl: 3
      });

      const result = await service.formatInTextCitation(mockCitation, 'IEEE');
      expect(result).toBe('[1]');
    });

    it('should format IEEE in-text citation with explicit citation number', async () => {
      (prisma.citationStyleDefinition.findUnique as any).mockResolvedValue({
        code: 'IEEE',
        name: 'IEEE',
        inTextFormatTemplate: '[Number]',
        bibliographyRules: {},
        bibliographySortOrder: 'order_of_appearance',
        isActive: true,
        maxAuthorsBeforeEtAl: 3
      });

      const result = await service.formatInTextCitation(mockCitation, 'IEEE', {
        citationNumber: 7
      });
      expect(result).toBe('[7]');
    });

    it('should format IEEE in-text citation using citation numbering map', async () => {
      (prisma.citationStyleDefinition.findUnique as any).mockResolvedValue({
        code: 'IEEE',
        name: 'IEEE',
        inTextFormatTemplate: '[Number]',
        bibliographyRules: {},
        bibliographySortOrder: 'order_of_appearance',
        isActive: true,
        maxAuthorsBeforeEtAl: 3
      });

      const result = await service.formatInTextCitation(mockCitation, 'IEEE', {
        citationNumbering: {
          [mockCitation.citationKey]: 4
        }
      });
      expect(result).toBe('[4]');
    });

    it('should format Chicago author-date in-text citation', async () => {
      (prisma.citationStyleDefinition.findUnique as any).mockResolvedValue({
        code: 'CHICAGO_AUTHOR_DATE',
        name: 'Chicago (Author-Date)',
        inTextFormatTemplate: '(Author Year)',
        bibliographyRules: {},
        bibliographySortOrder: 'alphabetical',
        isActive: true,
        maxAuthorsBeforeEtAl: 3
      });

      const result = await service.formatInTextCitation(mockCitation, 'CHICAGO_AUTHOR_DATE');
      expect(result).toBe('(Smith 2023)');
    });

    it('should format MLA9 in-text citation', async () => {
      (prisma.citationStyleDefinition.findUnique as any).mockResolvedValue({
        code: 'MLA9',
        name: 'MLA 9th Edition',
        inTextFormatTemplate: '(Author Page)',
        bibliographyRules: {},
        bibliographySortOrder: 'alphabetical',
        isActive: true,
        maxAuthorsBeforeEtAl: 3
      });

      const result = await service.formatInTextCitation(mockCitation, 'MLA9');
      expect(result).toBe('(Smith 2023)');
    });

    it('should throw error for unknown citation style', async () => {
      (prisma.citationStyleDefinition.findUnique as any).mockResolvedValue(null);

      await expect(service.formatInTextCitation(mockCitation, 'UNKNOWN_STYLE'))
        .rejects.toThrow('Citation style not found: UNKNOWN_STYLE');
    });
  });

  describe('formatBibliographyEntry', () => {
    it('should format APA7 bibliography entry correctly', async () => {
      (prisma.citationStyleDefinition.findUnique as any).mockResolvedValue({
        code: 'APA7',
        name: 'APA 7th Edition',
        bibliographyRules: {},
        bibliographySortOrder: 'alphabetical',
        isActive: true,
        maxAuthorsBeforeEtAl: 3
      });

      const result = await service.formatBibliographyEntry(mockCitation, 'APA7');
      expect(result).toContain('Smith, J. A., Johnson, E. R., & Brown, M. K. (2023). Deep Learning Approaches for Natural Language Processing: A Comprehensive Survey. Journal of Artificial Intelligence Research, 67(2), 145-189. https://doi.org/10.5555/12345678');
    });

    it('should format IEEE bibliography entry', async () => {
      (prisma.citationStyleDefinition.findUnique as any).mockResolvedValue({
        code: 'IEEE',
        name: 'IEEE',
        bibliographyRules: {},
        bibliographySortOrder: 'order_of_appearance',
        isActive: true,
        maxAuthorsBeforeEtAl: 3
      });

      const result = await service.formatBibliographyEntry(mockCitation, 'IEEE');
      expect(result).toContain('J. A. Smith, E. R. Johnson, M. K. Brown, "Deep Learning Approaches for Natural Language Processing: A Comprehensive Survey," Journal of Artificial Intelligence Research, vol. 67, no. 2, pp. 145-189, 2023.');
    });

    it('should format Chicago bibliography entry', async () => {
      (prisma.citationStyleDefinition.findUnique as any).mockResolvedValue({
        code: 'CHICAGO_AUTHOR_DATE',
        name: 'Chicago (Author-Date)',
        bibliographyRules: {},
        bibliographySortOrder: 'alphabetical',
        isActive: true,
        maxAuthorsBeforeEtAl: 3
      });

      const result = await service.formatBibliographyEntry(mockCitation, 'CHICAGO_AUTHOR_DATE');
      expect(result).toContain('John A. Smith, Emily R. Johnson, and Michael K. Brown 2023. "Deep Learning Approaches for Natural Language Processing: A Comprehensive Survey." Journal of Artificial Intelligence Research 67, no. 2: 145-189.');
    });
  });

  describe('generateCitationKey', () => {
    it('should generate citation key from authors and year', () => {
      const key = service.generateCitationKey(mockCitation);
      expect(key).toBe('Smith2023');
    });

    it('should generate unique keys for same author/year combinations', () => {
      const existingKeys = ['Smith2023'];
      const key = service.generateCitationKey(mockCitation, existingKeys);
      expect(key).toBe('Smith2023a');
    });

    it('should handle multiple duplicate keys', () => {
      const existingKeys = ['Smith2023', 'Smith2023a', 'Smith2023b'];
      const key = service.generateCitationKey(mockCitation, existingKeys);
      expect(key).toBe('Smith2023c');
    });

    it('should generate key from title when no authors', () => {
      const noAuthorCitation = { ...mockCitation, authors: [] };
      const key = service.generateCitationKey(noAuthorCitation);
      expect(key).toBe('DeepLe2023');
    });

    it('should handle missing year', () => {
      const noYearCitation = { ...mockCitation, year: undefined };
      const key = service.generateCitationKey(noYearCitation);
      expect(key).toBe('SmithNoYear');
    });
  });

  describe('parseBibTeX', () => {
    it('should parse BibTeX article entry', () => {
      const bibtex = `@article{Smith2023a,
  title={Deep Learning Approaches for Natural Language Processing: A Comprehensive Survey},
  author={Smith, John A. and Johnson, Emily R. and Brown, Michael K.},
  journal={Journal of Artificial Intelligence Research},
  volume={67},
  number={2},
  pages={145--189},
  year={2023},
  doi={10.5555/12345678}
}`;

      const citations = service.parseBibTeX(bibtex);
      expect(citations).toHaveLength(1);
      expect(citations[0].title).toBe('Deep Learning Approaches for Natural Language Processing: A Comprehensive Survey');
      expect(citations[0].authors).toEqual(['Smith, John A.', 'Johnson, Emily R.', 'Brown, Michael K.']);
      expect(citations[0].year).toBe(2023);
      expect(citations[0].citationKey).toBe('Smith2023a');
    });

    it('should parse multiple BibTeX entries', () => {
      const bibtex = `@article{Smith2023a,
  title={Title 1},
  author={Smith, John},
  year={2023}
}
@inproceedings{Johnson2022,
  title={Title 2},
  author={Johnson, Emily},
  year={2022}
}`;

      const citations = service.parseBibTeX(bibtex);
      expect(citations).toHaveLength(2);
      expect(citations[0].citationKey).toBe('Smith2023a');
      expect(citations[1].citationKey).toBe('Johnson2022');
    });
  });

  describe('exportToBibTeX', () => {
    it('should export citations to BibTeX format', async () => {
      const citations = [mockCitation];
      const bibtex = await service.exportToBibTeX(citations);

      expect(bibtex).toContain('@article{Smith2023a,');
      expect(bibtex).toContain('title={Deep Learning Approaches for Natural Language Processing: A Comprehensive Survey}');
      expect(bibtex).toContain('author={John A. Smith and Emily R. Johnson and Michael K. Brown}');
      expect(bibtex).toContain('year={2023}');
      expect(bibtex).toContain('doi={10.5555/12345678}');
    });
  });

  describe('generateBibliography', () => {
    it('should generate bibliography with alphabetical sorting', async () => {
      (prisma.citationStyleDefinition.findUnique as any).mockResolvedValue({
        code: 'APA7',
        name: 'APA 7th Edition',
        bibliographyRules: {},
        bibliographySortOrder: 'alphabetical',
        isActive: true,
        maxAuthorsBeforeEtAl: 3
      });

      const citations = [
        { ...mockCitation, citationKey: 'Brown2023', authors: ['Anna Brown'] },
        { ...mockCitation, citationKey: 'Smith2023', authors: ['Zoe Smith'] }
      ];

      const bibliography = await service.generateBibliography(citations, 'APA7');
      const lines = bibliography.split('\n\n');
      expect(lines).toHaveLength(2);
      // Should be sorted alphabetically by author
      expect(lines[0]).toContain('Brown, A. (2023)');
      expect(lines[1]).toContain('Smith, Z. (2023)');
    });

    it('should generate bibliography with order of appearance', async () => {
      (prisma.citationStyleDefinition.findUnique as any).mockResolvedValue({
        code: 'IEEE',
        name: 'IEEE',
        bibliographyRules: {},
        bibliographySortOrder: 'order_of_appearance',
        isActive: true,
        maxAuthorsBeforeEtAl: 3
      });

      const citations = [
        { ...mockCitation, citationKey: 'Smith2023' },
        { ...mockCitation, citationKey: 'Brown2023', authors: ['Brown, Michael'] }
      ];

      const bibliography = await service.generateBibliography(citations, 'IEEE', { sortOrder: 'order_of_appearance' });
      const lines = bibliography.split('\n\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('[1]');
      expect(lines[1]).toContain('[2]');
    });

    it('should return empty string for empty citations array', async () => {
      (prisma.citationStyleDefinition.findUnique as any).mockResolvedValue({
        code: 'APA7',
        name: 'APA 7th Edition',
        bibliographyRules: {},
        bibliographySortOrder: 'alphabetical',
        isActive: true,
        maxAuthorsBeforeEtAl: 3
      });

      const bibliography = await service.generateBibliography([], 'APA7');
      expect(bibliography).toBe('');
    });
  });

  describe('caching', () => {
    it('should cache citation style lookups', async () => {
      const mockStyle = {
        code: 'APA7',
        name: 'APA 7th Edition',
        inTextFormatTemplate: '(Author, Year)',
        bibliographyRules: {},
        bibliographySortOrder: 'alphabetical',
        isActive: true,
        maxAuthorsBeforeEtAl: 3
      };

      (prisma.citationStyleDefinition.findUnique as any)
        .mockResolvedValueOnce(mockStyle)
        .mockResolvedValueOnce(null); // Should not be called due to cache

      // First call should hit database
      const result1 = await service.formatInTextCitation(mockCitation, 'APA7');
      expect(result1).toBe('(Smith et al., 2023)');

      // Second call should use cache
      const result2 = await service.formatInTextCitation(mockCitation, 'APA7');
      expect(result2).toBe('(Smith et al., 2023)');

      // Should only call database once
      expect(prisma.citationStyleDefinition.findUnique).toHaveBeenCalledTimes(1);
    });

    it('should invalidate cache when requested', () => {
      // Add some items to cache
      (service as any).styleCache.set('TEST', { code: 'TEST' });
      (service as any).cacheTimestamp = Date.now();

      // Invalidate cache
      service.invalidateCache();

      // Check that cache is cleared
      expect((service as any).styleCache.size).toBe(0);
      expect((service as any).cacheTimestamp).toBe(0);
    });
  });
});
