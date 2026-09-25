import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { addCallSchoolMapping, endCallSchoolMapping, MappingError } from '@/lib/fundingDept/callSchoolMapping'
import { managementAccess, schoolIsAccessible } from '@/lib/fundingDept/managementAccess'

export const dynamic = 'force-dynamic'

/** Only the DSR head adds a school to a call or ends a mapping, always with a reason. */
const body = z.object({
  operation: z.enum(['ADD', 'END']),
  callId: z.string().min(1),
  schoolId: z.string().min(1),
  reason: z.string().trim().min(3).max(2000),
})

export async function POST(request: NextRequest) {
  const access = await managementAccess(request)
  if ('response' in access) return access.response
  if (!access.department) return NextResponse.json({ error: 'Department head access required.' }, { status: 403 })
  try {
    const input = body.parse(await request.json())
    if (!await schoolIsAccessible(access, input.schoolId)) return NextResponse.json({ error: 'School not found.' }, { status: 404 })
    const mapping = input.operation === 'ADD'
      ? await addCallSchoolMapping(access.context.tenantId, input.callId, input.schoolId, access.context.user.id, input.reason)
      : await endCallSchoolMapping(access.context.tenantId, input.callId, input.schoolId, access.context.user.id, input.reason)
    return NextResponse.json({ mapping })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Choose a call and school, and give a reason of at least three characters.' }, { status: 400 })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update the mapping.' }, { status: error instanceof MappingError ? error.status : 500 })
  }
}
