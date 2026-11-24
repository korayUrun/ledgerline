"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { MenuIcon } from "./icons";

// The phone menu: a native <details> disclosure, so it opens and closes without any
// JavaScript and the browser tells screen readers whether it is expanded. The only
// script is a nicety: the layout stays mounted across page changes, so without it the
// menu would still be open over the next page after you tap a link.
export function MobileMenu({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    menu.current?.removeAttribute("open");
  }, [pathname]);

  return (
    <details className="mobile-menu" ref={menu}>
      <summary>
        <MenuIcon />
        <span>Menu</span>
      </summary>
      <div className="mobile-menu-panel">{children}</div>
    </details>
  );
}
