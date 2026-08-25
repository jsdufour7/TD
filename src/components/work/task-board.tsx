'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/ui';
import { Badge, Button, toneTextClass } from '@/components/ui/primitives';
import { toneFor } from '@/lib/ui';

export type BoardTask = {
  id: string;
  runId: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  assignedAgentKey: string | null;
  acceptanceCriteria: string[];
  attemptCount: number;
  maxAttempts: number;
  blockedReason: string | null;
  outputSummary: string | null;
  createdAt: string;
};

type Column = { status: string; label: string; tone: string };

/**
 * Task board (§30).
 *
 * Supports both human-created and agent-created tasks, and lets the operator
 * change priority or reassign — the write goes through the API, which enforces
 * project isolation, and emits a run event so the change is visible in the feed.
 */
export function TaskBoard({
  projectId,
  initialTasks,
  columns,
}: {
  projectId: string;
  initialTasks: BoardTask[];
  columns: Column[];
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<BoardTask[]>(initialTasks);
  const [selected, setSelected] = useState<BoardTask | null>(null);
  const [saving, setSaving] = useState(false);

  async function patch(task: BoardTask, changes: { priority?: number; assignedAgentKey?: string; status?: string }) {
    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/tasks`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, ...changes }),
      });
      if (response.ok) {
        setTasks((current) =>
          current.map((t) => (t.id === task.id ? { ...t, ...changes, assignedAgentKey: changes.assignedAgentKey ?? t.assignedAgentKey } : t)),
        );
        setSelected((current) => (current?.id === task.id ? { ...current, ...changes } : current));
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3 overflow-x-auto pb-1">
        {columns.map((column) => {
          const columnTasks = tasks.filter((t) => t.status === column.status);
          return (
            <section key={column.status} className="w-64 shrink-0 rounded-lg border border-line bg-surface-1">
              <header className="flex items-center gap-2 border-b border-line px-3 py-2">
                <span className={cn('size-1.5 rounded-full bg-current', toneTextClass(toneFor(column.status === 'completed' ? 'completed' : column.status === 'failed' ? 'failed' : column.status === 'blocked' ? 'paused' : column.status === 'running' ? 'running' : 'queued')))} />
                <h2 className="flex-1 text-[12px] font-medium text-ink-1">{column.label}</h2>
                <span className="font-mono text-[10px] text-ink-4">{columnTasks.length}</span>
              </header>
              <ul className="max-h-[26rem] space-y-1.5 overflow-y-auto p-2">
                {columnTasks.length === 0 ? (
                  <li className="rounded border border-dashed border-line px-2 py-4 text-center text-[10.5px] text-ink-4">
                    empty
                  </li>
                ) : (
                  columnTasks.map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(task)}
                        className="w-full rounded border border-line bg-surface-2 p-2 text-left transition-colors hover:border-line-strong"
                      >
                        <p className="line-clamp-2 text-[11.5px] leading-snug text-ink-1">{task.title}</p>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span className="font-mono text-[9.5px] text-ink-4">{task.assignedAgentKey ?? '—'}</span>
                          <span className="ml-auto font-mono text-[9.5px] text-ink-4">P{task.priority}</span>
                        </div>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </section>
          );
        })}
      </div>

      {selected ? (
        <section className="rounded-lg border border-line bg-surface-1">
          <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-[13px] font-medium text-ink-1">{selected.title}</h2>
              <p className="mt-0.5 font-mono text-[10.5px] text-ink-4">
                {selected.assignedAgentKey ?? 'unassigned'} · attempt {selected.attemptCount}/{selected.maxAttempts}
              </p>
            </div>
            <Badge tone={toneFor(selected.status)}>{selected.status.replace(/_/g, ' ')}</Badge>
          </header>

          <div className="space-y-4 p-4">
            {selected.description ? <p className="whitespace-pre-wrap text-[12.5px] text-ink-2">{selected.description}</p> : null}

            {selected.acceptanceCriteria.length > 0 ? (
              <div>
                <p className="text-[11px] tracking-wide text-ink-4 uppercase">Acceptance criteria</p>
                <ul className="mt-1 space-y-1">
                  {selected.acceptanceCriteria.map((criterion, index) => (
                    <li key={index} className="flex gap-2 text-[12px] text-ink-2">
                      <span className="font-mono text-ink-4">{index + 1}.</span>
                      <span>{criterion}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {selected.blockedReason ? (
              <p className="rounded border border-warn/30 bg-warn/10 px-3 py-2 text-[11.5px] text-warn">
                Blocked: {selected.blockedReason}
              </p>
            ) : null}

            {selected.outputSummary ? (
              <div>
                <p className="text-[11px] tracking-wide text-ink-4 uppercase">Outcome</p>
                <pre className="mt-1 whitespace-pre-wrap rounded border border-line bg-surface-2 p-2.5 font-mono text-[11px] text-ink-2">
                  {selected.outputSummary}
                </pre>
              </div>
            ) : null}

            <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
              <label className="space-y-1">
                <span className="text-[11px] text-ink-3">Priority</span>
                <select
                  value={selected.priority}
                  disabled={saving}
                  onChange={(e) => void patch(selected, { priority: Number.parseInt(e.target.value, 10) })}
                  className="h-8 rounded border border-line bg-surface-2 px-2 text-[12px] text-ink-1"
                >
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>
                      P{value} {value === 1 ? '(highest)' : value === 5 ? '(lowest)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[11px] text-ink-3">Reassign</span>
                <select
                  value={selected.assignedAgentKey ?? ''}
                  disabled={saving}
                  onChange={(e) => void patch(selected, { assignedAgentKey: e.target.value })}
                  className="h-8 rounded border border-line bg-surface-2 px-2 font-mono text-[12px] text-ink-1"
                >
                  <option value="">unassigned</option>
                  {[
                    'coo',
                    'product-architect',
                    'software-architect',
                    'fullstack-engineer',
                    'frontend-engineer',
                    'ux-designer',
                    'database-engineer',
                    'qa-engineer',
                    'security-reviewer',
                    'devops-engineer',
                    'code-reviewer',
                    'research-agent',
                    'documentation-agent',
                  ].map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </label>

              <Button size="sm" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
