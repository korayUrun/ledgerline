import { proxyPost } from "../../../../lib/api";

// The "Run audit" button → POST /settlements/:id/audit on the API (SSE back).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ settlementId: string }> },
) {
  const { settlementId } = await params;
  return proxyPost(`/settlements/${encodeURIComponent(settlementId)}/audit`);
}
