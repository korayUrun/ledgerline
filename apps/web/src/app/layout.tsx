import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import { currentUser } from "../lib/api";
import { logout } from "./actions";
import { NavLink } from "./nav-link";
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
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/shows" className="brand">
              <span className="brand-mark" aria-hidden="true" />
              Ledgerline
            </Link>
            {user && (
              <nav className="topnav" aria-label="Main">
                <NavLink href="/shows">Shows</NavLink>
                <NavLink href="/settings/api-keys">API keys</NavLink>
              </nav>
            )}
            <div className="topbar-end">
              <span className="env-pill" title="All data is synthetic; Stripe runs in test mode">
                Test mode
              </span>
              {user && (
                <form action={logout} className="user">
                  <span className="user-name">{user.name}</span>
                  <button type="submit" className="ghost">
                    Log out
                  </button>
                </form>
              )}
            </div>
          </div>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
