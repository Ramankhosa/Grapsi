import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingIntakeService } from '@/lib/fundingIntake/service'

export const runtime = 'nodejs'

const resolutionSchema = z.object({
  duplicateId: z.string(),
  resolution: z.enum(['pending', 'ignored', 'merged_to_existing', 'create_new_anyway']),
})

const draftSchema = z.object({
  agency_name: z.string().optional(),
  scheme_title: z.string().optional(),
  description: z.string().optional(),
  open_date: z.string().nullable().optional(),
  close_date: z.string().nullable().optional(),
  is_rolling: z.boolean().optional(),
  geography_scope: z.string().optional(),
  eligible_countries: z.array(z.string()).optional(),
  eligible_regions: z.array(z.string()).optional(),
  host_countries: z.array(z.string()).optional(),
  funder_country: z.string().optional(),
  funding_kinds: z.array(z.string()).optional(),
  institution_types: z.array(z.string()).optional(),
  career_stages: z.array(z.string()).optional(),
  citizenship_requirements: z.array(z.string()).optional(),
  residency_requirements: z.array(z.string()).optional(),
  application_languages: z.array(z.string()).optional(),
  disciplines: z.array(z.string()).optional(),
  amount_min: z.number().nullable().optional(),
  amount_max: z.number().nullable().optional(),
  currency: z.string().optional(),
  project_duration_min_months: z.number().nullable().optional(),
  project_duration_max_months: z.number().nullable().optional(),
  project_duration_text: z.string().optional(),
  eligibility_text: z.string().optional(),
  expected_deliverables_text: z.string().optional(),
  official_urls: z.array(z.string()).optional(),
  contact_info: z.string().optional(),
  sponsor_type: z.string().optional(),
  duplicateResolutions: z.array(resolutionSchema).optional(),
  extractAll: z.boolean().optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const payload = draftSchema.parse(await request.json())
    const result = await fundingIntakeService.createOrUpdateDraft(
      params.id,
      payload,
      auth.operator,
      payload.duplicateResolutions ?? [],
      payload.extractAll ?? false
    )

    if (!result.ok && result.reason === 'duplicate_resolution_required') {
      return NextResponse.json(result, { status: 409 })
    }

    if (!result.ok && result.reason === 'missing_required_fields') {
      return NextResponse.json(result, { status: 400 })
    }

    const successResult = result as any

    return NextResponse.json({
      jobId: params.id,
      fundingCallId: successResult.fundingCallId,
      status: 'draft_created',
      requiredFieldsRemaining: successResult.requiredFieldsRemaining,
      duplicateResolutionState: successResult.duplicateResolutionState,
      extractAllTriggered: successResult.extractAllTriggered ?? false,
      extractAllSkippedReason: successResult.extractAllSkippedReason ?? null,
      guidelineStatus: successResult.guidelineStatus ?? null,
      guidelineRunId: successResult.guidelineRunId ?? null,
      guidelineExtractionError: successResult.guidelineExtractionError ?? null,
      templateStatus: successResult.templateStatus ?? null,
      templateRunId: successResult.templateRunId ?? null,
      templateAssetId: successResult.templateAssetId ?? null,
      templateExtractionError: successResult.templateExtractionError ?? null,
      jsonGuidelineImported: successResult.jsonGuidelineImported ?? false,
      jsonTemplateImported: successResult.jsonTemplateImported ?? false,
      jsonDocumentsIngested: successResult.jsonDocumentsIngested ?? 0,
      jsonDocumentErrors: successResult.jsonDocumentErrors ?? [],
      jsonImportSkippedReason: successResult.jsonImportSkippedReason ?? null,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid draft payload', issues: error.flatten() }, { status: 400 })
    }

    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to create draft funding call' },
      { status: 500 }
    )
  }
}
