import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { AppError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { resolveCredential } from './credentials';
import { estimateCostUsd, type ChatMessage, type ModelProvider, type ToolSpec } from './provider';
import { OpenAICompatibleProvider } from './providers/openai-compatible';
import { AnthropicProvider } from './providers/anthropic';

const log = createLogger('model-router');

/**
 * Model routing (§23).
 *
 * Routing is data: `model_routes` maps a policy to a model at a priority, so
 * "the best model" can be changed without a deploy. Resolution walks the policy
 * chain, skips providers that are disabled or known-offline, and falls back
 * according to policy. LOCAL_ONLY deliberately does not fall back to a hosted
 * provider — that is the entire point of the policy.
 */

export const ROUTING_POLICIES = [
  'FAST',
  'BALANCED',
  'BEST',
  'LOCAL_ONLY',
  'PRIVACY_FIRST',
  'LOW_COST',
  'CODING_MAX',
  'MANUAL',
] as const;

export type RoutingPolicy = (typeof ROUTING_POLICIES)[number];

export type ResolvedModel = {
  provider: ModelProvider;
  providerKey: string;
  modelId: string;
  modelKey: string;
  displayName: string;
  contextLength: number;
  supportsTools: boolean;
  costInputPerMtok: string;
  costOutputPerMtok: string;
  /** Which policy actually produced this model (may be a fallback). */
  resolvedVia: RoutingPolicy;
  fellBack: boolean;
};

/** Short-lived health cache so routing does not probe on every call. */
const healthCache = new Map<string, { status: string; at: number }>();
const HEALTH_TTL_MS = 60_000;

export function buildProvider(row: {
  key: string;
  kind: string;
  baseUrl: string;
  name: string;
}, apiKey: string | null): ModelProvider {
  if (row.kind === 'anthropic') {
    return new AnthropicProvider(row.key, row.baseUrl, apiKey, row.name);
  }
  return new OpenAICompatibleProvider(row.key, row.baseUrl, apiKey, row.name);
}

type ProviderWithModels = {
  provider: ModelProvider;
  row: typeof schema.modelProviders.$inferSelect;
  models: Array<typeof schema.modelDefinitions.$inferSelect>;
};

async function loadProviders(): Promise<ProviderWithModels[]> {
  const db = await getDb();
  const providers = await db
    .select()
    .from(schema.modelProviders)
    .where(eq(schema.modelProviders.isEnabled, true));

  const result: ProviderWithModels[] = [];
  for (const row of providers) {
    // A provider with no credential has credentialId NULL; passing '' to a
    // UUID column is a cast error (code 22P02). Query only when one exists.
    const credential = row.credentialId
      ? await db
          .select()
          .from(schema.credentialReferences)
          .where(eq(schema.credentialReferences.id, row.credentialId))
          .limit(1)
      : [];
    const resolved = await resolveCredential(credential[0]);
    const provider = buildProvider(row, resolved?.value ?? null);

    const models = await db
      .select()
      .from(schema.modelDefinitions)
      .where(and(eq(schema.modelDefinitions.providerId, row.id), eq(schema.modelDefinitions.isEnabled, true)));

    if (models.length > 0) result.push({ provider, row, models });
  }
  return result;
}

function cachedHealth(providerKey: string): string | null {
  const entry = healthCache.get(providerKey);
  if (!entry) return null;
  if (Date.now() - entry.at > HEALTH_TTL_MS) return null;
  return entry.status;
}

export function invalidateHealthCache(providerKey?: string): void {
  if (providerKey) healthCache.delete(providerKey);
  else healthCache.clear();
}

/**
 * Resolve a model for a policy.
 *
 * Throws `provider_offline` when nothing usable exists, so callers surface a
 * real "no model available" state instead of silently degrading.
 */
export async function resolveModel(
  policy: RoutingPolicy,
  options: {
    manualModelId?: string | null;
    requiresTools?: boolean;
    minContext?: number;
    allowFallback?: boolean;
  } = {},
): Promise<ResolvedModel> {
  const providers = await loadProviders();
  if (providers.length === 0) {
    throw new AppError(
      'provider_unavailable',
      'No model providers are enabled. Configure a provider in Settings → Models, or set LOCAL_MODEL_BASE_URL for a local endpoint.',
    );
  }

  const allowFallback = options.allowFallback ?? policy !== 'LOCAL_ONLY';

  const matchesConstraints = (model: (typeof schema.modelDefinitions.$inferSelect)[]): typeof model =>
    model.filter(
      (m) =>
        (!options.requiresTools || m.supportsTools) &&
        (!options.minContext || m.contextLength >= options.minContext),
    );

  // 1. MANUAL: an explicitly chosen model wins outright.
  if (policy === 'MANUAL' && options.manualModelId) {
    for (const entry of providers) {
      const model = entry.models.find((m) => m.id === options.manualModelId);
      if (model) return toResolved(entry, model, policy, false);
    }
    throw new AppError('provider_unavailable', `The selected model (${options.manualModelId}) is not available`);
  }

  // 2. Configured routes for the requested policy, in priority order.
  const chain: Array<{ policy: RoutingPolicy; fellBack: boolean }> = [{ policy, fellBack: false }];
  if (allowFallback) {
    chain.push(
      { policy: 'BALANCED', fellBack: policy !== 'BALANCED' },
      { policy: 'FAST', fellBack: true },
    );
  }

  const db = await getDb();
  for (const link of chain) {
    const routes = await db
      .select()
      .from(schema.modelRoutes)
      .where(and(eq(schema.modelRoutes.policy, link.policy), eq(schema.modelRoutes.isEnabled, true)))
      .orderBy(asc(schema.modelRoutes.priority));

    for (const route of routes) {
      for (const entry of providers) {
        const model = entry.models.find((m) => m.id === route.modelId);
        if (!model) continue;
        if (matchesConstraints([model]).length === 0) continue;
        if (await isUsable(entry)) return toResolved(entry, model, link.policy, link.fellBack);
      }
    }
  }

  // 3. Last resort: any enabled model on any usable provider.
  if (allowFallback) {
    for (const entry of providers) {
      if (!(await isUsable(entry))) continue;
      const candidates = matchesConstraints(entry.models).sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );
      if (candidates[0]) return toResolved(entry, candidates[0], policy, true);
    }
  }

  throw new AppError(
    'provider_offline',
    policy === 'LOCAL_ONLY'
      ? 'LOCAL_ONLY routing was requested but no local provider is online. Hosted fallback is disabled for this policy by design.'
      : `No usable model for policy ${policy}. All configured providers are offline or unconfigured.`,
  );
}

async function isUsable(entry: ProviderWithModels): Promise<boolean> {
  const cached = cachedHealth(entry.row.key);
  if (cached === 'offline') return false;
  if (cached === 'online') return true;
  // No fresh knowledge: trust the stored status rather than blocking on a probe.
  return entry.row.healthStatus !== 'offline';
}

function toResolved(
  entry: ProviderWithModels,
  model: typeof schema.modelDefinitions.$inferSelect,
  resolvedVia: RoutingPolicy,
  fellBack: boolean,
): ResolvedModel {
  return {
    provider: entry.provider,
    providerKey: entry.row.key,
    modelId: model.id,
    modelKey: model.modelKey,
    displayName: model.displayName,
    contextLength: model.contextLength,
    supportsTools: model.supportsTools,
    costInputPerMtok: model.costInputPerMtok,
    costOutputPerMtok: model.costOutputPerMtok,
    resolvedVia,
    fellBack,
  };
}

export type CallModelInput = {
  policy: RoutingPolicy;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  projectId?: string | null;
  runId?: string | null;
  agentInstanceId?: string | null;
  manualModelId?: string | null;
  requiresTools?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type CallModelResult = {
  content: string | null;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number };
  costUsd: string;
  durationMs: number;
  modelKey: string;
  providerKey: string;
  fellBack: boolean;
};

/**
 * Resolve a model, call it, and persist usage — in one place, so cost and token
 * accounting cannot be skipped by a caller (§42).
 */
export async function callModel(input: CallModelInput): Promise<CallModelResult> {
  const resolved = await resolveModel(input.policy, {
    manualModelId: input.manualModelId,
    requiresTools: input.requiresTools ?? Boolean(input.tools?.length),
  });

  const db = await getDb();
  let result;
  let outcome: 'ok' | 'error' | 'timeout' | 'offline' = 'ok';
  let errorMessage: string | null = null;

  try {
    result = await resolved.provider.complete({
      modelKey: resolved.modelKey,
      messages: input.messages,
      ...(input.tools ? { tools: input.tools } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    const appError = error instanceof AppError ? error : null;
    outcome = appError?.code === 'provider_offline' ? 'offline' : 'error';
    errorMessage = error instanceof Error ? error.message : String(error);
    // Record the failure so a provider that is down is visible in usage data.
    await db.insert(schema.modelUsages).values({
      projectId: input.projectId ?? null,
      runId: input.runId ?? null,
      agentInstanceId: input.agentInstanceId ?? null,
      providerKey: resolved.providerKey,
      modelKey: resolved.modelKey,
      durationMs: 0,
      costUsd: '0',
      outcome,
      errorMessage: errorMessage?.slice(0, 500) ?? null,
    });
    // Mark the provider so routing stops selecting it until it recovers.
    if (outcome === 'offline') {
      healthCache.set(resolved.providerKey, { status: 'offline', at: Date.now() });
      await db
        .update(schema.modelProviders)
        .set({ healthStatus: 'offline', healthMessage: errorMessage?.slice(0, 300) ?? 'Unreachable', lastHealthAt: new Date() })
        .where(eq(schema.modelProviders.key, resolved.providerKey));
    }
    throw error;
  }

  const costUsd = estimateCostUsd(
    result.usage.inputTokens,
    result.usage.outputTokens,
    resolved.costInputPerMtok,
    resolved.costOutputPerMtok,
  );

  await db.insert(schema.modelUsages).values({
    projectId: input.projectId ?? null,
    runId: input.runId ?? null,
    agentInstanceId: input.agentInstanceId ?? null,
    providerKey: resolved.providerKey,
    modelKey: resolved.modelKey,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cachedTokens: result.usage.cachedTokens ?? 0,
    durationMs: result.durationMs,
    costUsd,
    outcome: 'ok',
  });

  log.debug('model call completed', {
    provider: resolved.providerKey,
    model: resolved.modelKey,
    tokens: result.usage.inputTokens + result.usage.outputTokens,
    fellBack: resolved.fellBack,
  });

  return {
    content: result.content,
    toolCalls: result.toolCalls,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cachedTokens: result.usage.cachedTokens ?? 0,
    },
    costUsd,
    durationMs: result.durationMs,
    modelKey: resolved.modelKey,
    providerKey: resolved.providerKey,
    fellBack: resolved.fellBack,
  };
}

/**
 * Check every provider's health and persist the result (§22). A provider going
 * offline is recorded, never thrown — the platform must keep working.
 */
export async function checkAllProviderHealth(): Promise<
  Array<{ key: string; status: string; latencyMs: number; message: string }>
> {
  const db = await getDb();
  const providers = await db.select().from(schema.modelProviders);
  const results: Array<{ key: string; status: string; latencyMs: number; message: string }> = [];

  for (const row of providers) {
    // A provider with no credential has credentialId NULL; passing '' to a
    // UUID column is a cast error (code 22P02). Query only when one exists.
    const credential = row.credentialId
      ? await db
          .select()
          .from(schema.credentialReferences)
          .where(eq(schema.credentialReferences.id, row.credentialId))
          .limit(1)
      : [];
    const resolved = await resolveCredential(credential[0]);
    const provider = buildProvider(row, resolved?.value ?? null);

    let status = 'offline';
    let message = 'Provider is disabled';
    let latencyMs = 0;

    if (row.isEnabled) {
      const health = await provider.health();
      status = health.status;
      message = health.message;
      latencyMs = health.latencyMs;
    }

    healthCache.set(row.key, { status, at: Date.now() });
    await db
      .update(schema.modelProviders)
      .set({ healthStatus: status, healthMessage: message, healthLatencyMs: latencyMs, lastHealthAt: new Date() })
      .where(eq(schema.modelProviders.id, row.id));

    results.push({ key: row.key, status, latencyMs, message });
  }

  return results;
}

/** Usage rollup used by the cost panels. */
export async function usageSummary(filter: { projectId?: string; runId?: string } = {}) {
  const db = await getDb();
  const conditions = [];
  if (filter.projectId) conditions.push(eq(schema.modelUsages.projectId, filter.projectId));
  if (filter.runId) conditions.push(eq(schema.modelUsages.runId, filter.runId));

  const rows = await db
    .select({
      providerKey: schema.modelUsages.providerKey,
      modelKey: schema.modelUsages.modelKey,
      inputTokens: schema.modelUsages.inputTokens,
      outputTokens: schema.modelUsages.outputTokens,
      costUsd: schema.modelUsages.costUsd,
      count: schema.modelUsages.id,
    })
    .from(schema.modelUsages)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.modelUsages.createdAt));

  const byModel = new Map<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number }>();
  for (const row of rows) {
    const key = `${row.providerKey}/${row.modelKey}`;
    const existing = byModel.get(key) ?? { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    existing.calls += 1;
    existing.inputTokens += row.inputTokens;
    existing.outputTokens += row.outputTokens;
    existing.costUsd += Number.parseFloat(row.costUsd) || 0;
    byModel.set(key, existing);
  }

  return {
    totalCalls: rows.length,
    totalInputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
    totalOutputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
    totalCostUsd: rows.reduce((s, r) => s + (Number.parseFloat(r.costUsd) || 0), 0),
    byModel: [...byModel.entries()].map(([model, stats]) => ({ model, ...stats })),
  };
}
