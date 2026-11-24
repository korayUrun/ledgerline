import type { UserDto } from "@ledgerline/schemas";
import Link from "next/link";
import { logout } from "./actions";
import { KeyIcon, LogOutIcon, ShowsIcon } from "./icons";
import { MobileMenu } from "./mobile-menu";
import { NavLink } from "./nav-link";

// The frame around every logged-in page: a sidebar on a wide screen, a top bar with a
// menu on a tablet or phone. Both are in the page and CSS shows one of them (display:
// none also hides the other from screen readers), which keeps this a server component
// instead of measuring the window in JavaScript.

export function Brand() {
  return (
    <Link href="/shows" className="brand">
      <span className="brand-mark" aria-hidden="true" />
      Ledgerline
    </Link>
  );
}

// The same two links in the sidebar and in the phone menu. NavLink marks the current
// one with aria-current="page", which is also what the CSS styles as active, so the
// active look and what a screen reader announces can never disagree.
function PrimaryNav() {
  return (
    <nav className="sidenav" aria-label="Main">
      <NavLink href="/shows">
        <ShowsIcon />
        <span>Shows</span>
      </NavLink>
      <NavLink href="/settings/api-keys">
        <KeyIcon />
        <span>API keys</span>
      </NavLink>
    </nav>
  );
}

// "Demo Manager" -> "DM", for the round badge next to the name. Display only.
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

// Who is logged in, and the way out. The form posts to the existing logout action.
function UserBlock({ user }: { user: UserDto }) {
  return (
    <div className="user-block">
      <div className="user-card">
        <span className="avatar" aria-hidden="true">
          {initials(user.name)}
        </span>
        <span className="user-name">{user.name}</span>
      </div>
      <form action={logout}>
        <button type="submit" className="ghost logout">
          <LogOutIcon size={16} />
          Log out
        </button>
      </form>
    </div>
  );
}

export function AppShell({ user, children }: { user: UserDto; children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <PrimaryNav />
        <div className="sidebar-foot">
          <UserBlock user={user} />
        </div>
      </aside>

      <header className="mobile-bar">
        <Brand />
        <MobileMenu>
          <PrimaryNav />
          <UserBlock user={user} />
        </MobileMenu>
      </header>

      <main className="page">{children}</main>
    </div>
  );
}
