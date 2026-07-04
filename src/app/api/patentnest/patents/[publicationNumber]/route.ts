import { NextRequest } from 'next/server'

import { getIndianPatent } from '@/lib/patentnest/client'
import {
  patentNestErrorResponse,
  patentNestSuccessResponse,
  requirePatentNestUser,
} from '@/lib/patentnest/route-utils'

export const runtime = 'nodejs'
export const maxDuration = 180

export async function GET(
  request: NextRequest,
  { params }: { params: { publicationNumber: string } },
) {
  const authError = requirePatentNestUser(request)
  if (authError) return authError

  try {
    const response = await getIndianPatent(params.publicationNumber)
    return patentNestSuccessResponse(response)
  } catch (error) {
    return patentNestErrorResponse(error)
  }
}
