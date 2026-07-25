import { db } from "@/db";
import { messages } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim();
  const bodyText = (body.body ?? "").trim();

  if (!name || !email || !bodyText) {
    return Response.json({ error: "Champs requis manquants." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Courriel invalide." }, { status: 400 });
  }

  const rows = await db
    .insert(messages)
    .values({
      name,
      email,
      subject: (body.subject ?? "").trim().slice(0, 200),
      body: bodyText.slice(0, 4000),
      source: "twodots.ca",
    })
    .returning();

  return Response.json({ message: rows[0] }, { status: 201 });
}
