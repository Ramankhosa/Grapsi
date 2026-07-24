-- CreateEnum
CREATE TYPE "CallAssignmentOutcome" AS ENUM ('PENDING', 'AWARDED', 'REJECTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "call_assignments" ADD COLUMN     "award_amount" DOUBLE PRECISION,
ADD COLUMN     "award_currency" TEXT,
ADD COLUMN     "decision_at" TIMESTAMP(3),
ADD COLUMN     "outcome" "CallAssignmentOutcome" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "category" TEXT NOT NULL DEFAULT 'ANNOUNCEMENT',
    "link_url" TEXT,
    "assignment_id" TEXT,
    "created_by_user_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_notifications_user_read" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "idx_notifications_tenant_created" ON "notifications"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_notifications_assignment" ON "notifications"("assignment_id");

-- CreateIndex
CREATE INDEX "idx_call_assignments_tenant_outcome" ON "call_assignments"("tenant_id", "outcome");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "call_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
