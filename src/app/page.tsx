import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/session';

/**
 * This page redirects based on the session, so it must never be prerendered.
 *
 * Without `force-dynamic`, `next build` prerenders it at build time. That calls
 * `getCurrentUser()` → `ensurePlatformReady()` → `bootstrapDatabase()`, which
 * opens the PGlite data directory. If the dev server already holds it, PGlite's
 * single-connection limit is violated, the WASM instance aborts
 * (`RuntimeError: Aborted()`), and the build fails — and can leave the dev
 * server's database unusable.
 */
export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const user = await getCurrentUser();
  redirect(user ? '/home' : '/login');
}
