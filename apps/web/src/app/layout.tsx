import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "../lib/api";
import { logout } from "./actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ledgerline",
  description: "Artist settlements you can explain line by line",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/shows" className="brand">
            Ledgerline
          </Link>
          <div className="row">
            <span className="muted">Synthetic data · Stripe test mode</span>
            {user && (
              <form action={logout} className="row">
                <Link href="/settings/api-keys">API keys</Link>
                <span>{user.name}</span>
                <button type="submit" className="secondary">
                  Log out
                </button>
              </form>
            )}
          </div>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
