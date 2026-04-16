/**
 * Backfill NULL display_order in country_section_mappings.
 *
 * Why:
 * - Older/restored data can have display_order = NULL even though supersetCode has a number.
 * - Drafting now treats displayOrder as the DB source of truth, so NULL breaks ordering.
 *
 * Usage:
 *   node scripts/backfill-country-mapping-displayorder.js IN
 *   node scripts/backfill-country-mapping-displayorder.js IN --dry-run
 */

const { PrismaClient } = require('@prisma/client')

function parseSupersetCodeOrder(supersetCode) {
  const m = String(supersetCode || '').match(/^\s*(\d+)\s*[\.\)]\s+/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

async function main() {
  const args = process.argv.slice(2)
  const countryCode = String(args[0] || '').toUpperCase()
  const dryRun = args.includes('--dry-run')

  if (!countryCode) {
    console.error('countryCode required. Example: node scripts/backfill-country-mapping-displayorder.js IN')
    process.exit(1)
  }

  const prisma = new PrismaClient()
  try {
    const rows = await prisma.countrySectionMapping.findMany({
      where: { countryCode, displayOrder: null },
      orderBy: [{ sectionKey: 'asc' }]
    })

    console.log(`[backfill-displayOrder] ${countryCode}: ${rows.length} mapping(s) with NULL displayOrder`)
    if (rows.length === 0) return

    // Build superset defaults map
    const sectionKeys = rows.map(r => r.sectionKey)
    const supersets = await prisma.supersetSection.findMany({
      where: { sectionKey: { in: sectionKeys } },
      select: { sectionKey: true, displayOrder: true }
    })
    const supersetByKey = new Map(supersets.map(s => [s.sectionKey, s.displayOrder]))

    const updates = []
    for (const r of rows) {
      const fromSuperset = supersetByKey.get(r.sectionKey)
      const fromCode = parseSupersetCodeOrder(r.supersetCode)
      const resolved = fromSuperset || fromCode
      if (!resolved) {
        console.warn(`[backfill-displayOrder] SKIP ${countryCode}/${r.sectionKey}: cannot resolve displayOrder (superset missing + supersetCode unparsable)`)
        continue
      }
      updates.push({ id: r.id, sectionKey: r.sectionKey, displayOrder: resolved })
    }

    console.log(`[backfill-displayOrder] ${countryCode}: ${updates.length} mapping(s) resolvable for update${dryRun ? ' (dry-run)' : ''}`)
    for (const u of updates) {
      console.log(`- ${countryCode}/${u.sectionKey} => displayOrder=${u.displayOrder}`)
    }

    if (dryRun) return

    for (const u of updates) {
      await prisma.countrySectionMapping.update({
        where: { id: u.id },
        data: { displayOrder: u.displayOrder }
      })
    }

    console.log(`[backfill-displayOrder] DONE ${countryCode}: updated ${updates.length} mapping(s)`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})


