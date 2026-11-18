import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical-json.js";

describe("canonicalJson", () => {
  it("gives the same string whatever the key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("keeps array order, because it is part of the data", () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it("sorts keys of objects inside arrays", () => {
    expect(canonicalJson([{ y: 1, x: 2 }])).toBe('[{"x":2,"y":1}]');
  });

  it("handles primitives and null", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson("a")).toBe('"a"');
    expect(canonicalJson(5)).toBe("5");
  });
});
