/**
 * Fills researcher_profiles.residence_country_code / citizenship_country_codes
 * from the country names already on each profile (migration
 * 20261016120000). New columns only, and only where they are still empty;
 * the names are untouched. Profile saves keep both in step from now on.
 *
 *   node ./node_modules/tsx/dist/cli.cjs scripts/backfill-profile-country-codes.ts [--apply]
 *
 * Dry run by default: prints how many profiles resolve and every name that
 * does not (those stay without a code, and the profile page flags them).
 * On production run it with the existing-call backfill, after the match
 * census is live: any write changes a profile's xmin, which the census treats
 * as a change and re-scores.
 */
import prisma from '../src/lib/prisma'
import { resolveCountryList } from '../src/lib/geo/countries'

async function main() {
  const apply = process.argv.includes('--apply')
  const profiles = await prisma.$queryRaw<
    Array<{ id: string; country_of_residence: string | null; citizenship_countries: string[] | null; residence_country_code: string | null; citizenship_country_codes: string[] | null }>
  >`
    SELECT id, country_of_residence, citizenship_countries, residence_country_code, citizenship_country_codes
    FROM researcher_profiles
    WHERE (residence_country_code IS NULL AND COALESCE(TRIM(country_of_residence), '') <> '')
       OR (COALESCE(cardinality(citizenship_country_codes), 0) = 0 AND COALESCE(cardinality(citizenship_countries), 0) > 0)
  `
  const unresolved = new Map<string, number>()
  let residenceSet = 0
  let citizenshipSet = 0
  for (const profile of profiles) {
    const residence = profile.residence_country_code
      ? null
      : resolveCountryList(profile.country_of_residence ? [profile.country_of_residence] : [])
    const residenceCode = residence && residence.codes.length === 1 ? residence.codes[0] : null
    for (const name of residence?.unknown || []) unresolved.set(name, (unresolved.get(name) || 0) + 1)
    const citizenship = (profile.citizenship_country_codes || []).length > 0 ? null : resolveCountryList(profile.citizenship_countries || [])
    for (const name of citizenship?.unknown || []) unresolved.set(name, (unresolved.get(name) || 0) + 1)
    const citizenshipCodes = citizenship?.codes || []
    if (residenceCode) residenceSet++
    if (citizenshipCodes.length > 0) citizenshipSet++
    if (!apply || (!residenceCode && citizenshipCodes.length === 0)) continue
    await prisma.$executeRaw`
      UPDATE researcher_profiles
      SET residence_country_code = COALESCE(residence_country_code, ${residenceCode}),
          citizenship_country_codes = CASE
            WHEN COALESCE(cardinality(citizenship_country_codes), 0) = 0 THEN ${citizenshipCodes}::text[]
            ELSE citizenship_country_codes END
      WHERE id = ${profile.id}
    `
  }
  console.log(`${profiles.length} profiles to fill: residence code ${residenceSet}, citizenship codes ${citizenshipSet}.`)
  if (unresolved.size > 0) {
    console.log(`Unresolved names (left without a code): ${Array.from(unresolved, ([name, n]) => `${name} (${n})`).join(', ')}`)
  }
  console.log(apply ? 'Written.' : 'Dry run: re-run with --apply to write.')
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
