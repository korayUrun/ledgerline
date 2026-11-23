import { proxyPost } from "../../../../lib/api";

// The chat panel's question → POST /settlements/:id/ask on the API (SSE back).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ settlementId: string }> },
) {
  const { settlementId } = await params;
  return proxyPost(`/settlements/${encodeURIComponent(settlementId)}/ask`, await request.text());
}
