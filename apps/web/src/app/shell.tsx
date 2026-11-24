import type { UserDto } from "@ledgerline/schemas";
import Link from "next/link";
import { logout } from "./actions";
import { initials } from "../lib/directory";
import {
  ArtistsIcon,
  GuideIcon,
  KeyIcon,
  LogOutIcon,
  ShowsIcon,
  SparkleIcon,
  VenuesIcon,
} from "./icons";
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

// The same links in the sidebar and in the phone menu. NavLink marks the current one
// with aria-current="page", which is also what the CSS styles as active, so the active
// look and what a screen reader announces can never disagree. Three groups, by how
// often they are used: the daily work (shows, the assistant that answers about them,
// and who and where they are with), the developer settings (keys for other tools),
// and the Guide, read once.
function PrimaryNav() {
  return (
    <nav className="sidenav" aria-label="Main">
      <p className="sidenav-label">Workspace</p>
      <NavLink href="/shows">
        <ShowsIcon />
        <span>Shows</span>
      </NavLink>
      <NavLink href="/assistant">
        <SparkleIcon />
        <span>Assistant</span>
      </NavLink>
      <NavLink href="/artists">
        <ArtistsIcon />
        <span>Artists</span>
      </NavLink>
      <NavLink href="/venues">
        <VenuesIcon />
        <span>Venues</span>
      </NavLink>
      <p className="sidenav-label">Developers</p>
      <NavLink href="/settings/api-keys">
        <KeyIcon />
        <span>API keys</span>
      </NavLink>
      <p className="sidenav-label">Help</p>
      <NavLink href="/guide">
        <GuideIcon />
        <span>Guide</span>
      </NavLink>
    </nav>
  );
}

// Who is logged in, and the way out. The form posts to the existing logout action. The
// round badge uses initials() from lib/directory.ts, like the artists and venues lists.
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
