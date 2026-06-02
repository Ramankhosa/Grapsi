import prisma from '@/lib/prisma'
import { budgetStructuredDataHasMeaningfulRows } from '@/lib/grants/budgetTemplate'

export interface GrantPrepPostLaunchImpact {
  hasLaunchedWorkspace: boolean
  hasBlueprint: boolean
  blueprintStatus: string | null
  hasDraftContent: boolean
  draftedSectionCount: number
  appDraftContentCount: number
  manualDraftContentCount: number
}

function hasMeaningfulText(value: unknown) {
  return String(value || '').replace(/<[^>]*>/g, ' ').trim().length > 0
}

function hasMeaningfulJson(value: unknown, sectionType?: string | null) {
  if (value === null || typeof value === 'undefined') return false
  if (typeof value === 'string') return hasMeaningfulText(value)
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (sectionType === 'budget_rows') {
      return budgetStructuredDataHasMeaningfulRows(record)
    }
    if (Array.isArray(record.items)) {
      return record.items.some((item) => {
        const entry = item as Record<string, unknown>
        return Boolean(entry.completed) || hasMeaningfulText(entry.notes)
      })
    }
    if (Array.isArray(record.rows)) {
      return record.rows.length > 0
    }
    return Object.keys(record).length > 0
  }
  return true
}

export async function getGrantPrepPostLaunchImpact(input: {
  tenantId: string
  grantSessionId?: string | null
  prepSessionId?: string | null
}): Promise<GrantPrepPostLaunchImpact> {
  const linkedGrantSessionId = input.grantSessionId || (input.prepSessionId
    ? (
        await prisma.grantPrepSession.findFirst({
          where: {
            id: input.prepSessionId,
            tenantId: input.tenantId,
          },
          select: {
            grant_session_id: true,
          },
        })
      )?.grant_session_id
    : null)

  const grantSession = linkedGrantSessionId
    ? await prisma.grantSession.findFirst({
      where: {
        id: linkedGrantSessionId,
        tenantId: input.tenantId,
      },
      select: {
        id: true,
        draftingSessionId: true,
        blueprint: {
          select: {
            id: true,
            status: true,
          },
        },
        sectionDrafts: {
          select: {
            sectionKey: true,
            sectionType: true,
            content: true,
            structuredResponses: {
              select: {
                responseJson: true,
              },
            },
          },
        },
        draftingSession: {
          select: {
            paperSections: {
              select: {
                sectionKey: true,
                content: true,
              },
            },
          },
        },
      },
    })
    : null

  if (!grantSession) {
    return {
      hasLaunchedWorkspace: false,
      hasBlueprint: false,
      blueprintStatus: null,
      hasDraftContent: false,
      draftedSectionCount: 0,
      appDraftContentCount: 0,
      manualDraftContentCount: 0,
    }
  }

  const draftedSectionKeys = new Set<string>()
  let appDraftContentCount = 0
  let manualDraftContentCount = 0

  for (const draft of grantSession.sectionDrafts) {
    const hasContent =
      hasMeaningfulText(draft.content) ||
      draft.structuredResponses.some((response) => hasMeaningfulJson(response.responseJson, draft.sectionType))
    if (!hasContent) continue

    draftedSectionKeys.add(draft.sectionKey)
    manualDraftContentCount += 1
  }

  for (const section of grantSession.draftingSession?.paperSections || []) {
    if (!hasMeaningfulText(section.content)) continue
    draftedSectionKeys.add(section.sectionKey)
    appDraftContentCount += 1
  }

  return {
    hasLaunchedWorkspace: Boolean(grantSession.blueprint || grantSession.draftingSessionId),
    hasBlueprint: Boolean(grantSession.blueprint),
    blueprintStatus: grantSession.blueprint?.status || null,
    hasDraftContent: draftedSectionKeys.size > 0,
    draftedSectionCount: draftedSectionKeys.size,
    appDraftContentCount,
    manualDraftContentCount,
  }
}
