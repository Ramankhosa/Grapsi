import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import GrantPrepChatPane from '@/components/grantPrep/GrantPrepChatPane';
import type { PrepMessage } from '@/components/grantPrep/types';

describe('grant prep chat pane', () => {
  it('shows publication-grounded ideation start card when context is missing', () => {
    const markup = renderToStaticMarkup(
      <GrantPrepChatPane
        messages={[]}
        sending={false}
        input=""
        onInputChange={() => undefined}
        onSend={() => undefined}
        sessionLocked={false}
        activeStageKey="ideation"
        ideationContext={{
          hasUsableContext: false,
          sourceSummary: [],
          profile: null,
          savedResearchAreas: [],
          publications: [],
        }}
      />
    );

    expect(markup).toContain('Start with agency-aligned ideas');
    expect(markup).toContain('Recommend grant ideas');
    expect(markup).toContain('Brainstorm from the call only');
    expect(markup).toContain('I have finalized the idea already');
    expect(markup).toContain('Recommend from these papers');
    expect(markup).toContain('up to five publication titles');
  });

  it('offers direct recommendations when ideation context exists', () => {
    const markup = renderToStaticMarkup(
      <GrantPrepChatPane
        messages={[]}
        sending={false}
        input=""
        onInputChange={() => undefined}
        onSend={() => undefined}
        sessionLocked={false}
        activeStageKey="ideation"
        ideationContext={{
          hasUsableContext: true,
          sourceSummary: ['profile research areas', 'tagged publications'],
          profile: null,
          savedResearchAreas: [],
          publications: [],
        }}
      />
    );

    expect(markup).toContain('Recommend grant ideas');
    expect(markup).toContain('Brainstorm from the call only');
    expect(markup).toContain('I have finalized the idea already');
    expect(markup).toContain('profile research areas, tagged publications');
    expect(markup).not.toContain('Recommend from these papers');
  });

  it('shows ideation start card even when other stages already have messages', () => {
    const messages: PrepMessage[] = [
      {
        id: 'problem-message-1',
        role: 'assistant',
        stage_key: 'problem_definition',
        content: 'Let us define the problem.',
      },
    ];

    const markup = renderToStaticMarkup(
      <GrantPrepChatPane
        messages={messages}
        sending={false}
        input=""
        onInputChange={() => undefined}
        onSend={() => undefined}
        sessionLocked={false}
        activeStageKey="ideation"
        ideationContext={{
          hasUsableContext: false,
          sourceSummary: [],
          profile: null,
          savedResearchAreas: [],
          publications: [],
        }}
      />
    );

    expect(markup).toContain('Start with agency-aligned ideas');
    expect(markup).toContain('Recommend grant ideas');
    expect(markup).toContain('Brainstorm from the call only');
    expect(markup).toContain('I have finalized the idea already');
    expect(markup).not.toContain('Let us define the problem.');
  });

  it('shows ideation start card when only a non-actionable ideation assistant message exists', () => {
    const messages: PrepMessage[] = [
      {
        id: 'assistant-ideation-welcome',
        role: 'assistant',
        stage_key: 'ideation',
        content: 'Share the idea you are considering.',
      },
    ];

    const markup = renderToStaticMarkup(
      <GrantPrepChatPane
        messages={messages}
        sending={false}
        input=""
        onInputChange={() => undefined}
        onSend={() => undefined}
        sessionLocked={false}
        activeStageKey="ideation"
        ideationContext={{
          hasUsableContext: false,
          sourceSummary: [],
          profile: null,
          savedResearchAreas: [],
          publications: [],
        }}
      />
    );

    expect(markup).toContain('Start with agency-aligned ideas');
    expect(markup).toContain('Recommend grant ideas');
    expect(markup).toContain('Brainstorm from the call only');
    expect(markup).toContain('I have finalized the idea already');
    expect(markup).not.toContain('Share the idea you are considering.');
  });

  it('renders inline option C when structured answers only include A and B', () => {
    const repeatedPrefix = `I approve this ${'bundle'}:`;
    const messages: PrepMessage[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [
          'Which implementation bundle should I use?',
          '',
          `A. ${repeatedPrefix} Use the community clinic delivery model.`,
          'B. Use the mobile outreach delivery model.',
          'C. Use a hybrid model with clinic anchors and scheduled outreach camps.',
        ].join('\n'),
        suggested_answers: [
          { label: 'A', text: `${repeatedPrefix} Use the community clinic delivery model.`, rationale: null },
          { label: 'B', text: 'Use the mobile outreach delivery model.', rationale: null },
        ],
      },
    ];

    const markup = renderToStaticMarkup(
      <GrantPrepChatPane
        messages={messages}
        sending={false}
        input=""
        onInputChange={() => undefined}
        onSend={() => undefined}
        sessionLocked={false}
      />
    );

    expect(markup).toContain('Use a hybrid model with clinic anchors and scheduled outreach camps.');
    expect(markup).not.toContain(repeatedPrefix);
    expect(markup).toContain('Approval bundles');
  });

  it('renders compact combination selectors without repeating full option text', () => {
    const longTail =
      'This sentence should remain visible in the tile because reviewers need the full operational detail, not a shortened preview.';
    const messages: PrepMessage[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [
          'Which bundle should I use?',
          '',
          'A. Anchor delivery through district clinics with named coordinators and referral loops.',
          'B. Add mobile outreach camps for remote blocks with a monthly service cadence.',
          `C. Pair clinics and outreach with a shared monitoring dashboard. ${longTail}`,
        ].join('\n'),
        suggested_answers: [
          {
            label: 'A',
            text: 'Anchor delivery through district clinics with named coordinators and referral loops.',
            rationale: null,
            covers: [
              { stageKey: 'methodology', pointKey: 'delivery_model', label: 'Delivery model' },
              { stageKey: 'workplan', pointKey: 'timeline', label: 'Timeline' },
              { stageKey: 'team_and_partnerships', pointKey: 'partners', label: 'Partners' },
              { stageKey: 'evaluation', pointKey: 'monitoring', label: 'Monitoring' },
              { stageKey: 'outcomes', pointKey: 'impact', label: 'Impact' },
            ],
          },
          {
            label: 'B',
            text: 'Add mobile outreach camps for remote blocks with a monthly service cadence.',
            rationale: null,
          },
          {
            label: 'C',
            text: `Pair clinics and outreach with a shared monitoring dashboard. ${longTail}`,
            rationale: null,
          },
        ],
      },
    ];

    const markup = renderToStaticMarkup(
      <GrantPrepChatPane
        messages={messages}
        sending={false}
        input=""
        onInputChange={() => undefined}
        onSend={() => undefined}
        sessionLocked={false}
      />
    );

    expect(markup).toContain('A+B');
    expect(markup).toContain('A+C');
    expect(markup).toContain('B+C');
    expect(markup).toContain('All Three');
    expect(markup).toContain(longTail);
    expect(markup).toContain('Impact');
    expect(markup).not.toContain('All options');
    expect(markup).not.toContain('A. Anchor delivery through district clinics');
    expect(markup).not.toContain('B. Add mobile outreach camps');
    expect(markup).not.toContain('C. Pair clinics and outreach');
  });

  it('renders full ideation direction content while the user is selecting a direction', () => {
    const messages: PrepMessage[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [
          'Here are three exploratory directions to refine the strategic angle:',
          'Direction A: The "Privacy-First" Angle. Focus the project on edge computing, where the AI processes environmental data locally on the smartphone without uploading audio or sensitive data to the cloud.',
          'Direction B: The "Precision Health" Angle. Focus the 12-month project on building personal sensory profiles for each individual.',
          'Direction C: The "Caregiver Dashboard" Angle. Focus on visualizing correlated data for clinicians, parents, and caregivers.',
        ].join('\n'),
        suggested_answers: [
          { label: 'A', text: 'Short marker privacy direction.', rationale: 'Increases ethical appeal.' },
          { label: 'B', text: 'Short marker precision direction.', rationale: 'Enhances clinical value.' },
          { label: 'C', text: 'Short marker caregiver direction.', rationale: 'Improves support utility.' },
        ],
      },
    ];

    const markup = renderToStaticMarkup(
      <GrantPrepChatPane
        messages={messages}
        sending={false}
        input=""
        onInputChange={() => undefined}
        onSend={() => undefined}
        sessionLocked={false}
        activeStageKey="ideation"
      />
    );

    expect(markup).toContain('Idea directions');
    expect(markup).toContain('processes environmental data locally');
    expect(markup).toContain('building personal sensory profiles');
    expect(markup).not.toContain('Short marker privacy direction');
  });

  it('hides previous ideation options and shows the problem transition starter after moving stages', () => {
    const messages: PrepMessage[] = [
      {
        id: 'assistant-ideation',
        role: 'assistant',
        stage_key: 'ideation',
        content: [
          'Here are three exploratory directions:',
          'A. Focus the proposal on a rural clinic adherence dashboard.',
          'B. Focus the proposal on a community health worker triage tool.',
          'C. Focus the proposal on a low-cost adherence prediction pilot.',
        ].join('\n'),
        suggested_answers: [
          { label: 'A', text: 'Rural clinic adherence dashboard.', rationale: null },
          { label: 'B', text: 'Community health worker triage tool.', rationale: null },
          { label: 'C', text: 'Low-cost adherence prediction pilot.', rationale: null },
        ],
      },
    ];

    const markup = renderToStaticMarkup(
      <GrantPrepChatPane
        messages={messages}
        sending={false}
        input=""
        onInputChange={() => undefined}
        onSend={() => undefined}
        sessionLocked={false}
        activeStageKey="problem_definition"
        activeStageTitle="Problem Definition"
        pendingPoints={[
          { key: 'problem_core', label: 'Core problem statement' },
          { key: 'problem_scale', label: 'Scale and urgency' },
          { key: 'evidence_gap', label: 'Evidence or practice gap' },
        ]}
        stageTransitionContext={{
          ideaSummary: 'Rural clinic adherence dashboard for missed follow-up risk.',
          problemReady: false,
        }}
        onLockIdeation={() => undefined}
      />
    );

    expect(markup).toContain('Now let&#x27;s work on the problem specifics');
    expect(markup).toContain('answer the items below in one message');
    expect(markup).toContain('Direction:');
    expect(markup).toContain('What to answer next');
    expect(markup).toContain('Core problem statement');
    expect(markup).toContain('Scale and urgency');
    expect(markup).toContain('Evidence or practice gap');
    expect(markup).toContain('Answer these in text box');
    expect(markup).toContain('Let AI suggest answers');
    expect(markup).not.toContain('Focus the proposal on a rural clinic adherence dashboard');
    expect(markup).not.toContain('Idea directions');
    expect(markup).not.toContain('Approval bundles');
    expect(markup).not.toContain('Explore this direction');
    expect(markup).not.toContain('Approve and send');
    expect(markup).not.toContain('Lock it in');
  });

  it('connects the next stage to the selected idea and fixed problem before normal flow resumes', () => {
    const messages: PrepMessage[] = [
      {
        id: 'assistant-ideation',
        role: 'assistant',
        stage_key: 'ideation',
        content: 'The rural clinic adherence dashboard is the selected direction.',
      },
      {
        id: 'assistant-problem',
        role: 'assistant',
        stage_key: 'problem_definition',
        content: 'The problem definition is now concrete enough to continue.',
      },
    ];

    const markup = renderToStaticMarkup(
      <GrantPrepChatPane
        messages={messages}
        sending={false}
        input=""
        onInputChange={() => undefined}
        onSend={() => undefined}
        sessionLocked={false}
        activeStageKey="root_cause"
        activeStageTitle="Root Cause"
        pendingPoints={[
          { key: 'root_drivers', label: 'Underlying drivers', helpText: 'The main drivers behind this problem are...' },
          { key: 'current_failure', label: 'Why current approaches fall short' },
        ]}
        stageTransitionContext={{
          ideaSummary: 'Rural clinic adherence dashboard for missed follow-up risk.',
          problemSummary: 'Rural clinics lose high-risk diabetes patients between follow-up visits.',
          problemReady: true,
        }}
      />
    );

    expect(markup).toContain('Next, connect this to Root Cause');
    expect(markup).toContain('Answer the items below for Root Cause in one message');
    expect(markup).toContain('Direction:');
    expect(markup).toContain('Problem:');
    expect(markup).toContain('What to answer next');
    expect(markup).toContain('Underlying drivers');
    expect(markup).toContain('Why current approaches fall short');
    expect(markup).toContain('Answer these in text box');
    expect(markup).toContain('Let AI suggest answers');
  });

  it('does not show a stage transition starter when there are no user-facing points to answer', () => {
    const messages: PrepMessage[] = [
      {
        id: 'assistant-ideation',
        role: 'assistant',
        stage_key: 'ideation',
        content: 'The rural clinic adherence dashboard is the selected direction.',
      },
      {
        id: 'assistant-problem',
        role: 'assistant',
        stage_key: 'problem_definition',
        content: 'The problem definition is now concrete enough to continue.',
      },
    ];

    const markup = renderToStaticMarkup(
      <GrantPrepChatPane
        messages={messages}
        sending={false}
        input=""
        onInputChange={() => undefined}
        onSend={() => undefined}
        sessionLocked={false}
        activeStageKey="root_cause"
        activeStageTitle="Root Cause"
        pendingPoints={[]}
        stageTransitionContext={{
          ideaSummary: 'Rural clinic adherence dashboard for missed follow-up risk.',
          problemSummary: 'Rural clinics lose high-risk diabetes patients between follow-up visits.',
          problemReady: true,
        }}
      />
    );

    expect(markup).not.toContain('Next, connect this to Root Cause');
    expect(markup).not.toContain('What to answer next');
    expect(markup).not.toContain('Let AI suggest answers');
  });
});
