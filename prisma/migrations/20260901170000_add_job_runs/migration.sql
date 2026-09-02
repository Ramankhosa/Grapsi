-- One row per execution of a scheduled/background job. Written by route
-- handlers via withJobRun so scheduled, manual and script runs all land here.
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "job_key" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "http_status" INTEGER,
    "counts" JSONB,
    "error_message" TEXT,
    "triggered_by" TEXT,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_job_runs_key_started" ON "job_runs"("job_key", "started_at");
