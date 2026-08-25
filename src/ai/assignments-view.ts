import { asc } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { listBindings, WILDCARD_AGENT } from '@/ai/bindings';
import { ROUTING_POLICIES } from '@/ai/router';
import { diagnoseGateway, probeRouting } from '@/ai/diagnostics';

/**
 * One query surface for the assignment UI (§23).
 *
 * Shared by the API route and the server components that render the same
 * controls, so a page and its endpoint can never disagree about what the
 * gateway looks like.
 */
export async function getAssignmentsView(organizationId: string) {
  const db = await getDb();

  const [agents, providers, models, bindings, diagnosis] = await Promise.all([
    db
      .select({
        key: schema.agentDefinitions.key,
        name: schema.agentDefinitions.name,
        role: schema.agentDefinitions.role,
        modelPolicy: schema.agentDefinitions.modelPolicy,
      })
      .from(schema.agentDefinitions)
      .orderBy(asc(schema.agentDefinitions.sortOrder)),
    db.select().from(schema.modelProviders),
    db.select().from(schema.modelDefinitions),
    listBindings(organizationId),
    diagnoseGateway(),
  ]);

  const bindingByAgent = new Map(bindings.map((b) => [b.agentKey, b]));
  const cooBinding = bindingByAgent.get('coo') ?? null;

  const cooProbe = await probeRouting({
    policy: cooBinding?.modelId ? 'MANUAL' : (cooBinding?.policy ?? 'BALANCED'),
    manualModelId: cooBinding?.modelId ?? null,
  });

  return {
    agents: agents.map((a) => ({ ...a, binding: bindingByAgent.get(a.key) ?? null })),
    defaultBinding: bindingByAgent.get(WILDCARD_AGENT) ?? null,
    providers: providers.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      baseUrl: p.baseUrl,
      isEnabled: p.isEnabled,
      healthStatus: p.healthStatus,
      healthMessage: p.healthMessage,
      models: models
        .filter((m) => m.providerId === p.id)
        .map((m) => ({
          id: m.id,
          modelKey: m.modelKey,
          displayName: m.displayName,
          contextLength: m.contextLength,
          supportsTools: m.supportsTools,
          reasoningTier: m.reasoningTier,
          isEnabled: m.isEnabled,
        })),
    })),
    policies: ROUTING_POLICIES,
    diagnosis,
    cooProbe,
  };
}

export type AssignmentsView = Awaited<ReturnType<typeof getAssignmentsView>>;

/** The label a compact chip should show before any data is fetched. */
export function cooModelLabel(view: AssignmentsView | null): string {
  if (!view) return 'Modèle';
  const coo = view.agents.find((a) => a.key === 'coo');
  return coo?.binding?.model?.displayName ?? `Routage ${coo?.binding?.policy ?? coo?.modelPolicy ?? 'BALANCED'}`;
}

export function cooModelHealth(view: AssignmentsView | null): string {
  const coo = view?.agents.find((a) => a.key === 'coo');
  return coo?.binding?.model?.providerHealth ?? 'unknown';
}

export function gatewayOk(view: AssignmentsView | null): boolean {
  return Boolean(view?.diagnosis.ok);
}
