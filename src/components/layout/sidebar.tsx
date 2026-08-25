'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/ui';
import { Badge } from '@/components/ui/primitives';
import { LogoMark } from '@/components/brand/logo';

type NavItem = { href: string; label: string; icon: string; badge?: number; badgeTone?: string };

/**
 * Left navigation (§26). Desktop-first, collapses to an overlay drawer on
 * narrow screens so no critical action becomes unreachable on mobile (§39).
 */
export function Sidebar({
  user,
  projects,
  pendingApprovals,
  activeRuns,
}: {
  user: { name: string; email: string };
  projects: Array<{ id: string; name: string; slug: string; hasActiveRun: boolean }>;
  pendingApprovals: number;
  activeRuns: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const primary: NavItem[] = [
    { href: '/home', label: 'Home', icon: 'home' },
    { href: '/coo', label: 'COO', icon: 'sparkle' },
    { href: '/drive', label: 'Voiture', icon: 'car' },
    { href: '/projects', label: 'Projects', icon: 'folder' },
    { href: '/agents', label: 'Agents', icon: 'bot' },
    { href: '/runs', label: 'Runs', icon: 'activity', badge: activeRuns, badgeTone: 'accent' },
    { href: '/approvals', label: 'Approvals', icon: 'shield', badge: pendingApprovals, badgeTone: 'warn' },
    { href: '/models', label: 'Models', icon: 'cpu' },
    { href: '/admin', label: 'Admin', icon: 'users' },
    { href: '/settings', label: 'Settings', icon: 'settings' },
  ];

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    // No `router.refresh()` here: `replace` already fetches fresh RSC data, and
    // refreshing on top of it aborts the in-flight render (see login/page.tsx).
    router.replace('/login');
  }

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
        <LogoMark className="size-7 shrink-0 text-ink-1" />
        <div className="min-w-0">
          <p className="truncate text-[13px] leading-tight font-semibold">
            <span className="text-accent">AI</span> Core
          </p>
          <p className="truncate text-[10px] text-ink-4">TwoDots</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {primary.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  'group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
                  pathname === item.href || (item.href !== '/home' && pathname.startsWith(item.href))
                    ? 'bg-surface-3 text-ink-1'
                    : 'text-ink-3 hover:bg-surface-2 hover:text-ink-1',
                )}
              >
                <NavIcon name={item.icon} />
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge ? (
                  <Badge tone={item.badgeTone ?? 'idle'} className="px-1 py-0">
                    {item.badge}
                  </Badge>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-5 px-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] tracking-wider text-ink-4 uppercase">Projects</p>
            <Link
              href="/projects"
              onClick={() => setOpen(false)}
              className="text-[10px] text-ink-4 hover:text-accent"
            >
              all
            </Link>
          </div>
        </div>

        <ul className="mt-1.5 space-y-0.5">
          {projects.length === 0 ? (
            <li className="px-2.5 py-2 text-[11px] text-ink-4">No projects yet</li>
          ) : (
            projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projects/${project.id}/work`}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors',
                    pathname.startsWith(`/projects/${project.id}`)
                      ? 'bg-surface-3 text-ink-1'
                      : 'text-ink-3 hover:bg-surface-2 hover:text-ink-1',
                  )}
                >
                  {project.hasActiveRun ? (
                    <span className="size-1.5 shrink-0 rounded-full bg-accent animate-pulse-dot" aria-label="active run" />
                  ) : (
                    <span className="size-1.5 shrink-0 rounded-full bg-line-strong" />
                  )}
                  <span className="truncate">{project.name}</span>
                </Link>
              </li>
            ))
          )}
        </ul>
      </nav>

      <div className="border-t border-line p-2.5">
        <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-3 font-mono text-[11px] text-ink-2">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-ink-1">{user.name}</p>
            <p className="truncate text-[10px] text-ink-4">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            title="Sign out"
            className="rounded p-1 text-ink-4 transition-colors hover:bg-surface-3 hover:text-ink-1"
          >
            <NavIcon name="logout" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface-1 lg:block">
        <div className="sticky top-0 h-dvh">{content}</div>
      </aside>

      {/* Mobile drawer */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-40 grid size-11 place-items-center rounded-full border border-line-strong bg-surface-2 text-ink-1 shadow-lg lg:hidden"
        aria-label="Open navigation"
      >
        <NavIcon name="menu" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-line bg-surface-1 animate-slide-in">
            {content}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Inline icons, so the shell has no icon-font dependency. */
export function NavIcon({ name, className }: { name: string; className?: string }) {
  const paths: Record<string, React.ReactNode> = {
    home: <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
    folder: <path d="M3 6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />,
    bot: (
      <>
        <rect x="4" y="7" width="16" height="12" rx="2" />
        <path d="M12 3v4M9 13h.01M15 13h.01M9.5 16.5h5" />
      </>
    ),
    activity: <path d="M3 12h4l3 8 4-16 3 8h4" />,
    shield: <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z" />,
    cpu: (
      <>
        <rect x="6" y="6" width="12" height="12" rx="2" />
        <path d="M10 2v4M14 2v4M10 18v4M14 18v4M2 10h4M2 14h4M18 10h4M18 14h4" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14.6H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.5 1.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6" />
        <circle cx="17.5" cy="9" r="2.8" />
        <path d="M15.5 14.5c3 0 6 2 6 5.5" />
      </>
    ),
    sparkle: (
      <>
        <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z" />
        <path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
      </>
    ),
    car: (
      <>
        <path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11" />
        <path d="M4 11h16v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
        <circle cx="7.5" cy="13.5" r="0.5" />
        <circle cx="16.5" cy="13.5" r="0.5" />
      </>
    ),
    logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
    menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  };

  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('size-4 shrink-0', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.activity}
    </svg>
  );
}
