'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Activity,
  Bot,
  Car,
  Cpu,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/ui';
import { openCoo } from '@/lib/ui-events';
import { useStoredString } from '@/lib/use-stored';
import { Avatar, Badge, IconButton, Kbd } from '@/components/ui/primitives';
import { LogoMark } from '@/components/brand/logo';
import { ThemeToggle } from './theme-toggle';

type NavItem = { href: string; label: string; icon: LucideIcon; badge?: number; badgeTone?: string };
type NavSection = { title: string; items: NavItem[] };

/**
 * Left navigation (§26).
 *
 * Grouped by intent rather than a flat list: what you pilot, what you operate,
 * what you configure. Collapses to an icon rail so the work surface keeps the
 * room it needs, and becomes an overlay drawer below `lg` so no action is ever
 * unreachable on a phone (§39).
 */
export function Sidebar({
  user,
  projects,
  pendingApprovals,
  activeRuns,
  failedRuns,
  blockedTasks,
}: {
  user: { name: string; email: string };
  projects: Array<{ id: string; name: string; slug: string; hasActiveRun: boolean }>;
  pendingApprovals: number;
  activeRuns: number;
  failedRuns: number;
  blockedTasks: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  // The rail preference is a user setting, not a layout constant — keep it.
  const [rail, setRail] = useStoredString('ai-core.sidebar', 'expanded');
  const collapsed = rail === 'collapsed';

  function toggleRail() {
    setRail(collapsed ? 'expanded' : 'collapsed');
  }

  const attention = pendingApprovals + failedRuns + blockedTasks;

  const sections: NavSection[] = [
    {
      title: 'Pilotage',
      items: [
        { href: '/home', label: 'Mission Control', icon: LayoutDashboard },
        { href: '/coo', label: 'COO', icon: Sparkles },
        { href: '/drive', label: 'Mode Voiture', icon: Car },
      ],
    },
    {
      title: 'Opérations',
      items: [
        { href: '/projects', label: 'Projets', icon: FolderKanban },
        { href: '/runs', label: 'Runs', icon: Activity, badge: activeRuns, badgeTone: 'accent' },
        { href: '/approvals', label: 'Approbations', icon: ShieldCheck, badge: pendingApprovals, badgeTone: 'warn' },
      ],
    },
    {
      title: 'Système',
      items: [
        { href: '/agents', label: 'Agents', icon: Bot },
        { href: '/models', label: 'Modèles', icon: Cpu },
        { href: '/admin', label: 'Admin', icon: Users },
        { href: '/settings', label: 'Réglages', icon: Settings },
      ],
    },
  ];

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    // No `router.refresh()` here: `replace` already fetches fresh RSC data, and
    // refreshing on top of it aborts the in-flight render (see login/page.tsx).
    router.replace('/login');
  }

  const isActive = (href: string) =>
    pathname === href || (href !== '/home' && href !== '/coo' && pathname.startsWith(href));

  const content = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className={cn('flex items-center gap-2.5 px-3 py-3.5', collapsed && 'lg:justify-center lg:px-2')}>
        <Link href="/home" className="flex min-w-0 items-center gap-2.5" onClick={() => setMobileOpen(false)}>
          <LogoMark className="size-7 shrink-0 text-ink-1" />
          <div className={cn('min-w-0', collapsed && 'lg:hidden')}>
            <p className="truncate text-[13px] leading-tight font-semibold">
              <span className="text-accent">AI</span> Core
            </p>
            <p className="truncate text-[10px] text-ink-4">TwoDots</p>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="ml-auto rounded p-1 text-ink-4 hover:text-ink-1 lg:hidden"
          aria-label="Fermer la navigation"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* COO entry point — the primary way to work */}
      <div className={cn('px-2.5 pb-2', collapsed && 'lg:px-2')}>
        <button
          type="button"
          onClick={() => {
            openCoo({ source: 'sidebar' });
            setMobileOpen(false);
          }}
          title="Parler au COO (⌘K)"
          className={cn(
            'group flex w-full items-center gap-2 rounded-md bg-accent px-2.5 py-2 text-[12.5px] font-medium text-accent-ink transition-colors hover:bg-accent-hover',
            collapsed && 'lg:justify-center lg:px-0',
          )}
        >
          <Sparkles className="size-4 shrink-0" />
          <span className={cn('flex-1 text-left', collapsed && 'lg:hidden')}>Parler au COO</span>
          <span className={cn('hidden items-center gap-0.5 opacity-70 group-hover:opacity-100 sm:flex', collapsed && 'lg:hidden')}>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
        {sections.map((section) => (
          <div key={section.title} className="mb-3 last:mb-0">
            <p
              className={cn(
                'mb-1 px-2 text-[9.5px] font-semibold tracking-[0.1em] text-ink-4 uppercase',
                collapsed && 'lg:hidden',
              )}
            >
              {section.title}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      title={item.label}
                      className={cn(
                        'group relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] transition-colors duration-150',
                        active ? 'bg-surface-2 text-ink-1' : 'text-ink-3 hover:bg-surface-2/70 hover:text-ink-1',
                        collapsed && 'lg:justify-center lg:px-0',
                      )}
                    >
                      {active ? (
                        <span className="absolute top-1/2 -left-2.5 h-4 w-0.5 -translate-y-1/2 rounded-r bg-accent" aria-hidden="true" />
                      ) : null}
                      <Icon className={cn('size-4 shrink-0', active ? 'text-accent' : 'text-ink-4 group-hover:text-ink-3')} />
                      <span className={cn('flex-1 truncate', collapsed && 'lg:hidden')}>{item.label}</span>
                      {item.badge ? (
                        <Badge tone={item.badgeTone ?? 'idle'} className={cn('px-1 py-0', collapsed && 'lg:hidden')}>
                          {item.badge}
                        </Badge>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {/* Projects */}
        <div className={cn('mb-1 mt-4 flex items-center justify-between px-2', collapsed && 'lg:hidden')}>
          <p className="text-[9.5px] font-semibold tracking-[0.1em] text-ink-4 uppercase">Projets</p>
          <Link href="/projects" onClick={() => setMobileOpen(false)} className="text-[10px] text-ink-4 transition-colors hover:text-accent">
            tous
          </Link>
        </div>

        <ul className="space-y-0.5">
          {projects.length === 0 ? (
            <li className={cn('px-2 py-2 text-[11px] text-ink-4', collapsed && 'lg:hidden')}>Aucun projet</li>
          ) : (
            projects.map((project) => {
              const active = pathname.startsWith(`/projects/${project.id}`);
              return (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}/work`}
                    onClick={() => setMobileOpen(false)}
                    title={project.name}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors duration-150',
                      active ? 'bg-surface-2 text-ink-1' : 'text-ink-3 hover:bg-surface-2/70 hover:text-ink-1',
                      collapsed && 'lg:justify-center lg:px-0',
                    )}
                  >
                    {project.hasActiveRun ? (
                      <span className="size-1.5 shrink-0 animate-pulse-dot rounded-full bg-accent" aria-label="run actif" />
                    ) : (
                      <span className="size-1.5 shrink-0 rounded-full bg-line-strong" />
                    )}
                    <span className={cn('truncate', collapsed && 'lg:hidden')}>{project.name}</span>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </nav>

      {/* Attention summary + account */}
      <div className="border-t border-line p-2.5">
        {attention > 0 ? (
          <div className={cn('mb-2 rounded-md border border-warn/25 bg-warn/8 px-2.5 py-2', collapsed && 'lg:hidden')}>
            <p className="text-[10px] font-semibold tracking-wide text-warn uppercase">À traiter</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-2">
              {[
                pendingApprovals ? `${pendingApprovals} approbation${pendingApprovals > 1 ? 's' : ''}` : null,
                failedRuns ? `${failedRuns} échec${failedRuns > 1 ? 's' : ''}` : null,
                blockedTasks ? `${blockedTasks} bloquée${blockedTasks > 1 ? 's' : ''}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        ) : null}

        <div className={cn('flex items-center gap-2 rounded-md px-1 py-1', collapsed && 'lg:justify-center lg:px-0')}>
          <Avatar name={user.name} />
          <div className={cn('min-w-0 flex-1', collapsed && 'lg:hidden')}>
            <p className="truncate text-xs font-medium text-ink-1">{user.name}</p>
            <p className="truncate text-[10px] text-ink-4">{user.email}</p>
          </div>
          <span className={cn('hidden lg:inline-flex', collapsed && 'lg:hidden')}>
            <ThemeToggle />
          </span>
          <IconButton label="Se déconnecter" onClick={signOut} className={cn(collapsed && 'lg:hidden')}>
            <LogOut className="size-4" />
          </IconButton>
        </div>

        <button
          type="button"
          onClick={toggleRail}
          className={cn(
            'mt-1.5 hidden w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-ink-4 transition-colors hover:bg-surface-2 hover:text-ink-2 lg:flex',
            collapsed && 'lg:justify-center lg:px-0',
          )}
        >
          {collapsed ? <PanelLeftOpen className="size-3.5" /> : <PanelLeftClose className="size-3.5" />}
          <span className={collapsed ? 'lg:hidden' : undefined}>Réduire</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop rail */}
      <aside
        className={cn(
          'hidden shrink-0 border-r border-line bg-surface-1 transition-[width] duration-200 lg:block',
          collapsed ? 'w-[68px]' : 'w-60',
        )}
      >
        <div className="sticky top-0 h-dvh">{content}</div>
      </aside>

      {/* Mobile trigger */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed bottom-4 left-4 z-40 grid size-11 place-items-center rounded-full border border-line-strong bg-surface-2 text-ink-1 shadow-pop lg:hidden"
        aria-label="Ouvrir la navigation"
      >
        <Menu className="size-5" />
      </button>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Fermer la navigation" className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 animate-slide-in border-r border-line bg-surface-1 shadow-pop">{content}</div>
        </div>
      ) : null}
    </>
  );
}
