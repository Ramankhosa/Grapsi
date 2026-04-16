import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateUser } from '@/lib/auth-middleware'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message || 'Unauthorized' },
        { status: authResult.error?.status || 401 }
      )
    }

    const { patentId } = params

    // Verify patent access (same pattern as drafting route)
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        OR: [
          { createdBy: authResult.user.id },
          {
            project: {
              OR: [
                { userId: authResult.user.id },
                { collaborators: { some: { userId: authResult.user.id } } }
              ]
            }
          }
        ]
      }
    })

    if (!patent) {
      return NextResponse.json(
        { error: 'Patent not found or access denied' },
        { status: 404 }
      )
    }

    // Aggregate usage logs tagged with this patentId in meta
    const logs = await prisma.usageLog.findMany({
      where: {
        tenantId: authResult.user.tenantId!,
        userId: authResult.user.id,
        status: 'COMPLETED',
        meta: {
          path: ['patentId'],
          equals: patentId
        }
      },
      select: {
        inputTokens: true,
        outputTokens: true,
        modelClass: true,
        taskCode: true
      }
    })

    let totalInputTokens = 0
    let totalOutputTokens = 0
    const tokensByModel = new Map<string, { model: string; inputTokens: number; outputTokens: number }>()
    const tokensByTask = new Map<string, { task: string; inputTokens: number; outputTokens: number }>()

    for (const log of logs) {
      const input = log.inputTokens || 0
      const output = log.outputTokens || 0
      totalInputTokens += input
      totalOutputTokens += output

      const modelKey = log.modelClass || 'UNKNOWN_MODEL'
      const existingModel = tokensByModel.get(modelKey) || {
        model: modelKey,
        inputTokens: 0,
        outputTokens: 0
      }
      existingModel.inputTokens += input
      existingModel.outputTokens += output
      tokensByModel.set(modelKey, existingModel)

      const taskKey = log.taskCode || 'UNKNOWN_TASK'
      const existingTask = tokensByTask.get(taskKey) || {
        task: taskKey,
        inputTokens: 0,
        outputTokens: 0
      }
      existingTask.inputTokens += input
      existingTask.outputTokens += output
      tokensByTask.set(taskKey, existingTask)
    }

    return NextResponse.json({
      patent_id: patentId,
      total_input_tokens: totalInputTokens,
      total_output_tokens: totalOutputTokens,
      tokens_by_model: Array.from(tokensByModel.values()),
      tokens_by_task: Array.from(tokensByTask.values())
    })
  } catch (error) {
    console.error('Patent usage API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

