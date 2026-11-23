"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// A link that knows whether it points at the current page, for the top navigation
// and the show tabs. A client component only because the current path is known in
// the browser (usePathname); the pages around it stay server components.
//
// `exact`: active only on this exact path (the show's first tab, whose path is a
// prefix of every other tab). Otherwise also active on pages below it, so the
// replay page of an agent run keeps the "Settlement" tab lit.
export function NavLink({
  href,
  exact = false,
  children,
}: {
  href: string;
  exact?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}
