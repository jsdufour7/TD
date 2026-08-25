import { and, desc, eq, gt } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { serialiseRunEvent, subscribeToProjectEvents } from '@/engine/events';
import { createLogger } from '@/lib/logger';

const log = createLogger('sse');

/**
 * Server-Sent Events feed.
 *
 * The stream is derived from the `run_events` table, so it survives a page
 * refresh: reconnect with `?after=<seq>` and the client receives everything it
 * missed. Nothing here invents activity — if no events are written, nothing is
 * sent beyond a keep-alive comment.
 */

export const dynamic = 'force-dynamic';

const KEEP_ALIVE_MS = 15_000;
const MAX_STREAM_MS = 10 * 60 * 1000;

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  const { projectId } = await context.params;

  try {
    await requireProject(projectId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    return new Response(JSON.stringify({ error: message }), { status: 403, headers: { 'content-type': 'application/json' } });
  }

  const url = new URL(request.url);
  const afterParam = url.searchParams.get('after');
  const runIdFilter = url.searchParams.get('runId');
  let afterSeq = afterParam ? Number.parseInt(afterParam, 10) : 0;
  if (!Number.isFinite(afterSeq) || afterSeq < 0) afterSeq = 0;

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Replay anything the client missed, oldest first.
      const db = await getDb();
      const conditions = [eq(schema.runEvents.projectId, projectId), gt(schema.runEvents.seq, afterSeq)];
      const missed = await db
        .select()
        .from(schema.runEvents)
        .where(and(...conditions))
        .orderBy(desc(schema.runEvents.createdAt))
        .limit(300);

      for (const event of missed.reverse()) {
        send('run-event', serialiseRunEvent(event));
        afterSeq = Math.max(afterSeq, event.seq);
      }
      send('synced', { afterSeq });

      const unsubscribe = subscribeToProjectEvents(async (changedProjectId) => {
        if (closed || changedProjectId !== projectId) return;
        try {
          const fresh = await db
            .select()
            .from(schema.runEvents)
            .where(
              and(
                eq(schema.runEvents.projectId, projectId),
                gt(schema.runEvents.seq, afterSeq),
                ...(runIdFilter ? [eq(schema.runEvents.runId, runIdFilter)] : []),
              ),
            )
            .orderBy(desc(schema.runEvents.createdAt))
            .limit(100);

          for (const event of fresh.reverse()) {
            send('run-event', serialiseRunEvent(event));
            afterSeq = Math.max(afterSeq, event.seq);
          }
        } catch (error) {
          log.warn('failed to deliver events', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      const keepAlive = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(`: keep-alive ${new Date().toISOString()}\n\n`));
      }, KEEP_ALIVE_MS);

      // Bound the connection so idle clients recycle rather than accumulating.
      const maxAge = setTimeout(() => cleanup(), MAX_STREAM_MS);

      const onClose = () => cleanup();
      request.signal.addEventListener('abort', onClose, { once: true });

      function cleanup(): void {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        clearTimeout(maxAge);
        unsubscribe();
        request.signal.removeEventListener('abort', onClose);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
