-- Add QUALITY_AUDITOR to the UserRole enum.
-- This is an additive tag (like CALL_ADMIN, CALL_ASSIGNER) that grants
-- read-only cross-project access to all reviews and reports within a tenant.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'QUALITY_AUDITOR';
