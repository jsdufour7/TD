import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { createTestDatabase, createTestProject, destroyTestDatabase, type TestContext } from '../helpers/db';
import { resolveModel } from '@/ai/router';
import { AppError } from '@/lib/errors';

/**
 * Model Router (§7–§9): local-first, generic providers, graceful fallback.
 * A provider outage must never take down orchestration.
 */
describe('model router', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestDatabase();
    await createTestProject(ctx, 'Router Demo');
  }, 180_000);

  afterAll(async () => {
    await destroyTestDatabase(ctx);
  });

  async function addProvider(key: string, enabled: boolean, health: string) {
    const db = await getDb();
    const [provider] = await db
      .insert(schema.modelProviders)
      .values({ key, name: key, kind: 'openai_compatible', baseUrl: 'http://127.0.0.1:9/v1', isEnabled: enabled, isLocal: key.startsWith('local'), healthStatus: health })
      .returning();
    return provider!;
  }

  async function addModel(providerId: string, key: string, policies: string[] = ['LOCAL_ONLY', 'BALANCED']) {
    const db = await getDb();
    const [model] = await db
      .insert(schema.modelDefinitions)
      .values({ providerId, modelKey: key, displayName: key, isEnabled: true })
      .returning();
    for (const policy of policies) {
      await db.insert(schema.modelRoutes).values({ policy, modelId: model!.id, priority: 100 });
    }
    return model!;
  }

  it('LOCAL_ONLY resolves to the local model when available', async () => {
    const provider = await addProvider('local-llama', true, 'online');
    await addModel(provider.id, 'llama-x');
    const resolved = await resolveModel('LOCAL_ONLY');
    expect(resolved.modelKey).toBe('llama-x');
    expect(resolved.providerKey).toBe('local-llama');
  });

  it('LOCAL_ONLY does NOT fall back to cloud and throws when local is down', async () => {
    const db = await getDb();
    await db.update(schema.modelProviders).set({ isEnabled: false, healthStatus: 'offline' }).where(eq(schema.modelProviders.key, 'local-llama'));
    // A hosted provider exists but LOCAL_ONLY must not silently use it.
    const cloud = await addProvider('cloud-x', true, 'online');
    // Cloud is only routable via BALANCED, never LOCAL_ONLY.
    await addModel(cloud.id, 'cloud-model', ['BALANCED']);
    await expect(resolveModel('LOCAL_ONLY')).rejects.toThrowError(AppError);
  });

  it('BALANCED falls back to any usable provider when the preferred is down', async () => {
    // local is offline; cloud is online → BALANCED should resolve to cloud-model.
    const resolved = await resolveModel('BALANCED', { allowFallback: true });
    expect(resolved.modelKey).toBe('cloud-model');
  });
});
