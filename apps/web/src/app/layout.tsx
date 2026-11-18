import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ledgerline",
  description: "Artist settlements you can explain line by line",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/shows" className="brand">
            Ledgerline
          </Link>
          <span className="muted">Synthetic data · Stripe test mode</span>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
