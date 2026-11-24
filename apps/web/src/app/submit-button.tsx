"use client";

import { useFormStatus } from "react-dom";

// A submit button for a server-action form that says it is working while the form is
// being sent, and cannot be clicked twice. A client component only because
// useFormStatus reads the state of the <form> around it in the browser; the forms
// and pages stay server components. It has no `name`, so it adds nothing to what the
// form sends.
export function SubmitButton({
  children,
  pendingLabel = "Working…",
  className,
  disabled = false,
  describedBy,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  // `| undefined` so a caller can pass a value that is sometimes unset
  // (exactOptionalPropertyTypes is on).
  className?: string | undefined;
  disabled?: boolean;
  // id of the text that explains why the button is disabled (aria-describedby).
  describedBy?: string | undefined;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={disabled || pending}
      aria-describedby={describedBy}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
