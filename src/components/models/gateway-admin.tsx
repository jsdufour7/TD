'use client';

import { useCallback, useState } from 'react';
import { Badge, Button, EmptyState, Field, inputClass } from '@/components/ui/primitives';

type GatewayModel = {
  id: string;
  modelKey: string;
  displayName: string;
  contextLength: number;
  supportsTools: boolean;
  supportsVision: boolean;
  reasoningTier: string;
  codingTier: string;
  isEnabled: boolean;
};

type GatewayProvider = {
  id: string;
  key: string;
  name: string;
  kind: string;
  baseUrl: string;
  isLocal: boolean;
  isPrivate: boolean;
  isEnabled: boolean;
  healthStatus: string;
  healthMessage: string | null;
  healthLatencyMs: number | null;
  credentialConfigured: boolean;
  models: GatewayModel[];
};

type GatewayRoute = { id: string; policy: string; modelId: string; isEnabled: boolean; model: string };

const POLICIES = ['FAST', 'BALANCED', 'BEST', 'LOCAL_ONLY', 'PRIVACY_FIRST', 'LOW_COST', 'CODING_MAX', 'MANUAL'];

const PRESETS: Array<{ label: string; key: string; baseUrl: string; hint: string }> = [
  { label: 'llama.cpp (server)', key: 'llama-cpp', baseUrl: 'http://127.0.0.1:8080/v1', hint: 'llama-server --port 8080' },
  { label: 'Ollama', key: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', hint: 'ollama serve' },
  { label: 'vLLM', key: 'vllm', baseUrl: 'http://127.0.0.1:8000/v1', hint: 'python -m vllm.entrypoints.openai.api_server' },
];

/**
 * Gateway administration: add / edit / remove local and hosted providers,
 * discover their models, manage keys (encrypted) and assign routing policies.
 * All rules and mutations are enforced server-side; this only presents.
 */
export function GatewayAdmin({
  initial,
}: {
  initial: { providers: GatewayProvider[]; routes: GatewayRoute[] };
}) {
  const [providers, setProviders] = useState<GatewayProvider[]>(initial.providers);
  const [routes, setRoutes] = useState<GatewayRoute[]>(initial.routes);
  const [loaded, setLoaded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/gateway/providers', { cache: 'no-store' });
    const body = (await res.json()) as { providers?: GatewayProvider[]; routes?: GatewayRoute[] };
    if (res.ok && body.providers) {
      setProviders(body.providers);
      setRoutes(body.routes ?? []);
    }
    setLoaded(true);
  }, []);

  async function run(key: string, fn: () => Promise<Response>, success?: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fn();
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? 'Operation failed');
        return null;
      }
      await load();
      if (success) setNotice(success);
      return (await res.clone().json()) as Record<string, unknown>;
    } catch {
      setError('Network error');
      return null;
    } finally {
      setBusy(null);
    }
  }

  const allModels = providers.flatMap((p) => p.models.map((m) => ({ ...m, provider: p.name })));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-ink-3">
          Ajoutez une passerelle locale (llama.cpp, Ollama, vLLM) ou hébergée. Les clés sont
          chiffrées au repos; seule une empreinte est affichée.
        </p>
        <Button variant="primary" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? 'Fermer' : 'Ajouter une passerelle'}
        </Button>
      </div>

      {notice ? (
        <p className="rounded border border-ok/30 bg-ok/10 px-3 py-2 text-xs text-ok">{notice}</p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {showAdd ? (
        <AddProviderForm
          busy={busy === 'add'}
          onSubmit={async (values) => {
            const r = await run('add', () =>
              fetch('/api/gateway/providers', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(values),
              }),
            );
            if (r) setShowAdd(false);
          }}
        />
      ) : null}

      {!loaded ? (
        <EmptyState compact title="Chargement…" />
      ) : providers.length === 0 ? (
        <EmptyState
          compact
          title="Aucune passerelle"
          description="Ajoutez llama.cpp, Ollama ou un provider hébergé pour activer la boucle d'outils LLM."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              busy={busy}
              onHealth={() => run(`health-${provider.id}`, () => fetch(`/api/gateway/providers/${provider.id}/health`, { method: 'POST' }))}
              onDiscover={async () => {
                const r = await run(`discover-${provider.id}`, () =>
                  fetch(`/api/gateway/providers/${provider.id}/discover`, { method: 'POST' }),
                );
                const models = (r?.models as string[]) ?? [];
                if (models.length === 0) {
                  setError(`Aucun modèle découvert sur ${provider.name}. Ajoutez-les manuellement.`);
                } else {
                  for (const key of models) {
                    await fetch(`/api/gateway/providers/${provider.id}/models`, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ modelKey: key, supportsTools: provider.kind === 'openai_compatible' }),
                    });
                  }
                  await load();
                  setNotice(`${models.length} modèle(s) ajouté(s) depuis ${provider.name}.`);
                }
              }}
              onAddModel={(values) =>
                run(`model-${provider.id}`, () =>
                  fetch(`/api/gateway/providers/${provider.id}/models`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(values),
                  }),
                )
              }
              onDeleteModel={(modelId) => run(`delmodel-${modelId}`, () => fetch(`/api/gateway/models/${modelId}`, { method: 'DELETE' }))}
              onDelete={() => run(`del-${provider.id}`, () => fetch(`/api/gateway/providers/${provider.id}`, { method: 'DELETE' }))}
              onToggle={(enabled) =>
                run(`toggle-${provider.id}`, () =>
                  fetch(`/api/gateway/providers/${provider.id}`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ isEnabled: enabled }),
                  }),
                )
              }
            />
          ))}
        </div>
      )}

      <section className="rounded-lg border border-line bg-surface-1">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-medium">Politiques de routage</h2>
          <p className="text-[11px] text-ink-3">
            Orientez chaque politique vers un modèle. LOCAL_ONLY ne bascule jamais vers un provider hébergé.
          </p>
        </header>
        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {POLICIES.map((policy) => {
            const route = routes.find((r) => r.policy === policy);
            return (
              <label key={policy} className="space-y-1">
                <span className="font-mono text-[11px] text-accent">{policy}</span>
                <select
                  className={inputClass}
                  value={route?.modelId ?? ''}
                  onChange={(e) =>
                    e.target.value &&
                    void run(`route-${policy}`, () =>
                      fetch('/api/gateway/routes', {
                        method: 'PATCH',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ policy, modelId: e.target.value }),
                      }),
                    )
                  }
                >
                  <option value="">— aucun —</option>
                  {allModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.provider} / {m.displayName}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ProviderCard({
  provider,
  busy,
  onHealth,
  onDiscover,
  onAddModel,
  onDeleteModel,
  onDelete,
  onToggle,
}: {
  provider: GatewayProvider;
  busy: string | null;
  onHealth: () => void;
  onDiscover: () => void;
  onAddModel: (values: Record<string, unknown>) => void;
  onDeleteModel: (modelId: string) => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const [addingModel, setAddingModel] = useState(false);
  const [modelKey, setModelKey] = useState('');

  return (
    <div className="rounded-lg border border-line bg-surface-1">
      <header className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[13px] font-medium">{provider.name}</h3>
            <Badge tone={toneForHealth(provider.healthStatus)} dot={provider.healthStatus === 'online'}>
              {provider.healthStatus}
            </Badge>
            {provider.isLocal ? <Badge tone="info">local</Badge> : null}
          </div>
          <p className="mt-0.5 truncate font-mono text-[10.5px] text-ink-4">{provider.baseUrl}</p>
          <p className="text-[10.5px] text-ink-4">
            {provider.kind}
            {provider.credentialConfigured ? ' · clé configurée' : ' · sans clé'}
            {provider.healthLatencyMs !== null ? ` · ${provider.healthLatencyMs}ms` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button size="xs" onClick={() => onToggle(!provider.isEnabled)}>
            {provider.isEnabled ? 'Désactiver' : 'Activer'}
          </Button>
          <Button size="xs" variant="danger" loading={busy === `del-${provider.id}`} onClick={onDelete}>
            Supprimer
          </Button>
        </div>
      </header>

      <div className="space-y-2 p-4">
        <div className="flex gap-2">
          <Button size="xs" loading={busy === `health-${provider.id}`} onClick={onHealth}>
            Tester la connexion
          </Button>
          <Button size="xs" variant="outline" loading={busy === `discover-${provider.id}`} onClick={onDiscover}>
            Découvrir les modèles
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setAddingModel((v) => !v)}>
            + modèle
          </Button>
        </div>

        {addingModel ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!modelKey) return;
              onAddModel({ modelKey, supportsTools: provider.kind === 'openai_compatible' });
              setModelKey('');
              setAddingModel(false);
            }}
          >
            <input
              className={inputClass}
              placeholder="model-key, ex: llama-3.1-8b-instant"
              value={modelKey}
              onChange={(e) => setModelKey(e.target.value)}
            />
            <Button type="submit" size="sm">
              Ajouter
            </Button>
          </form>
        ) : null}

        {provider.models.length === 0 ? (
          <p className="text-[11px] text-ink-4">Aucun modèle. Utilisez « Découvrir » ou ajoutez-en un.</p>
        ) : (
          <ul className="space-y-1">
            {provider.models.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-[11.5px]">
                <span className="min-w-0 flex-1 truncate font-mono text-ink-2">{m.modelKey}</span>
                <span className="text-[10px] text-ink-4">{Math.round(m.contextLength / 1000)}k</span>
                {m.supportsTools ? <span className="text-[10px] text-ok">tools</span> : null}
                <button
                  type="button"
                  className="text-[10px] text-danger hover:underline"
                  onClick={() => onDeleteModel(m.id)}
                >
                  retirer
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AddProviderForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [isLocal, setIsLocal] = useState(true);

  return (
    <form
      className="space-y-4 rounded-lg border border-line bg-surface-1 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({ key, name, baseUrl, apiKey: apiKey || undefined, isLocal, isPrivate: isLocal, kind: 'openai_compatible' });
      }}
    >
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            className="rounded border border-line bg-surface-2 px-2 py-1 text-[11px] text-ink-2 hover:border-accent/40"
            onClick={() => {
              setKey(preset.key);
              setName(preset.label);
              setBaseUrl(preset.baseUrl);
              setIsLocal(true);
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Clé (slug)" required>
          <input className={inputClass} value={key} onChange={(e) => setKey(e.target.value)} placeholder="llama-cpp" required />
        </Field>
        <Field label="Nom" required>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="llama.cpp local" required />
        </Field>
      </div>
      <Field label="URL de base" required hint="llama.cpp : http://127.0.0.1:8080/v1 · Ollama : http://127.0.0.1:11434/v1">
        <input className={inputClass} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://127.0.0.1:8080/v1" required />
      </Field>
      <Field label="Clé API (optionnel)" hint="Laissez vide pour un serveur local. Stockée chiffrée.">
        <input className={inputClass} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-[12px] text-ink-2">
        <input type="checkbox" checked={isLocal} onChange={(e) => setIsLocal(e.target.checked)} />
        Passerelle locale (le trafic ne quitte pas la machine)
      </label>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={busy}>
          Enregistrer la passerelle
        </Button>
      </div>
    </form>
  );
}

function toneForHealth(status: string): string {
  switch (status) {
    case 'online':
      return 'ok';
    case 'degraded':
      return 'warn';
    case 'offline':
      return 'danger';
    default:
      return 'idle';
  }
}
