import { Prisma } from '@prisma/client'
import { canonicalAreasEnabled } from './core'
import { canonicalCallTaxonomiesSql, canonicalSchoolCallTaxonomiesSql } from './store'

/** All live readers use this boundary; compatibility rows are for routing or
 * an already-saved legacy selection, never for the current picker/counts. */
export function callAreaRowsSql(compatibility = false): Prisma.Sql {
  return canonicalAreasEnabled()
    ? compatibility ? canonicalSchoolCallTaxonomiesSql : canonicalCallTaxonomiesSql
    : Prisma.raw('funding_call_research_area_taxonomies')
}

export function orgAreaRowsSql(selected = false): Prisma.Sql {
  if (!canonicalAreasEnabled()) return Prisma.sql`(SELECT ra.* FROM tenant_org_unit_research_areas ra
    JOIN research_area_taxonomy_areas a ON a.id=ra.taxonomy_area_id AND a.is_active
    JOIN research_area_taxonomy_uploads u ON u.id=a.upload_id AND u.status='ACTIVE')`
  const view = Prisma.raw(selected ? 'selected_org_unit_research_area_links' : 'effective_org_unit_research_area_links')
  return Prisma.sql`(SELECT DISTINCT e.org_unit_id,e.area_id taxonomy_area_id,u.tenant_id
    FROM ${view} e JOIN tenant_org_units u ON u.id=e.org_unit_id)`
}

export function callHasAreasSql(callId: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`EXISTS(SELECT 1 FROM ${callAreaRowsSql()} current_areas WHERE current_areas.funding_call_id=${callId})`
}

/** Canonical choices and saved legacy links share accepted-call precedence.
 * A corrected call's obsolete legacy rows can never reintroduce an old error. */
export function callAreaSelectionSql(ids: string[], callId: Prisma.Sql): Prisma.Sql {
  if (!ids.length) return Prisma.sql`FALSE`
  const canonical = ids.filter(id => id.startsWith('scientify:'))
  const legacy = ids.filter(id => !id.startsWith('scientify:'))
  const choices: Prisma.Sql[] = []
  if (canonicalAreasEnabled() && canonical.length) choices.push(Prisma.sql`EXISTS(
    SELECT 1 FROM effective_call_research_areas e JOIN catalogue_areas a ON a.id=e.area_id
    WHERE e.call_id=${callId} AND (e.area_id=ANY(${canonical}::text[]) OR
      (a.kind='discipline' AND a.normalized_label='all disciplines' AND EXISTS(
        SELECT 1 FROM catalogue_areas s WHERE s.id=ANY(${canonical}::text[]) AND s.kind='discipline'))))`)
  const previous = canonicalAreasEnabled() ? legacy : ids
  if (previous.length) choices.push(Prisma.sql`EXISTS(SELECT 1 FROM ${callAreaRowsSql(true)} previous_areas
    WHERE previous_areas.funding_call_id=${callId} AND (previous_areas.taxonomy_area_id=ANY(${previous}::text[]) OR
      (previous_areas.taxonomy_level2_name='All disciplines' AND EXISTS(SELECT 1 FROM research_area_taxonomy_areas n WHERE n.id=ANY(${previous}::text[])))))`)
  return choices.length ? Prisma.sql`(${Prisma.join(choices, ' OR ')})` : Prisma.sql`FALSE`
}

/** Same All-disciplines semantics as filtering, including labels represented
 * only by a universal call. Values are metadata, not a call export. */
export function researchAreaFacetsSql(allowedIds:string[]):Prisma.Sql {
 const rows=Prisma.sql`SELECT * FROM ${callAreaRowsSql()} a WHERE a.funding_call_id=ANY(${allowedIds}::text[])`
 if(!canonicalAreasEnabled())return Prisma.sql`SELECT taxonomy_area_id,coalesce(nullif(taxonomy_level2_name,''),taxonomy_level1_name) label,count(DISTINCT funding_call_id)::int call_count FROM (${rows}) a GROUP BY taxonomy_area_id,label ORDER BY label`
 return Prisma.sql`WITH current_areas AS MATERIALIZED (${rows}),
   universal AS (SELECT DISTINCT funding_call_id FROM current_areas WHERE taxonomy_level2_name='All disciplines'),
   counts AS (SELECT taxonomy_area_id,count(DISTINCT funding_call_id)::int n FROM current_areas WHERE funding_call_id NOT IN(SELECT funding_call_id FROM universal) GROUP BY taxonomy_area_id)
  SELECT a.id taxonomy_area_id,a.label,(coalesce(c.n,0)+(SELECT count(*) FROM universal))::int call_count
  FROM catalogue_areas a LEFT JOIN counts c ON c.taxonomy_area_id=a.id WHERE a.kind='discipline' AND a.source_key='scientify' ORDER BY a.label,a.id`
}
