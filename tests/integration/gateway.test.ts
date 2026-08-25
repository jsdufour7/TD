import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { createTestDatabase, destroyTestDatabase, type TestContext } from '../helpers/db';
import { encryptSecret } from '@/lib/crypto';
import { resolveCredential } from '@/ai/credentials';
import { resolveModel } from '@/ai/router';
import { AppError } from '@/lib/errors';

/**
 * The gateway is data, not code (§21–§23). These tests lock in the rules that
 * make it safe to point AI Core at a local llama.cpp / Ollama endpoint.
 */
describe('model gateway', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await destroyTestDatabase(ctx);
  });

  async function addProvider(over: Partial<{ key: string; baseUrl: string; enabled: boolean }> = {}) {
    const db = await getDb();
    const [provider] = await db
      .insert(schema.modelProviders)
      .values({
        key: over.key ?? 'test-local',
        name: 'Test local',
        kind: 'openai_compatible',
        baseUrl: over.baseUrl ?? 'http://127.0.0.1:9/v1',
        isEnabled: over.enabled ?? true,
        isLocal: true,
        healthStatus: 'online',
      })
      .returning();
    return provider!;
  }

  async function addModel(providerId: string, over: Partial<{ key: string }> = {}) {
    const db = await getDb();
    const [model] = await db
      .insert(schema.modelDefinitions)
      .values({
        providerId,
        modelKey: over.key ?? 'test-model',
        displayName: over.key ?? 'test-model',
        isEnabled: true,
      })
      .returning();
    return model!;
  }

  it('stores credentials encrypted and never returns plaintext', async () => {
    const db = await getDb();
    const secret = 'super-secret-key-123';
    const [cred] = await db
      .insert(schema.credentialReferences)
      .values({ name: 'gw-test', source: 'encrypted', ciphertext: encryptSecret(secret), fingerprint: '…abcd' })
      .returning();

    // The stored value is ciphertext, not the secret.
    expect(cred!.ciphertext).not.toContain(secret);

    // Resolution decrypts it server-side only.
    const resolved = await resolveCredential(cred!);
    expect(resolved?.value).toBe(secret);

    // The plaintext never appears in a serialized provider payload.
    const payload = JSON.stringify(cred!);
    expect(payload).not.toContain(secret);
  });

  it('LOCAL_ONLY resolves to the routed local model', async () => {
    const db = await getDb();
    const provider = await addProvider({ key: 'local-only-test' });
    const model = await addModel(provider.id, { key: 'only-local-model' });

    // The router resolves through model_routes, so wire LOCAL_ONLY to the model.
    await db.insert(schema.modelRoutes).values({ policy: 'LOCAL_ONLY', modelId: model.id, priority: 100, isEnabled: true });

    const resolved = await resolveModel('LOCAL_ONLY');
    expect(resolved.modelKey).toBe('only-local-model');
    expect(resolved.providerKey).toBe('local-only-test');
  });

  it('LOCAL_ONLY does not fall back when its provider goes offline', async () => {
    const db = await getDb();
    // Take the local provider down; the route still points at it.
    await db.update(schema.modelProviders).set({ isEnabled: false, healthStatus: 'offline' }).where(eq(schema.modelProviders.key, 'local-only-test'));

    // A hosted provider exists but LOCAL_ONLY must not silently use it.
    await addProvider({ key: 'hosted-test' });

    await expect(resolveModel('LOCAL_ONLY')).rejects.toThrowError(AppError);
  });

  it('falls back for BALANCED but records the fallback', async () => {
    const db = await getDb();
    const hosted = (await db.select().from(schema.modelProviders).where(eq(schema.modelProviders.key, 'hosted-test')).limit(1))[0]!;
    await db.update(schema.modelProviders).set({ isEnabled: true, healthStatus: 'online' }).where(eq(schema.modelProviders.id, hosted.id));
    // loadProviders only yields providers that expose at least one model.
    await addModel(hosted.id, { key: 'hosted-model' });

    const resolved = await resolveModel('BALANCED', { allowFallback: true });
    expect(resolved.modelKey).toBeTruthy();
    expect(resolved.fellBack).toBe(true);
  });

  it('enforces provider key uniqueness at the schema level', async () => {
    await addProvider({ key: 'dup-key' });
    await expect(addProvider({ key: 'dup-key' })).rejects.toThrow();
  });
});
