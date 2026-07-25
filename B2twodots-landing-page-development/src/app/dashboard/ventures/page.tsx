"use client";

import { useEffect, useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
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
import type { Venture } from "@/db/schema";
import { VENTURE_STATUSES } from "@/lib/constants";

const STATUS_LABELS: Record<string, string> = {
  idee: "À l'étude",
  incubation: "En incubation",
  developpement: "En développement",
  lancee: "Lancée",
};
const STATUS_COLORS: Record<string, string> = {
  idee: "#475569",
  incubation: "#7c5cfc",
  developpement: "#2563EB",
  lancee: "#059669",
};
const SWATCHES = ["#2563EB", "#0D1321", "#475569", "#7c5cfc", "#059669", "#dc2626", "#0891b2"];

type Draft = {
  name: string;
  tagline: string;
  description: string;
  status: string;
  category: string;
  accent: string;
  year: string;
  sort: number;
};

const emptyDraft: Draft = {
  name: "",
  tagline: "",
  description: "",
  status: "idee",
  category: "",
  accent: "#2563EB",
  year: "2026",
  sort: 0,
};

export default function VenturesPage() {
  const toast = useToast();
  const [ventures, setVentures] = useState<Venture[] | null>(null);
  const [modal, setModal] = useState<{ mode: "create" } | { mode: "edit"; id: string } | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () =>
    fetch("/api/ventures")
      .then((r) => r.json())
      .then((d) => setVentures(d.ventures ?? []));

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setDraft({ ...emptyDraft, sort: (ventures?.length ?? 0) + 1 });
    setModal({ mode: "create" });
  }
  function openEdit(v: Venture) {
    setDraft({
      name: v.name,
      tagline: v.tagline,
      description: v.description,
      status: v.status,
      category: v.category,
      accent: v.accent,
      year: v.year,
      sort: v.sort,
    });
    setModal({ mode: "edit", id: v.id });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!modal) return;
    setSaving(true);
    const isEdit = modal.mode === "edit";
    const url = isEdit ? `/api/ventures/${modal.id}` : "/api/ventures";
    try {
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const v = data.venture as Venture;
      setVentures((prev) => {
        const list = prev ?? [];
        return isEdit ? list.map((x) => (x.id === v.id ? v : x)) : [...list, v];
      });
      toast("success", isEdit ? "Entreprise mise à jour." : `${v.name} ajoutée à l'écosystème.`);
      setModal(null);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  /** Optimistic status change straight from the card */
  async function quickStatus(v: Venture, status: string) {
    const prev = ventures ?? [];
    setVentures(prev.map((x) => (x.id === v.id ? { ...x, status } : x)));
    const res = await fetch(`/api/ventures/${v.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      setVentures(prev);
      toast("error", "Le changement de statut a échoué.");
    } else {
      toast("success", `${v.name} → ${STATUS_LABELS[status]}`);
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    setDeleting(true);
    const prev = ventures ?? [];
    setVentures(prev.filter((x) => x.id !== deleteId));
    const res = await fetch(`/api/ventures/${deleteId}`, { method: "DELETE" });
    if (!res.ok) {
      setVentures(prev);
      toast("error", "La suppression a échoué.");
    } else {
      toast("success", "Entreprise retirée de l'écosystème.");
    }
    setDeleteId(null);
    setDeleting(false);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-brand">Écosystème</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink">Entreprises</h1>
          <p className="mt-1.5 text-[14px] text-steel">Imaginer, développer et faire grandir — une filiale à la fois.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4" /> Nouvelle entreprise
        </Button>
      </div>

      <div className="mt-8">
        {ventures === null ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-52" />
            ))}
          </div>
        ) : ventures.length === 0 ? (
          <EmptyState
            icon={<Building2 className="size-6" />}
            title="Aucune entreprise pour l'instant"
            text="L'écosystème TwoDots attend sa première filiale. Ajoutez une entreprise pour commencer."
            action={
              <Button onClick={openCreate}>
                <Plus className="size-4" /> Créer la première entreprise
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence>
              {ventures.map((v, i) => (
                <motion.article
                  key={v.id}
                  layout
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: Math.min(i * 0.05, 0.3) }}
                  className="group relative overflow-hidden rounded-2xl border border-ink/8 bg-white p-6 shadow-card"
                >
                  <div className="absolute inset-x-0 top-0 h-1" style={{ background: v.accent }} />
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex gap-1.5 pt-0.5">
                      <span className="size-3 rounded-full bg-brand" />
                      <span className="size-3 rounded-full" style={{ background: v.accent }} />
                    </span>
                    <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                      <button onClick={() => openEdit(v)} aria-label="Modifier" className="rounded-full p-2 text-steel hover:bg-ink/5 hover:text-ink">
                        <Pencil className="size-3.5" />
                      </button>
                      <button onClick={() => setDeleteId(v.id)} aria-label="Supprimer" className="rounded-full p-2 text-steel hover:bg-red-50 hover:text-red-600">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  <h3 className="mt-3 text-lg font-bold text-ink">{v.name}</h3>
                  <p className="text-[13px] font-medium text-brand">{v.tagline}</p>
                  <p className="mt-2 line-clamp-3 text-[12.5px] leading-relaxed text-steel">{v.description}</p>

                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-ink/6 pt-3.5">
                    <Select
                      value={v.status}
                      onChange={(e) => quickStatus(v, e.target.value)}
                      className="!h-8 w-auto !rounded-full !border-ink/10 !bg-transparent !px-3 !text-[12px] font-semibold"
                      aria-label={`Statut de ${v.name}`}
                    >
                      {VENTURE_STATUSES.map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </Select>
                    <Badge color={STATUS_COLORS[v.status]} className="hidden sm:inline-flex">{v.year}</Badge>
                  </div>
                </motion.article>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Create / edit modal */}
      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal?.mode === "edit" ? "Modifier l'entreprise" : "Nouvelle entreprise"}
        wide
      >
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Nom de l'entreprise</Label>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required placeholder="Ex. : Brandely" />
          </div>
          <div className="sm:col-span-2">
            <Label>Accroche</Label>
            <Input value={draft.tagline} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} placeholder="De l'idée à l'entreprise." />
          </div>
          <div className="sm:col-span-2">
            <Label>Description</Label>
            <Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Ce que cette entreprise construit…" />
          </div>
          <div>
            <Label>Statut</Label>
            <Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              {VENTURE_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Catégorie</Label>
            <Input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="SaaS · Fintech…" />
          </div>
          <div>
            <Label>Année cible</Label>
            <Input value={draft.year} onChange={(e) => setDraft({ ...draft, year: e.target.value })} placeholder="2026" />
          </div>
          <div>
            <Label>Ordre d'affichage</Label>
            <Input type="number" value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: Number(e.target.value) })} />
          </div>
          <div className="sm:col-span-2">
            <Label>Couleur d'accent</Label>
            <div className="flex flex-wrap gap-2.5">
              {SWATCHES.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setDraft({ ...draft, accent: c })}
                  aria-label={`Couleur ${c}`}
                  className={`size-8 rounded-full transition ${draft.accent === c ? "ring-2 ring-ink ring-offset-2" : "hover:scale-110"}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => setModal(null)}>Annuler</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner />}
              {modal?.mode === "edit" ? "Enregistrer" : "Ajouter à l'écosystème"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        busy={deleting}
        title="Retirer cette entreprise ?"
        description="Cette entreprise sera retirée de l'écosystème affiché sur le site. Cette action est irréversible."
      />
    </div>
  );
}
