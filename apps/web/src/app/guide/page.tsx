import type { SettlementStatus } from "@ledgerline/schemas";
import Link from "next/link";
import { SETTLEMENT_STATUS_LABELS, SHOW_STEPS } from "../../lib/show-steps";
import { StatusBadge } from "../components";
import { PageHeader } from "../page-header";

// "How Ledgerline works": the flow of a show, who does what, what each settlement
// status means, and the questions people ask. Static text only, no API calls. The step
// titles come from SHOW_STEPS, so this page and the stepper never name them differently.

// What the person does and what Ledgerline does in each step, in SHOW_STEPS order.
const STEP_ROLES: { person: string; system: string }[] = [
  {
    person:
      "Import the box office CSV, add the show's expenses, and decide each expense: allow it or disallow it.",
    system:
      "Checks the file and lists every problem at once. Amounts are kept in exact cents, never rounded.",
  },
  {
    person: "Upload the artist contract as a PDF.",
    system:
      "Claude reads it in the background and extracts the deal terms, each with the quote it came from. Nothing counts yet.",
  },
  {
    person:
      "Check each term against its quote and confirm, or type the terms in by hand if there is no PDF.",
    system: "Saves each confirmation as a new version of the terms; older versions are kept.",
  },
  {
    person:
      "Compute, read the worksheet, resolve any flags, submit for review, then approve the payout.",
    system:
      "The settlement engine computes every line from the terms and the sales. The assistant can audit expenses and explain lines. After approval, Stripe (test mode) sends the payout.",
  },
];

// In the order a settlement moves through them.
const STATUS_MEANINGS: { status: SettlementStatus; meaning: string }[] = [
  { status: "draft", meaning: "Created, but not computed yet." },
  {
    status: "computed",
    meaning: "The engine has a result for the current inputs. Check it, then submit for review.",
  },
  {
    status: "stale",
    meaning:
      "Sales, expenses or terms changed after computing. The numbers shown are old until you recompute.",
  },
  { status: "in_review", meaning: "Submitted, and waiting for a person to approve the payout." },
  {
    status: "approved",
    meaning: "A person approved the payout. The inputs are locked and the payment is queued.",
  },
  { status: "paying", meaning: "The payout is being sent through Stripe." },
  { status: "paid", meaning: "Stripe confirmed the payout. The settlement is final." },
  {
    status: "payment_failed",
    meaning: "The payout did not go through. Fix the cause and retry; the inputs stay locked.",
  },
];

const FAQ: { question: string; answer: React.ReactNode }[] = [
  {
    question: "Why can't I submit for review?",
    answer:
      "A settlement goes to review only when it is computed from the current inputs, no expense is still pending (each is allowed or disallowed), and every assistant flag is accepted or dismissed. The Settlement step says which one is missing, next to the button.",
  },
  {
    question: "What does stale mean?",
    answer:
      "Something the settlement was computed from changed afterwards: a ticket sale, an expense or the deal terms. The old numbers stay visible, marked as outdated, until you recompute.",
  },
  {
    question: "Can the assistant approve a payment?",
    answer:
      "No. The assistant can read the settlement, recompute it, flag expenses and explain lines, but it has no way to approve or pay. Neither can API keys or the MCP server. Only a person signed in here can approve.",
  },
  {
    question: "Does the AI calculate the payout?",
    answer:
      "No. Claude only reads the contract and explains. Every amount comes from the settlement engine: plain, tested code that works in whole cents and gives the same result every time.",
  },
  {
    question: "Can I change anything after approval?",
    answer:
      "No. From approval on, the sales, expenses, contract and terms are locked, so the payout always matches what was approved. They can still be read.",
  },
  {
    question: "Where do I see why a number is what it is?",
    answer: (
      <>
        In the worksheet on the Settlement step: every line names the contract clause it applies and
        the sales or expense rows it was computed from. You can also ask the assistant, which
        answers from the same lines.
      </>
    ),
  },
];

export default function GuidePage() {
  return (
    <>
      <PageHeader
        title="How Ledgerline works"
        subtitle="Settling a show means working out what the venue pays the artist, from the contract, the ticket sales and the show's expenses. Every show goes through four steps."
        actions={
          <Link href="/shows" className="button-link secondary">
            Go to shows
          </Link>
        }
      />

      <section className="guide-principle" aria-labelledby="principle-heading">
        <h2 id="principle-heading">
          The AI reads and explains, the code calculates, a person approves.
        </h2>
        <ul className="guide-roles">
          <li>
            <strong>The AI reads and explains.</strong> Claude extracts the deal terms from the
            contract, with quotes, and the assistant explains the result and flags doubtful
            expenses.
          </li>
          <li>
            <strong>The code calculates.</strong> A settlement engine computes every amount, the
            same way every time, so each line can be checked.
          </li>
          <li>
            <strong>A person approves.</strong> Only you confirm the terms and approve the payout.
            Nothing moves money without you.
          </li>
        </ul>
      </section>

      <h2>The four steps</h2>
      <ol className="guide-steps">
        {SHOW_STEPS.map((step, index) => {
          const roles = STEP_ROLES[index];
          return (
            <li key={step.number} className="guide-step">
              <span className="guide-step-number" aria-hidden="true">
                {step.number}
              </span>
              <div>
                <h3>
                  <span className="visually-hidden">Step {step.number}: </span>
                  {step.title}
                </h3>
                <p className="guide-step-desc">{step.description}.</p>
                {roles && (
                  <dl className="guide-step-roles">
                    <div>
                      <dt>You</dt>
                      <dd>{roles.person}</dd>
                    </div>
                    <div>
                      <dt>Ledgerline</dt>
                      <dd>{roles.system}</dd>
                    </div>
                  </dl>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <h2>Settlement statuses</h2>
      <dl className="guide-statuses">
        {STATUS_MEANINGS.map(({ status, meaning }) => (
          <div key={status}>
            <dt>
              <StatusBadge status={status} label={SETTLEMENT_STATUS_LABELS[status]} />
            </dt>
            <dd>{meaning}</dd>
          </div>
        ))}
      </dl>

      <h2>Questions</h2>
      <div className="guide-faq">
        {FAQ.map(({ question, answer }) => (
          <section key={question} className="guide-faq-item">
            <h3>{question}</h3>
            <p>{answer}</p>
          </section>
        ))}
      </div>
    </>
  );
}
