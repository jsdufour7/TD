'use client';

import { useRouter } from 'next/navigation';
import { useMounted } from '@/components/shared/use-mounted';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/ui';
import { Badge, Button, EmptyState, Field, Spinner, inputClass, toneTextClass } from '@/components/ui/primitives';
import { toneFor, timeAgo, durationLabel } from '@/lib/ui';
import { LiveFeed, type FeedEvent } from './live-feed';

export type RunSummary = {
  id: string;
  title: string;
  objective: string;
  status: string;
  phase: string;
  controlSignal: string | null;
  resultSummary: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type TaskSummary = {
  id: string;
  title: string;
  status: string;
  assignedAgentKey: string | null;
  acceptanceCriteria: string[];
  attemptCount: number;
  maxAttempts: number;
  blockedReason: string | null;
  outputSummary: string | null;
};

export type ChangeSummary = { id: string; path: string; changeType: string; additions: number; deletions: number };

export type RunDetail = {
  tasks: TaskSummary[];
  changes: ChangeSummary[];
  events: FeedEvent[];
  agents: Array<{ id: string; definitionKey: string; status: string; lastAction: string | null }>;
  commands: Array<{ id: string; label: string; status: string; exitCode: number | null; previewUrl: string | null }>;
  tests: Array<{ id: string; suite: string; status: string; passed: number; failed: number }>;
};

const ROUTING_POLICIES = [
  { value: 'BALANCED', label: 'Balanced' },
  { value: 'BEST', label: 'Best' },
  { value: 'FAST', label: 'Fast' },
  { value: 'CODING_MAX', label: 'Coding max' },
  { value: 'LOW_COST', label: 'Low cost' },
  { value: 'LOCAL_ONLY', label: 'Local only' },
  { value: 'PRIVACY_FIRST', label: 'Privacy first' },
];

/**
 * The work surface (§26, §33).
 *
 * The user can always answer four questions from here: what was requested, what
 * AI Core is doing, who is doing it, and whether it worked. State is polled for
 * the run record only — the event stream is pushed over SSE.
 */
export function Workbench({
  projectId,
  initialRuns,
  initialDetail,
  hasRepository,
  hasModelProvider,
}: {
  projectId: string;
  initialRuns: RunSummary[];
  /** Server-rendered detail for the initially selected run, so the first paint
   *  is complete and no fetch-in-effect is needed to fill the panels. */
  initialDetail: RunDetail | null;
  hasRepository: boolean;
  hasModelProvider: boolean;
}) {
  const router = useRouter();
  const [runs, setRuns] = useState<RunSummary[]>(initialRuns);
  const [activeRunId, setActiveRunId] = useState<string | null>(initialRuns[0]?.id ?? null);
  const [objective, setObjective] = useState('');
  const [policy, setPolicy] = useState('BALANCED');
  const [instruction, setInstruction] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(initialDetail);
  const [busy, setBusy] = useState<string | null>(null);
  /** Relative timestamps depend on the clock; keep them out of the SSR HTML. */
  const mounted = useMounted();

  const activeRun = runs.find((r) => r.id === activeRunId) ?? null;
  const isLive = activeRun ? ['running', 'queued', 'paused', 'waiting_for_approval', 'waiting_for_user'].includes(activeRun.status) : false;

  const refresh = useCallback(
    async (runId: string | null): Promise<void> => {
      const [runsResponse, detailResponse] = await Promise.all([
        fetch(`/api/projects/${projectId}/runs?limit=20`, { cache: 'no-store' }),
        runId ? fetch(`/api/projects/${projectId}/runs/${runId}`, { cache: 'no-store' }) : null,
      ]);

      if (runsResponse.ok) {
        const body = (await runsResponse.json()) as { runs: RunSummary[] };
        setRuns(body.runs);
      }
      if (detailResponse?.ok) {
        setDetail((await detailResponse.json()) as RunDetail);
      }
    },
    [projectId],
  );

  // Switching runs is a user action, so the fetch belongs in the handler rather
  // than in an effect reacting to the state change.
  function selectRun(runId: string): void {
    setActiveRunId(runId);
    void refresh(runId);
  }

  /**
   * Polling only.
   *
   * The effect body sets up a subscription to an external system (the server)
   * and returns a teardown; it never calls setState synchronously. The first
   * paint is already complete from `initialDetail`, and the high-frequency path
   * (events) is pushed over SSE rather than polled — §57.
   */
  useEffect(() => {
    if (!isLive) return;
    const timer = setInterval(() => {
      void refresh(activeRunId);
    }, 4000);
    return () => clearInterval(timer);
  }, [isLive, activeRunId, refresh]);

  async function submitObjective(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ objective, routingPolicy: policy }),
      });
      const body = (await response.json()) as { run?: RunSummary; error?: { message?: string } };
      if (!response.ok || !body.run) {
        setError(body.error?.message ?? 'Could not start the run');
        return;
      }
      setObjective('');
      setActiveRunId(body.run.id);
      await refresh(body.run.id);
      router.refresh();
    } catch {
      setError('Network error while starting the run');
    } finally {
      setSubmitting(false);
    }
  }

  async function control(signal: 'pause' | 'resume' | 'cancel') {
    if (!activeRunId) return;
    setBusy(signal);
    try {
      await fetch(`/api/projects/${projectId}/runs/${activeRunId}/control`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signal }),
      });
      await refresh(activeRunId);
    } finally {
      setBusy(null);
    }
  }

  async function sendInstruction(event: React.FormEvent) {
    event.preventDefault();
    if (!activeRunId || !instruction.trim()) return;
    setBusy('instruct');
    try {
      await fetch(`/api/projects/${projectId}/runs/${activeRunId}/instructions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction }),
      });
      setInstruction('');
      await refresh(activeRunId);
    } finally {
      setBusy(null);
    }
  }

  const devServer = detail?.commands.find((c) => c.previewUrl) ?? null;

  return (
    <div className="flex min-h-0 flex-col gap-4 p-4 lg:p-5">
      {/* Objective composer */}
      <section className="rounded-lg border border-line bg-surface-1">
        <form onSubmit={submitObjective} className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-medium text-ink-1">Give AI Core an objective</h2>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-ink-4" htmlFor="policy">
                Model routing
              </label>
              <select
                id="policy"
                value={policy}
                onChange={(e) => setPolicy(e.target.value)}
                className="h-7 rounded border border-line bg-surface-2 px-2 font-mono text-[11px] text-ink-2"
              >
                {ROUTING_POLICIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <textarea
            className={cn(inputClass, 'min-h-24 resize-y font-mono text-[12.5px]')}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder={'Add a Settings page with a profile form. Follow the existing design system. Add validation and tests.'}
            required
          />

          {!hasRepository ? (
            <p className="rounded border border-warn/30 bg-warn/10 px-3 py-2 text-[11.5px] text-warn">
              No repository is connected. AI Core can still plan and record work, but it has no code to
              inspect or change.{' '}
              <a href={`/projects/${projectId}/repository`} className="underline">
                Connect one
              </a>
              .
            </p>
          ) : null}

          {!hasModelProvider ? (
            <p className="rounded border border-line-strong bg-surface-2 px-3 py-2 text-[11.5px] text-ink-3">
              <strong className="text-ink-1">No model provider is configured.</strong> AI Core will still
              inspect the repository, build a real task graph, run the project&apos;s own typecheck, lint,
              test and build commands, and record true results — but tasks that need reasoning will be
              marked <em>blocked</em> with the reason.{' '}
              <a href="/models" className="text-accent underline">
                Configure a provider
              </a>{' '}
              (a local endpoint works with no account).
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-ink-4">
              The run persists in the database. Refreshing this page will not interrupt it.
            </p>
            <Button type="submit" variant="primary" loading={submitting}>
              Start autonomous run
            </Button>
          </div>
        </form>
      </section>

      {/* Run selector + controls */}
      {runs.length > 0 ? (
        <section className="rounded-lg border border-line bg-surface-1">
          <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <label className="text-[11px] text-ink-3" htmlFor="run-select">
              Run
            </label>
            <select
              id="run-select"
              value={activeRunId ?? ''}
              onChange={(e) => selectRun(e.target.value)}
              className="h-7 min-w-0 flex-1 rounded border border-line bg-surface-2 px-2 text-[11.5px] text-ink-1"
            >
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.title} — {run.status.replace(/_/g, ' ')}
                  {mounted ? ` · ${timeAgo(run.createdAt)}` : ''}
                </option>
              ))}
            </select>

            {activeRun ? (
              <div className="flex items-center gap-1.5">
                <Badge tone={toneFor(activeRun.status)} dot={isLive}>
                  {activeRun.status.replace(/_/g, ' ')}
                </Badge>
                <span className="font-mono text-[10px] text-ink-4">phase {activeRun.phase}</span>
                {activeRun.status === 'running' || activeRun.status === 'queued' ? (
                  <Button size="xs" onClick={() => control('pause')} loading={busy === 'pause'}>
                    Pause
                  </Button>
                ) : null}
                {activeRun.status === 'paused' ? (
                  <Button size="xs" variant="primary" onClick={() => control('resume')} loading={busy === 'resume'}>
                    Resume
                  </Button>
                ) : null}
                {isLive ? (
                  <Button size="xs" variant="danger" onClick={() => control('cancel')} loading={busy === 'cancel'}>
                    Cancel
                  </Button>
                ) : null}
                <a
                  href={`/projects/${projectId}/runs/${activeRun.id}`}
                  className="rounded px-1.5 py-1 text-[10.5px] text-accent hover:underline"
                >
                  full detail
                </a>
              </div>
            ) : null}
          </header>

          {activeRun ? (
            <div className="space-y-3 p-3">
              <p className="whitespace-pre-wrap font-mono text-[11.5px] text-ink-2">{activeRun.objective}</p>

              {/* Intervene while the run works (§5, §54) */}
              {isLive ? (
                <form onSubmit={sendInstruction} className="flex gap-2">
                  <input
                    className={cn(inputClass, 'h-8 flex-1 text-[12px]')}
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="Redirect the run — e.g. keep the backend work, but change the Settings UI to use tabs"
                  />
                  <Button type="submit" size="sm" loading={busy === 'instruct'} disabled={!instruction.trim()}>
                    Send
                  </Button>
                </form>
              ) : null}

              {activeRun.resultSummary ? (
                <pre className="whitespace-pre-wrap rounded border border-line bg-surface-2 p-2.5 font-mono text-[11px] text-ink-2">
                  {activeRun.resultSummary}
                </pre>
              ) : null}

              {activeRun.error ? (
                <pre className="whitespace-pre-wrap rounded border border-danger/30 bg-danger/10 p-2.5 font-mono text-[11px] text-danger">
                  {activeRun.error}
                </pre>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Main split: feed + inspector */}
      <div className="grid min-h-[32rem] gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {activeRunId ? (
          <LiveFeed projectId={projectId} initialEvents={detail?.events ?? []} runId={activeRunId} />
        ) : (
          <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-line bg-surface-1 p-4">
            <EmptyState
              title="No run selected"
              description="Start a run above, or pick one from history. The feed shows real events written by the run engine."
            />
          </section>
        )}

        <aside className="flex min-h-0 flex-col gap-4">
          <Panel title="Tasks" count={detail?.tasks.length ?? 0}>
            {detail?.tasks.length ? (
              <ul className="divide-y divide-line">
                {detail.tasks.map((task) => (
                  <li key={task.id} className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      <Badge tone={toneFor(task.status)}>{task.status.replace(/_/g, ' ')}</Badge>
                      <p className="min-w-0 flex-1 text-[12px] leading-snug text-ink-1">{task.title}</p>
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-ink-4">
                      {task.assignedAgentKey ?? 'unassigned'}
                      {task.attemptCount > 0 ? ` · attempt ${task.attemptCount}/${task.maxAttempts}` : ''}
                    </p>
                    {task.blockedReason ? (
                      <p className="mt-1 text-[10.5px] text-warn">{task.blockedReason}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-3">
                <EmptyState compact title="No tasks yet" description="The COO creates tasks during planning." />
              </div>
            )}
          </Panel>

          <Panel title="Changed files" count={detail?.changes.length ?? 0}>
            {detail?.changes.length ? (
              <ul className="divide-y divide-line">
                {detail.changes.map((change) => (
                  <li key={change.id} className="flex items-center gap-2 px-3 py-1.5">
                    <Badge tone={change.changeType === 'deleted' ? 'danger' : change.changeType === 'added' ? 'ok' : 'info'}>
                      {change.changeType[0]?.toUpperCase()}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-2">{change.path}</span>
                    <span className="font-mono text-[10px]">
                      <span className="text-ok">+{change.additions}</span>{' '}
                      <span className="text-danger">−{change.deletions}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-3">
                <EmptyState compact title="No file changes" description="Changes appear here as agents write files." />
              </div>
            )}
          </Panel>

          <Panel title="Verification" count={detail?.tests.length ?? 0}>
            {detail?.tests.length ? (
              <ul className="divide-y divide-line">
                {detail.tests.map((test) => (
                  <li key={test.id} className="flex items-center gap-2 px-3 py-1.5">
                    <Badge tone={toneFor(test.status === 'passed' ? 'completed' : 'failed')}>{test.status}</Badge>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-2">{test.suite}</span>
                    <span className="font-mono text-[10px] text-ink-3">
                      {test.passed}/{test.passed + test.failed}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-3">
                <EmptyState compact title="No test runs recorded" />
              </div>
            )}
          </Panel>

          <Panel title="Terminal & preview" count={detail?.commands.length ?? 0}>
            {detail?.commands.length ? (
              <ul className="divide-y divide-line">
                {detail.commands.slice(0, 6).map((command) => (
                  <li key={command.id} className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn('size-1.5 rounded-full bg-current', toneTextClass(toneFor(command.status === 'succeeded' ? 'completed' : command.status === 'running' ? 'running' : 'failed')))}
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink-2">{command.label}</span>
                      <span className="font-mono text-[10px] text-ink-4">exit {command.exitCode ?? '—'}</span>
                    </div>
                    {command.previewUrl ? (
                      <a
                        href={command.previewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 block truncate font-mono text-[10px] text-accent hover:underline"
                      >
                        {command.previewUrl}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-3">
                <EmptyState compact title="No commands run yet" />
              </div>
            )}
          </Panel>

          {devServer?.previewUrl ? (
            <Panel title="Live preview">
              <div className="p-2">
                <iframe
                  src={devServer.previewUrl}
                  title="Application preview"
                  className="h-64 w-full rounded border border-line bg-white"
                />
                <p className="mt-1 truncate font-mono text-[10px] text-ink-4">{devServer.previewUrl}</p>
              </div>
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Panel({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-line bg-surface-1">
      <header className="flex items-center gap-2 border-b border-line px-3 py-1.5">
        <h3 className="text-[12px] font-medium text-ink-1">{title}</h3>
        {count !== undefined ? <span className="font-mono text-[10px] text-ink-4">{count}</span> : null}
      </header>
      <div className="max-h-64 min-h-0 overflow-y-auto">{children}</div>
    </section>
  );
}

export { Spinner, Field, durationLabel };
