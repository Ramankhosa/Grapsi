-- ============================================================================
-- ADD PAPER TYPE DEFINITION SYSTEM
-- Extensible paper type configurations for research paper writing
-- ============================================================================

-- Create PaperTypeDefinition table
CREATE TABLE IF NOT EXISTS "paper_type_definitions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "requiredSections" JSONB NOT NULL,
    "optionalSections" JSONB NOT NULL,
    "sectionOrder" JSONB NOT NULL,
    "defaultWordLimits" JSONB NOT NULL,
    "defaultCitationStyle" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_type_definitions_pkey" PRIMARY KEY ("id")
);

-- Create unique index on code
CREATE UNIQUE INDEX IF NOT EXISTS "paper_type_definitions_code_key" ON "paper_type_definitions"("code");

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "paper_type_definitions_isActive_idx" ON "paper_type_definitions"("isActive");
CREATE INDEX IF NOT EXISTS "paper_type_definitions_sortOrder_idx" ON "paper_type_definitions"("sortOrder");

-- Insert initial paper type definitions
INSERT INTO "paper_type_definitions" ("id", "code", "name", "description", "requiredSections", "optionalSections", "sectionOrder", "defaultWordLimits", "defaultCitationStyle", "sortOrder") VALUES
('paper_type_journal_article', 'JOURNAL_ARTICLE', 'Journal Article', 'Traditional academic journal article with full research methodology', '["abstract", "introduction", "methodology", "results", "discussion", "conclusion"]', '["literature_review", "acknowledgments", "references"]', '["abstract", "introduction", "literature_review", "methodology", "results", "discussion", "conclusion", "acknowledgments", "references"]', '{"abstract": 250, "introduction": 1000, "literature_review": 1500, "methodology": 1500, "results": 1000, "discussion": 1500, "conclusion": 500}', 'APA7', 1),

('paper_type_review_article', 'REVIEW_ARTICLE', 'Review Article', 'Comprehensive literature review and synthesis article', '["abstract", "introduction", "methodology", "literature_review", "discussion", "conclusion"]', '["future_directions", "acknowledgments", "references"]', '["abstract", "introduction", "methodology", "literature_review", "discussion", "future_directions", "conclusion", "acknowledgments", "references"]', '{"abstract": 300, "introduction": 800, "methodology": 800, "literature_review": 3000, "discussion": 2000, "future_directions": 800, "conclusion": 600}', 'APA7', 2),

('paper_type_conference_paper', 'CONFERENCE_PAPER', 'Conference Paper', 'Shorter format paper for academic conferences', '["abstract", "introduction", "related_work", "methodology", "results", "conclusion"]', '["acknowledgments", "references"]', '["abstract", "introduction", "related_work", "methodology", "results", "discussion", "conclusion", "acknowledgments", "references"]', '{"abstract": 200, "introduction": 800, "related_work": 600, "methodology": 1000, "results": 800, "discussion": 1000, "conclusion": 400}', 'IEEE', 3),

('paper_type_book_chapter', 'BOOK_CHAPTER', 'Book Chapter', 'Chapter contribution to an edited academic book', '["introduction", "main_content", "conclusion"]', '["abstract", "literature_review", "case_studies", "references"]', '["abstract", "introduction", "literature_review", "main_content", "case_studies", "conclusion", "references"]', '{"abstract": 250, "introduction": 1000, "literature_review": 1200, "main_content": 4000, "case_studies": 2000, "conclusion": 800}', 'APA7', 4),

('paper_type_thesis_masters', 'THESIS_MASTERS', 'Master''s Thesis', 'Master''s level academic thesis', '["abstract", "introduction", "literature_review", "methodology", "results", "discussion", "conclusion"]', '["acknowledgments", "appendix", "publications", "references"]', '["abstract", "acknowledgments", "introduction", "literature_review", "methodology", "results", "discussion", "conclusion", "appendix", "references"]', '{"abstract": 300, "introduction": 2000, "literature_review": 5000, "methodology": 3000, "results": 3000, "discussion": 4000, "conclusion": 1000}', 'APA7', 5),

('paper_type_thesis_phd', 'THESIS_PHD', 'PhD Thesis', 'Doctoral level academic dissertation', '["abstract", "introduction", "literature_review", "methodology", "results", "discussion", "conclusion", "future_work"]', '["acknowledgments", "appendix", "publications", "references"]', '["abstract", "acknowledgments", "introduction", "literature_review", "methodology", "results", "discussion", "conclusion", "future_work", "appendix", "references"]', '{"abstract": 500, "introduction": 3000, "literature_review": 8000, "methodology": 5000, "results": 5000, "discussion": 6000, "conclusion": 1500, "future_work": 2000}', 'APA7', 6),

('paper_type_case_study', 'CASE_STUDY', 'Case Study', 'In-depth analysis of a specific case or phenomenon', '["abstract", "introduction", "case_description", "analysis", "discussion", "conclusion"]', '["literature_review", "recommendations", "references"]', '["abstract", "introduction", "literature_review", "case_description", "analysis", "discussion", "recommendations", "conclusion", "references"]', '{"abstract": 200, "introduction": 600, "literature_review": 1000, "case_description": 1500, "analysis": 2000, "discussion": 1500, "recommendations": 800, "conclusion": 500}', 'APA7', 7),

('paper_type_short_communication', 'SHORT_COMMUNICATION', 'Short Communication', 'Brief research communication or letter to the editor', '["abstract", "introduction", "main_findings", "conclusion"]', '["methodology", "references"]', '["abstract", "introduction", "methodology", "main_findings", "conclusion", "references"]', '{"abstract": 150, "introduction": 400, "methodology": 500, "main_findings": 800, "conclusion": 300}', 'APA7', 8)
ON CONFLICT ("code") DO NOTHING;
