import type { AgentEventDto } from "@ledgerline/schemas";

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
