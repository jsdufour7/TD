"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Inbox, MailOpen, Mail, Trash2, Reply, ArrowLeft } from "lucide-react";
import { Button, ConfirmDialog, EmptyState, Skeleton, useToast } from "@/components/ui";
import { cn } from "@/components/ui";
import type { Message } from "@/db/schema";

export default function MessagesPage() {
  const toast = useToast();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch("/api/messages")
      .then((r) => r.json())
      .then((d) => {
        setMessages(d.messages ?? []);
        if (d.messages?.length) setSelectedId((cur) => cur ?? d.messages[0].id);
      });
  }, []);

  const selected = messages?.find((m) => m.id === selectedId) ?? null;

  async function markRead(m: Message, read: boolean) {
    const prev = messages ?? [];
    setMessages(prev.map((x) => (x.id === m.id ? { ...x, read } : x)));
    const res = await fetch(`/api/messages/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read }),
    });
    if (!res.ok) setMessages(prev);
  }

  function openMessage(m: Message) {
    setSelectedId(m.id);
    if (!m.read) markRead(m, true);
  }

  async function confirmDelete() {
    if (!deleteId) return;
    setDeleting(true);
    const prev = messages ?? [];
    const next = prev.filter((x) => x.id !== deleteId);
    setMessages(next);
    if (selectedId === deleteId) setSelectedId(next[0]?.id ?? null);
    const res = await fetch(`/api/messages/${deleteId}`, { method: "DELETE" });
    if (!res.ok) {
      setMessages(prev);
      toast("error", "La suppression a échoué.");
    } else {
      toast("success", "Message supprimé.");
    }
    setDeleteId(null);
    setDeleting(false);
  }

  const unreadCount = messages?.filter((m) => !m.read).length ?? 0;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-brand">Boîte de réception</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink">Messages</h1>
          <p className="mt-1.5 text-[14px] text-steel">
            {messages === null ? "Chargement…" : `${unreadCount} non lu${unreadCount > 1 ? "s" : ""} · ${messages.length} au total`}
          </p>
        </div>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-ink/8 bg-white shadow-card">
        {messages === null ? (
          <div className="grid h-[480px] grid-cols-[300px_1fr]">
            <div className="space-y-3 border-r border-ink/6 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
            <Skeleton className="m-6 h-full" />
          </div>
        ) : messages.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={<Inbox className="size-6" />}
              title="Aucun message"
              text="Les messages envoyés depuis le site twodots.ca apparaîtront ici."
            />
          </div>
        ) : (
          <div className="grid md:grid-cols-[320px_1fr]">
            {/* List */}
            <div className={cn("max-h-[600px] overflow-y-auto border-r border-ink/6", selected && "hidden md:block")}>
              {messages.map((m) => (
                <button
                  key={m.id}
                  onClick={() => openMessage(m)}
                  className={cn(
                    "flex w-full flex-col gap-1 border-b border-ink/5 px-5 py-4 text-left transition",
                    selectedId === m.id ? "bg-brand-soft/60" : "hover:bg-ink/[0.03]"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("truncate text-[13.5px]", m.read ? "font-medium text-steel" : "font-bold text-ink")}>
                      {m.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-steel/70">
                      {new Date(m.createdAt).toLocaleDateString("fr-CA", { day: "numeric", month: "short" })}
                    </span>
                  </div>
                  <span className={cn("truncate text-[12.5px]", m.read ? "text-steel/80" : "font-semibold text-ink")}>
                    {m.subject || "(Sans objet)"}
                  </span>
                  <span className="truncate text-[12px] text-steel/60">{m.body}</span>
                  {!m.read && <span className="mt-1 size-2 rounded-full bg-brand" />}
                </button>
              ))}
            </div>

            {/* Detail */}
            <div className="flex min-h-[480px] flex-col p-6 sm:p-8">
              <AnimatePresence mode="wait">
                {selected ? (
                  <motion.div
                    key={selected.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="flex flex-1 flex-col"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3 md:hidden">
                        <button onClick={() => setSelectedId(null)} className="rounded-full p-2 text-steel hover:bg-ink/5" aria-label="Retour">
                          <ArrowLeft className="size-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-3.5">
                        <span className="flex size-11 items-center justify-center rounded-full bg-ink text-[14px] font-bold text-white">
                          {selected.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                        </span>
                        <div>
                          <p className="text-[15px] font-bold text-ink">{selected.name}</p>
                          <a href={`mailto:${selected.email}`} className="text-[12.5px] text-brand hover:underline">{selected.email}</a>
                        </div>
                      </div>
                      <span className="hidden shrink-0 text-[12px] text-steel/70 sm:block">
                        {new Date(selected.createdAt).toLocaleString("fr-CA", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>

                    <h2 className="mt-6 text-xl font-bold text-ink">{selected.subject || "(Sans objet)"}</h2>
                    <div className="mt-4 flex-1 rounded-2xl bg-paper p-6 text-[14.5px] leading-relaxed text-steel">
                      {selected.body}
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <a href={`mailto:${selected.email}?subject=Re: ${encodeURIComponent(selected.subject || "TwoDots")}`}>
                        <Button size="sm">
                          <Reply className="size-3.5" /> Répondre
                        </Button>
                      </a>
                      <Button size="sm" variant="outline" onClick={() => markRead(selected, !selected.read)}>
                        {selected.read ? <Mail className="size-3.5" /> : <MailOpen className="size-3.5" />}
                        {selected.read ? "Marquer non lu" : "Marquer lu"}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteId(selected.id)}>
                        <Trash2 className="size-3.5" /> Supprimer
                      </Button>
                      <span className="ml-auto rounded-full bg-ink/5 px-3 py-1 text-[11px] font-semibold text-steel">
                        via {selected.source}
                      </span>
                    </div>
                  </motion.div>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center text-center">
                    <span className="rounded-2xl bg-brand-soft p-4 text-brand"><Mail className="size-6" /></span>
                    <p className="mt-4 text-[14px] font-semibold text-ink">Sélectionnez un message</p>
                    <p className="mt-1 text-[12.5px] text-steel">Choisissez une conversation dans la liste.</p>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        busy={deleting}
        title="Supprimer ce message ?"
        description="Ce message sera définitivement supprimé de la boîte de réception du studio."
      />
    </div>
  );
}
