import { redirect } from "next/navigation";
import { currentUser } from "../../lib/api";
import type { SearchParams } from "../../lib/flash";
import { login } from "../actions";
import { ErrorBanner } from "../components";

// Approval (Phase 5) must be tied to a real person, so every page needs a login.
// The demo account is seeded by `pnpm db:seed`; its data is synthetic.
export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Already logged in: nothing to do here. currentUser asks the API rather than just
  // checking the cookie, so an expired session still sees the form (checking only the
  // cookie would bounce between /login and /shows, which sends a 401 back here).
  if (await currentUser()) {
    redirect("/shows");
  }
  return (
    <div className="card login">
      <h1>Log in</h1>
      <ErrorBanner searchParams={await searchParams} />
      <form action={login} className="form-grid">
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit">Log in</button>
      </form>
      <p className="muted">
        Local demo: <code>demo@ledgerline.test</code> / <code>ledgerline-demo</code>
      </p>
    </div>
  );
}
