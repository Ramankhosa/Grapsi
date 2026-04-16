/**
 * Citation Style Service
 * Handles citation formatting and bibliography generation for academic writing
 */

import { prisma } from '../prisma';
import type { CitationStyleDefinition, CitationSourceType } from '@prisma/client';

export interface CitationData {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url?: string;
  isbn?: string;
  publisher?: string;
  edition?: string;
  sourceType?: CitationSourceType | string;
  editors?: string[];
  publicationPlace?: string;
  publicationDate?: string;
  accessedDate?: string;
  articleNumber?: string;
  issn?: string;
  journalAbbreviation?: string;
  pmid?: string;
  pmcid?: string;
  arxivId?: string;
  citationKey: string;
}

export interface FormattingOptions {
  maxAuthors?: number; // Override default max authors before et al.
  includeDOI?: boolean; // Force include/exclude DOI
  shortForm?: boolean; // Use short form if supported by style
  citationNumber?: number; // Explicit numeric index for numbered citation styles (IEEE/Vancouver)
  citationNumbering?: Record<string, number>; // Optional numbering map keyed by citationKey
}

export interface BibliographyOptions {
  sortOrder?: 'alphabetical' | 'order_of_appearance';
  includeDOIs?: boolean;
  maxAuthors?: number;
}

export interface BibTeXEntry {
  type: string; // article, inproceedings, book, etc.
  key: string;  // citation key
  fields: Record<string, string>;
}

type SourceCategory =
  | 'journal'
  | 'conference'
  | 'book'
  | 'book_chapter'
  | 'website'
  | 'thesis'
  | 'report'
  | 'other';

class CitationStyleService {
  private styleCache: Map<string, CitationStyleDefinition> = new Map();
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private readonly STYLE_ALIASES: Record<string, string> = {
    APA: 'APA7',
    APA7: 'APA7',
    IEEE: 'IEEE',
    CHICAGO: 'CHICAGO',
    CHICAGO_AUTHOR_DATE: 'CHICAGO',
    MLA: 'MLA9',
    MLA9: 'MLA9',
    HARVARD: 'HARVARD',
    VANCOUVER: 'VANCOUVER'
  };
  private readonly NUMERIC_STYLES = new Set(['IEEE', 'VANCOUVER']);

  /**
   * Get citation style by code with caching
   */
  async getCitationStyle(code: string): Promise<CitationStyleDefinition | null> {
    const requestedCode = String(code || '').trim().toUpperCase();
    const normalizedCode = this.normalizeStyleCode(requestedCode);
    const now = Date.now();

    const cached = this.styleCache.get(normalizedCode) || this.styleCache.get(requestedCode);
    if (cached && (now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
      return cached;
    }

    let style = await prisma.citationStyleDefinition.findUnique({
      where: { code: normalizedCode }
    });

    if (!style && normalizedCode !== requestedCode) {
      style = await prisma.citationStyleDefinition.findUnique({
        where: { code: requestedCode }
      });
    }

    if (!style || !style.isActive) {
      return null;
    }

    this.styleCache.set(normalizedCode, style);
    this.styleCache.set(requestedCode, style);
    this.styleCache.set(style.code.toUpperCase(), style);
    this.cacheTimestamp = now;

    return style;
  }

  /**
   * Format in-text citation
   */
  async formatInTextCitation(
    citation: CitationData,
    styleCode: string,
    options: FormattingOptions = {}
  ): Promise<string> {
    const style = await this.getCitationStyle(styleCode);
    if (!style) {
      throw new Error(`Citation style not found: ${styleCode}`);
    }

    const template = style.inTextFormatTemplate;
    const normalizedStyleCode = this.normalizeStyleCode(style.code || styleCode);

    switch (normalizedStyleCode) {
      case 'APA7':
        return this.formatAPA7InText(citation, options);
      case 'IEEE':
        return this.formatNumericInText(citation, options, '[', ']');
      case 'VANCOUVER':
        return this.formatNumericInText(citation, options, '(', ')');
      case 'CHICAGO':
        return this.formatChicagoAuthorDateInText(citation, options);
      case 'MLA9':
        return this.formatMLA9InText(citation, options);
      case 'HARVARD':
        return this.formatHarvardInText(citation, options);
      default:
        return this.formatGenericInText(citation, template, options);
    }
  }

  /**
   * Format bibliography entry
   */
  async formatBibliographyEntry(
    citation: CitationData,
    styleCode: string,
    options: FormattingOptions = {}
  ): Promise<string> {
    const style = await this.getCitationStyle(styleCode);
    if (!style) {
      throw new Error(`Citation style not found: ${styleCode}`);
    }

    const normalizedStyleCode = this.normalizeStyleCode(style.code || styleCode);
    const sourceCategory = this.resolveSourceCategory(citation);

    switch (normalizedStyleCode) {
      case 'APA7':
        return this.formatAPA7Bibliography(citation, sourceCategory, options);
      case 'IEEE':
        return this.formatIEEEBibliography(citation, sourceCategory, options);
      case 'CHICAGO':
        return this.formatChicagoAuthorDateBibliography(citation, sourceCategory, options);
      case 'MLA9':
        return this.formatMLA9Bibliography(citation, sourceCategory, options);
      case 'HARVARD':
        return this.formatHarvardBibliography(citation, sourceCategory, options);
      case 'VANCOUVER':
        return this.formatVancouverBibliography(citation, sourceCategory, options);
      default:
        return this.formatGenericBibliography(citation, style, options);
    }
  }

  /**
   * Generate complete bibliography
   */
  async generateBibliography(
    citations: CitationData[],
    styleCode: string,
    options: BibliographyOptions = {}
  ): Promise<string> {
    const style = await this.getCitationStyle(styleCode);
    if (!style) {
      throw new Error(`Citation style not found: ${styleCode}`);
    }

    if (citations.length === 0) {
      return '';
    }

    const normalizedStyleCode = this.normalizeStyleCode(style.code || styleCode);
    let sortOrder = options.sortOrder || style.bibliographySortOrder as 'alphabetical' | 'order_of_appearance';
    if (this.NUMERIC_STYLES.has(normalizedStyleCode)) {
      sortOrder = 'order_of_appearance';
    }
    const sortedCitations = this.sortCitations(citations, sortOrder);

    // Format each entry
    const entries = await Promise.all(
      sortedCitations.map(async (citation, index) => {
        const formatted = await this.formatBibliographyEntry(citation, styleCode, {
          maxAuthors: options.maxAuthors
        });

        if (sortOrder === 'order_of_appearance') {
          if (normalizedStyleCode === 'VANCOUVER') {
            return `${index + 1}. ${formatted}`;
          }
          return `[${index + 1}] ${formatted}`;
        }

        return formatted;
      })
    );

    return entries.join('\n\n');
  }

  /**
   * Generate unique citation key
   */
  generateCitationKey(citation: CitationData, existingKeys: string[] = []): string {
    if (!citation.authors || citation.authors.length === 0) {
      // Use title-based key if no authors
      const titleWords = citation.title.split(/\s+/).slice(0, 2);
      const baseKey = titleWords.join('').replace(/[^a-zA-Z0-9]/g, '').substring(0, 6);
      return this.ensureUniqueKey(`${baseKey}${citation.year || 'NoYear'}`, existingKeys);
    }

    // Use first author's last name
    const firstAuthor = citation.authors[0];
    const lastName = this.extractLastName(firstAuthor);

    // Add year
    let baseKey = `${lastName}${citation.year || 'NoYear'}`;

    // Ensure uniqueness
    return this.ensureUniqueKey(baseKey, existingKeys);
  }

  /**
   * Parse BibTeX string into citation objects
   */
  parseBibTeX(bibtexString: string): CitationData[] {
    const entries: CitationData[] = [];
    const entryRegex = /@(\w+)\{([^,]+),\s*([^@]+)\}/g;

    let match;
    while ((match = entryRegex.exec(bibtexString)) !== null) {
      const [, type, key, fields] = match;

      // Parse fields
      const fieldRegex = /(\w[\w-]*)\s*=\s*["{]([^"}]+)["}]/g;
      const fieldMap: Record<string, string> = {};
      let fieldMatch;

      while ((fieldMatch = fieldRegex.exec(fields)) !== null) {
        const [, fieldName, fieldValue] = fieldMatch;
        fieldMap[fieldName.toLowerCase()] = fieldValue;
      }

      // Convert to CitationData format
      const citation: CitationData = {
        id: `bibtex_${key}_${Date.now()}`,
        title: fieldMap.title || '',
        authors: this.parseBibTeXAuthors(fieldMap.author || ''),
        year: fieldMap.year ? parseInt(fieldMap.year) : undefined,
        venue: fieldMap.journal || fieldMap.booktitle || fieldMap.publisher,
        volume: fieldMap.volume,
        issue: fieldMap.number,
        pages: fieldMap.pages,
        doi: fieldMap.doi,
        url: fieldMap.url,
        isbn: fieldMap.isbn,
        publisher: fieldMap.publisher,
        edition: fieldMap.edition,
        sourceType: this.mapBibTeXSourceType(type),
        editors: this.parseBibTeXAuthors(fieldMap.editor || ''),
        publicationPlace: fieldMap.address || fieldMap.location,
        publicationDate: this.buildPublicationDateFromParts(fieldMap.year, fieldMap.month, fieldMap.day),
        articleNumber: fieldMap['article-number'] || fieldMap.articlenumber,
        issn: fieldMap.issn,
        journalAbbreviation: fieldMap.shortjournal || fieldMap.journalabbr,
        pmid: fieldMap.pmid,
        pmcid: fieldMap.pmcid || fieldMap.pmc,
        arxivId: fieldMap.eprint || fieldMap.arxivid,
        citationKey: key
      };

      entries.push(citation);
    }

    return entries;
  }

  /**
   * Export citations to BibTeX format
   */
  async exportToBibTeX(citations: CitationData[]): Promise<string> {
    const bibtexEntries: string[] = [];

    for (const citation of citations) {
      const entryType = this.inferBibTeXType(citation);
      const fields: string[] = [];

      // Add required fields
      fields.push(`title={${citation.title}}`);

      if (citation.authors && citation.authors.length > 0) {
        fields.push(`author={${citation.authors.join(' and ')}}`);
      }

      if (citation.year) {
        fields.push(`year={${citation.year}}`);
      }

      // Add optional fields
      if (citation.venue) {
        const fieldName = entryType === 'article' ? 'journal' :
                         entryType === 'inproceedings' ? 'booktitle' : 'publisher';
        fields.push(`${fieldName}={${citation.venue}}`);
      }

      if (citation.volume) fields.push(`volume={${citation.volume}}`);
      if (citation.issue) fields.push(`number={${citation.issue}}`);
      if (citation.pages) fields.push(`pages={${citation.pages}}`);
      if (citation.doi) fields.push(`doi={${citation.doi}}`);
      if (citation.url) fields.push(`url={${citation.url}}`);
      if (citation.isbn) fields.push(`isbn={${citation.isbn}}`);
      if (citation.issn) fields.push(`issn={${citation.issn}}`);
      if (citation.publisher && entryType === 'book') fields.push(`publisher={${citation.publisher}}`);
      if (citation.edition) fields.push(`edition={${citation.edition}}`);
      if (citation.editors && citation.editors.length > 0) fields.push(`editor={${citation.editors.join(' and ')}}`);
      if (citation.publicationPlace) fields.push(`address={${citation.publicationPlace}}`);
      if (citation.articleNumber) fields.push(`article-number={${citation.articleNumber}}`);
      if (citation.pmid) fields.push(`pmid={${citation.pmid}}`);
      if (citation.pmcid) fields.push(`pmcid={${citation.pmcid}}`);
      if (citation.arxivId) {
        fields.push(`eprint={${citation.arxivId}}`);
        fields.push(`archivePrefix={arXiv}`);
      }

      bibtexEntries.push(`@${entryType}{${citation.citationKey},\n  ${fields.join(',\n  ')}\n}`);
    }

    return bibtexEntries.join('\n\n');
  }

  // ============================================================================
  // PRIVATE FORMATTING METHODS
  // ============================================================================

  private formatAPA7InText(citation: CitationData, options: FormattingOptions): string {
    const year = this.resolveYearText(citation, 'n.d.');
    if (!citation.authors || citation.authors.length === 0) {
      return `(Anonymous, ${year})`;
    }

    const maxAuthors = options.maxAuthors || 3;
    const authors = citation.authors.slice(0, maxAuthors);
    const authorText = authors.length === 1
      ? this.extractLastName(authors[0])
      : authors.length === 2
        ? `${this.extractLastName(authors[0])} & ${this.extractLastName(authors[1])}`
        : `${this.extractLastName(authors[0])} et al.`;

    return `(${authorText}, ${year})`;
  }

  private formatNumericInText(citation: CitationData, options: FormattingOptions, open: string, close: string): string {
    const explicit = Number(options?.citationNumber);
    if (Number.isFinite(explicit) && explicit > 0) {
      return `${open}${Math.trunc(explicit)}${close}`;
    }

    const fromMap = Number(options?.citationNumbering?.[citation.citationKey]);
    if (Number.isFinite(fromMap) && fromMap > 0) {
      return `${open}${Math.trunc(fromMap)}${close}`;
    }

    return `${open}1${close}`;
  }

  private formatChicagoAuthorDateInText(citation: CitationData, options: FormattingOptions): string {
    const year = this.resolveYearText(citation, 'n.d.');
    if (!citation.authors || citation.authors.length === 0) {
      return `(Anonymous ${year})`;
    }

    const lastName = this.extractLastName(citation.authors[0]);
    return `(${lastName} ${year})`;
  }

  private formatHarvardInText(citation: CitationData, options: FormattingOptions): string {
    const year = this.resolveYearText(citation, 'n.d.');
    if (!citation.authors || citation.authors.length === 0) {
      return `(Anonymous ${year})`;
    }
    if (citation.authors.length === 1) {
      return `(${this.extractLastName(citation.authors[0])} ${year})`;
    }
    if (citation.authors.length === 2) {
      return `(${this.extractLastName(citation.authors[0])} and ${this.extractLastName(citation.authors[1])} ${year})`;
    }
    return `(${this.extractLastName(citation.authors[0])} et al. ${year})`;
  }

  private formatMLA9InText(citation: CitationData, options: FormattingOptions): string {
    const locator = this.firstLocator(citation.pages) || this.resolveYearText(citation, '');
    if (!citation.authors || citation.authors.length === 0) {
      return locator ? `("Anonymous" ${locator})` : `("Anonymous")`;
    }

    const lastName = this.extractLastName(citation.authors[0]);
    return locator ? `(${lastName} ${locator})` : `(${lastName})`;
  }

  private formatGenericInText(citation: CitationData, template: string, options: FormattingOptions): string {
    return template
      .replace('{authors}', citation.authors?.[0] || 'Anonymous')
      .replace('{year}', this.resolveYearText(citation, 'n.d.'));
  }

  private formatAPA7Bibliography(citation: CitationData, sourceCategory: SourceCategory, options: FormattingOptions): string {
    const authors = this.formatAuthorsAPA7(citation.authors || []);
    const year = this.resolveYearText(citation, 'n.d.');
    if (sourceCategory === 'website') {
      let entry = `${authors} (${citation.publicationDate || year}). ${citation.title}.`;
      if (citation.venue) entry += ` ${citation.venue}.`;
      if (citation.url) {
        entry += citation.accessedDate
          ? ` Retrieved ${citation.accessedDate}, from ${citation.url}`
          : ` ${citation.url}`;
      }
      return this.cleanupBibliographyText(entry);
    }

    if (sourceCategory === 'book') {
      let entry = `${authors} (${year}). ${citation.title}.`;
      if (citation.edition) entry += ` (${citation.edition})`;
      if (citation.publisher) entry += ` ${citation.publisher}.`;
      return this.cleanupBibliographyText(entry);
    }

    if (sourceCategory === 'book_chapter') {
      let entry = `${authors} (${year}). ${citation.title}.`;
      if (citation.venue) {
        entry += ` In ${citation.venue}`;
        if (citation.pages) entry += ` (pp. ${citation.pages})`;
        entry += '.';
      }
      if (citation.publisher) entry += ` ${citation.publisher}.`;
      return this.cleanupBibliographyText(entry);
    }

    if (sourceCategory === 'conference') {
      let entry = `${authors} (${year}). ${citation.title}.`;
      if (citation.venue) {
        entry += ` In ${citation.venue}`;
        if (citation.pages) entry += ` (pp. ${citation.pages})`;
        entry += '.';
      }
      if (citation.doi && options.includeDOI !== false) entry += ` https://doi.org/${this.normalizeDoiForDisplay(citation.doi)}`;
      else if (citation.url) entry += ` ${citation.url}`;
      return this.cleanupBibliographyText(entry);
    }

    let entry = `${authors} (${year}). ${citation.title}.`;
    if (citation.venue) entry += ` ${citation.venue}`;
    if (citation.volume) entry += `, ${citation.volume}`;
    if (citation.issue) entry += `(${citation.issue})`;
    if (citation.pages) entry += `, ${citation.pages}`;
    if (citation.doi && options.includeDOI !== false) entry += `. https://doi.org/${this.normalizeDoiForDisplay(citation.doi)}`;
    else if (citation.url) entry += `. ${citation.url}`;
    return this.cleanupBibliographyText(entry);
  }

  private formatIEEEBibliography(citation: CitationData, sourceCategory: SourceCategory, options: FormattingOptions): string {
    const authors = citation.authors?.map(author => this.formatAuthorIEEE(author)).join(', ') || 'Anonymous';
    const year = this.resolveYearText(citation, 'n.d.');
    const venue = citation.journalAbbreviation || citation.venue;

    if (sourceCategory === 'book') {
      let entry = `${authors}, ${citation.title},`;
      if (citation.edition) entry += ` ${citation.edition},`;
      const placePublisher = this.joinNonEmpty([citation.publicationPlace, citation.publisher], ': ');
      if (placePublisher) entry += ` ${placePublisher},`;
      entry += ` ${year}.`;
      return this.cleanupBibliographyText(entry);
    }

    if (sourceCategory === 'book_chapter') {
      let entry = `${authors}, "${citation.title},"`;
      if (citation.venue) entry += ` in ${citation.venue},`;
      const editors = citation.editors?.map(editor => this.formatAuthorIEEE(editor)).join(', ');
      if (editors) entry += ` ${editors}, ${citation.editors!.length > 1 ? 'Eds.' : 'Ed.'},`;
      const placePublisher = this.joinNonEmpty([citation.publicationPlace, citation.publisher], ': ');
      if (placePublisher) entry += ` ${placePublisher},`;
      entry += ` ${year}`;
      if (citation.pages) entry += `, pp. ${citation.pages}`;
      entry += '.';
      return this.cleanupBibliographyText(entry);
    }

    if (sourceCategory === 'conference') {
      let entry = `${authors}, "${citation.title},"`;
      if (citation.venue) entry += ` in ${citation.venue},`;
      if (citation.publicationPlace) entry += ` ${citation.publicationPlace},`;
      entry += ` ${citation.publicationDate || year}`;
      if (citation.pages) entry += `, pp. ${citation.pages}`;
      if (citation.doi && options.includeDOI !== false) entry += `, doi: ${this.normalizeDoiForDisplay(citation.doi)}`;
      entry += '.';
      return this.cleanupBibliographyText(entry);
    }

    if (sourceCategory === 'website') {
      let entry = `${authors}, "${citation.title},"`;
      if (citation.venue) entry += ` ${citation.venue},`;
      if (citation.publicationDate) entry += ` ${citation.publicationDate}.`;
      if (citation.url) entry += ` [Online]. Available: ${citation.url}.`;
      if (citation.accessedDate) entry += ` Accessed: ${citation.accessedDate}.`;
      return this.cleanupBibliographyText(entry);
    }

    let entry = `${authors}, "${citation.title},"`;
    if (venue) entry += ` ${venue},`;
    if (citation.volume) entry += ` vol. ${citation.volume},`;
    if (citation.issue) entry += ` no. ${citation.issue},`;
    if (citation.pages) entry += ` pp. ${citation.pages},`;
    else if (citation.articleNumber) entry += ` Art. no. ${citation.articleNumber},`;
    entry += ` ${citation.publicationDate || year}`;
    if (citation.doi && options.includeDOI !== false) entry += `, doi: ${this.normalizeDoiForDisplay(citation.doi)}`;
    if (citation.arxivId) entry += `, arXiv: ${citation.arxivId}`;
    if (citation.pmid) entry += `, PMID: ${citation.pmid}`;
    if (citation.pmcid) entry += `, PMCID: ${citation.pmcid}`;
    entry += '.';
    return this.cleanupBibliographyText(entry);
  }

  private formatChicagoAuthorDateBibliography(citation: CitationData, sourceCategory: SourceCategory, options: FormattingOptions): string {
    const authors = this.formatAuthorsChicago(citation.authors || []);
    const year = this.resolveYearText(citation, 'n.d.');

    if (sourceCategory === 'book') {
      let entry = `${authors} ${year}. "${citation.title}."`;
      const placePublisher = this.joinNonEmpty([citation.publicationPlace, citation.publisher], ': ');
      if (placePublisher) entry += ` ${placePublisher}.`;
      return this.cleanupBibliographyText(entry);
    }

    if (sourceCategory === 'book_chapter') {
      let entry = `${authors} ${year}. "${citation.title}."`;
      if (citation.venue) entry += ` In ${citation.venue}`;
      if (citation.editors && citation.editors.length > 0) {
        entry += `, edited by ${citation.editors.join(', ')}`;
      }
      if (citation.pages) entry += `, ${citation.pages}`;
      entry += '.';
      const placePublisher = this.joinNonEmpty([citation.publicationPlace, citation.publisher], ': ');
      if (placePublisher) entry += ` ${placePublisher}.`;
      return this.cleanupBibliographyText(entry);
    }

    if (sourceCategory === 'website') {
      let entry = `${authors} ${year}. "${citation.title}."`;
      if (citation.venue) entry += ` ${citation.venue}.`;
      if (citation.publicationDate) entry += ` ${citation.publicationDate}.`;
      if (citation.url) entry += ` ${citation.url}`;
      if (citation.accessedDate) entry += ` (accessed ${citation.accessedDate})`;
      entry += '.';
      return this.cleanupBibliographyText(entry);
    }

    let entry = `${authors} ${year}. "${citation.title}."`;
    if (citation.venue) entry += ` ${citation.venue}`;
    if (citation.volume) entry += ` ${citation.volume}`;
    if (citation.issue) entry += `, no. ${citation.issue}`;
    if (citation.pages) entry += `: ${citation.pages}`;
    else if (citation.articleNumber) entry += `: ${citation.articleNumber}`;
    entry += '.';
    if (citation.doi && options.includeDOI !== false) entry += ` https://doi.org/${this.normalizeDoiForDisplay(citation.doi)}`;
    else if (citation.url) entry += ` ${citation.url}`;
    return this.cleanupBibliographyText(entry);
  }

  private formatMLA9Bibliography(citation: CitationData, sourceCategory: SourceCategory, options: FormattingOptions): string {
    const authors = this.formatAuthorsMLA9(citation.authors || []);
    const year = this.resolveYearText(citation, 'n.d.');

    if (sourceCategory === 'book') {
      let entry = `${authors}. "${citation.title}."`;
      if (citation.edition) entry += ` ${citation.edition},`;
      if (citation.publisher) entry += ` ${citation.publisher},`;
      entry += ` ${year}.`;
      return this.cleanupBibliographyText(entry);
    }

    if (sourceCategory === 'book_chapter') {
      let entry = `${authors}. "${citation.title}."`;
      if (citation.venue) entry += ` ${citation.venue},`;
      if (citation.editors && citation.editors.length > 0) entry += ` edited by ${citation.editors.join(', ')},`;
      if (citation.publisher) entry += ` ${citation.publisher},`;
      entry += ` ${year}`;
      if (citation.pages) entry += `, pp. ${citation.pages}`;
      entry += '.';
      return this.cleanupBibliographyText(entry);
    }

    if (sourceCategory === 'website') {
      let entry = `${authors}. "${citation.title}."`;
      if (citation.venue) entry += ` ${citation.venue},`;
      if (citation.publicationDate) entry += ` ${citation.publicationDate},`;
      if (citation.url) entry += ` ${citation.url}.`;
      if (citation.accessedDate) entry += ` Accessed ${citation.accessedDate}.`;
      return this.cleanupBibliographyText(entry);
    }

    let entry = `${authors}. "${citation.title}."`;
    if (citation.venue) entry += ` ${citation.venue},`;
    if (citation.volume) entry += ` vol. ${citation.volume},`;
    if (citation.issue) entry += ` no. ${citation.issue},`;
    entry += ` ${year}`;
    if (citation.pages) entry += `, pp. ${citation.pages}`;
    entry += '.';
    if (citation.doi && options.includeDOI !== false) entry += ` https://doi.org/${this.normalizeDoiForDisplay(citation.doi)}`;
    else if (citation.url) entry += ` ${citation.url}`;
    return this.cleanupBibliographyText(entry);
  }

  private formatHarvardBibliography(citation: CitationData, sourceCategory: SourceCategory, options: FormattingOptions): string {
    const authors = this.formatAuthorsHarvard(citation.authors || []);
    const year = this.resolveYearText(citation, 'n.d.');

    if (sourceCategory === 'website') {
      let entry = `${authors} (${year}) ${citation.title}.`;
      if (citation.url) {
        entry += ` Available at: ${citation.url}`;
        if (citation.accessedDate) entry += ` (Accessed: ${citation.accessedDate})`;
        entry += '.';
      }
      return this.cleanupBibliographyText(entry);
    }

    if (sourceCategory === 'book') {
      let entry = `${authors} (${year}) ${citation.title}.`;
      if (citation.edition) entry += ` ${citation.edition}.`;
      const placePublisher = this.joinNonEmpty([citation.publicationPlace, citation.publisher], ': ');
      if (placePublisher) entry += ` ${placePublisher}.`;
      return this.cleanupBibliographyText(entry);
    }

    let entry = `${authors} (${year}) '${citation.title}',`;
    if (citation.venue) entry += ` ${citation.venue}`;
    if (citation.volume) {
      entry += `, ${citation.volume}`;
      if (citation.issue) entry += `(${citation.issue})`;
    } else if (citation.issue) {
      entry += `, (${citation.issue})`;
    }
    if (citation.pages) entry += `, pp. ${citation.pages}`;
    entry += '.';
    if (citation.doi && options.includeDOI !== false) entry += ` doi: ${this.normalizeDoiForDisplay(citation.doi)}.`;
    else if (citation.url) entry += ` Available at: ${citation.url}.`;
    return this.cleanupBibliographyText(entry);
  }

  private formatVancouverBibliography(citation: CitationData, sourceCategory: SourceCategory, options: FormattingOptions): string {
    const authors = this.formatAuthorsVancouver(citation.authors || [], options.maxAuthors);
    const year = this.resolveYearText(citation, 'n.d.');

    if (sourceCategory === 'website') {
      let entry = `${authors}. ${citation.title} [Internet].`;
      const placePublisher = this.joinNonEmpty([citation.publicationPlace, citation.publisher], ': ');
      if (placePublisher) entry += ` ${placePublisher};`;
      entry += ` ${citation.publicationDate || year}`;
      if (citation.accessedDate) entry += ` [cited ${citation.accessedDate}]`;
      entry += '.';
      if (citation.url) entry += ` Available from: ${citation.url}.`;
      return this.cleanupBibliographyText(entry);
    }

    if (sourceCategory === 'book') {
      let entry = `${authors}. ${citation.title}.`;
      if (citation.edition) entry += ` ${citation.edition}.`;
      const placePublisher = this.joinNonEmpty([citation.publicationPlace, citation.publisher], ': ');
      if (placePublisher) entry += ` ${placePublisher};`;
      entry += ` ${year}.`;
      return this.cleanupBibliographyText(entry);
    }

    const venue = citation.journalAbbreviation || citation.venue;
    let entry = `${authors}. ${citation.title}.`;
    if (venue) entry += ` ${venue}.`;
    entry += ` ${year}`;
    if (citation.volume) {
      entry += `;${citation.volume}`;
      if (citation.issue) entry += `(${citation.issue})`;
    }
    if (citation.pages) entry += `:${citation.pages}`;
    else if (citation.articleNumber) entry += `:${citation.articleNumber}`;
    entry += '.';
    if (citation.doi && options.includeDOI !== false) entry += ` doi: ${this.normalizeDoiForDisplay(citation.doi)}.`;
    if (citation.pmid) entry += ` PMID: ${citation.pmid}.`;
    if (citation.pmcid) entry += ` PMCID: ${citation.pmcid}.`;
    if (citation.arxivId) entry += ` arXiv: ${citation.arxivId}.`;
    return this.cleanupBibliographyText(entry);
  }

  private formatGenericBibliography(citation: CitationData, style: CitationStyleDefinition, options: FormattingOptions): string {
    const authors = citation.authors?.join(', ') || 'Anonymous';
    const year = this.resolveYearText(citation, 'n.d.');
    return this.cleanupBibliographyText(`${authors} (${year}). ${citation.title}. ${citation.venue || ''}`);
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private formatAuthorsAPA7(authors: string[]): string {
    if (authors.length === 0) return 'Anonymous';

    const maxAuthors = 20; // APA allows up to 20 authors before et al.
    const displayAuthors = authors.slice(0, maxAuthors);

    if (displayAuthors.length === 1) {
      return this.formatAuthorAPA7(displayAuthors[0]);
    }

    const formattedAuthors = displayAuthors.map(author => this.formatAuthorAPA7(author));
    const lastAuthor = formattedAuthors.pop();

    if (displayAuthors.length < maxAuthors) {
      return formattedAuthors.join(', ') + ', & ' + lastAuthor;
    } else {
      return formattedAuthors.join(', ') + ', ... ' + lastAuthor;
    }
  }

  private formatAuthorAPA7(author: string): string {
    // APA: Last, F. M.
    const parts = author.split(' ');
    if (parts.length === 1) return author;
    const lastName = parts[parts.length - 1];
    const firstInitials = parts.slice(0, -1).map(name => name.charAt(0) + '.').join(' ');
    return `${lastName}, ${firstInitials}`;
  }

  private formatAuthorIEEE(author: string): string {
    const normalized = author.trim();
    if (!normalized) return author;

    if (normalized.includes(',')) {
      const [last, ...firstParts] = normalized.split(',');
      const initials = firstParts.join(' ').trim().split(/\s+/).filter(Boolean).map(name => `${name.charAt(0)}.`).join(' ');
      return initials ? `${initials} ${last.trim()}` : last.trim();
    }

    const parts = normalized.split(/\s+/);
    if (parts.length === 1) return normalized;
    const lastName = parts[parts.length - 1];
    const firstInitials = parts.slice(0, -1).map(name => `${name.charAt(0)}.`).join(' ');
    return `${firstInitials} ${lastName}`.trim();
  }

  private formatAuthorsChicago(authors: string[]): string {
    if (authors.length === 0) return 'Anonymous';

    if (authors.length === 1) {
      return this.formatAuthorChicago(authors[0]);
    }

    if (authors.length === 2) {
      return `${this.formatAuthorChicago(authors[0])} and ${this.formatAuthorChicago(authors[1])}`;
    }

    // More than 2 authors
    const formattedAuthors = authors.slice(0, -1).map(author => this.formatAuthorChicago(author));
    const lastAuthor = this.formatAuthorChicago(authors[authors.length - 1]);
    return formattedAuthors.join(', ') + ', and ' + lastAuthor;
  }

  private formatAuthorChicago(author: string): string {
    return author.trim();
  }

  private formatAuthorsMLA9(authors: string[]): string {
    if (authors.length === 0) return 'Anonymous';

    if (authors.length === 1) {
      return this.extractLastName(authors[0]);
    }

    if (authors.length === 2) {
      return `${this.extractLastName(authors[0])} and ${this.extractLastName(authors[1])}`;
    }

    // More than 2 authors
    return `${this.extractLastName(authors[0])} et al.`;
  }

  private formatAuthorsHarvard(authors: string[]): string {
    if (authors.length === 0) return 'Anonymous';

    const normalized = authors.map(author => {
      const value = author.trim();
      if (!value) return value;
      if (value.includes(',')) {
        const [last, ...givenParts] = value.split(',');
        const initials = givenParts.join(' ').trim().split(/\s+/).filter(Boolean).map(name => `${name.charAt(0)}.`).join('');
        return initials ? `${last.trim()}, ${initials}` : last.trim();
      }
      const parts = value.split(/\s+/);
      if (parts.length === 1) return parts[0];
      const last = parts[parts.length - 1];
      const initials = parts.slice(0, -1).map(name => `${name.charAt(0)}.`).join('');
      return `${last}, ${initials}`;
    }).filter(Boolean);

    if (normalized.length === 1) return normalized[0];
    if (normalized.length === 2) return `${normalized[0]} and ${normalized[1]}`;
    return `${normalized.slice(0, -1).join(', ')}, and ${normalized[normalized.length - 1]}`;
  }

  private formatAuthorsVancouver(authors: string[], maxAuthors?: number): string {
    if (authors.length === 0) return 'Anonymous';

    const limit = Number.isFinite(Number(maxAuthors))
      ? Math.max(1, Math.trunc(Number(maxAuthors)))
      : 6;

    const mapped = authors.map(author => {
      const value = author.trim();
      if (!value) return value;
      if (value.includes(',')) {
        const [last, ...givenParts] = value.split(',');
        const initials = givenParts.join(' ').trim().split(/\s+/).filter(Boolean).map(name => name.charAt(0).toUpperCase()).join('');
        return `${last.trim()} ${initials}`.trim();
      }
      const parts = value.split(/\s+/);
      if (parts.length === 1) return parts[0];
      const last = parts[parts.length - 1];
      const initials = parts.slice(0, -1).map(name => name.charAt(0).toUpperCase()).join('');
      return `${last} ${initials}`.trim();
    }).filter(Boolean);

    if (mapped.length > limit) {
      return `${mapped.slice(0, limit).join(', ')}, et al`;
    }
    return mapped.join(', ');
  }

  private extractLastName(author: string): string {
    const normalized = author.trim();
    if (!normalized) return author;
    if (normalized.includes(',')) {
      return normalized.split(',')[0].trim();
    }
    const parts = normalized.split(/\s+/);
    return parts[parts.length - 1] || normalized;
  }

  private resolveSourceCategory(citation: CitationData): SourceCategory {
    const sourceType = String(citation.sourceType || '').toUpperCase();
    if (sourceType === 'JOURNAL_ARTICLE') return 'journal';
    if (sourceType === 'CONFERENCE_PAPER') return 'conference';
    if (sourceType === 'BOOK') return 'book';
    if (sourceType === 'BOOK_CHAPTER') return 'book_chapter';
    if (sourceType === 'WEBSITE') return 'website';
    if (sourceType === 'THESIS') return 'thesis';
    if (sourceType === 'REPORT' || sourceType === 'WORKING_PAPER') return 'report';

    const venue = String(citation.venue || '').toLowerCase();
    if (venue.includes('conference') || venue.includes('proceedings') || venue.includes('symposium')) {
      return 'conference';
    }
    if (citation.isbn || citation.publisher || citation.edition) {
      return 'book';
    }
    if (citation.url && !citation.volume && !citation.issue && !citation.pages && !citation.doi) {
      return 'website';
    }
    if (citation.volume || citation.issue || citation.pages || citation.articleNumber || citation.doi) {
      return 'journal';
    }
    return 'other';
  }

  private resolveYear(citation: CitationData): number | undefined {
    if (Number.isFinite(Number(citation.year))) {
      return Math.trunc(Number(citation.year));
    }
    const publicationDate = String(citation.publicationDate || '');
    const match = publicationDate.match(/\b(\d{4})\b/);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return undefined;
  }

  private resolveYearText(citation: CitationData, fallback: string): string {
    const resolvedYear = this.resolveYear(citation);
    return resolvedYear ? String(resolvedYear) : fallback;
  }

  private firstLocator(pages?: string): string | undefined {
    if (!pages) return undefined;
    const normalized = pages.trim();
    if (!normalized) return undefined;
    const [first] = normalized.split(/[-,;]/);
    return (first || normalized).trim();
  }

  private normalizeDoiForDisplay(doi: string): string {
    return String(doi || '')
      .trim()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
      .replace(/^doi:/i, '');
  }

  private joinNonEmpty(parts: Array<string | undefined>, separator: string): string {
    return parts.filter((part): part is string => Boolean(part && part.trim())).join(separator);
  }

  private cleanupBibliographyText(value: string): string {
    return value
      .replace(/\s+/g, ' ')
      .replace(/\s+,/g, ',')
      .replace(/\s+\./g, '.')
      .replace(/\s+;/g, ';')
      .replace(/\s+:/g, ':')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      .trim();
  }

  private normalizeStyleCode(code: string): string {
    const normalized = String(code || '').trim().toUpperCase();
    return this.STYLE_ALIASES[normalized] || normalized;
  }

  private sortCitations(citations: CitationData[], sortOrder: 'alphabetical' | 'order_of_appearance'): CitationData[] {
    if (sortOrder === 'alphabetical') {
      return [...citations].sort((a, b) => {
        const authorA = this.extractLastName(a.authors?.[0] || 'Anonymous');
        const authorB = this.extractLastName(b.authors?.[0] || 'Anonymous');
        return authorA.localeCompare(authorB);
      });
    }

    // order_of_appearance - maintain current order
    return citations;
  }

  private ensureUniqueKey(baseKey: string, existingKeys: string[]): string {
    let key = baseKey;
    let counter = 1;

    while (existingKeys.includes(key)) {
      key = `${baseKey}${String.fromCharCode(96 + counter)}`; // a, b, c, etc.
      counter++;
      if (counter > 26) {
        // If we exhaust letters, add numbers
        key = `${baseKey}${counter - 26}`;
      }
    }

    return key;
  }

  private parseBibTeXAuthors(authorString: string): string[] {
    // Simple BibTeX author parsing - "Last, First and Last2, First2"
    return authorString.split(/\s+and\s+/).map(author => author.trim());
  }

  private buildPublicationDateFromParts(year?: string, month?: string, day?: string): string | undefined {
    const yearNumber = Number(year);
    if (!Number.isFinite(yearNumber)) {
      return undefined;
    }

    const monthNumber = Number(month);
    const dayNumber = Number(day);
    if (Number.isFinite(monthNumber) && monthNumber >= 1 && monthNumber <= 12) {
      if (Number.isFinite(dayNumber) && dayNumber >= 1 && dayNumber <= 31) {
        return `${yearNumber}-${String(monthNumber).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
      }
      return `${yearNumber}-${String(monthNumber).padStart(2, '0')}`;
    }

    return String(yearNumber);
  }

  private mapBibTeXSourceType(type: string): CitationSourceType | undefined {
    const normalized = String(type || '').toLowerCase();
    if (normalized === 'article') return 'JOURNAL_ARTICLE';
    if (normalized === 'inproceedings' || normalized === 'conference') return 'CONFERENCE_PAPER';
    if (normalized === 'book') return 'BOOK';
    if (normalized === 'incollection' || normalized === 'inbook') return 'BOOK_CHAPTER';
    if (normalized === 'phdthesis' || normalized === 'mastersthesis') return 'THESIS';
    if (normalized === 'techreport') return 'REPORT';
    if (normalized === 'misc' || normalized === 'online' || normalized === 'webpage') return 'WEBSITE';
    return undefined;
  }

  private inferBibTeXType(citation: CitationData): string {
    const sourceType = String(citation.sourceType || '').toUpperCase();
    if (sourceType === 'JOURNAL_ARTICLE') return 'article';
    if (sourceType === 'CONFERENCE_PAPER') return 'inproceedings';
    if (sourceType === 'BOOK') return 'book';
    if (sourceType === 'BOOK_CHAPTER') return 'incollection';
    if (sourceType === 'THESIS') return 'phdthesis';
    if (sourceType === 'REPORT' || sourceType === 'WORKING_PAPER') return 'techreport';
    if (sourceType === 'WEBSITE') return 'misc';

    if (citation.doi && citation.volume) return 'article';
    if (citation.venue?.toLowerCase().includes('conference') || citation.venue?.toLowerCase().includes('proceedings')) return 'inproceedings';
    if (citation.isbn || citation.publisher) return 'book';
    return 'misc';
  }

  /**
   * Invalidate cache
   */
  invalidateCache(): void {
    this.styleCache.clear();
    this.cacheTimestamp = 0;
  }
}

// Export singleton instance
export const citationStyleService = new CitationStyleService();

// Export class for testing
export { CitationStyleService };
