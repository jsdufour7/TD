'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/primitives';

/** Pause / resume / cancel controls for a single run (§5). */
export function RunDetailActions({
  projectId,
  runId,
  isLive,
  status,
}: {
  projectId: string;
  runId: string;
  isLive: boolean;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function control(signal: 'pause' | 'resume' | 'cancel') {
    setBusy(signal);
    try {
      await fetch(`/api/projects/${projectId}/runs/${runId}/control`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signal }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {status === 'running' || status === 'queued' ? (
        <Button size="sm" onClick={() => void control('pause')} loading={busy === 'pause'}>
          Pause
        </Button>
      ) : null}
      {status === 'paused' ? (
        <Button size="sm" variant="primary" onClick={() => void control('resume')} loading={busy === 'resume'}>
          Resume
        </Button>
      ) : null}
      {isLive ? (
        <Button size="sm" variant="danger" onClick={() => void control('cancel')} loading={busy === 'cancel'}>
          Cancel run
        </Button>
      ) : null}
    </div>
  );
}
