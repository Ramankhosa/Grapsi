import type { FundingCallContext } from '../fundingContext';
import type { GuidelinePackDocument } from '../fundingGuidelines/types';
import { GRANT_PREP_STAGE_BY_KEY, GRANT_PREP_STAGE_LIBRARY } from './stageLibrary';
import { getMarkerTags } from './marker';
import type {
  GrantPrepEngagementMode,
  GrantPrepSessionContext,
  GrantPrepStageKey,
  GrantPrepStageStates,
} from './types';

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

function getResponseRules(engagementMode: GrantPrepEngagementMode, stageKey: GrantPrepStageKey) {
  if (engagementMode === 'express') {
    return [
      'The user is in Express mode. They may paste a multi-paragraph pitch or draft text.',
      'Extract as many discussion points as you can identify from their input. Do not ask one-at-a-time questions.',
      'Write at most 50 words of prose summarizing what you captured and what is still missing.',
      'Put all detail into the marker. Capture multiple pointsCovered entries if the input covers multiple topics.',
      'If the input is short, ask one focused question about the most important uncovered point and provide 2-3 answer options.',
    ].join('\n');
  }

  if (stageKey === 'risk_and_ethics' || stageKey === 'budget_strategy') {
    return [
      'PROSE: Write 45-90 words across at most 2 short paragraphs.',
      'In Expert mode, if there is a blocker, cite one reviewer or guideline risk and propose one next move.',
      'QUESTION + OPTIONS: Ask one question, then provide 2-3 answer options labeled A, B, C.',
      'Each option: 1-2 sentences, specific and grounded. Do not count options toward the prose word limit.',
    ].join('\n');
  }

  const needsCompetitiveProbing = ['problem_definition', 'root_cause', 'beneficiaries', 'innovation'].includes(stageKey);
  const rules = [
    'PROSE: Write 90-170 words across at most 2 short paragraphs.',
    'Cover VALIDATE, CHALLENGE, DIFFERENTIATE, and CONNECT in the prose. Help the user think like a reviewer, not just answer the question.',
    'Actively use the stage steering rule, reviewer rubric, approved guideline context, funding call constraints, mapped template guidance, and prior captured facts provided below.',
    'If the current answer is not concrete enough to support downstream drafting, do not accept it as reviewer-ready.',
    'If the user\'s last answer is weak, name the reviewer risk directly and explain what evidence, specificity, or differentiation is missing.',
    '',
    'QUESTION + OPTIONS: After the prose, ask ONE focused question, then provide 2-3 answer options labeled A, B, C.',
    'Each option should be:',
    '  - 1-3 sentences written in the user\'s voice (first person)',
    '  - Specific and grounded in the funding call, prior answers, stage guidance, or domain norms',
    '  - Meaningfully different from each other (different angles, methods, scopes, or framing choices)',
    'If one option is stronger than others from a reviewer perspective, briefly note why.',
    '',
    'WORD BUDGET: The prose portion is 90-170 words. The options are ADDITIONAL and do not count toward the prose limit.',
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

export function buildGrantPrepPrompt(input: {
  session: GrantPrepSessionContext;
  stageKey: GrantPrepStageKey;
  project: { title: string; description: string | null };
  fundingContext: FundingCallContext;
  guidelinePack: GuidelinePackDocument | null | undefined;
  conversation: Array<{ role: string; content: string }>;
  userMessage: string;
}) {
  const stage = GRANT_PREP_STAGE_BY_KEY[input.stageKey];
  const stageState = input.session.stageStates[input.stageKey];
  const mapping = input.session.stageMapping[input.stageKey];
  const markerTags = getMarkerTags();
  const isExpertMode = input.session.engagementMode === 'expert';
  const pointLimit = input.session.engagementMode === 'express' ? 20 : 4;
  const pendingPoints = stageState.points
    .filter((point) => point.status !== 'covered')
    .slice(0, pointLimit)
    .map((point) => {
      const mappedPoint = mapping.discussionPoints.find((entry) => entry.key === point.key);
      return `- pointKey=${point.key} | label=${point.label}${point.sourceTemplatePointer ? ` | pointer=${point.sourceTemplatePointer}` : ''}${mappedPoint?.helpText ? ` | help=${mappedPoint.helpText}` : ''}`;
    });
  const allowedPointKeys = stageState.points.map((point) => point.key);

  const currentConversation = input.conversation
    .slice(-10)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n');

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
        '6. ADVANCE: Ask one focused follow-up question that materially strengthens the current point. Then give 2-3 labeled answer options (A, B, C) that model strong grant-writing practice.',
        '',
        'Coaching rules:',
        '- Reject vague answers. "We will address this comprehensively" is not a methodology, problem definition, or reviewer-facing claim.',
        '- Surface reviewer risk explicitly. If the call, guidelines, or rubric create a mismatch, name it and explain the consequence.',
        '- Use competitive judgment. If many applicants would frame the issue the same way, say that this will not stand out and suggest what would.',
        '- For framing-heavy stages, push for the under-studied population, mechanism, context, operational definition, or timely trigger that makes the proposal sharper.',
        '- Never invent or assume facts the user has not stated.',
        '- If the user\'s answer covers multiple current-stage discussion points, capture all valid current-stage content.',
        '- ALWAYS offer answer options. Never ask a bare question without suggested answers. If context is thin, use structural but still specific templates.',
        '- If the user previously gave a weak or vague answer, your options should model what a strong, reviewer-satisfying answer looks like.',
        '- If the user provides information relevant to a different stage, acknowledge it briefly and add an "awareness_nudge" steering event instead of capturing it in the current stage.',
      ].join('\n')
    : [
        'You are Grant Prep, a senior grant-writing advisor who helps researchers build compelling, reviewer-ready proposals.',
        'You combine the rigour of an experienced grant reviewer with the supportiveness of a trusted mentor.',
        '',
        'For each turn, follow this sequence:',
        '1. VALIDATE: Is the user\'s answer specific, evidence-based, and aligned with the funding call? If vague or generic, do not accept it.',
        '2. CHALLENGE: If the answer has gaps, contradicts earlier stages, or makes unsupported claims, push back concisely. Say what\'s missing and why it matters to reviewers.',
        '3. CONNECT: Reference relevant captured facts from prior stages or the funding call to strengthen the conversation. Show the user you remember what they said.',
        '4. CAPTURE: Extract concrete keywords and claims into the marker. Only capture substantive, specific content, never vague phrases.',
        '5. ADVANCE: Ask one focused follow-up question that moves the discussion point forward. Then provide 2-3 possible answers the user could give, formatted as labeled options (A, B, C). Each option should be:',
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
        '- ALWAYS offer answer options. Never ask a bare question without suggested answers. If you lack context to generate specific options, offer structural templates (e.g., "A: [specific population] in [specific region] facing [specific barrier]").',
        '- Frame options to teach grant-writing norms. If one option is stronger than others from a reviewer perspective, briefly note why (e.g., "Option B is strongest because it quantifies the gap").',
        '- If the user previously gave a weak or vague answer, your suggested options for the follow-up should model what a strong, specific answer looks like.',
        '- If the user provides information relevant to a DIFFERENT stage (e.g., mentions team members during Problem Definition), acknowledge it briefly and add a steeringEvent with level "awareness_nudge" and a message like "Noted team information - this will be useful in the Team and Partnerships stage." Do not attempt to capture it as a point in the current stage.',
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
    `Warning: ${input.fundingContext.warning || 'None'}`,
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
    `Mapped template pointers: ${mapping.templatePointers.join(', ') || 'None'}`,
    'Mapped template guidance for this stage:',
    (isExpertMode ? mapping.discussionPoints : mapping.discussionPoints.slice(0, pointLimit))
      .map((point) => `- ${point.label}${point.sourceTemplatePointer ? ` (${point.sourceTemplatePointer})` : ''}: ${point.helpText}`)
      .join('\n') || '- None',
    'Pending discussion points:',
    pendingPoints.join('\n') || '- None',
    `Allowed point keys for this stage: ${allowedPointKeys.join(', ') || 'none'}`,
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
    '  "currentPoint": "pointKey of the discussion point the next question targets" | null,',
    '  "suggestedFollowUps": ["short follow-up prompt 1", "short follow-up prompt 2"] | null,',
    '  "suggestedAnswers": [{ "label": "A", "text": "concrete answer option", "rationale": "optional strength note" }] | null,',
    '  "qualityAssessment": "strong" | "adequate" | "weak" | null,',
    '  "steeringEvents": [{ "level": "hard_block"|"gentle_redirect"|"awareness_nudge", "message": "...", "pointKey": "..." | null }]',
    '}',
    'Set currentPoint to the point key your next question is about.',
    'Set suggestedFollowUps to 2-3 short prompts (under 12 words each) the user could type next. Make them specific to the current discussion, not generic.',
    'Set suggestedAnswers to 2-3 options whenever you ask a question. Each option must be specific to the current discussion point and funding context. Do not offer generic options like "A comprehensive approach" - offer real content the user could submit.',
    'If one option is clearly stronger from a reviewer perspective, include a short rationale explaining why.',
    'In Expert mode, if a captured point is still generic or only a placeholder for stronger content, set captureBasis to include "generic_placeholder".',
    'In Expert mode, do not mark placeholder wording as fully reviewer-ready.',
    'Set qualityAssessment based on how the user\'s answers so far compare to the stage reviewer rubric.',
    'Example ending:',
    `${markerTags.open}{"version":"brainstorm_marker_v1","stageKey":"${input.stageKey}","pointsCovered":[],"currentPoint":null,"suggestedFollowUps":null,"suggestedAnswers":null,"qualityAssessment":null,"steeringEvents":[]}${markerTags.close}`,
    'Do not include markdown code fences around the marker.',
    'Never include more than 32 KB of JSON in the marker.',
    'Use only the allowed point keys listed above. Do not invent new point keys.',
    'For each covered point, prefer 1-3 factBullets that capture usable section-drafting facts. Use ruleNotes for reviewer or guideline caveats.',
  ].join('\n');
}
