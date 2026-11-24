import Link from "next/link";
import { GUIDANCE_TONE_LABELS, type Guidance } from "../../../lib/show-guidance";
import { LockIcon } from "../../components";

// Symbols for the card's state; decoration, the word next to it says the same.
const TONE_SYMBOLS: Record<Exclude<Guidance["tone"], "locked">, string> = {
  todo: "→",
  attention: "!",
  waiting: "…",
  done: "✓",
};

// "What to do now": the top of every show page, under the stepper. One sentence on
// what this step needs from the person, and at most one primary button. What to say
// is decided in lib/show-guidance.ts; this only draws it.
export function GuidanceCard({ guidance }: { guidance: Guidance }) {
  const { tone, message, detail, action } = guidance;
  return (
    <section className={`guidance guidance-${tone}`} aria-labelledby="guidance-heading">
      <div className="guidance-body">
        <div className="guidance-head">
          <h2 id="guidance-heading" className="guidance-eyebrow">
            What to do now
          </h2>
          <span className="guidance-state">
            {tone === "locked" ? (
              <LockIcon />
            ) : (
              <span aria-hidden="true">{TONE_SYMBOLS[tone]}</span>
            )}
            {GUIDANCE_TONE_LABELS[tone]}
          </span>
        </div>
        <p className="guidance-message">{message}</p>
        {detail && <p className="guidance-detail">{detail}</p>}
      </div>
      <div className="guidance-actions">
        {action &&
          // An anchor on this page (#expenses) is a plain link: nothing to route.
          (action.href.startsWith("#") ? (
            <a href={action.href} className="button-link">
              {action.label}
            </a>
          ) : (
            <Link href={action.href} className="button-link">
              {action.label}
            </Link>
          ))}
        <Link href="/guide" className="guidance-learn">
          Learn how it works
        </Link>
      </div>
    </section>
  );
}
