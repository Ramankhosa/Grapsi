import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('@/lib/metering', () => ({
  llmGateway: { executeLLMOperation: mocks.execute },
}));

vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }));

import { runFundingGatewayText, FUNDING_CHAT_TASK_CODE } from '@/lib/funding/llmRouting';

describe('runFundingGatewayText streaming passthrough', () => {
  beforeEach(() => {
    mocks.execute.mockReset();
  });

  it('forwards stream.onToken to the metering gateway and relays deltas', async () => {
    mocks.execute.mockImplementation(async (_ctx: unknown, request: any) => {
      if (request.stream?.onToken) {
        await request.stream.onToken({ delta: 'Hel', output: 'Hel' });
        await request.stream.onToken({ delta: 'lo', output: 'Hello' });
      }
      return { success: true, response: { output: 'Hello', modelClass: 'flash', metadata: {} } };
    });

    const received: Array<[string, string]> = [];
    const result = await runFundingGatewayText({
      taskCode: FUNDING_CHAT_TASK_CODE,
      stageCode: 'FUNDING_CHAT_NARRATIVE',
      prompt: 'say hello',
      context: { planId: 'plan-1' },
      stream: { onToken: (delta, output) => void received.push([delta, output]) },
    });

    expect(received).toEqual([
      ['Hel', 'Hel'],
      ['lo', 'Hello'],
    ]);
    expect(result?.rawText).toBe('Hello');
    const gatewayRequest = mocks.execute.mock.calls[0][1];
    expect(typeof gatewayRequest.stream?.onToken).toBe('function');
  });

  it('omits the stream option from the gateway request when not provided', async () => {
    mocks.execute.mockResolvedValue({ success: true, response: { output: 'ok', modelClass: 'flash', metadata: {} } });

    const result = await runFundingGatewayText({
      taskCode: FUNDING_CHAT_TASK_CODE,
      stageCode: 'FUNDING_CHAT_NARRATIVE',
      prompt: 'no stream',
      context: { planId: 'plan-1' },
    });

    expect(result?.rawText).toBe('ok');
    const gatewayRequest = mocks.execute.mock.calls[0][1];
    expect('stream' in gatewayRequest).toBe(false);
  });
});
