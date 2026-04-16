-- Create reference document enums if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReferenceDocumentSource') THEN
    CREATE TYPE "ReferenceDocumentSource" AS ENUM ('UPLOAD', 'DOI_FETCH', 'URL_IMPORT');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReferenceDocumentStatus') THEN
    CREATE TYPE "ReferenceDocumentStatus" AS ENUM ('UPLOADED', 'PARSING', 'READY', 'FAILED');
  END IF;
END $$;

-- Create reference_documents table
CREATE TABLE IF NOT EXISTS "reference_documents" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "original_filename" TEXT NOT NULL,
  "file_hash" TEXT NOT NULL,
  "file_size_bytes" INTEGER NOT NULL,
  "mime_type" TEXT NOT NULL DEFAULT 'application/pdf',
  "source_type" "ReferenceDocumentSource" NOT NULL DEFAULT 'UPLOAD',
  "source_identifier" TEXT,
  "status" "ReferenceDocumentStatus" NOT NULL DEFAULT 'UPLOADED',
  "error_code" TEXT,
  "parsed_text" TEXT,
  "page_count" INTEGER,
  "pdf_title" TEXT,
  "pdf_authors" TEXT,
  "pdf_subject" TEXT,
  "pdf_creator" TEXT,
  "pdf_producer" TEXT,
  "pdf_creation_date" TIMESTAMP(3),
  "pdf_doi" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reference_documents_pkey" PRIMARY KEY ("id")
);

-- Create reference_document_links table
CREATE TABLE IF NOT EXISTS "reference_document_links" (
  "id" TEXT NOT NULL,
  "reference_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "is_primary" BOOLEAN NOT NULL DEFAULT true,
  "linked_by" TEXT NOT NULL,
  "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reference_document_links_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "reference_documents_file_hash_key" ON "reference_documents"("file_hash");
CREATE INDEX IF NOT EXISTS "reference_documents_user_id_idx" ON "reference_documents"("user_id");
CREATE INDEX IF NOT EXISTS "reference_documents_file_hash_idx" ON "reference_documents"("file_hash");
CREATE INDEX IF NOT EXISTS "reference_documents_status_idx" ON "reference_documents"("status");

CREATE INDEX IF NOT EXISTS "reference_document_links_reference_id_idx" ON "reference_document_links"("reference_id");
CREATE INDEX IF NOT EXISTS "reference_document_links_document_id_idx" ON "reference_document_links"("document_id");
CREATE UNIQUE INDEX IF NOT EXISTS "reference_document_links_reference_id_document_id_key" ON "reference_document_links"("reference_id", "document_id");

-- Foreign keys
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reference_documents_user_id_fkey'
  ) THEN
    ALTER TABLE "reference_documents"
      ADD CONSTRAINT "reference_documents_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reference_document_links_reference_id_fkey'
  ) THEN
    ALTER TABLE "reference_document_links"
      ADD CONSTRAINT "reference_document_links_reference_id_fkey"
      FOREIGN KEY ("reference_id") REFERENCES "reference_library"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reference_document_links_document_id_fkey'
  ) THEN
    ALTER TABLE "reference_document_links"
      ADD CONSTRAINT "reference_document_links_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "reference_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
