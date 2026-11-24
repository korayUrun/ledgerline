import { proxyPost } from "../../../lib/api";

// The Assistant page's question → POST /assistant/ask on the API (SSE back). The
// browser only talks to this web server; the session token is added here.
export async function POST(request: Request) {
  return proxyPost("/assistant/ask", await request.text());
}
