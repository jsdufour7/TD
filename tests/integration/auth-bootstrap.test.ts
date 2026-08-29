import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, schema } from '@/db/client';
import { createTestDatabase, destroyTestDatabase, type TestContext } from '../helpers/db';
import { authenticateWithPassword } from '@/auth/session';

/**
 * First-run boot through the only entry point that has no session.
 *
 * Regression guard: sign-in used to query `users` before anything had created
 * it, so a freshly deployed instance answered the very first login with
 * `relation "users" does not exist` (HTTP 500). Boot was wired into
 * getCurrentUser() only — which sign-in cannot use, by definition.
 */
describe('authentication bootstraps the platform', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await destroyTestDatabase(ctx);
  });

  it('boots before checking credentials, so a fresh deploy can sign in', async () => {
    const db = await getDb();

    // Emulate a freshly provisioned database: the schema exists, but the
    // platform (agent catalog, organisation, bootstrap admin) has not been set
    // up yet.
    await db.delete(schema.agentDefinitions);
    expect(await db.select().from(schema.agentDefinitions)).toHaveLength(0);

    // No session exists, so nothing but authenticateWithPassword can boot here.
    await expect(authenticateWithPassword('nobody@nowhere.local', 'not-a-password')).resolves.toBeNull();

    const catalog = await db.select().from(schema.agentDefinitions);
    expect(catalog.length).toBeGreaterThan(0);
  });

  it('still refuses an unknown account without leaking which part failed', async () => {
    await expect(authenticateWithPassword('ghost@twodots.local', 'whatever')).resolves.toBeNull();
  });

  it('signs the bootstrap administrator in with the configured credentials', async () => {
    const { env } = await import('@/lib/env');
    const user = await authenticateWithPassword(env.bootstrap.email, env.bootstrap.password);
    expect(user?.email).toBe(env.bootstrap.email);
    expect(user?.role).toBe('owner');
  });
});
