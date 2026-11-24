import type { ApiKeyDto } from "@ledgerline/schemas";
import { api, API_URL } from "../../../lib/api";
import type { SearchParams } from "../../../lib/flash";
import { formatDateTime } from "../../../lib/format";
import { revokeApiKey } from "../../actions";
import { EmptyState, ErrorBanner } from "../../components";
import { PageHeader } from "../../page-header";
import { CreateKeyForm } from "./create-key-form";

// API keys for the public /v1 API (F9) and the MCP server (F10). A key can read
// settlements and flag expenses; it can never approve or pay.
function KeyStatus({ apiKey }: { apiKey: ApiKeyDto }) {
  return apiKey.revokedAt ? (
    <span className="badge badge-disallowed">Revoked</span>
  ) : (
    <span className="badge badge-allowed">Active</span>
  );
}

export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const keys = await api.get<ApiKeyDto[]>("/api-keys");

  return (
    <>
      <PageHeader
        title="API keys"
        subtitle={
          <>
            For other tools, such as the Ledgerline MCP server in Claude Desktop. A key can read
            shows and settlements and flag expenses for review. It cannot approve or pay: only a
            logged-in person can.
          </>
        }
        actions={
          <a href={`${API_URL}/v1/docs`} className="button-link secondary">
            API reference
          </a>
        }
      />
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
              <th className="wide-only">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id}>
                <td>
                  {key.name}
                  {/* On a phone the Status column is off-screen: shown under the name. */}
                  <span className="narrow-only cell-below">
                    <KeyStatus apiKey={key} />
                  </span>
                </td>
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
                <td className="wide-only">
                  <KeyStatus apiKey={key} />
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
                <td colSpan={6} className="empty-cell">
                  <EmptyState title="No keys yet">
                    Create one above to connect another tool.
                  </EmptyState>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
