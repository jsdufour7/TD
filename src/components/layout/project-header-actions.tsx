'use client';

import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { openCoo } from '@/lib/ui-events';

/**
 * Project-scoped COO entry point.
 *
 * The drawer already knows which project the URL points at, so this button only
 * has to summon it — no project id to thread through props.
 */
export function ProjectHeaderActions() {
  return (
    <Button variant="primary" size="sm" onClick={() => openCoo({ source: 'project-header' })}>
      <Sparkles className="size-3.5" />
      COO
    </Button>
  );
}
