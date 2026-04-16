-- ============================================================================
-- ADD PUBLICATION VENUE SYSTEM
-- Academic venues (journals, conferences) with formatting requirements
-- ============================================================================

-- Create VenueType enum
DO $$ BEGIN
    CREATE TYPE "VenueType" AS ENUM ('JOURNAL', 'CONFERENCE', 'BOOK_PUBLISHER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create PublicationVenue table
CREATE TABLE IF NOT EXISTS "publication_venues" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "venueType" "VenueType" NOT NULL,
    "citationStyleId" TEXT NOT NULL,
    "acceptedPaperTypes" TEXT[],
    "sectionOverrides" JSONB,
    "wordLimitOverrides" JSONB,
    "formattingGuidelines" JSONB,
    "impactFactor" DOUBLE PRECISION,
    "ranking" INTEGER,
    "website" TEXT,
    "submissionUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publication_venues_pkey" PRIMARY KEY ("id")
);

-- Create unique index on code
CREATE UNIQUE INDEX IF NOT EXISTS "publication_venues_code_key" ON "publication_venues"("code");

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "publication_venues_venueType_idx" ON "publication_venues"("venueType");
CREATE INDEX IF NOT EXISTS "publication_venues_citationStyleId_idx" ON "publication_venues"("citationStyleId");
CREATE INDEX IF NOT EXISTS "publication_venues_isActive_idx" ON "publication_venues"("isActive");
CREATE INDEX IF NOT EXISTS "publication_venues_sortOrder_idx" ON "publication_venues"("sortOrder");

-- Add foreign key constraint
DO $$ BEGIN
    ALTER TABLE "publication_venues" ADD CONSTRAINT "publication_venues_citationStyleId_fkey"
    FOREIGN KEY ("citationStyleId") REFERENCES "citation_style_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Insert major academic venues
INSERT INTO "publication_venues" ("id", "code", "name", "venueType", "citationStyleId", "acceptedPaperTypes", "sectionOverrides", "wordLimitOverrides", "formattingGuidelines", "impactFactor", "website", "sortOrder") VALUES
('venue_nature', 'NATURE', 'Nature', 'JOURNAL', 'citation_style_apa7', ARRAY['JOURNAL_ARTICLE'], '{
  "required": ["abstract", "introduction", "results", "discussion", "methods", "references"],
  "optional": ["acknowledgments"]
}', '{
  "abstract": 150,
  "introduction": 500,
  "results": 1000,
  "discussion": 1000,
  "methods": 2000
}', '{
  "font": "Times New Roman",
  "fontSize": 12,
  "lineSpacing": 1.5,
  "margins": "1 inch",
  "maxFigures": 6,
  "maxReferences": 50
}', 49.962, 'https://www.nature.com/', 1),

('venue_science', 'SCIENCE', 'Science', 'JOURNAL', 'citation_style_apa7', ARRAY['JOURNAL_ARTICLE'], '{
  "required": ["abstract", "introduction", "results", "discussion", "methods", "references"],
  "optional": ["acknowledgments"]
}', '{
  "abstract": 150,
  "introduction": 600,
  "results": 1200,
  "discussion": 1200,
  "methods": 2500
}', '{
  "font": "Times New Roman",
  "fontSize": 12,
  "lineSpacing": 1.5,
  "margins": "1 inch",
  "maxFigures": 8,
  "maxReferences": 50
}', 47.728, 'https://www.science.org/', 2),

('venue_ieee_tse', 'IEEE_TSE', 'IEEE Transactions on Software Engineering', 'JOURNAL', 'citation_style_ieee', ARRAY['JOURNAL_ARTICLE'], '{
  "required": ["abstract", "introduction", "related_work", "methodology", "results", "discussion", "conclusion", "references"],
  "optional": ["acknowledgments", "appendix"]
}', '{
  "abstract": 200,
  "introduction": 1000,
  "related_work": 800,
  "methodology": 1500,
  "results": 1000,
  "discussion": 1200,
  "conclusion": 500
}', '{
  "font": "Times New Roman",
  "fontSize": 10,
  "lineSpacing": 1.0,
  "margins": "1 inch",
  "columns": 2,
  "maxPages": 15,
  "maxReferences": 40
}', 9.522, 'https://www.computer.org/csdl/journal/ts', 3),

('venue_acm_tochi', 'ACM_TOCHI', 'ACM Transactions on Computer-Human Interaction', 'JOURNAL', 'citation_style_acm', ARRAY['JOURNAL_ARTICLE'], '{
  "required": ["abstract", "introduction", "related_work", "methodology", "results", "discussion", "conclusion", "references"],
  "optional": ["acknowledgments"]
}', '{
  "abstract": 150,
  "introduction": 1000,
  "related_work": 1000,
  "methodology": 1500,
  "results": 1200,
  "discussion": 1200,
  "conclusion": 600
}', '{
  "font": "ACM SIG",
  "fontSize": 9,
  "lineSpacing": 1.0,
  "margins": "1 inch",
  "columns": 2,
  "maxPages": 30,
  "maxReferences": 50
}', 4.996, 'https://dl.acm.org/journal/tochi', 4),

('venue_icse', 'ICSE', 'International Conference on Software Engineering', 'CONFERENCE', 'citation_style_ieee', ARRAY['CONFERENCE_PAPER'], '{
  "required": ["abstract", "introduction", "related_work", "approach", "evaluation", "conclusion", "references"],
  "optional": ["acknowledgments"]
}', '{
  "abstract": 200,
  "introduction": 800,
  "related_work": 600,
  "approach": 1200,
  "evaluation": 1000,
  "conclusion": 400
}', '{
  "font": "Times New Roman",
  "fontSize": 10,
  "lineSpacing": 1.0,
  "margins": "1 inch",
  "columns": 2,
  "maxPages": 10,
  "maxReferences": 25
}', NULL, 'https://conf.researchr.org/home/icse-2025', 5),

('venue_fse', 'FSE', 'ACM SIGSOFT International Symposium on the Foundations of Software Engineering', 'CONFERENCE', 'citation_style_acm', ARRAY['CONFERENCE_PAPER'], '{
  "required": ["abstract", "introduction", "background", "approach", "evaluation", "discussion", "related_work", "conclusion", "references"],
  "optional": ["acknowledgments"]
}', '{
  "abstract": 200,
  "introduction": 600,
  "background": 400,
  "approach": 1000,
  "evaluation": 800,
  "discussion": 600,
  "related_work": 600,
  "conclusion": 400
}', '{
  "font": "ACM SIG",
  "fontSize": 9,
  "lineSpacing": 1.0,
  "margins": "1 inch",
  "columns": 2,
  "maxPages": 10,
  "maxReferences": 30
}', NULL, 'https://conf.researchr.org/home/fse-2025', 6),

('venue_chicago_press', 'CHICAGO_PRESS', 'University of Chicago Press', 'BOOK_PUBLISHER', 'citation_style_chicago_notes', ARRAY['BOOK_CHAPTER', 'THESIS_MASTERS', 'THESIS_PHD'], NULL, NULL, '{
  "font": "Times New Roman",
  "fontSize": 12,
  "lineSpacing": 1.5,
  "margins": "1 inch",
  "notes": "footnotes",
  "bibliography": "required"
}', NULL, 'https://www.chicagopress.uchicago.edu/', 7),

('venue_oxford_press', 'OXFORD_PRESS', 'Oxford University Press', 'BOOK_PUBLISHER', 'citation_style_apa7', ARRAY['BOOK_CHAPTER', 'THESIS_MASTERS', 'THESIS_PHD'], NULL, NULL, '{
  "font": "Times New Roman",
  "fontSize": 12,
  "lineSpacing": 1.5,
  "margins": "1 inch",
  "bibliography": "references"
}', NULL, 'https://academic.oup.com/', 8),

('venue_springer', 'SPRINGER', 'Springer Nature', 'BOOK_PUBLISHER', 'citation_style_apa7', ARRAY['BOOK_CHAPTER', 'THESIS_MASTERS', 'THESIS_PHD'], NULL, NULL, '{
  "font": "Times New Roman",
  "fontSize": 11,
  "lineSpacing": 1.5,
  "margins": "1 inch",
  "bibliography": "references"
}', NULL, 'https://www.springer.com/', 9),

('venue_mit_press', 'MIT_PRESS', 'MIT Press', 'BOOK_PUBLISHER', 'citation_style_chicago_authordate', ARRAY['BOOK_CHAPTER', 'THESIS_MASTERS', 'THESIS_PHD'], NULL, NULL, '{
  "font": "Times New Roman",
  "fontSize": 12,
  "lineSpacing": 1.5,
  "margins": "1 inch",
  "bibliography": "references"
}', NULL, 'https://mitpress.mit.edu/', 10)
ON CONFLICT ("code") DO NOTHING;
