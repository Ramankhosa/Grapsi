import prisma from '../prisma';
import { normalizeHeader, parseTabularUpload } from '../spreadsheet/parseTabularUpload';
import { researcherProfileService } from './researcherProfileService';

/**
 * Bulk faculty roster import for a tenant.
 *
 * Each row is placed into the tenant's School -> Department hierarchy and
 * upserted as a User + ResearcherProfile. Profiles are embedded inline (best
 * effort) so imported faculty are immediately matchable; anything that fails or
 * exceeds the inline cap is left to the existing embedding backfill.
 */

/** Inline embedding is a paid, rate-limited call — beyond this, defer to backfill. */
const MAX_INLINE_EMBEDDINGS = 200;
const MULTI_VALUE_SEPARATOR = /[;,|]/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['name', 'fullname', 'facultyname', 'employeename', 'staffname'],
  email: ['email', 'emailaddress', 'officialemail', 'emailid'],
  school: ['school', 'schoolname', 'college', 'collegename'],
  department: ['department', 'departmentname', 'dept'],
  designation: ['designation', 'title', 'position', 'rank'],
  researchAreas: ['researchareas', 'researcharea', 'areasofresearch', 'specialization', 'specialisation'],
  keywords: ['keywords', 'keyword', 'expertise'],
  researchSummary: ['researchsummary', 'summary', 'profilesummary', 'bio', 'about'],
  careerStage: ['careerstage', 'stage'],
  country: ['country', 'countryofresidence'],
  institutionName: ['institution', 'institutionname', 'university'],
  institutionType: ['institutiontype'],
};

export const FACULTY_IMPORT_TEMPLATE_HEADERS = [
  'Name',
  'Email',
  'School',
  'Department',
  'Designation',
  'Research Areas',
  'Keywords',
  'Research Summary',
];

export interface FacultyImportOptions {
  tenantId: string;
  uploadedByUserId: string;
  filename: string;
  buffer: Buffer;
  autoCreateUnits: boolean;
  dryRun: boolean;
}

export interface FacultyImportRowResult {
  rowNumber: number;
  name: string;
  email: string;
  school: string;
  department: string;
  outcome: 'created' | 'updated' | 'error';
  message?: string;
}

export interface FacultyImportSummary {
  dryRun: boolean;
  totalRows: number;
  created: number;
  updated: number;
  errors: number;
  unitsCreated: string[];
  embeddingsIndexed: number;
  embeddingsPending: number;
  results: FacultyImportRowResult[];
  jobId: string | null;
}

function splitList(value: string) {
  return Array.from(
    new Set(
      (value || '')
        .split(MULTI_VALUE_SEPARATOR)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

/** Maps each canonical field to the normalized header actually present. */
function buildColumnMap(headers: string[]) {
  const present = new Set(headers.map(normalizeHeader).filter(Boolean));
  const map: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const match = aliases.find((alias) => present.has(alias));
    if (match) {
      map[field] = match;
    }
  }
  return map;
}

export async function importFacultyRoster(options: FacultyImportOptions): Promise<FacultyImportSummary> {
  const { tenantId, uploadedByUserId, filename, buffer, autoCreateUnits, dryRun } = options;

  const sheet = parseTabularUpload(buffer, filename);
  const columns = buildColumnMap(sheet.headers);

  if (!columns.name || !columns.email) {
    throw new Error(
      `The file must include "Name" and "Email" columns. Columns found: ${sheet.headers.filter(Boolean).join(', ') || 'none'}.`
    );
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });

  // Case-insensitive lookup of the tenant's existing hierarchy.
  const existingUnits = await prisma.tenantOrgUnit.findMany({
    where: { tenant_id: tenantId },
    select: { id: true, name: true, kind: true, parent_id: true },
  });
  const schoolsByName = new Map<string, { id: string; name: string }>();
  const departmentsByKey = new Map<string, { id: string; name: string }>();
  for (const unit of existingUnits) {
    if (unit.kind === 'SCHOOL') {
      schoolsByName.set(unit.name.trim().toLowerCase(), { id: unit.id, name: unit.name });
    } else {
      departmentsByKey.set(`${unit.parent_id || ''}::${unit.name.trim().toLowerCase()}`, {
        id: unit.id,
        name: unit.name,
      });
    }
  }

  const results: FacultyImportRowResult[] = [];
  const unitsCreated: string[] = [];
  const touchedUserIds: string[] = [];
  let created = 0;
  let updated = 0;
  let errors = 0;

  const read = (row: Record<string, string>, field: string) =>
    columns[field] ? (row[columns[field]] || '').trim() : '';

  for (let index = 0; index < sheet.rows.length; index += 1) {
    const row = sheet.rows[index];
    // +2: one for the header row, one to make it 1-based like a spreadsheet.
    const rowNumber = index + 2;

    const name = read(row, 'name');
    const email = read(row, 'email').toLowerCase();
    const schoolName = read(row, 'school');
    const departmentName = read(row, 'department');

    if (!name && !email && !schoolName && !departmentName) {
      continue;
    }

    const base = { rowNumber, name, email, school: schoolName, department: departmentName };
    const fail = (message: string) => {
      results.push({ ...base, outcome: 'error', message });
      errors += 1;
    };

    if (!name) {
      fail('Name is required.');
      continue;
    }
    if (!email || !EMAIL_PATTERN.test(email)) {
      fail('A valid email address is required.');
      continue;
    }

    try {
      // --- Resolve School -> Department ------------------------------------
      let schoolId: string | null = null;
      let resolvedSchoolName = '';
      if (schoolName) {
        const key = schoolName.toLowerCase();
        const existing = schoolsByName.get(key);
        if (existing) {
          schoolId = existing.id;
          resolvedSchoolName = existing.name;
        } else if (!autoCreateUnits) {
          fail(`School "${schoolName}" does not exist. Create it first or enable auto-create.`);
          continue;
        } else {
          resolvedSchoolName = schoolName;
          if (dryRun) {
            schoolId = `pending:${key}`;
          } else {
            const unit = await prisma.tenantOrgUnit.create({
              data: { tenant_id: tenantId, kind: 'SCHOOL', name: schoolName, parent_id: null },
              select: { id: true, name: true },
            });
            schoolId = unit.id;
            schoolsByName.set(key, unit);
          }
          unitsCreated.push(`School: ${schoolName}`);
        }
      }

      let departmentId: string | null = null;
      let resolvedDepartmentName = '';
      if (departmentName) {
        if (!schoolId) {
          fail('A School is required when a Department is given.');
          continue;
        }
        const key = `${schoolId}::${departmentName.toLowerCase()}`;
        const existing = departmentsByKey.get(key);
        if (existing) {
          departmentId = existing.id;
          resolvedDepartmentName = existing.name;
        } else if (!autoCreateUnits) {
          fail(`Department "${departmentName}" does not exist under "${schoolName}". Create it first or enable auto-create.`);
          continue;
        } else {
          resolvedDepartmentName = departmentName;
          if (dryRun) {
            departmentId = `pending:${key}`;
          } else {
            const unit = await prisma.tenantOrgUnit.create({
              data: { tenant_id: tenantId, kind: 'DEPARTMENT', name: departmentName, parent_id: schoolId },
              select: { id: true, name: true },
            });
            departmentId = unit.id;
            departmentsByKey.set(key, unit);
          }
          unitsCreated.push(`Department: ${schoolName} / ${departmentName}`);
        }
      }

      // --- Upsert the user --------------------------------------------------
      const existingUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true, tenantId: true, name: true },
      });

      if (existingUser && existingUser.tenantId && existingUser.tenantId !== tenantId) {
        fail('This email already belongs to a different organization.');
        continue;
      }

      const isNew = !existingUser;
      if (dryRun) {
        results.push({ ...base, outcome: isNew ? 'created' : 'updated' });
        if (isNew) created += 1;
        else updated += 1;
        continue;
      }

      const researchAreas = splitList(read(row, 'researchAreas'));
      const keywords = splitList(read(row, 'keywords'));
      const researchSummary = read(row, 'researchSummary');
      const designation = read(row, 'designation');
      const careerStage = read(row, 'careerStage');
      const country = read(row, 'country');
      const institutionName = read(row, 'institutionName') || tenant?.name || null;
      const institutionType = read(row, 'institutionType');

      const userId = await prisma.$transaction(async (tx) => {
        const user = existingUser
          ? await tx.user.update({
              where: { id: existingUser.id },
              data: {
                name: name || existingUser.name,
                // Adopt an untenanted account into this tenant.
                tenantId: existingUser.tenantId || tenantId,
              },
              select: { id: true },
            })
          : await tx.user.create({
              // No passwordHash: imported faculty are seeded accounts that
              // activate through the existing invite / password-reset flow.
              data: { email, name, tenantId, roles: ['ANALYST'], status: 'ACTIVE' },
              select: { id: true },
            });

        const profileData = {
          display_name: name,
          department: resolvedDepartmentName || null,
          school: resolvedSchoolName || null,
          designation: designation || null,
          org_unit_id: departmentId,
          research_areas: researchAreas,
          keywords,
          research_summary: researchSummary || null,
          institution_name: institutionName,
          institution_type: institutionType || null,
          career_stage: careerStage || null,
          country_of_residence: country || null,
        };

        await tx.researcherProfile.upsert({
          where: { user_id: user.id },
          create: { user_id: user.id, ...profileData },
          update: profileData,
        });

        return user.id;
      });

      touchedUserIds.push(userId);
      results.push({ ...base, outcome: isNew ? 'created' : 'updated' });
      if (isNew) created += 1;
      else updated += 1;
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }

  // --- Embeddings (best effort, outside the row transactions) ---------------
  let embeddingsIndexed = 0;
  const inlineTargets = touchedUserIds.slice(0, MAX_INLINE_EMBEDDINGS);
  for (const userId of inlineTargets) {
    try {
      const indexed = await researcherProfileService.indexResearcherProfileEmbedding(userId);
      if (indexed) {
        embeddingsIndexed += 1;
      }
    } catch (error) {
      console.warn(
        'Faculty import: embedding failed for user',
        userId,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  let jobId: string | null = null;
  if (!dryRun) {
    const job = await prisma.facultyImportJob.create({
      data: {
        tenant_id: tenantId,
        uploaded_by: uploadedByUserId,
        filename: filename || null,
        total_rows: results.length,
        created_count: created,
        updated_count: updated,
        error_count: errors,
        report_json: { unitsCreated, results: results.slice(0, 500) } as any,
      },
      select: { id: true },
    });
    jobId = job.id;
  }

  return {
    dryRun,
    totalRows: results.length,
    created,
    updated,
    errors,
    unitsCreated: Array.from(new Set(unitsCreated)),
    embeddingsIndexed,
    embeddingsPending: Math.max(0, touchedUserIds.length - embeddingsIndexed),
    results,
    jobId,
  };
}
