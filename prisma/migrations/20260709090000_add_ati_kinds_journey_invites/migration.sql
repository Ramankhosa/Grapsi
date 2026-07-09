-- ATI token governance kinds + time-boxed (EVENT) access,
-- per-user onboarding journey state, and named tenant member invites.

-- CreateEnum
CREATE TYPE "ATITokenKind" AS ENUM ('STANDARD', 'MANAGED', 'EVENT');

-- CreateEnum
CREATE TYPE "TenantInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- AlterTable: ati_tokens gains kind + EVENT access window
ALTER TABLE "ati_tokens"
ADD COLUMN IF NOT EXISTS "kind" "ATITokenKind" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN IF NOT EXISTS "memberAccessHours" INTEGER,
ADD COLUMN IF NOT EXISTS "accessEndsAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "eventLabel" TEXT;

-- AlterTable: users gain optional access expiry (EVENT signups)
ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "accessExpiresAt" TIMESTAMP(3);

-- CreateTable: tenant_member_invites
CREATE TABLE IF NOT EXISTS "tenant_member_invites" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'ANALYST',
    "teamId" TEXT,
    "atiTokenId" TEXT NOT NULL,
    "status" "TenantInviteStatus" NOT NULL DEFAULT 'PENDING',
    "invitedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_member_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_member_invites_atiTokenId_key" ON "tenant_member_invites"("atiTokenId");
CREATE INDEX IF NOT EXISTS "tenant_member_invites_tenantId_status_idx" ON "tenant_member_invites"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "tenant_member_invites_email_idx" ON "tenant_member_invites"("email");

-- AddForeignKey
ALTER TABLE "tenant_member_invites"
ADD CONSTRAINT "tenant_member_invites_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_member_invites"
ADD CONSTRAINT "tenant_member_invites_atiTokenId_fkey" FOREIGN KEY ("atiTokenId") REFERENCES "ati_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_member_invites"
ADD CONSTRAINT "tenant_member_invites_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: user_journey_states
CREATE TABLE IF NOT EXISTS "user_journey_states" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "milestones" JSONB NOT NULL DEFAULT '{}',
    "dismissedTours" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checklistDone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_journey_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_journey_states_userId_key" ON "user_journey_states"("userId");

-- AddForeignKey
ALTER TABLE "user_journey_states"
ADD CONSTRAINT "user_journey_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
