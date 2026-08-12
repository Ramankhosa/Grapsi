-- Extend FundingCallDocumentKind so guideline and template override documents
-- can live in the same document store as the main call document.
ALTER TYPE "FundingCallDocumentKind" ADD VALUE IF NOT EXISTS 'guideline_document';
ALTER TYPE "FundingCallDocumentKind" ADD VALUE IF NOT EXISTS 'template_document';
