import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { stagePdfUpload } from '@/lib/fundingIntake/appRouterUpload'
import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { requireUserManageablePrivateFundingCall } from '@/lib/fundingIntake/userFundingCallAccess'
import { fundingGuidelineService } from '@/lib/fundingGuidelines/service'

export const runtime = 'nodejs'

const jsonSchema = z.object({
  sourceMode: z.enum(['intake', 'url', 'text']).default('intake'),
  sourceUrl: z.string().trim().optional(),
  sourceText: z.string().optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: { callId: string } }
) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) return auth.response

  const access = await requireUserManageablePrivateFundingCall(auth.actor, params.callId)
  if ('response' in access) return access.response
  if (!access.isOwner) {
    return NextResponse.json({ message: 'Only the owner can extract guidelines for this private funding call' }, { status: 403 })
  }

  try {
    const contentType = request.headers.get('content-type') || ''
    let sourceInput: any = { sourceMode: 'intake' }

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')

      if (!(file instanceof File)) {
        return NextResponse.json({ message: 'Upload a PDF guideline document to continue' }, { status: 400 })
      }

      const staged = await stagePdfUpload(file)
      sourceInput = {
        sourceMode: 'pdf',
        sourceFilePath: staged.tempFilePath,
        sourceLabel: staged.originalName,
      }
    } else {
      const payload = jsonSchema.parse(await request.json().catch(() => ({})))

      if (payload.sourceMode === 'url') {
        if (!payload.sourceUrl) {
          return NextResponse.json({ message: 'Guideline URL is required' }, { status: 400 })
        }
        sourceInput = { sourceMode: 'url', sourceUrl: payload.sourceUrl }
      } else if (payload.sourceMode === 'text') {
        if (!payload.sourceText || payload.sourceText.trim().length < 40) {
          return NextResponse.json({ message: 'Paste the guideline text before extracting' }, { status: 400 })
        }
        sourceInput = { sourceMode: 'text', sourceText: payload.sourceText }
      }
    }

    const run = await fundingGuidelineService.startExtractionRunFromFundingCall(
      params.callId,
      auth.operator,
      sourceInput
    )

    return NextResponse.json({ run })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid guideline extraction request', issues: error.flatten() }, { status: 400 })
    }

    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to extract guidelines' },
      { status: 500 }
    )
  }
}
