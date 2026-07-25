import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  createSession,
  destroySession,
  getSessionUser,
  hashPassword,
  publicUser,
  verifyPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ user: null });
  return Response.json({ user: publicUser(user) });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  const action = body.action;

  if (action === "logout") {
    await destroySession();
    return Response.json({ ok: true });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Courriel invalide." }, { status: 400 });
  }

  if (action === "login") {
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = rows[0];
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return Response.json({ error: "Courriel ou mot de passe incorrect." }, { status: 401 });
    }
    await createSession(user.id);
    return Response.json({ user: publicUser(user) });
  }

  if (action === "signup") {
    const name = (body.name ?? "").trim();
    if (name.length < 2) return Response.json({ error: "Nom requis." }, { status: 400 });
    if (password.length < 6) {
      return Response.json({ error: "Le mot de passe doit contenir au moins 6 caractères." }, { status: 400 });
    }
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length) {
      return Response.json({ error: "Un compte existe déjà avec ce courriel." }, { status: 409 });
    }
    const rows = await db
      .insert(users)
      .values({ name, email, passwordHash: hashPassword(password), role: "Fondateur" })
      .returning();
    const user = rows[0];
    await createSession(user.id);
    return Response.json({ user: publicUser(user) });
  }

  return Response.json({ error: "Action inconnue." }, { status: 400 });
}
