import { requireUser } from '@/auth/guards';
import { jsonError, jsonOk } from '@/lib/api';
import { checkAllProviderHealth, invalidateHealthCache } from '@/ai/router';
import { recordAudit } from '@/lib/audit';

/**
 * Provider health check (§22).
 *
 * A provider that is offline is reported as offline. Nothing throws, so a local
 * model being switched off can never take the platform down.
 */
export async function POST(): Promise<Response> {
  try {
    const user = await requireUser();
    invalidateHealthCache();
    const results = await checkAllProviderHealth();

    await recordAudit({
      action: 'models.health_check',
      userId: user.id,
      metadata: { results: results.map((r) => ({ key: r.key, status: r.status })) },
    });

    return jsonOk({
      results,
      anyOnline: results.some((r) => r.status === 'online'),
      offline: results.filter((r) => r.status === 'offline').map((r) => r.key),
    });
  } catch (error) {
    return jsonError(error);
  }
}
