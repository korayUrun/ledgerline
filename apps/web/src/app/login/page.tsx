import type { SearchParams } from "../../lib/flash";
import { login } from "../actions";
import { ErrorBanner } from "../components";

// Approval (Phase 5) must be tied to a real person, so every page needs a login.
// The demo account is seeded by `pnpm db:seed`; its data is synthetic.
export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
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
