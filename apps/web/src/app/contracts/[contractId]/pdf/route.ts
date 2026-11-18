import { apiUrl } from "../../../../lib/api";

// The contract PDF for the review page's viewer. Like receipts: the browser asks
// the web server, which fetches the file from the API and passes it through.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ contractId: string }> },
) {
  const { contractId } = await params;
  const response = await fetch(apiUrl(`/contracts/${encodeURIComponent(contractId)}/pdf`), {
    cache: "no-store",
  });
  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/octet-stream",
      // Show it in the page instead of downloading it.
      "content-disposition": "inline",
    },
  });
}
