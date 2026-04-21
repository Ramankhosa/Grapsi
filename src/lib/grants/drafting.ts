import prisma from '@/lib/prisma'
import { getGrantWorkspace } from '@/lib/grants/workspace'
import { isGrantSectionAutoDraftable } from '@/lib/grants/workflowMode'

function stringifyStructuredSection(value: unknown) {
  if (!value) return ''

  const record = value as Record<string, unknown>
  if (Array.isArray(record.items)) {
    return record.items
      .map((item) => {
        const row = item as Record<string, unknown>
        return `- ${String(row.label || 'Item')}${row.notes ? `: ${String(row.notes)}` : ''}`
      })
      .join('\n')
  }

  if (Array.isArray(record.rows)) {
    return record.rows
      .map((row) => JSON.stringify(row))
      .join('\n')
  }

  return JSON.stringify(value, null, 2)
}

export async function generateGrantSectionDraft(input: {
  grantSessionId: string
  tenantId: string
  sectionKey: string
  userId: string
}) {
  const workspace = await getGrantWorkspace({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
  })

  if (!workspace || !workspace.blueprint) {
    throw new Error('Grant workspace not found')
  }

  const blueprint = workspace.blueprint

  if (blueprint.status !== 'FROZEN') {
    throw new Error('Freeze the blueprint before generating draft sections.')
  }

  const sectionDraft = blueprint.sectionDrafts.find((section) => section.sectionKey === input.sectionKey)
  if (!sectionDraft) {
    throw new Error('Grant section not found')
  }

  if (!isGrantSectionAutoDraftable({
    sectionType: sectionDraft.sectionType,
    workflowMode: (sectionDraft as { workflowMode?: string }).workflowMode,
  })) {
    throw new Error('Only app draft sections are eligible for AI generation.')
  }

  throw new Error('App draft sections are generated in the linked literature workspace.')
}

export async function saveGrantSectionDraft(input: {
  grantSessionId: string
  tenantId: string
  sectionKey: string
  userId: string
  content?: string | null
  structuredData?: unknown
  markReviewed?: boolean
}) {
  const workspace = await getGrantWorkspace({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
  })

  if (!workspace || !workspace.blueprint) {
    throw new Error('Grant workspace not found')
  }

  const blueprint = workspace.blueprint
  const sectionDraft = blueprint.sectionDrafts.find((section) => section.sectionKey === input.sectionKey)
  if (!sectionDraft) {
    throw new Error('Grant section not found')
  }

  if (sectionDraft.workflowMode === 'app_draft') {
    throw new Error('App draft sections are edited in the linked literature workspace.')
  }

  return prisma.$transaction(async (tx) => {
    let savedDraft = sectionDraft

    if (sectionDraft.sectionType === 'narrative' || sectionDraft.sectionType === 'short_answer') {
      const updatedDraft = await tx.grantSectionDraft.update({
        where: { id: sectionDraft.id },
        data: {
          content: input.content ?? sectionDraft.content,
          status: input.markReviewed ? 'REVIEWED' : 'DRAFT',
          version: { increment: 1 },
          updatedByUserId: input.userId,
        },
        include: {
          structuredResponses: true,
        },
      })
      savedDraft = {
        ...updatedDraft,
        workflowMode: sectionDraft.workflowMode,
        citationMode: sectionDraft.citationMode,
      }
    } else if (typeof input.structuredData !== 'undefined') {
      await tx.grantStructuredFieldResponse.upsert({
        where: {
          sectionDraftId_fieldKey: {
            sectionDraftId: sectionDraft.id,
            fieldKey: 'structuredData',
          },
        },
        update: {
          responseJson: input.structuredData as never,
          updatedByUserId: input.userId,
        },
        create: {
          grantSessionId: sectionDraft.grantSessionId,
          sectionDraftId: sectionDraft.id,
          tenantId: sectionDraft.tenantId,
          projectId: sectionDraft.projectId,
          sectionKey: sectionDraft.sectionKey,
          fieldKey: 'structuredData',
          responseJson: input.structuredData as never,
          updatedByUserId: input.userId,
        },
      })

      const updatedDraft = await tx.grantSectionDraft.update({
        where: { id: sectionDraft.id },
        data: {
          status: input.markReviewed ? 'REVIEWED' : 'DRAFT',
          version: { increment: 1 },
          updatedByUserId: input.userId,
        },
        include: {
          structuredResponses: true,
        },
      })
      savedDraft = {
        ...updatedDraft,
        workflowMode: sectionDraft.workflowMode,
        citationMode: sectionDraft.citationMode,
      }
    }

    return savedDraft
  })
}

export function renderGrantSectionForExport(sectionDraft: {
  sectionType: string
  content: string | null
  structuredResponses: Array<{ fieldKey: string; responseJson: unknown }>
}) {
  if (sectionDraft.sectionType === 'narrative' || sectionDraft.sectionType === 'short_answer') {
    return sectionDraft.content || ''
  }

  const structuredData = sectionDraft.structuredResponses.find((response) => response.fieldKey === 'structuredData')
  return stringifyStructuredSection(structuredData?.responseJson)
}
