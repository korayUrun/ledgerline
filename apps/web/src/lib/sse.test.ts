import { afterEach, describe, expect, it, vi } from "vitest";
import { postForEvents, readEvents, splitEvents } from "./sse";

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

describe("postForEvents", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the API's message when it refuses before the stream opens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({ statusCode: 409, message: "Recompute first." }, { status: 409 }),
        ),
      ),
    );

    await expect(postForEvents("/assistant/ask", { question: "x" }, () => {})).resolves.toBe(
      "Recompute first.",
    );
  });

  it("hands each event over and returns null once the stream ends", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response('data: {"type":"run_started","runId":"r1"}\n\n', {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const seen: unknown[] = [];

    await expect(
      postForEvents("/assistant/ask", { question: "x" }, (event) => seen.push(event)),
    ).resolves.toBeNull();
    expect(seen).toEqual([{ type: "run_started", runId: "r1" }]);
    expect(fetchMock).toHaveBeenCalledWith("/assistant/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"question":"x"}',
    });
  });
});
