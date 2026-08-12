import { Prisma } from '@prisma/client';

import prisma from '../prisma';
import { deriveOrgLabels } from './labels';

/**
 * Tenant org hierarchy of arbitrary depth.
 *
 * `tenant_org_units.path` is a materialized, root-first array of ancestor ids
 * INCLUDING the unit itself, maintained by database triggers (see migration
 * 20260806160000). Subtree membership is therefore one GIN-indexed overlap:
 *
 *     WHERE path && ARRAY[<rootId>]::text[]
 *
 * which covers the root itself as well as everything beneath it. Nothing in
 * this module writes `path` or `depth` — the triggers own them, because ~150
 * scripts and the faculty importer also create units and a trigger is the one
 * thing they cannot forget. `rebuildPaths` exists to repair drift, not to be
 * part of the write path.
 */

/** Matches the guard inside the tenant_org_units_set_path trigger. */
export const MAX_ORG_DEPTH = 7;

/** Fallback level names for tenants that have not defined their own. */
const DEFAULT_LEVEL_NAMES = ['School', 'Department', 'Centre', 'Group', 'Team', 'Unit', 'Unit'];

export interface OrgUnitRecord {
  id: string;
  name: string;
  code: string | null;
  kind: string;
  parentId: string | null;
  depth: number;
  path: string[];
  levelLabel: string;
  isActive: boolean;
  /** Faculty attached to this unit alone. */
  facultyCount: number;
  /** Faculty attached to this unit or anything beneath it. */
  rollupFacultyCount: number;
}

export interface OrgUnitTreeNode extends OrgUnitRecord {
  children: OrgUnitTreeNode[];
}

export class OrgTreeError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'OrgTreeError';
  }
}

/**
 * The unit `kind` column is deprecated: depth and level_label carry the real
 * structure now. It is still written so legacy readers (which only understand
 * SCHOOL/DEPARTMENT) keep producing sensible output for shallow trees.
 */
export function kindForDepth(depth: number): 'SCHOOL' | 'DEPARTMENT' {
  return depth === 0 ? 'SCHOOL' : 'DEPARTMENT';
}

/** Tenant's own name for a depth, falling back to a sensible default. */
export function levelNameForDepth(depth: number, levels: Map<number, string>): string {
  return (
    levels.get(depth) ||
    DEFAULT_LEVEL_NAMES[Math.min(depth, DEFAULT_LEVEL_NAMES.length - 1)] ||
    'Unit'
  );
}

export async function loadLevelNames(tenantId: string): Promise<Map<number, string>> {
  const rows = await prisma.tenantOrgLevel.findMany({
    where: { tenant_id: tenantId },
    select: { depth: true, singular_name: true },
  });
  return new Map(rows.map((row) => [row.depth, row.singular_name]));
}

/**
 * Every unit in the tenant, flat, with per-unit and subtree faculty counts.
 *
 * Rollup counts are computed in one pass over the paths rather than N queries:
 * a profile attached to unit U counts toward every id in U's path.
 */
export async function listOrgUnits(tenantId: string): Promise<OrgUnitRecord[]> {
  const [units, counts, levels] = await Promise.all([
    prisma.tenantOrgUnit.findMany({
      where: { tenant_id: tenantId },
      orderBy: [{ depth: 'asc' }, { sort_order: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        code: true,
        kind: true,
        parent_id: true,
        depth: true,
        path: true,
        level_label: true,
        is_active: true,
      },
    }),
    prisma.researcherProfile.groupBy({
      by: ['org_unit_id'],
      where: { org_unit_id: { not: null }, user: { tenantId } },
      _count: { _all: true },
    }),
    loadLevelNames(tenantId),
  ]);

  const directCount = new Map<string, number>();
  for (const entry of counts) {
    if (entry.org_unit_id) directCount.set(entry.org_unit_id, entry._count._all);
  }

  const pathById = new Map(units.map((unit) => [unit.id, unit.path]));
  const rollup = new Map<string, number>();
  for (const [unitId, count] of directCount) {
    // A unit whose path is unknown (deleted mid-read) still counts for itself.
    for (const ancestorId of pathById.get(unitId) || [unitId]) {
      rollup.set(ancestorId, (rollup.get(ancestorId) || 0) + count);
    }
  }

  return units.map((unit) => ({
    id: unit.id,
    name: unit.name,
    code: unit.code,
    kind: unit.kind,
    parentId: unit.parent_id,
    depth: unit.depth,
    path: unit.path,
    levelLabel: unit.level_label || levelNameForDepth(unit.depth, levels),
    isActive: unit.is_active,
    facultyCount: directCount.get(unit.id) || 0,
    rollupFacultyCount: rollup.get(unit.id) || 0,
  }));
}

/** Nests a flat unit list into a tree. Orphans are surfaced as roots so a
 *  broken parent link can never make a unit disappear from the UI. */
export function buildTree(units: OrgUnitRecord[]): OrgUnitTreeNode[] {
  const nodes = new Map<string, OrgUnitTreeNode>();
  for (const unit of units) {
    nodes.set(unit.id, { ...unit, children: [] });
  }

  const roots: OrgUnitTreeNode[] = [];
  for (const unit of units) {
    const node = nodes.get(unit.id)!;
    const parent = unit.parentId ? nodes.get(unit.parentId) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** Ids of `rootUnitIds` and everything beneath them, tenant-guarded. */
export async function listSubtreeUnitIds(
  tenantId: string,
  rootUnitIds: string[],
  options: { activeOnly?: boolean } = {}
): Promise<string[]> {
  const roots = rootUnitIds.filter(Boolean);
  if (roots.length === 0) return [];

  const activeClause = options.activeOnly ? Prisma.sql`AND is_active = true` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM tenant_org_units
     WHERE tenant_id = ${tenantId}
       AND path && ARRAY[${Prisma.join(roots.map((id) => Prisma.sql`${id}`))}]::text[]
       ${activeClause}
  `);
  return rows.map((row) => row.id);
}

/** Users placed in any of `unitIds`. Used for notification fan-out. */
export async function listUnitUserIds(tenantId: string, unitIds: string[]): Promise<string[]> {
  if (unitIds.length === 0) return [];
  const rows = await prisma.researcherProfile.findMany({
    where: { org_unit_id: { in: unitIds }, user: { tenantId } },
    select: { user_id: true },
  });
  return rows.map((row) => row.user_id);
}

/**
 * Pre-flight for a re-parent. The trigger enforces the same rules, but raising
 * here turns an opaque 500 into a useful 400 and keeps the message in one place.
 */
export async function assertReparentAllowed(
  tenantId: string,
  unitId: string,
  newParentId: string | null
): Promise<void> {
  if (!newParentId) return;
  if (newParentId === unitId) {
    throw new OrgTreeError('A unit cannot be its own parent.');
  }

  const parent = await prisma.tenantOrgUnit.findFirst({
    where: { id: newParentId, tenant_id: tenantId },
    select: { id: true, depth: true, path: true },
  });
  if (!parent) {
    throw new OrgTreeError('Parent unit not found in your organization.', 404);
  }
  if (parent.path.includes(unitId)) {
    throw new OrgTreeError('A unit cannot be moved beneath itself.');
  }

  // The moved unit carries its own subtree with it, so the deepest descendant
  // is what has to fit under MAX_ORG_DEPTH — not the moved unit alone.
  const deepest = await prisma.$queryRaw<Array<{ max_depth: number | null }>>(Prisma.sql`
    SELECT MAX(depth) AS max_depth FROM tenant_org_units
     WHERE tenant_id = ${tenantId} AND path && ARRAY[${unitId}]::text[]
  `);
  const unit = await prisma.tenantOrgUnit.findFirst({
    where: { id: unitId, tenant_id: tenantId },
    select: { depth: true },
  });
  if (!unit) {
    throw new OrgTreeError('Org unit not found.', 404);
  }

  const subtreeHeight = (deepest[0]?.max_depth ?? unit.depth) - unit.depth;
  if (parent.depth + 1 + subtreeHeight > MAX_ORG_DEPTH - 1) {
    throw new OrgTreeError(`The hierarchy is limited to ${MAX_ORG_DEPTH} levels.`);
  }
}

/**
 * Re-derives the denormalized `school`/`department` on every profile in a
 * unit's subtree, and invalidates their cached embedding text so the next index
 * pass re-runs (both fields are baked into the profile's normalized text).
 *
 * Called after a rename OR a re-parent — a re-parent changes the root of the
 * branch, so every descendant's `school` changes with it. Replaces the old
 * DEPARTMENT-vs-else special case, which only ever looked one level down.
 *
 * Returns the user ids whose embeddings now need rebuilding.
 */
export async function refreshSubtreeProfileLabels(
  tenantId: string,
  rootUnitId: string
): Promise<string[]> {
  const units = await prisma.tenantOrgUnit.findMany({
    where: { tenant_id: tenantId },
    select: { id: true, name: true, path: true, depth: true },
  });
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const subtree = units.filter((unit) => unit.path.includes(rootUnitId));
  if (subtree.length === 0) return [];

  const affected = await prisma.researcherProfile.findMany({
    where: { org_unit_id: { in: subtree.map((unit) => unit.id) } },
    select: { user_id: true },
  });

  for (const unit of subtree) {
    const { school, department } = deriveOrgLabels(unit, unitsById);
    await prisma.researcherProfile.updateMany({
      where: { org_unit_id: unit.id },
      data: { school, department, normalized_text: null, content_hash: null },
    });
  }

  return affected.map((row) => row.user_id);
}

/**
 * Recomputes depth/path for a tenant from parent_id alone. The triggers keep
 * these correct in normal operation; this is a repair hatch and the assertion
 * target for verification scripts (trigger output must equal this).
 *
 * Returns the number of rows whose stored value was wrong.
 */
export async function rebuildPaths(tenantId: string): Promise<number> {
  const units = await prisma.tenantOrgUnit.findMany({
    where: { tenant_id: tenantId },
    select: { id: true, parent_id: true, depth: true, path: true },
  });
  const byId = new Map(units.map((unit) => [unit.id, unit]));

  const computePath = (id: string, seen = new Set<string>()): string[] => {
    if (seen.has(id)) return [id]; // cycle guard: treat as a root
    seen.add(id);
    const unit = byId.get(id);
    if (!unit || !unit.parent_id || !byId.has(unit.parent_id)) return [id];
    return [...computePath(unit.parent_id, seen), id];
  };

  let repaired = 0;
  for (const unit of units) {
    const path = computePath(unit.id);
    const depth = path.length - 1;
    if (depth !== unit.depth || JSON.stringify(path) !== JSON.stringify(unit.path)) {
      await prisma.$executeRaw`
        UPDATE tenant_org_units
           SET path = ${path}::text[], depth = ${depth}
         WHERE id = ${unit.id}
      `;
      repaired += 1;
    }
  }
  return repaired;
}
