import { describe, it, expect } from 'vitest'

import { buildUnitsById, deriveOrgLabels } from '@/lib/orgUnits/labels'

/**
 * school/department are baked into buildResearcherProfileNormalizedText, so
 * they feed every profile embedding. Their derivation rule is pinned here.
 */

const ROOT = { id: 'root', name: 'School of Engineering', path: ['root'], depth: 0 }
const MID = { id: 'mid', name: 'Civil Division', path: ['root', 'mid'], depth: 1 }
const LEAF = { id: 'leaf', name: 'Structures', path: ['root', 'mid', 'leaf'], depth: 2 }

const unitsById = buildUnitsById([ROOT, MID, LEAF])

describe('deriveOrgLabels', () => {
  it('treats a root unit as the school with no department', () => {
    expect(deriveOrgLabels(ROOT, unitsById)).toEqual({
      school: 'School of Engineering',
      department: null,
      pathNames: ['School of Engineering'],
    })
  })

  it('keeps the two-level case byte-identical to the old behaviour', () => {
    expect(deriveOrgLabels(MID, unitsById)).toEqual({
      school: 'School of Engineering',
      department: 'Civil Division',
      pathNames: ['School of Engineering', 'Civil Division'],
    })
  })

  it('reports the root as school and the OWN unit as department at depth 3', () => {
    // The middle level is not lost — it stays in path/pathNames for breadcrumbs.
    expect(deriveOrgLabels(LEAF, unitsById)).toEqual({
      school: 'School of Engineering',
      department: 'Structures',
      pathNames: ['School of Engineering', 'Civil Division', 'Structures'],
    })
  })

  it('returns empty labels for an unplaced profile', () => {
    expect(deriveOrgLabels(null, unitsById)).toEqual({
      school: null,
      department: null,
      pathNames: [],
    })
  })

  it('survives a missing ancestor row rather than producing a hole', () => {
    const orphanParent = { id: 'x', name: 'Lab', path: ['gone', 'x'], depth: 1 }
    const labels = deriveOrgLabels(orphanParent, buildUnitsById([orphanParent]))
    expect(labels.department).toBe('Lab')
    expect(labels.pathNames).toEqual(['Lab'])
  })
})
