-- CreateTable
CREATE TABLE "system_prompt_templates" (
    "id" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "application_mode" TEXT NOT NULL DEFAULT 'paper',
    "section_scope" TEXT,
    "paper_type_scope" TEXT,
    "content" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_prompt_templates_template_key_application_mode_idx" ON "system_prompt_templates"("template_key", "application_mode");

-- CreateIndex
CREATE INDEX "system_prompt_templates_application_mode_idx" ON "system_prompt_templates"("application_mode");

-- CreateIndex
CREATE UNIQUE INDEX "system_prompt_templates_template_key_application_mode_secti_key" ON "system_prompt_templates"("template_key", "application_mode", "section_scope", "paper_type_scope");
