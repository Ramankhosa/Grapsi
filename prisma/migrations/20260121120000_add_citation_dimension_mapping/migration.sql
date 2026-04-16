-- CreateEnum
CREATE TYPE "DimensionMappingConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- AlterTable: Add blueprint dimension mapping fields to CitationUsage
-- These fields support Part B of the SRS: Blueprint-Aligned Paper Mapping
ALTER TABLE "citation_usages" ADD COLUMN "dimension" TEXT;
ALTER TABLE "citation_usages" ADD COLUMN "remark" TEXT;
ALTER TABLE "citation_usages" ADD COLUMN "confidence" "DimensionMappingConfidence";
ALTER TABLE "citation_usages" ADD COLUMN "mappedAt" TIMESTAMP(3);
ALTER TABLE "citation_usages" ADD COLUMN "mappingSource" TEXT DEFAULT 'auto';

-- CreateIndex: Index on dimension for efficient lookups during section generation
CREATE INDEX "citation_usages_dimension_idx" ON "citation_usages"("dimension");


