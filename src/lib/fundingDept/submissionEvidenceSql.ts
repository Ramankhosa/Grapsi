import { Prisma } from '@/lib/prisma-generated'

export function hasSubmissionEvidenceSql(alias = 'a'): Prisma.Sql {
  const a = Prisma.raw(alias)
  return Prisma.sql`(NULLIF(btrim(${a}.submission_reference),'') IS NOT NULL OR NULLIF(btrim(${a}.submission_url),'') IS NOT NULL
    OR EXISTS(SELECT 1 FROM assignment_documents proof WHERE proof.tenant_id=${a}.tenant_id AND proof.assignment_id=${a}.assignment_id AND proof.kind='PROPOSAL')
    OR EXISTS(SELECT 1 FROM grant_proposal_documents proof WHERE proof.tenant_id=${a}.tenant_id AND proof.proposal_id=${a}.proposal_id AND proof.kind='SUBMISSION_PROOF'))`
}

/** Matches managementRules.evidenceFingerprint, including sorted current proof documents. */
export function submissionFingerprintSql(alias = 'a'): Prisma.Sql {
  const a = Prisma.raw(alias)
  return Prisma.sql`encode(sha256(convert_to(
    '[' || COALESCE(to_json(to_char(${a}.submitted_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text,'null') || ',' ||
      COALESCE(to_json(NULLIF(btrim(${a}.submission_reference,E' \\t\\r\\n'),''))::text,'null') || ',' ||
      COALESCE(to_json(NULLIF(btrim(${a}.submission_url,E' \\t\\r\\n'),''))::text,'null') || ',' ||
      (SELECT '[' || COALESCE(string_agg(to_json(proof.id)::text,',' ORDER BY proof.id COLLATE "C"),'') || ']' FROM (
        SELECT d.id FROM assignment_documents d WHERE d.tenant_id=${a}.tenant_id AND d.assignment_id=${a}.assignment_id AND d.kind='PROPOSAL'
        UNION ALL SELECT d.id FROM grant_proposal_documents d WHERE d.tenant_id=${a}.tenant_id AND d.proposal_id=${a}.proposal_id AND d.kind='SUBMISSION_PROOF'
      ) proof) || ']', 'UTF8')),'hex')`
}

export function verifiedSubmissionSql(alias = 'a'): Prisma.Sql {
  const a = Prisma.raw(alias)
  return Prisma.sql`EXISTS (SELECT 1 FROM dsr_submission_verifications verification
    WHERE verification.tenant_id=${a}.tenant_id AND verification.application_id=${a}.id
      AND verification.evidence_fingerprint=${submissionFingerprintSql(alias)})`
}

/** A late-entered claim needs current evidence review before rewriting a deadline outcome.
 * Baselines and records with no change history retain their prior interpretation. */
export function trustedDeadlineSubmissionSql(end: Prisma.Sql, alias = 'a'): Prisma.Sql {
  const a = Prisma.raw(alias)
  const eventDate = Prisma.raw("NULLIF(claim.after_data->>'submitted_at','')::timestamp")
  return Prisma.sql`(
    NOT EXISTS (SELECT 1 FROM dsr_events claim WHERE claim.tenant_id=${a}.tenant_id AND claim.entity_type='APPLICATION' AND claim.entity_id=${a}.id
      AND claim.kind<>'BASELINE' AND claim.occurred_at>=${end} AND ${eventDate}=${a}.submitted_at
      AND claim.before_data->>'submitted_at' IS DISTINCT FROM claim.after_data->>'submitted_at')
    OR EXISTS (SELECT 1 FROM dsr_events claim WHERE claim.tenant_id=${a}.tenant_id AND claim.entity_type='APPLICATION' AND claim.entity_id=${a}.id
      AND claim.occurred_at<${end} AND ${eventDate}=${a}.submitted_at)
    OR ${verifiedSubmissionSql(alias)})`
}
