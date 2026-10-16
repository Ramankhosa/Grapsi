/**
 * Loads Seed/currency-rates.csv into currency_rates (upsert on currency + date).
 *
 * The rates are a static reference snapshot used only for "≈ USD" estimates
 * shown beside an award's own currency. Refresh the CSV (new as_of date)
 * before relying on cross-currency comparisons; older rows are kept so every
 * estimate can say which rate and date it used.
 *
 *   node ./node_modules/tsx/dist/cli.cjs scripts/seed-currency-rates.ts
 */
import fs from 'node:fs'
import path from 'node:path'

import prisma from '../src/lib/prisma'

async function main() {
  const lines = fs.readFileSync(path.resolve('Seed/currency-rates.csv'), 'utf8').split(/\r?\n/).filter(Boolean)
  let written = 0
  for (const line of lines.slice(1)) {
    const [currency, rate, asOf, ...source] = line.split(',')
    const usdPerUnit = Number(rate)
    if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(usdPerUnit) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      console.warn(`Skipping malformed row: ${line}`)
      continue
    }
    const as_of = new Date(`${asOf}T00:00:00.000Z`)
    await prisma.currencyRate.upsert({
      where: { currency_as_of: { currency, as_of } },
      update: { usd_per_unit: usdPerUnit, source: source.join(',') },
      create: { currency, usd_per_unit: usdPerUnit, as_of, source: source.join(',') },
    })
    written++
  }
  console.log(`currency_rates: ${written} rows upserted.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
