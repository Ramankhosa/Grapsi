/**
 * Derives the denormalized `school` / `department` labels that live on
 * ResearcherProfile from a unit's position in an arbitrarily deep tree.
 *
 * These two columns are NOT legacy cruft to be dropped: they are baked into
 * `buildResearcherProfileNormalizedText`, so they feed every profile embedding,
 * they back the roster's ILIKE search, and they label two existing dashboard
 * group-bys whose CSV exports users already hold. Changing how they are filled
 * changes matching quality, so every writer must go through here rather than
 * setting them by hand.
 *
 * The rule at any depth:
 *   school     = name of the depth-0 ancestor (the root of the branch)
 *   department = name of the unit the person actually sits in, when depth >= 1
 *
 * In `School of Engineering > Civil Division > Structures`, a member of
 * Structures gets school "School of Engineering" and department "Structures".
 * The middle level is not lost — it lives in org_unit_id/path and is rendered
 * from the full path wherever a breadcrumb is shown.
 */

export interface OrgUnitLike {
  id: string;
  name: string;
  path: string[];
  depth: number;
}

export interface OrgLabels {
  school: string | null;
  department: string | null;
  /** Root-first names for breadcrumb display. */
  pathNames: string[];
}

export function deriveOrgLabels(
  unit: OrgUnitLike | null | undefined,
  unitsById: Map<string, { id: string; name: string }>
): OrgLabels {
  if (!unit) {
    return { school: null, department: null, pathNames: [] };
  }

  const pathNames = unit.path
    .map((id) => (id === unit.id ? unit.name : unitsById.get(id)?.name))
    .filter((name): name is string => Boolean(name));

  // A root unit is the school and has no department; anything deeper reports
  // its own name as the department.
  const school = pathNames[0] || unit.name;
  const department = unit.depth >= 1 ? unit.name : null;

  return { school, department, pathNames };
}

/** Convenience for callers that already hold the ancestor rows. */
export function buildUnitsById(
  units: Array<{ id: string; name: string }>
): Map<string, { id: string; name: string }> {
  return new Map(units.map((unit) => [unit.id, unit]));
}
