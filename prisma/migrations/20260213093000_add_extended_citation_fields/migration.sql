-- Add extended bibliographic fields needed by style-specific bibliography generation
-- Also ensure reference library core tables exist for shadow-database replay.

-- ============================================================================
-- REFERENCE LIBRARY CORE TABLES (idempotent)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "reference_library" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
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
  "editors" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "publicationPlace" TEXT,
  "publicationDate" TEXT,
  "accessedDate" TEXT,
  "articleNumber" TEXT,
  "issn" TEXT,
  "journalAbbreviation" TEXT,
  "pmid" TEXT,
  "pmcid" TEXT,
  "arxivId" TEXT,
  "abstract" TEXT,
  "sourceType" "CitationSourceType" NOT NULL DEFAULT 'OTHER',
  "citationKey" TEXT,
  "bibtex" TEXT,
  "importSource" "CitationImportSource" NOT NULL DEFAULT 'MANUAL',
  "importDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "externalId" TEXT,
  "notes" TEXT,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "pdfUrl" TEXT,
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "isFavorite" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reference_library_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "reference_collections" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "color" TEXT,
  "icon" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isShared" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reference_collections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "reference_collection_items" (
  "id" TEXT NOT NULL,
  "collection_id" TEXT NOT NULL,
  "reference_id" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "collectionNotes" TEXT,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reference_collection_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "reference_library_user_id_doi_key"
  ON "reference_library"("user_id", "doi");
CREATE INDEX IF NOT EXISTS "reference_library_user_id_idx"
  ON "reference_library"("user_id");
CREATE INDEX IF NOT EXISTS "reference_library_doi_idx"
  ON "reference_library"("doi");
CREATE INDEX IF NOT EXISTS "reference_library_sourceType_idx"
  ON "reference_library"("sourceType");
CREATE INDEX IF NOT EXISTS "reference_library_isFavorite_idx"
  ON "reference_library"("isFavorite");
CREATE INDEX IF NOT EXISTS "reference_library_isRead_idx"
  ON "reference_library"("isRead");

CREATE UNIQUE INDEX IF NOT EXISTS "reference_collections_user_id_name_key"
  ON "reference_collections"("user_id", "name");
CREATE INDEX IF NOT EXISTS "reference_collections_user_id_idx"
  ON "reference_collections"("user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "reference_collection_items_collection_id_reference_id_key"
  ON "reference_collection_items"("collection_id", "reference_id");
CREATE INDEX IF NOT EXISTS "reference_collection_items_collection_id_idx"
  ON "reference_collection_items"("collection_id");
CREATE INDEX IF NOT EXISTS "reference_collection_items_reference_id_idx"
  ON "reference_collection_items"("reference_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reference_library_user_id_fkey'
  ) THEN
    ALTER TABLE "reference_library"
      ADD CONSTRAINT "reference_library_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reference_collections_user_id_fkey'
  ) THEN
    ALTER TABLE "reference_collections"
      ADD CONSTRAINT "reference_collections_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reference_collection_items_collection_id_fkey'
  ) THEN
    ALTER TABLE "reference_collection_items"
      ADD CONSTRAINT "reference_collection_items_collection_id_fkey"
      FOREIGN KEY ("collection_id") REFERENCES "reference_collections"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reference_collection_items_reference_id_fkey'
  ) THEN
    ALTER TABLE "reference_collection_items"
      ADD CONSTRAINT "reference_collection_items_reference_id_fkey"
      FOREIGN KEY ("reference_id") REFERENCES "reference_library"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ============================================================================
-- EXTENDED BIBLIOGRAPHIC FIELDS (idempotent)
-- ============================================================================

ALTER TABLE "citations"
  ADD COLUMN IF NOT EXISTS "editors" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "publicationPlace" TEXT,
  ADD COLUMN IF NOT EXISTS "publicationDate" TEXT,
  ADD COLUMN IF NOT EXISTS "accessedDate" TEXT,
  ADD COLUMN IF NOT EXISTS "articleNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "issn" TEXT,
  ADD COLUMN IF NOT EXISTS "journalAbbreviation" TEXT,
  ADD COLUMN IF NOT EXISTS "pmid" TEXT,
  ADD COLUMN IF NOT EXISTS "pmcid" TEXT,
  ADD COLUMN IF NOT EXISTS "arxivId" TEXT;

ALTER TABLE "reference_library"
  ADD COLUMN IF NOT EXISTS "editors" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "publicationPlace" TEXT,
  ADD COLUMN IF NOT EXISTS "publicationDate" TEXT,
  ADD COLUMN IF NOT EXISTS "accessedDate" TEXT,
  ADD COLUMN IF NOT EXISTS "articleNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "issn" TEXT,
  ADD COLUMN IF NOT EXISTS "journalAbbreviation" TEXT,
  ADD COLUMN IF NOT EXISTS "pmid" TEXT,
  ADD COLUMN IF NOT EXISTS "pmcid" TEXT,
  ADD COLUMN IF NOT EXISTS "arxivId" TEXT;
