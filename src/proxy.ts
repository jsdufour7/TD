import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/constants';

/**
 * Security headers (Â§41). Applied to every response, including streamed ones.
 *
 * Authorization is deliberately NOT performed here: authoritative authorization
 * stays server-side in requireUser / requireProject.
 */
const isDevelopment = process.env.NODE_ENV !== 'production';

function base64Nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function buildContentSecurityPolicy(nonce: string): string {
  const scriptSrc = isDevelopment
    ? "'self' 'unsafe-inline' 'unsafe-eval' ws: wss:"
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  const connectSrc = isDevelopment ? "'self' ws: wss:" : "'self'";
  const frameAncestors = isDevelopment ? '*' : "'self'";

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: http: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "frame-src 'self' http: https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join('; ');
}

function applyResponseSecurityHeaders(
  response: NextResponse,
  csp: string,
  pathname: string,
): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-DNS-Prefetch-Control', 'off');

  // Voice is a real product capability. The previous `microphone=()` policy
  // disabled getUserMedia even after the user granted browser permission.
  // Development does not restrict microphone because Arena/e2b can iframe the app;
  // production permits only the application's own origin.
  response.headers.set(
    'Permissions-Policy',
    isDevelopment ? 'camera=(), geolocation=()' : 'camera=(), microphone=(self), geolocation=()',
  );

  if (isDevelopment) {
    response.headers.delete('X-Frame-Options');
  } else {
    response.headers.set('X-Frame-Options', 'DENY');
  }

  response.headers.set('Content-Security-Policy', csp);

  if (!pathname.startsWith('/_next/static')) {
    response.headers.set('Cache-Control', 'no-store, max-age=0');
  }

  return response;
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const nonce = base64Nonce();
  const csp = buildContentSecurityPolicy(nonce);

  const isProtectedRoute =
    !pathname.startsWith('/api') &&
    !pathname.startsWith('/_next') &&
    !pathname.startsWith('/favicon') &&
    !pathname.startsWith('/download/') &&
    pathname !== '/login';

  if (isProtectedRoute) {
    const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

    if (pathname === '/') {
      const response = NextResponse.redirect(
        new URL(hasSessionCookie ? '/home' : '/login', request.url),
      );
      return applyResponseSecurityHeaders(response, csp, pathname);
    }

    if (!hasSessionCookie) {
      const target = new URL('/login', request.url);
      target.searchParams.set('redirect', pathname);
      return applyResponseSecurityHeaders(NextResponse.redirect(target), csp, pathname);
    }
  }

  /**
   * Next.js extracts the nonce while rendering from the CSP present on the
   * UPSTREAM REQUEST. Setting it only on the response is too late: the browser
   * receives a nonce policy but Next's inline bootstrap scripts are rendered
   * without that nonce. Forward both CSP and x-nonce to the renderer, then send
   * the same CSP to the browser.
   */
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  return applyResponseSecurityHeaders(response, csp, pathname);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
