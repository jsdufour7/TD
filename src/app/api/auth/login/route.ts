import { z } from 'zod';
import { authenticateWithPassword, createSession, setSessionCookie } from '@/auth/session';
import { publicUser } from '@/auth/session';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, bodySchema);
    const user = await authenticateWithPassword(body.email, body.password);

    if (!user) {
      await recordAudit({
        action: 'auth.login',
        outcome: 'failure',
        metadata: { email: body.email },
      });
      // Identical message for unknown user and wrong password.
      throw new AppError('unauthorized', 'Invalid email or password');
    }

    const token = await createSession(user.id, request.headers.get('user-agent') ?? undefined);
    await setSessionCookie(token);

    await recordAudit({
      action: 'auth.login',
      organizationId: user.organizationId,
      userId: user.id,
    });

    return jsonOk({ user: publicUser(user) });
  } catch (error) {
    return jsonError(error);
  }
}
