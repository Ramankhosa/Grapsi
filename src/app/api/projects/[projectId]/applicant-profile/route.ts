import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { authenticateUser } from '@/lib/auth-middleware'
import { assertProjectCapability, ProjectAccessError } from '@/lib/project-access'
import { prisma } from '@/lib/prisma'

const applicantProfileSchema = z.object({
  applicantLegalName: z.string().min(3, 'Legal name must be at least 3 characters').max(200, 'Legal name too long'),
  applicantCategory: z.enum(['natural_person', 'small_entity', 'startup', 'others']),
  applicantAddressLine1: z.string().min(1, 'Address line 1 is required'),
  applicantAddressLine2: z.string().optional(),
  applicantCity: z.string().min(1, 'City is required'),
  applicantState: z.string().min(1, 'State is required'),
  applicantCountryCode: z.string().length(2, 'Country code must be 2 characters (ISO-2)'),
  applicantPostalCode: z.string().min(1, 'Postal code is required'),
  correspondenceName: z.string().min(1, 'Correspondence name is required'),
  correspondenceEmail: z.string().email('Invalid email format'),
  correspondencePhone: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Phone must be in E.164 format (+country code)'),
  correspondenceAddressLine1: z.string().min(1, 'Address line 1 is required'),
  correspondenceAddressLine2: z.string().optional(),
  correspondenceCity: z.string().min(1, 'City is required'),
  correspondenceState: z.string().min(1, 'State is required'),
  correspondenceCountryCode: z.string().length(2, 'Country code must be 2 characters (ISO-2)'),
  correspondencePostalCode: z.string().min(1, 'Postal code is required'),
  useAgent: z.boolean(),
  agentName: z.string().optional(),
  agentRegistrationNo: z.string().optional(),
  agentEmail: z.string().optional(),
  agentPhone: z.string().optional(),
  agentAddressLine1: z.string().optional(),
  agentAddressLine2: z.string().optional(),
  agentCity: z.string().optional(),
  agentState: z.string().optional(),
  agentCountryCode: z.string().optional(),
  agentPostalCode: z.string().optional(),
  defaultJurisdiction: z.enum(['IN', 'PCT', 'US', 'EP']),
  defaultRoute: z.enum(['national', 'pct_international', 'pct_national']),
  defaultLanguage: z.string().default('EN'),
  defaultEntityStatusIn: z.enum(['startup', 'small_entity', 'university', 'regular']),
}).refine((data) => {
  if (data.useAgent) {
    return Boolean(
      data.agentName &&
        data.agentRegistrationNo &&
        data.agentEmail &&
        data.agentPhone &&
        data.agentAddressLine1 &&
        data.agentCity &&
        data.agentState &&
        data.agentCountryCode &&
        data.agentPostalCode
    )
  }
  return true
}, {
  message: 'Agent details are required when using an agent',
  path: ['agentName'],
})

function buildAccessErrorResponse(error: unknown) {
  if (error instanceof ProjectAccessError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }

  console.error('Applicant profile route error:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request)
    if (error || !user) {
      return NextResponse.json(
        { error: error?.message ?? 'Unauthorized', code: error?.code ?? 'UNAUTHORIZED' },
        { status: error?.status ?? 401 }
      )
    }

    await assertProjectCapability(params.projectId, user.id, user.tenantId, 'editContent')

    const body = await request.json()
    const validatedData = applicantProfileSchema.parse(body)

    const applicantProfile = await prisma.applicantProfile.upsert({
      where: { projectId: params.projectId },
      update: validatedData,
      create: {
        ...validatedData,
        projectId: params.projectId,
      },
    })

    return NextResponse.json({ applicantProfile }, { status: 200 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        },
        { status: 400 }
      )
    }

    return buildAccessErrorResponse(error)
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request)
    if (error || !user) {
      return NextResponse.json(
        { error: error?.message ?? 'Unauthorized', code: error?.code ?? 'UNAUTHORIZED' },
        { status: error?.status ?? 401 }
      )
    }

    const access = await assertProjectCapability(params.projectId, user.id, user.tenantId, 'read')

    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      include: {
        applicantProfile: true,
      },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        applicantProfile: project.applicantProfile,
        accessLevel: access.accessLevel,
        isOwner: access.isOwner,
      },
    })
  } catch (error) {
    return buildAccessErrorResponse(error)
  }
}
