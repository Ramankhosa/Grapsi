import { NextRequest, NextResponse } from 'next/server'

import { extractCsvIntakesFromZip } from '@/lib/fundingIntake/bulkCsvIngestion'
import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingIntakeService } from '@/lib/fundingIntake/service'

export const runtime = 'nodejs'

const MAX_ZIP_BYTES = 50 * 1024 * 1024
// createBatch caps a single batch at 100 jobs, so a large archive is split into
// several batches that all drain through the same intake queue.
const MAX_JOBS_PER_BATCH = 100

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size))
  }
  return groups
}

export async function POST(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const contentType = request.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ message: 'Upload a .zip archive of funding-call CSV files' }, { status: 400 })
    }

    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ message: 'No archive file received' }, { status: 400 })
    }

    const lowerName = (file.name || '').toLowerCase()
    if (lowerName.endsWith('.rar')) {
      return NextResponse.json(
        {
          message:
            'RAR archives are not supported. Please re-compress the CSV files as a .zip archive and upload again.',
        },
        { status: 400 }
      )
    }
    if (file.size > MAX_ZIP_BYTES) {
      return NextResponse.json({ message: 'Archive is too large (50MB limit).' }, { status: 400 })
    }

    const operatorNotes = String(formData.get('operatorNotes') || '').trim() || undefined
    const label = String(formData.get('label') || '').trim() || file.name || 'Bulk CSV import'

    const buffer = Buffer.from(await file.arrayBuffer())

    let extraction
    try {
      extraction = extractCsvIntakesFromZip(buffer, { operatorNotes })
    } catch (error) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message : 'Could not read the archive' },
        { status: 400 }
      )
    }

    if (extraction.totalCsvFiles === 0) {
      return NextResponse.json({ message: 'The archive did not contain any .csv files.' }, { status: 400 })
    }
    if (extraction.parsedCount === 0) {
      return NextResponse.json(
        {
          message: 'None of the CSV files in the archive could be parsed as funding calls.',
          totalCsvFiles: extraction.totalCsvFiles,
          queued: 0,
          failed: extraction.failedCount,
          batches: [],
          results: extraction.results,
        },
        { status: 400 }
      )
    }

    const chunks = chunk(extraction.jobs, MAX_JOBS_PER_BATCH)
    const batches: Array<{ id: string; label: string; totalJobs: number }> = []
    for (let index = 0; index < chunks.length; index += 1) {
      const chunkLabel = chunks.length > 1 ? `${label} (part ${index + 1}/${chunks.length})` : label
      const batch = await fundingIntakeService.createBatch(auth.operator, {
        label: chunkLabel,
        jobs: chunks[index],
      })
      batches.push({ id: batch.id, label: chunkLabel, totalJobs: batch.total_jobs })
    }

    return NextResponse.json(
      {
        totalCsvFiles: extraction.totalCsvFiles,
        queued: extraction.parsedCount,
        failed: extraction.failedCount,
        batches,
        results: extraction.results,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[Funding Intake Bulk CSV] create error:', error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to process the bulk CSV upload' },
      { status: 500 }
    )
  }
}
