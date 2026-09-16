import { randomUUID } from 'node:crypto'

import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

export type OpportunitySource = 'alert' | 'candidate' | 'assignment' | 'matching'

export async function snapshotFundingOpportunity(input: {
  tenantId: string
  fundingCallId: string
  userId: string
  orgUnitId?: string | null
  score?: number | null
  tier?: string | null
  reason?: string | null
  source: OpportunitySource
  sourceVersion?: string | null
  firstSeenAt?: Date
}): Promise<void> {
  let orgUnitId = input.orgUnitId ?? null
  if (!orgUnitId) {
    const profile = await prisma.researcherProfile.findUnique({
      where: { user_id: input.userId },
      select: { org_unit_id: true },
    })
    orgUnitId = profile?.org_unit_id ?? null
  }

  let schoolId: string | null = null
  if (orgUnitId) {
    const unit = await prisma.tenantOrgUnit.findUnique({
      where: { id: orgUnitId },
      select: { path: true },
    })
    schoolId = unit?.path?.[0] || orgUnitId
  }

  const seenAt = input.firstSeenAt ?? new Date()
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO funding_opportunity_matches (
      id, tenant_id, funding_call_id, user_id, org_unit_id, school_id,
      match_score, match_tier, match_reason, source, source_version,
      inferred, first_seen_at, last_seen_at, created_at, updated_at
    ) VALUES (
      ${`fom_${randomUUID()}`}, ${input.tenantId}, ${input.fundingCallId},
      ${input.userId}, ${orgUnitId}, ${schoolId}, ${input.score ?? null},
      ${input.tier ?? null}, ${input.reason ?? null}, ${input.source},
      ${input.sourceVersion ?? null}, false, ${seenAt}, ${seenAt}, now(), now()
    )
    ON CONFLICT (tenant_id, funding_call_id, user_id, school_id)
    DO UPDATE SET
      last_seen_at = GREATEST(funding_opportunity_matches.last_seen_at, EXCLUDED.last_seen_at),
      updated_at = now()
  `)
}

export function submissionEvidenceStatus(input: {
  reference?: string | null
  url?: string | null
  notes?: string | null
  hasDocument?: boolean
}): 'REFERENCE' | 'URL' | 'DOCUMENT' | 'NOTE' | 'MIXED' | 'MISSING' {
  const kinds = [
    Boolean(input.reference?.trim()),
    Boolean(input.url?.trim()),
    Boolean(input.hasDocument),
    Boolean(input.notes?.trim()),
  ]
  const count = kinds.filter(Boolean).length
  if (count > 1) return 'MIXED'
  if (kinds[0]) return 'REFERENCE'
  if (kinds[1]) return 'URL'
  if (kinds[2]) return 'DOCUMENT'
  if (kinds[3]) return 'NOTE'
  return 'MISSING'
}
