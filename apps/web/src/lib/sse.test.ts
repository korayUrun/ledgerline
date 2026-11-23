import { describe, expect, it } from "vitest";
import { readEvents, splitEvents } from "./sse";

describe("splitEvents", () => {
  it("returns the complete events and keeps an unfinished one for later", () => {
    const { events, rest } = splitEvents(
      'data: {"type":"run_started","runId":"r1"}\n\ndata: {"type":"st',
    );

    expect(events).toEqual([{ type: "run_started", runId: "r1" }]);
    expect(rest).toBe('data: {"type":"st');
  });
});

describe("readEvents", () => {
  it("reassembles events that arrive split across network pieces", async () => {
    const pieces = [
      'data: {"type":"run_started","runId":"r1"}\n\nda',
      'ta: {"type":"run_failed","runId":"r1","message":"x"}\n',
      "\n",
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece));
        controller.close();
      },
    });
    const seen: unknown[] = [];

    await readEvents(new Response(body), (event) => seen.push(event));

    expect(seen).toEqual([
      { type: "run_started", runId: "r1" },
      { type: "run_failed", runId: "r1", message: "x" },
    ]);
  });
});
