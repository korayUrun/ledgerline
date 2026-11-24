import type { ApiKeyDto } from "@ledgerline/schemas";
import { api, API_URL } from "../../../lib/api";
import { curlExample, mcpConfigExample, sortKeys } from "../../../lib/api-keys";
import type { SearchParams } from "../../../lib/flash";
import { EmptyState, ErrorBanner } from "../../components";
import { CopyButton } from "../../copy-button";
import { CheckIcon, CrossIcon } from "../../icons";
import { PageHeader } from "../../page-header";
import { CreateKeyForm } from "./create-key-form";
import { KeysTable } from "./keys-table";

// API keys for the public /v1 API (F9) and the MCP server (F10), laid out like the key
// pages of developer platforms: what a key may do, create, the list, then how to use
// one. A key can read settlements and flag expenses; it can never approve or pay.
export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const keys = sortKeys(await api.get<ApiKeyDto[]>("/api-keys"));
  // One "now" for the whole list, so every "… ago" is measured from the same moment.
  const now = new Date();
  const activeCount = keys.filter((key) => key.revokedAt === null).length;

  return (
    <>
      <PageHeader
        title="API keys"
        breadcrumb={[{ label: "Developers" }, { label: "API keys" }]}
        subtitle="Let other tools, such as Claude Desktop through the Ledgerline MCP server, read your shows and settlements."
        actions={
          <a href={`${API_URL}/v1/docs`} className="button-link secondary">
            API reference
          </a>
        }
      />
      <ErrorBanner searchParams={await searchParams} />

      <Permissions />
      <CreateKeyForm />

      <div className="section-head">
        <h2>Your keys</h2>
        <p className="section-count">
          {activeCount} active · {keys.length - activeCount} revoked
        </p>
      </div>
      {keys.length === 0 ? (
        <EmptyState title="No keys yet">
          Create one above to connect Claude Desktop or another tool.
        </EmptyState>
      ) : (
        <KeysTable keys={keys} now={now} />
      )}

      <UseYourKey />
    </>
  );
}

// What a key can and cannot do, said up front, in words with a symbol next to each
// line. The "cannot" list is the product's rule: only a logged-in person approves and
// pays.
function Permissions() {
  return (
    <section className="card permissions" aria-label="What a key can do">
      <div>
        <h2 className="permissions-title">A key can</h2>
        <ul className="permissions-list is-allowed">
          <li>
            <CheckIcon size={16} />
            Read shows and settlements
          </li>
          <li>
            <CheckIcon size={16} />
            Explain a worksheet line, with its contract clause
          </li>
          <li>
            <CheckIcon size={16} />
            Flag an expense for a person to review
          </li>
        </ul>
      </div>
      <div>
        <h2 className="permissions-title">A key can never</h2>
        <ul className="permissions-list is-denied">
          <li>
            <CrossIcon size={16} />
            Approve a settlement
          </li>
          <li>
            <CrossIcon size={16} />
            Pay an artist
          </li>
          <li>
            <CrossIcon size={16} />
            Change sales, expenses or terms
          </li>
        </ul>
        <p className="permissions-note">Only a logged-in person can approve and pay.</p>
      </div>
    </section>
  );
}

// Copyable examples with a placeholder where the key goes; the real key is only ever
// in the one-time callout. The MCP config is the README's, with this API's address.
function UseYourKey() {
  const curl = curlExample(API_URL);
  const mcp = mcpConfigExample(API_URL);
  return (
    <section aria-labelledby="use-key-title">
      <div className="section-head">
        <h2 id="use-key-title">Use your key</h2>
      </div>
      <p className="section-intro">
        Send the key as a Bearer token in the <code>Authorization</code> header. Replace{" "}
        <code>&lt;your key&gt;</code> with the key you copied when you created it.
      </p>
      <div className="snippets">
        <article className="card snippet" aria-labelledby="snippet-curl-title">
          <div className="snippet-head">
            <div>
              <h3 id="snippet-curl-title">REST API</h3>
              <p>List your shows from a terminal.</p>
            </div>
            <CopyButton text={curl} targetId="snippet-curl" />
          </div>
          <pre id="snippet-curl">
            <code>{curl}</code>
          </pre>
        </article>
        <article className="card snippet" aria-labelledby="snippet-mcp-title">
          <div className="snippet-head">
            <div>
              <h3 id="snippet-mcp-title">Claude Desktop (MCP server)</h3>
              <p>
                Settings → Developer → Edit Config, add this to{" "}
                <code>claude_desktop_config.json</code>, then restart Claude Desktop. Use the
                absolute paths on your machine; the README&apos;s “Connect the MCP server” shows how
                to find them.
              </p>
            </div>
            <CopyButton text={mcp} targetId="snippet-mcp" />
          </div>
          <pre id="snippet-mcp">
            <code>{mcp}</code>
          </pre>
        </article>
      </div>
    </section>
  );
}
