'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, EmptyState, Field, inputClass } from '@/components/ui/primitives';
import { timeAgo } from '@/lib/ui';

type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
};

const ROLE_TONE: Record<string, string> = { owner: 'warn', admin: 'accent', member: 'idle' };

/**
 * Admin Master — manage the organisation's users: list, create, edit email /
 * name / role, activate or deactivate, and set a new password.
 *
 * The server enforces every rule (organisation scope, last-owner protection,
 * role-grant limits); this component only presents and submits.
 */
export function UserAdmin({
  selfId,
  isOwner,
  initialUsers,
}: {
  selfId: string;
  isOwner: boolean;
  /** Rendered by the server on first paint; mutations refetch in handlers. */
  initialUsers: AdminUser[];
}) {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>(initialUsers);
  const [loaded, setLoaded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/users', { cache: 'no-store' });
    const body = (await res.json()) as { users?: AdminUser[]; error?: { message?: string } };
    if (res.ok && body.users) setUsers(body.users);
    else setError(body.error?.message ?? 'Could not load users');
    setLoaded(true);
  }, []);

  async function act(promise: Promise<Response>, done: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await promise;
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? 'Operation failed');
        return;
      }
      await load();
      router.refresh();
      if (done) window.setTimeout(() => setError(null), 0);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-ink-3">
          {users.length} utilisateur(s) dans l’organisation. Les règles (portée, dernier
          propriétaire, rôles) sont appliquées côté serveur.
        </p>
        <Button variant="primary" onClick={() => setCreating(true)}>
          Nouvel utilisateur
        </Button>
      </div>

      {error ? (
        <p role="alert" className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {!loaded ? (
        <EmptyState compact title="Chargement…" />
      ) : users.length === 0 ? (
        <EmptyState compact title="Aucun utilisateur" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12.5px]">
            <thead className="bg-surface-2 text-[10px] tracking-wide text-ink-4 uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Nom</th>
                <th className="px-3 py-2 font-medium">Courriel</th>
                <th className="px-3 py-2 font-medium">Rôle</th>
                <th className="px-3 py-2 font-medium">Statut</th>
                <th className="px-3 py-2 font-medium">Créé</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-surface-1">
              {users.map((user) => (
                <tr key={user.id} className={!user.isActive ? 'opacity-50' : ''}>
                  <td className="px-3 py-2 font-medium text-ink-1">
                    {user.name}
                    {user.id === selfId ? <span className="ml-1 text-[10px] text-ink-4">(vous)</span> : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11.5px] text-ink-2">{user.email}</td>
                  <td className="px-3 py-2">
                    <Badge tone={ROLE_TONE[user.role] ?? 'idle'}>{user.role}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <span className={user.isActive ? 'text-ok' : 'text-danger'}>
                      {user.isActive ? 'actif' : 'désactivé'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-ink-4">{timeAgo(user.createdAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button size="xs" onClick={() => setEditing(user)}>
                        Modifier
                      </Button>
                      <Button size="xs" variant="outline" onClick={() => setResetting(user)}>
                        Mot de passe
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <EditUserDialog
          user={editing}
          selfId={selfId}
          isOwner={isOwner}
          busy={busy}
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            await act(
              fetch(`/api/admin/users/${editing.id}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(values),
              }),
              'updated',
            );
            setEditing(null);
          }}
        />
      ) : null}

      {creating ? (
        <CreateUserDialog
          isOwner={isOwner}
          busy={busy}
          onClose={() => setCreating(false)}
          onSubmit={async (values) => {
            await act(
              fetch('/api/admin/users', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(values),
              }),
              'created',
            );
            setCreating(false);
          }}
        />
      ) : null}

      {resetting ? (
        <ResetPasswordDialog
          user={resetting}
          busy={busy}
          onClose={() => setResetting(null)}
          onSubmit={async (password) => {
            await act(
              fetch(`/api/admin/users/${resetting.id}/password`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ password }),
              }),
              'reset',
            );
            setResetting(null);
          }}
        />
      ) : null}
    </div>
  );
}

function DialogShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 sm:p-8">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface-1 p-5 animate-slide-in">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-4 hover:text-ink-1" aria-label="Fermer">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EditUserDialog({
  user,
  selfId,
  isOwner,
  busy,
  onClose,
  onSubmit,
}: {
  user: AdminUser;
  selfId: string;
  isOwner: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [email, setEmail] = useState(user.email);
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [isActive, setIsActive] = useState(user.isActive);

  const canChangeRole = isOwner || (role !== 'owner' && user.role !== 'owner');

  return (
    <DialogShell title={`Modifier ${user.name}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit({ email, name, role, isActive });
        }}
      >
        <Field label="Nom">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Courriel">
          <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rôle">
            <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} disabled={!canChangeRole}>
              <option value="member">member</option>
              <option value="admin">admin</option>
              <option value="owner">owner</option>
            </select>
          </Field>
          <Field label="Statut">
            <select
              className={inputClass}
              value={isActive ? 'active' : 'inactive'}
              onChange={(e) => setIsActive(e.target.value === 'active')}
            >
              <option value="active">actif</option>
              <option value="inactive">désactivé</option>
            </select>
          </Field>
        </div>
        {user.id === selfId ? (
          <p className="text-[11px] text-warn">C’est votre propre compte : le serveur protège le dernier propriétaire actif.</p>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Enregistrer
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

function CreateUserDialog({
  isOwner,
  busy,
  onClose,
  onSubmit,
}: {
  isOwner: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('member');
  const [password, setPassword] = useState('');

  return (
    <DialogShell title="Nouvel utilisateur" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit({ email, name, role, password });
        }}
      >
        <Field label="Nom">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Courriel">
          <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rôle">
            <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} disabled={!isOwner && role !== 'member'}>
              <option value="member">member</option>
              {isOwner ? (
                <>
                  <option value="admin">admin</option>
                  <option value="owner">owner</option>
                </>
              ) : null}
            </select>
          </Field>
          <Field label="Mot de passe">
            <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Créer
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

function ResetPasswordDialog({
  user,
  busy,
  onClose,
  onSubmit,
}: {
  user: AdminUser;
  busy: boolean;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');

  return (
    <DialogShell title={`Nouveau mot de passe — ${user.name}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit(password);
        }}
      >
        <Field label="Nouveau mot de passe" hint="8 caractères minimum. Haché en scrypt ; jamais stocké en clair.">
          <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </Field>
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Définir
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
