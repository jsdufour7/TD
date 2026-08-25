import { getCurrentUser, publicUser } from '@/auth/session';
import { jsonError, jsonOk } from '@/lib/api';

export async function GET(): Promise<Response> {
  try {
    const user = await getCurrentUser();
    if (!user) return jsonOk({ user: null });
    return jsonOk({ user: publicUser(user) });
  } catch (error) {
    return jsonError(error);
  }
}
