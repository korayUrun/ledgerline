import { redirect } from "next/navigation";
import { currentUser } from "../../lib/api";
import type { SearchParams } from "../../lib/flash";
import { login } from "../actions";
import { ErrorBanner } from "../components";
import { CheckIcon } from "../icons";

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

// The worksheet in the brand panel's illustration. Static example text written the way
// formatCents writes amounts, so the picture looks like the real worksheet; nothing is
// computed here and no real show is behind it.
const EXAMPLE_LINES = [
  { label: "Gross box office", amount: "$24,000.00" },
  { label: "Less: ticket taxes", amount: "-$1,920.00" },
  { label: "Less: show expenses", amount: "-$4,080.00" },
];

// The moving background behind one half of the page: a drifting aurora and the ruled
// ledger lines from the brand mark. Pure decoration, so hidden from screen readers;
// all motion is CSS and stops under prefers-reduced-motion (globals.css).
function AuthMotion({ onHero }: { onHero: boolean }) {
  return (
    <div className={onHero ? "auth-motion auth-motion-hero" : "auth-motion"} aria-hidden="true">
      <div className="auth-aurora" />
      <div className="auth-rules">
        <div className="auth-rules-lines" />
      </div>
    </div>
  );
}

// A small picture of what the product ends in: worksheet lines, the clause behind the
// payout, and a person's approval. Decorative (aria-hidden) and labelled "Example" for
// anyone who sees it, so it is never mistaken for real data.
function WorksheetPreview() {
  return (
    <div className="auth-preview" aria-hidden="true">
      <div className="auth-preview-card">
        <div className="auth-preview-head">
          <span className="auth-preview-title">Settlement worksheet</span>
          <span className="auth-preview-example">Example</span>
        </div>
        <div className="auth-preview-lines">
          {EXAMPLE_LINES.map((line) => (
            <div className="auth-preview-row" key={line.label}>
              <span>{line.label}</span>
              <span className="auth-preview-amount">{line.amount}</span>
            </div>
          ))}
          <div className="auth-preview-row auth-preview-total">
            <span>Artist payout</span>
            <span className="auth-preview-amount">$15,300.00</span>
          </div>
        </div>
        <div className="auth-preview-foot">
          <span className="auth-preview-clause">
            <CheckIcon size={12} />
            Clause 4.2 · 85% of net
          </span>
          <span className="auth-preview-approved">
            <CheckIcon size={12} />
            Approved by you
          </span>
        </div>
      </div>
    </div>
  );
}

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
        <AuthMotion onHero />
        <div className="auth-brand-top">
          <span className="brand brand-on-hero">
            <span className="brand-mark" aria-hidden="true" />
            Ledgerline
          </span>
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
          <WorksheetPreview />
        </div>
      </section>

      <section className="auth-panel">
        <AuthMotion onHero={false} />
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
