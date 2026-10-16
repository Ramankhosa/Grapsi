-- International foundations: a tenant's currency, time zone and locale, and
-- ISO country codes beside the country names on researcher profiles.
--
-- Additive: nullable columns only (the array has a constant default, which
-- Postgres records without rewriting the table). NULL means today's
-- behaviour, applied in code (src/lib/tenant/locale.ts): INR, Asia/Kolkata,
-- en-IN. No row is written here; profile codes are filled by
-- scripts/backfill-profile-country-codes.ts.

SET LOCAL lock_timeout = '5s';

ALTER TABLE "tenants"
  ADD COLUMN "default_currency" VARCHAR(3),
  ADD COLUMN "timezone" TEXT,
  ADD COLUMN "locale" TEXT;

ALTER TABLE "researcher_profiles"
  ADD COLUMN "residence_country_code" VARCHAR(2),
  ADD COLUMN "citizenship_country_codes" TEXT[] DEFAULT ARRAY[]::TEXT[];
