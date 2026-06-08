import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import GrantPrepChatPane from '@/components/grantPrep/GrantPrepChatPane';
import type { PrepMessage } from '@/components/grantPrep/types';

describe('grant prep chat pane', () => {
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
});
