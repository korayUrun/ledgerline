import type { AgentEventDto, ApiErrorDto } from "@ledgerline/schemas";

// Reads the assistant's Server-Sent Events stream in the browser. Each event is a
// "data: <json>" line followed by a blank line. The network delivers the stream in
// arbitrary pieces, so a piece can end in the middle of an event: the unfinished
// tail is kept and completed by the next piece.

export function splitEvents(buffer: string): { events: AgentEventDto[]; rest: string } {
  const chunks = buffer.split("\n\n");
  const rest = chunks.pop() ?? ""; // after the last "\n\n": not complete yet
  const events = chunks
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as AgentEventDto);
  return { events, rest };
}

export async function readEvents(
  response: Response,
  onEvent: (event: AgentEventDto) => void,
): Promise<void> {
  if (!response.body) return;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += value;
    const { events, rest } = splitEvents(buffer);
    buffer = rest;
    events.forEach(onEvent);
  }
}

// One question to the assistant, from the browser: POST to one of this web server's
// route handlers (/settlements/:id/ask|audit, /assistant/ask) and hand each event to
// onEvent as it arrives. Shared by the settlement panel and the Assistant page.
// Returns null when the stream ran to its end (a failed run arrives as a run_failed
// event), or the message to show when the API refused before the stream opened: it
// then answers JSON (400, 404, 409) instead of text/event-stream. A lost connection
// throws, like fetch itself.
export async function postForEvents(
  path: string,
  body: unknown,
  onEvent: (event: AgentEventDto) => void,
): Promise<string | null> {
  const response = await fetch(path, {
    method: "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });
  if (!response.headers.get("content-type")?.startsWith("text/event-stream")) {
    const problem = (await response.json().catch(() => null)) as ApiErrorDto | null;
    return problem?.message ?? `The request failed (${response.status}).`;
  }
  await readEvents(response, onEvent);
  return null;
}
