-- ============================================================================
-- MODIFY DRAFTING SESSION MODEL
-- Add paper-specific fields and relations for research paper writing
-- ============================================================================

-- Add paper-specific fields to drafting_sessions table
ALTER TABLE "drafting_sessions"
ADD COLUMN "paperTypeId" TEXT,
ADD COLUMN "citationStyleId" TEXT,
ADD COLUMN "publicationVenueId" TEXT,
ADD COLUMN "literatureReviewStatus" "LiteratureReviewStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN "targetWordCount" INTEGER,
ADD COLUMN "currentWordCount" INTEGER;

-- Add foreign key constraints for paper-specific fields
ALTER TABLE "drafting_sessions" ADD CONSTRAINT "drafting_sessions_paperTypeId_fkey"
FOREIGN KEY ("paperTypeId") REFERENCES "paper_type_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "drafting_sessions" ADD CONSTRAINT "drafting_sessions_citationStyleId_fkey"
FOREIGN KEY ("citationStyleId") REFERENCES "citation_style_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "drafting_sessions" ADD CONSTRAINT "drafting_sessions_publicationVenueId_fkey"
FOREIGN KEY ("publicationVenueId") REFERENCES "publication_venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add indexes for paper-specific fields
CREATE INDEX "drafting_sessions_paperTypeId_idx" ON "drafting_sessions"("paperTypeId");
CREATE INDEX "drafting_sessions_citationStyleId_idx" ON "drafting_sessions"("citationStyleId");
CREATE INDEX "drafting_sessions_publicationVenueId_idx" ON "drafting_sessions"("publicationVenueId");
CREATE INDEX "drafting_sessions_literatureReviewStatus_idx" ON "drafting_sessions"("literatureReviewStatus");
