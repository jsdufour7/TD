'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, inputClass } from '@/components/ui/primitives';
import { Logo } from '@/components/brand/logo';

/**
 * Sign in.
 *
 * The bootstrap administrator is created on first boot from AI_CORE_BOOTSTRAP_*.
 * The hint below is shown only in development, and only names the email — never
 * a password.
 */
/**
 * No `useSearchParams()` here on purpose.
 *
 * `useSearchParams` forces a Suspense boundary during static prerendering, and
 * the server/client pair can disagree about its value — one of the documented
 * causes of "Hydration failed because the server rendered HTML didn't match the
 * client". The redirect target is only needed inside the submit handler, which
 * runs after mount, so it is read from `window.location.search` there instead of
 * during render. That removes the mismatch source rather than papering over it.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-0 p-6 bg-grid">
      <LoginCard />
    </main>
  );
}

function LoginCard() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@twodots.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        setError(body.error?.message ?? 'Sign in failed');
        return;
      }
      // `replace` already fetches a fresh RSC payload for the destination, so
      // the session-aware layout re-renders with the new cookie. Adding a
      // `router.refresh()` here would re-fetch and ABORT that in-flight render;
      // React's dev profiler then measures the aborted AppLayout with an
      // -Infinity end time and throws "cannot have a negative time stamp".
      // Read at submit time (after mount), never during render — see the note
      // on LoginPage above.
      const redirectTo = new URLSearchParams(window.location.search).get('redirect');
      router.replace(redirectTo && redirectTo.startsWith('/') ? redirectTo : '/home');
    } catch {
      setError('Could not reach the server. Is AI Core running?');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8">
        <Logo />
        <p className="mt-2 text-xs text-ink-3">
          L’intelligence <span className="font-medium text-accent">au cœur</span> de l’écosystème.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4 rounded-lg border border-line bg-surface-1 p-5">
        <Field label="Email" required>
          <input
            type="email"
            autoComplete="username"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>

        <Field label="Password" required>
          <input
            type="password"
            autoComplete="current-password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>

        {error ? (
          <p role="alert" className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" size="md" className="w-full" loading={submitting}>
          Sign in
        </Button>
      </form>

      {/*
        Relative link on purpose. The live preview is served from a host whose
        id changes between sessions, so an absolute URL handed out in chat goes
        stale. A relative href resolves against whatever origin the browser is
        actually on, so this keeps working.

        Placed on the login page because that page renders without a session,
        which matters when the preview iframe blocks third-party cookies.
      */}
      <a
        href="/download/twodots-ai-core.zip"
        download
        className="mt-3 flex items-center justify-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-2 transition-colors hover:border-accent/40 hover:text-ink-1"
      >
        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M12 3v12M7 11l5 5 5-5M4 21h16" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Télécharger le code source (.zip)
      </a>

      <p className="mt-4 text-center text-[11px] text-ink-4">
        Sessions are stored as hashed tokens. Credentials never leave the server.
      </p>
    </div>
  );
}

