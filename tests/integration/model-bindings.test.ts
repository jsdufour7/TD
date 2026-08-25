import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { createTestDatabase, createTestProject, destroyTestDatabase, type TestContext } from '../helpers/db';
import { applyBinding, listBindings, resolveBinding, setBinding } from '@/ai/bindings';
import { diagnoseGateway } from '@/ai/diagnostics';

/**
 * Agent → model assignment (§23).
 *
 * The operator's explicit choice must win over the agent's default policy, must
 * survive a deleted model, and must never be applied to another organisation.
 */
describe('agent model bindings', () => {
  let ctx: TestContext;
  let projectId: string;

  beforeAll(async () => {
    ctx = await createTestDatabase();
    const project = await createTestProject(ctx, 'Binding Demo');
    projectId = project.id;
  }, 180_000);

  afterAll(async () => {
    await destroyTestDatabase(ctx);
  });

  async function addModel(key: string, health = 'online') {
    const db = await getDb();
    const [provider] = await db
      .insert(schema.modelProviders)
      .values({
        key: `prov-${key}`,
        name: `prov-${key}`,
        kind: 'openai_compatible',
        baseUrl: 'http://127.0.0.1:9/v1',
        isEnabled: true,
        isLocal: true,
        healthStatus: health,
      })
      .returning();
    const [model] = await db
      .insert(schema.modelDefinitions)
      .values({ providerId: provider!.id, modelKey: key, displayName: key, isEnabled: true })
      .returning();
    return { provider: provider!, model: model! };
  }

  it('reports the real reason the gateway cannot answer when nothing is configured', async () => {
    const diagnosis = await diagnoseGateway();
    expect(diagnosis.ok).toBe(false);
    expect(['no_provider', 'provider_disabled', 'no_model', 'offline']).toContain(diagnosis.reason);
    expect(diagnosis.detail.length).toBeGreaterThan(0);
  });

  it('assigns a model to the COO and resolves it back', async () => {
    const { model } = await addModel('coo-llama');

    const binding = await setBinding({ organizationId: ctx.organizationId, agentKey: 'coo', modelId: model.id });
    expect(binding.modelId).toBe(model.id);
    expect(binding.model?.modelKey).toBe('coo-llama');

    const resolved = await resolveBinding({ agentKey: 'coo', projectId });
    expect(resolved?.model?.modelKey).toBe('coo-llama');
    expect(resolved?.model?.providerHealth).toBe('online');
  });

  it('routes the outgoing call to MANUAL with the pinned model', async () => {
    const bound = await applyBinding({ policy: 'BEST' }, { agentKey: 'coo', projectId });
    expect(bound.policy).toBe('MANUAL');
    expect(bound.manualModelId).toBeTruthy();
  });

  it('leaves the routing policy in charge for an agent nobody assigned', async () => {
    const bound = await applyBinding({ policy: 'CODING_MAX' }, { agentKey: 'fullstack-engineer', projectId });
    expect(bound.policy).toBe('CODING_MAX');
    expect(bound.manualModelId).toBeUndefined();
    expect(bound.binding).toBeNull();
  });

  it('falls back to the organisation wildcard binding', async () => {
    const { model } = await addModel('org-default');
    await setBinding({ organizationId: ctx.organizationId, agentKey: '*', modelId: model.id });

    const resolved = await resolveBinding({ agentKey: 'qa-engineer', projectId });
    expect(resolved?.model?.modelKey).toBe('org-default');

    // An explicit per-agent assignment still beats the wildcard.
    const coo = await resolveBinding({ agentKey: 'coo', projectId });
    expect(coo?.model?.modelKey).toBe('coo-llama');
  });

  it('never applies one organisation binding to another', async () => {
    const db = await getDb();
    const [other] = await db
      .insert(schema.organizations)
      .values({ name: 'Other Org', slug: `other-${Date.now()}` })
      .returning();

    const resolved = await resolveBinding({ agentKey: 'coo', organizationId: other!.id });
    expect(resolved).toBeNull();
  });

  it('survives the deletion of the pinned model instead of hard-failing', async () => {
    const db = await getDb();
    const binding = await resolveBinding({ agentKey: 'coo', projectId });
    expect(binding?.modelId).toBeTruthy();

    // model_definitions has ON DELETE SET NULL from the binding.
    await db.delete(schema.modelDefinitions).where(eq(schema.modelDefinitions.id, binding!.modelId!));

    const after = await resolveBinding({ agentKey: 'coo', projectId });
    expect(after?.modelId).toBeNull();

    // The call falls back to the stored policy rather than pinning a dead model.
    const bound = await applyBinding({ policy: 'BEST' }, { agentKey: 'coo', projectId });
    expect(bound.policy).toBe(after!.policy);
    expect(bound.manualModelId).toBeUndefined();
  });

  it('lists bindings for the assignment UI', async () => {
    const bindings = await listBindings(ctx.organizationId);
    const keys = bindings.map((b) => b.agentKey).sort();
    expect(keys).toContain('*');
    expect(keys).toContain('coo');
  });
});
