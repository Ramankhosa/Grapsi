-- CreateTable
CREATE TABLE "funding_call_alerts" (
    "id" TEXT NOT NULL,
    "funding_call_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "match_score" DOUBLE PRECISION,
    "match_tier" TEXT,
    "score_basis" TEXT,
    "matched_sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "match_reason" TEXT,
    "in_app_status" TEXT NOT NULL DEFAULT 'skipped',
    "email_status" TEXT NOT NULL DEFAULT 'skipped',
    "email_error" TEXT,
    "emailed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funding_call_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "funding_call_alerts_call_user_key" ON "funding_call_alerts"("funding_call_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_funding_call_alerts_user_created" ON "funding_call_alerts"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_funding_call_alerts_email_status" ON "funding_call_alerts"("email_status", "created_at");

-- AddForeignKey
ALTER TABLE "funding_call_alerts" ADD CONSTRAINT "funding_call_alerts_funding_call_id_fkey" FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_call_alerts" ADD CONSTRAINT "funding_call_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
