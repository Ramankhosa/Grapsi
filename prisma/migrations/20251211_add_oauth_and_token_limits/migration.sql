-- Add OAuth provider enum and fields to users table
-- Add token limit fields to plan_features table

-- CreateEnum (idempotent: only if not exists)
DO $$ BEGIN
    CREATE TYPE "OAuthProvider" AS ENUM ('GOOGLE', 'FACEBOOK', 'LINKEDIN', 'TWITTER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable: Add OAuth fields to users (idempotent: only if not exists)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "oauthProvider" "OAuthProvider";
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "oauthProviderId" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "oauthProfile" JSONB;

-- AlterTable: Add token limit fields to plan_features (idempotent: only if not exists)
ALTER TABLE "plan_features" ADD COLUMN IF NOT EXISTS "monthlyTokenLimit" INTEGER;
ALTER TABLE "plan_features" ADD COLUMN IF NOT EXISTS "dailyTokenLimit" INTEGER;


























