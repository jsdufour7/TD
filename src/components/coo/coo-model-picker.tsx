'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Cpu } from 'lucide-react';
import { cn } from '@/lib/ui';
import { Button, Notice, Select } from '@/components/ui/primitives';
import type { AssignmentsView } from '@/ai/assignments-view';

/**
 * "Which model does this agent use?" — the operator's answer.
 *
 * One control, used both in the COO drawer and on the Models page. The server
 * hands it the current gateway state, so nothing has to be fetched before the
 * first paint; a mutation re-reads it from the same endpoint.
 *
 * It shows the truth (assigned model, or the routing policy in force) and says
 * plainly when the gateway cannot answer at all, instead of letting the COO fail
 * mysteriously later.
 */
export function CooModelPicker({
  agentKey = 'coo',
  initial,
  compact = false,
  className,
}: {
  agentKey?: string;
  initial: AssignmentsView | null;
  compact?: boolean;
  className?: string;
}) {
  const [data, setData] = useState<AssignmentsView | null>(initial);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState<string>(initial?.agents.find((a) => a.key === agentKey)?.binding?.modelId ?? '');
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape — a popover that traps the pointer is a bug.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const agent = data?.agents.find((a) => a.key === agentKey);
  const binding = agent?.binding ?? null;
  const label = binding?.model
    ? binding.model.displayName
    : `Routage ${binding?.policy ?? agent?.modelPolicy ?? 'BALANCED'}`;
  const health = binding?.model?.providerHealth ?? 'unknown';

  async function refresh(): Promise<AssignmentsView | null> {
    try {
      const res = await fetch('/api/gateway/bindings', { cache: 'no-store' });
      if (!res.ok) return null;
      const body = (await res.json()) as AssignmentsView;
      setData(body);
      return body;
    } catch {
      return null;
    }
  }

  async function openPicker() {
    setOpen((value) => !value);
    const fresh = await refresh();
    const current = fresh?.agents.find((a) => a.key === agentKey)?.binding?.modelId ?? '';
    setDraft(current);
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/gateway/bindings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentKey, modelId: draft || null }),
      });
      if (res.ok) {
        await refresh();
        setSaved(true);
        window.setTimeout(() => setOpen(false), 450);
      }
    } finally {
      setSaving(false);
    }
  }

  const dirty = draft !== (binding?.modelId ?? '');

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => void openPicker()}
        title="Modèle utilisé par le COO — cliquer pour en assigner un"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1 text-[11.5px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink-1',
          compact ? 'h-7' : 'h-8',
        )}
      >
        <Cpu className={cn('size-3.5 shrink-0', binding?.model ? 'text-accent' : 'text-ink-4')} />
        <span className="max-w-[10rem] truncate">{label}</span>
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            health === 'online'
              ? 'bg-ok'
              : health === 'degraded'
                ? 'bg-warn'
                : health === 'offline'
                  ? 'bg-danger'
                  : 'bg-line-strong',
          )}
          aria-hidden="true"
        />
        <ChevronDown className="size-3 shrink-0 text-ink-4" />
      </button>

      {open ? (
        <div className="animate-pop absolute top-full right-0 z-50 mt-1.5 w-[22rem] rounded-lg border border-line-strong bg-surface-1 shadow-pop">
          <div className="border-b border-line px-3 py-2.5">
            <p className="text-[12px] font-semibold text-ink-1">Modèle du COO</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">
              Épinglez un modèle précis, ou laissez la politique de routage décider à chaque appel.
            </p>
          </div>

          <div className="space-y-2.5 px-3 py-3">
            {data ? (
              <>
                {!data.diagnosis.ok ? (
                  <Notice tone="danger" title={data.diagnosis.headline}>
                    {data.diagnosis.detail}
                  </Notice>
                ) : null}

                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold tracking-wide text-ink-4 uppercase">Modèle</span>
                  <Select value={draft} onChange={(e) => setDraft(e.target.value)}>
                    <option value="">Routage automatique ({agent?.modelPolicy ?? 'BALANCED'})</option>
                    {data.providers.map((provider) => (
                      <optgroup
                        key={provider.id}
                        label={`${provider.name}${provider.isEnabled ? '' : ' (désactivé)'} · ${provider.healthStatus}`}
                      >
                        {provider.models.map((model) => (
                          <option key={model.id} value={model.id} disabled={!provider.isEnabled || !model.isEnabled}>
                            {model.displayName} — {(model.contextLength / 1000).toFixed(0)}k
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </label>

                {data.providers.length === 0 ? (
                  <p className="text-[11px] leading-relaxed text-ink-3">
                    Aucune passerelle configurée. Ajoutez llama.cpp ou Ollama dans Modèles → Gestion de la passerelle.
                  </p>
                ) : null}

                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <span className="flex items-center gap-1.5 text-[11px] text-ok">
                    {saved ? <Check className="size-3" /> : null}
                    {saved ? 'Assigné' : ''}
                  </span>
                  <Button variant="primary" size="sm" onClick={() => void save()} loading={saving} disabled={!dirty}>
                    Assigner
                  </Button>
                </div>
              </>
            ) : (
              <p className="py-2 text-[11.5px] text-ink-3">Passerelle injoignable.</p>
            )}
          </div>

          <a
            href="/models"
            className="flex items-center gap-1.5 border-t border-line px-3 py-2 text-[11px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1"
          >
            Gérer la passerelle et les politiques
          </a>
        </div>
      ) : null}
    </div>
  );
}

/** Read-only health chip: is there a provider that can answer right now? */
export function GatewayHealthChip({ view }: { view: AssignmentsView | null }) {
  if (!view) return null;
  const { diagnosis } = view;
  const tone = diagnosis.ok ? 'ok' : diagnosis.reason === 'offline' ? 'danger' : 'warn';
  return (
    <span
      title={diagnosis.detail}
      className={cn(
        'hidden items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase sm:inline-flex',
        tone === 'ok'
          ? 'border-ok/28 bg-ok/14 text-ok'
          : tone === 'danger'
            ? 'border-danger/28 bg-danger/14 text-danger'
            : 'border-warn/28 bg-warn/14 text-warn',
      )}
    >
      <span className="size-1.5 animate-pulse-dot rounded-full bg-current" />
      {diagnosis.headline}
    </span>
  );
}
