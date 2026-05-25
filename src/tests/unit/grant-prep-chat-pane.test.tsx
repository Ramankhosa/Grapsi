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
});
