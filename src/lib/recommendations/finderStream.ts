import type { FinderTurnStreamEvent, RecommendationConversationMessageRequest, RecommendationConversationMutationResponse } from './chatTypes';

export type FinderStreamOutcome =
  | { status: 'final'; response: RecommendationConversationMutationResponse }
  | { status: 'error'; error: string; code?: string; retryAfterMs?: number | null; persisted: boolean }
  | { status: 'unsupported' }
  | { status: 'connection_lost'; persisted: boolean };

interface StreamHandlers {
  onEvent?: (event: FinderTurnStreamEvent) => void;
}

function parseSSEFrame(frame: string): { event: string; data: string } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue; // heartbeat/comment
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

/**
 * POST a chat message to the SSE streaming route and surface events as they arrive.
 *
 * Fallback contract for the caller:
 * - `unsupported` (non-SSE response / no body / failed before ANY event): nothing was
 *   persisted server-side — safe to retry via the classic POST route.
 * - `connection_lost` / `error` with `persisted: true`: the user turn may already be
 *   stored — do NOT re-POST; re-fetch the conversation instead.
 * - `final`: authoritative response, identical to the classic route's JSON.
 */
export async function streamConversationMessage(
  authFetch: (url: string, options?: RequestInit) => Promise<Response>,
  conversationId: string,
  payload: RecommendationConversationMessageRequest,
  handlers: StreamHandlers = {}
): Promise<FinderStreamOutcome> {
  let response: Response;
  try {
    response = await authFetch(`/api/recommendations/conversations/${conversationId}/messages/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(payload),
    });
  } catch {
    return { status: 'unsupported' };
  }

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.includes('text/event-stream') || !response.body) {
    if (response.status === 429) {
      const body = await response.json().catch(() => ({} as Record<string, unknown>));
      return {
        status: 'error',
        error: typeof body.error === 'string' ? body.error : 'Too many requests. Please wait and try again.',
        code: typeof body.code === 'string' ? body.code : 'RATE_LIMITED',
        retryAfterMs: null,
        persisted: false,
      };
    }
    return { status: 'unsupported' };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const state: {
    sawAnyEvent: boolean;
    turnPersisted: boolean;
    finalResponse: RecommendationConversationMutationResponse | null;
    streamError: { error: string; code?: string; retryAfterMs?: number | null; persisted: boolean } | null;
  } = {
    sawAnyEvent: false,
    turnPersisted: false,
    finalResponse: null,
    streamError: null,
  };

  const handleFrame = (frame: string) => {
    const parsed = parseSSEFrame(frame);
    if (!parsed) return;
    state.sawAnyEvent = true;

    let data: unknown;
    try {
      data = JSON.parse(parsed.data);
    } catch {
      return;
    }

    if (parsed.event === 'done') return;

    const event = data as FinderTurnStreamEvent;
    if (event.type === 'turn') state.turnPersisted = true;
    if (event.type === 'final') {
      state.finalResponse = event.response;
    } else if (event.type === 'error') {
      state.streamError = {
        error: event.error,
        code: event.code,
        retryAfterMs: event.retryAfterMs ?? null,
        persisted: event.persisted || state.turnPersisted,
      };
    }
    handlers.onEvent?.(event);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        handleFrame(frame.replace(/\r/g, ''));
        boundary = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) handleFrame(buffer.replace(/\r/g, ''));
  } catch {
    if (!state.sawAnyEvent) return { status: 'unsupported' };
    if (state.finalResponse) return { status: 'final', response: state.finalResponse };
    return { status: 'connection_lost', persisted: state.turnPersisted };
  }

  if (state.finalResponse) return { status: 'final', response: state.finalResponse };
  if (state.streamError) return { status: 'error', ...state.streamError };
  if (!state.sawAnyEvent) return { status: 'unsupported' };
  return { status: 'connection_lost', persisted: state.turnPersisted };
}

export const __finderStreamTestables = { parseSSEFrame };
