/**
 * Server-Sent-Events response helper for the finder chat stream route.
 * Mirrors the drafting route's SSE pattern (incl. `X-Accel-Buffering: no` so nginx
 * does not buffer), plus a keepalive comment heartbeat for long generations.
 */

const HEARTBEAT_INTERVAL_MS = 15000;

export type SSESend = (event: string, payload: unknown) => void;

export function createRecommendationSSEResponse(
  streamHandler: (send: SSESend) => Promise<void>
): Response {
  const encoder = new TextEncoder();

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
        await streamHandler(send);
        send('done', { ok: true });
      } catch (error) {
        send('error', {
          type: 'error',
          error: error instanceof Error ? error.message : 'Stream failed',
          code: 'INTERNAL',
          persisted: false,
        });
        send('done', { ok: false });
      } finally {
        clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
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
