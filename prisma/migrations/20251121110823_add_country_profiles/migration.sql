-- CreateEnum
CREATE TYPE "CountryProfileStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DRAFT');

-- CreateTable
CREATE TABLE "country_profiles" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "profileData" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "CountryProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "country_profiles_countryCode_key" ON "country_profiles"("countryCode");

-- CreateIndex
CREATE INDEX "country_profiles_countryCode_idx" ON "country_profiles"("countryCode");

-- CreateIndex
CREATE INDEX "country_profiles_status_idx" ON "country_profiles"("status");

-- AddForeignKey
ALTER TABLE "country_profiles" ADD CONSTRAINT "country_profiles_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "country_profiles" ADD CONSTRAINT "country_profiles_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
