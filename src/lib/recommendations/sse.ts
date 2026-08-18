/**
 * Server-Sent-Events response helper for the finder chat stream route.
 * Mirrors the drafting route's SSE pattern (incl. `X-Accel-Buffering: no` so nginx
 * does not buffer), plus a keepalive comment heartbeat for long generations.
 *
 * Disconnect handling: when the client goes away the ReadableStream is cancelled
 * (and, where the runtime supports it, `request.signal` fires). Both abort the
 * signal handed to the stream handler so the turn can skip the remaining LLM
 * calls instead of finishing paid work nobody will read.
 */

const HEARTBEAT_INTERVAL_MS = 15000;

export type SSESend = (event: string, payload: unknown) => void;

export function createRecommendationSSEResponse(
  streamHandler: (send: SSESend, signal: AbortSignal) => Promise<void>,
  options: { signal?: AbortSignal | null } = {}
): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const requestSignal = options.signal ?? null;
  const onRequestAbort = () => abort.abort();
  if (requestSignal) {
    if (requestSignal.aborted) abort.abort();
    else requestSignal.addEventListener('abort', onRequestAbort, { once: true });
  }

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const enqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send: SSESend = (event, payload) => {
        enqueue(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      };

      const heartbeat = setInterval(() => enqueue(': keepalive\n\n'), HEARTBEAT_INTERVAL_MS);

      try {
        await streamHandler(send, abort.signal);
        send('done', { ok: true });
      } catch (error) {
        // Never surface the raw error message: it may carry DB or provider internals.
        console.error('[recommendations] SSE stream handler failed:', error);
        send('error', {
          type: 'error',
          error: 'Failed to process recommendation message',
          code: 'INTERNAL',
          persisted: false,
        });
        send('done', { ok: false });
      } finally {
        clearInterval(heartbeat);
        requestSignal?.removeEventListener('abort', onRequestAbort);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Already closed by a cancel; nothing to do.
          }
        }
      }
    },
    cancel() {
      // Consumer went away (tab closed, navigation, network drop).
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
