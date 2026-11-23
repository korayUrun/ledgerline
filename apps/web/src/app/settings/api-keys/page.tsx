import type { ApiKeyDto } from "@ledgerline/schemas";
import { api, API_URL } from "../../../lib/api";
import type { SearchParams } from "../../../lib/flash";
import { formatDateTime } from "../../../lib/format";
import { revokeApiKey } from "../../actions";
import { ErrorBanner } from "../../components";
import { CreateKeyForm } from "./create-key-form";

// API keys for the public /v1 API (F9) and the MCP server (F10). A key can read
// settlements and flag expenses; it can never approve or pay.
export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const keys = await api.get<ApiKeyDto[]>("/api-keys");

  return (
    <>
      <h1>API keys</h1>
      <p className="muted">
        For other tools, such as the Ledgerline MCP server in Claude Desktop. A key can read shows
        and settlements and flag expenses for review. It cannot approve or pay: only a logged-in
        person can. API reference: <a href={`${API_URL}/v1/docs`}>{API_URL}/v1/docs</a>
      </p>
      <ErrorBanner searchParams={await searchParams} />

      <h2>New key</h2>
      <CreateKeyForm apiUrl={API_URL} />

      <h2>Keys</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Key</th>
              <th>Created</th>
              <th>Last used</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id}>
                <td>{key.name}</td>
                <td>
                  <code>ll_{key.prefix}_…</code>
                </td>
                <td>
                  {formatDateTime(key.createdAt)}{" "}
                  <span className="muted">by {key.createdByName}</span>
                </td>
                <td>
                  {key.lastUsedAt ? (
                    formatDateTime(key.lastUsedAt)
                  ) : (
                    <span className="muted">never</span>
                  )}
                </td>
                <td>
                  {key.revokedAt ? (
                    <span className="badge badge-disallowed">Revoked</span>
                  ) : (
                    <span className="badge badge-allowed">Active</span>
                  )}
                </td>
                <td>
                  {!key.revokedAt && (
                    <form action={revokeApiKey.bind(null, key.id)}>
                      <button type="submit" className="danger">
                        Revoke
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No keys yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
