import { SerpApiSearchResult, SerpApiDetailsResponse, SerpApiProvider } from './serpapi-provider';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface NormalizedPatent {
  publicationNumber: string;
  title?: string;
  abstract?: string;
  language?: string;
  publicationDate?: Date;
  priorityDate?: Date;
  filingDate?: Date;
  assignees: string[];
  inventors: string[];
  cpcs: string[];
  ipcs: string[];
  link?: string;
  pdfLink?: string;
  extras?: any;
}

/**
 * Normalize patent data from SerpAPI search results
 */
// Define the patent result type
type SerpApiPatentResult = {
  position?: number;
  title: string;
  link?: string;
  snippet?: string;
  publication_number: string;
  patent_id: string;
  assignee?: string;
  inventor?: string;
  priority_date?: string;
  filing_date?: string;
  publication_date?: string;
  grant_date?: string;
  pdf?: string;
};

export function normalizePatentFromSearch(result: SerpApiPatentResult): NormalizedPatent {
  // Extract publication number
  const publicationNumber = SerpApiProvider.normalizePatentId(result.publication_number || result.patent_id);

  // Parse dates
  const publicationDate = result.publication_date ? parseDate(result.publication_date) : undefined;
  const priorityDate = result.priority_date ? parseDate(result.priority_date) : undefined;
  const filingDate = result.filing_date ? parseDate(result.filing_date) : undefined;

  // Handle arrays
  const assignees = result.assignee ? [result.assignee] : [];
  const inventors = result.inventor ? [result.inventor] : [];

  return {
    publicationNumber,
    title: result.title,
    abstract: result.snippet, // Search results have snippet, not full abstract
    publicationDate,
    priorityDate,
    filingDate,
    assignees,
    inventors,
    cpcs: [], // Not available in search results
    ipcs: [], // Not available in search results
    link: result.link,
    pdfLink: result.pdf,
    extras: {
      patent_id: result.patent_id,
      position: result.position,
    },
  };
}

/**
 * Normalize patent data from SerpAPI details response
 */
export function normalizePatentFromDetails(response: SerpApiDetailsResponse, publicationNumber: string): NormalizedPatent {
  // Parse dates
  const publicationDate = response.publication_date ? parseDate(response.publication_date) : undefined;
  const priorityDate = response.priority_date ? parseDate(response.priority_date) : undefined;

  // Extract classifications
  const cpcs: string[] = [];
  const ipcs: string[] = [];

  if (response.classifications) {
    if (Array.isArray(response.classifications)) {
      response.classifications.forEach((cls: any) => {
        if (cls.code) {
          if (cls.is_cpc) {
            cpcs.push(cls.code);
          } else {
            ipcs.push(cls.code);
          }
        }
      });
    }
  }

  // Extract assignees and inventors from worldwide applications if available
  let assignees: string[] = [];
  let inventors: string[] = [];

  if (response.worldwide_applications && Array.isArray(response.worldwide_applications)) {
    response.worldwide_applications.forEach((app: any) => {
      if (app.assignees && Array.isArray(app.assignees)) {
        assignees.push(...app.assignees);
      }
      if (app.inventors && Array.isArray(app.inventors)) {
        inventors.push(...app.inventors);
      }
    });
  }

  // Deduplicate
  assignees = Array.from(new Set(assignees));
  inventors = Array.from(new Set(inventors));

  return {
    publicationNumber,
    title: response.title,
    abstract: response.abstract,
    publicationDate,
    priorityDate,
    assignees,
    inventors,
    cpcs,
    ipcs,
    pdfLink: response.pdf,
    extras: {
      claims_count: response.claims ? countClaims(response.claims) : 0,
      has_citations: (response.patent_citations?.length || 0) > 0,
    },
  };
}

/**
 * Upsert patent to database
 */
export async function upsertPatent(patent: NormalizedPatent): Promise<void> {
  await prisma.priorArtPatent.upsert({
    where: { publicationNumber: patent.publicationNumber },
    update: {
      title: patent.title || undefined,
      abstract: patent.abstract || undefined,
      language: patent.language || undefined,
      publicationDate: patent.publicationDate || undefined,
      priorityDate: patent.priorityDate || undefined,
      filingDate: patent.filingDate || undefined,
      assignees: patent.assignees,
      inventors: patent.inventors,
      cpcs: patent.cpcs,
      ipcs: patent.ipcs,
      link: patent.link || undefined,
      pdfLink: patent.pdfLink || undefined,
      extras: patent.extras || {},
      lastSeenAt: new Date(),
    },
    create: {
      publicationNumber: patent.publicationNumber,
      title: patent.title,
      abstract: patent.abstract,
      language: patent.language,
      publicationDate: patent.publicationDate,
      priorityDate: patent.priorityDate,
      filingDate: patent.filingDate,
      assignees: patent.assignees,
      inventors: patent.inventors,
      cpcs: patent.cpcs,
      ipcs: patent.ipcs,
      link: patent.link,
      pdfLink: patent.pdfLink,
      extras: patent.extras,
    },
  });
}

/**
 * Normalize and upsert patent details
 */
export async function upsertPatentDetails(
  publicationNumber: string,
  details: SerpApiDetailsResponse
): Promise<void> {
  await prisma.priorArtPatentDetail.upsert({
    where: { publicationNumber },
    update: {
      claims: details.claims || undefined,
      description: details.description || undefined,
      classifications: details.classifications || undefined,
      worldwideApplications: details.worldwide_applications || undefined,
      events: details.events || undefined,
      legalEvents: undefined, // Additional processing might be needed
      citationsPatent: details.patent_citations || undefined,
      citationsNPL: details.non_patent_citations || undefined,
      pdfLink: details.pdf || undefined,
      fetchedAt: new Date(),
    },
    create: {
      publicationNumber,
      claims: details.claims || undefined,
      description: details.description || undefined,
      classifications: details.classifications || undefined,
      worldwideApplications: details.worldwide_applications || undefined,
      events: details.events || undefined,
      legalEvents: undefined, // Additional processing might be needed
      citationsPatent: details.patent_citations || undefined,
      citationsNPL: details.non_patent_citations || undefined,
      pdfLink: details.pdf || undefined,
      fetchedAt: new Date(),
    },
  });
}

/**
 * Helper function to parse various date formats
 */
function parseDate(dateStr: string): Date | undefined {
  try {
    // Handle YYYY-MM-DD format
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return new Date(dateStr);
    }

    // Handle other formats by attempting to parse
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? undefined : parsed;
  } catch {
    return undefined;
  }
}

/**
 * Count claims in claims data
 */
function countClaims(claims: any): number {
  if (!claims) return 0;

  if (Array.isArray(claims)) {
    return claims.length;
  }

  if (typeof claims === 'object' && claims.claims) {
    return Array.isArray(claims.claims) ? claims.claims.length : 1;
  }

  return 1; // Assume at least one claim
}
