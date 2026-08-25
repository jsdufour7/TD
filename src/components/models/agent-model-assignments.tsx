'use client';

import { useState } from 'react';
import { Check, Cpu, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/ui';
import { Badge, Button, Notice, Select } from '@/components/ui/primitives';
import type { AssignmentsView } from '@/ai/assignments-view';

/**
 * Agent → model assignments (§23).
 *
 * One row per agent: the policy it would use by default, the model actually
 * pinned (if any), and a select that changes it immediately. The server renders
 * the first state, so the table is correct before any script runs. Assigning is
 * data — no deploy — and clearing the select hands the decision back to the
 * router.
 */
export function AgentModelAssignments({
  initial,
  className,
}: {
  initial: AssignmentsView;
  className?: string;
}) {
  const [data, setData] = useState<AssignmentsView>(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.agents.map((a) => [a.key, a.binding?.modelId ?? ''])),
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  async function load() {
    const res = await fetch('/api/gateway/bindings', { cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as AssignmentsView;
    setData(body);
    setDrafts(Object.fromEntries(body.agents.map((a) => [a.key, a.binding?.modelId ?? ''])));
  }

  async function save(agentKey: string, modelId: string) {
    setSaving(agentKey);
    try {
      const res = await fetch('/api/gateway/bindings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentKey, modelId: modelId || null }),
      });
      if (res.ok) {
        setSaved(agentKey);
        window.setTimeout(() => setSaved((s) => (s === agentKey ? null : s)), 1600);
        await load();
      }
    } finally {
      setSaving(null);
    }
  }

  const visible = data.agents.filter(
    (a) =>
      !filter.trim() ||
      a.name.toLowerCase().includes(filter.toLowerCase()) ||
      a.key.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className={cn('space-y-3', className)}>
      {!data.diagnosis.ok ? (
        <div className="px-4 pt-4">
          <Notice tone="danger" title={data.diagnosis.headline}>
            {data.diagnosis.detail}
          </Notice>
        </div>
      ) : (
        <div className="px-4 pt-4">
          <Notice tone="ok" title={data.diagnosis.headline}>
            {data.diagnosis.detail}
          </Notice>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 px-4">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrer les agents…"
          className="h-8 w-full max-w-xs rounded-md border border-line bg-surface-2 px-2.5 text-[12px] text-ink-1 placeholder:text-ink-4 focus:border-accent focus:outline-none"
        />
        <Button size="sm" variant="ghost" onClick={() => void load()}>
          <RefreshCw className="size-3.5" />
          Actualiser
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[38rem] text-left">
          <thead>
            <tr className="border-y border-line bg-surface-0/40 text-[10px] tracking-wide text-ink-4 uppercase">
              <th className="px-4 py-2 font-semibold">Agent</th>
              <th className="px-3 py-2 font-semibold">Politique par défaut</th>
              <th className="px-3 py-2 font-semibold">Modèle assigné</th>
              <th className="px-3 py-2 text-right font-semibold">État</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visible.map((agent) => {
              const draft = drafts[agent.key] ?? '';
              const current = agent.binding?.modelId ?? '';
              const dirty = draft !== current;
              return (
                <tr key={agent.key} className="transition-colors hover:bg-surface-2/50">
                  <td className="px-4 py-2.5">
                    <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-1">
                      {agent.key === 'coo' ? <Cpu className="size-3.5 text-accent" /> : null}
                      {agent.name}
                    </p>
                    <p className="text-[10.5px] text-ink-4">{agent.role}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone="idle">{agent.modelPolicy}</Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <Select
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [agent.key]: e.target.value }))}
                      className="h-8 min-w-[13rem] py-1 text-[12px]"
                    >
                      <option value="">Routage automatique</option>
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
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {saved === agent.key ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-ok">
                        <Check className="size-3.5" /> Assigné
                      </span>
                    ) : dirty ? (
                      <Button size="xs" variant="primary" loading={saving === agent.key} onClick={() => void save(agent.key, draft)}>
                        Assigner
                      </Button>
                    ) : agent.binding?.model ? (
                      <Badge tone={agent.binding.model.providerHealth === 'online' ? 'ok' : 'warn'}>
                        {agent.binding.model.providerKey}
                      </Badge>
                    ) : (
                      <span className="text-[11px] text-ink-4">auto</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="flex items-center gap-1.5 px-4 pb-4 text-[11px] text-ink-4">
        <Loader2 className={cn('size-3', saving ? 'animate-spin' : 'hidden')} />
        Une assignation épingle un modèle précis pour cet agent ; « Routage automatique » rend la main à la politique.
      </p>
    </div>
  );
}
