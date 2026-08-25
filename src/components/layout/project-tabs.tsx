'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/ui';

const TABS = [
  { segment: 'work', label: 'Work' },
  { segment: 'chat', label: 'Chat' },
  { segment: 'overview', label: 'Overview' },
  { segment: 'tasks', label: 'Tasks' },
  { segment: 'runs', label: 'Runs' },
  { segment: 'repository', label: 'Repository' },
  { segment: 'files', label: 'Files' },
  { segment: 'memory', label: 'Memory' },
  { segment: 'approvals', label: 'Approvals' },
  { segment: 'artifacts', label: 'Artifacts' },
  { segment: 'settings', label: 'Settings' },
];

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  return (
    <nav className="flex gap-0.5 overflow-x-auto px-3 lg:px-5" aria-label="Project sections">
      {TABS.map((tab) => {
        const href = `${base}/${tab.segment}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab.segment}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative shrink-0 px-3 py-2 text-[12.5px] transition-colors',
              active ? 'text-ink-1' : 'text-ink-3 hover:text-ink-1',
            )}
          >
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
