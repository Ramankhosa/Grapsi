import type { FundingCallDocumentKind, Prisma } from '@prisma/client';
import type { FundingLlmRoutingContext } from '@/lib/funding/llmRouting';
import type { RecommendationAccessScope } from '@/lib/recommendations/types';
import type { FundingDocumentQuestionCategory, FundingDocumentSectionType } from './constants';

export interface FundingDocumentParsedPage {
  pageNumber: number;
  rawText: string;
  cleanedText: string;
  extractionConfidence: number;
}

export interface FundingDocumentParseResult {
  pages: FundingDocumentParsedPage[];
  stats: {
    pageCount: number;
    rawCharCount: number;
    cleanedCharCount: number;
    extractor: 'pdfjs' | 'mammoth' | 'mixed' | 'text';
    fallbackPages?: number[];
  };
}

export interface FundingDocumentParserContext extends FundingLlmRoutingContext {
  documentId?: string | null;
  fundingCallId?: string | null;
}

export interface FundingDocumentSectionDraft {
  sectionType: FundingDocumentSectionType;
  sectionTitle: string | null;
  sectionText: string;
  startPage: number;
  endPage: number;
  orderIndex: number;
  confidence: number;
  classificationMethod: 'heading' | 'llm' | 'fallback';
}

export interface FundingDocumentChunkDraft {
  sourceSectionOrderIndex: number;
  sectionType: FundingDocumentSectionType;
  chunkIndex: number;
  chunkText: string;
  pageStart: number;
  pageEnd: number;
  tokenCount: number;
}

export interface FundingDocumentUploadInput {
  fundingCallId: string;
  file: File;
  sourceUrl?: string | null;
  documentKind?: FundingCallDocumentKind;
  /** Skip the automatic background processDocument call so the caller can await it. */
  deferProcessing?: boolean;
  operator: {
    userId: string;
    email: string;
    tenantId?: string | null;
  };
}

export interface FundingDocumentQualityFlag {
  code: string;
  severity: 'info' | 'warning' | 'conflict';
  message: string;
  sectionType?: FundingDocumentSectionType;
  pageStart?: number | null;
  pageEnd?: number | null;
  structuredValue?: unknown;
  documentValue?: unknown;
}

export interface FundingDocumentQualityReport {
  presence: {
    eligibility: boolean;
    dates: boolean;
    budget: boolean;
    thematic: boolean;
  };
  flags: FundingDocumentQualityFlag[];
  conflicts: FundingDocumentQualityFlag[];
  needsManualReview: boolean;
}

export interface FundingDocumentSearchRequest {
  query: string;
  fundingCallId?: string;
  sectionTypes?: FundingDocumentSectionType[];
  /** Restrict retrieval to specific document kinds (default: all kinds). */
  documentKinds?: FundingCallDocumentKind[];
  callStatus?: 'active' | 'upcoming' | 'closed' | 'any';
  topK?: number;
  minSimilarity?: number;
  access: RecommendationAccessScope;
  llmContext?: FundingLlmRoutingContext | null;
}

export interface FundingDocumentSearchResult {
  chunkId: string;
  documentId: string;
  fundingCallId: string;
  sectionId: string | null;
  sectionTitle: string | null;
  sectionType: FundingDocumentSectionType;
  chunkText: string;
  pageStart: number;
  pageEnd: number;
  similarity: number;
  documentVersion: number;
  qualityFlags?: Prisma.JsonValue | null;
}

export interface FundingDocumentQaRequest {
  callId: string;
  question: string;
  access: RecommendationAccessScope;
  llmContext?: FundingLlmRoutingContext | null;
}

export interface FundingDocumentCitation {
  sectionTitle: string | null;
  sectionType: FundingDocumentSectionType;
  pageStart: number;
  pageEnd: number;
  documentVersion: number;
}

export interface FundingDocumentQaResponse {
  answer: string;
  citations: FundingDocumentCitation[];
  answeredFrom: 'structured' | 'document' | 'both' | 'not_found';
  category: FundingDocumentQuestionCategory;
}
