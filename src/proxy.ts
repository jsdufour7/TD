import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/constants';

/**
 * Security headers (§41). Applied to every response, including streamed ones.
 *
 * Next.js 16 renamed the `middleware` convention to `proxy`, and requires the
 * export to be named `proxy` (see next/dist/build/templates/middleware.js:
 * `isProxy ? mod.proxy : mod.middleware`). Having both files is a build error,
 * so only this one exists.
 *
 * RUNTIME CONSTRAINT: this file executes in the edge runtime. It must not import
 * `@/lib/env` or anything else that reaches a Node builtin — doing so produces
 * "Native module not found: node:path" and 500s every page. `NODE_ENV` is read
 * directly because Next inlines it for both runtimes.
 *
 * Authorization is deliberately NOT performed here: the edge runtime cannot
 * reach the database or node:crypto, so it cannot validate a session token.
 * Authorization is enforced server-side in requireUser / requireProject.
 */

const isDevelopment = process.env.NODE_ENV !== 'production';

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  /**
   * Redirect signed-out users away from app routes before the layout renders.
   *
   * This is a UX redirect based on cookie *presence* only — it is not
   * authorization. The authoritative check remains `requireUser` in the layout
   * and in every API route; a stale or forged cookie still gets rejected there.
   *
   * It also removes a real failure mode: `AppLayout` calls `redirect()` when
   * there is no user, which throws and aborts the RSC stream mid-render. React's
   * dev profiler then measures the aborted component with an `-Infinity` end
   * time and throws "cannot have a negative time stamp". Redirecting here means
   * the layout never starts rendering for a signed-out visitor.
   *
   * API routes are deliberately excluded: they must return 401 JSON, not a 307.
   */
  const isProtectedRoute =
    !pathname.startsWith('/api') &&
    !pathname.startsWith('/_next') &&
    !pathname.startsWith('/favicon') &&
    // Static download bundle. Excluded so the archive stays reachable even
    // without a session; it contains only source code that is already in git.
    !pathname.startsWith('/download/') &&
    pathname !== '/login';

  if (isProtectedRoute) {
    const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

    if (pathname === '/') {
      return NextResponse.redirect(new URL(hasSessionCookie ? '/home' : '/login', request.url));
    }
    if (!hasSessionCookie) {
      const target = new URL('/login', request.url);
      target.searchParams.set('redirect', pathname);
      return NextResponse.redirect(target);
    }
  }

  const response = NextResponse.next();

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  /**
   * Framing policy.
   *
   * The live preview embeds this app in an iframe served from a different host,
   * so `SAMEORIGIN` / `frame-ancestors 'self'` would stop the page rendering at
   * all in development. Embedding is therefore permitted in development and
   * locked down in production, where nothing should frame AI Core.
   */
  if (isDevelopment) {
    response.headers.delete('X-Frame-Options');
  } else {
    response.headers.set('X-Frame-Options', 'DENY');
  }

  /**
   * Content Security Policy.
   *
   * `'unsafe-eval'` is required in development: React's dev build probes for it
   * and warns "React requires eval() in development mode" when a CSP omits it
   * (verified in the served react-server-dom-turbopack chunk). It is omitted in
   * production, where it is a genuine risk.
   */
  const scriptSrc = isDevelopment
    ? "'self' 'unsafe-inline' 'unsafe-eval' ws: wss:"
    : "'self'";

  const frameAncestors = isDevelopment ? '*' : "'self'";

  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: http: https:",
      "font-src 'self' data:",
      // Same-origin API calls plus the dev HMR websocket.
      "connect-src 'self' ws: wss:",
      // The workbench previews the project's own dev server in an iframe.
      "frame-src 'self' http: https:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      `frame-ancestors ${frameAncestors}`,
    ].join('; '),
  );

  // Never let a cached authenticated page be served from a shared cache.
  if (!request.nextUrl.pathname.startsWith('/_next/static')) {
    response.headers.set('Cache-Control', 'no-store, max-age=0');
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
