import { prisma } from '@/lib/prisma'
import { buildGrantPrepIdeationDecisionMarker } from '@/lib/grantPrep/decisionMarker'
import {
  compileGrantPrepIdeaAnchor,
  hashGrantPrepIdeaAnchor,
  hashGrantPrepIdeaConstraints,
} from '@/lib/grantPrep/ideaAnchor'
import { resolveGrantPrepTenantContext } from '@/lib/grantPrep/llm'
import {
  buildGrantPrepModeWarning,
  createOrReuseGrantPrepSession,
  inflateGrantPrepSessionContext,
  loadGrantPrepSession,
  normalizeGrantPrepForPersistence,
  resolveGrantPrepContext,
} from '@/lib/grantPrep/server'
import {
  applyMarkerToStageStates,
  collectGlobalKeywords,
  isGrantPrepSessionReady,
  seedGrantPrepStagePointsFromIdeaAnchor,
} from '@/lib/grantPrep/sessionState'
import { getNextEnabledPickableStageKey } from '@/lib/grantPrep/stageLibrary'
import { buildDeterministicGrantPrepStageMemory } from '@/lib/grantPrep/stageMemory'
import { resolveMutableGrantPrepStatus } from '@/lib/grantPrep/status'
import type { GrantPrepEngagementMode, GrantPrepIdeationDecision } from '@/lib/grantPrep/types'
import { loadAnchoredFundingCall } from '@/lib/ideaIntelligence/service'
import type { IdeaCallGap, IdeaReviewerPersona } from '@/lib/ideaIntelligence/service'

type HandoffActor = {
  id: string
  email?: string | null
  tenantId: string
  isSuperAdmin?: boolean
}

function toStringList(value: unknown, maxItemLength = 300): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim().slice(0, maxItemLength))
    .filter(Boolean)
}

function stageLabel(stageKey: string) {
  return stageKey.replace(/_/g, ' ')
}

function buildGrantProjectName(call: { scheme_title?: string | null; title?: string | null }) {
  const baseTitle = (call.scheme_title || call.title || 'Funding Call').trim()
  const projectName = `Grant: ${baseTitle}`
  return projectName.length <= 200 ? projectName : `${projectName.slice(0, 197).trimEnd()}...`
}

function buildValidationBriefing(ideaText: string, report: Record<string, any>) {
  const differentiators = toStringList(report?.differentiators).slice(0, 5)
  const risks = toStringList(report?.risks).slice(0, 5)
  const gaps: IdeaCallGap[] = Array.isArray(report?.callGaps) ? report.callGaps : []
  const reviewerPanel: IdeaReviewerPersona[] = Array.isArray(report?.reviewerPanel) ? report.reviewerPanel : []
  const callFit = Array.isArray(report?.callFit) ? report.callFit : []
  const targetFit = callFit.find((item: any) => item?.fundingCallId === report?.targetFundingCallId) || callFit[0] || null

  const conversation: Array<{ role: string; content: string }> = [
    { role: 'user', content: `My validated research idea: ${ideaText.slice(0, 1000)}` },
  ]
  const findingsLines = [
    report?.executiveVerdict ? `Validation verdict: ${String(report.executiveVerdict).slice(0, 500)}` : null,
    differentiators.length ? `Evidence-backed differentiators: ${differentiators.join(' | ')}` : null,
    targetFit?.fitSummary ? `Call fit: ${String(targetFit.fitSummary).slice(0, 500)}` : null,
    risks.length ? `Known risks: ${risks.join(' | ')}` : null,
  ].filter(Boolean)
  if (findingsLines.length) {
    conversation.push({ role: 'assistant', content: findingsLines.join('\n') })
  }
  const gapLinesForModel = [
    gaps.length
      ? `Gaps to address: ${gaps.slice(0, 6).map((gap) => `${gap.title} (fix: ${gap.fixSuggestion || 'see analysis'})`).join(' | ')}`
      : null,
    reviewerPanel.length
      ? `Likely reviewer objections: ${reviewerPanel.flatMap((persona) => persona.objections.slice(0, 2).map((objection) => objection.objection)).slice(0, 6).join(' | ')}`
      : null,
  ].filter(Boolean)
  if (gapLinesForModel.length) {
    conversation.push({ role: 'assistant', content: gapLinesForModel.join('\n') })
  }

  const gapBullets = gaps.slice(0, 6).map((gap) =>
    `- **${gap.title}** (${gap.severity}${gap.grantPrepStageKey ? `, address in *${stageLabel(gap.grantPrepStageKey)}*` : ''}): ${gap.fixSuggestion || gap.detail}`
  )
  const objectionBullets = reviewerPanel
    .flatMap((persona) => persona.objections.slice(0, 2).map((objection) => `- *${persona.personaLabel}*: ${objection.objection}`))
    .slice(0, 6)
  const welcomeMessage = [
    'Your validated idea has been carried over from Idea Intelligence and locked in as the finalized idea for this proposal.',
    report?.executiveVerdict ? `\n**Validation verdict:** ${String(report.executiveVerdict).slice(0, 600)}` : null,
    differentiators.length ? `\n**Differentiators to build on:**\n${differentiators.map((item) => `- ${item}`).join('\n')}` : null,
    gapBullets.length ? `\n**Gaps the validation flagged (we will work through these in the relevant stages):**\n${gapBullets.join('\n')}` : null,
    objectionBullets.length ? `\n**Reviewer objections to pre-empt:**\n${objectionBullets.join('\n')}` : null,
    '\nLet\'s continue from here - the stages ahead will turn this into a submission-ready blueprint.',
  ].filter(Boolean).join('\n')

  return { conversation, welcomeMessage }
}

export async function handoffIdeaRunToGrantPrep(input: {
  runId: string
  actor: HandoffActor
  fundingCallId?: string | null
  engagementMode?: GrantPrepEngagementMode
  projectName?: string | null
  idempotencyKey: string
}) {
  const run = await prisma.ideaIntelligenceRun.findFirst({
    where: { id: input.runId, userId: input.actor.id },
    include: { session: true },
  })
  if (!run) throw new Error('Idea analysis not found')
  if (run.status !== 'COMPLETED') throw new Error('Finish the idea analysis before starting Grant Prep.')

  const report = (run.reportJson || {}) as Record<string, any>
  const access = { tenantId: input.actor.tenantId, isSuperAdmin: Boolean(input.actor.isSuperAdmin) }
  const requestedCallId = input.fundingCallId || run.anchorFundingCallId || report.targetFundingCallId || null
  if (!requestedCallId) {
    throw new Error('Pick a funding call to prepare against before starting Grant Prep.')
  }

  // A session that was already handed off routes back to the same prep workspace
  // instead of creating a duplicate project, unless a different call is requested.
  if (run.session?.linkedGrantPrepSessionId) {
    const linked = await prisma.grantPrepSession.findFirst({
      where: { id: run.session.linkedGrantPrepSessionId, tenantId: input.actor.tenantId },
      select: { id: true, project_id: true, funding_call_id: true, status: true },
    })
    if (linked && linked.status !== 'archived' && (!input.fundingCallId || linked.funding_call_id === requestedCallId)) {
      return {
        reused: true as const,
        projectId: linked.project_id,
        grantPrepSessionId: linked.id,
        grantSessionId: null,
        launchUrl: null,
        prepUrl: `/projects/${linked.project_id}/grants/${linked.id}/prep`,
        anchorCompilationSource: null,
        warning: null,
      }
    }
  }

  const fundingCall = await loadAnchoredFundingCall(requestedCallId, access)
  if (!fundingCall) throw new Error('The selected funding call was not found or is not accessible.')

  const project = await prisma.project.create({
    data: {
      name: input.projectName || buildGrantProjectName(fundingCall),
      projectType: 'GRANT',
      userId: input.actor.id,
      tenantId: input.actor.tenantId,
    },
    select: { id: true, name: true },
  })

  try {
    const sessionResult = await createOrReuseGrantPrepSession({
      projectId: project.id,
      tenantId: input.actor.tenantId,
      user: { id: input.actor.id, email: input.actor.email ?? null, tenantId: input.actor.tenantId },
      fundingCallId: fundingCall.id,
      engagementMode: input.engagementMode || 'expert',
      restart: false,
    })
    if (!sessionResult.session) throw new Error('Failed to create the Grant Prep session')

    const session = await loadGrantPrepSession({ sessionId: sessionResult.session.id, tenantId: input.actor.tenantId })
    if (!session) throw new Error('The Grant Prep session could not be loaded after creation')

    const serverContext = await resolveGrantPrepContext(
      session.project_id,
      { id: input.actor.id, email: input.actor.email ?? null, tenantId: input.actor.tenantId },
      { grantSessionId: session.grant_session_id, fundingCallId: session.funding_call_id }
    )
    const prepContext = inflateGrantPrepSessionContext(session, {
      warning: buildGrantPrepModeWarning(serverContext.mode, serverContext.fundingContext.warning),
    })

    const briefing = buildValidationBriefing(run.ideaText, report)
    const tenantContext = await resolveGrantPrepTenantContext(input.actor.tenantId, input.actor.id)
    const compiled = await compileGrantPrepIdeaAnchor({
      option: {
        label: 'Validated idea',
        text: run.ideaText.slice(0, 4000),
        rationale: report.executiveVerdict ? String(report.executiveVerdict).slice(0, 1000) : null,
      },
      ideationStage: prepContext.stageStates.ideation,
      recentConversation: briefing.conversation,
      fundingContext: serverContext.fundingContext,
      selectedPriorityAreas: prepContext.selectedThrustAreaRuleKeys,
      tenantContext,
      idempotencyKey: input.idempotencyKey,
    })
    const anchorHash = hashGrantPrepIdeaAnchor(compiled.anchor)
    const constraintHash = hashGrantPrepIdeaConstraints({
      fundingContext: serverContext.fundingContext,
      selectedPriorityAreas: prepContext.selectedThrustAreaRuleKeys,
      guidelineRevisionId: serverContext.guidelineRevisionId,
      templateRevisionId: serverContext.templateRevisionId,
    })

    let nextStageStates = applyMarkerToStageStates(
      prepContext.stageStates,
      'ideation',
      buildGrantPrepIdeationDecisionMarker(
        compiled.anchor,
        prepContext.selectedThrustAreaRuleKeys,
        'The user validated this idea in Idea Intelligence and handed it off to Grant Prep.'
      ),
      {
        engagementMode: prepContext.engagementMode,
        selectedThrustAreaRuleKeys: prepContext.selectedThrustAreaRuleKeys,
        availableFocusAreas: serverContext.fundingContext.focusAreas || [],
        budgetLimits: serverContext.fundingContext.budgetLimits || null,
        projectDuration: serverContext.fundingContext.projectDuration || null,
      }
    )
    const decision: GrantPrepIdeationDecision = {
      status: 'fixed',
      revision: 1,
      fixedAt: new Date().toISOString(),
      sourceMessageId: `idea-intelligence:${run.id}`,
      clientRequestId: input.idempotencyKey,
      selectedOption: {
        label: 'Validated idea',
        text: run.ideaText.slice(0, 4000),
        rationale: report.executiveVerdict ? String(report.executiveVerdict).slice(0, 1000) : null,
      },
      anchor: compiled.anchor,
      anchorHash,
      constraintHash,
      compilationSource: compiled.compilationSource,
    }
    nextStageStates.ideation.decision = decision
    nextStageStates.ideation.memory = buildDeterministicGrantPrepStageMemory(nextStageStates.ideation)
    nextStageStates = seedGrantPrepStagePointsFromIdeaAnchor({
      stageStates: nextStageStates,
      anchor: compiled.anchor,
      selectedPriorityAreas: prepContext.selectedThrustAreaRuleKeys,
    })

    const activeStageKey = getNextEnabledPickableStageKey(nextStageStates, 'ideation') || 'ideation'
    const nextContext = {
      ...prepContext,
      activeStageKey,
      stageStates: nextStageStates,
      globalKeywords: collectGlobalKeywords(nextStageStates),
    }
    const nextStatus = resolveMutableGrantPrepStatus({
      currentStatus: session.status,
      isReady: isGrantPrepSessionReady(nextStageStates, prepContext.engagementMode),
    })
    const persistence = normalizeGrantPrepForPersistence(nextContext)
    const updated = await prisma.grantPrepSession.updateMany({
      where: { id: session.id, updated_at: session.updated_at },
      data: { ...persistence, status: nextStatus, last_handoff_error: null },
    })
    if (updated.count !== 1) {
      throw new Error('Grant Prep changed while seeding the validated idea. Open the session and finalize the idea manually.')
    }

    await prisma.grantPrepMessage.create({
      data: {
        session_id: session.id,
        stage_key: activeStageKey,
        role: 'assistant',
        content: briefing.welcomeMessage,
        client_message_id: `idea-handoff:${run.id}`,
      },
    }).catch(() => undefined)

    if (run.sessionId) {
      await prisma.ideaIntelligenceSession.update({
        where: { id: run.sessionId },
        data: {
          projectId: project.id,
          linkedGrantPrepSessionId: session.id,
          ...(run.session?.anchorFundingCallId ? {} : { anchorFundingCallId: fundingCall.id }),
        },
      }).catch(() => undefined)
    }

    return {
      reused: false as const,
      projectId: project.id,
      grantPrepSessionId: session.id,
      grantSessionId: sessionResult.grantSessionId || null,
      launchUrl: sessionResult.launchUrl || null,
      prepUrl: sessionResult.prepUrl || `/projects/${project.id}/grants/${session.id}/prep`,
      anchorCompilationSource: compiled.compilationSource,
      warning: compiled.warning,
    }
  } catch (error) {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined)
    throw error
  }
}
