-- ============================================================================
-- ADD CITATION STYLE DEFINITION SYSTEM
-- Extensible citation style configurations for academic writing
-- ============================================================================

-- Create CitationStyleDefinition table
CREATE TABLE IF NOT EXISTS "citation_style_definitions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inTextFormatTemplate" TEXT NOT NULL,
    "bibliographyRules" JSONB NOT NULL,
    "bibliographySortOrder" TEXT NOT NULL DEFAULT 'alphabetical',
    "supportsShortTitles" BOOLEAN NOT NULL DEFAULT false,
    "maxAuthorsBeforeEtAl" INTEGER NOT NULL DEFAULT 3,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "citation_style_definitions_pkey" PRIMARY KEY ("id")
);

-- Create unique index on code
CREATE UNIQUE INDEX IF NOT EXISTS "citation_style_definitions_code_key" ON "citation_style_definitions"("code");

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "citation_style_definitions_isActive_idx" ON "citation_style_definitions"("isActive");
CREATE INDEX IF NOT EXISTS "citation_style_definitions_sortOrder_idx" ON "citation_style_definitions"("sortOrder");

-- Insert initial citation style definitions
INSERT INTO "citation_style_definitions" ("id", "code", "name", "inTextFormatTemplate", "bibliographyRules", "bibliographySortOrder", "supportsShortTitles", "maxAuthorsBeforeEtAl", "sortOrder") VALUES
('citation_style_apa7', 'APA7', 'APA 7th Edition', '(Author, Year)', '{
  "journal": {
    "template": "AuthorLast, A. A., AuthorLast, B. B., & AuthorLast, C. C. (Year). Title of article. Title of Journal, volume(issue), page-page. DOI",
    "authors": "Last, First M.",
    "title": "sentence-case",
    "journal": "title-case"
  },
  "book": {
    "template": "AuthorLast, A. A. (Year). Title of book. Publisher.",
    "authors": "Last, First M.",
    "title": "title-case"
  },
  "conference": {
    "template": "AuthorLast, A. A., AuthorLast, B. B., & AuthorLast, C. C. (Year, Month Day). Title of paper. In Proceedings of Conference Name (pp. page-page). Publisher. DOI",
    "authors": "Last, First M.",
    "title": "sentence-case"
  },
  "website": {
    "template": "AuthorLast, A. A. (Year, Month Day). Title of page. Site Name. URL",
    "authors": "Last, First M.",
    "title": "sentence-case"
  }
}', 'alphabetical', false, 3, 1),

('citation_style_ieee', 'IEEE', 'IEEE', '[Number]', '{
  "journal": {
    "template": "[Number] AuthorFirst AuthorLast, \"Title of Article,\" Title of Journal, vol. volume, no. issue, pp. page-page, Month Year. doi:DOI",
    "authors": "First Last",
    "title": "sentence-case",
    "journal": "title-case"
  },
  "book": {
    "template": "[Number] AuthorFirst AuthorLast, Title of Book. Publisher, Year.",
    "authors": "First Last",
    "title": "title-case"
  },
  "conference": {
    "template": "[Number] AuthorFirst AuthorLast, \"Title of Paper,\" in Proceedings of Conference Name, pp. page-page, City, Country, Month Year. doi:DOI",
    "authors": "First Last",
    "title": "sentence-case"
  },
  "website": {
    "template": "[Number] AuthorFirst AuthorLast, \"Title of Page,\" Site Name, Month Day, Year. [Online]. Available: URL",
    "authors": "First Last",
    "title": "sentence-case"
  }
}', 'order_of_appearance', false, 3, 2),

('citation_style_chicago_authordate', 'CHICAGO_AUTHOR_DATE', 'Chicago (Author-Date)', '(Author Year)', '{
  "journal": {
    "template": "AuthorLast, First. Year. \"Title of Article.\" Title of Journal volume, no. issue: page-page. doi:DOI",
    "authors": "Last, First",
    "title": "sentence-case",
    "journal": "title-case"
  },
  "book": {
    "template": "AuthorLast, First. Year. Title of Book. Place: Publisher.",
    "authors": "Last, First",
    "title": "title-case"
  },
  "conference": {
    "template": "AuthorLast, First. Year. \"Title of Paper.\" Paper presented at Conference Name, City, Country, Month Day.",
    "authors": "Last, First",
    "title": "sentence-case"
  },
  "website": {
    "template": "AuthorLast, First. \"Title of Page.\" Site Name, Month Day, Year. URL",
    "authors": "Last, First",
    "title": "sentence-case"
  }
}', 'alphabetical', true, 3, 3),

('citation_style_chicago_notes', 'CHICAGO_NOTES', 'Chicago (Notes-Bibliography)', 'Note Number', '{
  "journal": {
    "template": "AuthorFirst AuthorLast, \"Title of Article,\" Title of Journal volume, no. issue (Year): page-page. doi:DOI",
    "authors": "First Last",
    "title": "sentence-case",
    "journal": "title-case"
  },
  "book": {
    "template": "AuthorFirst AuthorLast, Title of Book (Place: Publisher, Year).",
    "authors": "First Last",
    "title": "title-case"
  },
  "conference": {
    "template": "AuthorFirst AuthorLast, \"Title of Paper,\" presented at Conference Name, City, Country, Month Day, Year.",
    "authors": "First Last",
    "title": "sentence-case"
  },
  "website": {
    "template": "AuthorFirst AuthorLast, \"Title of Page,\" Site Name, Month Day, Year, URL",
    "authors": "First Last",
    "title": "sentence-case"
  }
}', 'alphabetical', true, 3, 4),

('citation_style_mla9', 'MLA9', 'MLA 9th Edition', '(Author Page)', '{
  "journal": {
    "template": "AuthorLast, First. \"Title of Article.\" Title of Journal, vol. volume, no. issue, Year, pp. page-page. DOI",
    "authors": "Last, First",
    "title": "sentence-case",
    "journal": "title-case"
  },
  "book": {
    "template": "AuthorLast, First. Title of Book. Publisher, Year.",
    "authors": "Last, First",
    "title": "title-case"
  },
  "conference": {
    "template": "AuthorLast, First. \"Title of Paper.\" Conference Name, City, Country, Month Day, Year.",
    "authors": "Last, First",
    "title": "sentence-case"
  },
  "website": {
    "template": "AuthorLast, First. \"Title of Page.\" Site Name, Month Day, Year, URL. Accessed Day Month Year.",
    "authors": "Last, First",
    "title": "sentence-case"
  }
}', 'alphabetical', false, 3, 5),

('citation_style_harvard', 'HARVARD', 'Harvard', '(Author Year)', '{
  "journal": {
    "template": "AUTHORLAST, A. (Year) ''Title of Article'', Title of Journal, volume(issue), pp. page-page. doi:DOI",
    "authors": "LAST, A.",
    "title": "sentence-case",
    "journal": "title-case"
  },
  "book": {
    "template": "AUTHORLAST, A. (Year) Title of Book. Place: Publisher.",
    "authors": "LAST, A.",
    "title": "title-case"
  },
  "conference": {
    "template": "AUTHORLAST, A. (Year) ''Title of Paper'', Conference Name, City, Country, Month Day.",
    "authors": "LAST, A.",
    "title": "sentence-case"
  },
  "website": {
    "template": "AUTHORLAST, A. (Year) ''Title of Page'', Site Name [Online]. Available at: URL (Accessed: Day Month Year)",
    "authors": "LAST, A.",
    "title": "sentence-case"
  }
}', 'alphabetical', false, 3, 6),

('citation_style_acm', 'ACM', 'ACM', '[Number]', '{
  "journal": {
    "template": "[Number] AuthorFirst AuthorLast. Year. Title of Article. Title of Journal volume, issue (Year), page-page. DOI",
    "authors": "First Last",
    "title": "sentence-case",
    "journal": "title-case"
  },
  "book": {
    "template": "[Number] AuthorFirst AuthorLast. Year. Title of Book. Publisher.",
    "authors": "First Last",
    "title": "title-case"
  },
  "conference": {
    "template": "[Number] AuthorFirst AuthorLast. Year. Title of Paper. In Proceedings of Conference Name (Conference ''XX), City, Country, Month Day-Day, Year, page-page. DOI",
    "authors": "First Last",
    "title": "sentence-case"
  },
  "website": {
    "template": "[Number] AuthorFirst AuthorLast. Year. Title of Page. Site Name. Retrieved Month Day, Year from URL",
    "authors": "First Last",
    "title": "sentence-case"
  }
}', 'order_of_appearance', false, 3, 7),

('citation_style_nature', 'NATURE', 'Nature', 'Number', '{
  "journal": {
    "template": "Number. AuthorLast A. et al. Title of Article. Title of Journal volume, page-page (Year). doi:DOI",
    "authors": "Last A.",
    "title": "sentence-case",
    "journal": "title-case"
  },
  "book": {
    "template": "Number. AuthorLast, A. Title of Book. Publisher, Year.",
    "authors": "Last, A.",
    "title": "title-case"
  },
  "conference": {
    "template": "Number. AuthorLast A. Title of Paper. Conference Name, City, Country, Month Day-Day, Year.",
    "authors": "Last A.",
    "title": "sentence-case"
  },
  "website": {
    "template": "Number. AuthorLast, A. Title of Page. Site Name. URL (Year)",
    "authors": "Last, A.",
    "title": "sentence-case"
  }
}', 'order_of_appearance', false, 6, 8),

('citation_style_vancouver', 'VANCOUVER', 'Vancouver/ICMJE', '(Number)', '{
  "journal": {
    "template": "Number. AuthorLast A. Title of Article. Title of Journal. Year;volume(issue):page-page. doi:DOI",
    "authors": "Last A",
    "title": "sentence-case",
    "journal": "title-case"
  },
  "book": {
    "template": "Number. AuthorLast A. Title of Book. Place: Publisher; Year.",
    "authors": "Last A",
    "title": "title-case"
  },
  "conference": {
    "template": "Number. AuthorLast A. Title of Paper. Conference Name; City, Country; Month Day-Day, Year.",
    "authors": "Last A",
    "title": "sentence-case"
  },
  "website": {
    "template": "Number. AuthorLast A. Title of Page. Site Name [Internet]. City: Publisher; Year [cited Year Month Day]. Available from: URL",
    "authors": "Last A",
    "title": "sentence-case"
  }
}', 'order_of_appearance', false, 6, 9),

('citation_style_ama', 'AMA', 'AMA', 'Number', '{
  "journal": {
    "template": "Number. AuthorLast A. Title of Article. Title of Journal. Year;volume(issue):page-page. doi:DOI",
    "authors": "Last A",
    "title": "sentence-case",
    "journal": "title-case"
  },
  "book": {
    "template": "Number. AuthorLast A. Title of Book. Place: Publisher; Year.",
    "authors": "Last A",
    "title": "title-case"
  },
  "conference": {
    "template": "Number. AuthorLast A. Title of Paper. Conference Name; City, Country; Month Day-Day, Year.",
    "authors": "Last A",
    "title": "sentence-case"
  },
  "website": {
    "template": "Number. AuthorLast A. Title of Page. Site Name. Month Day, Year. URL",
    "authors": "Last A",
    "title": "sentence-case"
  }
}', 'order_of_appearance', false, 6, 10)
ON CONFLICT ("code") DO NOTHING;
