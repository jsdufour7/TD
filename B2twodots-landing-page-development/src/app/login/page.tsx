import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { AuthCard } from "@/components/auth-card";
import { ToastProvider } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Connexion — Espace studio" };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");
  return (
    <ToastProvider>
      <AuthCard mode="login" />
    </ToastProvider>
  );
}
