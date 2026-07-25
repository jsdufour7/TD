import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSessionUser, publicUser } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard-shell";
import { ToastProvider } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Espace studio" };

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <ToastProvider>
      <DashboardShell user={publicUser(user)}>{children}</DashboardShell>
    </ToastProvider>
  );
}
