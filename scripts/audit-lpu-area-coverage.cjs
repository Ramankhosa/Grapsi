/* Aggregate-only audit. Never prints personal records or connection settings. */
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const db = new PrismaClient({ log: [] });
  try {
    const report = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
      const target=process.argv.find(a=>a.startsWith('--tenant-id='))?.slice(12);
      const tenants = await tx.$queryRaw`SELECT t.id,t.name,t.dept_settings,
        (SELECT count(*)::int FROM users u WHERE u."tenantId"=t.id) user_count
        FROM tenants t WHERE (lower(t.name) LIKE '%lovely%' OR lower(t.name) LIKE '%lpu%')
          AND (${target || ''}='' OR t.id=${target || ''})`;
      if (tenants.length !== 1) throw new Error(`Select one LPU tenant with --tenant-id: ${JSON.stringify(tenants.map(t=>({id:t.id,name:t.name,users:t.user_count})))}`);
      const tenant = tenants[0], id = tenant.id;
      const [vocabulary] = await tx.$queryRaw`SELECT count(*)::int standard_areas,
        (SELECT count(*)::int FROM research_area_vectors) indexed_areas FROM catalogue_areas WHERE kind='discipline' AND source_key='scientify'`;
      const [people] = await tx.$queryRaw`SELECT count(*)::int users,
        count(*) FILTER(WHERE u.status='ACTIVE')::int active_users,
        count(p.id)::int profiles,
        count(*) FILTER(WHERE p.id IS NOT NULL AND u.status='ACTIVE')::int active_profiles,
        count(*) FILTER(WHERE p.org_unit_id IS NULL AND p.id IS NOT NULL)::int profiles_without_unit,
        count(*) FILTER(WHERE p.org_unit_id IS NOT NULL AND (o.id IS NULL OR NOT o.is_active OR o.tenant_id<>u."tenantId"))::int invalid_unit_profiles,
        count(*) FILTER(WHERE p.embedding_voyage_1024 IS NOT NULL)::int embedded_profiles,
        count(*) FILTER(WHERE cardinality(p.research_areas)>0)::int profiles_with_text_areas,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM researcher_saved_research_areas s JOIN effective_saved_research_area_links e ON e.saved_area_id=s.id WHERE s.user_id=u.id))::int people_with_saved_standard_links,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM research_area_classifications d JOIN research_area_classification_links l ON l.classification_id=d.id WHERE d.entity_kind='PROFILE' AND d.entity_id=u.id AND d.status='ACCEPTED' AND d.revoked_at IS NULL))::int people_with_accepted_profile_links,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM unnest(p.research_areas) r JOIN catalogue_areas a ON a.normalized_label=lower(btrim(r)) AND a.kind='discipline' AND a.source_key='scientify'))::int people_with_exact_text_standard_match
        FROM users u LEFT JOIN researcher_profiles p ON p.user_id=u.id LEFT JOIN tenant_org_units o ON o.id=p.org_unit_id WHERE u."tenantId"=${id}`;
      const [units] = await tx.$queryRaw`SELECT count(*)::int active_units,
        count(*) FILTER(WHERE o.depth=0)::int roots,
        count(*) FILTER(WHERE o.depth=0 AND o.kind::text<>'SCHOOL')::int non_school_roots,
        count(*) FILTER(WHERE cardinality(o.path)<>o.depth+1 OR o.path[o.depth+1]<>o.id OR cardinality(o.path)=0)::int invalid_paths,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM selected_org_unit_research_area_links e JOIN catalogue_areas a ON a.id=e.area_id AND a.kind='discipline' WHERE e.org_unit_id=o.id))::int units_with_selected_standard_areas,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM selected_org_unit_research_area_links e JOIN research_area_taxonomy_areas a ON a.id=e.area_id WHERE e.org_unit_id=o.id))::int units_with_selected_legacy_areas,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM research_area_classifications d WHERE d.entity_kind='ORG_UNIT' AND d.entity_id=o.id AND d.status='PROPOSED'))::int units_with_pending_proposals
        FROM tenant_org_units o WHERE o.tenant_id=${id} AND o.is_active`;
      const schools = await tx.$queryRaw`SELECT o.name,o.kind::text kind,
        (SELECT count(*)::int FROM tenant_org_units c WHERE c.tenant_id=${id} AND c.is_active AND c.path[1]=o.id) units,
        (SELECT count(*)::int FROM researcher_profiles p JOIN users u ON u.id=p.user_id JOIN tenant_org_units c ON c.id=p.org_unit_id WHERE u."tenantId"=${id} AND u.status='ACTIVE' AND c.path[1]=o.id AND c.is_active) active_people,
        (SELECT count(DISTINCT e.area_id)::int FROM selected_org_unit_research_area_links e JOIN catalogue_areas a ON a.id=e.area_id AND a.kind='discipline' JOIN tenant_org_units c ON c.id=e.org_unit_id WHERE c.tenant_id=${id} AND c.is_active AND c.path[1]=o.id) selected_standard_areas,
        (SELECT count(DISTINCT e.area_id)::int FROM effective_org_unit_research_area_links e JOIN research_area_taxonomy_areas a ON a.id=e.area_id JOIN tenant_org_units c ON c.id=e.org_unit_id WHERE c.tenant_id=${id} AND c.is_active AND c.path[1]=o.id) legacy_routing_areas,
        (SELECT count(*)::int FROM funding_dept_school_assignments s JOIN funding_dept_members m ON m.id=s.member_id WHERE s.tenant_id=${id} AND s.org_unit_id=o.id AND m.is_active) assigned_dsr_members
        FROM tenant_org_units o WHERE o.tenant_id=${id} AND o.is_active AND o.depth=0 ORDER BY o.name`;
      const [coverage] = await tx.$queryRaw`WITH labels AS (
        SELECT DISTINCT a.id FROM selected_org_unit_research_area_links e JOIN catalogue_areas a ON a.id=e.area_id AND a.kind='discipline'
        JOIN tenant_org_units o ON o.id=e.org_unit_id WHERE o.tenant_id=${id} AND o.is_active
      ) SELECT count(*)::int standard_areas_not_explicitly_selected_by_any_unit FROM catalogue_areas a
        WHERE a.kind='discipline' AND a.source_key='scientify' AND NOT EXISTS(SELECT 1 FROM labels l WHERE l.id=a.id)`;
      const textLabels = await tx.$queryRaw`SELECT r label,count(DISTINCT p.user_id)::int people,
        EXISTS(SELECT 1 FROM catalogue_areas a WHERE a.kind='discipline' AND a.normalized_label=lower(btrim(r))) exact_standard_label
        FROM researcher_profiles p JOIN users u ON u.id=p.user_id CROSS JOIN LATERAL unnest(p.research_areas) r
        WHERE u."tenantId"=${id} GROUP BY r ORDER BY people DESC,r LIMIT 15`;
      const selectedLabels = await tx.$queryRaw`SELECT a.label,count(DISTINCT o.id)::int units FROM selected_org_unit_research_area_links e
        JOIN catalogue_areas a ON a.id=e.area_id AND a.kind='discipline' JOIN tenant_org_units o ON o.id=e.org_unit_id
        WHERE o.tenant_id=${id} AND o.is_active GROUP BY a.label ORDER BY a.label`;
      const proposalSamples = await tx.$queryRaw`SELECT o.name,o.depth,d.scope,d.evidence,
        coalesce((SELECT jsonb_agg(a.label ORDER BY a.label) FROM research_area_classification_links l JOIN catalogue_areas a ON a.id=l.area_id WHERE l.classification_id=d.id),'[]') areas
        FROM tenant_org_units o JOIN research_area_classifications d ON d.entity_kind='ORG_UNIT' AND d.entity_id=o.id AND d.status='PROPOSED'
        WHERE o.tenant_id=${id} AND o.depth=0 AND o.name IN ('Biotechnology and Biosciences','Computer Science and Engineering','Pharmaceutical Sciences','Agriculture','Management') ORDER BY o.name`;
      const [catalogue] = await tx.$queryRaw`SELECT count(*)::int catalogue_only_calls,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM effective_call_research_areas e JOIN catalogue_areas a ON a.id=e.area_id AND a.kind='discipline' WHERE e.call_id=f.id))::int catalogue_calls_with_standard_areas
        FROM funding_calls f WHERE f.visibility::text='GLOBAL_CATALOG' AND coalesce(f.is_active,true)
          AND (f.status::text='PUBLISHED' OR f.catalog_status::text='PUBLISHED')`;
      const [profileVocabulary] = await tx.$queryRaw`SELECT count(DISTINCT lower(btrim(r)))::int distinct_declared_labels
        FROM researcher_profiles p JOIN users u ON u.id=p.user_id CROSS JOIN LATERAL unnest(p.research_areas) r WHERE u."tenantId"=${id}`;
      const standardAreas = await tx.$queryRaw`SELECT id,label FROM catalogue_areas WHERE source_key='scientify' AND kind='discipline' ORDER BY label`;
      const unitMappingPlan = await tx.$queryRaw`SELECT o.id,o.name,o.parent_id,o.depth,o.path,root.name school,
        (SELECT count(*)::int FROM researcher_profiles p JOIN users u ON u.id=p.user_id WHERE p.org_unit_id=o.id AND u."tenantId"=${id} AND u.status='ACTIVE') direct_people,
        coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.area_id,'label',coalesce(a.label,n.level2_name,n.level1_name),'standard',a.id IS NOT NULL) ORDER BY e.area_id)
          FROM selected_org_unit_research_area_links e LEFT JOIN catalogue_areas a ON a.id=e.area_id LEFT JOIN research_area_taxonomy_areas n ON n.id=e.area_id WHERE e.org_unit_id=o.id),'[]') selected_areas,
        (SELECT jsonb_build_object('id',d.id,'reason',d.evidence->>'reason','scope',d.scope,'needsReview',d.evidence->'needsReview','areas',
          coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'label',a.label) ORDER BY a.label) FROM research_area_classification_links l JOIN catalogue_areas a ON a.id=l.area_id WHERE l.classification_id=d.id),'[]'))
          FROM research_area_classifications d WHERE d.entity_kind='ORG_UNIT' AND d.entity_id=o.id AND d.status='PROPOSED' ORDER BY d.created_at DESC LIMIT 1) pending_llm_proposal,
        coalesce((SELECT jsonb_agg(x) FROM (SELECT r label,count(DISTINCT p.user_id)::int people FROM researcher_profiles p JOIN users u ON u.id=p.user_id
          CROSS JOIN LATERAL unnest(p.research_areas) r WHERE p.org_unit_id=o.id AND u."tenantId"=${id} AND u.status='ACTIVE' GROUP BY r ORDER BY people DESC,r LIMIT 12) x),'[]') faculty_area_evidence
        FROM tenant_org_units o LEFT JOIN tenant_org_units root ON root.id=o.path[1]
        WHERE o.tenant_id=${id} AND o.is_active ORDER BY root.name,o.depth,o.name`;
      const [calls] = await tx.$queryRaw`SELECT count(*)::int visible_published_calls,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM effective_call_research_areas e JOIN catalogue_areas a ON a.id=e.area_id AND a.kind='discipline' WHERE e.call_id=f.id))::int calls_with_standard_areas,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM dsr_call_school_mappings m WHERE m.tenant_id=${id} AND m.call_id=f.id AND m.is_active))::int calls_with_stored_school_mapping,
        count(*) FILTER(WHERE f.visibility::text='GLOBAL_PUBLISHED' AND f."tenantId" IS NOT NULL)::int global_calls_with_origin_tenant
        FROM funding_calls f WHERE coalesce(f.is_active,true) AND (f.status::text='PUBLISHED' OR f.catalog_status::text='PUBLISHED')
        AND (f.visibility::text='GLOBAL_PUBLISHED' OR (f.visibility::text='TENANT_PRIVATE' AND f."tenantId"=${id}))`;
      return { checkedAt:new Date().toISOString(), readOnly:true, tenant:{id,name:tenant.name,departmentSettings:tenant.dept_settings}, vocabulary,people,units,coverage,calls,catalogue,profileVocabulary,schools,selectedStandardLabels:selectedLabels,proposalSamples,topDeclaredProfileLabels:textLabels,standardAreas,unitMappingPlan };
    }, { timeout:120000, maxWait:10000 });
    const json = JSON.stringify(report,null,2);
    const destination=process.argv.find(a=>a.startsWith('--out='))?.slice(6);
    if(destination){fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,json+'\n');}
    console.log(json);
  } finally { await db.$disconnect(); }
}
main().catch(error=>{console.error('LPU area audit failed:',error.code || error.message);process.exitCode=1;});
