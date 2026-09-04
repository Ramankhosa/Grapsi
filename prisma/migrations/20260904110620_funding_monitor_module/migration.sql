-- AlterEnum
ALTER TYPE "FeatureCode" ADD VALUE 'SOURCE_MONITORING';

-- CreateTable
CREATE TABLE "monitored_sources" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'AUTO',
    "feed_url" TEXT,
    "selector" TEXT,
    "frequency_minutes" INTEGER NOT NULL DEFAULT 1440,
    "keywords" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "owner_user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "last_checked_at" TIMESTAMP(3),
    "last_changed_at" TIMESTAMP(3),
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" TEXT,

    CONSTRAINT "monitored_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitored_snapshots" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content_hash" TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "monitored_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitored_changes" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "diff" JSONB NOT NULL,
    "verdict" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "confidence" DOUBLE PRECISION,
    "extracted" JSONB,
    "state" TEXT NOT NULL DEFAULT 'NEW',
    "snoozed_until" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolved_by_user_id" TEXT,
    "intake_job_id" TEXT,
    "linked_funding_call_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitored_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitored_ignore_rules" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" TEXT,

    CONSTRAINT "monitored_ignore_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_monitored_sources_due" ON "monitored_sources"("status", "last_checked_at");

-- CreateIndex
CREATE INDEX "idx_monitored_sources_tenant" ON "monitored_sources"("tenant_id");

-- CreateIndex
CREATE INDEX "idx_monitored_snapshots_source" ON "monitored_snapshots"("source_id", "fetched_at");

-- CreateIndex
CREATE INDEX "idx_monitored_changes_queue" ON "monitored_changes"("state", "created_at");

-- CreateIndex
CREATE INDEX "idx_monitored_changes_source" ON "monitored_changes"("source_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_monitored_ignore_rules_source" ON "monitored_ignore_rules"("source_id");

-- AddForeignKey
ALTER TABLE "monitored_sources" ADD CONSTRAINT "monitored_sources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitored_sources" ADD CONSTRAINT "monitored_sources_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitored_snapshots" ADD CONSTRAINT "monitored_snapshots_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "monitored_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitored_changes" ADD CONSTRAINT "monitored_changes_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "monitored_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitored_changes" ADD CONSTRAINT "monitored_changes_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitored_ignore_rules" ADD CONSTRAINT "monitored_ignore_rules_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "monitored_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

