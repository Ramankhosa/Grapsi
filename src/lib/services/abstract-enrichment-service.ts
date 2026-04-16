/**
 * Abstract Enrichment Service
 * Fetches missing abstracts from multiple academic sources
 * and provides tools for abstract management
 */

export interface AbstractSearchResult {
  source: string;
  abstract: string;
  confidence: 'high' | 'medium' | 'low';
  doi?: string;
  title?: string;
}

export interface EnrichmentResult {
  found: boolean;
  abstracts: AbstractSearchResult[];
  errors: string[];
}

// Timeout wrapper for fetch requests
const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
};

// Maximum abstract length to prevent memory issues
const MAX_ABSTRACT_LENGTH = 10000;

// Helper to get Semantic Scholar headers with optional API key
const getSemanticScholarHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    'User-Agent': 'Research-Paper-Writing-App/1.0'
  };
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  return headers;
};

class AbstractEnrichmentService {
  /**
   * Search for abstract using DOI
   */
  async searchByDOI(doi: string): Promise<EnrichmentResult> {
    // Validate DOI format
    if (!doi || typeof doi !== 'string' || !doi.trim()) {
      return { found: false, abstracts: [], errors: ['Invalid DOI provided'] };
    }

    const abstracts: AbstractSearchResult[] = [];
    const errors: string[] = [];

    // Try multiple sources in parallel with individual error handling
    const results = await Promise.allSettled([
      this.fetchFromSemanticScholar(doi),
      this.fetchFromOpenAlex(doi),
      this.fetchFromCrossRef(doi),
    ]);

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        // Truncate overly long abstracts
        const abstract = result.value;
        if (abstract.abstract.length > MAX_ABSTRACT_LENGTH) {
          abstract.abstract = abstract.abstract.slice(0, MAX_ABSTRACT_LENGTH) + '...';
        }
        abstracts.push(abstract);
      } else if (result.status === 'rejected') {
        const errorMsg = result.reason?.message || 'Unknown error';
        // Only add unique errors
        if (!errors.includes(errorMsg)) {
          errors.push(errorMsg);
        }
      }
    }

    // Sort by confidence
    abstracts.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.confidence] - order[b.confidence];
    });

    return {
      found: abstracts.length > 0,
      abstracts,
      errors,
    };
  }

  /**
   * Search for abstract using title (fallback when DOI is unavailable)
   */
  async searchByTitle(title: string, authors?: string[]): Promise<EnrichmentResult> {
    // Validate title
    if (!title || typeof title !== 'string' || title.trim().length < 3) {
      return { found: false, abstracts: [], errors: ['Title too short or invalid'] };
    }

    const abstracts: AbstractSearchResult[] = [];
    const errors: string[] = [];

    // Clean title for search - keep alphanumeric and spaces
    const cleanTitle = title.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

    if (cleanTitle.length < 3) {
      return { found: false, abstracts: [], errors: ['Cleaned title too short'] };
    }

    const results = await Promise.allSettled([
      this.searchSemanticScholarByTitle(cleanTitle),
      this.searchOpenAlexByTitle(cleanTitle),
    ]);

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        // Truncate overly long abstracts
        const abstract = result.value;
        if (abstract.abstract.length > MAX_ABSTRACT_LENGTH) {
          abstract.abstract = abstract.abstract.slice(0, MAX_ABSTRACT_LENGTH) + '...';
        }
        abstracts.push(abstract);
      } else if (result.status === 'rejected') {
        const errorMsg = result.reason?.message || 'Unknown error';
        if (!errors.includes(errorMsg)) {
          errors.push(errorMsg);
        }
      }
    }

    abstracts.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.confidence] - order[b.confidence];
    });

    return {
      found: abstracts.length > 0,
      abstracts,
      errors,
    };
  }

  /**
   * Enrich a citation - try DOI first, then title
   */
  async enrichCitation(citation: {
    doi?: string;
    title: string;
    authors?: string[];
  }): Promise<EnrichmentResult> {
    // Try DOI first if available
    if (citation.doi) {
      const doiResult = await this.searchByDOI(citation.doi);
      if (doiResult.found) {
        return doiResult;
      }
    }

    // Fall back to title search
    return this.searchByTitle(citation.title, citation.authors);
  }

  /**
   * Extract abstract from plain text (e.g., copied from PDF)
   * Uses pattern matching to find the abstract section
   */
  extractAbstractFromText(text: string): string | null {
    // Common patterns for abstract sections
    const patterns = [
      // "Abstract" followed by content
      /\bAbstract[:\s]*\n?([\s\S]{100,2000}?)(?=\n\s*(?:Introduction|Keywords|1\.|1\s|Background|\n\n))/i,
      // "ABSTRACT" in caps
      /\bABSTRACT[:\s]*\n?([\s\S]{100,2000}?)(?=\n\s*(?:INTRODUCTION|KEYWORDS|1\.|1\s|\n\n))/,
      // "Summary" as alternative
      /\bSummary[:\s]*\n?([\s\S]{100,2000}?)(?=\n\s*(?:Introduction|Keywords|1\.|1\s|Background|\n\n))/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return this.cleanAbstractText(match[1]);
      }
    }

    return null;
  }

  /**
   * Clean and normalize abstract text
   */
  cleanAbstractText(text: string): string {
    return text
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/^\s*[-–—]\s*/, '') // Remove leading dashes
      .replace(/\s*[-–—]\s*$/, '') // Remove trailing dashes
      .replace(/\n/g, ' ') // Remove line breaks
      .replace(/\s{2,}/g, ' ') // Remove double spaces
      .trim();
  }

  // ============================================================================
  // PRIVATE: Source-specific fetchers
  // ============================================================================

  private async fetchFromSemanticScholar(doi: string): Promise<AbstractSearchResult | null> {
    try {
      const response = await fetchWithTimeout(
        `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=abstract,title`,
        { headers: getSemanticScholarHeaders() },
        8000 // 8 second timeout
      );

      if (!response.ok) return null;

      const data = await response.json();
      if (!data.abstract || typeof data.abstract !== 'string') return null;

      return {
        source: 'Semantic Scholar',
        abstract: data.abstract.trim(),
        confidence: 'high',
        doi,
        title: data.title || undefined,
      };
    } catch (err) {
      // Log for debugging but don't throw
      if (err instanceof Error && err.name === 'AbortError') {
        console.warn('Semantic Scholar request timed out');
      }
      return null;
    }
  }

  private async fetchFromOpenAlex(doi: string): Promise<AbstractSearchResult | null> {
    try {
      const response = await fetchWithTimeout(
        `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`,
        { headers: { 'User-Agent': 'Research-Paper-Writing-App/1.0' } },
        8000
      );

      if (!response.ok) return null;

      const data = await response.json();
      if (!data.abstract_inverted_index || typeof data.abstract_inverted_index !== 'object') return null;

      // Reconstruct abstract from inverted index
      const abstract = this.reconstructOpenAlexAbstract(data.abstract_inverted_index);
      if (!abstract) return null;

      return {
        source: 'OpenAlex',
        abstract,
        confidence: 'high',
        doi,
        title: data.title || undefined,
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.warn('OpenAlex request timed out');
      }
      return null;
    }
  }

  private async fetchFromCrossRef(doi: string): Promise<AbstractSearchResult | null> {
    try {
      const response = await fetchWithTimeout(
        `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
        { headers: { 'User-Agent': 'Research-Paper-Writing-App/1.0' } },
        8000
      );

      if (!response.ok) return null;

      const data = await response.json();
      const abstract = data.message?.abstract;
      if (!abstract || typeof abstract !== 'string') return null;

      // CrossRef abstracts often have XML/HTML tags
      const cleanedAbstract = abstract
        .replace(/<[^>]+>/g, '') // Remove HTML tags
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (cleanedAbstract.length < 20) return null; // Too short to be valid

      return {
        source: 'CrossRef',
        abstract: cleanedAbstract,
        confidence: 'medium', // CrossRef abstracts can be incomplete
        doi,
        title: data.message?.title?.[0] || undefined,
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.warn('CrossRef request timed out');
      }
      return null;
    }
  }

  private async searchSemanticScholarByTitle(title: string): Promise<AbstractSearchResult | null> {
    try {
      const response = await fetchWithTimeout(
        `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title)}&limit=3&fields=abstract,title,doi`,
        { headers: getSemanticScholarHeaders() },
        8000
      );

      if (!response.ok) return null;

      const data = await response.json();
      const papers = Array.isArray(data.data) ? data.data : [];

      // Find best match by title similarity
      for (const paper of papers) {
        if (paper.abstract && typeof paper.abstract === 'string' && this.isTitleMatch(title, paper.title)) {
          return {
            source: 'Semantic Scholar',
            abstract: paper.abstract.trim(),
            confidence: 'medium', // Lower confidence for title search
            doi: paper.doi || undefined,
            title: paper.title || undefined,
          };
        }
      }

      return null;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.warn('Semantic Scholar title search timed out');
      }
      return null;
    }
  }

  private async searchOpenAlexByTitle(title: string): Promise<AbstractSearchResult | null> {
    try {
      const response = await fetchWithTimeout(
        `https://api.openalex.org/works?search=${encodeURIComponent(title)}&per_page=3`,
        { headers: { 'User-Agent': 'Research-Paper-Writing-App/1.0' } },
        8000
      );

      if (!response.ok) return null;

      const data = await response.json();
      const works = Array.isArray(data.results) ? data.results : [];

      for (const work of works) {
        if (work.abstract_inverted_index && typeof work.abstract_inverted_index === 'object' && this.isTitleMatch(title, work.title)) {
          const abstract = this.reconstructOpenAlexAbstract(work.abstract_inverted_index);
          if (abstract) {
            // Extract DOI from URL format
            let doi: string | undefined;
            if (work.doi && typeof work.doi === 'string') {
              doi = work.doi.replace('https://doi.org/', '');
            }
            return {
              source: 'OpenAlex',
              abstract,
              confidence: 'medium',
              doi,
              title: work.title || undefined,
            };
          }
        }
      }

      return null;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.warn('OpenAlex title search timed out');
      }
      return null;
    }
  }

  private reconstructOpenAlexAbstract(invertedIndex: Record<string, number[]>): string | null {
    if (!invertedIndex || typeof invertedIndex !== 'object') return null;

    try {
      const words: string[] = [];
      for (const [word, positions] of Object.entries(invertedIndex)) {
        for (const pos of positions) {
          words[pos] = word;
        }
      }
      return words.filter(Boolean).join(' ');
    } catch {
      return null;
    }
  }

  private isTitleMatch(searchTitle: string, foundTitle: string): boolean {
    // Validate inputs
    if (!searchTitle || !foundTitle) return false;
    if (typeof searchTitle !== 'string' || typeof foundTitle !== 'string') return false;

    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

    const search = normalize(searchTitle);
    const found = normalize(foundTitle);

    // Empty strings after normalization
    if (!search || !found) return false;

    // Check for high similarity
    if (search === found) return true;
    if (found.includes(search) || search.includes(found)) return true;

    // Check word overlap
    const searchWords = new Set(search.split(' ').filter(w => w.length > 2)); // Ignore short words
    const foundWords = new Set(found.split(' ').filter(w => w.length > 2));
    
    // Prevent division by zero
    const minSize = Math.min(searchWords.size, foundWords.size);
    if (minSize === 0) return false;
    
    const intersection = [...searchWords].filter(w => foundWords.has(w));
    const overlap = intersection.length / minSize;

    return overlap > 0.7; // 70% word overlap
  }
}

export const abstractEnrichmentService = new AbstractEnrichmentService();

