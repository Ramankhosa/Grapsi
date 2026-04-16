-- ============================================================================
-- DEACTIVATE THESIS PAPER TYPES
-- Thesis writing requires chapter-based architecture not supported by current system
-- ============================================================================

-- Deactivate THESIS_MASTERS and THESIS_PHD paper types
UPDATE "paper_type_definitions"
SET "isActive" = false, "updatedAt" = NOW()
WHERE "code" IN ('THESIS_MASTERS', 'THESIS_PHD');

-- Remove thesis types from publication venues' acceptedPaperTypes arrays
-- Using array_remove to clean up the arrays
UPDATE "publication_venues"
SET 
  "acceptedPaperTypes" = array_remove(array_remove("acceptedPaperTypes", 'THESIS_MASTERS'), 'THESIS_PHD'),
  "updatedAt" = NOW()
WHERE 'THESIS_MASTERS' = ANY("acceptedPaperTypes") OR 'THESIS_PHD' = ANY("acceptedPaperTypes");

