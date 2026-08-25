'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, inputClass } from '@/components/ui/primitives';
import type { RepoInspection } from '@/repo/inspect';

/**
 * Connect a repository (§11, §45).
 *
 * Two real paths: clone a remote over https/ssh, or initialise a git repository
 * inside the project sandbox. Both are followed by a read-only inspection whose
 * result is returned and displayed.
 */
export function ConnectRepository({ projectId, hasRepository }: { projectId: string; hasRepository: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'clone' | 'init' | 'inspect'>(hasRepository ? 'inspect' : 'clone');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ fileCount: number; warnings: string[]; summary: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/repository`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: mode,
          name: name || undefined,
          remoteUrl: mode === 'clone' ? remoteUrl : undefined,
        }),
      });
      const body = (await response.json()) as {
        inspection?: { fileCount: number; warnings: string[]; summary: string };
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? 'Could not connect the repository');
        return;
      }
      if (body.inspection) {
        setResult({
          fileCount: body.inspection.fileCount,
          warnings: body.inspection.warnings,
          summary: body.inspection.summary,
        });
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError('Network error while connecting the repository');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => setOpen(true)}>
          {hasRepository ? 'Re-inspect / change repository' : 'Connect repository'}
        </Button>
      </div>

      {result ? (
        <div className="rounded-md border border-line bg-surface-1 p-3">
          <p className="text-[12px] text-ok">
            Inspection complete — {result.fileCount} files scanned.
          </p>
          {result.warnings.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {result.warnings.map((warning) => (
                <li key={warning} className="text-[11px] text-warn">
                  ⚠ {warning}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 sm:p-8">
          <form
            onSubmit={submit}
            className="w-full max-w-lg space-y-4 rounded-lg border border-line bg-surface-1 p-5 animate-slide-in"
          >
            <div>
              <h2 className="text-sm font-semibold">Connect a repository</h2>
              <p className="text-[11px] text-ink-3">
                Nothing is modified during inspection — AI Core reads first and records what it finds.
              </p>
            </div>

            <div className="flex gap-1.5">
              {(['clone', 'init', 'inspect'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`rounded border px-2.5 py-1 text-[11.5px] transition-colors ${
                    mode === value ? 'border-accent/40 bg-accent/15 text-accent' : 'border-line text-ink-3 hover:text-ink-1'
                  }`}
                >
                  {value === 'clone' ? 'Clone remote' : value === 'init' ? 'Initialise here' : 'Re-inspect'}
                </button>
              ))}
            </div>

            {mode === 'clone' ? (
              <Field label="Remote URL" hint="https or ssh. Cloned with --depth 50 into the project sandbox." required>
                <input
                  className={inputClass}
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  placeholder="https://github.com/twodots/panorama.git"
                  required
                />
              </Field>
            ) : null}

            <Field label="Repository name" hint="Optional. Defaults to the remote name or the project name.">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="panorama" />
            </Field>

            {error ? (
              <p role="alert" className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy}>
                {mode === 'inspect' ? 'Re-inspect' : 'Connect'}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export type { RepoInspection };
