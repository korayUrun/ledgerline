"use client";

import { useActionState, useState } from "react";
import { createApiKey, type CreateApiKeyState } from "../../actions";

// A client component only because the new key must stay out of the URL: the server
// action returns it as state, React shows it here, and it is gone on reload.
export function CreateKeyForm({ apiUrl }: { apiUrl: string }) {
  const [state, formAction, pending] = useActionState<CreateApiKeyState, FormData>(createApiKey, {
    status: "idle",
  });

  return (
    <>
      <form action={formAction} className="card row">
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
      {state.status === "created" && (
        <NewKey name={state.name} apiKey={state.key} apiUrl={apiUrl} />
      )}
    </>
  );
}

function NewKey({ name, apiKey, apiUrl }: { name: string; apiKey: string; apiUrl: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
  }

  return (
    <div className="banner banner-warn" role="status">
      <strong>Copy the key for “{name}” now. It will not be shown again.</strong>
      <div className="row new-key">
        <code>{apiKey}</code>
        <button type="button" className="secondary" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="muted">
        Try it:{" "}
        <code>
          curl -H &quot;Authorization: Bearer {apiKey}&quot; {apiUrl}/v1/shows
        </code>
      </p>
    </div>
  );
}
