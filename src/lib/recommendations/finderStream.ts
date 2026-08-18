import type { FinderTurnStreamEvent, RecommendationConversationMessageRequest, RecommendationConversationMutationResponse } from './chatTypes';

export type FinderStreamOutcome =
  | { status: 'final'; response: RecommendationConversationMutationResponse }
  | { status: 'error'; error: string; code?: string; retryAfterMs?: number | null; persisted: boolean }
  | { status: 'unsupported' }
  | { status: 'connection_lost'; persisted: boolean }
  | { status: 'aborted'; persisted: boolean };

interface StreamHandlers {
  onEvent?: (event: FinderTurnStreamEvent) => void;
  /** Abort the in-flight request (conversation switch, unmount). */
  signal?: AbortSignal;
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

/** Statuses that mean "this deployment has no streaming route", not "your request was rejected". */
const ROUTE_UNAVAILABLE_STATUSES = new Set([404, 405, 501]);

/**
 * POST a chat message to the SSE streaming route and surface events as they arrive.
 *
 * Fallback contract for the caller:
 * - `unsupported` (streaming route missing / non-SSE 2xx / no body / network failure
 *   before ANY event): nothing was persisted server-side — safe to retry via the
 *   classic POST route.
 * - `error` (any non-2xx JSON rejection: 400/403/429/quota, or an `error` event):
 *   do NOT re-POST — the classic route would give the same answer and burn another
 *   rate-limit slot. `persisted` says whether the user turn already landed.
 * - `connection_lost` / `error` with `persisted: true`: re-fetch the conversation.
 * - `aborted`: the caller cancelled (conversation switch); ignore silently.
 * - `final`: authoritative response, identical to the classic route's JSON.
 */
export async function streamConversationMessage(
  authFetch: (url: string, options?: RequestInit) => Promise<Response>,
  conversationId: string,
  payload: RecommendationConversationMessageRequest,
  handlers: StreamHandlers = {}
): Promise<FinderStreamOutcome> {
  const signal = handlers.signal;
  const abortedOutcome = (persisted: boolean): FinderStreamOutcome => ({ status: 'aborted', persisted });
  if (signal?.aborted) return abortedOutcome(false);

  let response: Response;
  try {
    response = await authFetch(`/api/recommendations/conversations/${conversationId}/messages/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(payload),
      ...(signal ? { signal } : {}),
    });
  } catch {
    if (signal?.aborted) return abortedOutcome(false);
    return { status: 'unsupported' };
  }

  if (!response.ok) {
    if (ROUTE_UNAVAILABLE_STATUSES.has(response.status)) {
      return { status: 'unsupported' };
    }
    const body = await response.json().catch(() => ({} as Record<string, unknown>));
    const retryAfterMs =
      typeof body.retryAfterMs === 'number'
        ? body.retryAfterMs
        : body.resetAt && typeof body.resetAt === 'string'
          ? Math.max(0, new Date(body.resetAt).getTime() - Date.now())
          : null;
    return {
      status: 'error',
      error:
        typeof body.error === 'string'
          ? body.error
          : response.status === 429
            ? 'Too many requests. Please wait and try again.'
            : `Request failed (${response.status}).`,
      code: typeof body.code === 'string' ? body.code : response.status === 429 ? 'RATE_LIMITED' : `HTTP_${response.status}`,
      retryAfterMs,
      persisted: false,
    };
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream') || !response.body) {
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
    if (signal?.aborted) return abortedOutcome(state.turnPersisted);
    if (!state.sawAnyEvent) return { status: 'unsupported' };
    if (state.finalResponse) return { status: 'final', response: state.finalResponse };
    return { status: 'connection_lost', persisted: state.turnPersisted };
  }

  if (state.finalResponse) return { status: 'final', response: state.finalResponse };
  if (state.streamError) return { status: 'error', ...state.streamError };
  if (signal?.aborted) return abortedOutcome(state.turnPersisted);
  if (!state.sawAnyEvent) return { status: 'unsupported' };
  return { status: 'connection_lost', persisted: state.turnPersisted };
}

export const __finderStreamTestables = { parseSSEFrame };
