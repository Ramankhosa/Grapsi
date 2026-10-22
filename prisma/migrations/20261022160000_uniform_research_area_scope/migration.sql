-- Read-model correction only. Precise canonical selections must not acquire
-- the broad native targets used to preserve older department profiles.
-- Original department links and accepted revision history remain untouched.
CREATE OR REPLACE VIEW effective_org_unit_research_area_links AS
 SELECT d.entity_id AS org_unit_id,l.area_id
 FROM research_area_classifications d JOIN research_area_classification_links l ON l.classification_id=d.id
 WHERE d.entity_kind='ORG_UNIT' AND d.status='ACCEPTED' AND d.revoked_at IS NULL
 UNION
 SELECT d.entity_id,retained.id FROM research_area_classifications d
 CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(d.evidence->'retainedLegacyAreaIds')='array' THEN d.evidence->'retainedLegacyAreaIds' ELSE '[]'::jsonb END) retained(id)
 JOIN research_area_taxonomy_areas a ON a.id=retained.id
 WHERE d.entity_kind='ORG_UNIT' AND d.status='ACCEPTED' AND d.revoked_at IS NULL
 UNION
 SELECT n.org_unit_id,n.taxonomy_area_id FROM tenant_org_unit_research_areas n
 WHERE NOT EXISTS (SELECT 1 FROM research_area_classifications d
  WHERE d.entity_kind='ORG_UNIT' AND d.entity_id=n.org_unit_id AND d.status='ACCEPTED' AND d.revoked_at IS NULL)
 UNION
 SELECT n.org_unit_id,cw.imported_area_id FROM tenant_org_unit_research_areas n
 JOIN catalogue_area_crosswalk cw ON cw.native_area_id=n.taxonomy_area_id
 WHERE cw.approved_at IS NOT NULL AND cw.relation IN ('exact','broader','narrower')
 AND NOT EXISTS (SELECT 1 FROM research_area_classifications d
  WHERE d.entity_kind='ORG_UNIT' AND d.entity_id=n.org_unit_id AND d.status='ACCEPTED' AND d.revoked_at IS NULL);
