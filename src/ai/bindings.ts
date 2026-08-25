import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { createLogger } from '@/lib/logger';
import { ROUTING_POLICIES, type CallModelInput, type RoutingPolicy } from './router';

const log = createLogger('model-bindings');

/**
 * Agent → model bindings (§23).
 *
 * A binding is the operator's explicit choice: "the COO uses *this* model".
 * It is data, it is per-organisation, and it is optional — when an agent has no
 * binding the routing policy decides, exactly as before.
 *
 * Resolution order: exact agent key → `*` (organisation default) → policy.
 */

export const WILDCARD_AGENT = '*';

export type Binding = {
  agentKey: string;
  modelId: string | null;
  policy: RoutingPolicy;
  /** Present when the pinned model still exists. */
  model?: {
    id: string;
    modelKey: string;
    displayName: string;
    providerKey: string;
    providerName: string;
    isEnabled: boolean;
    providerEnabled: boolean;
    providerHealth: string;
  };
};

function asPolicy(value: string | null | undefined): RoutingPolicy {
  return (ROUTING_POLICIES as readonly string[]).includes(value ?? '')
    ? (value as RoutingPolicy)
    : 'BALANCED';
}

/** Look up the org for a project so callers that only have a projectId work. */
async function orgForProject(projectId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db
    .select({ organizationId: schema.projects.organizationId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return row[0]?.organizationId ?? null;
}

export async function listBindings(organizationId: string): Promise<Binding[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.agentModelBindings)
    .where(eq(schema.agentModelBindings.organizationId, organizationId));

  const models = await db.select().from(schema.modelDefinitions);
  const providers = await db.select().from(schema.modelProviders);
  const modelById = new Map(models.map((m) => [m.id, m]));
  const providerById = new Map(providers.map((p) => [p.id, p]));

  return rows.map((row) => toBinding(row, modelById, providerById));
}

function toBinding(
  row: typeof schema.agentModelBindings.$inferSelect,
  modelById: Map<string, typeof schema.modelDefinitions.$inferSelect>,
  providerById: Map<string, typeof schema.modelProviders.$inferSelect>,
): Binding {
  const model = row.modelId ? modelById.get(row.modelId) : undefined;
  const provider = model ? providerById.get(model.providerId) : undefined;
  return {
    agentKey: row.agentKey,
    modelId: row.modelId,
    policy: asPolicy(row.policy),
    ...(model && provider
      ? {
          model: {
            id: model.id,
            modelKey: model.modelKey,
            displayName: model.displayName,
            providerKey: provider.key,
            providerName: provider.name,
            isEnabled: model.isEnabled,
            providerEnabled: provider.isEnabled,
            providerHealth: provider.healthStatus,
          },
        }
      : {}),
  };
}

/**
 * Resolve the binding that applies to an agent. Returns null when the operator
 * never assigned anything, which means "let the routing policy decide".
 */
export async function resolveBinding(input: {
  agentKey: string;
  organizationId?: string | null;
  projectId?: string | null;
}): Promise<Binding | null> {
  const organizationId =
    input.organizationId ?? (input.projectId ? await orgForProject(input.projectId) : null);
  if (!organizationId) return null;

  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.agentModelBindings)
    .where(
      and(
        eq(schema.agentModelBindings.organizationId, organizationId),
        eq(schema.agentModelBindings.agentKey, input.agentKey),
      ),
    )
    .limit(1);

  let row = rows[0];
  if (!row) {
    const wildcard = await db
      .select()
      .from(schema.agentModelBindings)
      .where(
        and(
          eq(schema.agentModelBindings.organizationId, organizationId),
          eq(schema.agentModelBindings.agentKey, WILDCARD_AGENT),
        ),
      )
      .limit(1);
    row = wildcard[0];
  }
  if (!row) return null;

  const models = await db.select().from(schema.modelDefinitions);
  const providers = await db.select().from(schema.modelProviders);
  return toBinding(
    row,
    new Map(models.map((m) => [m.id, m])),
    new Map(providers.map((p) => [p.id, p])),
  );
}

/**
 * Apply the operator's binding to an outgoing model call.
 *
 * A pinned model that no longer exists (deleted provider, renamed model) is
 * ignored rather than hard-failing the run — and the drift is logged, because a
 * silently-ignored assignment is exactly the kind of thing that must not be
 * invisible.
 */
export async function applyBinding(
  call: Pick<CallModelInput, 'policy' | 'manualModelId'>,
  input: { agentKey: string; organizationId?: string | null; projectId?: string | null },
): Promise<Pick<CallModelInput, 'policy' | 'manualModelId'> & { binding: Binding | null }> {
  const binding = await resolveBinding(input);
  if (!binding) return { ...call, binding: null };

  if (binding.modelId) {
    if (binding.model) {
      return { policy: 'MANUAL', manualModelId: binding.modelId, binding };
    }
    log.warn(`binding for agent ${input.agentKey} points at a missing model — falling back to policy`, {
      agentKey: input.agentKey,
      policy: binding.policy,
    });
  }
  return { policy: binding.policy, binding };
}

/** Create or update the assignment for one agent (idempotent). */
export async function setBinding(input: {
  organizationId: string;
  agentKey: string;
  modelId: string | null;
  policy?: RoutingPolicy;
}): Promise<Binding> {
  const db = await getDb();
  const policy = asPolicy(input.policy ?? null);

  const existing = await db
    .select()
    .from(schema.agentModelBindings)
    .where(
      and(
        eq(schema.agentModelBindings.organizationId, input.organizationId),
        eq(schema.agentModelBindings.agentKey, input.agentKey),
      ),
    )
    .limit(1);

  let row: typeof schema.agentModelBindings.$inferSelect;
  if (existing[0]) {
    row = (
      await db
        .update(schema.agentModelBindings)
        .set({ modelId: input.modelId, policy, updatedAt: new Date() })
        .where(eq(schema.agentModelBindings.id, existing[0]!.id))
        .returning()
    )[0]!;
  } else {
    row = (
      await db
        .insert(schema.agentModelBindings)
        .values({
          organizationId: input.organizationId,
          agentKey: input.agentKey,
          modelId: input.modelId,
          policy,
        })
        .returning()
    )[0]!;
  }

  const models = await db.select().from(schema.modelDefinitions);
  const providers = await db.select().from(schema.modelProviders);
  const binding = toBinding(
    row,
    new Map(models.map((m) => [m.id, m])),
    new Map(providers.map((p) => [p.id, p])),
  );

  log.info('model binding updated', {
    agentKey: input.agentKey,
    model: binding.model ? `${binding.model.providerKey}/${binding.model.modelKey}` : null,
    policy: binding.policy,
  });

  return binding;
}
