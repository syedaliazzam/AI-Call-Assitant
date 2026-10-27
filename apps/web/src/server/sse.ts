/**
 * File: apps/web/src/server/sse.ts
 * Purpose: Turns a streamed Claude reply into a `text/event-stream` (server-sent events) response
 *          body with `delta`, `done` and `error` events. Each text piece is written the moment it
 *          arrives; nothing is collected first.
 * Used by: app/api/answer/route.ts (and app/api/notes/route.ts, Day 5)
 * Depends on: @kite/shared (AnswerEvent)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (Response: text/event-stream)
 */
import 'server-only';
import type { AnswerEvent } from '@kite/shared';

/**
 * HTTP headers for an SSE response.
 * - `no-cache` stops browsers and proxies from storing the reply.
 * - `no-transform` stops compression middleware (including Next.js's) from gzipping the stream;
 *   compressors buffer output, which would hold back the first words.
 * - `X-Accel-Buffering: no` tells nginx-style proxies not to buffer either.
 */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

/**
 * Formats one server-sent event: an `event:` line, a `data:` line with JSON, and a blank line.
 * JSON.stringify never emits raw newlines, so the data always fits on one `data:` line.
 *
 * @param type Event name, for example 'delta'.
 * @param data Payload, serialised as JSON.
 * @returns The event text, for example 'event: delta\ndata: {"text":"Hi"}\n\n'.
 * Called from: toEventStream()
 */
export function formatEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Formats an AnswerEvent: its `type` becomes the event name, the other fields the data.
 *
 * @param event The event to send.
 * @returns The SSE text.
 * Called from: toEventStream()
 */
function formatAnswerEvent(event: AnswerEvent): string {
  const { type, ...data } = event;
  return formatEvent(type, data);
}

/** Facts toEventStream() passes to its callbacks. */
export interface StreamStats {
  /** performance.now() when the first text piece was sent, or null if none was. */
  firstDeltaAt: number | null;
}

/** Callbacks for toEventStream(). */
export interface EventStreamHandlers<R> {
  /**
   * Called when the source finishes. Returns the closing event: normally `done` (usage and
   * timings), or `error` when the result itself is a failure (for example a refusal).
   */
  onDone: (result: R, stats: StreamStats) => AnswerEvent;
  /** Called when the source throws. Returns the `error` event to send. */
  onError: (error: unknown, stats: StreamStats) => AnswerEvent;
}

/** Encodes event text to the bytes a Response body carries. */
const encoder = new TextEncoder();

/**
 * Wraps a reply generator as an SSE byte stream.
 * Pull-based: the next piece is only requested from Claude when the browser has taken the
 * previous one, and each piece is enqueued as soon as it exists (no batching). If the browser
 * disconnects, cancel() stops the generator, which aborts the Claude request.
 *
 * @param source   Async generator yielding text pieces and returning a final result.
 * @param handlers onDone builds the closing event; onError builds the error event.
 * @returns A ReadableStream for `new Response(stream, { headers: SSE_HEADERS })`.
 * Called from: POST handler in app/api/answer/route.ts
 */
export function toEventStream<R>(
  source: AsyncGenerator<string, R, undefined>,
  handlers: EventStreamHandlers<R>,
): ReadableStream<Uint8Array> {
  const stats: StreamStats = { firstDeltaAt: null };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await source.next();
        if (next.done) {
          controller.enqueue(encoder.encode(formatAnswerEvent(handlers.onDone(next.value, stats))));
          controller.close();
          return;
        }
        stats.firstDeltaAt ??= performance.now();
        controller.enqueue(encoder.encode(formatAnswerEvent({ type: 'delta', text: next.value })));
      } catch (error) {
        controller.enqueue(encoder.encode(formatAnswerEvent(handlers.onError(error, stats))));
        controller.close();
      }
    },
    async cancel() {
      // The browser went away: stop the generator so its finally block aborts the Claude call.
      await source.return(undefined as R);
    },
  });
}
