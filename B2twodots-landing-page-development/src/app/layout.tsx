import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://twodots.ca"),
  title: {
    default: "TwoDots.ca — Nous transformons les idées en entreprises",
    template: "%s · TwoDots.ca",
  },
  description:
    "TwoDots est un studio entrepreneurial québécois qui transforme des concepts en entreprises numériques grâce à la stratégie, au design, à la technologie et à l'intelligence artificielle.",
  openGraph: {
    title: "TwoDots.ca — Nous transformons les idées en entreprises",
    description: "Studio entrepreneurial · Stratégie, marque, technologie, exécution.",
    locale: "fr_CA",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={poppins.variable}>
      <body className="bg-paper text-ink antialiased">{children}</body>
    </html>
  );
}
