'use client';

import { Bell, Search, Sparkles } from 'lucide-react';
import { openCoo } from '@/lib/ui-events';
import { Avatar } from '@/components/ui/primitives';

export function Topbar({ user }: { user: { name: string; email: string } }) {
  return (
    <header className="sticky top-0 z-30 hidden h-14 items-center gap-4 border-b border-line bg-surface-0/95 px-5 backdrop-blur lg:flex">
      <button
        type="button"
        onClick={() => openCoo({ source: 'topbar' })}
        className="group flex h-9 w-full max-w-[680px] items-center gap-2.5 rounded-lg border border-line bg-surface-1 px-3 text-left text-[12px] text-ink-4 shadow-card transition-colors hover:border-accent/40 hover:text-ink-2"
      >
        <Search className="size-4 text-ink-4 group-hover:text-accent" />
        <span className="flex-1 truncate">Demande au COO… ex. « Analyse ce projet et choisis le bon compute »</span>
        <span className="rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] text-ink-4">Ctrl K</span>
      </button>

      <div className="ml-auto flex items-center gap-4">
        <div className="flex items-center gap-2 text-[11px] text-ink-3">
          <span className="size-2 rounded-full bg-ok shadow-[0_0_0_3px_rgb(52_211_153/0.08)]" />
          AI Core actif
        </div>
        <button type="button" className="grid size-8 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink-1" aria-label="Notifications">
          <Bell className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => openCoo({ source: 'topbar' })}
          className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-2"
        >
          <Avatar name={user.name} />
          <div className="max-w-36 text-left">
            <p className="truncate text-[11px] font-medium text-ink-1">{user.name}</p>
            <p className="truncate text-[9.5px] text-ink-4">Administrateur</p>
          </div>
          <Sparkles className="size-3.5 text-accent" />
        </button>
      </div>
    </header>
  );
}
