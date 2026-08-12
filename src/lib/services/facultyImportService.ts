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

/** Inline embedding is a paid, rate-limited call — beyond this, defer to the async worker. */
const MAX_INLINE_EMBEDDINGS = 25;
/** Hard cap so the sync loop never runs unbounded. Larger rosters must be split. */
const MAX_ROWS_PER_IMPORT = 5000;
/** Async worker batch size + per-item spacing to stay well under upstream rate limits. */
const EMBEDDING_WORKER_BATCH = 10;
const EMBEDDING_WORKER_DELAY_MS = 250;
const MULTI_VALUE_SEPARATOR = /[;,|]/;
/** Separators accepted between levels of a Unit Path cell. */
const UNIT_PATH_SEPARATOR = /\s*(?:>|\/|»|->)\s*/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Long enough for "LPU-2024-01042"-style codes, short enough to catch a pasted cell. */
const MAX_EMPLOYEE_ID_LENGTH = 32;

const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['name', 'fullname', 'facultyname', 'employeename', 'staffname'],
  email: ['email', 'emailaddress', 'officialemail', 'emailid'],
  // Deliberately excludes a bare "id" column — in most rosters that is a row
  // number, and silently storing it as a staff ID would be worse than ignoring it.
  employeeId: [
    'employeeid',
    'employeeno',
    'employeenumber',
    'employeecode',
    'empid',
    'empno',
    'empcode',
    'staffid',
    'staffno',
    'staffcode',
    'facultyid',
    'facultycode',
    'uid',
  ],
  school: ['school', 'schoolname', 'college', 'collegename'],
  department: ['department', 'departmentname', 'dept'],
  // Arbitrary-depth placement: "School of Engineering > Civil > Structures".
  // Takes precedence over School/Department when both are present.
  unitPath: ['unitpath', 'orgpath', 'organizationpath', 'organisationpath', 'hierarchy', 'orgunitpath'],
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
  'Employee ID',
  'Unit Path',
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
  employeeId: string;
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

  if (sheet.rows.length > MAX_ROWS_PER_IMPORT) {
    throw new Error(
      `That file has ${sheet.rows.length} rows. Split it into batches of ${MAX_ROWS_PER_IMPORT} or fewer.`
    );
  }

  const rawRowCount = sheet.rows.length;
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

  // Employee IDs are unique per tenant, but researcher_profiles has no
  // tenant_id so no DB constraint can express that. Snapshot the tenant's
  // current IDs (keyed lowercase) and check against it as we go.
  const employeeIdOwners = new Map<string, string>();
  if (columns.employeeId) {
    const existingProfiles = await prisma.researcherProfile.findMany({
      where: { employee_id: { not: null }, user: { tenantId } },
      select: { employee_id: true, user: { select: { email: true } } },
    });
    for (const profile of existingProfiles) {
      const key = (profile.employee_id || '').trim().toLowerCase();
      if (key) {
        employeeIdOwners.set(key, profile.user.email);
      }
    }
  }

  const results: FacultyImportRowResult[] = [];
  const unitsCreated: string[] = [];
  const touchedUserIds: string[] = [];
  const seenEmails = new Set<string>();
  let created = 0;
  let updated = 0;
  let errors = 0;

  // Generic depth-agnostic lookup keyed by parent, so a Unit Path can resolve
  // or create at any level with the same race-safe logic the two-level path
  // already used.
  const unitsByKey = new Map<string, { id: string; name: string }>();
  for (const unit of existingUnits) {
    unitsByKey.set(`${unit.parent_id || ''}::${unit.name.trim().toLowerCase()}`, {
      id: unit.id,
      name: unit.name,
    });
  }

  /**
   * Walks a "A > B > C" path, resolving or creating each level under the
   * previous one. Returns the resolved unit at every level, deepest last.
   */
  const resolveUnitPath = async (
    segments: string[]
  ): Promise<Array<{ id: string; name: string }>> => {
    const resolved: Array<{ id: string; name: string }> = [];
    let parentId: string | null = null;

    for (const [index, segment] of segments.entries()) {
      const key: string = `${parentId || ''}::${segment.toLowerCase()}`;
      const existing = unitsByKey.get(key);
      if (existing) {
        resolved.push(existing);
        parentId = existing.id;
        continue;
      }
      if (!autoCreateUnits) {
        throw new Error(
          `"${segment}" does not exist${parentId ? ' under its parent' : ''}. Create it first or enable auto-create.`
        );
      }
      if (dryRun) {
        const pending: { id: string; name: string } = { id: `pending:${key}`, name: segment };
        resolved.push(pending);
        unitsByKey.set(key, pending);
        unitsCreated.push(segments.slice(0, index + 1).join(' > '));
        parentId = pending.id;
        continue;
      }
      // Defensive re-check: a concurrent import may have created this unit
      // since `existingUnits` was snapshotted.
      const existingRow: { id: string; name: string } | null =
        await prisma.tenantOrgUnit.findFirst({
          where: {
            tenant_id: tenantId,
            parent_id: parentId,
            name: { equals: segment, mode: 'insensitive' },
          },
          select: { id: true, name: true },
        });
      const unit: { id: string; name: string } = existingRow
        ? existingRow
        : await prisma.tenantOrgUnit.create({
            data: {
              tenant_id: tenantId,
              // `kind` is deprecated; depth/path are written by the trigger.
              kind: parentId ? 'DEPARTMENT' : 'SCHOOL',
              name: segment,
              parent_id: parentId,
            },
            select: { id: true, name: true },
          });
      resolved.push(unit);
      unitsByKey.set(key, unit);
      if (!existingRow) unitsCreated.push(segments.slice(0, index + 1).join(' > '));
      parentId = unit.id;
    }

    return resolved;
  };

  const read = (row: Record<string, string>, field: string) =>
    columns[field] ? (row[columns[field]] || '').trim() : '';
  /** True if the CSV/XLSX actually contained a column for this field. */
  const hasColumn = (field: string) => Boolean(columns[field]);

  for (let index = 0; index < sheet.rows.length; index += 1) {
    const row = sheet.rows[index];
    // +2: one for the header row, one to make it 1-based like a spreadsheet.
    const rowNumber = index + 2;

    const name = read(row, 'name');
    const email = read(row, 'email').toLowerCase();
    const employeeId = read(row, 'employeeId');
    const schoolName = read(row, 'school');
    const departmentName = read(row, 'department');
    const unitPath = read(row, 'unitPath');
    // Filled by the Unit Path branch below; kept out here so the write payload
    // can prefer them over the two-column resolution.
    let pathSchoolName = '';
    let pathDepartmentName = '';
    let pathUnitId: string | null = null;

    if (!name && !email && !employeeId && !schoolName && !departmentName && !unitPath) {
      continue;
    }

    const base = { rowNumber, name, email, employeeId, school: schoolName, department: departmentName };
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

    // Guard: the same email appearing twice in one file would otherwise
    // count as 1 created + 1 updated and mask an obvious duplicate.
    if (seenEmails.has(email)) {
      fail('This email appears more than once in the file.');
      continue;
    }
    seenEmails.add(email);

    // Employee ID is optional everywhere — orgs without staff numbers just
    // leave the column out (or the cell blank). When one IS given it must be
    // unique within the tenant, so two people can never collide on it.
    const employeeIdKey = employeeId.toLowerCase();
    if (employeeId) {
      if (employeeId.length > MAX_EMPLOYEE_ID_LENGTH) {
        fail(`Employee ID must be ${MAX_EMPLOYEE_ID_LENGTH} characters or fewer.`);
        continue;
      }
      const owner = employeeIdOwners.get(employeeIdKey);
      if (owner && owner.toLowerCase() !== email) {
        fail(`Employee ID "${employeeId}" is already used by ${owner}.`);
        continue;
      }
      // Claim it immediately so a duplicate later in the same file trips the
      // check above — this covers both in-file and already-in-DB collisions
      // with one mechanism, and works in dry run too.
      employeeIdOwners.set(employeeIdKey, email);
    }

    try {
      // --- Unit Path: arbitrary-depth placement -----------------------------
      // Wins over School/Department when supplied, so an org that has moved to
      // a deeper structure can re-import without rewriting its old columns.
      if (unitPath) {
        const segments = unitPath
          .split(UNIT_PATH_SEPARATOR)
          .map((segment) => segment.trim())
          .filter(Boolean);
        if (segments.length === 0) {
          fail('Unit Path is empty.');
          continue;
        }

        let resolvedChain: Array<{ id: string; name: string }>;
        try {
          resolvedChain = await resolveUnitPath(segments);
        } catch (pathError) {
          fail(pathError instanceof Error ? pathError.message : String(pathError));
          continue;
        }

        const deepest = resolvedChain[resolvedChain.length - 1];
        pathSchoolName = resolvedChain[0].name;
        pathDepartmentName = resolvedChain.length > 1 ? deepest.name : '';
        pathUnitId = deepest.id;
      }

      // --- Resolve School -> Department ------------------------------------
      let schoolId: string | null = null;
      let resolvedSchoolName = '';
      if (schoolName && !unitPath) {
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
            // Defensive re-check: another concurrent import may have created
            // this school after we snapshotted `schoolsByName` at the top.
            // The partial unique index on lower(name) covers the DB, this
            // avoids racing into a unique-violation on the hot path.
            const existingRow = await prisma.tenantOrgUnit.findFirst({
              where: {
                tenant_id: tenantId,
                parent_id: null,
                kind: 'SCHOOL',
                name: { equals: schoolName, mode: 'insensitive' },
              },
              select: { id: true, name: true },
            });
            const unit = existingRow
              ? existingRow
              : await prisma.tenantOrgUnit.create({
                  data: { tenant_id: tenantId, kind: 'SCHOOL', name: schoolName, parent_id: null },
                  select: { id: true, name: true },
                });
            schoolId = unit.id;
            schoolsByName.set(key, unit);
            if (!existingRow) unitsCreated.push(`School: ${schoolName}`);
          }
          if (dryRun) unitsCreated.push(`School: ${schoolName}`);
        }
      }

      let departmentId: string | null = null;
      let resolvedDepartmentName = '';
      if (departmentName && !unitPath) {
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
            const existingRow = await prisma.tenantOrgUnit.findFirst({
              where: {
                tenant_id: tenantId,
                parent_id: schoolId,
                kind: 'DEPARTMENT',
                name: { equals: departmentName, mode: 'insensitive' },
              },
              select: { id: true, name: true },
            });
            const unit = existingRow
              ? existingRow
              : await prisma.tenantOrgUnit.create({
                  data: { tenant_id: tenantId, kind: 'DEPARTMENT', name: departmentName, parent_id: schoolId },
                  select: { id: true, name: true },
                });
            departmentId = unit.id;
            departmentsByKey.set(key, unit);
            if (!existingRow) unitsCreated.push(`Department: ${schoolName} / ${departmentName}`);
          }
          if (dryRun) unitsCreated.push(`Department: ${schoolName} / ${departmentName}`);
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

      // Do NOT silently pull an unclaimed (untenanted) user into this tenant —
      // that would attach a real person to an org without consent. Bulk
      // invites are the right path to bring an existing account in.
      if (existingUser && !existingUser.tenantId) {
        fail('This email exists as an unclaimed account. Invite the user through /tenant-admin/invites so they can accept before importing them here.');
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

      // Deepest resolved unit wins. Root-only rows attach to the root itself so
      // they still show up in org-tree counts and orgUnitId filters.
      const effectiveOrgUnitId = pathUnitId || departmentId || schoolId || null;
      // `school` is the root of the branch and `department` the unit the person
      // actually sits in — the same rule deriveOrgLabels applies elsewhere, so
      // deep placements keep both columns meaningful.
      const effectiveSchoolName = pathSchoolName || resolvedSchoolName;
      const effectiveDepartmentName = pathDepartmentName || resolvedDepartmentName;

      // Build the profile-update payload from ONLY the columns actually
      // present in this file. A re-import with a narrower schema (e.g.
      // Name+Email+Keywords) would otherwise blank out school/department/
      // research_areas/... on every existing row.
      const fullUpdate: Record<string, any> = {};
      if (hasColumn('name')) fullUpdate.display_name = name;
      if (hasColumn('employeeId')) fullUpdate.employee_id = employeeId || null;
      if (hasColumn('department') || hasColumn('school') || hasColumn('unitPath')) {
        fullUpdate.department = effectiveDepartmentName || null;
        fullUpdate.school = effectiveSchoolName || null;
        fullUpdate.org_unit_id = effectiveOrgUnitId;
      }
      if (hasColumn('designation')) fullUpdate.designation = designation || null;
      if (hasColumn('researchAreas')) fullUpdate.research_areas = researchAreas;
      if (hasColumn('keywords')) fullUpdate.keywords = keywords;
      if (hasColumn('researchSummary')) fullUpdate.research_summary = researchSummary || null;
      if (hasColumn('institutionName')) fullUpdate.institution_name = institutionName;
      if (hasColumn('institutionType')) fullUpdate.institution_type = institutionType || null;
      if (hasColumn('careerStage')) fullUpdate.career_stage = careerStage || null;
      if (hasColumn('country')) fullUpdate.country_of_residence = country || null;

      // Create-side always writes the full shape (fresh rows have no prior
      // state to preserve), pulling defaults where the column was absent.
      const createPayload = {
        display_name: name,
        employee_id: employeeId || null,
        department: effectiveDepartmentName || null,
        school: effectiveSchoolName || null,
        designation: designation || null,
        org_unit_id: effectiveOrgUnitId,
        research_areas: researchAreas,
        keywords,
        research_summary: researchSummary || null,
        institution_name: institutionName,
        institution_type: institutionType || null,
        career_stage: careerStage || null,
        country_of_residence: country || null,
      };

      const userId = await prisma.$transaction(async (tx) => {
        let user: { id: string };
        if (existingUser) {
          // tenantId is intentionally NOT touched here — the guard above
          // already rejected mismatches and untenanted accounts.
          if (hasColumn('name') && name && name !== existingUser.name) {
            user = await tx.user.update({
              where: { id: existingUser.id },
              data: { name },
              select: { id: true },
            });
          } else {
            user = { id: existingUser.id };
          }
        } else {
          user = await tx.user.create({
            // No passwordHash: imported faculty are seeded accounts that
            // activate through the existing invite / password-reset flow.
            data: { email, name, tenantId, roles: ['ANALYST'], status: 'ACTIVE' },
            select: { id: true },
          });
        }

        await tx.researcherProfile.upsert({
          where: { user_id: user.id },
          create: { user_id: user.id, ...createPayload },
          update: fullUpdate,
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

  // --- Inline embeddings (small, keeps the response quick) -------------------
  let embeddingsIndexed = 0;
  const inlineTargets = touchedUserIds.slice(0, MAX_INLINE_EMBEDDINGS);
  const remainingTargets = touchedUserIds.slice(MAX_INLINE_EMBEDDINGS);
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
    const finalStatus = remainingTargets.length > 0 ? 'EMBEDDING_RUNNING' : 'COMPLETED';
    const job = await prisma.facultyImportJob.create({
      data: {
        tenant_id: tenantId,
        uploaded_by: uploadedByUserId,
        filename: filename || null,
        // total_rows reflects the raw spreadsheet, not the post-filter row set.
        total_rows: rawRowCount,
        created_count: created,
        updated_count: updated,
        error_count: errors,
        status: finalStatus,
        report_json: {
          unitsCreated,
          results: results.slice(0, 500),
          embeddingsIndexed,
          pendingUserIds: remainingTargets,
        } as any,
      },
      select: { id: true },
    });
    jobId = job.id;

    // Audit trail for the commit.
    try {
      await prisma.auditLog.create({
        data: {
          actorUserId: uploadedByUserId,
          tenantId,
          action: 'FACULTY_IMPORT',
          resource: `faculty_import_job:${job.id}`,
          meta: {
            filename: filename || null,
            totalRows: rawRowCount,
            created,
            updated,
            errors,
            unitsCreated: Array.from(new Set(unitsCreated)),
            embeddingsIndexed,
            pending: remainingTargets.length,
          },
        },
      });
    } catch (auditErr) {
      console.warn('Faculty import: audit log failed', auditErr);
    }

    // Fire-and-forget: sweep the remaining embeddings after the HTTP response.
    // Any unhandled rejection here would crash the Node worker — the .catch
    // is load-bearing.
    if (remainingTargets.length > 0) {
      void indexPendingFacultyEmbeddings(job.id, tenantId, remainingTargets).catch((err) => {
        console.error('Faculty import: embedding worker crashed', err);
      });
    }
  }

  return {
    dryRun,
    totalRows: rawRowCount,
    created,
    updated,
    errors,
    unitsCreated: Array.from(new Set(unitsCreated)),
    embeddingsIndexed,
    embeddingsPending: remainingTargets.length,
    results,
    jobId,
  };
}

/**
 * Detached embedding worker. Runs after the import route has already
 * responded, in chunks, and keeps the `FacultyImportJob` row updated so the
 * UI can poll for progress via `GET /api/tenant-admin/faculty`.
 *
 * This is the first "fire-and-forget after HTTP response" pattern in the
 * repo — every awaited call is wrapped so an unhandled rejection can't take
 * the Node process down.
 */
export async function indexPendingFacultyEmbeddings(
  jobId: string,
  tenantId: string,
  userIds: string[]
): Promise<void> {
  if (userIds.length === 0) {
    try {
      await prisma.facultyImportJob.update({
        where: { id: jobId },
        data: { status: 'COMPLETED' },
      });
    } catch (err) {
      console.warn('Faculty embedding worker: could not mark job complete', err);
    }
    return;
  }

  let embedded = 0;
  let failed = 0;

  for (let index = 0; index < userIds.length; index += EMBEDDING_WORKER_BATCH) {
    const chunk = userIds.slice(index, index + EMBEDDING_WORKER_BATCH);
    for (const userId of chunk) {
      try {
        const ok = await researcherProfileService.indexResearcherProfileEmbedding(userId);
        if (ok) embedded += 1;
        else failed += 1;
      } catch (err) {
        failed += 1;
        console.warn('Faculty embedding worker: user', userId, err);
      }
      if (EMBEDDING_WORKER_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, EMBEDDING_WORKER_DELAY_MS));
      }
    }
    // No per-chunk write — the UI polls the researcher_profiles embedding
    // count directly (that count is authoritative and updates live).
    // Overwriting import-time totals here would corrupt the audit trail.
  }

  try {
    await prisma.facultyImportJob.update({
      where: { id: jobId },
      data: { status: failed === userIds.length ? 'FAILED' : 'COMPLETED' },
    });
  } catch (err) {
    console.warn('Faculty embedding worker: final status update failed', err);
  }

  // tenantId is accepted for future scoping/telemetry hooks — deliberately unused today.
  void tenantId;
}
