import { destroySession, getCurrentUser } from '@/auth/session';
import { jsonError, jsonOk } from '@/lib/api';
import { recordAudit } from '@/lib/audit';

export async function POST(): Promise<Response> {
  try {
    const user = await getCurrentUser();
    await destroySession();
    if (user) {
      await recordAudit({
        action: 'auth.logout',
        organizationId: user.organizationId,
        userId: user.id,
      });
    }
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
