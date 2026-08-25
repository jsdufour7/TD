'use client';

import { useEffect, useRef, useState } from 'react';
import { useMounted } from '@/components/shared/use-mounted';
import { cn } from '@/lib/ui';
import { Badge, EmptyState, Spinner, toneTextClass } from '@/components/ui/primitives';
import { toneFor, timeAgo } from '@/lib/ui';

export type FeedEvent = {
  id: string;
  seq: number;
  type: string;
  level: string;
  actor: string;
  summary: string;
  payload?: unknown;
  agentInstanceId: string | null;
  taskId: string | null;
  createdAt: string;
};

type Filter = 'all' | 'tools' | 'files' | 'tests' | 'approvals' | 'errors';

/**
 * Live feed (§17, §29).
 *
 * Connects to the SSE endpoint and renders only events that exist in the
 * database. On reconnect it passes the highest seq it has seen, so nothing is
 * duplicated and nothing is missed after a refresh.
 */
export function LiveFeed({
  projectId,
  initialEvents,
  runId,
}: {
  projectId: string;
  initialEvents: FeedEvent[];
  runId?: string | null;
}) {
  const [events, setEvents] = useState<FeedEvent[]>(initialEvents);
  /**
   * Timestamps are derived from the clock and the viewer's locale, so they are
   * rendered only after mount. Emitting them from the server would produce HTML
   * the browser cannot reproduce (UTC server vs. local browser) and React would
   * report a hydration mismatch.
   */
  const mounted = useMounted();
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting' | 'offline'>('connecting');
  const [filter, setFilter] = useState<Filter>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const lastSeq = useRef(initialEvents.reduce((max, e) => Math.max(max, e.seq), 0));
  const listRef = useRef<HTMLUListElement | null>(null);
  const retries = useRef(0);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    function connect() {
      if (stopped) return;
      const query = new URLSearchParams({ after: String(lastSeq.current) });
      if (runId) query.set('runId', runId);
      source = new EventSource(`/api/projects/${projectId}/events?${query.toString()}`);
      setConnection(retries.current === 0 ? 'connecting' : 'reconnecting');

      source.addEventListener('open', () => {
        retries.current = 0;
        setConnection('live');
      });

      source.addEventListener('run-event', (message) => {
        try {
          const event = JSON.parse((message as MessageEvent).data) as FeedEvent;
          if (event.seq <= lastSeq.current) return;
          lastSeq.current = event.seq;
          setEvents((current) => {
            const next = [...current, event];
            // Bound memory for very long runs; the full history stays in the DB.
            return next.length > 800 ? next.slice(-800) : next;
          });
        } catch {
          /* ignore malformed frames */
        }
      });

      source.addEventListener('synced', () => setConnection('live'));

      source.onerror = () => {
        setConnection('offline');
        source?.close();
        source = null;
        retries.current += 1;
        // Back off, but keep trying: a dropped stream must not look like a dead run.
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(retries.current, 5));
        retryTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, [projectId, runId]);

  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const filtered = events.filter((event) => {
    if (filter === 'all') return true;
    if (filter === 'errors') return event.level === 'error';
    if (filter === 'tools') return event.type.startsWith('tool.');
    if (filter === 'files') return event.type === 'file.changed' || event.type.startsWith('command.');
    if (filter === 'tests') return event.type.startsWith('test.');
    if (filter === 'approvals') return event.type.startsWith('approval.');
    return true;
  });

  const CONNECTION_TONE: Record<string, string> = {
    live: 'text-ok',
    connecting: 'text-ink-3',
    reconnecting: 'text-warn',
    offline: 'text-danger',
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-line bg-surface-1">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-[13px] font-medium text-ink-1">Live activity</h2>
        <span className={cn('flex items-center gap-1.5 font-mono text-[10px]', CONNECTION_TONE[connection])}>
          {connection === 'live' ? (
            <span className="size-1.5 rounded-full bg-ok animate-pulse-dot" />
          ) : connection === 'offline' || connection === 'reconnecting' ? (
            <Spinner className="size-2.5" />
          ) : (
            <span className="size-1.5 rounded-full bg-ink-4" />
          )}
          {connection}
        </span>
        {/* Derived from events rather than read off the ref: reading a ref
            during render is not render-safe and would not re-render. */}
        <span className="font-mono text-[10px] text-ink-4">
          #{events.length > 0 ? events[events.length - 1]!.seq : 0}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {(['all', 'tools', 'files', 'tests', 'approvals', 'errors'] as Filter[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[10px] uppercase transition-colors',
                filter === value ? 'bg-surface-3 text-ink-1' : 'text-ink-4 hover:text-ink-2',
              )}
            >
              {value}
            </button>
          ))}
          <label className="ml-1 flex cursor-pointer items-center gap-1 text-[10px] text-ink-4">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="size-3 accent-current"
            />
            follow
          </label>
        </div>
      </header>

      {filtered.length === 0 ? (
        <div className="p-4">
          <EmptyState
            compact
            title={events.length === 0 ? 'No activity yet' : 'No events match this filter'}
            description={
              events.length === 0
                ? 'Give AI Core an objective above. Events appear here the moment work starts — nothing is simulated.'
                : 'Try a different filter.'
            }
          />
        </div>
      ) : (
        <ul ref={listRef} className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {filtered.map((event) => (
            <li key={event.id} className="flex gap-2.5 px-3 py-1.5 animate-slide-in">
              <span
                className={cn('mt-1.5 size-1.5 shrink-0 rounded-full bg-current', toneTextClass(toneFor(levelToStatus(event.level))))}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] leading-snug text-ink-1">{event.summary}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-mono text-[10px] text-ink-4">
                  <span>{event.type}</span>
                  <span aria-hidden="true">·</span>
                  <span>{event.actor}</span>
                  <span aria-hidden="true">·</span>
                  <span>#{event.seq}</span>
                  <span aria-hidden="true">·</span>
                  <span>{mounted ? new Date(event.createdAt).toLocaleTimeString() : '--:--:--'}</span>
                  <span className="text-ink-4/60">{mounted ? timeAgo(event.createdAt) : ''}</span>
                </p>
              </div>
              {event.level === 'error' ? <Badge tone="danger">error</Badge> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function levelToStatus(level: string): string {
  switch (level) {
    case 'success':
      return 'completed';
    case 'error':
      return 'failed';
    case 'warning':
      return 'paused';
    default:
      return 'running';
  }
}
