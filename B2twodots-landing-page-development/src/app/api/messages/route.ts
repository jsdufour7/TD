import { desc } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Non autorisé." }, { status: 401 });
  const rows = await db.select().from(messages).orderBy(desc(messages.createdAt));
  return Response.json({ messages: rows });
}
