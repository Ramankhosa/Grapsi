// The award fields the search projection does not carry, loaded in one query.
//
// Extracted from ideaIntelligence/service.ts so consumers outside funding
// intelligence (the reviewer's landscape step) can load award extras without
// importing the whole service module and its provider graph.

import prisma from '@/lib/prisma'
import { projectStatus, type ProjectDelivery } from '@/lib/ideaIntelligence/whitespace'
import type { PriorWorkAwardExtras } from '@/lib/ideaIntelligence/priorWork'

function countJsonEntries(value: unknown) {
  if (Array.isArray(value)) return value.length
  // Some connectors store a keyed object rather than a list; a non-empty object
  // still means the award reported something.
  if (value && typeof value === 'object') return Object.keys(value).length
  return 0
}

/**
 * The award fields the search projection does not carry: delivery status, and
 * the patents and publications each award reported. One query, no external API
 * call — and the patent counts are a direct record, never an inference about
 * which patent came from which award.
 */
export async function loadProjectRecords(projectIds: string[], now = new Date()): Promise<{
  deliveries: ProjectDelivery[]
  extras: PriorWorkAwardExtras[]
}> {
  if (!projectIds.length) return { deliveries: [], extras: [] }
  const rows = await prisma.publicProject.findMany({
    where: { id: { in: projectIds } },
    select: {
      id: true, endDate: true, durationMonths: true, outputAchievedText: true,
      outcomes: true, patents: true, publications: true, sanctionYear: true,
    },
  })

  const deliveries = rows.map((row) => ({
    id: row.id,
    endDate: row.endDate ? row.endDate.toISOString() : null,
    durationMonths: row.durationMonths,
    hasReportedOutput: Boolean(
      (row.outputAchievedText && row.outputAchievedText.trim() && row.outputAchievedText.trim().toUpperCase() !== 'NA')
      || (Array.isArray(row.outcomes) && row.outcomes.length > 0)
    ),
  }))
  const deliveryById = new Map(deliveries.map((item) => [item.id, item]))

  return {
    deliveries,
    extras: rows.map((row): PriorWorkAwardExtras => ({
      id: row.id,
      durationMonths: row.durationMonths,
      hasReportedOutput: Boolean(deliveryById.get(row.id)?.hasReportedOutput),
      patentCount: countJsonEntries(row.patents),
      publicationCount: countJsonEntries(row.publications),
      status: projectStatus(deliveryById.get(row.id), row.sanctionYear, now),
    })),
  }
}
