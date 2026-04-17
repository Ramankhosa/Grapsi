import { generateFromGemini } from '@/lib/geminiService'
import { getGrantPrepGeminiModel } from '@/lib/grantPrep/model'
import prisma from '@/lib/prisma'
import { getGrantWorkspace } from '@/lib/grants/workspace'

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : []
}

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

function buildGrantSectionPrompt(input: {
  projectTitle: string
  fundingCallTitle: string
  fundingAgencyName: string
  freezePayload: Record<string, unknown> | null
  section: {
    label: string
    sectionKey: string
    sectionType: string
    purpose: string
    reviewerIntent: string | null
    wordBudget: number | null
    characterLimit: number | null
    mustCover: string[]
    mustAvoid: string[]
  }
  precedingSections: Array<{ label: string; content: string }>
}) {
  const priorContext = input.precedingSections
    .filter((section) => section.content.trim().length > 0)
    .map((section) => `${section.label}:\n${section.content}`)
    .join('\n\n')

  const freezePayload = input.freezePayload ? JSON.stringify(input.freezePayload, null, 2) : 'null'

  return [
    'You are drafting a grant proposal section inside Grapsi.',
    'Return only the section draft text. Do not use markdown fences.',
    `Project title: ${input.projectTitle}`,
    `Funding call: ${input.fundingCallTitle}`,
    `Agency: ${input.fundingAgencyName}`,
    `Section key: ${input.section.sectionKey}`,
    `Section label: ${input.section.label}`,
    `Section type: ${input.section.sectionType}`,
    `Purpose: ${input.section.purpose}`,
    input.section.reviewerIntent ? `Reviewer intent: ${input.section.reviewerIntent}` : null,
    input.section.wordBudget ? `Target word budget: ${input.section.wordBudget}` : null,
    input.section.characterLimit ? `Maximum characters: ${input.section.characterLimit}` : null,
    input.section.mustCover.length > 0 ? `Must cover: ${input.section.mustCover.join('; ')}` : null,
    input.section.mustAvoid.length > 0 ? `Must avoid: ${input.section.mustAvoid.join('; ')}` : null,
    priorContext ? `Earlier approved/generated sections:\n${priorContext}` : null,
    `Grant prep freeze payload:\n${freezePayload}`,
    'Write in a professional grant-writing style aligned to the funding call.',
    'Do not invent facts beyond the supplied project and prep context.',
  ]
    .filter(Boolean)
    .join('\n\n')
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

  if (!workspace?.blueprint) {
    throw new Error('Grant workspace not found')
  }

  if (workspace.blueprint.status !== 'FROZEN') {
    throw new Error('Freeze the blueprint before generating draft sections.')
  }

  const sectionDraft = workspace.blueprint.sectionDrafts.find((section) => section.sectionKey === input.sectionKey)
  if (!sectionDraft) {
    throw new Error('Grant section not found')
  }

  if (!['narrative', 'short_answer'].includes(sectionDraft.sectionType)) {
    throw new Error('Structured sections are edited manually in the draft workspace.')
  }

  const sectionPlan = workspace.blueprint.sectionPlan.find((section) => section.sectionKey === input.sectionKey)
  if (!sectionPlan) {
    throw new Error('Grant blueprint section is missing from the plan')
  }

  const precedingSections = workspace.blueprint.sectionDrafts
    .filter((section) => section.sectionOrder < sectionDraft.sectionOrder)
    .map((section) => ({
      label: section.label,
      content: section.content || '',
    }))

  const prompt = buildGrantSectionPrompt({
    projectTitle: workspace.grantSession.project.name,
    fundingCallTitle: workspace.grantSession.fundingCall.scheme_title || 'Funding Call',
    fundingAgencyName: workspace.grantSession.fundingCall.agency_name || '',
    freezePayload: (workspace.blueprint.freezePayloadJson || null) as Record<string, unknown> | null,
    section: {
      label: sectionDraft.label,
      sectionKey: sectionDraft.sectionKey,
      sectionType: sectionDraft.sectionType,
      purpose: sectionDraft.purpose,
      reviewerIntent: sectionDraft.reviewerIntent,
      wordBudget: sectionDraft.wordBudget,
      characterLimit: sectionDraft.characterLimit,
      mustCover: asStringArray(sectionDraft.mustCoverJson),
      mustAvoid: asStringArray(sectionDraft.mustAvoidJson),
    },
    precedingSections,
  })

  const content = (await generateFromGemini(prompt, getGrantPrepGeminiModel())).trim()
  if (!content) {
    throw new Error('The drafting model returned an empty response.')
  }

  return prisma.grantSectionDraft.update({
    where: {
      grantSessionId_sectionKey: {
        grantSessionId: input.grantSessionId,
        sectionKey: input.sectionKey,
      },
    },
    data: {
      content,
      status: 'DRAFT',
      version: { increment: 1 },
      llmPromptUsed: prompt,
      llmResponse: content,
      generatedAt: new Date(),
      updatedByUserId: input.userId,
    },
    include: {
      structuredResponses: true,
    },
  })
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

  if (!workspace?.blueprint) {
    throw new Error('Grant workspace not found')
  }

  const sectionDraft = workspace.blueprint.sectionDrafts.find((section) => section.sectionKey === input.sectionKey)
  if (!sectionDraft) {
    throw new Error('Grant section not found')
  }

  return prisma.$transaction(async (tx) => {
    let savedDraft = sectionDraft

    if (sectionDraft.sectionType === 'narrative' || sectionDraft.sectionType === 'short_answer') {
      savedDraft = await tx.grantSectionDraft.update({
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

      savedDraft = await tx.grantSectionDraft.update({
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

