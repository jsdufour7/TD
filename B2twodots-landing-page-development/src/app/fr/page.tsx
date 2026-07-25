import type { Metadata } from "next";
import Landing from "@/components/landing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Nous transformons les idées en entreprises",
  alternates: { languages: { fr: "/fr", en: "/en" } },
};

export default function Page() {
  return <Landing locale="fr" />;
}
