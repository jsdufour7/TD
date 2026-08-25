'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, inputClass } from '@/components/ui/primitives';

/**
 * Project creation wizard (§35).
 *
 * Captures identity, business purpose, application type and initial product and
 * technical instructions. The instructions become real `project_instructions`
 * rows that the context engine injects into every agent prompt.
 */
export function NewProjectDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [businessPurpose, setBusinessPurpose] = useState('');
  const [applicationType, setApplicationType] = useState('web-application');
  const [productInstructions, setProductInstructions] = useState('');
  const [technicalInstructions, setTechnicalInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const instructions = [
        productInstructions.trim()
          ? { kind: 'product' as const, title: 'Product instructions', content: productInstructions.trim() }
          : null,
        technicalInstructions.trim()
          ? { kind: 'technical' as const, title: 'Technical instructions', content: technicalInstructions.trim() }
          : null,
      ].filter((i): i is { kind: 'product' | 'technical'; title: string; content: string } => i !== null);

      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || undefined,
          businessPurpose: businessPurpose || undefined,
          applicationType,
          instructions: instructions.length > 0 ? instructions : undefined,
        }),
      });
      const body = (await response.json()) as { project?: { id: string }; error?: { message?: string } };
      if (!response.ok || !body.project) {
        setError(body.error?.message ?? 'Could not create the project');
        return;
      }
      // `push` already fetches fresh RSC data for the new project page; a
      // `refresh()` on top of it would abort that in-flight render.
      router.push(`/projects/${body.project.id}/work`);
    } catch {
      setError('Network error while creating the project');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        New project
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Create project"
            className="w-full max-w-2xl rounded-lg border border-line bg-surface-1 shadow-2xl animate-slide-in"
          >
            <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <div>
                <h2 className="text-sm font-semibold">Create a project</h2>
                <p className="text-[11px] text-ink-3">
                  A persistent workspace. AI Core restores its context every time you open it.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-ink-4 hover:bg-surface-3 hover:text-ink-1"
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            <form onSubmit={submit} className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Project name" required>
                  <input
                    className={inputClass}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Panorama"
                    required
                    autoFocus
                  />
                </Field>
                <Field label="Application type">
                  <select
                    className={inputClass}
                    value={applicationType}
                    onChange={(e) => setApplicationType(e.target.value)}
                  >
                    <option value="web-application">Web application</option>
                    <option value="api">API / backend service</option>
                    <option value="internal-tool">Internal tool</option>
                    <option value="mobile">Mobile application</option>
                    <option value="data">Data / analytics</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
              </div>

              <Field label="Business purpose" hint="Why this product exists. Agents use this to judge scope.">
                <textarea
                  className={`${inputClass} min-h-20 resize-y`}
                  value={businessPurpose}
                  onChange={(e) => setBusinessPurpose(e.target.value)}
                  placeholder="Panorama helps agencies deliver client reporting without manual spreadsheet work."
                />
              </Field>

              <Field label="Description">
                <textarea
                  className={`${inputClass} min-h-16 resize-y`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short description of the product."
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Product instructions" hint="Injected into every agent prompt.">
                  <textarea
                    className={`${inputClass} min-h-28 resize-y font-mono text-xs`}
                    value={productInstructions}
                    onChange={(e) => setProductInstructions(e.target.value)}
                    placeholder={'- Tone: professional, plain language\n- Always support multi-client workspaces'}
                  />
                </Field>
                <Field label="Technical instructions">
                  <textarea
                    className={`${inputClass} min-h-28 resize-y font-mono text-xs`}
                    value={technicalInstructions}
                    onChange={(e) => setTechnicalInstructions(e.target.value)}
                    placeholder={'- Next.js App Router + TypeScript strict\n- Drizzle + PostgreSQL\n- No new UI libraries'}
                  />
                </Field>
              </div>

              {error ? (
                <p role="alert" className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {error}
                </p>
              ) : null}

              <div className="flex justify-end gap-2 border-t border-line pt-4">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={submitting}>
                  Create project
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
