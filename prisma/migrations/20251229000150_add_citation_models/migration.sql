-- ============================================================================
-- ADD CITATION MANAGEMENT MODELS
-- Citation and CitationUsage models for academic paper writing
-- ============================================================================

-- Create CitationSourceType enum
CREATE TYPE "CitationSourceType" AS ENUM (
  'JOURNAL_ARTICLE',
  'CONFERENCE_PAPER',
  'BOOK',
  'BOOK_CHAPTER',
  'THESIS',
  'WORKING_PAPER',
  'REPORT',
  'WEBSITE',
  'PATENT',
  'OTHER'
);

-- Create CitationImportSource enum
CREATE TYPE "CitationImportSource" AS ENUM (
  'MANUAL',
  'DOI_LOOKUP',
  'SCHOLAR_SEARCH',
  'CROSSREF_API',
  'BIBTEX_IMPORT',
  'SEMANTIC_SCHOLAR',
  'OPENALEX'
);

-- Create LiteratureReviewStatus enum (for session model)
CREATE TYPE "LiteratureReviewStatus" AS ENUM (
  'NOT_STARTED',
  'IN_PROGRESS',
  'COMPLETED'
);

-- Create Citation table
CREATE TABLE "citations" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sourceType" "CitationSourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT[],
    "year" INTEGER,
    "venue" TEXT,
    "volume" TEXT,
    "issue" TEXT,
    "pages" TEXT,
    "doi" TEXT,
    "url" TEXT,
    "isbn" TEXT,
    "publisher" TEXT,
    "edition" TEXT,
    "citationKey" TEXT NOT NULL,
    "bibtex" TEXT,
    "importSource" "CitationImportSource" NOT NULL DEFAULT 'MANUAL',
    "importDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "citations_pkey" PRIMARY KEY ("id")
);

-- Create CitationUsage table
CREATE TABLE "citation_usages" (
    "id" TEXT NOT NULL,
    "citationId" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "position" INTEGER,
    "contextSnippet" TEXT,
    "inTextFormat" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "citation_usages_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint on (sessionId, doi) to prevent duplicates
ALTER TABLE "citations" ADD CONSTRAINT "citations_sessionId_doi_key" UNIQUE ("sessionId", "doi");

-- Create indexes for performance
CREATE INDEX "citations_sessionId_idx" ON "citations"("sessionId");
CREATE INDEX "citations_citationKey_idx" ON "citations"("citationKey");
CREATE INDEX "citations_doi_idx" ON "citations"("doi");
CREATE INDEX "citations_sourceType_idx" ON "citations"("sourceType");
CREATE INDEX "citations_importSource_idx" ON "citations"("importSource");
CREATE INDEX "citations_isActive_idx" ON "citations"("isActive");

CREATE INDEX "citation_usages_citationId_idx" ON "citation_usages"("citationId");
CREATE INDEX "citation_usages_sectionKey_idx" ON "citation_usages"("sectionKey");

-- Add foreign key constraints
ALTER TABLE "citations" ADD CONSTRAINT "citations_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "citation_usages" ADD CONSTRAINT "citation_usages_citationId_fkey"
FOREIGN KEY ("citationId") REFERENCES "citations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
