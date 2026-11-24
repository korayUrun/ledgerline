"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// A link that knows whether it points at the current page, for the sidebar and the
// phone menu. A client component only because the current path is known in the
// browser (usePathname); the pages around it stay server components. Also active on
// pages below it, so a show's pages keep "Shows" lit. (The show stepper finds its
// current step itself: lib/show-steps.ts currentStepIndex.)
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}
