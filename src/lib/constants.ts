/**
 * Constants shared between the edge runtime (src/proxy.ts) and the Node runtime.
 *
 * This module must stay free of Node builtins and of `@/lib/env`: the proxy runs
 * on the edge, where importing `node:path` fails at module-evaluation time and
 * 500s every page.
 */

/** Name of the session cookie. Must match src/lib/env security.sessionCookieName. */
export const SESSION_COOKIE_NAME = 'ai_core_session';
