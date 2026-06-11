import type { FundingCallContext } from '../fundingContext';
import type { GuidelinePackDocument } from '../fundingGuidelines/types';
import { GRANT_PREP_STAGE_BY_KEY, GRANT_PREP_STAGE_LIBRARY } from './stageLibrary';
import { getMarkerTags } from './marker';
import { deriveGrantPrepPriorityAreaOptions } from './priorityAreas';
import {
  buildGrantPrepConversationBundle,
  formatGrantPrepConversationBundle,
  getGrantPrepCrossStageAllowedPointKeys,
} from './proactivePlanner';
import { isGrantPrepUserFacingPoint } from './sessionState';
import type {
  GrantPrepEngagementMode,
  GrantPrepIdeationContext,
  GrantPrepSessionContext,
  GrantPrepStageKey,
  GrantPrepStageStates,
  GrantPrepSuggestedAnswer,
} from './types';
import { getCanonicalGrantPrepStageKey } from './stageModel';
import { stageMemoryIsUsable } from './stageMemory';

export type GrantPrepPromptMessage = {
  role: string;
  content: string;
  stageKey?: GrantPrepStageKey | string | null;
  createdAt?: string | Date | null;
  suggestedAnswers?: GrantPrepSuggestedAnswer[] | null;
};

function asStringArray(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : [];

  return source
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function buildCrossStageContext(
  stageStates: GrantPrepStageStates,
  currentStageKey: GrantPrepStageKey,
  engagementMode: GrantPrepEngagementMode
): string {
  const stageBlocks = GRANT_PREP_STAGE_LIBRARY
    .filter(
      (stage) =>
        stage.pickable &&
        stage.key !== currentStageKey &&
        stageStates[stage.key]?.enabled
    )
    .map((stage) => {
      const state = stageStates[stage.key];
      if (stageMemoryIsUsable(state.memory)) {
        const memory = state.memory;
        const sections = [
          memory.confirmedFacts.length > 0
            ? `  Confirmed facts: ${memory.confirmedFacts.slice(0, 6).join(' ')}`
            : null,
          memory.openGaps.length > 0
            ? `  Open gaps: ${memory.openGaps.slice(0, 4).join(' ')}`
            : null,
          memory.reviewerRisks.length > 0
            ? `  Reviewer risks: ${memory.reviewerRisks.slice(0, 4).join(' ')}`
            : null,
          memory.keywords.length > 0
            ? `  Keywords: ${memory.keywords.slice(0, 8).join(', ')}`
            : null,
        ].filter(Boolean);

        if (sections.length > 0) {
          return `${stage.title} (${Math.round(state.readiness * 100)}% ready):\n${sections.join('\n')}`;
        }
      }

      const visiblePoints = state.points
        .map((point) => ({
          status: point.status,
          label: point.label,
          captureBasis: asStringArray(point.capture?.captureBasis),
          keywords: asStringArray(point.capture?.keywords),
          factBullets: asStringArray(point.capture?.factBullets),
          ruleNotes: asStringArray(point.capture?.ruleNotes),
        }))
        .filter((point) => {
          const hasUsableContent = point.keywords.length > 0 || point.factBullets.length > 0;
          if (!hasUsableContent) {
            return false;
          }

          if (engagementMode === 'expert') {
            return point.status === 'covered' && !point.captureBasis.includes('generic_placeholder');
          }

          return true;
        })
        .map((point) => {
          const facts = point.factBullets.length > 0
            ? `Facts: ${point.factBullets.slice(0, 3).join(' ; ')}`
            : null;
          const keywords = point.keywords.length > 0
            ? `Keywords: ${point.keywords.slice(0, 6).join(', ')}`
            : null;
          const ruleNotes = point.ruleNotes.length > 0
            ? `Rule notes: ${point.ruleNotes.slice(0, 2).join(' ; ')}`
            : null;
          return `  - ${point.label}: ${[facts, keywords, ruleNotes].filter(Boolean).join(' | ')}`;
        });

      if (visiblePoints.length === 0) {
        return null;
      }

      return `${stage.title} (${Math.round(state.readiness * 100)}% ready):\n${visiblePoints.join('\n')}`;
    })
    .filter((block): block is string => Boolean(block));

  if (stageBlocks.length === 0) {
    return 'No prior stages have captured content yet.';
  }

  return stageBlocks.join('\n\n');
}

function isCurrentStageMessage(message: GrantPrepPromptMessage, stageKey: GrantPrepStageKey) {
  if (!message.stageKey) {
    return true;
  }

  return getCanonicalGrantPrepStageKey(message.stageKey as GrantPrepStageKey) === stageKey;
}

function hasSuggestedAnswers(message: GrantPrepPromptMessage) {
  return (
    message.role === 'assistant' &&
    Array.isArray(message.suggestedAnswers) &&
    message.suggestedAnswers.length > 0
  );
}

function formatPromptMessage(message: GrantPrepPromptMessage) {
  const stageLabel = message.stageKey
    ? ` [stage=${getCanonicalGrantPrepStageKey(message.stageKey as GrantPrepStageKey)}]`
    : '';
  return `${message.role.toUpperCase()}${stageLabel}: ${message.content}`;
}

function buildStageAwareConversation(
  conversation: GrantPrepPromptMessage[],
  stageKey: GrantPrepStageKey,
  options?: { recentLimit?: number }
) {
  const recentLimit = options?.recentLimit ?? 8;
  const indexed = conversation.map((message, index) => ({ message, index }));
  const recentCurrent = indexed
    .filter(({ message }) => isCurrentStageMessage(message, stageKey))
    .slice(-recentLimit);
  const latestSuggestedAnswerMessage = [...indexed]
    .reverse()
    .find(({ message }) => hasSuggestedAnswers(message));
  const selected = new Map<number, GrantPrepPromptMessage>();

  for (const item of recentCurrent) {
    selected.set(item.index, item.message);
  }
  if (latestSuggestedAnswerMessage) {
    selected.set(latestSuggestedAnswerMessage.index, latestSuggestedAnswerMessage.message);
  }

  return Array.from(selected.entries())
    .sort(([left], [right]) => left - right)
    .map(([, message]) => formatPromptMessage(message))
    .join('\n');
}

function formatGuidelineRule(item: { text?: string | null; enforcementLevel?: string | null; draftingVsSubmission?: string | null; rationale?: string | null }) {
  const flags = [
    String(item.enforcementLevel || '').trim(),
    String(item.draftingVsSubmission || '').trim(),
  ].filter(Boolean).join('/');
  const rationale = String(item.rationale || '').trim();
  return `${flags ? `[${flags}] ` : ''}${String(item.text || '').trim()}${rationale ? ` | Why: ${rationale}` : ''}`;
}

function compactList(label: string, items: Array<{ text?: string | null; enforcementLevel?: string | null; draftingVsSubmission?: string | null; rationale?: string | null }> | undefined, limit = 4) {
  if (!Array.isArray(items) || items.length === 0) {
    return `${label}: none`;
  }

  const formatted = items
    .map((item) => formatGuidelineRule(item))
    .filter(Boolean)
    .slice(0, limit);
  return `${label}:\n${formatted.map((item) => `- ${item}`).join('\n')}`;
}

function buildGuidelineBlock(guidelinePack: GuidelinePackDocument | null | undefined, stageKey: GrantPrepStageKey) {
  const stage = GRANT_PREP_STAGE_BY_KEY[stageKey];
  if (!guidelinePack) {
    return 'Approved guideline pack: not attached.';
  }

  const lines = stage.guidelineBlocks.map((blockKey) => compactList(blockKey, (guidelinePack as any)?.[blockKey], 4));
  return lines.join('\n');
}

function buildIdeationGuidelineBlock(guidelinePack: GuidelinePackDocument | null | undefined) {
  if (!guidelinePack) {
    return 'Approved guideline pack: not attached.';
  }

  return ['priorities', 'mustAddress', 'evaluationCriteria', 'reviewerSignals', 'avoid']
    .map((blockKey) => compactList(blockKey, (guidelinePack as any)?.[blockKey], 5))
    .join('\n');
}

function buildIdeationContextBlock(context: GrantPrepIdeationContext | null | undefined) {
  if (!context?.hasUsableContext) {
    return [
      'Researcher grounding context: none available.',
      'If the user pasted publications in the latest message, use only the first five publications in that message as grounding.',
      'If no publications or profile context are available, still recommend ideas from the funding call, selected priorities, and agency requirements, but say the personalization is limited.',
    ].join('\n');
  }

  const profileLines = context.profile
    ? [
        context.profile.researchSummary ? `Research summary: ${context.profile.researchSummary}` : null,
        context.profile.researchAreas.length ? `Research areas: ${context.profile.researchAreas.join(', ')}` : null,
        context.profile.keywords.length ? `Keywords: ${context.profile.keywords.join(', ')}` : null,
        context.profile.institutionName ? `Institution: ${context.profile.institutionName}` : null,
        context.profile.institutionType ? `Institution type: ${context.profile.institutionType}` : null,
        context.profile.careerStage ? `Career stage: ${context.profile.careerStage}` : null,
      ].filter(Boolean)
    : [];
  const savedAreaLines = context.savedResearchAreas.slice(0, 5).map((area, index) => {
    const details = [
      area.researchArea,
      area.keywords.length ? `keywords: ${area.keywords.join(', ')}` : null,
      area.disciplines.length ? `disciplines: ${area.disciplines.join(', ')}` : null,
      area.taxonomyPath ? `taxonomy: ${area.taxonomyPath}` : null,
    ].filter(Boolean).join(' | ');
    return `${index + 1}. ${area.label}${details ? ` - ${details}` : ''}`;
  });
  const publicationLines = context.publications.slice(0, 5).map((publication, index) => {
    const details = [
      publication.year ? String(publication.year) : null,
      publication.venue,
      publication.doi ? `doi: ${publication.doi}` : null,
      publication.abstractSnippet ? `abstract: ${publication.abstractSnippet}` : null,
    ].filter(Boolean).join(' | ');
    return `${index + 1}. ${publication.title}${details ? ` - ${details}` : ''}`;
  });

  return [
    `Researcher grounding context sources: ${context.sourceSummary.join(', ') || 'unspecified'}.`,
    profileLines.length ? `Profile signals:\n${profileLines.map((line) => `- ${line}`).join('\n')}` : 'Profile signals: none.',
    savedAreaLines.length ? `Saved research areas:\n${savedAreaLines.join('\n')}` : 'Saved research areas: none.',
    publicationLines.length ? `Tagged publications:\n${publicationLines.join('\n')}` : 'Tagged publications: none.',
    'Use this context only to ground feasible directions. Do not invent publication details, collaborators, track record, or applicant credentials.',
  ].join('\n');
}

function formatInlineList(values: string[], fallback = 'Not specified') {
  return values.length > 0 ? values.join(', ') : fallback;
}

function buildPriorityAreaPromptLines(session: GrantPrepSessionContext, fundingContext: FundingCallContext) {
  const availablePriorityAreas = deriveGrantPrepPriorityAreaOptions(fundingContext);
  const selectedPriorityAreas = session.selectedThrustAreaRuleKeys || [];

  return [
    `Available call priority areas: ${formatInlineList(availablePriorityAreas)}`,
    `User-selected target priority areas: ${formatInlineList(selectedPriorityAreas, 'None selected')}`,
  ];
}

function buildPriorityAreaPromptRules(session: GrantPrepSessionContext) {
  const selectedPriorityAreas = session.selectedThrustAreaRuleKeys || [];
  if (selectedPriorityAreas.length === 0) {
    return [
      'Priority area use:',
      '- If the user has not selected target priority areas, use available call priority areas only as background fit signals.',
      '- Do not broaden the proposal into unrelated priority areas.',
    ].join('\n');
  }

  return [
    'Priority area use:',
    '- Treat user-selected target priority areas as preferred strategic alignment anchors.',
    '- Do not broaden to unselected priority areas unless the user asks for it or the selected fit is weak.',
      '- For fit_and_scope priority_match captures, prefer selected priority area labels in thrustLinkage when they accurately match the user-confirmed facts.',
  ].join('\n');
}

function getConcreteFactTargets(stageKey: GrantPrepStageKey): string[] {
  const defaultTargets = [
    'problem scale, urgency, or baseline when relevant',
    'specific beneficiaries, setting, or institution',
    'methodology, delivery, or implementation detail',
    'feasibility proof, capability, precedent, or risk control',
    'success metric, milestone, output, or evaluation signal',
    'funder fit, call priority, or rule constraint',
  ];

  const targetsByStage: Partial<Record<GrantPrepStageKey, string[]>> = {
    problem_definition: [
      'problem scale, burden, cost, prevalence, or baseline',
      'who is affected, where, and why this setting matters',
      'current practice, comparator, or unresolved gap',
      'urgency or timing tied to the funding call',
      'funder priority or reviewer criterion this problem serves',
    ],
    root_cause: [
      'specific drivers or mechanisms behind the problem',
      'evidence or logic showing why those drivers matter',
      'where current approaches fail and why',
      'the leverage point the project can realistically change',
    ],
    beneficiaries: [
      'direct beneficiaries with inclusion criteria or size estimate',
      'indirect beneficiaries or system-level stakeholders',
      'geographic, institutional, or service setting',
      'barriers, needs, or value created for each group',
    ],
    fit_and_scope: [
      'call priority, eligibility, or template requirement served',
      'scope boundary, geography, duration, or delivery setting',
      'why this funder is the right fit',
      'selected thrust or priority area and exact fit',
      'reviewer value signal being strengthened',
      'what the proposal will not attempt',
    ],
    thrust_alignment: [
      'selected thrust or priority area and exact fit',
      'call language or evaluation criterion being answered',
      'proposal contribution to funder outcomes',
      'scope or eligibility caveat that must be respected',
    ],
    methodology: [
      'core intervention or technical approach components',
      'who does what, when, and with what assets',
      'data, validation, or evidence-generation method',
      'phases, milestones, and time-bound deliverables',
      'responsible owner or partner for each workstream',
      'feasibility proof, pilot, prototype, or delivery precedent',
      'method-specific risks and controls',
    ],
    workplan: [
      'phases, milestones, and time-bound deliverables',
      'responsible owner or partner for each workstream',
      'dependencies, decision gates, or critical path',
      'evidence that the timeline is feasible',
    ],
    team_and_partnerships: [
      'named roles, expertise, and delivery responsibilities',
      'partner contribution, facility, data access, or network',
      'governance or coordination mechanism',
      'track record or capability proof',
    ],
    innovation: [
      'current practice or comparator the proposal improves on',
      'distinctive mechanism, population, setting, or integration',
      'why the innovation is feasible now',
      'defensible advantage under review criteria',
      'post-grant owner, adoption route, or institutional home',
      'scale setting, beneficiary growth, or replication path',
    ],
    evaluation: [
      'success metrics, baselines, targets, or thresholds',
      'data source, measurement method, and verification cadence',
      'who validates outcomes and when',
      'how findings will change decisions or scale-up plans',
    ],
    outcomes: [
      'specific outputs, outcomes, and beneficiary changes',
      'baseline and target values where available',
      'time horizon for expected results',
      'how outcomes map to funder priorities',
    ],
    risk_and_ethics: [
      'named technical, delivery, ethical, privacy, or adoption risks',
      'mitigation owner, trigger, and contingency',
      'required approval, safeguard, or compliance step',
      'residual risk and why it is acceptable',
    ],
    budget_strategy: [
      'main cost drivers tied to workplan activities',
      'value-for-money argument or benchmark',
      'matched support, in-kind assets, or sustainability contribution',
      'budget risk, tradeoff, or justification gap',
    ],
    sustainability_and_scale: [
      'post-grant owner, adoption route, or institutional home',
      'scale setting, beneficiary growth, or replication path',
      'resources, partnerships, or policy hooks needed after funding',
      'evidence that uptake is plausible',
    ],
    final_pitch: [
      'one-sentence reviewer-facing case for funding',
      'strongest problem, method, feasibility, and impact facts',
      'why this team and this call fit now',
      'one concrete outcome the funder can remember',
    ],
  };

  return targetsByStage[stageKey] || defaultTargets;
}

function getResponseRules(engagementMode: GrantPrepEngagementMode, stageKey: GrantPrepStageKey) {
  if (engagementMode === 'express') {
    return [
      'The user is in Express mode. They may paste a multi-paragraph pitch or draft text.',
      'Extract as many discussion points as you can identify from their input. Do not ask one-at-a-time questions.',
      'Write at most 50 words of prose summarizing what you captured and what is still missing.',
      'Put all detail into the marker. Capture multiple pointsCovered entries if the input covers multiple topics.',
      'If the input is short, ask one coverage-bundle question that covers several hard facts and provide exactly three approval bundle options labeled A, B, C.',
      'Each answer option should cover 2-4 point keys when possible and include structured covers metadata in the marker.',
      'Every option should be usable as an approval message: the user should be able to send it with minimal edits.',
    ].join('\n');
  }

  if (stageKey === 'risk_and_ethics' || stageKey === 'budget_strategy') {
    return [
      'PROSE: Write 40-70 words across at most 2 short paragraphs.',
      'In Expert mode, if there is a blocker, cite one reviewer or guideline risk and propose one next move.',
      'QUESTION + OPTIONS: Ask one coverage-bundle question, then provide exactly three answer options labeled A, B, C.',
      'Each option: 1-3 compact sentences, specific and grounded. Do not count options toward the prose word limit.',
      'Where safe, make each option cover the current risk/budget point plus one downstream implication, but keep risk and ethics mostly standalone unless the user explicitly gives related details.',
    ].join('\n');
  }

  const needsCompetitiveProbing = ['problem_definition', 'root_cause', 'beneficiaries', 'innovation'].includes(stageKey);
  const rules = [
    'PROSE: Write 70-120 words across at most 2 short paragraphs.',
    'Cover VALIDATE, CHALLENGE, DIFFERENTIATE, and CONNECT in the prose. Help the user think like a reviewer, not just answer the question.',
    'Actively use the stage steering rule, reviewer rubric, approved guideline context, funding call constraints, mapped template guidance, and prior captured facts provided below.',
    'If the current answer is not concrete enough to support downstream drafting, do not accept it as reviewer-ready.',
    'If the user\'s last answer is weak, name the reviewer risk directly and explain what evidence, specificity, or differentiation is missing.',
    '',
    'RESPONSE ORDER: brief reviewer diagnosis; one sentence saying what this turn will resolve; one bundled question; exactly three options A, B, C; marker JSON.',
    'QUESTION + OPTIONS: After the prose, ask ONE coverage-bundle approval question, then provide exactly three approval bundle options labeled A, B, C.',
    'Each option should be:',
    '  - 1-3 sentences written in the user\'s voice (first person) or as direct proposal wording',
    '  - Specific and grounded in the funding call, prior answers, stage guidance, or domain norms',
    '  - Meaningfully different from each other (different angles, methods, scopes, or framing choices)',
    '  - Bundled to cover 3-5 concrete reviewer-useful facts across 2-4 point keys where possible',
    '  - Clear about which parts are user-approved facts versus AI-inferred drafting language',
    '  - Free of fixed approval preambles; start directly with the substantive answer',
    'If one option is stronger than others from a reviewer perspective, briefly note why.',
    '',
    'WORD BUDGET: The prose portion is 70-120 words. The options are ADDITIONAL and do not count toward the prose limit.',
    'Do not recap earlier stages unless it is needed to surface a contradiction, strengthen alignment, or show why a reviewer would care.',
  ];

  if (needsCompetitiveProbing) {
    rules.push(
      '',
      'COMPETITIVE PROBING:',
      'Before accepting an answer, mentally simulate: "If 200 proposals were submitted to this call, how many would frame the problem this way?"',
      'If the answer is "many," push back before capturing. Name what is commonly proposed and suggest a more distinctive angle, mechanism, population, context, or timely trigger.',
      'If the current framing is generic, use the answer options to contrast a common framing versus sharper, more competitive versions.'
    );
  }

  return rules.join('\n');
}

export function buildIdeationPrompt(input: {
  session: GrantPrepSessionContext;
  stageKey: GrantPrepStageKey;
  project: { title: string; description: string | null };
  fundingContext: FundingCallContext;
  guidelinePack: GuidelinePackDocument | null | undefined;
  ideationContext?: GrantPrepIdeationContext | null;
  conversation: GrantPrepPromptMessage[];
  userMessage: string;
}) {
  const stage = GRANT_PREP_STAGE_BY_KEY[input.stageKey];
  const stageState = input.session.stageStates[input.stageKey];
  const markerTags = getMarkerTags();
  const currentConversation = buildStageAwareConversation(input.conversation, input.stageKey, { recentLimit: 8 });
  const allowedPointKeys = (stageState?.points || []).map((point) => point.key);
  const pendingPoints = (stageState?.points || [])
    .filter((point) => point.status !== 'covered')
    .map((point) => `- pointKey=${point.key} | label=${point.label} | help=${point.label}`)
    .join('\n');
  const rubric = stage.reviewerRubric;

  return [
    'You are Grant Prep in Idea & Angle mode, acting as a grant idea coach.',
    'Your job is to help the user shape a distinctive, funder-aligned idea before they move into Problem Definition.',
    'Do not validate the idea as finished. Coach the strategic angle and help the user decide whether to keep exploring or lock in the direction.',
    '',
    'Each turn must do the following:',
    '1. Acknowledge the user\'s idea, pasted publication base, or request for recommendations in one concise sentence.',
    '2. Diagnose 1-2 fundability signals from agency fit, distinctiveness, feasibility, and significance.',
    '3. Use selected target priority areas and agency requirements to judge call alignment.',
    '4. Offer exactly three exploratory idea cards labeled A, B, and C. Each card must be concrete, meaningfully different, and written as a possible strategic grant angle.',
    '5. End by giving the user a clear choice to explore one card, ask for 3 more ideas, edit a card, or lock in and continue.',
    '',
    'Priority area use:',
    '- Treat selected target priority areas as preferred alignment anchors.',
    '- Do not broaden to unselected areas unless the user asks or the selected fit is weak.',
    '- If no selected target priority area is available, use the available call priority areas only as background fit signals.',
    '',
    'Funding agency alignment rules:',
    '- Every suggested idea must satisfy the funding agency requirements visible in the call facts and guideline context.',
    '- Do not suggest an idea that conflicts with eligibility, budget, duration, focus areas, selected priority areas, must-address rules, or explicit avoid rules.',
    '- If an otherwise interesting idea has a fit risk, do not present it as a card. Replace it with a better-aligned option.',
    '- Each card text must include the phrase "Fits this call because" followed by a specific agency-fit reason.',
    '- Each card rationale must include compact scores in this format: "Fit x/5; Distinctiveness x/5; Feasibility x/5; Significance x/5."',
    '- If the latest user message asks for more ideas, generate three new non-repeated ideas and avoid near-duplicates of prior cards in the conversation.',
    '- If the latest user message contains pasted publications, use at most the first five publications as grounding and connect each idea to one or more of those publications where relevant.',
    '- If more than five publications appear in the latest user message, ask the user to reduce the list to five before generating ideas.',
    '',
    'Current project:',
    `Title: ${input.project.title}`,
    `Description: ${input.project.description || 'Not provided'}`,
    '',
    'Funding call facts:',
    `Call title: ${input.fundingContext.title || 'Not specified'}`,
    `Agency: ${input.fundingContext.agencyName || 'Not specified'}`,
    `Deadline: ${input.fundingContext.deadline || 'Not specified'}`,
    `Funding: ${input.fundingContext.funding || 'Not specified'}`,
    `Duration: ${input.fundingContext.projectDuration || 'Not specified'}`,
    `Eligibility: ${input.fundingContext.eligibility || 'Not specified'}`,
    `Focus areas: ${formatInlineList(input.fundingContext.focusAreas || [])}`,
    ...buildPriorityAreaPromptLines(input.session, input.fundingContext),
    `Warning: ${input.fundingContext.warning || 'None'}`,
    '',
    'Selective guideline context for ideation:',
    buildIdeationGuidelineBlock(input.guidelinePack),
    '',
    'Researcher and publication grounding:',
    buildIdeationContextBlock(input.ideationContext),
    '',
    `Current stage: ${stage.title}`,
    `Stage goal: ${stage.description}`,
    `Stage steering rule: ${stage.steeringRule}`,
    ...(rubric
      ? [
          'Stage quality rubric:',
          `- Strong: ${rubric.strong}`,
          `- Adequate: ${rubric.adequate}`,
          `- Weak: ${rubric.weak}`,
        ]
      : []),
    'Ideation facts that can be captured once user-confirmed:',
    pendingPoints || '- None',
    `Allowed point keys for this stage: ${allowedPointKeys.join(', ') || 'none'}`,
    '',
    'Conversation so far:',
    currentConversation || 'No prior messages.',
    '',
    `Latest user message: ${input.userMessage}`,
    '',
    'After your prose, append a valid JSON marker exactly once.',
    'The marker is mandatory. If you omit it, the response is unusable and the session will not save progress.',
    `Wrap it with ${markerTags.open} and ${markerTags.close}.`,
    'The marker must follow this schema and must not introduce any extra top-level fields:',
    '{',
    '  "version": "brainstorm_marker_v1",',
    '  "stageKey": "ideation",',
    '  "pointsCovered": [{ "pointKey": "...", "keywords": ["..."], "thrustLinkage": ["selected priority area label if confirmed"], "factBullets": ["specific user-confirmed ideation fact"], "ruleNotes": ["fit, distinctiveness, feasibility, or significance caveat"], "confidence": 0.85, "captureBasis": ["user_confirmed"], "ruleCompliance": { "status": "ok", "reason": null, "rescopeNeeded": false } }],',
    '  "currentPoint": "pointKey this turn is exploring" | null,',
    '  "suggestedAnswers": [{ "label": "A", "text": "Concrete grant idea card text including title, strategic angle, source grounding, and a sentence beginning Fits this call because...", "rationale": "Fit x/5; Distinctiveness x/5; Feasibility x/5; Significance x/5. Why this option is agency-aligned and competitive." }],',
    '  "qualityAssessment": "strong" | "adequate" | "weak" | null,',
    '  "steeringEvents": [{ "level": "hard_block"|"gentle_redirect"|"awareness_nudge", "message": "...", "pointKey": "..." | null }]',
    '}',
    'Use suggestedAnswers for exploratory directions only. Return exactly 3 directions with labels A, B, and C.',
    'Use pointsCovered only for facts the user has confirmed in their own message or by selecting a direction.',
    'For each covered point, include 1-3 short complete factBullets as the primary drafting facts. Keep keywords as compact tags only.',
    'For selected priority fit, put selected priority area labels in thrustLinkage only when the alignment is defensible.',
    'Do not invent new point keys. Use only the allowed point keys listed above.',
    'Example ending:',
    `${markerTags.open}{"version":"brainstorm_marker_v1","stageKey":"ideation","pointsCovered":[],"currentPoint":"idea_core","suggestedAnswers":[{"label":"A","text":"Rural Clinic Follow-up Risk Dashboard: Focus the proposal on a dashboard that helps rural clinics prioritize diabetes patients at risk of missed follow-up. Fits this call because it addresses implementation, public health delivery, and measurable adherence outcomes.","rationale":"Fit 5/5; Distinctiveness 4/5; Feasibility 4/5; Significance 4/5. Strong agency fit with a concrete delivery setting."},{"label":"B","text":"Community Health Worker AI Triage Tool: Focus the proposal on decision support for frontline workers who manage diabetes adherence visits. Fits this call because it converts prior intervention evidence into scalable public health implementation.","rationale":"Fit 5/5; Distinctiveness 5/5; Feasibility 3/5; Significance 4/5. Strongly aligned but needs scope control."},{"label":"C","text":"Low-Cost Adherence Prediction Pilot: Focus the proposal on a feasible pilot that predicts adherence drop-off and tests targeted reminders. Fits this call because it is duration-conscious and produces measurable implementation evidence.","rationale":"Fit 4/5; Distinctiveness 3/5; Feasibility 5/5; Significance 4/5. Practical and funder-readable."}],"qualityAssessment":"adequate","steeringEvents":[]}${markerTags.close}`,
    'Do not include markdown code fences around the marker.',
  ].join('\n');
}

export function buildGrantPrepPrompt(input: {
  session: GrantPrepSessionContext;
  stageKey: GrantPrepStageKey;
  project: { title: string; description: string | null };
  fundingContext: FundingCallContext;
  guidelinePack: GuidelinePackDocument | null | undefined;
  conversation: GrantPrepPromptMessage[];
  userMessage: string;
}) {
  const stage = GRANT_PREP_STAGE_BY_KEY[input.stageKey];
  const stageState = input.session.stageStates[input.stageKey];
  const mapping = input.session.stageMapping[input.stageKey];
  const markerTags = getMarkerTags();
  const isExpertMode = input.session.engagementMode === 'expert';
  const pointLimit = input.session.engagementMode === 'express' ? 20 : 4;
  const conversationBundle = buildGrantPrepConversationBundle({
    session: input.session,
    stageKey: input.stageKey,
    latestUserMessage: input.userMessage,
  });
  const crossStageAllowedPointKeys = getGrantPrepCrossStageAllowedPointKeys(conversationBundle);
  const pendingPoints = stageState.points
    .filter((point) => point.status !== 'covered' && isGrantPrepUserFacingPoint(point))
    .slice(0, pointLimit)
    .map((point) => {
      const mappedPoint = mapping.discussionPoints.find((entry) => entry.key === point.key);
      return `- pointKey=${point.key} | label=${point.label} | role=${point.conversationRole || mappedPoint?.conversationRole || 'user_required'}${point.sourceTemplatePointer ? ` | pointer=${point.sourceTemplatePointer}` : ''}${mappedPoint?.helpText ? ` | help=${mappedPoint.helpText}` : ''}`;
    });
  const allowedPointKeys = stageState.points
    .filter((point) => isGrantPrepUserFacingPoint(point))
    .map((point) => point.key);
  const aiDraftablePoints = stageState.points
    .filter((point) => !isGrantPrepUserFacingPoint(point))
    .slice(0, 8)
    .map((point) => {
      const mappedPoint = mapping.discussionPoints.find((entry) => entry.key === point.key);
      return `- ${point.label} (${point.conversationRole || mappedPoint?.conversationRole || 'ai_draftable'}): ${mappedPoint?.helpText || 'Use as drafting context if relevant.'}`;
    });

  const currentConversation = buildStageAwareConversation(input.conversation, input.stageKey, { recentLimit: 8 });

  const systemRole = isExpertMode
    ? [
        'You are Grant Prep, a senior grant-writing advisor who has reviewed hundreds of funding proposals and served on grant evaluation panels.',
        'You combine the rigour of an experienced grant reviewer with the strategic thinking of a research advisor who knows what wins funding.',
        'You have deep knowledge of research landscapes: which framings are overused, which topics are heavily studied, and what makes a proposal angle feel genuinely competitive.',
        '',
        'For each turn, follow this sequence:',
        '1. VALIDATE: Check whether the user\'s answer is specific, evidence-based, call-aligned, and concrete enough for downstream drafting. If vague, generic, or unsupported, do not accept it as reviewer-ready.',
        '2. CHALLENGE: Name gaps, contradictions, unsupported claims, scope risks, or reviewer objections directly. Explain why they matter under grant-review conditions.',
        '3. DIFFERENTIATE: Use your research-landscape knowledge. If the framing sounds like a standard or textbook version of a common topic, say so. Explain what would make it more distinctive.',
        '4. CONNECT: Use the stage steering rule, stage reviewer rubric, approved guideline context, funding call facts and constraints, mapped template guidance, and prior captured facts provided below. Treat them as active reviewer constraints, not optional background.',
        '5. CAPTURE: Only capture content that is concrete enough to support later drafting. If something is still too generic but worth tracking, mark it with captureBasis that includes "generic_placeholder".',
        '6. ADVANCE: Ask one coverage-bundle approval question that materially strengthens several hard facts at once. Then give exactly three labeled approval bundle options (A, B, C) that model strong grant-writing practice.',
        '',
        'Coaching rules:',
        '- Reject vague answers. "We will address this comprehensively" is not a methodology, problem definition, or reviewer-facing claim.',
        '- Surface reviewer risk explicitly. If the call, guidelines, or rubric create a mismatch, name it and explain the consequence.',
        '- Use competitive judgment. If many applicants would frame the issue the same way, say that this will not stand out and suggest what would.',
        '- For framing-heavy stages, push for the under-studied population, mechanism, context, operational definition, or timely trigger that makes the proposal sharper.',
        '- Never invent or assume facts the user has not stated.',
        '- If the user\'s answer covers multiple current-stage discussion points, capture all valid current-stage content.',
        '- ALWAYS offer approval bundle options. Never ask a bare question without suggested answers. If context is thin, use structural but still specific templates.',
        '- Each message interaction is expensive. Ask only for hard facts that are unsafe to invent; fill safe framing gaps with AI-inferred drafting language.',
        '- If the user previously gave a weak or vague answer, your options should model what a strong, reviewer-satisfying answer looks like.',
        '- If the user provides information relevant to a planned lookahead stage, capture it in crossStagePointsCovered only when the user text or selected option clearly supports it. Otherwise use an awareness_nudge.',
      ].join('\n')
    : [
        'You are Grant Prep, a senior grant-writing advisor who helps researchers build compelling, reviewer-ready proposals.',
        'You combine the rigour of an experienced grant reviewer with the supportiveness of a trusted mentor.',
        '',
        'For each turn, follow this sequence:',
        '1. VALIDATE: Is the user\'s answer specific, evidence-based, and aligned with the funding call? If vague or generic, do not accept it.',
        '2. CHALLENGE: If the answer has gaps, contradicts earlier stages, or makes unsupported claims, push back concisely. Say what\'s missing and why it matters to reviewers.',
        '3. CONNECT: Reference relevant captured facts from prior stages or the funding call to strengthen the conversation. Show the user you remember what they said.',
        '4. CAPTURE: Extract 1-3 concrete factBullets per covered point and compact keywords as secondary tags. Only capture substantive, specific content, never vague phrases.',
        '5. ADVANCE: Ask one coverage-bundle approval question that moves multiple discussion points forward. Then provide exactly three possible approval bundles the user could give, formatted as labeled options (A, B, C). Each option should be:',
        '   - Specific and substantive (not vague or generic)',
        '   - Grounded in the funding call priorities, the user\'s prior answers, or domain conventions',
        '   - Meaningfully different from each other (e.g., different methodological approaches, different framing angles, different scoping choices)',
        '   - Written as the user would say them, first person, conversational, 1-2 sentences each',
        '',
        'Coaching rules:',
        '- Never accept generic answers. "We will address this comprehensively" is not a methodology. Push for specifics.',
        '- Compare the user\'s claims to the funding call and guidelines. If the call asks for "evidence translation" and the user says "innovation," name the mismatch.',
        '- When a steering rule fires, explain WHY it matters to a reviewer, not just that it is required.',
        '- If the user\'s answer covers multiple discussion points in one message, capture all of them. Do not ignore valid content.',
        '- Never invent or assume facts the user has not stated.',
        '- ALWAYS offer approval bundle options. Never ask a bare question without suggested answers. If you lack context to generate specific options, offer structural templates (e.g., "A: [specific population] in [specific region] faces [specific barrier] because [root cause].").',
        '- Each message interaction is expensive. Ask only for hard facts that are unsafe to invent; fill safe framing gaps with AI-inferred drafting language.',
        '- Frame options to teach grant-writing norms. If one option is stronger than others from a reviewer perspective, briefly note why (e.g., "Option B is strongest because it quantifies the gap").',
        '- If the user previously gave a weak or vague answer, your suggested options for the follow-up should model what a strong, specific answer looks like.',
        '- If the user provides information relevant to a planned lookahead stage, capture it in crossStagePointsCovered only when the user text or selected option clearly supports it. Otherwise use an awareness_nudge.',
      ].join('\n');

  const rubric = stage.reviewerRubric;

  return [
    systemRole,
    '',
    'Response rules:',
    getResponseRules(input.session.engagementMode, input.stageKey),
    '',
    'Current project:',
    `Title: ${input.project.title}`,
    `Description: ${input.project.description || 'Not provided'}`,
    '',
    'Funding call facts:',
    `Call title: ${input.fundingContext.title}`,
    `Agency: ${input.fundingContext.agencyName || 'Not specified'}`,
    `Deadline: ${input.fundingContext.deadline || 'Not specified'}`,
    `Funding: ${input.fundingContext.funding || 'Not specified'}`,
    `Duration: ${input.fundingContext.projectDuration || 'Not specified'}`,
    `Eligibility: ${input.fundingContext.eligibility || 'Not specified'}`,
    `Focus areas: ${(input.fundingContext.focusAreas || []).join(', ') || 'Not specified'}`,
    ...buildPriorityAreaPromptLines(input.session, input.fundingContext),
    `Warning: ${input.fundingContext.warning || 'None'}`,
    '',
    buildPriorityAreaPromptRules(input.session),
    '',
    'Previously captured facts from other stages:',
    buildCrossStageContext(input.session.stageStates, input.stageKey, input.session.engagementMode),
    'Use these facts to check consistency. Flag contradictions between what the user says now and what was captured earlier.',
    'Use prior captured facts to make your answer options specific and grounded.',
    '',
    `Current stage: ${stage.title}`,
    `Stage goal: ${stage.description}`,
    `Stage steering rule: ${stage.steeringRule}`,
    ...(rubric
      ? [
          'Stage quality rubric:',
          `- Strong: ${rubric.strong}`,
          `- Adequate: ${rubric.adequate}`,
          `- Weak: ${rubric.weak}`,
          'Assess the user\'s current answers against this rubric. If the coverage is weak or adequate, tell the user specifically what would make it stronger.',
        ]
      : []),
    'Concrete reviewer-useful facts to capture for this stage:',
    getConcreteFactTargets(input.stageKey).map((item) => `- ${item}`).join('\n'),
    'If these facts are not confirmed, ask for them in the approval options or label any framing as AI-inferred. Do not store invented values as user-approved facts.',
    `Mapped template pointers: ${mapping.templatePointers.join(', ') || 'None'}`,
    'Mapped template guidance for this stage:',
    (isExpertMode ? mapping.discussionPoints : mapping.discussionPoints.slice(0, pointLimit))
      .map((point) => `- ${point.label}${point.sourceTemplatePointer ? ` (${point.sourceTemplatePointer})` : ''}: ${point.helpText}`)
      .join('\n') || '- None',
    'Pending discussion points:',
    pendingPoints.join('\n') || '- None',
    `Allowed point keys for this stage: ${allowedPointKeys.join(', ') || 'none'}`,
    'AI-fill / context-only points for this stage:',
    aiDraftablePoints.join('\n') || '- None',
    'Do not ask the user separately about AI-fill/context-only points unless they hide a hard fact that is unsafe to infer.',
    '',
    formatGrantPrepConversationBundle(conversationBundle),
    `Allowed cross-stage point keys: ${crossStageAllowedPointKeys.join(', ') || 'none'}`,
    'Cross-stage capture rules:',
    '- Use crossStagePointsCovered only for the allowed cross-stage point keys listed above.',
    '- Cross-stage captures must be traceable to the latest user message, a selected answer option, funding-call facts, template guidance, or prior confirmed facts.',
    '- Use confidence >= 0.85 only when the cross-stage fact is concrete and reviewer-ready.',
    '- If a cross-stage implication is useful but not confirmed, set confidence below 0.85 or ruleCompliance.status="needs_review".',
    '',
    'Selective guideline context:',
    buildGuidelineBlock(input.guidelinePack, input.stageKey),
    '',
    'Conversation so far:',
    currentConversation || 'No prior messages.',
    '',
    `Latest user message: ${input.userMessage}`,
    '',
    'After your prose, append a valid JSON marker exactly once.',
    'The marker is mandatory. If you omit it, the response is unusable and the session will not save progress.',
    `Wrap it with ${markerTags.open} and ${markerTags.close}.`,
    'The marker must follow this schema:',
    '{',
    '  "version": "brainstorm_marker_v1",',
    `  "stageKey": "${input.stageKey}",`,
    '  "pointsCovered": [{ "pointKey": "...", "keywords": ["..."], "thrustLinkage": ["..."], "factBullets": ["specific factual capture"], "ruleNotes": ["rule or reviewer caveat"], "confidence": 0.85, "captureBasis": ["user_confirmed"], "ruleCompliance": { "status": "ok", "reason": null, "rescopeNeeded": false } }],',
    '  "crossStagePointsCovered": [{ "stageKey": "lookahead stage key", "pointKey": "...", "keywords": ["..."], "thrustLinkage": ["..."], "factBullets": ["specific factual capture"], "ruleNotes": ["traceability or reviewer caveat"], "confidence": 0.85, "captureBasis": ["inferred_from_call"], "ruleCompliance": { "status": "ok", "reason": null, "rescopeNeeded": false } }],',
    '  "currentPoint": "pointKey of the discussion point the next question targets" | null,',
    '  "suggestedAnswers": [{ "label": "A", "text": "Concrete hard fact 1; concrete hard fact 2; AI-inferred drafting implication if acceptable.", "rationale": "optional strength note", "coverageSummary": "Problem + Root Cause + Beneficiaries + Urgency", "covers": [{ "stageKey": "problem_definition", "pointKey": "problem_core", "label": "Core problem statement" }] }] | null,',
    '  "qualityAssessment": "strong" | "adequate" | "weak" | null,',
    '  "steeringEvents": [{ "level": "hard_block"|"gentle_redirect"|"awareness_nudge", "message": "...", "pointKey": "..." | null }]',
    '}',
    'Set currentPoint to the point key your next question is about.',
    'Set suggestedAnswers to exactly 3 approval bundle options whenever you ask a question. The labels must be A, B, and C, each with non-empty text. Do not put option C only in prose.',
    'Each option must be specific to the conversation bundle and funding context. Do not offer generic options like "A comprehensive approach" - offer real content the user could approve or edit.',
    'Do not reuse a fixed approval preamble before option text; start each option directly with the substantive answer.',
    'For suggestedAnswers, include coverageSummary and covers metadata whenever an option is designed to cover multiple points.',
    'If an option includes inferred filler, label it as AI-inferred inside the option text unless it is directly grounded in user/call/template facts.',
    'If one option is clearly stronger from a reviewer perspective, include a short rationale explaining why.',
    'In Expert mode, if a captured point is still generic or only a placeholder for stronger content, set captureBasis to include "generic_placeholder".',
    'In Expert mode, do not mark placeholder wording as fully reviewer-ready.',
    'Set qualityAssessment based on how the user\'s answers so far compare to the stage reviewer rubric.',
    'Example ending:',
    `${markerTags.open}{"version":"brainstorm_marker_v1","stageKey":"${input.stageKey}","pointsCovered":[],"currentPoint":null,"suggestedAnswers":null,"qualityAssessment":null,"steeringEvents":[]}${markerTags.close}`,
    'Do not include markdown code fences around the marker.',
    'Never include more than 32 KB of JSON in the marker.',
    'Use only the allowed point keys listed above. Do not invent new point keys.',
    'For each covered point, include 1-3 factBullets that are short, complete, point-specific drafting facts. Keep keywords as compact tags only; they cannot replace factBullets. Use ruleNotes for reviewer or guideline caveats.',
  ].join('\n');
}
