/**
 * Literature Search Service
 * Unified service for searching academic databases and literature
 */

import crypto from 'crypto';

// Publication types supported across providers
export type PublicationType = 
  | 'journal-article'
  | 'conference-paper'
  | 'book-chapter'
  | 'book'
  | 'preprint'
  | 'review'
  | 'thesis'
  | 'dataset'
  | 'other';

// Field of study categories
export type FieldOfStudy =
  | 'computer-science'
  | 'medicine'
  | 'biology'
  | 'physics'
  | 'chemistry'
  | 'mathematics'
  | 'engineering'
  | 'economics'
  | 'psychology'
  | 'sociology'
  | 'environmental-science'
  | 'materials-science'
  | 'other';

// Search result interface
export interface SearchResult {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  isbn?: string;
  edition?: string;
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
  libraryReferenceId?: string;
  abstract?: string;
  doi?: string;
  url?: string;
  citationCount?: number;
  source: string; // Which provider returned this result
  publicationType?: PublicationType;
  isOpenAccess?: boolean;
  pdfUrl?: string;
  fieldsOfStudy?: string[];
  rawData?: any; // Original API response for debugging
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized || undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function firstDefinedString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = normalizeOptionalString(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function buildPageRange(startPage: unknown, endPage: unknown): string | undefined {
  const start = normalizeOptionalString(startPage);
  const end = normalizeOptionalString(endPage);
  if (start && end) {
    return start === end ? start : `${start}-${end}`;
  }
  return start || end || undefined;
}

function parseCrossRefPages(work: any): string | undefined {
  return firstDefinedString(
    work?.page,
    buildPageRange(work?.['page-first'], work?.['page-last'])
  );
}

function parseCrossRefIsbn(work: any): string | undefined {
  const isbnList = Array.isArray(work?.ISBN)
    ? work.ISBN
    : (work?.ISBN ? [work.ISBN] : []);
  for (const isbn of isbnList) {
    const normalized = normalizeOptionalString(isbn);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function parseCrossRefIssn(work: any): string | undefined {
  const issnList = Array.isArray(work?.ISSN)
    ? work.ISSN
    : (work?.ISSN ? [work.ISSN] : []);
  for (const issn of issnList) {
    const normalized = normalizeOptionalString(issn);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function parseCrossRefEditors(work: any): string[] | undefined {
  const editors = Array.isArray(work?.editor) ? work.editor : [];
  const mapped = editors
    .map((editor: any) => {
      const given = normalizeOptionalString(editor?.given);
      const family = normalizeOptionalString(editor?.family);
      if (given && family) return `${given} ${family}`;
      return given || family || '';
    })
    .map((name: string) => name.trim())
    .filter(Boolean);
  return mapped.length > 0 ? mapped : undefined;
}

function parseDateParts(value: any): string | undefined {
  const parts = Array.isArray(value?.['date-parts']) && Array.isArray(value['date-parts'][0])
    ? value['date-parts'][0]
    : null;
  if (!parts || parts.length === 0) {
    return undefined;
  }

  const year = Number(parts[0]);
  if (!Number.isFinite(year)) {
    return undefined;
  }

  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (Number.isFinite(month) && month >= 1 && month <= 12) {
    if (Number.isFinite(day) && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  return String(year);
}

// Search options with enhanced filters
export interface SearchOptions {
  yearFrom?: number;
  yearTo?: number;
  limit?: number;
  sources?: string[]; // Which providers to search
  includeAbstract?: boolean;
  
  // Enhanced filters
  publicationTypes?: PublicationType[]; // Filter by publication type
  openAccessOnly?: boolean; // Only return open access papers
  minCitations?: number; // Minimum citation count
  fieldsOfStudy?: FieldOfStudy[]; // Filter by field of study
  hasAbstract?: boolean; // Only return papers with abstracts
}

// Provider filter support - indicates which filters each provider supports
export interface ProviderFilterSupport {
  publicationTypes: boolean;
  openAccessOnly: boolean;
  minCitations: boolean;
  fieldsOfStudy: boolean;
  hasAbstract: boolean;
  yearRange: boolean;
}

// Export filter support map for UI to use
export const PROVIDER_FILTER_SUPPORT: Record<string, ProviderFilterSupport> = {
  google_scholar: {
    publicationTypes: false,
    openAccessOnly: false,
    minCitations: false,
    fieldsOfStudy: false,
    hasAbstract: false,
    yearRange: true
  },
  semantic_scholar: {
    publicationTypes: true,
    openAccessOnly: true,
    minCitations: true,
    fieldsOfStudy: true,
    hasAbstract: false,
    yearRange: true
  },
  crossref: {
    publicationTypes: true,
    openAccessOnly: false,
    minCitations: false,
    fieldsOfStudy: false,
    hasAbstract: true,
    yearRange: true
  },
  openalex: {
    publicationTypes: true,
    openAccessOnly: true,
    minCitations: true,
    fieldsOfStudy: true,
    hasAbstract: true,
    yearRange: true
  },
  pubmed: {
    publicationTypes: true,
    openAccessOnly: true,
    minCitations: false,
    fieldsOfStudy: true,
    hasAbstract: true,
    yearRange: true
  },
  arxiv: {
    publicationTypes: false, // All are preprints
    openAccessOnly: false, // All are open access
    minCitations: false,
    fieldsOfStudy: true, // Categories
    hasAbstract: true,
    yearRange: true
  },
  core: {
    publicationTypes: true,
    openAccessOnly: false, // All are open access
    minCitations: false,
    fieldsOfStudy: true,
    hasAbstract: true,
    yearRange: true
  }
};

// Provider interface
export interface SearchProvider {
  name: string;
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
  getByIdentifier(identifier: string): Promise<SearchResult | null>;
  getRateLimit(): { requests: number; period: number }; // requests per period (in seconds)
}

// Cache entry
interface CacheEntry {
  results: SearchResult[];
  timestamp: number;
  query: string;
  options: SearchOptions;
}

class LiteratureSearchService {
  private providers: Map<string, SearchProvider> = new Map();
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  private requestCounts: Map<string, { count: number; resetTime: number }> = new Map();

  constructor() {
    this.initializeProviders();
  }

  /**
   * Unified search across multiple academic databases
   */
  async search(query: string, options: SearchOptions = {}): Promise<{
    results: SearchResult[];
    totalFound: number;
    sources: string[];
  }> {
    const sources = options.sources || ['google_scholar', 'semantic_scholar', 'crossref'];
    const limit = options.limit || 20;

    // Check cache first
    const cacheKey = this.generateCacheKey(query, options);
    const cached = this.getCachedResults(cacheKey);
    if (cached) {
      return {
        results: cached.results.slice(0, limit),
        totalFound: cached.results.length,
        sources: [cached.results[0]?.source || 'cache']
      };
    }

    // Perform searches in parallel with rate limiting
    const searchPromises = sources
      .filter(source => this.providers.has(source))
      .map(async (source) => {
        try {
          await this.checkRateLimit(source);
          const provider = this.providers.get(source)!;
          const results = await provider.search(query, options);
          this.recordRequest(source);
          return results;
        } catch (error) {
          console.warn(`Search failed for ${source}:`, error);
          return [];
        }
      });

    const allResults = await Promise.all(searchPromises);
    const flattenedResults = allResults.flat();

    // Deduplicate by DOI
    const deduplicatedResults = this.deduplicateResults(flattenedResults);

    // Sort by relevance (citation count, then year)
    const sortedResults = deduplicatedResults.sort((a, b) => {
      const aScore = (a.citationCount || 0) + (a.year ? (new Date().getFullYear() - a.year) * 0.1 : 0);
      const bScore = (b.citationCount || 0) + (b.year ? (new Date().getFullYear() - b.year) * 0.1 : 0);
      return bScore - aScore;
    });

    // Cache results
    this.cacheResults(cacheKey, sortedResults, query, options);

    const finalResults = sortedResults.slice(0, limit);

    return {
      results: finalResults,
      totalFound: sortedResults.length,
      sources: sources.filter(source => this.providers.has(source))
    };
  }

  /**
   * Get paper by DOI, arXiv ID, or other identifier
   */
  async getByIdentifier(identifier: string): Promise<SearchResult | null> {
    // Try each provider in order of reliability
    const providers = ['crossref', 'semantic_scholar', 'google_scholar'];

    for (const providerName of providers) {
      if (!this.providers.has(providerName)) continue;

      try {
        await this.checkRateLimit(providerName);
        const provider = this.providers.get(providerName)!;
        const result = await provider.getByIdentifier(identifier);
        if (result) {
          this.recordRequest(providerName);
          return result;
        }
      } catch (error) {
        console.warn(`Identifier lookup failed for ${providerName}:`, error);
      }
    }

    return null;
  }

  /**
   * Get available search providers
   */
  getAvailableProviders(): Array<{ name: string; description: string; rateLimit: { requests: number; period: number } }> {
    return Array.from(this.providers.entries()).map(([key, provider]) => ({
      name: key,
      description: this.getProviderDescription(key),
      rateLimit: provider.getRateLimit()
    }));
  }

  /**
   * Clear search cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; oldestEntry: number; newestEntry: number } {
    if (this.cache.size === 0) {
      return { size: 0, oldestEntry: 0, newestEntry: 0 };
    }

    const timestamps = Array.from(this.cache.values()).map(entry => entry.timestamp);
    return {
      size: this.cache.size,
      oldestEntry: Math.min(...timestamps),
      newestEntry: Math.max(...timestamps)
    };
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private initializeProviders(): void {
    // Initialize search providers
    this.providers.set('google_scholar', new GoogleScholarProvider());
    this.providers.set('semantic_scholar', new SemanticScholarProvider());
    this.providers.set('crossref', new CrossRefProvider());
    this.providers.set('openalex', new OpenAlexProvider());
    this.providers.set('pubmed', new PubMedProvider());
    this.providers.set('arxiv', new ArXivProvider());
    this.providers.set('core', new COREProvider());
  }

  private generateCacheKey(query: string, options: SearchOptions): string {
    const normalizedOptions = {
      ...options,
      sources: options.sources?.sort() || []
    };
    const hash = crypto.createHash('md5')
      .update(JSON.stringify({ query, options: normalizedOptions }))
      .digest('hex');
    return hash;
  }

  private getCachedResults(cacheKey: string): CacheEntry | null {
    const entry = this.cache.get(cacheKey);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > this.CACHE_TTL_MS) {
      this.cache.delete(cacheKey);
      return null;
    }

    return entry;
  }

  private cacheResults(cacheKey: string, results: SearchResult[], query: string, options: SearchOptions): void {
    // Limit cache size to prevent memory issues
    if (this.cache.size >= 1000) {
      // Remove oldest entries
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, 100);
      toRemove.forEach(([key]) => this.cache.delete(key));
    }

    this.cache.set(cacheKey, {
      results,
      timestamp: Date.now(),
      query,
      options
    });
  }

  private async checkRateLimit(providerName: string): Promise<void> {
    const provider = this.providers.get(providerName);
    if (!provider) return;

    const rateLimit = provider.getRateLimit();
    const now = Date.now();
    const key = `ratelimit_${providerName}`;

    let countData = this.requestCounts.get(key);
    if (!countData || now > countData.resetTime) {
      countData = { count: 0, resetTime: now + (rateLimit.period * 1000) };
    }

    if (countData.count >= rateLimit.requests) {
      const waitTime = countData.resetTime - now;
      throw new Error(`Rate limit exceeded for ${providerName}. Wait ${Math.ceil(waitTime / 1000)} seconds.`);
    }

    countData.count++;
    this.requestCounts.set(key, countData);
  }

  private recordRequest(providerName: string): void {
    // Additional logging/metrics could go here
    console.log(`Search request completed for ${providerName}`);
  }

  private deduplicateResults(results: SearchResult[]): SearchResult[] {
    const byDoi = new Map<string, SearchResult>();
    const withoutDoi: SearchResult[] = [];

    for (const result of results) {
      const normalizedDoi = normalizeOptionalString(result.doi)?.toLowerCase();
      if (!normalizedDoi) {
        withoutDoi.push(result);
        continue;
      }

      const existing = byDoi.get(normalizedDoi);
      if (!existing) {
        byDoi.set(normalizedDoi, result);
        continue;
      }

      byDoi.set(normalizedDoi, this.mergeSearchResults(existing, result));
    }

    return [...Array.from(byDoi.values()), ...withoutDoi];
  }

  private mergeSearchResults(primary: SearchResult, secondary: SearchResult): SearchResult {
    const citationCounts = [primary.citationCount, secondary.citationCount]
      .filter((count): count is number => typeof count === 'number' && Number.isFinite(count));
    return {
      ...primary,
      title: primary.title || secondary.title,
      authors: primary.authors?.length ? primary.authors : secondary.authors,
      year: primary.year ?? secondary.year,
      venue: primary.venue || secondary.venue,
      volume: primary.volume || secondary.volume,
      issue: primary.issue || secondary.issue,
      pages: primary.pages || secondary.pages,
      publisher: primary.publisher || secondary.publisher,
      isbn: primary.isbn || secondary.isbn,
      edition: primary.edition || secondary.edition,
      editors: primary.editors?.length ? primary.editors : secondary.editors,
      publicationPlace: primary.publicationPlace || secondary.publicationPlace,
      publicationDate: primary.publicationDate || secondary.publicationDate,
      accessedDate: primary.accessedDate || secondary.accessedDate,
      articleNumber: primary.articleNumber || secondary.articleNumber,
      issn: primary.issn || secondary.issn,
      journalAbbreviation: primary.journalAbbreviation || secondary.journalAbbreviation,
      pmid: primary.pmid || secondary.pmid,
      pmcid: primary.pmcid || secondary.pmcid,
      arxivId: primary.arxivId || secondary.arxivId,
      abstract: primary.abstract || secondary.abstract,
      doi: primary.doi || secondary.doi,
      url: primary.url || secondary.url,
      citationCount: citationCounts.length > 0 ? Math.max(...citationCounts) : undefined,
      publicationType: primary.publicationType || secondary.publicationType,
      isOpenAccess: primary.isOpenAccess ?? secondary.isOpenAccess ?? (primary.pdfUrl || secondary.pdfUrl ? true : undefined),
      pdfUrl: primary.pdfUrl || secondary.pdfUrl,
      fieldsOfStudy: primary.fieldsOfStudy?.length ? primary.fieldsOfStudy : secondary.fieldsOfStudy,
      rawData: primary.rawData ?? secondary.rawData
    };
  }

  private getProviderDescription(providerName: string): string {
    const descriptions: Record<string, string> = {
      google_scholar: 'Google Scholar - Broad academic search with citation counts',
      semantic_scholar: 'Semantic Scholar - Rich metadata and citation networks',
      crossref: 'CrossRef - Authoritative DOI lookups and metadata',
      openalex: 'OpenAlex - Comprehensive academic graph data'
    };
    return descriptions[providerName] || providerName;
  }
}

// ============================================================================
// SEARCH PROVIDER IMPLEMENTATIONS
// ============================================================================

class GoogleScholarProvider implements SearchProvider {
  name = 'google_scholar';
  private readonly FETCH_TIMEOUT_MS = 30000; // 30 second timeout

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT_MS);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    // Use Serp_API_KEY (user's env variable name)
    const apiKey = process.env.Serp_API_KEY || process.env.SERPAPI_API_KEY;
    if (!apiKey) {
      console.warn('SerpAPI key not configured (set Serp_API_KEY or SERPAPI_API_KEY), returning empty results');
      return [];
    }

    try {
      const params = new URLSearchParams({
        api_key: apiKey,
        engine: 'google_scholar',
        q: query,
        num: (options.limit || 20).toString(),
      });

      // Add year filters if provided
      if (options.yearFrom) {
        params.set('as_ylo', options.yearFrom.toString());
      }
      if (options.yearTo) {
        params.set('as_yhi', options.yearTo.toString());
      }

      const response = await this.fetchWithTimeout(`https://serpapi.com/search.json?${params}`);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`SerpAPI error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(`SerpAPI error: ${data.error}`);
      }

      const organicResults = data.organic_results || [];

      return organicResults.map((result: any, index: number) => ({
        id: `gs_${result.result_id || index}`,
        title: result.title || '',
        authors: this.parseAuthors(result.publication_info?.authors || result.publication_info?.summary),
        year: this.extractYear(result.publication_info?.summary),
        venue: this.extractVenue(result.publication_info?.summary),
        abstract: result.snippet || '',
        doi: this.extractDOI(result.link),
        url: result.link,
        citationCount: result.inline_links?.cited_by?.total || 0,
        source: 'google_scholar',
        pdfUrl: result.resources?.[0]?.link || undefined,
        rawData: result
      }));
    } catch (error) {
      console.error('Google Scholar search failed:', error);
      return [];
    }
  }

  async getByIdentifier(identifier: string): Promise<SearchResult | null> {
    // Search by DOI or title
    const apiKey = process.env.Serp_API_KEY || process.env.SERPAPI_API_KEY;
    if (!apiKey) return null;

    try {
      const results = await this.search(identifier, { limit: 1 });
      return results[0] || null;
    } catch (error) {
      console.error('Google Scholar identifier lookup failed:', error);
      return null;
    }
  }

  getRateLimit() {
    return { requests: 100, period: 86400 }; // 100 requests per day (SerpAPI limit)
  }

  private parseAuthors(authorsData: any): string[] {
    if (!authorsData) return [];
    
    // If it's an array of author objects
    if (Array.isArray(authorsData)) {
      return authorsData.map((a: any) => a.name || a.author || String(a)).filter(Boolean);
    }
    
    // If it's a string (from summary), try to extract authors
    if (typeof authorsData === 'string') {
      // Pattern: "Author1, Author2 - Journal, Year"
      const parts = authorsData.split(' - ');
      if (parts.length > 0) {
        return parts[0].split(',').map(s => s.trim()).filter(s => s && !s.match(/^\d{4}$/));
      }
    }
    
    return [];
  }

  private extractYear(summary: string | undefined): number | undefined {
    if (!summary) return undefined;
    const yearMatch = summary.match(/\b(19|20)\d{2}\b/);
    return yearMatch ? parseInt(yearMatch[0], 10) : undefined;
  }

  private extractVenue(summary: string | undefined): string | undefined {
    if (!summary) return undefined;
    // Pattern: "Authors - Venue, Year" or "Authors - Venue"
    const parts = summary.split(' - ');
    if (parts.length >= 2) {
      // Remove year from venue if present
      return parts[1].replace(/,?\s*\d{4}\s*$/, '').trim() || undefined;
    }
    return undefined;
  }

  private extractDOI(url: string | undefined): string | undefined {
    if (!url) return undefined;
    // Try to extract DOI from URL if present
    const doiMatch = url.match(/10\.\d{4,}\/[^\s]+/);
    return doiMatch ? doiMatch[0] : undefined;
  }
}

class SemanticScholarProvider implements SearchProvider {
  name = 'semantic_scholar';
  private lastRequestTime = 0;
  private readonly MIN_REQUEST_INTERVAL_MS = 1000; // 1 second between requests
  private readonly FETCH_TIMEOUT_MS = 30000; // 30 second timeout

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'Research-Paper-Writing-App/1.0'
    };
    
    // Add API key if configured (enables higher rate limits)
    const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }
    
    return headers;
  }

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT_MS);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    // Add delay between requests to avoid rate limiting
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL_MS) {
      await new Promise(resolve => setTimeout(resolve, this.MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest));
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const params = new URLSearchParams({
          query: query,
          limit: Math.min(options.limit || 20, 100).toString(), // Max 100 per request
          fields: 'title,authors,year,venue,journal,abstract,citationCount,externalIds,url,publicationTypes,isOpenAccess,fieldsOfStudy,openAccessPdf'
        });

        // Semantic Scholar uses 'year' parameter with range format: "2020-2023" or single year "2023"
        if (options.yearFrom || options.yearTo) {
          const fromYear = options.yearFrom || 1900;
          const toYear = options.yearTo || new Date().getFullYear();
          params.set('year', `${fromYear}-${toYear}`);
        }

        // Publication type filter
        if (options.publicationTypes && options.publicationTypes.length > 0) {
          // Map our types to Semantic Scholar types
          const ssTypes = options.publicationTypes.map(t => {
            const typeMap: Record<string, string> = {
              'journal-article': 'JournalArticle',
              'conference-paper': 'Conference',
              'book-chapter': 'BookSection',
              'book': 'Book',
              'preprint': 'Preprint',
              'review': 'Review',
              'thesis': 'Thesis',
              'dataset': 'Dataset'
            };
            return typeMap[t] || null;
          }).filter(Boolean);
          
          if (ssTypes.length > 0) {
            params.set('publicationTypes', ssTypes.join(','));
          }
        }

        // Open access filter
        if (options.openAccessOnly) {
          params.set('openAccessPdf', '');
        }

        // Minimum citations filter
        if (options.minCitations && options.minCitations > 0) {
          params.set('minCitationCount', options.minCitations.toString());
        }

        // Fields of study filter
        if (options.fieldsOfStudy && options.fieldsOfStudy.length > 0) {
          const ssFields = options.fieldsOfStudy.map(f => {
            const fieldMap: Record<string, string> = {
              'computer-science': 'Computer Science',
              'medicine': 'Medicine',
              'biology': 'Biology',
              'physics': 'Physics',
              'chemistry': 'Chemistry',
              'mathematics': 'Mathematics',
              'engineering': 'Engineering',
              'economics': 'Economics',
              'psychology': 'Psychology',
              'sociology': 'Sociology',
              'environmental-science': 'Environmental Science',
              'materials-science': 'Materials Science'
            };
            return fieldMap[f] || null;
          }).filter(Boolean);
          
          if (ssFields.length > 0) {
            params.set('fieldsOfStudy', ssFields.join(','));
          }
        }

        this.lastRequestTime = Date.now();
        const url = `https://api.semanticscholar.org/graph/v1/paper/search?${params}`;
        console.log(`[SemanticScholar] Searching: ${url.substring(0, 200)}...`);
        
        const response = await this.fetchWithTimeout(url, {
          headers: this.getHeaders()
        });

        if (response.status === 429) {
          // Rate limited - apply exponential backoff
          const retryAfter = parseInt(response.headers.get('Retry-After') || '0', 10);
          const backoffMs = retryAfter > 0 
            ? retryAfter * 1000 
            : Math.min(1000 * Math.pow(2, attempt + 1), 30000); // Max 30 seconds
          console.warn(`Semantic Scholar rate limited (429). Waiting ${backoffMs}ms before retry ${attempt + 1}/${maxRetries}`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }

        if (!response.ok) {
          // Log the actual error for debugging
          const errorBody = await response.text().catch(() => 'Unable to read error body');
          console.error(`[SemanticScholar] API error ${response.status}:`, errorBody.substring(0, 500));
          throw new Error(`Semantic Scholar API error: ${response.status}`);
        }

        const data = await response.json();

        return (data.data || []).map((paper: any) => this.mapPaperToSearchResult(paper));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries - 1) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt + 1), 30000);
          console.warn(`Semantic Scholar search attempt ${attempt + 1} failed, retrying in ${backoffMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    console.error('Semantic Scholar search failed after retries:', lastError);
    return [];
  }

  async getByIdentifier(identifier: string): Promise<SearchResult | null> {
    // Add delay between requests to avoid rate limiting
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL_MS) {
      await new Promise(resolve => setTimeout(resolve, this.MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest));
    }

    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        this.lastRequestTime = Date.now();
        const fields = 'title,authors,year,venue,journal,abstract,citationCount,externalIds,url,publicationTypes,isOpenAccess,fieldsOfStudy,openAccessPdf';
        // Try DOI first
        const response = await this.fetchWithTimeout(`https://api.semanticscholar.org/graph/v1/paper/DOI:${identifier}?fields=${encodeURIComponent(fields)}`, {
          headers: this.getHeaders()
        });

        if (response.status === 429) {
          // Rate limited - apply exponential backoff
          const retryAfter = parseInt(response.headers.get('Retry-After') || '0', 10);
          const backoffMs = retryAfter > 0 
            ? retryAfter * 1000 
            : Math.min(1000 * Math.pow(2, attempt + 1), 30000);
          console.warn(`Semantic Scholar rate limited (429). Waiting ${backoffMs}ms before retry ${attempt + 1}/${maxRetries}`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }

        if (response.ok) {
          const paper = await response.json();
          return this.mapPaperToSearchResult(paper);
        }

        // Non-429 error, don't retry
        return null;
      } catch (error) {
        // Check if it's a timeout/abort error
        const isTimeout = error instanceof Error && (
          error.name === 'AbortError' || 
          error.message.includes('timeout') ||
          error.message.includes('CONNECT_TIMEOUT')
        );
        
        if (attempt < maxRetries - 1) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt + 1), 30000);
          console.warn(`Semantic Scholar identifier lookup attempt ${attempt + 1} failed${isTimeout ? ' (timeout)' : ''}, retrying in ${backoffMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        } else {
          console.error('Semantic Scholar identifier lookup failed:', error);
        }
      }
    }
    return null;
  }

  getRateLimit() {
    return { requests: 100, period: 300 }; // 100 requests per 5 minutes (unauthenticated)
  }

  private mapPaperToSearchResult(paper: any): SearchResult {
    return {
      id: `ss_${paper.paperId || crypto.randomUUID()}`,
      title: paper.title || '',
      authors: (paper.authors || []).map((author: any) => author.name || ''),
      year: paper.year,
      venue: firstDefinedString(paper.venue, paper.journal?.name),
      volume: normalizeOptionalString(paper.journal?.volume),
      issue: normalizeOptionalString(paper.journal?.issue),
      pages: normalizeOptionalString(paper.journal?.pages),
      publicationDate: firstDefinedString(
        paper.publicationDate,
        paper.year
      ),
      articleNumber: normalizeOptionalString(paper.journal?.articleNumber),
      issn: firstDefinedString(
        paper.journal?.issn,
        paper.journal?.ISSN
      ),
      journalAbbreviation: normalizeOptionalString(paper.journal?.nameAbbrev),
      pmid: normalizeOptionalString(paper.externalIds?.PubMed),
      arxivId: normalizeOptionalString(paper.externalIds?.ArXiv),
      abstract: paper.abstract,
      doi: normalizeOptionalString(paper.externalIds?.DOI || paper.doi),
      url: paper.url,
      citationCount: paper.citationCount,
      source: 'semantic_scholar',
      publicationType: this.mapPublicationType(paper.publicationTypes),
      isOpenAccess: paper.isOpenAccess || !!paper.openAccessPdf?.url,
      pdfUrl: paper.openAccessPdf?.url || undefined,
      fieldsOfStudy: (paper.fieldsOfStudy || []).map((f: any) => f.category || f),
      rawData: paper
    };
  }

  private mapPublicationType(types: string[] | undefined): PublicationType | undefined {
    if (!types || types.length === 0) return undefined;
    
    const typeMap: Record<string, PublicationType> = {
      'JournalArticle': 'journal-article',
      'Conference': 'conference-paper',
      'BookSection': 'book-chapter',
      'Book': 'book',
      'Preprint': 'preprint',
      'Review': 'review',
      'Thesis': 'thesis',
      'Dataset': 'dataset'
    };

    for (const t of types) {
      if (typeMap[t]) return typeMap[t];
    }
    return 'other';
  }
}

class CrossRefProvider implements SearchProvider {
  name = 'crossref';
  private readonly FETCH_TIMEOUT_MS = 30000; // 30 second timeout

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT_MS);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Sanitize query for CrossRef API
   * CrossRef can return 400 for queries with special characters or malformed syntax
   */
  private sanitizeQuery(query: string): string {
    // Remove or replace problematic characters
    let sanitized = query
      .replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ') // Remove special query syntax characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    // CrossRef requires at least some searchable content
    if (sanitized.length < 2) {
      return query.replace(/[^\w\s]/g, ' ').trim();
    }

    return sanitized;
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const email = process.env.CROSSREF_EMAIL;
        const userAgent = email ? `Research-Paper-Writing-App/1.0 (${email})` : 'Research-Paper-Writing-App/1.0';

        // Sanitize query to avoid 400 errors
        const sanitizedQuery = this.sanitizeQuery(query);
        if (!sanitizedQuery) {
          console.warn('CrossRef: Query empty after sanitization, skipping search');
          return [];
        }

        const params = new URLSearchParams({
          query: sanitizedQuery,
          rows: (options.limit || 20).toString(),
          'sort': 'relevance'
        });

        // CrossRef uses 'filter' parameter for date filtering, not separate parameters
        const filters: string[] = [];
        if (options.yearFrom) filters.push(`from-pub-date:${options.yearFrom}`);
        if (options.yearTo) filters.push(`until-pub-date:${options.yearTo}`);
        if (filters.length > 0) params.set('filter', filters.join(','));

        // Publication type filter
        if (options.publicationTypes && options.publicationTypes.length > 0) {
          const crTypes = options.publicationTypes.map(t => {
            const typeMap: Record<string, string> = {
              'journal-article': 'journal-article',
              'conference-paper': 'proceedings-article',
              'book-chapter': 'book-chapter',
              'book': 'book',
              'preprint': 'posted-content',
              'review': 'journal-article', // CrossRef doesn't have specific review type
              'thesis': 'dissertation',
              'dataset': 'dataset'
            };
            return typeMap[t] || null;
          }).filter(Boolean);
          
          if (crTypes.length > 0) {
            params.set('filter', `type:${crTypes.join(',type:')}`);
          }
        }

        // Has abstract filter
        if (options.hasAbstract) {
          const currentFilter = params.get('filter');
          const abstractFilter = 'has-abstract:true';
          params.set('filter', currentFilter ? `${currentFilter},${abstractFilter}` : abstractFilter);
        }

        const response = await this.fetchWithTimeout(`https://api.crossref.org/works?${params}`, {
          headers: {
            'User-Agent': userAgent
          }
        });

        if (!response.ok) {
          // Log more details for debugging 400 errors
          if (response.status === 400) {
            const errorText = await response.text().catch(() => 'Unable to read error');
            console.error(`CrossRef API 400 error. Query: "${sanitizedQuery}", Response: ${errorText}`);
          }
          throw new Error(`CrossRef API error: ${response.status}`);
        }

        const data = await response.json();

        return (data.message?.items || []).map((work: any) => this.mapWorkToSearchResult(work));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Check if it's a timeout/abort error
        const isTimeout = lastError.name === 'AbortError' || 
          lastError.message.includes('timeout') ||
          lastError.message.includes('CONNECT_TIMEOUT') ||
          lastError.message.includes('fetch failed');
        
        if (attempt < maxRetries - 1 && isTimeout) {
          const backoffMs = Math.min(2000 * Math.pow(2, attempt), 10000);
          console.warn(`CrossRef search attempt ${attempt + 1} failed (timeout), retrying in ${backoffMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    console.error('CrossRef search failed:', lastError);
    return [];
  }

  async getByIdentifier(identifier: string): Promise<SearchResult | null> {
    const maxRetries = 2;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const email = process.env.CROSSREF_EMAIL;
        const userAgent = email ? `Research-Paper-Writing-App/1.0 (${email})` : 'Research-Paper-Writing-App/1.0';

        const response = await this.fetchWithTimeout(`https://api.crossref.org/works/${identifier}`, {
          headers: {
            'User-Agent': userAgent
          }
        });

        if (!response.ok) {
          return null;
        }

        const data = await response.json();
        const work = data.message;

        return this.mapWorkToSearchResult(work);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const isTimeout = err.name === 'AbortError' || 
          err.message.includes('timeout') ||
          err.message.includes('CONNECT_TIMEOUT') ||
          err.message.includes('fetch failed');
        
        if (attempt < maxRetries - 1 && isTimeout) {
          const backoffMs = Math.min(2000 * Math.pow(2, attempt), 10000);
          console.warn(`CrossRef identifier lookup attempt ${attempt + 1} failed (timeout), retrying in ${backoffMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        } else {
          console.error('CrossRef identifier lookup failed:', error);
          return null;
        }
      }
    }
    return null;
  }

  getRateLimit() {
    return { requests: 50, period: 1 }; // 50 requests per second (polite pool)
  }

  private mapWorkToSearchResult(work: any): SearchResult {
    return {
      id: `cr_${work.DOI || work.URL || crypto.randomUUID()}`,
      title: work.title?.[0] || '',
      authors: (work.author || []).map((author: any) => `${author.family || ''}, ${author.given || ''}`.trim()),
      year: work.issued?.['date-parts']?.[0]?.[0],
      venue: work['container-title']?.[0] || work.publisher,
      volume: normalizeOptionalString(work.volume),
      issue: normalizeOptionalString(work.issue),
      pages: parseCrossRefPages(work),
      publisher: normalizeOptionalString(work.publisher),
      isbn: parseCrossRefIsbn(work),
      edition: firstDefinedString(work['edition-number'], work.edition),
      editors: parseCrossRefEditors(work),
      publicationPlace: firstDefinedString(
        work['publisher-location'],
        work.publisherLocation
      ),
      publicationDate: firstDefinedString(
        parseDateParts(work['published-print']),
        parseDateParts(work['published-online']),
        parseDateParts(work.issued),
        normalizeOptionalString(work.created?.['date-time'])
      ),
      articleNumber: firstDefinedString(work['article-number'], work.articleNumber),
      issn: parseCrossRefIssn(work),
      journalAbbreviation: firstDefinedString(
        Array.isArray(work['short-container-title']) ? work['short-container-title'][0] : undefined,
        work.abbreviated_title
      ),
      abstract: work.abstract,
      doi: normalizeOptionalString(work.DOI),
      url: work.URL,
      citationCount: work['is-referenced-by-count'],
      source: 'crossref',
      pdfUrl: Array.isArray(work.link)
        ? work.link.find((link: any) =>
            typeof link?.URL === 'string' &&
            (
              String(link['content-type'] || '').toLowerCase().includes('pdf') ||
              String(link['content_type'] || '').toLowerCase().includes('pdf')
            )
          )?.URL
        : undefined,
      rawData: work
    };
  }
}

class OpenAlexProvider implements SearchProvider {
  name = 'openalex';
  private readonly FETCH_TIMEOUT_MS = 30000; // 30 second timeout

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT_MS);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    try {
      const params = new URLSearchParams({
        search: query,
        per_page: (options.limit || 20).toString(),
        'sort': 'relevance_score:desc'
      });

      // Build filter string for OpenAlex
      const filters: string[] = [];

      // OpenAlex supports >, <, !, and range (YYYY-YYYY) operators — NOT >= or <=
      const validYearFrom = options.yearFrom && Number.isFinite(options.yearFrom) ? options.yearFrom : null;
      const validYearTo = options.yearTo && Number.isFinite(options.yearTo) ? options.yearTo : null;
      if (validYearFrom && validYearTo) {
        // Use inclusive range syntax: publication_year:2020-2024
        filters.push(`publication_year:${validYearFrom}-${validYearTo}`);
      } else if (validYearFrom) {
        // "greater than (yearFrom - 1)" is equivalent to ">= yearFrom" for integers
        filters.push(`publication_year:>${validYearFrom - 1}`);
      } else if (validYearTo) {
        // "less than (yearTo + 1)" is equivalent to "<= yearTo" for integers
        filters.push(`publication_year:<${validYearTo + 1}`);
      }

      // Publication type filter
      if (options.publicationTypes && options.publicationTypes.length > 0) {
        const oaTypes = options.publicationTypes.map(t => {
          const typeMap: Record<string, string> = {
            'journal-article': 'article',
            'conference-paper': 'proceedings-article',
            'book-chapter': 'book-chapter',
            'book': 'book',
            'preprint': 'preprint',
            'review': 'review',
            'thesis': 'dissertation',
            'dataset': 'dataset'
          };
          return typeMap[t] || null;
        }).filter(Boolean);
        
        if (oaTypes.length > 0) {
          filters.push(`type:${oaTypes.join('|')}`);
        }
      }

      // Open access filter
      if (options.openAccessOnly) {
        filters.push('is_oa:true');
      }

      // Minimum citations filter
      if (options.minCitations && options.minCitations > 0) {
        filters.push(`cited_by_count:>=${options.minCitations}`);
      }

      // Has abstract filter
      if (options.hasAbstract) {
        filters.push('has_abstract:true');
      }

      // Fields of study filter (OpenAlex uses concepts)
      if (options.fieldsOfStudy && options.fieldsOfStudy.length > 0) {
        // OpenAlex uses concept IDs, but we can search by display_name
        const fieldNames = options.fieldsOfStudy.map(f => {
          const fieldMap: Record<string, string> = {
            'computer-science': 'Computer science',
            'medicine': 'Medicine',
            'biology': 'Biology',
            'physics': 'Physics',
            'chemistry': 'Chemistry',
            'mathematics': 'Mathematics',
            'engineering': 'Engineering',
            'economics': 'Economics',
            'psychology': 'Psychology',
            'sociology': 'Sociology',
            'environmental-science': 'Environmental science',
            'materials-science': 'Materials science'
          };
          return fieldMap[f] || null;
        }).filter(Boolean);
        
        // Note: OpenAlex concept filtering requires concept IDs which we don't have
        // For now, we'll add concepts to the search query instead
        if (fieldNames.length > 0) {
          params.set('search', `${query} ${fieldNames.join(' ')}`);
        }
      }

      // Apply filters
      if (filters.length > 0) {
        params.set('filter', filters.join(','));
      }

      const url = `https://api.openalex.org/works?${params}`;
      const response = await this.fetchWithTimeout(url, {
        headers: {
          'User-Agent': 'Research-Paper-Writing-App/1.0 (mailto:support@papsi.com)'
        }
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unable to read error body');
        console.error(`[OpenAlex] API error ${response.status}:`, errorBody.substring(0, 500));
        throw new Error(`OpenAlex API error: ${response.status}`);
      }

      const data = await response.json();

      return (data.results || []).map((work: any) => this.mapWorkToSearchResult(work));
    } catch (error) {
      console.error('OpenAlex search failed:', error);
      return [];
    }
  }

  private mapPublicationType(type: string | undefined): PublicationType | undefined {
    if (!type) return undefined;
    
    const typeMap: Record<string, PublicationType> = {
      'article': 'journal-article',
      'proceedings-article': 'conference-paper',
      'book-chapter': 'book-chapter',
      'book': 'book',
      'preprint': 'preprint',
      'review': 'review',
      'dissertation': 'thesis',
      'dataset': 'dataset'
    };

    return typeMap[type] || 'other';
  }

  async getByIdentifier(identifier: string): Promise<SearchResult | null> {
    try {
      // Try DOI lookup
      const doiParam = identifier.startsWith('10.') ? identifier : `https://doi.org/${identifier}`;
      const response = await this.fetchWithTimeout(`https://api.openalex.org/works/doi:${doiParam}`, {
        headers: {
          'User-Agent': 'Research-Paper-Writing-App/1.0'
        }
      });

      if (!response.ok) {
        return null;
      }

      const work = await response.json();

      return this.mapWorkToSearchResult(work);
    } catch (error) {
      console.error('OpenAlex identifier lookup failed:', error);
      return null;
    }
  }

  getRateLimit() {
    return { requests: 100000, period: 1 }; // Unlimited (be reasonable)
  }

  private mapWorkToSearchResult(work: any): SearchResult {
    const volume = firstDefinedString(work.biblio?.volume, work.volume);
    const issue = firstDefinedString(work.biblio?.issue, work.issue);
    const pages = firstDefinedString(
      buildPageRange(work.biblio?.first_page, work.biblio?.last_page),
      buildPageRange(work.first_page, work.last_page),
      work.page
    );

    return {
      id: `oa_${work.id?.replace('https://openalex.org/', '') || crypto.randomUUID()}`,
      title: work.title || '',
      authors: (work.authorships || []).map((auth: any) => auth.author?.display_name || ''),
      year: work.publication_year,
      venue: work.primary_location?.source?.display_name || work.host_venue_name,
      volume,
      issue,
      pages,
      publisher: firstDefinedString(
        work.primary_location?.source?.host_organization_name,
        work.host_venue?.publisher,
        work.publisher
      ),
      isbn: firstDefinedString(work.isbn, Array.isArray(work.ISBN) ? work.ISBN[0] : undefined),
      edition: normalizeOptionalString(work.edition),
      publicationPlace: firstDefinedString(
        work.primary_location?.source?.country_code,
        work.host_venue?.country_code
      ),
      publicationDate: firstDefinedString(
        work.publication_date,
        work.publication_year
      ),
      articleNumber: firstDefinedString(
        work.biblio?.article_number,
        work.article_number
      ),
      issn: firstDefinedString(
        work.primary_location?.source?.issn_l,
        Array.isArray(work.primary_location?.source?.issn) ? work.primary_location.source.issn[0] : undefined
      ),
      journalAbbreviation: firstDefinedString(
        work.primary_location?.source?.abbreviated_title,
        work.primary_location?.source?.display_name
      ),
      abstract: work.abstract_inverted_index ? this.reconstructAbstract(work.abstract_inverted_index) : undefined,
      doi: work.doi?.replace('https://doi.org/', ''),
      url: work.primary_location?.landing_page_url || work.doi,
      citationCount: work.cited_by_count,
      source: 'openalex',
      publicationType: this.mapPublicationType(work.type),
      isOpenAccess: work.is_oa,
      pdfUrl: work.primary_location?.pdf_url || work.best_oa_location?.pdf_url || undefined,
      fieldsOfStudy: (work.concepts || []).slice(0, 5).map((c: any) => c.display_name),
      rawData: work
    };
  }

  private reconstructAbstract(invertedIndex: Record<string, number[]>): string {
    const words: string[] = [];
    const positions = Object.entries(invertedIndex);

    positions.sort((a, b) => a[1][0] - b[1][0]);

    for (const [word, pos] of positions) {
      for (const position of pos) {
        if (words[position] === undefined) {
          words[position] = word;
        }
      }
    }

    return words.join(' ');
  }
}

// ============================================================================
// PUBMED/NCBI PROVIDER (Biomedical literature - free, no API key required)
// ============================================================================

class PubMedProvider implements SearchProvider {
  name = 'pubmed';
  private lastRequestTime = 0;
  private readonly MIN_REQUEST_INTERVAL_MS = 350; // NCBI allows ~3 req/sec without key
  private readonly FETCH_TIMEOUT_MS = 30000;

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT_MS);
    
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    // Rate limiting
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL_MS) {
      await new Promise(resolve => setTimeout(resolve, this.MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest));
    }

    try {
      // Build enhanced query with filters
      let enhancedQuery = query;
      
      // Publication type filter using PubMed syntax
      if (options.publicationTypes && options.publicationTypes.length > 0) {
        const pubTypeFilters = options.publicationTypes.map(t => {
          const typeMap: Record<string, string> = {
            'journal-article': 'Journal Article[pt]',
            'conference-paper': 'Congress[pt]',
            'book-chapter': 'Book Chapter[pt]',
            'book': 'Book[pt]',
            'review': 'Review[pt]',
            'thesis': 'Thesis[pt]'
          };
          return typeMap[t] || null;
        }).filter(Boolean);
        
        if (pubTypeFilters.length > 0) {
          enhancedQuery = `(${query}) AND (${pubTypeFilters.join(' OR ')})`;
        }
      }

      // Open access filter
      if (options.openAccessOnly) {
        enhancedQuery = `(${enhancedQuery}) AND free full text[filter]`;
      }

      // Has abstract filter
      if (options.hasAbstract) {
        enhancedQuery = `(${enhancedQuery}) AND hasabstract[text]`;
      }

      // Field of study filter (using MeSH terms for common fields)
      if (options.fieldsOfStudy && options.fieldsOfStudy.length > 0) {
        const meshTerms = options.fieldsOfStudy.map(f => {
          const fieldMap: Record<string, string> = {
            'medicine': 'Medicine[MeSH]',
            'biology': 'Biology[MeSH]',
            'chemistry': 'Chemistry[MeSH]',
            'physics': 'Physics[MeSH]',
            'psychology': 'Psychology[MeSH]',
            'computer-science': 'Computer Science[MeSH]',
            'engineering': 'Biomedical Engineering[MeSH]',
            'environmental-science': 'Environmental Health[MeSH]'
          };
          return fieldMap[f] || null;
        }).filter(Boolean);
        
        if (meshTerms.length > 0) {
          enhancedQuery = `(${enhancedQuery}) AND (${meshTerms.join(' OR ')})`;
        }
      }

      // Build search URL with optional API key for higher rate limits
      const apiKey = process.env.NCBI_API_KEY;
      const baseParams = new URLSearchParams({
        db: 'pubmed',
        term: enhancedQuery,
        retmax: (options.limit || 20).toString(),
        retmode: 'json',
        usehistory: 'n'
      });

      if (apiKey) {
        baseParams.set('api_key', apiKey);
      }

      // Add date filters if provided
      if (options.yearFrom || options.yearTo) {
        const minDate = options.yearFrom ? `${options.yearFrom}/01/01` : '1900/01/01';
        const maxDate = options.yearTo ? `${options.yearTo}/12/31` : '3000/12/31';
        baseParams.set('mindate', minDate);
        baseParams.set('maxdate', maxDate);
        baseParams.set('datetype', 'pdat'); // Publication date
      }

      this.lastRequestTime = Date.now();

      // Step 1: Search for PMIDs
      const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${baseParams}`;
      const searchResponse = await this.fetchWithTimeout(searchUrl);

      if (!searchResponse.ok) {
        throw new Error(`PubMed search error: ${searchResponse.status}`);
      }

      const searchData = await searchResponse.json();
      const pmids: string[] = searchData.esearchresult?.idlist || [];

      if (pmids.length === 0) {
        return [];
      }

      // Step 2: Fetch details for PMIDs
      const fetchParams = new URLSearchParams({
        db: 'pubmed',
        id: pmids.join(','),
        retmode: 'xml',
        rettype: 'abstract'
      });

      if (apiKey) {
        fetchParams.set('api_key', apiKey);
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100));
      this.lastRequestTime = Date.now();

      const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${fetchParams}`;
      const fetchResponse = await this.fetchWithTimeout(fetchUrl);

      if (!fetchResponse.ok) {
        throw new Error(`PubMed fetch error: ${fetchResponse.status}`);
      }

      const xmlText = await fetchResponse.text();
      return this.parseXMLResponse(xmlText);

    } catch (error) {
      console.error('PubMed search failed:', error);
      return [];
    }
  }

  private parseXMLResponse(xml: string): SearchResult[] {
    const results: SearchResult[] = [];

    // Simple XML parsing for PubMed articles
    const articleMatches = Array.from(xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g));

    for (const match of articleMatches) {
      try {
        const articleXml = match[1];

        // Extract PMID
        const pmidMatch = articleXml.match(/<PMID[^>]*>(\d+)<\/PMID>/);
        const pmid = pmidMatch ? pmidMatch[1] : null;

        // Extract title
        const titleMatch = articleXml.match(/<ArticleTitle>([^<]+)<\/ArticleTitle>/);
        const title = titleMatch ? this.decodeXmlEntities(titleMatch[1]) : '';

        // Extract abstract
        const abstractMatch = articleXml.match(/<AbstractText[^>]*>([^<]+)<\/AbstractText>/g);
        const abstract = abstractMatch 
          ? abstractMatch.map(m => this.decodeXmlEntities(m.replace(/<[^>]+>/g, ''))).join(' ')
          : undefined;

        // Extract authors
        const authorMatches = Array.from(
          articleXml.matchAll(/<Author[^>]*>[\s\S]*?<LastName>([^<]+)<\/LastName>[\s\S]*?(?:<ForeName>([^<]+)<\/ForeName>)?[\s\S]*?<\/Author>/g)
        );
        const authors: string[] = [];
        for (const authorMatch of authorMatches) {
          const lastName = authorMatch[1];
          const foreName = authorMatch[2] || '';
          authors.push(`${foreName} ${lastName}`.trim());
        }

        // Extract year
        const yearMatch = articleXml.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/);
        const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;
        const monthMatch = articleXml.match(/<PubDate>[\s\S]*?<Month>([^<]+)<\/Month>/);
        const dayMatch = articleXml.match(/<PubDate>[\s\S]*?<Day>(\d{1,2})<\/Day>/);
        const publicationDate = this.buildPublicationDate(year, monthMatch?.[1], dayMatch?.[1]);

        // Extract journal
        const journalMatch = articleXml.match(/<Title>([^<]+)<\/Title>/);
        const venue = journalMatch ? this.decodeXmlEntities(journalMatch[1]) : undefined;
        const isoAbbrevMatch = articleXml.match(/<ISOAbbreviation>([^<]+)<\/ISOAbbreviation>/);
        const issnMatch = articleXml.match(/<ISSN[^>]*>([^<]+)<\/ISSN>/);
        const volumeMatch = articleXml.match(/<Volume>([^<]+)<\/Volume>/);
        const issueMatch = articleXml.match(/<Issue>([^<]+)<\/Issue>/);
        const medlinePageMatch = articleXml.match(/<MedlinePgn>([^<]+)<\/MedlinePgn>/);
        const startPageMatch = articleXml.match(/<StartPage>([^<]+)<\/StartPage>/);
        const endPageMatch = articleXml.match(/<EndPage>([^<]+)<\/EndPage>/);
        const articleNumberMatch = articleXml.match(/<ELocationID[^>]*EIdType=\"(?:pii|eid)\"[^>]*>([^<]+)<\/ELocationID>/i);
        const pages = firstDefinedString(
          medlinePageMatch ? this.decodeXmlEntities(medlinePageMatch[1]) : undefined,
          buildPageRange(
            startPageMatch ? this.decodeXmlEntities(startPageMatch[1]) : undefined,
            endPageMatch ? this.decodeXmlEntities(endPageMatch[1]) : undefined
          )
        );

        // Extract DOI
        const doiMatch = articleXml.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/);
        const doi = doiMatch ? doiMatch[1] : undefined;
        const pmcidMatch = articleXml.match(/<ArticleId IdType="pmc">([^<]+)<\/ArticleId>/);

        if (pmid && title) {
          results.push({
            id: `pm_${pmid}`,
            title,
            authors,
            year,
            venue,
            volume: volumeMatch ? this.decodeXmlEntities(volumeMatch[1]) : undefined,
            issue: issueMatch ? this.decodeXmlEntities(issueMatch[1]) : undefined,
            pages,
            publicationDate,
            articleNumber: articleNumberMatch ? this.decodeXmlEntities(articleNumberMatch[1]) : undefined,
            issn: issnMatch ? this.decodeXmlEntities(issnMatch[1]) : undefined,
            journalAbbreviation: isoAbbrevMatch ? this.decodeXmlEntities(isoAbbrevMatch[1]) : undefined,
            pmid,
            pmcid: pmcidMatch ? this.decodeXmlEntities(pmcidMatch[1]) : undefined,
            abstract,
            doi,
            url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
            source: 'pubmed',
            pdfUrl: pmcidMatch
              ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${this.decodeXmlEntities(pmcidMatch[1])}/pdf/`
              : undefined,
            rawData: { pmid }
          });
        }
      } catch (err) {
        console.warn('Failed to parse PubMed article:', err);
      }
    }

    return results;
  }

  private buildPublicationDate(
    year?: number,
    monthRaw?: string,
    dayRaw?: string
  ): string | undefined {
    if (!year) return undefined;

    const monthLookup: Record<string, string> = {
      jan: '01', january: '01',
      feb: '02', february: '02',
      mar: '03', march: '03',
      apr: '04', april: '04',
      may: '05',
      jun: '06', june: '06',
      jul: '07', july: '07',
      aug: '08', august: '08',
      sep: '09', sept: '09', september: '09',
      oct: '10', october: '10',
      nov: '11', november: '11',
      dec: '12', december: '12'
    };

    const monthToken = (monthRaw || '').trim().toLowerCase();
    const monthNumeric = monthLookup[monthToken] || (() => {
      const numeric = Number(monthToken);
      if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 12) {
        return String(numeric).padStart(2, '0');
      }
      return '';
    })();

    if (!monthNumeric) {
      return String(year);
    }

    const dayNumeric = Number((dayRaw || '').trim());
    if (Number.isFinite(dayNumeric) && dayNumeric >= 1 && dayNumeric <= 31) {
      return `${year}-${monthNumeric}-${String(dayNumeric).padStart(2, '0')}`;
    }

    return `${year}-${monthNumeric}`;
  }

  private decodeXmlEntities(text: string): string {
    return text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  async getByIdentifier(identifier: string): Promise<SearchResult | null> {
    try {
      // Handle PMID or DOI
      let pmid = identifier;
      
      if (identifier.startsWith('10.')) {
        // Search by DOI to get PMID
        const searchResults = await this.search(`${identifier}[doi]`, { limit: 1 });
        return searchResults[0] || null;
      }

      // Direct PMID lookup
      const results = await this.search(`${pmid}[pmid]`, { limit: 1 });
      return results[0] || null;
    } catch (error) {
      console.error('PubMed identifier lookup failed:', error);
      return null;
    }
  }

  getRateLimit() {
    // With API key: 10 req/sec, without: 3 req/sec
    const hasKey = !!process.env.NCBI_API_KEY;
    return { requests: hasKey ? 10 : 3, period: 1 };
  }
}

// ============================================================================
// ARXIV PROVIDER (Preprints - free, no API key required)
// ============================================================================

class ArXivProvider implements SearchProvider {
  name = 'arxiv';
  private lastRequestTime = 0;
  private readonly MIN_REQUEST_INTERVAL_MS = 3000; // arXiv asks for 3 second delay
  private readonly FETCH_TIMEOUT_MS = 30000;

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT_MS);
    
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    // Rate limiting - arXiv asks for 3 second delay between requests
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL_MS) {
      await new Promise(resolve => setTimeout(resolve, this.MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest));
    }

    try {
      // Build arXiv API query
      // arXiv uses a specific query syntax
      let searchQuery = `all:${encodeURIComponent(query)}`;

      // Add category filter for fields of study
      if (options.fieldsOfStudy && options.fieldsOfStudy.length > 0) {
        const arxivCategories = options.fieldsOfStudy.map(f => {
          const categoryMap: Record<string, string[]> = {
            'computer-science': ['cs.AI', 'cs.LG', 'cs.CL', 'cs.CV', 'cs.NE', 'cs.SE', 'cs.DB', 'cs.IR'],
            'physics': ['physics', 'quant-ph', 'hep-th', 'hep-ph', 'cond-mat', 'astro-ph'],
            'mathematics': ['math'],
            'biology': ['q-bio'],
            'economics': ['econ', 'q-fin'],
            'engineering': ['eess']
          };
          return categoryMap[f] || [];
        }).flat();
        
        if (arxivCategories.length > 0) {
          // Combine with OR for categories
          const catQuery = arxivCategories.map(c => `cat:${c}*`).join('+OR+');
          searchQuery = `(${searchQuery})+AND+(${catQuery})`;
        }
      }

      const params = new URLSearchParams({
        search_query: searchQuery,
        start: '0',
        max_results: (options.limit || 20).toString(),
        sortBy: 'relevance',
        sortOrder: 'descending'
      });

      this.lastRequestTime = Date.now();

      const url = `https://export.arxiv.org/api/query?${params}`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`arXiv API error: ${response.status}`);
      }

      const xmlText = await response.text();
      return this.parseAtomResponse(xmlText, options);

    } catch (error) {
      console.error('arXiv search failed:', error);
      return [];
    }
  }

  private parseAtomResponse(xml: string, options: SearchOptions): SearchResult[] {
    const results: SearchResult[] = [];

    // Parse Atom feed entries
    const entryMatches = Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g));

    for (const match of entryMatches) {
      try {
        const entryXml = match[1];

        // Extract ID (arXiv identifier)
        const idMatch = entryXml.match(/<id>([^<]+)<\/id>/);
        const fullId = idMatch ? idMatch[1] : null;
        const arxivId = fullId?.replace('http://arxiv.org/abs/', '') || null;

        // Extract title
        const titleMatch = entryXml.match(/<title>([^<]+)<\/title>/);
        const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

        // Extract abstract (summary)
        const summaryMatch = entryXml.match(/<summary>([^<]+)<\/summary>/);
        const abstract = summaryMatch ? summaryMatch[1].replace(/\s+/g, ' ').trim() : undefined;

        // Extract authors
        const authorMatches = Array.from(entryXml.matchAll(/<author>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/author>/g));
        const authors: string[] = [];
        for (const authorMatch of authorMatches) {
          authors.push(authorMatch[1].trim());
        }

        // Extract published date
        const publishedMatch = entryXml.match(/<published>(\d{4})-\d{2}-\d{2}<\/published>/);
        const year = publishedMatch ? parseInt(publishedMatch[1], 10) : undefined;
        const publishedDateMatch = entryXml.match(/<published>([^<]+)<\/published>/);

        // Filter by year if specified
        if (options.yearFrom && year && year < options.yearFrom) continue;
        if (options.yearTo && year && year > options.yearTo) continue;

        // Extract DOI if available
        const doiMatch = entryXml.match(/<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/);
        const doi = doiMatch ? doiMatch[1] : undefined;

        // Extract categories for venue
        const categoryMatches = Array.from(entryXml.matchAll(/<category[^>]*term="([^"]+)"/g));
        const categories: string[] = [];
        for (const catMatch of categoryMatches) {
          categories.push(catMatch[1]);
        }
        const venue = categories.length > 0 ? `arXiv:${categories[0]}` : 'arXiv';

        // Extract PDF link
        const pdfMatch = entryXml.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/);
        const pdfUrl = pdfMatch ? pdfMatch[1] : undefined;

        if (arxivId && title) {
          results.push({
            id: `arxiv_${arxivId.replace(/[/.]/g, '_')}`,
            title,
            authors,
            year,
            venue,
            publicationDate: publishedDateMatch ? publishedDateMatch[1] : undefined,
            abstract,
            doi,
            url: `https://arxiv.org/abs/${arxivId}`,
            arxivId,
            source: 'arxiv',
            pdfUrl: pdfUrl || (arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : undefined),
            rawData: { arxivId, pdfUrl, categories }
          });
        }
      } catch (err) {
        console.warn('Failed to parse arXiv entry:', err);
      }
    }

    return results;
  }

  async getByIdentifier(identifier: string): Promise<SearchResult | null> {
    try {
      // Handle arXiv ID or DOI
      let arxivId = identifier;

      // Clean up arXiv ID if needed
      arxivId = arxivId.replace('arXiv:', '').replace('arxiv:', '');

      if (identifier.startsWith('10.')) {
        // Search by DOI
        const results = await this.search(`doi:${identifier}`, { limit: 1 });
        return results[0] || null;
      }

      // Direct arXiv ID lookup
      const params = new URLSearchParams({
        id_list: arxivId,
        max_results: '1'
      });

      const url = `https://export.arxiv.org/api/query?${params}`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        return null;
      }

      const xmlText = await response.text();
      const results = this.parseAtomResponse(xmlText, {});
      return results[0] || null;
    } catch (error) {
      console.error('arXiv identifier lookup failed:', error);
      return null;
    }
  }

  getRateLimit() {
    return { requests: 1, period: 3 }; // 1 request per 3 seconds (arXiv policy)
  }
}

// ============================================================================
// CORE PROVIDER (Open Access research - API key recommended for better limits)
// ============================================================================

class COREProvider implements SearchProvider {
  name = 'core';
  private lastRequestTime = 0;
  private readonly MIN_REQUEST_INTERVAL_MS = 1000;
  private readonly FETCH_TIMEOUT_MS = 30000;

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'Research-Paper-Writing-App/1.0',
      'Content-Type': 'application/json'
    };

    // Add API key if configured
    const apiKey = process.env.CORE_API_KEY;
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    return headers;
  }

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT_MS);
    
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const apiKey = process.env.CORE_API_KEY;

    // CORE requires API key for search
    if (!apiKey) {
      console.warn('CORE API key not configured (set CORE_API_KEY), skipping CORE search');
      return [];
    }

    // Rate limiting
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL_MS) {
      await new Promise(resolve => setTimeout(resolve, this.MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest));
    }

    try {
      this.lastRequestTime = Date.now();

      // Build request body for CORE API v3
      // CORE v3 search accepts q (query string) and limit/offset
      // Year filtering uses the query syntax: yearPublished>=YYYY
      const sanitizedQuery = query.replace(/[^\w\s\-"'.,:;()]/g, ' ').trim();
      let searchQuery = sanitizedQuery;

      // Add year filters using CORE query syntax
      if (options.yearFrom || options.yearTo) {
        const yearParts: string[] = [];
        if (options.yearFrom && Number.isFinite(options.yearFrom)) {
          yearParts.push(`yearPublished>=${options.yearFrom}`);
        }
        if (options.yearTo && Number.isFinite(options.yearTo)) {
          yearParts.push(`yearPublished<=${options.yearTo}`);
        }
        if (yearParts.length > 0) {
          searchQuery = `(${sanitizedQuery}) AND ${yearParts.join(' AND ')}`;
        }
      }

      const requestBody: any = {
        q: searchQuery,
        limit: Math.min(options.limit || 20, 100),
        offset: 0
      };

      const response = await this.fetchWithTimeout('https://api.core.ac.uk/v3/search/works', {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        if (response.status === 401) {
          console.warn('CORE API key invalid or expired');
          return [];
        }
        // Log error details for debugging but don't crash — return empty
        const errorBody = await response.text().catch(() => 'Unable to read error body');
        console.error(`CORE API error ${response.status}: ${errorBody.substring(0, 300)}`);
        return [];
      }

      const data = await response.json();
      const results: SearchResult[] = [];

      for (const work of (data.results || [])) {
        try {
          results.push({
            id: `core_${work.id || crypto.randomUUID()}`,
            title: work.title || '',
            authors: (work.authors || []).map((a: any) => a.name || '').filter(Boolean),
            year: work.yearPublished,
            venue: work.publisher || work.journals?.[0]?.title,
            volume: firstDefinedString(work.volume, work.journals?.[0]?.volume),
            issue: firstDefinedString(work.issue, work.journals?.[0]?.issue),
            pages: firstDefinedString(
              work.page,
              work.pages,
              buildPageRange(work.firstPage, work.lastPage)
            ),
            publisher: normalizeOptionalString(work.publisher),
            isbn: firstDefinedString(
              Array.isArray(work.identifiers?.isbn) ? work.identifiers.isbn[0] : undefined,
              work.isbn
            ),
            edition: normalizeOptionalString(work.edition),
            editors: Array.isArray(work.contributors)
              ? work.contributors
                  .filter((contributor: any) => /editor/i.test(String(contributor?.role || '')))
                  .map((contributor: any) => normalizeOptionalString(contributor?.name))
                  .filter((name: string | undefined): name is string => Boolean(name))
              : undefined,
            publicationPlace: firstDefinedString(work.publisherLocation, work.placePublished),
            publicationDate: firstDefinedString(work.datePublished, work.yearPublished),
            articleNumber: firstDefinedString(work.articleNumber, work.identifier),
            issn: firstDefinedString(
              Array.isArray(work.identifiers?.issn) ? work.identifiers.issn[0] : undefined,
              work.issn,
              work.journals?.[0]?.issn
            ),
            journalAbbreviation: firstDefinedString(work.journals?.[0]?.abbreviatedTitle, work.journals?.[0]?.title),
            abstract: work.abstract,
            doi: work.doi,
            url: work.downloadUrl || work.sourceFulltextUrls?.[0] || (work.doi ? `https://doi.org/${work.doi}` : undefined),
            citationCount: work.citationCount,
            source: 'core',
            pdfUrl: work.downloadUrl || work.sourceFulltextUrls?.[0] || undefined,
            rawData: work
          });
        } catch (err) {
          console.warn('Failed to parse CORE result:', err);
        }
      }

      return results;

    } catch (error) {
      console.error('CORE search failed:', error);
      return [];
    }
  }

  async getByIdentifier(identifier: string): Promise<SearchResult | null> {
    const apiKey = process.env.CORE_API_KEY;

    if (!apiKey) {
      return null;
    }

    try {
      // Search by DOI
      const results = await this.search(`doi:"${identifier}"`, { limit: 1 });
      return results[0] || null;
    } catch (error) {
      console.error('CORE identifier lookup failed:', error);
      return null;
    }
  }

  getRateLimit() {
    // CORE: 10 requests/second with API key
    return { requests: 10, period: 1 };
  }
}

// Export singleton instance
export const literatureSearchService = new LiteratureSearchService();

// Export class for testing
export { LiteratureSearchService };
