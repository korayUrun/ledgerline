import type { ApiKeyDto } from "@ledgerline/schemas";
import { formatRelativeTime, maskKey } from "../../../lib/api-keys";
import { formatDateTime } from "../../../lib/format";
import { revokeApiKey } from "../../actions";
import { SubmitButton } from "../../submit-button";

// The key list of the API keys page (page.tsx), in its own file so the page stays a
// readable outline. Server components; the revoke form is the existing server action.

// "3 hours ago", with the exact time in the tooltip and in the <time> element.
function When({ iso, now }: { iso: string; now: Date }) {
  return (
    <time dateTime={iso} title={formatDateTime(iso)}>
      {formatRelativeTime(iso, now)}
    </time>
  );
}

// The list. Revoked keys stay for the record but step back (muted, a neutral badge, no
// action). On a phone each row becomes a small card (CSS, .key-table), so nothing
// scrolls sideways; the cell labels only show there.
export function KeysTable({ keys, now }: { keys: ApiKeyDto[]; now: Date }) {
  return (
    <div className="table-wrap key-table">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Key</th>
            <th>Created</th>
            <th>Last used</th>
            <th>Status</th>
            <th>
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const revoked = key.revokedAt !== null;
            return (
              <tr key={key.id} className={revoked ? "is-revoked" : undefined}>
                <td className="key-name">{key.name}</td>
                <td className="key-mask">
                  {/* The prefix only: the list never has the secret. */}
                  <code>{maskKey(key.prefix)}</code>
                </td>
                <td className="key-created">
                  <span className="cell-label">Created</span>
                  {formatDateTime(key.createdAt)}
                  <span className="key-by">by {key.createdByName}</span>
                </td>
                <td className="key-used">
                  <span className="cell-label">Last used</span>
                  {key.lastUsedAt ? (
                    <When iso={key.lastUsedAt} now={now} />
                  ) : (
                    <span className="key-never">Never</span>
                  )}
                </td>
                <td className="key-status">
                  {key.revokedAt ? (
                    <>
                      {/* Neutral, not red: a revoked key is finished, not a fault. */}
                      <span className="badge">Revoked</span>
                      <span className="key-revoked-at">
                        <When iso={key.revokedAt} now={now} />
                      </span>
                    </>
                  ) : (
                    <span className="badge badge-allowed">Active</span>
                  )}
                </td>
                <td className="key-action">{!revoked && <RevokeKey apiKey={key} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Revoking cannot be undone and breaks every tool using the key, so it takes two
// steps: "Revoke…" opens a small confirmation dialog with the consequence in words and
// the real button. It is a native popover (the popover and popovertarget attributes):
// no JavaScript, it opens above the page so the table frame never clips it, and Escape
// or a click outside closes it. The form is the same as before (the bound key id).
function RevokeKey({ apiKey }: { apiKey: ApiKeyDto }) {
  const dialogId = `revoke-${apiKey.id}`;
  return (
    <>
      <button type="button" className="danger revoke-button" popoverTarget={dialogId}>
        Revoke…
      </button>
      <div
        id={dialogId}
        popover="auto"
        role="dialog"
        aria-labelledby={`${dialogId}-title`}
        className="revoke-dialog"
      >
        <h3 id={`${dialogId}-title`}>Revoke key “{apiKey.name}”?</h3>
        <p>
          Tools using it stop working immediately. This cannot be undone; to connect them again,
          create a new key.
        </p>
        <div className="revoke-actions">
          <button
            type="button"
            className="secondary"
            popoverTarget={dialogId}
            popoverTargetAction="hide"
          >
            Cancel
          </button>
          <form action={revokeApiKey.bind(null, apiKey.id)}>
            <SubmitButton className="danger" pendingLabel="Revoking…">
              Revoke key
            </SubmitButton>
          </form>
        </div>
      </div>
    </>
  );
}
