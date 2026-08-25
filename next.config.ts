import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * Allow the sandbox live-preview host to load dev resources.
   *
   * Without this, Next.js 16 answers 403 "Blocked cross-origin request to
   * Next.js dev resource" for every `/_next/static/chunks/*.js` requested from
   * the preview origin. The server-rendered HTML still loads, so the page
   * *looks* fine, but no client bundle arrives, React never hydrates, and every
   * button is inert — which presents as "clicking sign-in does nothing".
   *
   * Dev-only by construction: this option is consulted only on the development
   * code path in Next's router-server.
   */
  allowedDevOrigins: ['*.e2b.app', 'localhost', '**.localhost'],

  // AI Core talks to local model providers and to a local dev bridge; those are
  // server-side fetches, so the default fetch allowlist is fine. CSP is set in
  // proxy.ts so it applies to every response including streamed ones.
  // These are native/binary-backed or self-contained Node packages. They must
  // stay outside the bundler: PGlite ships WASM, and playwright loads browser
  // binaries and optional peer modules (chromium-bidi) at runtime.
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'playwright', 'playwright-core'],
  // Type and lint errors must fail the build. Next 16 enforces this by default,
  // so there is deliberately no override here.
  experimental: {
    // Long-running agent work happens in the worker, not in request handlers,
    // but body size for file uploads / large diffs needs headroom.
    serverActions: { bodySizeLimit: '16mb' },
  },
};

export default nextConfig;
