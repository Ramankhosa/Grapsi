DO $$ BEGIN
  CREATE TYPE "GrantBlueprintStatus" AS ENUM ('DRAFT', 'FROZEN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GrantSectionDraftStatus" AS ENUM ('NOT_STARTED', 'DRAFT', 'REVIEWED', 'APPROVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "grant_prep_sessions"
  ADD COLUMN IF NOT EXISTS "grant_session_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "grant_prep_sessions_grant_session_id_key"
  ON "grant_prep_sessions"("grant_session_id");

DO $$ BEGIN
  ALTER TABLE "grant_prep_sessions"
    ADD CONSTRAINT "grant_prep_sessions_grant_session_id_fkey"
    FOREIGN KEY ("grant_session_id") REFERENCES "grant_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "grant_blueprints" (
  "id" TEXT NOT NULL,
  "grantSessionId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "fundingCallId" TEXT NOT NULL,
  "sourcePrepSessionId" TEXT,
  "sourceTemplateRevisionId" TEXT,
  "sourceGuidelineRevisionId" TEXT,
  "status" "GrantBlueprintStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "compiledTemplateJson" JSONB NOT NULL,
  "sectionPlanJson" JSONB NOT NULL,
  "freezePayloadJson" JSONB,
  "globalKeywordsJson" JSONB,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "frozenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "grant_blueprints_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "grant_blueprints_grantSessionId_fkey" FOREIGN KEY ("grantSessionId") REFERENCES "grant_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "grant_blueprints_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "grant_blueprints_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "grant_blueprints_fundingCallId_fkey" FOREIGN KEY ("fundingCallId") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "grant_blueprints_sourcePrepSessionId_fkey" FOREIGN KEY ("sourcePrepSessionId") REFERENCES "grant_prep_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "grant_blueprints_grantSessionId_key"
  ON "grant_blueprints"("grantSessionId");
CREATE INDEX IF NOT EXISTS "grant_blueprints_tenantId_projectId_idx"
  ON "grant_blueprints"("tenantId", "projectId");
CREATE INDEX IF NOT EXISTS "grant_blueprints_fundingCallId_idx"
  ON "grant_blueprints"("fundingCallId");

CREATE TABLE IF NOT EXISTS "grant_section_drafts" (
  "id" TEXT NOT NULL,
  "grantSessionId" TEXT NOT NULL,
  "blueprintId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sectionKey" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sectionType" TEXT NOT NULL,
  "sectionOrder" INTEGER NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "wordBudget" INTEGER,
  "characterLimit" INTEGER,
  "purpose" TEXT NOT NULL,
  "reviewerIntent" TEXT,
  "dependenciesJson" JSONB,
  "mustCoverJson" JSONB,
  "mustAvoidJson" JSONB,
  "sourceTemplatePointer" TEXT,
  "content" TEXT,
  "status" "GrantSectionDraftStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "llmPromptUsed" TEXT,
  "llmResponse" TEXT,
  "llmTokensUsed" INTEGER,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "grant_section_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "grant_section_drafts_grantSessionId_fkey" FOREIGN KEY ("grantSessionId") REFERENCES "grant_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "grant_section_drafts_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "grant_blueprints"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "grant_section_drafts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "grant_section_drafts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "grant_section_drafts_session_section_key_unique"
  ON "grant_section_drafts"("grantSessionId", "sectionKey");
CREATE INDEX IF NOT EXISTS "grant_section_drafts_blueprintId_sectionOrder_idx"
  ON "grant_section_drafts"("blueprintId", "sectionOrder");
CREATE INDEX IF NOT EXISTS "grant_section_drafts_tenantId_projectId_idx"
  ON "grant_section_drafts"("tenantId", "projectId");

CREATE TABLE IF NOT EXISTS "grant_structured_field_responses" (
  "id" TEXT NOT NULL,
  "grantSessionId" TEXT NOT NULL,
  "sectionDraftId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sectionKey" TEXT NOT NULL,
  "fieldKey" TEXT NOT NULL,
  "responseJson" JSONB NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "grant_structured_field_responses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "grant_structured_field_responses_grantSessionId_fkey" FOREIGN KEY ("grantSessionId") REFERENCES "grant_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "grant_structured_field_responses_sectionDraftId_fkey" FOREIGN KEY ("sectionDraftId") REFERENCES "grant_section_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "grant_structured_field_responses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "grant_structured_field_responses_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "grant_structured_field_responses_section_field_unique"
  ON "grant_structured_field_responses"("sectionDraftId", "fieldKey");
CREATE INDEX IF NOT EXISTS "grant_structured_field_responses_grantSessionId_sectionKey_idx"
  ON "grant_structured_field_responses"("grantSessionId", "sectionKey");
CREATE INDEX IF NOT EXISTS "grant_structured_field_responses_tenantId_projectId_idx"
  ON "grant_structured_field_responses"("tenantId", "projectId");
