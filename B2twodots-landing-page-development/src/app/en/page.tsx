import type { Metadata } from "next";
import Landing from "@/components/landing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "We transform ideas into businesses",
  alternates: { languages: { fr: "/fr", en: "/en" } },
};

export default function Page() {
  return <Landing locale="en" />;
}
