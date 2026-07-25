import { asc } from "drizzle-orm";
import { db } from "@/db";
import { ventures } from "@/db/schema";
import { dict, type Locale } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui";
import { Nav, Hero, Story } from "@/components/landing-hero";
import { Mission, Method, Brandely, Ecosystem } from "@/components/landing-body";
import { Vision, Contact, Footer } from "@/components/landing-foot";

export default async function Landing({ locale }: { locale: Locale }) {
  const t = dict[locale];
  const rows = await db.select().from(ventures).orderBy(asc(ventures.sort));

  return (
    <ToastProvider>
      <Nav locale={locale} t={t} />
      <main>
        <Hero locale={locale} t={t} />
        <Story t={t} />
        <Mission t={t} />
        <Method t={t} />
        <Brandely t={t} />
        <Ecosystem t={t} locale={locale} ventures={rows} />
        <Vision t={t} />
        <Contact t={t} />
      </main>
      <Footer t={t} locale={locale} ventures={rows.map((r) => r.name)} />
    </ToastProvider>
  );
}
