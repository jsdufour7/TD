import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { AppError } from '@/lib/errors';
import { resolveModel, type RoutingPolicy } from './router';

/**
 * Gateway diagnostics.
 *
 * When the COO cannot reason, "configure a provider" is not an answer — the
 * operator needs to know *which* provider, at *what* address, and *why* it was
 * refused. Everything here is read from the database and from the providers'
 * own last health check; nothing is invented.
 */

export type ProviderSnapshot = {
  key: string;
  name: string;
  baseUrl: string;
  isEnabled: boolean;
  healthStatus: string;
  healthMessage: string | null;
  lastHealthAt: string | null;
  modelCount: number;
  credentialConfigured: boolean;
};

export type GatewayDiagnosis = {
  ok: boolean;
  /** no_provider | provider_disabled | no_model | offline | ok */
  reason: 'no_provider' | 'provider_disabled' | 'no_model' | 'offline' | 'ok';
  headline: string;
  detail: string;
  providers: ProviderSnapshot[];
  totalModels: number;
  enabledModels: number;
};

export async function diagnoseGateway(): Promise<GatewayDiagnosis> {
  const db = await getDb();
  const providers = await db.select().from(schema.modelProviders);
  const models = await db.select().from(schema.modelDefinitions);
  const credentials = await db.select().from(schema.credentialReferences);
  const credById = new Map(credentials.map((c) => [c.id, c]));

  const snapshots: ProviderSnapshot[] = providers.map((p) => ({
    key: p.key,
    name: p.name,
    baseUrl: p.baseUrl,
    isEnabled: p.isEnabled,
    healthStatus: p.healthStatus,
    healthMessage: p.healthMessage,
    lastHealthAt: p.lastHealthAt?.toISOString() ?? null,
    modelCount: models.filter((m) => m.providerId === p.id).length,
    credentialConfigured: p.credentialId ? Boolean(credById.get(p.credentialId)?.fingerprint) : false,
  }));

  const enabled = snapshots.filter((p) => p.isEnabled);
  const enabledModels = models.filter(
    (m) => m.isEnabled && providers.some((p) => p.id === m.providerId && p.isEnabled),
  );

  const base = {
    providers: snapshots,
    totalModels: models.length,
    enabledModels: enabledModels.length,
  };

  if (snapshots.length === 0) {
    return {
      ...base,
      ok: false,
      reason: 'no_provider',
      headline: 'Aucune passerelle configurée',
      detail:
        'Aucun provider n’existe dans la passerelle. Ajoutez llama.cpp, Ollama ou un provider hébergé dans Models → Gestion de la passerelle.',
    };
  }

  if (enabled.length === 0) {
    const withCredential = snapshots.filter((p) => p.credentialConfigured).length;
    return {
      ...base,
      ok: false,
      reason: 'provider_disabled',
      headline: 'Passerelle désactivée',
      detail:
        `${snapshots.length} passerelle(s) configurée(s) mais aucune n’est active` +
        ` (${withCredential} avec une clé enregistrée). ` +
        'Activez-en une dans Models, ou ajoutez votre endpoint local (llama.cpp / Ollama) — un endpoint local ne demande aucune clé.',
    };
  }

  if (enabledModels.length === 0) {
    return {
      ...base,
      ok: false,
      reason: 'no_model',
      headline: 'Aucun modèle disponible',
      detail:
        'Le provider est actif mais ne liste aucun modèle. Lancez « Découvrir les modèles » depuis Models → Gestion de la passerelle.',
    };
  }

  const online = enabled.filter((p) => p.healthStatus === 'online');
  if (online.length === 0) {
    const first = enabled[0]!;
    return {
      ...base,
      ok: false,
      reason: 'offline',
      headline: 'Passerelle injoignable',
      detail: [
        `Aucun provider en ligne. Dernier état de ${first.name} (${first.baseUrl}) : ${first.healthStatus}${
          first.healthMessage ? ` — ${first.healthMessage}` : ''
        }.`,
        'Vérifiez que le serveur de modèles tourne et que cette adresse est joignable depuis la machine où AI Core s’exécute.',
      ].join(' '),
    };
  }

  return {
    ...base,
    ok: true,
    reason: 'ok',
    headline: `${online.length} provider(s) en ligne`,
    detail: online.map((p) => `${p.name} (${p.baseUrl})`).join(', '),
  };
}

/**
 * Try to resolve a model the way a real call would. Returns the provider/model
 * that would be used, or the precise reason it cannot be.
 */
export async function probeRouting(input: {
  policy: RoutingPolicy;
  manualModelId?: string | null;
  requiresTools?: boolean;
}): Promise<
  | { ok: true; providerKey: string; modelKey: string; displayName: string; resolvedVia: string; fellBack: boolean }
  | { ok: false; code: string; message: string }
> {
  try {
    const resolved = await resolveModel(input.policy === 'MANUAL' && input.manualModelId ? 'MANUAL' : input.policy, {
      manualModelId: input.manualModelId,
      requiresTools: input.requiresTools,
    });
    return {
      ok: true,
      providerKey: resolved.providerKey,
      modelKey: resolved.modelKey,
      displayName: resolved.displayName,
      resolvedVia: resolved.resolvedVia,
      fellBack: resolved.fellBack,
    };
  } catch (error) {
    const code = error instanceof AppError ? error.code : 'error';
    return { ok: false, code, message: error instanceof Error ? error.message : String(error) };
  }
}

/** The model currently pinned for an agent, when the operator assigned one. */
export async function boundModelLabel(agentKey: string, organizationId: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db
    .select({
      modelKey: schema.modelDefinitions.modelKey,
      displayName: schema.modelDefinitions.displayName,
      providerKey: schema.modelProviders.key,
    })
    .from(schema.agentModelBindings)
    .innerJoin(schema.modelDefinitions, eq(schema.modelDefinitions.id, schema.agentModelBindings.modelId))
    .innerJoin(schema.modelProviders, eq(schema.modelProviders.id, schema.modelDefinitions.providerId))
    .where(eq(schema.agentModelBindings.agentKey, agentKey))
    .limit(1);
  void organizationId;
  const row = rows[0];
  return row ? `${row.providerKey}/${row.modelKey}` : null;
}
