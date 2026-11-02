CREATE TYPE "PersonalGrantReminderState" AS ENUM ('NONE', 'PENDING', 'SENDING', 'SENT', 'FAILED');

CREATE TABLE "personal_grants" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "funding_call_id" TEXT NOT NULL,
  "is_favourite" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT NOT NULL DEFAULT '',
  "notes_revision" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personal_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personal_grants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personal_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personal_grants_funding_call_id_fkey" FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "personal_grants_tenant_id_user_id_funding_call_id_key" ON "personal_grants"("tenant_id", "user_id", "funding_call_id");
CREATE INDEX "personal_grants_tenant_id_user_id_is_favourite_updated_at_idx" ON "personal_grants"("tenant_id", "user_id", "is_favourite", "updated_at");

CREATE TABLE "personal_grant_events" (
  "id" TEXT NOT NULL,
  "personal_grant_id" TEXT NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "event_at" TIMESTAMPTZ(3) NOT NULL,
  "timezone" VARCHAR(100) NOT NULL,
  "reminder_at" TIMESTAMPTZ(3),
  "reminder_state" "PersonalGrantReminderState" NOT NULL DEFAULT 'NONE',
  "sent_at" TIMESTAMPTZ(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "retry_at" TIMESTAMPTZ(3),
  "claimed_at" TIMESTAMPTZ(3),
  "claim_token" TEXT,
  "last_error" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personal_grant_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personal_grant_events_personal_grant_id_fkey" FOREIGN KEY ("personal_grant_id") REFERENCES "personal_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "personal_grant_events_reminder_state_retry_at_idx" ON "personal_grant_events"("reminder_state", "retry_at");
CREATE INDEX "personal_grant_events_personal_grant_id_event_at_idx" ON "personal_grant_events"("personal_grant_id", "event_at");
CREATE INDEX "personal_grant_events_event_at_idx" ON "personal_grant_events"("event_at");
