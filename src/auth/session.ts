import { cookies, headers } from 'next/headers';
import { eq, and, gt } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { hashSessionToken, newSessionToken } from '@/lib/crypto';
import { env } from '@/lib/env';
import { ensurePlatformReady } from '@/platform/boot';
import { SESSION_COOKIE_NAME } from '@/lib/constants';
import { createLogger } from '@/lib/logger';
import { verifyPassword } from './password';
import type { User } from '@/db/schema';

/**
 * Session management.
 *
 * The cookie holds an opaque random token; only its SHA-256 hash is stored, so a
 * database leak does not yield usable sessions. Expiry is enforced both in the
 * cookie attributes and by a stored `expires_at` that every lookup checks.
 */

/** Must match src/lib/constants so the edge proxy and Node agree. */
export const SESSION_COOKIE = SESSION_COOKIE_NAME;
export async function createSession(userId: string, userAgent?: string): Promise<string> {
  const db = await getDb();
  const token = newSessionToken();
  await db.insert(schema.sessions).values({
    userId,
    tokenHash: hashSessionToken(token),
    userAgent: userAgent?.slice(0, 255) ?? null,
    expiresAt: new Date(Date.now() + env.security.sessionTtlMs),
  });
  return token;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  const hdrs = await headers();

  /**
   * Cookie site policy, chosen from how the request actually arrived.
   *
   * The live preview serves this app over HTTPS inside a cross-origin iframe.
   * A `SameSite=Lax` cookie is NOT sent on requests made from within a
   * cross-site iframe — Lax only permits top-level navigations. The browser
   * therefore accepts the cookie from the login response and then omits it from
   * the very next request, so `/home` sees no session and bounces back to
   * `/login?redirect=/home`. The visible symptom is a sign-in button that
   * appears to do nothing, with the server logging a successful login followed
   * immediately by a 307.
   *
   * `SameSite=None` is only honoured by browsers together with `Secure`, so the
   * two are set as a pair.
   *
   * Detection: honour `x-forwarded-proto` / `x-forwarded-ssl` when the proxy
   * sends them, and otherwise fall back to the Host header — any non-loopback
   * host here is the HTTPS preview proxy, while loopback is plain-HTTP local
   * development where the stricter `Lax` is correct. The fallback matters
   * because a proxy is not required to forward the protocol.
   *
   * CSRF exposure from `None` is limited because every mutation endpoint
   * requires a JSON body; a cross-site HTML form cannot set
   * `content-type: application/json` without triggering a CORS preflight.
   */
  const forwardedProto = (hdrs.get('x-forwarded-proto') ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  const host = (hdrs.get('host') ?? '').toLowerCase();
  const isLoopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);

  /**
   * Note: Next.js populates `x-forwarded-proto` with `http` when the inbound
   * connection is plain HTTP and the client sent nothing, so "header absent" is
   * not a detectable state. The Host check therefore cannot be gated on it.
   *
   * Any non-loopback Host here is the HTTPS preview proxy (or production), both
   * of which terminate TLS in front of this server. Loopback is plain-HTTP local
   * development, where the stricter `Lax` is correct and `Secure` would prevent
   * the cookie being sent at all.
   */
  const configured = (process.env.SESSION_COOKIE_SAMESITE ?? 'auto').toLowerCase();
  const isHttps =
    configured === 'none'
      ? true
      : configured === 'lax'
        ? false
        : forwardedProto === 'https' ||
          hdrs.get('x-forwarded-ssl') === 'on' ||
          (!isLoopback && host !== '');

  // Logged so the choice can be confirmed from the server log rather than
  // assumed. Contains no secret material — only the cookie name.
  createLogger('auth').debug('session cookie policy', {
    host: host || '(absent)',
    forwardedProto: forwardedProto || '(absent)',
    configured,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
  });

  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    path: '/',
    maxAge: Math.floor(env.security.sessionTtlMs / 1000),
    ...(isHttps
      ? { sameSite: 'none' as const, secure: true }
      : { sameSite: 'lax' as const, secure: env.isProduction }),
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashSessionToken(token)));
  }
  store.delete(SESSION_COOKIE);
}

/** Returns the authenticated user, or null. Never throws. */
export async function getCurrentUser(): Promise<User | null> {
  // Single chokepoint for platform boot: every page and API route that touches
  // the database goes through this function (directly, or via requireUser /
  // requireProject). Doing it here guarantees migrations and the run-engine
  // worker exist before any query, without needing an edge-incompatible
  // instrumentation hook. See src/platform/boot.ts.
  await ensurePlatformReady();

  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await getDb();
  const rows = await db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(
      and(
        eq(schema.sessions.tokenHash, hashSessionToken(token)),
        gt(schema.sessions.expiresAt, new Date()),
        eq(schema.users.isActive, true),
      ),
    )
    .limit(1);

  return rows[0]?.user ?? null;
}

export async function authenticateWithPassword(
  email: string,
  password: string,
): Promise<User | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.toLowerCase().trim()))
    .limit(1);
  const user = rows[0];
  if (!user) return null;
  if (!user.isActive) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return user;
}

/** Shape safe to send to the browser. Never includes passwordHash. */
export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId,
    createdAt: user.createdAt.toISOString(),
  };
}

export type PublicUser = ReturnType<typeof publicUser>;
