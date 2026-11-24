import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { currentUser } from "../lib/api";
import { AppShell } from "./shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ledgerline",
  description: "Artist settlements you can explain line by line",
};

// next/font downloads the fonts at build time and serves them from this app, so the
// browser never calls Google. Exposed as CSS variables, used in globals.css.
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        {/* Logged in: the sidebar shell. Logged out (the login page, or an error before
            login): no navigation, since none of its links would work yet. */}
        {user ? (
          <AppShell user={user}>{children}</AppShell>
        ) : (
          <main className="page-public">{children}</main>
        )}
      </body>
    </html>
  );
}
