-- This migration was generated after the public-project corpus tables existed
-- locally, but its timestamp sorts before the corpus-creation migration.
-- Keep it defensive so shadow database replays do not fail before those tables
-- are created. The corpus migration creates the final index names/defaults
-- directly for fresh databases.

DO $$
BEGIN
  IF to_regclass('"public_project_crawl_items"') IS NOT NULL THEN
    ALTER TABLE "public_project_crawl_items" ALTER COLUMN "updated_at" DROP DEFAULT;
  END IF;

  IF to_regclass('"public_project_crawl_runs"') IS NOT NULL THEN
    ALTER TABLE "public_project_crawl_runs" ALTER COLUMN "updated_at" DROP DEFAULT;
  END IF;

  IF to_regclass('"public_project_participants"') IS NOT NULL THEN
    ALTER TABLE "public_project_participants" ALTER COLUMN "updated_at" DROP DEFAULT;
  END IF;

  IF to_regclass('"public_project_private_contacts"') IS NOT NULL THEN
    ALTER TABLE "public_project_private_contacts" ALTER COLUMN "updated_at" DROP DEFAULT;
  END IF;

  IF to_regclass('"public_project_sources"') IS NOT NULL THEN
    ALTER TABLE "public_project_sources" ALTER COLUMN "updated_at" DROP DEFAULT;
  END IF;

  IF to_regclass('"public_projects"') IS NOT NULL THEN
    ALTER TABLE "public_projects" ALTER COLUMN "updated_at" DROP DEFAULT;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"public_project_crawl_items_project_idx"') IS NOT NULL THEN
    ALTER INDEX "public_project_crawl_items_project_idx" RENAME TO "public_project_crawl_items_project_id_idx";
  END IF;

  IF to_regclass('"public_project_crawl_items_run_record_key"') IS NOT NULL THEN
    ALTER INDEX "public_project_crawl_items_run_record_key" RENAME TO "public_project_crawl_items_run_id_source_record_key_key";
  END IF;

  IF to_regclass('"public_project_crawl_runs_heartbeat_idx"') IS NOT NULL THEN
    ALTER INDEX "public_project_crawl_runs_heartbeat_idx" RENAME TO "public_project_crawl_runs_heartbeat_at_idx";
  END IF;

  IF to_regclass('"public_project_crawl_runs_source_status_idx"') IS NOT NULL THEN
    ALTER INDEX "public_project_crawl_runs_source_status_idx" RENAME TO "public_project_crawl_runs_source_id_status_idx";
  END IF;

  IF to_regclass('"public_project_crawl_runs_status_created_idx"') IS NOT NULL THEN
    ALTER INDEX "public_project_crawl_runs_status_created_idx" RENAME TO "public_project_crawl_runs_status_created_at_idx";
  END IF;

  IF to_regclass('"public_project_participants_institution_idx"') IS NOT NULL THEN
    ALTER INDEX "public_project_participants_institution_idx" RENAME TO "public_project_participants_institution_name_idx";
  END IF;

  IF to_regclass('"public_project_participants_project_idx"') IS NOT NULL THEN
    ALTER INDEX "public_project_participants_project_idx" RENAME TO "public_project_participants_project_id_idx";
  END IF;

  IF to_regclass('"public_project_private_contacts_project_idx"') IS NOT NULL THEN
    ALTER INDEX "public_project_private_contacts_project_idx" RENAME TO "public_project_private_contacts_project_id_idx";
  END IF;

  IF to_regclass('"public_project_private_contacts_type_idx"') IS NOT NULL THEN
    ALTER INDEX "public_project_private_contacts_type_idx" RENAME TO "public_project_private_contacts_contact_type_idx";
  END IF;

  IF to_regclass('"public_project_private_contacts_unique"') IS NOT NULL THEN
    ALTER INDEX "public_project_private_contacts_unique" RENAME TO "public_project_private_contacts_project_id_contact_type_val_key";
  END IF;

  IF to_regclass('"public_project_revisions_project_hash_key"') IS NOT NULL THEN
    ALTER INDEX "public_project_revisions_project_hash_key" RENAME TO "public_project_revisions_project_id_content_hash_key";
  END IF;

  IF to_regclass('"public_project_revisions_run_idx"') IS NOT NULL THEN
    ALTER INDEX "public_project_revisions_run_idx" RENAME TO "public_project_revisions_run_id_idx";
  END IF;

  IF to_regclass('"public_projects_institution_idx"') IS NOT NULL THEN
    ALTER INDEX "public_projects_institution_idx" RENAME TO "public_projects_primary_institution_name_idx";
  END IF;

  IF to_regclass('"public_projects_source_record_key_key"') IS NOT NULL THEN
    ALTER INDEX "public_projects_source_record_key_key" RENAME TO "public_projects_source_id_source_record_key_key";
  END IF;

  IF to_regclass('"public_projects_source_variant_idx"') IS NOT NULL THEN
    ALTER INDEX "public_projects_source_variant_idx" RENAME TO "public_projects_source_key_source_variant_idx";
  END IF;
END $$;
