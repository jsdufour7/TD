import { getDb, schema } from '@/db/client';
import { getCurrentUser } from '@/auth/session';
import { Badge, Card, EmptyState, Stat } from '@/components/ui/primitives';
import { toneFor, formatCost, formatTokens, timeAgo } from '@/lib/ui';
import { Cpu } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { AgentModelAssignments } from '@/components/models/agent-model-assignments';
import { ProviderHealth } from '@/components/work/provider-health';
import { ROUTING_POLICIES } from '@/ai/router';
import { usageSummary } from '@/ai/router';
import { GatewayAdmin } from '@/components/models/gateway-admin';
import { getAssignmentsView } from '@/ai/assignments-view';
import { serializeGateway } from '@/app/api/gateway/providers/route';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Models' };

/**
 * Model gateway (§21–§23, §42).
 *
 * Providers and routing are data, not code. Credentials are shown only as a
 * fingerprint — the plaintext never reaches this page.
 */
export default async function ModelsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const db = await getDb();
  const [providers, models, routes, credentials, usage] = await Promise.all([
    db.select().from(schema.modelProviders),
    db.select().from(schema.modelDefinitions),
    db.select().from(schema.modelRoutes),
    db.select().from(schema.credentialReferences),
    usageSummary(),
  ]);

  const credentialById = new Map(credentials.map((c) => [c.id, c]));
  const online = providers.filter((p) => p.healthStatus === 'online').length;
  const isAdmin = user.role === 'owner' || user.role === 'admin';
  const gateway = isAdmin ? await serializeGateway(db) : null;
  const assignmentsView = await getAssignmentsView(user.organizationId);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-5 lg:p-7">
      <PageHeader
        title="Modèles"
        subtitle="Passerelle, assignation par agent, politiques de routage et usage réel. Ajouter un provider est un changement de données, pas un déploiement."
        icon={<Cpu className="size-4" />}
        action={<ProviderHealth />}
      />

      <Card
        title="Modèle assigné au COO et aux agents"
        description="Épinglez un modèle précis par agent, ou laissez la politique de routage décider à chaque appel."
      >
        <AgentModelAssignments initial={assignmentsView} />
      </Card>

      {isAdmin && gateway ? (
        <Card title="Gestion de la passerelle" description="Ajoutez llama.cpp / Ollama / un provider hébergé, découvrez leurs modèles, gérez clés et politiques.">
          <div className="p-4">
            <GatewayAdmin initial={gateway} />
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Passerelles" value={providers.length} />
        <Stat label="En ligne" value={online} tone={online > 0 ? 'ok' : 'idle'} />
        <Stat label="Appels modèle" value={usage.totalCalls} />
        <Stat
          label="Coût total"
          value={formatCost(usage.totalCostUsd)}
          hint={`${formatTokens(usage.totalInputTokens + usage.totalOutputTokens)} jetons`}
        />
      </div>

      {providers.length === 0 ? (
        <Card>
          <div className="p-6">
            <EmptyState
              title="Aucune passerelle enregistrée"
              description="Ajoutez llama.cpp ou Ollama ci-dessus, lancez « npm run db:seed » pour les providers par défaut, ou pointez LOCAL_MODEL_BASE_URL vers un endpoint OpenAI-compatible local (ex. http://127.0.0.1:8080/v1)."
            />
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {providers.map((provider) => {
            const credential = provider.credentialId ? credentialById.get(provider.credentialId) : undefined;
            const providerModels = models.filter((m) => m.providerId === provider.id);

            return (
              <Card
                key={provider.id}
                title={provider.name}
                description={provider.baseUrl}
                action={
                  <div className="flex items-center gap-1.5">
                    {provider.isLocal ? <Badge tone="info">local</Badge> : null}
                    {provider.isPrivate ? <Badge tone="ok">private</Badge> : null}
                    <Badge tone={toneFor(provider.healthStatus)} dot={provider.healthStatus === 'online'}>
                      {provider.healthStatus}
                    </Badge>
                  </div>
                }
              >
                <div className="space-y-3 p-4">
                  <div className="grid gap-2 text-[11.5px] sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <p className="text-[10px] tracking-wide text-ink-4 uppercase">Protocol</p>
                      <p className="font-mono text-ink-2">{provider.kind}</p>
                    </div>
                    <div>
                      <p className="text-[10px] tracking-wide text-ink-4 uppercase">Credential</p>
                      <p className="font-mono text-ink-2">
                        {credential?.fingerprint ?? 'none configured'}
                        {credential?.envVar ? <span className="text-ink-4"> ({credential.envVar})</span> : null}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] tracking-wide text-ink-4 uppercase">Latency</p>
                      <p className="font-mono text-ink-2">
                        {provider.healthLatencyMs !== null ? `${provider.healthLatencyMs}ms` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] tracking-wide text-ink-4 uppercase">Last check</p>
                      <p className="text-ink-2">
                        {provider.lastHealthAt ? timeAgo(provider.lastHealthAt.toISOString()) : 'never'}
                      </p>
                    </div>
                  </div>

                  {provider.healthMessage ? (
                    <p
                      className={`rounded border px-2.5 py-1.5 text-[11px] ${
                        provider.healthStatus === 'online'
                          ? 'border-line bg-surface-2 text-ink-3'
                          : provider.healthStatus === 'offline'
                            ? 'border-danger/30 bg-danger/10 text-danger'
                            : 'border-warn/30 bg-warn/10 text-warn'
                      }`}
                    >
                      {provider.healthMessage}
                    </p>
                  ) : null}

                  {!provider.isEnabled ? (
                    <p className="text-[11px] text-ink-4">
                      Disabled. Routing skips this provider entirely.
                    </p>
                  ) : null}

                  {providerModels.length > 0 ? (
                    <div className="overflow-x-auto rounded border border-line">
                      <table className="w-full text-left text-[11.5px]">
                        <thead className="bg-surface-2 text-[10px] tracking-wide text-ink-4 uppercase">
                          <tr>
                            <th className="px-2.5 py-1.5 font-medium">Model</th>
                            <th className="px-2.5 py-1.5 font-medium">Context</th>
                            <th className="px-2.5 py-1.5 font-medium">Tools</th>
                            <th className="px-2.5 py-1.5 font-medium">Reasoning</th>
                            <th className="px-2.5 py-1.5 font-medium">Coding</th>
                            <th className="px-2.5 py-1.5 font-medium">Cost /1M</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {providerModels.map((model) => (
                            <tr key={model.id}>
                              <td className="px-2.5 py-1.5">
                                <p className="text-ink-1">{model.displayName}</p>
                                <p className="font-mono text-[10px] text-ink-4">{model.modelKey}</p>
                              </td>
                              <td className="px-2.5 py-1.5 font-mono text-ink-2">{(model.contextLength / 1000).toFixed(0)}k</td>
                              <td className="px-2.5 py-1.5">{model.supportsTools ? <span className="text-ok">yes</span> : <span className="text-ink-4">no</span>}</td>
                              <td className="px-2.5 py-1.5 text-ink-2">{model.reasoningTier}</td>
                              <td className="px-2.5 py-1.5 text-ink-2">{model.codingTier}</td>
                              <td className="px-2.5 py-1.5 font-mono text-ink-2">
                                ${model.costInputPerMtok} / ${model.costOutputPerMtok}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-[11px] text-ink-4">No models registered for this provider.</p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card
        title="Politiques de routage"
        description="Le routeur résout une politique en modèle à l’exécution, ignore les passerelles hors ligne et applique le repli prévu. LOCAL_ONLY ne bascule jamais vers un provider hébergé."
      >
        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {ROUTING_POLICIES.map((policy) => {
            const route = routes.find((r) => r.policy === policy);
            const model = route ? models.find((m) => m.id === route.modelId) : undefined;
            const provider = model ? providers.find((p) => p.id === model.providerId) : undefined;
            return (
              <div key={policy} className="rounded border border-line bg-surface-2 p-2.5">
                <p className="font-mono text-[11px] text-accent">{policy}</p>
                <p className="mt-0.5 truncate text-[11.5px] text-ink-1">{model?.displayName ?? 'no model bound'}</p>
                <p className="truncate font-mono text-[10px] text-ink-4">{provider?.key ?? '—'}</p>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Usage par modèle" description="Enregistré à partir des réponses réelles des providers">
        {usage.byModel.length === 0 ? (
          <div className="p-4">
            <EmptyState compact title="Aucun usage enregistré" description="Les modèles locaux enregistrent le temps d’exécution, à coût nul." />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {usage.byModel.map((entry) => (
              <li key={entry.model} className="flex flex-wrap items-center gap-2 px-4 py-2 font-mono text-[11px]">
                <span className="min-w-0 flex-1 truncate text-ink-1">{entry.model}</span>
                <span className="text-ink-4">{entry.calls} calls</span>
                <span className="text-ink-4">{formatTokens(entry.inputTokens)} in</span>
                <span className="text-ink-4">{formatTokens(entry.outputTokens)} out</span>
                <span className="text-ink-2">{formatCost(entry.costUsd)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
