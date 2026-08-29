import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';

describe('public deployment health', () => {
  it('returns only the minimal unauthenticated readiness surface', async () => {
    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.status).toBe('ok');
    expect(body.database).toEqual({ reachable: true });
    expect(typeof body.durationMs).toBe('number');

    expect(Object.keys(body).sort()).toEqual(['database', 'durationMs', 'ok', 'status']);

    const serialized = JSON.stringify(body);
    for (const forbidden of [
      'node',
      'platform',
      'vercel',
      'region',
      'tables',
      'migrationsApplied',
      'organizations',
      'users',
      'adminPresent',
      'agentDefinitions',
      'providers',
      'models',
      'runEngine',
      'error',
      'problems',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
