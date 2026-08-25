'use client';

import { useRouter } from 'next/navigation';
import { useMounted } from '@/components/shared/use-mounted';
import { useState } from 'react';
import { Badge, Button, EmptyState } from '@/components/ui/primitives';
import { timeAgo } from '@/lib/ui';
import { inputClass } from '@/components/ui/primitives';

export type ApprovalItem = {
  id: string;
  projectId: string;
  projectName?: string;
  runId: string | null;
  category: string;
  title: string;
  description: string;
  risk: string;
  action: unknown;
  status: string;
  requestedAt: string;
};

/**
 * Approval queue (§20).
 *
 * Approve, reject, or approve with an edited instruction. The decision is written
 * to the database; the blocked tool observes it and resumes or aborts. Nothing
 * high-impact executes without one of these three outcomes.
 */
export function ApprovalQueue({ projectId, approvals, highlight }: { projectId?: string; approvals: ApprovalItem[]; highlight?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  /** Relative times depend on the clock; render them only after mount. */
  const mounted = useMounted();
  const [editing, setEditing] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');

  async function decide(approval: ApprovalItem, decision: 'approve' | 'reject' | 'edit', editedInstruction?: string) {
    const url = projectId ? `/api/projects/${projectId}/approvals` : `/api/projects/${approval.projectId}/approvals`;
    setBusy(`${approval.id}:${decision}`);
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          approvalId: approval.id,
          decision,
          ...(editedInstruction ? { editedInstruction } : {}),
        }),
      });
      setEditing(null);
      setInstruction('');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const pending = approvals.filter((a) => a.status === 'pending');
  const resolved = approvals.filter((a) => a.status !== 'pending');

  if (approvals.length === 0) {
    return (
      <EmptyState
        title="No approval requests"
        description="AI Core asks before destructive deletions, production deployments, git pushes, secret changes and other high-impact operations. When it does, the request appears here and the run waits."
      />
    );
  }

  return (
    <div className="space-y-4">
      {pending.length > 0 ? (
        <ul className="space-y-3">
          {pending.map((approval) => (
            <li
              key={approval.id}
              id={approval.id}
              className={`rounded-lg border bg-surface-1 p-4 ${highlight === approval.id ? 'border-accent/50 ring-1 ring-accent/30' : 'border-line'}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={approval.risk === 'critical' ? 'danger' : approval.risk === 'high' ? 'warn' : 'info'}>
                  {approval.risk} risk
                </Badge>
                <Badge tone="idle">{approval.category.replace(/_/g, ' ')}</Badge>
                {approval.projectName ? <span className="text-[11px] text-ink-4">{approval.projectName}</span> : null}
                <span className="ml-auto text-[10.5px] text-ink-4">
                  {mounted ? timeAgo(approval.requestedAt) : ''}
                </span>
              </div>

              <h3 className="mt-2 text-[13.5px] font-medium text-ink-1">{approval.title}</h3>
              <p className="mt-1 text-[12px] text-ink-2">{approval.description}</p>

              <details className="mt-2">
                <summary className="cursor-pointer font-mono text-[10.5px] text-ink-4">action payload</summary>
                <pre className="mt-1 overflow-x-auto rounded border border-line bg-surface-2 p-2 font-mono text-[10.5px] text-ink-3">
                  {JSON.stringify(approval.action, null, 2)}
                </pre>
              </details>

              {editing === approval.id ? (
                <div className="mt-3 space-y-2">
                  <textarea
                    className={`${inputClass} min-h-20 resize-y font-mono text-[12px]`}
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="Approve, but with this change…"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={!instruction.trim()}
                      loading={busy === `${approval.id}:edit`}
                      onClick={() => void decide(approval, 'edit', instruction)}
                    >
                      Approve with edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    loading={busy === `${approval.id}:approve`}
                    onClick={() => void decide(approval, 'approve')}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy === `${approval.id}:reject`}
                    onClick={() => void decide(approval, 'reject')}
                  >
                    Reject
                  </Button>
                  <Button size="sm" onClick={() => setEditing(approval.id)}>
                    Approve with edit…
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact title="Nothing is waiting" description="All approval requests have been decided." />
      )}

      {resolved.length > 0 ? (
        <section className="rounded-lg border border-line bg-surface-1">
          <header className="border-b border-line px-4 py-2">
            <h2 className="text-[12.5px] font-medium text-ink-1">Decided</h2>
          </header>
          <ul className="divide-y divide-line">
            {resolved.map((approval) => (
              <li key={approval.id} className="flex items-center gap-2 px-4 py-2">
                <Badge tone={approval.status === 'approved' ? 'ok' : approval.status === 'rejected' ? 'danger' : 'idle'}>
                  {approval.status}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{approval.title}</span>
                <span className="font-mono text-[10px] text-ink-4">{approval.category}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
