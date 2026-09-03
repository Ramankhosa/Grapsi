import { loadActiveAreas } from '@/lib/funding/disciplineClassifier'
import { isGroupArea, matchAreas, type MatchableArea } from '@/lib/funding/disciplineMatcher'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import { listSubtreeUnitIds } from './tree'

/**
 * Proposing research areas for an org unit, from whatever data a tenant
 * actually has.
 *
 * Tenants arrive with wildly different data. Some import a faculty roster rich
 * with research areas; some import names and emails only. Some name their units
 * "Department of Chemistry"; some name them "Lovely Faculty of Technology and
 * Sciences". A single strategy would work beautifully for one and not at all
 * for the next.
 *
 * So this is a ladder. Each rung needs different data, and returns either a
 * SPECIFIC answer (a named level-2 area) or a BROAD one (a whole discipline
 * group). We take the first specific answer; failing that, the best broad one.
 * A broad answer is less accurate but still correct — and relevance already
 * understands it, because a group mapping matches every call in that group at
 * the `broad` tier. The floor is therefore "this unit is Engineering, we don't
 * know which kind", which is worth far more than nothing.
 *
 * Nothing here writes. Suggestions are proposals until an admin confirms them,
 * so a mapping in the database always means somebody looked at it.
 */

export const SUGGEST_STRATEGIES = [
  /** The unit's own name, and its ancestors' names as weaker context. */
  'name',
  /** What people in the unit say they research. Needs populated profiles. */
  'faculty_areas',
  /** The free-text department on each profile. Often present when areas are not. */
  'faculty_departments',
  /** What this unit has actually been assigned before. Needs history. */
  'assignments',
  /** Inherit the parent's confirmed mapping. Needs the parent mapped first. */
  'ancestor',
] as const

export type SuggestStrategy = (typeof SUGGEST_STRATEGIES)[number]

/**
 * Default order. Name first because a unit called "School of Pharmacy" IS
 * pharmacy definitionally, whereas faculty areas can be skewed by one prolific
 * person. Everything after that is a fallback for units whose name says nothing.
 */
export const DEFAULT_LADDER: SuggestStrategy[] = [
  'name',
  'faculty_areas',
  'faculty_departments',
  'assignments',
  'ancestor',
]

export interface SuggestOptions {
  /** Which rungs to try, in order. Defaults to DEFAULT_LADDER. */
  strategies?: SuggestStrategy[]
  /** Drop anything below this. Default 0 — the ladder's own thresholds govern. */
  minConfidence?: number
  /** Cap per unit. Default 4. */
  maxAreas?: number
  /**
   * Accept a whole-group answer when no rung produced a specific one.
   * Default true — this is the "correct in general" floor. Turn it off to see
   * only confident, specific proposals.
   */
  allowBroad?: boolean
}

export interface AreaSuggestion {
  taxonomyAreaId: string
  label: string
  level1Name: string
  level2Name: string
  confidence: number
  matchedTerms: string[]
  breadth: 'specific' | 'broad'
  alreadyMapped: boolean
}

/** What data this unit actually had, so a thin result can explain itself. */
export interface UnitDataProfile {
  faculty: number
  profilesWithAreas: number
  profilesWithDepartment: number
  assignments: number
  parentMapped: boolean
}

export interface UnitSuggestion {
  unitId: string
  name: string
  depth: number
  parentId: string | null
  /** Areas already confirmed on this unit; a non-empty list means "mapped". */
  existingAreas: number
  strategy: SuggestStrategy | null
  /** Plain sentence naming the evidence, shown beside the row. */
  evidence: string
  coverage: 'specific' | 'broad' | 'none'
  suggestions: AreaSuggestion[]
  data: UnitDataProfile
}

interface Ctx {
  tenantId: string
  areas: MatchableArea[]
  areaById: Map<string, MatchableArea>
  groupByLevel1: Map<string, MatchableArea>
}

function labelFor(area: MatchableArea): string {
  return area.level2Name ? `${area.level1Name} → ${area.level2Name}` : area.level1Name
}

interface RungResult {
  matches: ReturnType<typeof matchAreas>
  evidence: string
}

/**
 * Reduce any rung's matches to a whole-group answer.
 *
 * When the evidence points at several areas of one group but none convincingly,
 * naming the group is the honest summary. Used as the floor of the ladder.
 */
function collapseToGroup(ctx: Ctx, result: RungResult): RungResult | null {
  if (result.matches.length === 0) return null

  const counts = new Map<string, number>()
  for (const match of result.matches) {
    const area = ctx.areaById.get(match.areaId)
    if (!area) continue
    counts.set(area.level1Code, (counts.get(area.level1Code) || 0) + match.score)
  }
  const best = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]
  if (!best) return null

  const group = ctx.groupByLevel1.get(best[0])
  if (!group) return null

  return {
    matches: [
      {
        areaId: group.id,
        score: best[1],
        confidence: Math.min(0.5, Math.round((best[1] / 16) * 100) / 100),
        matchedTerms: [],
        breadth: 'broad' as const,
      },
    ],
    evidence: `${result.evidence}, narrowed only to ${group.level1Name}`,
  }
}

async function rungName(
  ctx: Ctx,
  unit: { id: string; name: string }
): Promise<RungResult> {
  const ancestors = await prisma.$queryRaw<Array<{ name: string }>>(Prisma.sql`
    SELECT ancestor.name
      FROM tenant_org_units self
      CROSS JOIN LATERAL unnest(self.path) AS p(ancestor_id)
      INNER JOIN tenant_org_units ancestor ON ancestor.id = p.ancestor_id
     WHERE self.id = ${unit.id}
       AND ancestor.id <> self.id
  `)
  return {
    matches: matchAreas(
      { title: unit.name, body: ancestors.map((row) => row.name).join(' ') },
      ctx.areas
    ),
    evidence: `Matched the name "${unit.name}"`,
  }
}

async function rungFacultyAreas(ctx: Ctx, scopeIds: string[]): Promise<RungResult> {
  const profiles = await prisma.researcherProfile.findMany({
    where: { org_unit_id: { in: scopeIds } },
    select: { research_areas: true, keywords: true },
  })
  const tags: string[] = []
  let contributing = 0
  for (const profile of profiles) {
    const own = [...(profile.research_areas || []), ...(profile.keywords || [])]
    if (own.length > 0) contributing += 1
    tags.push(...own)
  }
  return {
    matches: tags.length > 0 ? matchAreas({ tags }, ctx.areas) : [],
    evidence: `Aggregated the research areas of ${contributing} of ${profiles.length} people here`,
  }
}

async function rungFacultyDepartments(ctx: Ctx, scopeIds: string[]): Promise<RungResult> {
  // A roster imported with a Department column but no Research Areas column is
  // extremely common — this rung is what keeps such a tenant working.
  const profiles = await prisma.researcherProfile.findMany({
    where: { org_unit_id: { in: scopeIds }, department: { not: null } },
    select: { department: true },
  })
  const tags = profiles.map((row) => row.department!).filter(Boolean)
  return {
    matches: tags.length > 0 ? matchAreas({ tags }, ctx.areas) : [],
    evidence: `Read the department named on ${tags.length} profile${tags.length === 1 ? '' : 's'}`,
  }
}

async function rungAssignments(ctx: Ctx, scopeIds: string[]): Promise<RungResult> {
  // What this unit has actually been put on before. Behavioural rather than
  // declared, so it is right about an established tenant even when the profiles
  // and the unit names are both uninformative.
  const rows = await prisma.$queryRaw<Array<{ disciplines: string[] }>>(Prisma.sql`
    SELECT fc.disciplines
      FROM call_assignments ca
      INNER JOIN funding_calls fc ON fc.id = ca.funding_call_id
     WHERE ca.tenant_id = ${ctx.tenantId}
       AND ca.assignee_org_unit_id = ANY(ARRAY[${Prisma.join(
         scopeIds.map((id) => Prisma.sql`${id}`)
       )}]::text[])
       AND ca.status NOT IN ('CANCELLED', 'DECLINED')
     LIMIT 200
  `)
  const tags = rows.flatMap((row) => row.disciplines || [])
  return {
    matches: tags.length > 0 ? matchAreas({ tags }, ctx.areas) : [],
    evidence: `Derived from ${rows.length} call${rows.length === 1 ? '' : 's'} this unit has worked on`,
  }
}

async function rungAncestor(ctx: Ctx, unitId: string): Promise<RungResult> {
  // The parent's confirmed mapping. Coarse but never wrong in kind: a
  // department inside a mapped School of Pharmacy is pharmacy-ish by construction.
  const rows = await prisma.$queryRaw<Array<{ taxonomy_area_id: string; name: string }>>(Prisma.sql`
    SELECT ra.taxonomy_area_id, ancestor.name
      FROM tenant_org_units self
      CROSS JOIN LATERAL unnest(self.path) AS p(ancestor_id)
      INNER JOIN tenant_org_units ancestor ON ancestor.id = p.ancestor_id
      INNER JOIN tenant_org_unit_research_areas ra ON ra.org_unit_id = ancestor.id
     WHERE self.id = ${unitId}
       AND ancestor.id <> self.id
     LIMIT 20
  `)
  if (rows.length === 0) return { matches: [], evidence: '' }

  return {
    matches: rows.map((row) => ({
      areaId: row.taxonomy_area_id,
      score: 2,
      confidence: 0.4,
      matchedTerms: [],
      breadth: (ctx.areaById.get(row.taxonomy_area_id) &&
      isGroupArea(ctx.areaById.get(row.taxonomy_area_id)!)
        ? 'broad'
        : 'specific') as 'specific' | 'broad',
    })),
    evidence: `Inherited from ${rows[0].name}`,
  }
}

/**
 * Suggest areas for a set of units, climbing the ladder for each.
 *
 * One pass over the units; each rung is only run if the ones before it failed,
 * so a tenant with clean unit names never pays for the faculty queries.
 */
export async function suggestAreasForUnits(
  tenantId: string,
  unitIds: string[],
  options: SuggestOptions = {}
): Promise<UnitSuggestion[]> {
  const {
    strategies = DEFAULT_LADDER,
    minConfidence = 0,
    maxAreas = 4,
    allowBroad = true,
  } = options

  const areas = await loadActiveAreas()
  if (areas.length === 0) return []

  const ctx: Ctx = {
    tenantId,
    areas,
    areaById: new Map(areas.map((area) => [area.id, area])),
    groupByLevel1: new Map(
      areas.filter(isGroupArea).map((area) => [area.level1Code, area])
    ),
  }

  const units = await prisma.tenantOrgUnit.findMany({
    where: { id: { in: unitIds }, tenant_id: tenantId, is_active: true },
    select: { id: true, name: true, depth: true, parent_id: true },
    orderBy: [{ depth: 'desc' }, { name: 'asc' }],
  })

  const existing = await prisma.$queryRaw<Array<{ org_unit_id: string; count: number }>>(Prisma.sql`
    SELECT org_unit_id, COUNT(*)::int AS count
      FROM tenant_org_unit_research_areas
     WHERE tenant_id = ${tenantId}
     GROUP BY org_unit_id
  `)
  const existingByUnit = new Map(existing.map((row) => [row.org_unit_id, row.count]))

  const results: UnitSuggestion[] = []

  for (const unit of units) {
    const subtree = await listSubtreeUnitIds(tenantId, [unit.id])
    const scopeIds = subtree.length > 0 ? subtree : [unit.id]

    const alreadyMapped = new Set(
      (
        await prisma.$queryRaw<Array<{ taxonomy_area_id: string }>>(Prisma.sql`
          SELECT taxonomy_area_id FROM tenant_org_unit_research_areas
           WHERE org_unit_id = ${unit.id}
        `)
      ).map((row) => row.taxonomy_area_id)
    )

    let chosen: RungResult | null = null
    let chosenStrategy: SuggestStrategy | null = null
    let bestBroad: { result: RungResult; strategy: SuggestStrategy } | null = null

    for (const strategy of strategies) {
      let rung: RungResult
      if (strategy === 'name') rung = await rungName(ctx, unit)
      else if (strategy === 'faculty_areas') rung = await rungFacultyAreas(ctx, scopeIds)
      else if (strategy === 'faculty_departments') rung = await rungFacultyDepartments(ctx, scopeIds)
      else if (strategy === 'assignments') rung = await rungAssignments(ctx, scopeIds)
      else rung = await rungAncestor(ctx, unit.id)

      const specific = rung.matches.filter((match) => match.breadth === 'specific')
      if (specific.length > 0) {
        chosen = { matches: specific, evidence: rung.evidence }
        chosenStrategy = strategy
        break
      }
      // No specific answer here — remember the coarsest thing this rung could
      // still say, in case no later rung does better.
      if (!bestBroad) {
        const broad = rung.matches.length > 0 ? rung : collapseToGroup(ctx, rung)
        if (broad && broad.matches.length > 0) bestBroad = { result: broad, strategy }
      }
    }

    if (!chosen && allowBroad && bestBroad) {
      chosen = bestBroad.result
      chosenStrategy = bestBroad.strategy
    }

    const [faculty, withAreas, withDept, assignmentCount, parentMapped] = await Promise.all([
      prisma.researcherProfile.count({ where: { org_unit_id: { in: scopeIds } } }),
      prisma.researcherProfile.count({
        where: { org_unit_id: { in: scopeIds }, research_areas: { isEmpty: false } },
      }),
      prisma.researcherProfile.count({
        where: { org_unit_id: { in: scopeIds }, department: { not: null } },
      }),
      prisma.callAssignment.count({
        where: { tenant_id: tenantId, assignee_org_unit_id: { in: scopeIds } },
      }),
      unit.parent_id
        ? prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
            SELECT COUNT(*)::int AS count FROM tenant_org_unit_research_areas
             WHERE org_unit_id = ${unit.parent_id}
          `).then((rows) => (rows[0]?.count ?? 0) > 0)
        : Promise.resolve(false),
    ])

    const suggestions: AreaSuggestion[] = (chosen?.matches ?? [])
      .filter((match) => match.confidence >= minConfidence)
      .slice(0, maxAreas)
      .map((match) => {
        const area = ctx.areaById.get(match.areaId)
        return {
          taxonomyAreaId: match.areaId,
          label: area ? labelFor(area) : match.areaId,
          level1Name: area?.level1Name ?? '',
          level2Name: area?.level2Name ?? '',
          confidence: match.confidence,
          matchedTerms: match.matchedTerms,
          breadth: match.breadth,
          alreadyMapped: alreadyMapped.has(match.areaId),
        }
      })

    results.push({
      unitId: unit.id,
      name: unit.name,
      depth: unit.depth,
      parentId: unit.parent_id,
      existingAreas: existingByUnit.get(unit.id) ?? 0,
      strategy: suggestions.length > 0 ? chosenStrategy : null,
      evidence:
        suggestions.length > 0
          ? chosen!.evidence
          : 'Nothing in the name, the profiles or the history identified a discipline',
      coverage:
        suggestions.length === 0
          ? 'none'
          : suggestions.every((row) => row.breadth === 'broad')
            ? 'broad'
            : 'specific',
      suggestions,
      data: {
        faculty,
        profilesWithAreas: withAreas,
        profilesWithDepartment: withDept,
        assignments: assignmentCount,
        parentMapped,
      },
    })
  }

  return results
}

/** Every active unit with no confirmed mapping yet. */
export async function listUnmappedUnitIds(tenantId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT u.id
      FROM tenant_org_units u
     WHERE u.tenant_id = ${tenantId}
       AND u.is_active = true
       AND NOT EXISTS (
         SELECT 1 FROM tenant_org_unit_research_areas ra WHERE ra.org_unit_id = u.id
       )
     ORDER BY u.depth DESC, u.name ASC
  `)
  return rows.map((row) => row.id)
}
