'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Boxes,
  BrainCircuit,
  CheckSquare,
  FileStack,
  FolderGit2,
  LayoutGrid,
  ListChecks,
  Package,
  Settings,
  MessagesSquare,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/ui';

const TABS: Array<{ segment: string; label: string; icon: LucideIcon }> = [
  { segment: 'work', label: 'Travail', icon: LayoutGrid },
  { segment: 'chat', label: 'Discussion', icon: MessagesSquare },
  { segment: 'overview', label: 'Vue d’ensemble', icon: Boxes },
  { segment: 'tasks', label: 'Tâches', icon: ListChecks },
  { segment: 'runs', label: 'Runs', icon: Activity },
  { segment: 'repository', label: 'Dépôt', icon: FolderGit2 },
  { segment: 'files', label: 'Fichiers', icon: FileStack },
  { segment: 'memory', label: 'Mémoire', icon: BrainCircuit },
  { segment: 'approvals', label: 'Approbations', icon: CheckSquare },
  { segment: 'artifacts', label: 'Artefacts', icon: Package },
  { segment: 'settings', label: 'Réglages', icon: Settings },
];

/**
 * Project sub-navigation (§26).
 *
 * Scrollable on narrow screens so every section stays reachable; the active tab
 * carries both a colour and an underline because colour alone is not an
 * accessible signal.
 */
export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  return (
    <nav className="flex gap-0.5 overflow-x-auto px-3 lg:px-5" aria-label="Sections du projet">
      {TABS.map((tab) => {
        const href = `${base}/${tab.segment}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.segment}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex shrink-0 items-center gap-1.5 px-3 py-2 text-[12.5px] whitespace-nowrap transition-colors',
              active ? 'text-ink-1' : 'text-ink-3 hover:text-ink-1',
            )}
          >
            <Icon className={cn('size-3.5', active ? 'text-accent' : 'text-ink-4')} />
            {tab.label}
            {active ? (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-t bg-accent" aria-hidden="true" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
