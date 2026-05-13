-- CreateTable
CREATE TABLE "research_area_taxonomy_uploads" (
  "id" TEXT NOT NULL,
  "source_name" TEXT NOT NULL DEFAULT 'OECD FORD',
  "original_filename" TEXT,
  "row_count" INTEGER NOT NULL DEFAULT 0,
  "active_row_count" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "uploaded_by" TEXT NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activated_at" TIMESTAMP(3),
  "archived_at" TIMESTAMP(3),

  CONSTRAINT "research_area_taxonomy_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_area_taxonomy_areas" (
  "id" TEXT NOT NULL,
  "upload_id" TEXT NOT NULL,
  "level1_code" TEXT NOT NULL,
  "level1_name" TEXT NOT NULL,
  "level2_code" TEXT NOT NULL DEFAULT '',
  "level2_name" TEXT NOT NULL DEFAULT '',
  "description" TEXT,
  "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sort_order" INTEGER,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "research_area_taxonomy_areas_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "researcher_saved_research_areas"
  ADD COLUMN "taxonomy_area_id" TEXT,
  ADD COLUMN "taxonomy_level1_code" TEXT,
  ADD COLUMN "taxonomy_level1_name" TEXT,
  ADD COLUMN "taxonomy_level2_code" TEXT,
  ADD COLUMN "taxonomy_level2_name" TEXT;

-- CreateTable
CREATE TABLE "funding_call_research_area_taxonomies" (
  "id" TEXT NOT NULL,
  "funding_call_id" TEXT NOT NULL,
  "taxonomy_area_id" TEXT NOT NULL,
  "taxonomy_level1_code" TEXT,
  "taxonomy_level1_name" TEXT,
  "taxonomy_level2_code" TEXT,
  "taxonomy_level2_name" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "confidence" DOUBLE PRECISION,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "funding_call_research_area_taxonomies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_research_area_taxonomy_uploads_status" ON "research_area_taxonomy_uploads"("status");

-- CreateIndex
CREATE INDEX "idx_research_area_taxonomy_uploads_created" ON "research_area_taxonomy_uploads"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "research_area_taxonomy_areas_upload_level_codes_key" ON "research_area_taxonomy_areas"("upload_id", "level1_code", "level2_code");

-- CreateIndex
CREATE INDEX "idx_research_area_taxonomy_areas_upload_active" ON "research_area_taxonomy_areas"("upload_id", "is_active");

-- CreateIndex
CREATE INDEX "idx_research_area_taxonomy_areas_level1_code" ON "research_area_taxonomy_areas"("level1_code");

-- CreateIndex
CREATE INDEX "idx_research_area_taxonomy_areas_level2_code" ON "research_area_taxonomy_areas"("level2_code");

-- CreateIndex
CREATE INDEX "idx_researcher_saved_research_areas_taxonomy_area" ON "researcher_saved_research_areas"("taxonomy_area_id");

-- CreateIndex
CREATE INDEX "idx_researcher_saved_research_areas_taxonomy_codes" ON "researcher_saved_research_areas"("taxonomy_level1_code", "taxonomy_level2_code");

-- CreateIndex
CREATE UNIQUE INDEX "funding_call_research_area_taxonomies_call_area_key" ON "funding_call_research_area_taxonomies"("funding_call_id", "taxonomy_area_id");

-- CreateIndex
CREATE INDEX "idx_funding_call_research_area_taxonomies_call" ON "funding_call_research_area_taxonomies"("funding_call_id");

-- CreateIndex
CREATE INDEX "idx_funding_call_research_area_taxonomies_area" ON "funding_call_research_area_taxonomies"("taxonomy_area_id");

-- CreateIndex
CREATE INDEX "idx_funding_call_research_area_taxonomies_codes" ON "funding_call_research_area_taxonomies"("taxonomy_level1_code", "taxonomy_level2_code");

-- AddForeignKey
ALTER TABLE "research_area_taxonomy_uploads"
  ADD CONSTRAINT "research_area_taxonomy_uploads_uploaded_by_fkey"
  FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_area_taxonomy_areas"
  ADD CONSTRAINT "research_area_taxonomy_areas_upload_id_fkey"
  FOREIGN KEY ("upload_id") REFERENCES "research_area_taxonomy_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "researcher_saved_research_areas"
  ADD CONSTRAINT "researcher_saved_research_areas_taxonomy_area_id_fkey"
  FOREIGN KEY ("taxonomy_area_id") REFERENCES "research_area_taxonomy_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_call_research_area_taxonomies"
  ADD CONSTRAINT "funding_call_research_area_taxonomies_funding_call_id_fkey"
  FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_call_research_area_taxonomies"
  ADD CONSTRAINT "funding_call_research_area_taxonomies_taxonomy_area_id_fkey"
  FOREIGN KEY ("taxonomy_area_id") REFERENCES "research_area_taxonomy_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
