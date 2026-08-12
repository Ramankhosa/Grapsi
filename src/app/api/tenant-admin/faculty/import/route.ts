import { NextRequest, NextResponse } from 'next/server'
import {
  TENANT_SCOPED_ADMIN_ROLES,
  isAccessError,
  requireTenantRoles,
} from '@/lib/auth/tenantAccess'
import {
  FACULTY_IMPORT_TEMPLATE_HEADERS,
  importFacultyRoster,
} from '@/lib/services/facultyImportService'

export const dynamic = 'force-dynamic'

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/** Downloadable CSV template so the column headings always match the parser. */
export async function GET(request: NextRequest) {
  const context = await requireTenantRoles(request, TENANT_SCOPED_ADMIN_ROLES)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  // Employee ID is optional — the column stays in the template so orgs that
  // have staff numbers can fill it, and orgs that don't can leave it blank.
  const example = [
    'Asha Verma',
    'asha.verma@example.edu',
    '10428',
    // Unit Path places someone at any depth; when given it wins over the
    // School/Department pair, which stay supported for existing workbooks.
    'School of Computer Science and Engineering > Department of Artificial Intelligence',
    'School of Computer Science and Engineering',
    'Department of Artificial Intelligence',
    'Associate Professor',
    'machine learning; computer vision',
    'deep learning; medical imaging',
    'Works on vision models for low-resource clinical settings.',
  ]

  const csv = `${FACULTY_IMPORT_TEMPLATE_HEADERS.join(',')}\n${example
    .map((value) => (value.includes(',') ? `"${value}"` : value))
    .join(',')}\n`

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="faculty-import-template.csv"',
    },
  })
}

/**
 * Imports a faculty roster (.csv / .xlsx). Send `dryRun=true` first to validate
 * and preview, then repeat without it to commit.
 */
export async function POST(request: NextRequest) {
  const context = await requireTenantRoles(request, TENANT_SCOPED_ADMIN_ROLES)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Expected a multipart file upload.' }, { status: 400 })
  }

  const file = formData.get('file') as any
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No file was uploaded.' }, { status: 400 })
  }
  if (typeof file.size === 'number' && file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: 'That file is larger than 5 MB. Split it into smaller batches.' },
      { status: 413 }
    )
  }

  const filename: string = typeof file.name === 'string' ? file.name : 'upload.csv'
  if (!/\.(csv|tsv|txt|xlsx|xlsm)$/i.test(filename)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Upload a .csv or .xlsx file.' },
      { status: 400 }
    )
  }

  try {
    const summary = await importFacultyRoster({
      tenantId: context.tenantId,
      uploadedByUserId: context.user.id,
      filename,
      buffer: Buffer.from(await file.arrayBuffer()),
      autoCreateUnits: formData.get('autoCreateUnits') === 'true',
      dryRun: formData.get('dryRun') === 'true',
    })
    return NextResponse.json(summary)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The file could not be imported.' },
      { status: 400 }
    )
  }
}
