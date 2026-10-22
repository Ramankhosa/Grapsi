-- Additive classification revisions. Original calls, taxonomy, profiles,
-- assignments, source payloads and embeddings are never rewritten here.
CREATE TABLE research_area_vectors (
 area_id text PRIMARY KEY REFERENCES catalogue_areas(id) ON DELETE RESTRICT,
 embedding vector(1024) NOT NULL, input_hash text NOT NULL, model text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE research_area_classifications (
 id text PRIMARY KEY,
 entity_kind text NOT NULL CHECK (entity_kind IN ('CALL','SAVED_AREA','PROFILE','ORG_UNIT')),
 entity_id text NOT NULL, input_hash text NOT NULL,
 status text NOT NULL CHECK (status IN ('PROPOSED','ACCEPTED','REJECTED')),
 scope text NOT NULL CHECK (scope IN ('SPECIFIC','ALL','UNKNOWN')),
 source text NOT NULL, model text, prompt_version text NOT NULL,
 candidates jsonb NOT NULL DEFAULT '[]', evidence jsonb NOT NULL DEFAULT '[]',
 usage jsonb NOT NULL DEFAULT '{}', actor_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz,
 revoked_at timestamptz, revoked_by text,
 CHECK ((status = 'ACCEPTED') = (accepted_at IS NOT NULL))
);
CREATE UNIQUE INDEX research_area_classifications_current_idx
 ON research_area_classifications(entity_kind,entity_id)
 WHERE status='ACCEPTED' AND revoked_at IS NULL;
CREATE INDEX research_area_classifications_entity_idx
 ON research_area_classifications(entity_kind,entity_id,created_at);
CREATE TABLE research_area_classification_links (
 classification_id text NOT NULL REFERENCES research_area_classifications(id) ON DELETE RESTRICT,
 area_id text NOT NULL REFERENCES catalogue_areas(id) ON DELETE RESTRICT,
 PRIMARY KEY(classification_id,area_id)
);
CREATE INDEX research_area_classification_links_area_idx
 ON research_area_classification_links(area_id,classification_id);
-- Reuses the already-reviewed import direction (new label -> old area).
-- This is not an inferred inverse mapping of a broad old area to many new ones.
CREATE TABLE research_area_legacy_targets (
 area_id text NOT NULL REFERENCES catalogue_areas(id) ON DELETE RESTRICT,
 native_area_id text NOT NULL REFERENCES research_area_taxonomy_areas(id) ON DELETE RESTRICT,
 crosswalk_version text NOT NULL, PRIMARY KEY(area_id,native_area_id)
);

CREATE VIEW effective_call_research_areas AS
 SELECT d.entity_id AS call_id,l.area_id,d.source,d.id AS decision_id
 FROM research_area_classifications d
 JOIN research_area_classification_links l ON l.classification_id=d.id
 WHERE d.entity_kind='CALL' AND d.status='ACCEPTED' AND d.revoked_at IS NULL
 UNION
 SELECT ca.call_id,ca.area_id,'imported:source',NULL::text
 FROM catalogue_call_areas ca JOIN catalogue_areas a ON a.id=ca.area_id
 WHERE a.kind='subject' OR NOT EXISTS (
  SELECT 1 FROM research_area_classifications d WHERE d.entity_kind='CALL'
  AND d.entity_id=ca.call_id AND d.status='ACCEPTED' AND d.revoked_at IS NULL
 )
 UNION
 SELECT n.funding_call_id,cw.imported_area_id,'legacy:compatibility',NULL::text
 FROM funding_call_research_area_taxonomies n
 JOIN catalogue_area_crosswalk cw ON cw.native_area_id=n.taxonomy_area_id
 WHERE cw.approved_at IS NOT NULL AND cw.relation IN ('exact','broader','narrower')
 AND NOT EXISTS (SELECT 1 FROM research_area_classifications d
  WHERE d.entity_kind='CALL' AND d.entity_id=n.funding_call_id AND d.status='ACCEPTED' AND d.revoked_at IS NULL)
 AND NOT EXISTS (SELECT 1 FROM catalogue_call_areas ca JOIN catalogue_areas a ON a.id=ca.area_id
  WHERE ca.call_id=n.funding_call_id AND a.kind='discipline');

CREATE VIEW effective_saved_research_area_links AS
 SELECT d.entity_id AS saved_area_id,l.area_id
 FROM research_area_classifications d JOIN research_area_classification_links l ON l.classification_id=d.id
 WHERE d.entity_kind='SAVED_AREA' AND d.status='ACCEPTED' AND d.revoked_at IS NULL
 UNION
 SELECT s.id,cw.imported_area_id FROM researcher_saved_research_areas s
 JOIN catalogue_area_crosswalk cw ON cw.native_area_id=s.taxonomy_area_id
 WHERE cw.approved_at IS NOT NULL AND cw.relation IN ('exact','broader','narrower')
 AND NOT EXISTS (SELECT 1 FROM research_area_classifications d
  WHERE d.entity_kind='SAVED_AREA' AND d.entity_id=s.id AND d.status='ACCEPTED' AND d.revoked_at IS NULL);

CREATE VIEW effective_org_unit_research_area_links AS
 SELECT d.entity_id AS org_unit_id,l.area_id
 FROM research_area_classifications d JOIN research_area_classification_links l ON l.classification_id=d.id
 WHERE d.entity_kind='ORG_UNIT' AND d.status='ACCEPTED' AND d.revoked_at IS NULL
 UNION
 SELECT d.entity_id,retained.id FROM research_area_classifications d
 CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(d.evidence->'retainedLegacyAreaIds')='array' THEN d.evidence->'retainedLegacyAreaIds' ELSE '[]'::jsonb END) retained(id)
 JOIN research_area_taxonomy_areas a ON a.id=retained.id
 WHERE d.entity_kind='ORG_UNIT' AND d.status='ACCEPTED' AND d.revoked_at IS NULL
 UNION
 SELECT d.entity_id,t.native_area_id FROM research_area_classifications d
 JOIN research_area_classification_links l ON l.classification_id=d.id
 JOIN research_area_legacy_targets t ON t.area_id=l.area_id
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

-- User-facing selections exclude derived compatibility targets used by routing.
CREATE VIEW selected_org_unit_research_area_links AS
 SELECT d.entity_id AS org_unit_id,l.area_id FROM research_area_classifications d
 JOIN research_area_classification_links l ON l.classification_id=d.id
 WHERE d.entity_kind='ORG_UNIT' AND d.status='ACCEPTED' AND d.revoked_at IS NULL
 UNION
 SELECT d.entity_id,retained.id FROM research_area_classifications d
 CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(d.evidence->'retainedLegacyAreaIds')='array' THEN d.evidence->'retainedLegacyAreaIds' ELSE '[]'::jsonb END) retained(id)
 JOIN research_area_taxonomy_areas a ON a.id=retained.id
 WHERE d.entity_kind='ORG_UNIT' AND d.status='ACCEPTED' AND d.revoked_at IS NULL
 UNION
 SELECT n.org_unit_id,n.taxonomy_area_id FROM tenant_org_unit_research_areas n
 WHERE NOT EXISTS(SELECT 1 FROM research_area_classifications d
  WHERE d.entity_kind='ORG_UNIT' AND d.entity_id=n.org_unit_id AND d.status='ACCEPTED' AND d.revoked_at IS NULL);
