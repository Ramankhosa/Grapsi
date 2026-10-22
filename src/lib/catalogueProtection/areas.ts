import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import type { PrismaClient } from '@/lib/prisma-generated'

export function importedAreaCondition(ids:string[],callId:Prisma.Sql=Prisma.raw('funding_calls.id')) {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM catalogue_call_areas ca WHERE ca.call_id=${callId} AND ca.area_id=ANY(${ids}::text[])
    UNION ALL
    SELECT 1 FROM funding_call_research_area_taxonomies native
    JOIN catalogue_area_crosswalk cw ON cw.native_area_id=native.taxonomy_area_id
    WHERE native.funding_call_id=${callId} AND cw.imported_area_id=ANY(${ids}::text[]) AND cw.approved_at IS NOT NULL AND cw.relation IN ('exact','broader','narrower')
  )`
}
export const LIVE_STATUS_SQL=Prisma.sql`CASE WHEN source_closed_at IS NOT NULL THEN 'CLOSED' WHEN is_rolling IS TRUE THEN 'ROLLING'
  WHEN open_date::date>(now() AT TIME ZONE 'UTC')::date THEN 'FORTHCOMING'
  WHEN coalesce(entry_closes_at,final_deadline_at,close_date::date)>=(now() AT TIME ZONE 'UTC')::date THEN 'OPEN'
  WHEN coalesce(entry_closes_at,final_deadline_at,close_date::date) IS NOT NULL THEN 'CLOSED' ELSE 'UNKNOWN' END`

/** Rebuilds only our derived index; never writes call/profile classifications. */
export async function syncCatalogueAreaIndex(db:PrismaClient=prisma) {
  return db.$transaction(async tx=>{
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE catalogue_area_input ON COMMIT DROP AS
      SELECT r.funding_call_id AS call_id,r.id AS record_id,t.kind,trim(regexp_replace(label,'\\s+',' ','g')) AS label,
        lower(trim(regexp_replace(label,'\\s+',' ','g'))) AS normalized
      FROM external_source_records r
      CROSS JOIN LATERAL (VALUES ('discipline','discipline'),('subject','my-subject')) t(kind,key)
      CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.raw_payload->'taxonomies'->t.key)='array' THEN r.raw_payload->'taxonomies'->t.key ELSE '[]'::jsonb END) label
      WHERE r.source_key='scientify' AND r.entity_type='CALL' AND r.funding_call_id IS NOT NULL AND trim(label)<>''
      UNION ALL
      SELECT id,'call-field','discipline',trim(regexp_replace(label,'\\s+',' ','g')),lower(trim(regexp_replace(label,'\\s+',' ','g')))
      FROM funding_calls CROSS JOIN LATERAL unnest(source_disciplines) label WHERE import_run_id IS NOT NULL AND trim(label)<>''`)
    await tx.$executeRawUnsafe(`INSERT INTO catalogue_areas(id,source_key,kind,label,normalized_label,version)
      SELECT 'scientify:'||kind||':'||md5(normalized),'scientify',kind,min(label),normalized,'source-v1'
      FROM catalogue_area_input GROUP BY kind,normalized ON CONFLICT(source_key,kind,normalized_label) DO NOTHING`)
    await tx.$executeRawUnsafe(`DELETE FROM catalogue_call_areas ca WHERE (ca.source_record_id='call-field' OR EXISTS(SELECT 1 FROM external_source_records r WHERE r.id=ca.source_record_id AND r.source_key='scientify'))
      AND NOT EXISTS(SELECT 1 FROM catalogue_area_input i JOIN catalogue_areas a ON a.kind=i.kind AND a.normalized_label=i.normalized AND a.source_key='scientify' WHERE i.call_id=ca.call_id AND i.record_id=ca.source_record_id AND a.id=ca.area_id)`)
    await tx.$executeRawUnsafe(`INSERT INTO catalogue_call_areas(call_id,area_id,source_record_id)
      SELECT DISTINCT i.call_id,a.id,i.record_id FROM catalogue_area_input i JOIN catalogue_areas a ON a.kind=i.kind AND a.normalized_label=i.normalized AND a.source_key='scientify'
      ON CONFLICT DO NOTHING`)
    // Exact leaf-name matches only. Broad, ambiguous and inverse mappings are
    // proposals, not implicit assertions that every child belongs to a leaf.
    await tx.$executeRawUnsafe(`INSERT INTO catalogue_area_crosswalk(native_area_id,imported_area_id,relation,approved_by,approved_at)
      SELECT n.id,a.id,'exact','system:exact-label',now() FROM research_area_taxonomy_areas n
      JOIN catalogue_areas a ON a.kind='discipline' AND a.normalized_label=lower(trim(n.level2_name))
      WHERE (SELECT count(*) FROM catalogue_areas x WHERE x.normalized_label=a.normalized_label AND x.kind='discipline')=1
        AND (SELECT count(*) FROM research_area_taxonomy_areas x WHERE x.is_active=true AND lower(trim(x.level2_name))=a.normalized_label)=1
      ON CONFLICT DO NOTHING`)
    return tx.$queryRaw<Array<{kind:string;n:number}>>`SELECT kind,count(*)::int n FROM catalogue_areas GROUP BY kind`
  },{timeout:120000})
}
