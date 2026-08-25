'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/primitives';

/**
 * Provider health check (§22).
 *
 * Probes every provider and persists the result. A local provider being switched
 * off is reported as offline; it does not throw and does not affect the rest of
 * the platform.
 */
export function ProviderHealth() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch('/api/models/health', { method: 'POST' });
      const body = (await response.json()) as {
        results?: Array<{ key: string; status: string }>;
        error?: { message?: string };
      };
      if (!response.ok || !body.results) {
        setResult(body.error?.message ?? 'Health check failed');
        return;
      }
      setResult(
        body.results.map((r) => `${r.key}: ${r.status}`).join('  ·  ') || 'No providers registered',
      );
      router.refresh();
    } catch {
      setResult('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {result ? <span className="font-mono text-[10.5px] text-ink-3">{result}</span> : null}
      <Button variant="primary" onClick={() => void check()} loading={busy}>
        Check health
      </Button>
    </div>
  );
}
