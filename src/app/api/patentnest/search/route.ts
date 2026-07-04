import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { searchIndianPatents } from '@/lib/patentnest/client'
import {
  patentNestErrorResponse,
  patentNestSuccessResponse,
  requirePatentNestUser,
} from '@/lib/patentnest/route-utils'

export const runtime = 'nodejs'
export const maxDuration = 180

const requestSchema = z.object({
  query: z.string().trim().min(2).max(2_000),
  limit: z.number().int().min(1).max(50).optional().default(20),
})

export async function POST(request: NextRequest) {
  const authError = requirePatentNestUser(request)
  if (authError) return authError

  try {
    const input = requestSchema.parse(await request.json())
    const response = await searchIndianPatents(input.query, input.limit)
    return patentNestSuccessResponse(response)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: error.errors[0]?.message || 'Invalid patent search request.',
          },
        },
        { status: 400 }
      )
    }
    return patentNestErrorResponse(error)
  }
}

