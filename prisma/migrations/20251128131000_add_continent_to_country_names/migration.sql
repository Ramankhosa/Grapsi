ALTER TABLE "country_names" ADD COLUMN IF NOT EXISTS "continent" TEXT NOT NULL DEFAULT 'Unknown';

-- Populate known continents
UPDATE "country_names" SET "continent" = CASE "code"
  WHEN 'EU' THEN 'Europe'
  WHEN 'CH' THEN 'Europe'
  WHEN 'FR' THEN 'Europe'
  WHEN 'DE' THEN 'Europe'
  WHEN 'SE' THEN 'Europe'
  WHEN 'ES' THEN 'Europe'
  WHEN 'PL' THEN 'Europe'
  WHEN 'BR' THEN 'South America'
  WHEN 'UAE' THEN 'Asia'
  WHEN 'IL' THEN 'Asia'
  WHEN 'US' THEN 'North America'
  WHEN 'IN' THEN 'Asia'
  WHEN 'PK' THEN 'Asia'
  WHEN 'BD' THEN 'Asia'
  WHEN 'AU' THEN 'Oceania'
  WHEN 'NZ' THEN 'Oceania'
  WHEN 'UK' THEN 'Europe'
  WHEN 'CA' THEN 'North America'
  WHEN 'CN' THEN 'Asia'
  WHEN 'JP' THEN 'Asia'
  WHEN 'KR' THEN 'Asia'
  WHEN 'TW' THEN 'Asia'
  WHEN 'IR' THEN 'Asia'
  WHEN 'MY' THEN 'Asia'
  WHEN 'RU' THEN 'Europe'
  WHEN 'MX' THEN 'North America'
  WHEN 'SA' THEN 'Asia'
  WHEN 'ZA' THEN 'Africa'
  ELSE "continent"
END;
