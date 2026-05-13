-- CreateTable
CREATE TABLE "platform_team_role_assignments" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role_code" TEXT NOT NULL,
  "assigned_by_user_id" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "platform_team_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_team_role_assignments_user_role_key"
  ON "platform_team_role_assignments"("user_id", "role_code");

-- CreateIndex
CREATE INDEX "idx_platform_team_role_assignments_user_active"
  ON "platform_team_role_assignments"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "idx_platform_team_role_assignments_role_active"
  ON "platform_team_role_assignments"("role_code", "is_active");

-- CreateIndex
CREATE INDEX "idx_platform_team_role_assignments_assigned_by"
  ON "platform_team_role_assignments"("assigned_by_user_id");

-- AddForeignKey
ALTER TABLE "platform_team_role_assignments"
  ADD CONSTRAINT "platform_team_role_assignments_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_team_role_assignments"
  ADD CONSTRAINT "platform_team_role_assignments_assigned_by_user_id_fkey"
  FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
