'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Field, inputClass } from '@/components/ui/primitives';

type Instruction = {
  id: string;
  kind: string;
  title: string;
  content: string;
  isActive: boolean;
};

/**
 * Project settings (§8, §35).
 *
 * Identity and instructions. Instructions are the highest-weight context the
 * context engine injects, so editing them changes how every future agent behaves
 * in this project.
 */
export function ProjectSettingsForm({
  project,
  instructions,
}: {
  project: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    businessPurpose: string | null;
    sandboxPath: string | null;
  };
  instructions: Instruction[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [newInstruction, setNewInstruction] = useState({ kind: 'technical', title: '', content: '' });

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('save');
    setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/projects/${project.id}/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          description: String(form.get('description') ?? ''),
          businessPurpose: String(form.get('businessPurpose') ?? ''),
        }),
      });
      setMessage(response.ok ? 'Saved.' : 'Could not save.');
      router.refresh();
    } catch {
      setMessage('Network error.');
    } finally {
      setBusy(null);
    }
  }

  async function addInstruction(event: React.FormEvent) {
    event.preventDefault();
    setBusy('instruction');
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${project.id}/instructions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(newInstruction),
      });
      if (response.ok) {
        setNewInstruction({ kind: 'technical', title: '', content: '' });
        router.refresh();
      } else {
        setMessage('Could not add the instruction.');
      }
    } finally {
      setBusy(null);
    }
  }

  async function toggleInstruction(instruction: Instruction) {
    setBusy(instruction.id);
    try {
      await fetch(`/api/projects/${project.id}/instructions`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: instruction.id, isActive: !instruction.isActive }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={save} className="space-y-4 rounded-lg border border-line bg-surface-1 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input className={inputClass} value={project.name} disabled />
          </Field>
          <Field label="Slug">
            <input className={`${inputClass} font-mono`} value={project.slug} disabled />
          </Field>
        </div>
        <Field label="Business purpose" hint="Agents use this to judge scope.">
          <textarea
            name="businessPurpose"
            className={`${inputClass} min-h-20 resize-y`}
            defaultValue={project.businessPurpose ?? ''}
          />
        </Field>
        <Field label="Description">
          <textarea name="description" className={`${inputClass} min-h-16 resize-y`} defaultValue={project.description ?? ''} />
        </Field>

        <div className="flex items-center gap-3 border-t border-line pt-3">
          <Button type="submit" variant="primary" loading={busy === 'save'}>
            Save changes
          </Button>
          {message ? <span className="text-[11.5px] text-ink-3">{message}</span> : null}
        </div>
      </form>

      <section className="rounded-lg border border-line bg-surface-1">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-medium text-ink-1">Instructions</h2>
          <p className="text-[11px] text-ink-3">
            Injected into every agent prompt in this project. Deactivate rather than delete to keep history.
          </p>
        </header>

        <ul className="divide-y divide-line">
          {instructions.length === 0 ? (
            <li className="px-4 py-4 text-center text-[11.5px] text-ink-4">No instructions yet</li>
          ) : (
            instructions.map((instruction) => (
              <li key={instruction.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Badge tone="info">{instruction.kind}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-1">{instruction.title}</span>
                  <Button
                    size="xs"
                    loading={busy === instruction.id}
                    onClick={() => void toggleInstruction(instruction)}
                  >
                    {instruction.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
                <pre
                  className={`mt-1.5 whitespace-pre-wrap font-mono text-[11px] ${instruction.isActive ? 'text-ink-3' : 'text-ink-4 line-through'}`}
                >
                  {instruction.content}
                </pre>
              </li>
            ))
          )}
        </ul>

        <form onSubmit={addInstruction} className="space-y-3 border-t border-line p-4">
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <Field label="Kind">
              <select
                className={inputClass}
                value={newInstruction.kind}
                onChange={(e) => setNewInstruction({ ...newInstruction, kind: e.target.value })}
              >
                <option value="product">product</option>
                <option value="technical">technical</option>
                <option value="design">design</option>
                <option value="workflow">workflow</option>
              </select>
            </Field>
            <Field label="Title">
              <input
                className={inputClass}
                value={newInstruction.title}
                onChange={(e) => setNewInstruction({ ...newInstruction, title: e.target.value })}
                placeholder="Design system rules"
                required
              />
            </Field>
          </div>
          <Field label="Content">
            <textarea
              className={`${inputClass} min-h-24 resize-y font-mono text-[11.5px]`}
              value={newInstruction.content}
              onChange={(e) => setNewInstruction({ ...newInstruction, content: e.target.value })}
              placeholder={'- Use the existing Button component\n- Never add a new UI library'}
              required
            />
          </Field>
          <Button type="submit" loading={busy === 'instruction'} disabled={!newInstruction.title || !newInstruction.content}>
            Add instruction
          </Button>
        </form>
      </section>
    </div>
  );
}
