/**
 * Academic Search Result Normalizer
 * Standardizes search results from different academic APIs into a common format
 */

export interface NormalizedSearchResult {
  // Core identifiers
  id: string;
  title: string;
  authors: string[];
  year?: number;

  // Publication details
  venue?: string;
  volume?: string;
  issue?: string;
  pages?: string;

  // External identifiers
  doi?: string;
  url?: string;
  isbn?: string;

  // Content and metrics
  abstract?: string;
  citationCount?: number;
  source: string; // API source: 'google_scholar', 'semantic_scholar', 'crossref', 'openalex'

  // Metadata
  rawData?: any; // Original API response for debugging
  normalizedAt: Date;
  confidence: 'high' | 'medium' | 'low'; // Data quality indicator
}

export interface NormalizationOptions {
  includeAbstract?: boolean;
  maxAuthors?: number; // Truncate author list if too long
  requireDOI?: boolean; // Skip results without DOI
  minCitationCount?: number; // Skip results with too few citations
}

export interface NormalizationStats {
  totalProcessed: number;
  successfullyNormalized: number;
  skipped: {
    noDOI: number;
    lowCitations: number;
    invalidData: number;
    other: number;
  };
  sourceBreakdown: Record<string, number>;
}

class SearchResultNormalizer {
  private stats: NormalizationStats = {
    totalProcessed: 0,
    successfullyNormalized: 0,
    skipped: {
      noDOI: 0,
      lowCitations: 0,
      invalidData: 0,
      other: 0
    },
    sourceBreakdown: {}
  };

  /**
   * Normalize Google Scholar API results
   */
  normalizeGoogleScholarResult(result: any, options: NormalizationOptions = {}): NormalizedSearchResult | null {
    this.stats.totalProcessed++;
    this.stats.sourceBreakdown['google_scholar'] = (this.stats.sourceBreakdown['google_scholar'] || 0) + 1;

    try {
      // Google Scholar API structure (hypothetical based on common patterns)
      const normalized: NormalizedSearchResult = {
        id: result.id || result.link || `gs_${Date.now()}_${Math.random()}`,
        title: this.cleanTitle(result.title || ''),
        authors: this.normalizeAuthors(result.authors || result.author || []),
        year: this.extractYear(result.year || result.published_date),
        venue: result.publication || result.journal || result.venue,
        doi: this.extractDOI(result.doi || result.link),
        url: result.link || result.url,
        citationCount: this.parseCitationCount(result.citations || result.cited_by),
        source: 'google_scholar',
        rawData: options.includeAbstract ? result : undefined,
        normalizedAt: new Date(),
        confidence: this.assessConfidence(result)
      };

      // Apply filters
      if (options.requireDOI && !normalized.doi) {
        this.stats.skipped.noDOI++;
        return null;
      }

      if (options.minCitationCount && (!normalized.citationCount || normalized.citationCount < options.minCitationCount)) {
        this.stats.skipped.lowCitations++;
        return null;
      }

      // Validate required fields
      if (!normalized.title || normalized.authors.length === 0) {
        this.stats.skipped.invalidData++;
        return null;
      }

      this.stats.successfullyNormalized++;
      return normalized;

    } catch (error) {
      console.warn('Failed to normalize Google Scholar result:', error);
      this.stats.skipped.other++;
      return null;
    }
  }

  /**
   * Normalize Semantic Scholar API results
   */
  normalizeSemanticScholarResult(result: any, options: NormalizationOptions = {}): NormalizedSearchResult | null {
    this.stats.totalProcessed++;
    this.stats.sourceBreakdown['semantic_scholar'] = (this.stats.sourceBreakdown['semantic_scholar'] || 0) + 1;

    try {
      const normalized: NormalizedSearchResult = {
        id: `ss_${result.paperId}`,
        title: this.cleanTitle(result.title || ''),
        authors: this.normalizeAuthors(result.authors || [], options.maxAuthors),
        year: result.year,
        venue: result.venue,
        doi: result.doi,
        url: result.url,
        citationCount: result.citationCount,
        abstract: options.includeAbstract ? this.cleanAbstract(result.abstract) : undefined,
        source: 'semantic_scholar',
        rawData: options.includeAbstract ? result : undefined,
        normalizedAt: new Date(),
        confidence: this.assessConfidence(result)
      };

      // Apply filters
      if (options.requireDOI && !normalized.doi) {
        this.stats.skipped.noDOI++;
        return null;
      }

      if (options.minCitationCount && (!normalized.citationCount || normalized.citationCount < options.minCitationCount)) {
        this.stats.skipped.lowCitations++;
        return null;
      }

      // Validate required fields
      if (!normalized.title || normalized.authors.length === 0) {
        this.stats.skipped.invalidData++;
        return null;
      }

      this.stats.successfullyNormalized++;
      return normalized;

    } catch (error) {
      console.warn('Failed to normalize Semantic Scholar result:', error);
      this.stats.skipped.other++;
      return null;
    }
  }

  /**
   * Normalize CrossRef API results
   */
  normalizeCrossRefResult(result: any, options: NormalizationOptions = {}): NormalizedSearchResult | null {
    this.stats.totalProcessed++;
    this.stats.sourceBreakdown['crossref'] = (this.stats.sourceBreakdown['crossref'] || 0) + 1;

    try {
      const normalized: NormalizedSearchResult = {
        id: `cr_${result.DOI || result.URL || Date.now()}`,
        title: this.cleanTitle((result.title || [])[0] || ''),
        authors: this.normalizeAuthors(result.author || [], options.maxAuthors),
        year: this.extractYearFromCrossRef(result.issued),
        venue: (result['container-title'] || [])[0] || result.publisher,
        volume: result.volume,
        issue: result.issue,
        pages: result.page,
        doi: result.DOI,
        url: result.URL,
        citationCount: result['is-referenced-by-count'],
        abstract: options.includeAbstract ? this.cleanAbstract(result.abstract) : undefined,
        source: 'crossref',
        rawData: options.includeAbstract ? result : undefined,
        normalizedAt: new Date(),
        confidence: this.assessConfidence(result)
      };

      // Apply filters
      if (options.requireDOI && !normalized.doi) {
        this.stats.skipped.noDOI++;
        return null;
      }

      if (options.minCitationCount && (!normalized.citationCount || normalized.citationCount < options.minCitationCount)) {
        this.stats.skipped.lowCitations++;
        return null;
      }

      // Validate required fields
      if (!normalized.title || normalized.authors.length === 0) {
        this.stats.skipped.invalidData++;
        return null;
      }

      this.stats.successfullyNormalized++;
      return normalized;

    } catch (error) {
      console.warn('Failed to normalize CrossRef result:', error);
      this.stats.skipped.other++;
      return null;
    }
  }

  /**
   * Normalize OpenAlex API results
   */
  normalizeOpenAlexResult(result: any, options: NormalizationOptions = {}): NormalizedSearchResult | null {
    this.stats.totalProcessed++;
    this.stats.sourceBreakdown['openalex'] = (this.stats.sourceBreakdown['openalex'] || 0) + 1;

    try {
      const normalized: NormalizedSearchResult = {
        id: `oa_${(result.id || '').replace('https://openalex.org/', '')}`,
        title: this.cleanTitle(result.title || ''),
        authors: this.normalizeAuthors(result.authorships || [], options.maxAuthors, 'openalex'),
        year: result.publication_year,
        venue: result.primary_location?.source?.display_name || result.host_venue_name,
        volume: result.biblio?.volume,
        issue: result.biblio?.issue,
        pages: result.biblio?.first_page && result.biblio?.last_page ?
               `${result.biblio.first_page}-${result.biblio.last_page}` : undefined,
        doi: result.doi?.replace('https://doi.org/', ''),
        url: result.primary_location?.landing_page_url || result.doi,
        citationCount: result.cited_by_count,
        abstract: options.includeAbstract ? this.reconstructOpenAlexAbstract(result.abstract_inverted_index) : undefined,
        source: 'openalex',
        rawData: options.includeAbstract ? result : undefined,
        normalizedAt: new Date(),
        confidence: this.assessConfidence(result)
      };

      // Apply filters
      if (options.requireDOI && !normalized.doi) {
        this.stats.skipped.noDOI++;
        return null;
      }

      if (options.minCitationCount && (!normalized.citationCount || normalized.citationCount < options.minCitationCount)) {
        this.stats.skipped.lowCitations++;
        return null;
      }

      // Validate required fields
      if (!normalized.title || normalized.authors.length === 0) {
        this.stats.skipped.invalidData++;
        return null;
      }

      this.stats.successfullyNormalized++;
      return normalized;

    } catch (error) {
      console.warn('Failed to normalize OpenAlex result:', error);
      this.stats.skipped.other++;
      return null;
    }
  }

  /**
   * Normalize an array of results from any source
   */
  normalizeResults(results: any[], source: string, options: NormalizationOptions = {}): NormalizedSearchResult[] {
    const normalized: NormalizedSearchResult[] = [];

    for (const result of results) {
      let normalizedResult: NormalizedSearchResult | null = null;

      switch (source) {
        case 'google_scholar':
          normalizedResult = this.normalizeGoogleScholarResult(result, options);
          break;
        case 'semantic_scholar':
          normalizedResult = this.normalizeSemanticScholarResult(result, options);
          break;
        case 'crossref':
          normalizedResult = this.normalizeCrossRefResult(result, options);
          break;
        case 'openalex':
          normalizedResult = this.normalizeOpenAlexResult(result, options);
          break;
        default:
          console.warn(`Unknown source: ${source}`);
          continue;
      }

      if (normalizedResult) {
        normalized.push(normalizedResult);
      }
    }

    return normalized;
  }

  /**
   * Get normalization statistics
   */
  getStats(): NormalizationStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalProcessed: 0,
      successfullyNormalized: 0,
      skipped: {
        noDOI: 0,
        lowCitations: 0,
        invalidData: 0,
        other: 0
      },
      sourceBreakdown: {}
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private cleanTitle(title: string): string {
    if (!title) return '';
    return title
      .replace(/<\/?[^>]+(>|$)/g, '') // Remove HTML tags
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  private cleanAbstract(abstract: string): string {
    if (!abstract) return '';
    return abstract
      .replace(/<\/?[^>]+(>|$)/g, '') // Remove HTML tags
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  private normalizeAuthors(authors: any[], maxAuthors?: number, source?: string): string[] {
    if (!Array.isArray(authors) || authors.length === 0) {
      return [];
    }

    let processedAuthors: string[] = [];

    if (source === 'openalex') {
      // OpenAlex format: [{author: {display_name: "Name"}}]
      processedAuthors = authors
        .map((auth: any) => auth.author?.display_name || '')
        .filter((name: string) => name.trim().length > 0);
    } else if (source === 'crossref' || authors[0]?.family) {
      // CrossRef format: [{family: "Last", given: "First"}]
      processedAuthors = authors
        .map((author: any) => {
          const family = author.family || '';
          const given = author.given || '';
          return `${family}${family && given ? ', ' : ''}${given}`.trim();
        })
        .filter((name: string) => name.length > 0);
    } else if (authors[0]?.name) {
      // Semantic Scholar format: [{name: "Name"}]
      processedAuthors = authors
        .map((author: any) => author.name || '')
        .filter((name: string) => name.trim().length > 0);
    } else if (typeof authors[0] === 'string') {
      // Simple string array
      processedAuthors = authors.filter((name: string) => typeof name === 'string' && name.trim().length > 0);
    } else {
      // Fallback: try to extract any string values
      processedAuthors = authors
        .map((author: any) => {
          if (typeof author === 'string') return author;
          if (author?.name) return author.name;
          if (author?.display_name) return author.display_name;
          return '';
        })
        .filter((name: string) => name.trim().length > 0);
    }

    // Limit authors if specified
    if (maxAuthors && processedAuthors.length > maxAuthors) {
      processedAuthors = processedAuthors.slice(0, maxAuthors);
    }

    return processedAuthors;
  }

  private extractYear(year: any): number | undefined {
    if (typeof year === 'number') return year;
    if (typeof year === 'string') {
      const parsed = parseInt(year);
      return isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  }

  private extractYearFromCrossRef(issued: any): number | undefined {
    if (!issued || !issued['date-parts'] || !Array.isArray(issued['date-parts'])) {
      return undefined;
    }
    const dateParts = issued['date-parts'][0];
    if (Array.isArray(dateParts) && dateParts.length > 0) {
      return this.extractYear(dateParts[0]);
    }
    return undefined;
  }

  private extractDOI(doi: string): string | undefined {
    if (!doi) return undefined;

    // Remove common prefixes
    const cleanDOI = doi
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
      .replace(/^doi:/i, '')
      .trim();

    // Basic DOI validation
    if (/^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i.test(cleanDOI)) {
      return cleanDOI.toLowerCase();
    }

    return undefined;
  }

  private parseCitationCount(citations: any): number | undefined {
    if (typeof citations === 'number') return citations;
    if (typeof citations === 'string') {
      // Handle strings like "123 citations" or "123"
      const match = citations.match(/(\d+)/);
      return match ? parseInt(match[1]) : undefined;
    }
    return undefined;
  }

  private reconstructOpenAlexAbstract(invertedIndex: Record<string, number[]>): string {
    if (!invertedIndex) return '';

    const words: string[] = [];
    const positions = Object.entries(invertedIndex);

    // Sort by position
    positions.sort((a, b) => {
      const aPos = a[1][0];
      const bPos = b[1][0];
      return aPos - bPos;
    });

    // Reconstruct text
    for (const [word, pos] of positions) {
      for (const position of pos) {
        words[position] = word;
      }
    }

    return words.join(' ');
  }

  private assessConfidence(result: any): 'high' | 'medium' | 'low' {
    let score = 0;

    // DOI presence
    if (result.doi || result.DOI) score += 2;

    // Author information
    const authors = result.authors || result.author || result.authorships || [];
    if (Array.isArray(authors) && authors.length > 0) score += 1;

    // Year information
    if (result.year || result.publication_year || result.issued) score += 1;

    // Venue information
    if (result.venue || result.publication || result['container-title'] || result.primary_location) score += 1;

    // Abstract presence
    if (result.abstract || result.abstract_inverted_index) score += 1;

    if (score >= 4) return 'high';
    if (score >= 2) return 'medium';
    return 'low';
  }

  /**
   * Batch normalize results from multiple sources
   */
  normalizeBatch(resultsBySource: Record<string, any[]>, options: NormalizationOptions = {}): {
    results: NormalizedSearchResult[];
    stats: NormalizationStats;
  } {
    this.resetStats();
    const allResults: NormalizedSearchResult[] = [];

    for (const [source, results] of Object.entries(resultsBySource)) {
      const normalized = this.normalizeResults(results, source, options);
      allResults.push(...normalized);
    }

    // Remove duplicates by DOI
    const uniqueResults = this.deduplicateByDOI(allResults);

    return {
      results: uniqueResults,
      stats: this.getStats()
    };
  }

  private deduplicateByDOI(results: NormalizedSearchResult[]): NormalizedSearchResult[] {
    const seenDOIs = new Set<string>();
    const unique: NormalizedSearchResult[] = [];

    for (const result of results) {
      const doi = result.doi?.toLowerCase();
      if (doi && seenDOIs.has(doi)) {
        continue; // Skip duplicate
      }

      if (doi) {
        seenDOIs.add(doi);
      }

      unique.push(result);
    }

    return unique;
  }

  /**
   * Validate a normalized result
   */
  validateResult(result: NormalizedSearchResult): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!result.id || result.id.trim().length === 0) {
      errors.push('Missing or empty ID');
    }

    if (!result.title || result.title.trim().length === 0) {
      errors.push('Missing or empty title');
    }

    if (!Array.isArray(result.authors) || result.authors.length === 0) {
      errors.push('Missing or empty authors array');
    }

    if (result.year && (result.year < 1800 || result.year > new Date().getFullYear() + 1)) {
      errors.push('Invalid publication year');
    }

    if (result.doi && !/^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i.test(result.doi)) {
      errors.push('Invalid DOI format');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// Export singleton instance
export const searchResultNormalizer = new SearchResultNormalizer();

// Export class for testing
export { SearchResultNormalizer };

