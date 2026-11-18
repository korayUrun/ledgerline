import { apiUrl } from "../../../lib/api";

// Receipt download. The browser asks the web server, which fetches the file from
// the API and passes it through; the browser never talks to the API directly.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ expenseId: string }> },
) {
  const { expenseId } = await params;
  const response = await fetch(apiUrl(`/expenses/${encodeURIComponent(expenseId)}/receipt`), {
    cache: "no-store",
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/octet-stream" },
  });
}
