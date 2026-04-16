-- CreateEnum for status (needed before creating table with enum column)
DO $$ BEGIN
    CREATE TYPE "CountrySectionPromptStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: CountrySectionPrompt for storing top-up prompts in database
CREATE TABLE IF NOT EXISTS "country_section_prompts" (
    "id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "constraints" JSONB NOT NULL DEFAULT '[]',
    "additions" JSONB DEFAULT '[]',
    "import_figures_directly" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "CountrySectionPromptStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_section_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique constraint for country/section (without partial index to avoid issues)
CREATE UNIQUE INDEX IF NOT EXISTS "country_section_prompts_country_code_section_key_key" 
    ON "country_section_prompts"("country_code", "section_key");

-- CreateIndex: Fast lookup by country
CREATE INDEX IF NOT EXISTS "country_section_prompts_country_code_idx" ON "country_section_prompts"("country_code");

-- CreateIndex: Fast lookup by section
CREATE INDEX IF NOT EXISTS "country_section_prompts_section_key_idx" ON "country_section_prompts"("section_key");

-- CreateIndex: Fast lookup by status
CREATE INDEX IF NOT EXISTS "country_section_prompts_status_idx" ON "country_section_prompts"("status");

-- CreateTable: Prompt version history for audit trail
CREATE TABLE IF NOT EXISTS "country_section_prompt_history" (
    "id" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "constraints" JSONB NOT NULL DEFAULT '[]',
    "additions" JSONB DEFAULT '[]',
    "version" INTEGER NOT NULL,
    "change_type" TEXT NOT NULL,
    "change_reason" TEXT,
    "changed_by" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "country_section_prompt_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "country_section_prompt_history_prompt_id_idx" ON "country_section_prompt_history"("prompt_id");
CREATE INDEX IF NOT EXISTS "country_section_prompt_history_country_code_section_key_idx" ON "country_section_prompt_history"("country_code", "section_key");

-- CreateTable: User section instructions per drafting session
CREATE TABLE IF NOT EXISTS "user_section_instructions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT,
    "user_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT '*',
    "section_key" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "emphasis" TEXT,
    "avoid" TEXT,
    "style" TEXT,
    "word_count" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_section_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique per user + optional session + jurisdiction + section
CREATE UNIQUE INDEX IF NOT EXISTS "user_section_instructions_user_id_session_id_jurisdiction_s_key"
    ON "user_section_instructions"("user_id", "session_id", "jurisdiction", "section_key");

-- CreateIndex: Fast lookups
CREATE INDEX IF NOT EXISTS "user_section_instructions_session_id_idx" ON "user_section_instructions"("session_id");
CREATE INDEX IF NOT EXISTS "user_section_instructions_user_id_idx" ON "user_section_instructions"("user_id");
CREATE INDEX IF NOT EXISTS "user_section_instructions_user_id_jurisdiction_idx" ON "user_section_instructions"("user_id", "jurisdiction");
CREATE INDEX IF NOT EXISTS "user_section_instructions_user_id_session_id_jurisdiction_idx" ON "user_section_instructions"("user_id", "session_id", "jurisdiction");
CREATE INDEX IF NOT EXISTS "user_section_instructions_section_key_idx" ON "user_section_instructions"("section_key");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "user_section_instructions" ADD CONSTRAINT "user_section_instructions_session_id_fkey" 
        FOREIGN KEY ("session_id") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey: user owner link
DO $$ BEGIN
    ALTER TABLE "user_section_instructions" ADD CONSTRAINT "user_section_instructions_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey for prompt history
DO $$ BEGIN
    ALTER TABLE "country_section_prompt_history" ADD CONSTRAINT "country_section_prompt_history_prompt_id_fkey" 
        FOREIGN KEY ("prompt_id") REFERENCES "country_section_prompts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

