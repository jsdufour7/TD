"use client";

import { useEffect, useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Lightbulb, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Input,
  Label,
  Textarea,
  Select,
  Modal,
  ConfirmDialog,
  EmptyState,
  Skeleton,
  Badge,
  Spinner,
  useToast,
} from "@/components/ui";
import type { Idea } from "@/db/schema";
import {
  IDEA_STAGES,
  IDEA_PRIORITIES,
  STAGE_LABELS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
} from "@/lib/constants";

type Draft = { title: string; description: string; stage: string; priority: string; market: string };
const emptyDraft: Draft = { title: "", description: "", stage: "exploration", priority: "moyenne", market: "" };

export default function IdeasPage() {
  const toast = useToast();
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [modal, setModal] = useState<{ mode: "create" } | { mode: "edit"; id: string } | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filter, setFilter] = useState<string>("toutes");

  useEffect(() => {
    fetch("/api/ideas")
      .then((r) => r.json())
      .then((d) => setIdeas(d.ideas ?? []));
  }, []);

  function openCreate(stage?: string) {
    setDraft({ ...emptyDraft, stage: stage ?? "exploration" });
    setModal({ mode: "create" });
  }
  function openEdit(i: Idea) {
    setDraft({ title: i.title, description: i.description, stage: i.stage, priority: i.priority, market: i.market });
    setModal({ mode: "edit", id: i.id });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!modal) return;
    setSaving(true);
    const isEdit = modal.mode === "edit";
    try {
      const res = await fetch(isEdit ? `/api/ideas/${modal.id}` : "/api/ideas", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const idea = data.idea as Idea;
      setIdeas((prev) => {
        const list = prev ?? [];
        return isEdit ? list.map((x) => (x.id === idea.id ? idea : x)) : [idea, ...list];
      });
      toast("success", isEdit ? "Idée mise à jour." : "Idée ajoutée au pipeline.");
      setModal(null);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  async function move(idea: Idea, dir: -1 | 1) {
    const idx = IDEA_STAGES.indexOf(idea.stage as (typeof IDEA_STAGES)[number]);
    const next = IDEA_STAGES[idx + dir];
    if (!next) return;
    const prev = ideas ?? [];
    setIdeas(prev.map((x) => (x.id === idea.id ? { ...x, stage: next } : x)));
    const res = await fetch(`/api/ideas/${idea.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: next }),
    });
    if (!res.ok) {
      setIdeas(prev);
      toast("error", "Le déplacement a échoué.");
    } else {
      toast("info", `${idea.title} → ${STAGE_LABELS[next]}`);
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    setDeleting(true);
    const prev = ideas ?? [];
    setIdeas(prev.filter((x) => x.id !== deleteId));
    const res = await fetch(`/api/ideas/${deleteId}`, { method: "DELETE" });
    if (!res.ok) {
      setIdeas(prev);
      toast("error", "La suppression a échoué.");
    } else {
      toast("success", "Idée retirée du pipeline.");
    }
    setDeleteId(null);
    setDeleting(false);
  }

  const visible = ideas?.filter((i) => filter === "toutes" || i.priority === filter) ?? [];

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-brand">Pipeline</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink">Idées</h1>
          <p className="mt-1.5 text-[14px] text-steel">Chaque idée suit le chemin : de l'exploration au lancement.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-ink/10 bg-white p-1 text-[12px] font-semibold">
            <button
              onClick={() => setFilter("toutes")}
              className={`rounded-full px-3 py-1.5 transition ${filter === "toutes" ? "bg-ink text-white" : "text-steel hover:text-ink"}`}
            >
              Toutes
            </button>
            {IDEA_PRIORITIES.map((p) => (
              <button
                key={p}
                onClick={() => setFilter(p)}
                className={`rounded-full px-3 py-1.5 capitalize transition ${filter === p ? "bg-ink text-white" : "text-steel hover:text-ink"}`}
              >
                {PRIORITY_LABELS[p]}
              </button>
            ))}
          </div>
          <Button onClick={() => openCreate()}>
            <Plus className="size-4" /> Nouvelle idée
          </Button>
        </div>
      </div>

      {ideas === null ? (
        <div className="mt-8 grid gap-4 md:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : ideas.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<Lightbulb className="size-6" />}
            title="Le pipeline est vide"
            text="Toute entreprise commence par une idée. Capturez la première pour lancer la transformation."
            action={
              <Button onClick={() => openCreate()}>
                <Plus className="size-4" /> Capturer une idée
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-4 md:grid-cols-3 xl:grid-cols-5">
          {IDEA_STAGES.map((stage, si) => {
            const cards = visible.filter((i) => i.stage === stage);
            return (
              <div key={stage} className="flex flex-col rounded-2xl border border-ink/8 bg-white/70 p-3">
                <div className="flex items-center justify-between px-2 pb-3 pt-1">
                  <div className="flex items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-full bg-ink text-[10.5px] font-bold text-white">
                      {si + 1}
                    </span>
                    <h2 className="text-[13px] font-bold text-ink">{STAGE_LABELS[stage]}</h2>
                  </div>
                  <span className="rounded-full bg-ink/6 px-2 py-0.5 text-[11px] font-bold text-steel">{cards.length}</span>
                </div>

                <div className="flex flex-1 flex-col gap-2.5">
                  <AnimatePresence initial={false}>
                    {cards.map((idea) => (
                      <motion.div
                        key={idea.id}
                        layout
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="group rounded-xl border border-ink/8 bg-white p-3.5 shadow-card"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[13px] font-bold leading-snug text-ink">{idea.title}</p>
                          <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100">
                            <button onClick={() => openEdit(idea)} aria-label="Modifier" className="rounded p-1 text-steel hover:bg-ink/5 hover:text-ink">
                              <Pencil className="size-3" />
                            </button>
                            <button onClick={() => setDeleteId(idea.id)} aria-label="Supprimer" className="rounded p-1 text-steel hover:bg-red-50 hover:text-red-600">
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                        </div>
                        {idea.description && (
                          <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-steel">{idea.description}</p>
                        )}
                        <div className="mt-3 flex items-center justify-between">
                          <Badge color={PRIORITY_COLORS[idea.priority]}>{PRIORITY_LABELS[idea.priority]}</Badge>
                          <div className="flex gap-1">
                            <button
                              onClick={() => move(idea, -1)}
                              disabled={si === 0}
                              aria-label="Étape précédente"
                              className="rounded-full border border-ink/10 p-1 text-steel transition hover:border-brand hover:text-brand disabled:opacity-30"
                            >
                              <ChevronLeft className="size-3.5" />
                            </button>
                            <button
                              onClick={() => move(idea, 1)}
                              disabled={si === IDEA_STAGES.length - 1}
                              aria-label="Étape suivante"
                              className="rounded-full border border-ink/10 p-1 text-steel transition hover:border-brand hover:text-brand disabled:opacity-30"
                            >
                              <ChevronRight className="size-3.5" />
                            </button>
                          </div>
                        </div>
                        {idea.market && <p className="mt-2 text-[11px] font-medium text-steel/70">{idea.market}</p>}
                      </motion.div>
                    ))}
                  </AnimatePresence>

                  <button
                    onClick={() => openCreate(stage)}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-ink/15 py-2.5 text-[12px] font-semibold text-steel transition hover:border-brand hover:text-brand"
                  >
                    <Plus className="size-3.5" /> Ajouter
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal?.mode === "edit" ? "Modifier l'idée" : "Nouvelle idée"}
        wide
      >
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Titre de l'idée</Label>
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required placeholder="Ex. : Assistant de lancement localisé" />
          </div>
          <div className="sm:col-span-2">
            <Label>Description</Label>
            <Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Le problème, l'opportunité, l'angle…" />
          </div>
          <div>
            <Label>Étape</Label>
            <Select value={draft.stage} onChange={(e) => setDraft({ ...draft, stage: e.target.value })}>
              {IDEA_STAGES.map((s) => (
                <option key={s} value={s}>{STAGE_LABELS[s]}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Priorité</Label>
            <Select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>
              {IDEA_PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Marché visé</Label>
            <Input value={draft.market} onChange={(e) => setDraft({ ...draft, market: e.target.value })} placeholder="Ex. : Commerce local, Fintech PME…" />
          </div>
          <div className="flex justify-end gap-3 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => setModal(null)}>Annuler</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner />}
              {modal?.mode === "edit" ? "Enregistrer" : "Ajouter au pipeline"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        busy={deleting}
        title="Supprimer cette idée ?"
        description="Cette idée sera définitivement retirée du pipeline TwoDots."
      />
    </div>
  );
}
