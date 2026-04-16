import { NextRequest, NextResponse } from 'next/server'

import { authenticateUser } from '@/lib/auth-middleware'
import { assertProjectCapability, ProjectAccessError } from '@/lib/project-access'
import { prisma } from '@/lib/prisma'

function buildAccessErrorResponse(error: unknown) {
  if (error instanceof ProjectAccessError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }

  console.error('Annexure route error:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

async function ensureProjectPatent(projectId: string, patentId: string) {
  return prisma.patent.findFirst({
    where: {
      id: patentId,
      projectId,
    },
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string; patentId: string } }
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

    const { html, textPlain } = await request.json()
    if (!html || typeof html !== 'string' || html.trim().length === 0) {
      return NextResponse.json({ error: 'Annexure content cannot be empty' }, { status: 400 })
    }

    const patent = await ensureProjectPatent(params.projectId, params.patentId)
    if (!patent) {
      return NextResponse.json({ error: 'Patent not found' }, { status: 404 })
    }

    const latestVersion = await prisma.annexureVersion.findFirst({
      where: { patentId: params.patentId },
      orderBy: { rev: 'desc' },
    })

    const annexureVersion = await prisma.annexureVersion.create({
      data: {
        patentId: params.patentId,
        rev: latestVersion ? latestVersion.rev + 1 : 1,
        html: html.trim(),
        textPlain: typeof textPlain === 'string' ? textPlain : '',
        createdBy: user.id,
      },
    })

    return NextResponse.json(
      {
        annexureVersion,
        message: 'Annexure saved successfully',
      },
      { status: 201 }
    )
  } catch (error) {
    return buildAccessErrorResponse(error)
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; patentId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request)
    if (error || !user) {
      return NextResponse.json(
        { error: error?.message ?? 'Unauthorized', code: error?.code ?? 'UNAUTHORIZED' },
        { status: error?.status ?? 401 }
      )
    }

    await assertProjectCapability(params.projectId, user.id, user.tenantId, 'read')

    const patent = await ensureProjectPatent(params.projectId, params.patentId)
    if (!patent) {
      return NextResponse.json({ error: 'Patent not found' }, { status: 404 })
    }

    const latestVersion = await prisma.annexureVersion.findFirst({
      where: { patentId: params.patentId },
      orderBy: { rev: 'desc' },
    })

    if (!latestVersion) {
      return NextResponse.json({ annexure: null, message: 'No annexure found' })
    }

    return NextResponse.json({ annexure: latestVersion })
  } catch (error) {
    return buildAccessErrorResponse(error)
  }
}
