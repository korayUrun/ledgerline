"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createApiKey, type CreateApiKeyState } from "../../actions";
import { CopyButton } from "../../copy-button";
import { WarningIcon } from "../../icons";

// A client component only because the new key must stay out of the URL: the server
// action returns it as state, React shows it here, and it is gone on reload. The form
// sends exactly what it always did: one field, `name`.
export function CreateKeyForm() {
  const [state, formAction, pending] = useActionState<CreateApiKeyState, FormData>(createApiKey, {
    status: "idle",
  });
  // "Done" hides the callout for this key only; a key created next shows its own.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  return (
    <section className="card create-key" aria-labelledby="create-key-title">
      <h2 id="create-key-title">Create a key</h2>
      <p className="create-key-hint">
        Name it after the tool that will use it, so you know what stops working if you revoke it.
      </p>
      <form action={formAction} className="row add-form">
        <label>
          Name
          <input name="name" required maxLength={100} placeholder="Claude Desktop" />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create key"}
        </button>
      </form>

      {state.status === "error" && (
        <div className="banner banner-error" role="alert">
          <strong>{state.message}</strong>
        </div>
      )}
      {state.status === "created" && state.key !== dismissedKey && (
        <NewKeyCallout
          name={state.name}
          apiKey={state.key}
          onDone={() => setDismissedKey(state.key)}
        />
      )}
    </section>
  );
}

// The one place the full key is ever shown. Exported so it can be previewed with a
// made-up key without creating a real one.
export function NewKeyCallout({
  name,
  apiKey,
  onDone,
}: {
  name: string;
  apiKey: string;
  onDone: () => void;
}) {
  // Keyboard and screen reader users land on the callout, not on the empty form, so
  // the warning is the first thing they meet.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <div className="key-callout">
      <div className="key-callout-head">
        <WarningIcon />
        <h3 id="new-key-title" ref={heading} tabIndex={-1}>
          Copy the key for “{name}” now
        </h3>
      </div>
      <p className="key-callout-text">
        This is the only time it is shown. Store it somewhere safe, such as a password manager. If
        you lose it, revoke it and create a new one.
      </p>
      <div className="secret-row">
        <code id="new-key-secret" className="secret">
          {apiKey}
        </code>
        <CopyButton text={apiKey} targetId="new-key-secret" label="Copy key" />
      </div>
      <div className="key-callout-foot">
        <button type="button" className="secondary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
