import { describe, expect, it, vi } from 'vitest';

import { streamConversationMessage } from '@/lib/recommendations/finderStream';

/**
 * Client contract for `streamConversationMessage`: which HTTP outcomes may fall
 * back to the classic POST (`unsupported`) versus which are final rejections
 * (`error`), plus caller-driven abort.
 */

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function sseResponse(frames: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const payload = { message: 'hello', clientTurnId: 'c-1' };

describe('streamConversationMessage', () => {
  it('treats a JSON rejection (403/400/429/quota) as a final error, not as "streaming unsupported"', async () => {
    const forbidden = await streamConversationMessage(
      async () => jsonResponse(403, { error: 'Upgrade required', code: 'FEATURE_NOT_AVAILABLE' }),
      'conv-1',
      payload
    );
    expect(forbidden).toEqual({
      status: 'error',
      error: 'Upgrade required',
      code: 'FEATURE_NOT_AVAILABLE',
      retryAfterMs: null,
      persisted: false,
    });

    const quota = await streamConversationMessage(
      async () => jsonResponse(429, { error: 'Out of quota', code: 'QUOTA_EXCEEDED' }),
      'conv-1',
      payload
    );
    expect(quota.status).toBe('error');
    expect((quota as { code?: string }).code).toBe('QUOTA_EXCEEDED');
  });

  it('only falls back to the classic route when the streaming route itself is missing', async () => {
    const missing = await streamConversationMessage(async () => new Response('', { status: 404 }), 'conv-1', payload);
    expect(missing).toEqual({ status: 'unsupported' });

    const notSse = await streamConversationMessage(
      async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      'conv-1',
      payload
    );
    expect(notSse).toEqual({ status: 'unsupported' });
  });

  it('forwards the abort signal to fetch and reports a caller abort as "aborted"', async () => {
    const controller = new AbortController();
    const authFetch = vi.fn(async (_url: string, options?: RequestInit) => {
      expect(options?.signal).toBe(controller.signal);
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    const outcome = await streamConversationMessage(authFetch, 'conv-1', payload, { signal: controller.signal });
    expect(outcome).toEqual({ status: 'aborted', persisted: false });
    expect(authFetch).toHaveBeenCalledTimes(1);

    const preAborted = new AbortController();
    preAborted.abort();
    const skipped = await streamConversationMessage(authFetch, 'conv-1', payload, { signal: preAborted.signal });
    expect(skipped).toEqual({ status: 'aborted', persisted: false });
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it('returns the final response and surfaces intermediate events', async () => {
    const events: string[] = [];
    const final = { conversation: { id: 'conv-1' }, stale: false, clientTurnId: 'c-1' };
    const outcome = await streamConversationMessage(
      async () =>
        sseResponse([
          `event: turn\ndata: ${JSON.stringify({ type: 'turn', turnIndex: 1, clientTurnId: 'c-1' })}\n\n`,
          `event: token\ndata: ${JSON.stringify({ type: 'token', delta: 'Hi' })}\n\n`,
          `event: final\ndata: ${JSON.stringify({ type: 'final', response: final })}\n\n`,
          `event: done\ndata: {"ok":true}\n\n`,
        ]),
      'conv-1',
      payload,
      { onEvent: (event) => events.push(event.type) }
    );
    expect(outcome).toEqual({ status: 'final', response: final });
    expect(events).toEqual(['turn', 'token', 'final']);
  });

  it('marks a quota error event as not persisted when no turn event preceded it', async () => {
    const outcome = await streamConversationMessage(
      async () =>
        sseResponse([
          `event: error\ndata: ${JSON.stringify({ type: 'error', error: 'Out of quota', code: 'QUOTA_EXCEEDED', persisted: false })}\n\n`,
          `event: done\ndata: {"ok":true}\n\n`,
        ]),
      'conv-1',
      payload
    );
    expect(outcome).toMatchObject({ status: 'error', code: 'QUOTA_EXCEEDED', persisted: false });
  });
});
