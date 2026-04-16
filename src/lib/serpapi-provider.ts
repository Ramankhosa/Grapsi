import { z } from 'zod';

// SerpAPI response schemas based on documentation
const SerpApiPatentResultSchema = z.object({
  position: z.number().optional(),
  title: z.string(),
  link: z.string().optional(),
  snippet: z.string().optional(),
  publication_number: z.string(),
  patent_id: z.string(),
  assignee: z.string().optional(),
  inventor: z.string().optional(),
  priority_date: z.string().optional(),
  filing_date: z.string().optional(),
  publication_date: z.string().optional(),
  grant_date: z.string().optional(),
  pdf: z.string().optional(),
});

const SerpApiScholarResultSchema = z.object({
  position: z.number().optional(),
  title: z.string(),
  result_id: z.string().optional(),
  link: z.string().optional(),
  snippet: z.string().optional(),
  publication_info: z.object({
    summary: z.string().optional(),
  }).optional(),
  authors: z.string().optional(),
  publication: z.string().optional(),
  cited_by: z.object({
    total: z.number().optional(),
    value: z.union([z.string(), z.number()]).optional(),
    link: z.string().optional(),
    cites_id: z.string().optional(),
    serpapi_scholar_link: z.string().optional(),
  }).optional(),
  inline_links: z.object({
    serpapi_cite_link: z.string().optional(),
    cited_by: z.object({
      total: z.number().optional(),
      link: z.string().optional(),
      cites_id: z.string().optional(),
      serpapi_scholar_link: z.string().optional(),
    }).optional(),
    related_pages_link: z.string().optional(),
    serpapi_related_pages_link: z.string().optional(),
    versions: z.object({
      total: z.number().optional(),
      link: z.string().optional(),
      cluster_id: z.string().optional(),
      serpapi_scholar_link: z.string().optional(),
    }).optional(),
  }).optional(),
  year: z.string().optional(),
  pdf_link: z.string().optional(),
  doi: z.string().optional(),
});

// Union schema that accepts either patent or scholar results
const SerpApiSearchResultSchema = z.union([SerpApiPatentResultSchema, SerpApiScholarResultSchema]);

const SerpApiSearchResponseSchema = z.object({
  search_metadata: z.object({
    id: z.string(),
    status: z.string(),
    created_at: z.string(),
    processed_at: z.string(),
  }),
  search_parameters: z.object({
    engine: z.string(),
    q: z.string(),
    num: z.union([z.number(), z.string()]).optional(),
    start: z.union([z.number(), z.string()]).optional(),
  }),
  organic_results: z.array(SerpApiSearchResultSchema).optional(),
  error: z.string().optional(),
});

const SerpApiDetailsResponseSchema = z.object({
  search_metadata: z.object({
    id: z.string(),
    status: z.string(),
    created_at: z.string(),
    processed_at: z.string(),
  }).optional(),
  search_parameters: z.object({
    engine: z.string(),
    patent_id: z.string(),
  }).passthrough().optional(), // Allow additional fields
  // Details response has many fields, we'll store as JSON
  title: z.string().optional(),
  abstract: z.string().optional(),
  claims: z.any().optional(),
  description: z.string().optional(),
  classifications: z.any().optional(),
  publication_date: z.string().optional(),
  priority_date: z.string().optional(),
  worldwide_applications: z.any().optional(),
  events: z.any().optional(),
  patent_citations: z.any().optional(),
  non_patent_citations: z.any().optional(),
  pdf: z.string().optional(),
  error: z.string().optional(),
});

export type SerpApiSearchResult = z.infer<typeof SerpApiSearchResultSchema>;
export type SerpApiSearchResponse = z.infer<typeof SerpApiSearchResponseSchema>;
export type SerpApiDetailsResponse = z.infer<typeof SerpApiDetailsResponseSchema>;

export class SerpApiProvider {
  private apiKey: string;
  private baseUrl = 'https://serpapi.com/search';
  private lastCallTimestamps: Map<string, number> = new Map();
  private rateLimitMs: number;

  constructor() {
    this.apiKey = process.env.Serp_API_KEY || '';
    if (!this.apiKey) {
      console.warn('⚠️ Serp_API_KEY environment variable is not set. API calls will fail.');
      console.warn('Please set Serp_API_KEY in your .env file.');
    }

    // Get rate limit from environment, default to 5 seconds for free tier
    this.rateLimitMs = (parseInt(process.env.SERP_RATE || '5') || 5) * 1000;
  }

  /**
   * Execute search with configurable engine (patents or scholar)
   */
  async search(params: {
    q: string;
    engine?: 'google_patents' | 'google_scholar';
    num?: number;
    start?: number;
    hl?: string;
  }): Promise<SerpApiSearchResponse> {
    // Check if API key is available
    if (!this.apiKey) {
      console.warn(`⚠️ Skipping ${params.engine} search - no API key: "${params.q}"`);
      return {
        search_metadata: {
          id: 'mock-' + Date.now(),
          status: 'success',
          created_at: new Date().toISOString(),
          processed_at: new Date().toISOString(),
        },
        search_parameters: {
          engine: params.engine || 'google_patents',
          q: params.q,
          num: params.num,
          start: params.start,
        },
        organic_results: [],
      };
    }

    await this.enforceRateLimit(params.engine || 'google_patents');

    const queryParams = new URLSearchParams({
      engine: params.engine || 'google_patents',
      q: params.q,
      api_key: this.apiKey,
      hl: params.hl || 'en',
      no_cache: 'false',
      ...(params.num && { num: params.num.toString() }),
      ...(params.start && { start: params.start.toString() }),
    });

    try {
      const response = await fetch(`${this.baseUrl}?${queryParams}`);
      const data = await response.json();

      if (!response.ok) {
        console.error(`❌ SerpAPI search failed: ${response.status} ${data.error || 'Unknown error'}`);
        return {
          search_metadata: {
            id: 'error-' + Date.now(),
            status: 'error',
            created_at: new Date().toISOString(),
            processed_at: new Date().toISOString(),
          },
          search_parameters: {
            engine: params.engine || 'google_patents',
            q: params.q,
            num: params.num,
            start: params.start,
          },
          organic_results: [],
          error: data.error || 'API request failed',
        };
      }

      return SerpApiSearchResponseSchema.parse(data);
    } catch (error) {
      console.error(`❌ SerpAPI search error:`, error);
      return {
        search_metadata: {
          id: 'catch-' + Date.now(),
          status: 'error',
          created_at: new Date().toISOString(),
          processed_at: new Date().toISOString(),
        },
        search_parameters: {
          engine: params.engine || 'google_patents',
          q: params.q,
          num: params.num,
          start: params.start,
        },
        organic_results: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute patent search with rate limiting
   */
  async searchPatents(params: {
    q: string;
    num?: number;
    start?: number;
    hl?: string;
  }): Promise<SerpApiSearchResponse> {
    return this.search({ ...params, engine: 'google_patents' });
  }

  /**
   * Execute scholarly search with rate limiting
   */
  async searchScholar(params: {
    q: string;
    num?: number;
    start?: number;
    hl?: string;
  }): Promise<SerpApiSearchResponse> {
    return this.search({ ...params, engine: 'google_scholar' });
  }

  /**
   * Get detailed scholarly article information with rate limiting
   * Note: Google Scholar doesn't have a detailed article API like patents
   * This could be extended to use Semantic Scholar, CrossRef, etc.
   */
  async getScholarDetails(params: {
    articleId: string;
    hl?: string;
  }): Promise<any> {
    await this.enforceRateLimit('google_scholar_details');

    // Google Scholar doesn't have a direct article details API
    // We could potentially:
    // 1. Use the article link to scrape (not recommended)
    // 2. Use Semantic Scholar API for richer metadata
    // 3. Use CrossRef API for DOI-based metadata
    // 4. Get citation network information

    // For now, return basic structure that could be extended
    return {
      article_id: params.articleId,
      message: 'Detailed scholar information not yet implemented',
      potential_enhancements: [
        'Semantic Scholar API integration',
        'CrossRef DOI lookup',
        'Citation network analysis',
        'Related articles discovery'
      ]
    };
  }

  /**
   * Get detailed patent information with rate limiting
   */
  async getPatentDetails(params: {
    patentId: string;
    fields?: string[];
    hl?: string;
  }): Promise<SerpApiDetailsResponse> {
    await this.enforceRateLimit('google_patents_details');

    const defaultFields = [
      'title', 'abstract', 'claims', 'classifications', 'publication_date',
      'priority_date', 'worldwide_applications', 'events',
      'patent_citations', 'non_patent_citations', 'pdf', 'description'
    ];

    const fields = params.fields || defaultFields;
    const jsonRestrictor = fields.join(',');

    const queryParams = new URLSearchParams({
      engine: 'google_patents_details',
      patent_id: params.patentId,
      json_restrictor: jsonRestrictor,
      api_key: this.apiKey,
      hl: params.hl || 'en',
      no_cache: 'false',
    });

    const response = await fetch(`${this.baseUrl}?${queryParams}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(`SerpAPI details failed: ${response.status} ${data.error || 'Unknown error'}`);
    }

    return SerpApiDetailsResponseSchema.parse(data);
  }

  /**
   * Enforce rate limiting per endpoint
   */
  private async enforceRateLimit(endpoint: string): Promise<void> {
    const now = Date.now();
    const lastCall = this.lastCallTimestamps.get(endpoint) || 0;
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall < this.rateLimitMs) {
      const waitTime = this.rateLimitMs - timeSinceLastCall;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastCallTimestamps.set(endpoint, Date.now());
  }

  /**
   * Normalize patent ID from various formats
   */
  static normalizePatentId(patentId: string): string {
    // Handle scholar/ format
    if (patentId.startsWith('scholar/')) {
      return patentId;
    }

    // Handle patent/ format - extract publication number
    if (patentId.startsWith('patent/')) {
      const parts = patentId.split('/');
      if (parts.length >= 2) {
        // patent/US1234567B1/en -> US1234567B1
        return parts[1].replace(/\/.*$/, '');
      }
    }

    // Handle bare publication numbers
    return patentId.replace(/\s+/g, '');
  }

  /**
   * Extract publication number from patent ID
   */
  static extractPublicationNumber(patentId: string): string {
    return this.normalizePatentId(patentId);
  }
}

// Singleton instance
export const serpApiProvider = new SerpApiProvider();
