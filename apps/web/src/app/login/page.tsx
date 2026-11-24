import { redirect } from "next/navigation";
import { currentUser } from "../../lib/api";
import type { SearchParams } from "../../lib/flash";
import { login } from "../actions";
import { ErrorBanner } from "../components";
import { CheckIcon } from "../icons";
import { TestModePill } from "../shell";

// What the app does, in the order it happens. Only things the product really does
// (docs/FEATURES.md): no logos, no customer counts, no claims we cannot back.
const BENEFITS = [
  {
    title: "Contract terms, with evidence",
    text: "Claude reads the PDF and quotes the clause behind every deal term it finds.",
  },
  {
    title: "Payouts from a tested engine",
    text: "The code computes each line of the worksheet; the AI never does the math.",
  },
  {
    title: "A person approves every payment",
    text: "Nothing is paid until you have read the worksheet and approved it.",
  },
];

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
    <div className="auth">
      {/* The brand panel: what this is before asking who you are. On a phone it shrinks
          to the name and the one-line promise above the form. */}
      <section className="auth-brand" aria-label="About Ledgerline">
        <div className="auth-brand-top">
          <span className="brand brand-on-hero">
            <span className="brand-mark" aria-hidden="true" />
            Ledgerline
          </span>
          <TestModePill />
        </div>
        <div className="auth-brand-body">
          <p className="auth-tagline">Artist settlements you can explain, line by line.</p>
          <ul className="auth-benefits">
            {BENEFITS.map((benefit) => (
              <li key={benefit.title}>
                <span className="auth-benefit-icon">
                  <CheckIcon size={16} />
                </span>
                <span>
                  <strong>{benefit.title}</strong>
                  <span className="auth-benefit-text">{benefit.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="auth-footnote">
          A local demo with synthetic data. Stripe runs in test mode, so no real money moves.
        </p>
      </section>

      <section className="auth-panel">
        <div className="card login">
          <h1>Log in</h1>
          <p className="login-lead">Settle, explain and approve artist payouts.</p>
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
          <div className="demo-hint">
            <p className="demo-hint-title">Demo account</p>
            <dl>
              <div>
                <dt>Email</dt>
                <dd>
                  <code>demo@ledgerline.test</code>
                </dd>
              </div>
              <div>
                <dt>Password</dt>
                <dd>
                  <code>ledgerline-demo</code>
                </dd>
              </div>
            </dl>
            <p className="demo-hint-note">Local, synthetic data only.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
