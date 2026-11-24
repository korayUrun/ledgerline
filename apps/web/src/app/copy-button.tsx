"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "./icons";

type CopyState = "idle" | "copied" | "selected";

// Puts the browser's text selection on an element's contents, so the person can copy
// it with the keyboard when the clipboard API is not available.
function selectContents(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

// A Copy button for a key or a code example. A client component only because the
// clipboard is a browser API. navigator.clipboard exists only on secure pages (https or
// localhost) and can be refused, so when it fails the text in `targetId` is selected
// instead and the person is told to press Cmd/Ctrl+C. What happened is said in words
// next to the button (and announced, role="status"), not only by the icon changing.
export function CopyButton({
  text,
  targetId,
  label = "Copy",
}: {
  text: string;
  // id of the element that shows `text`, selected when copying is not possible.
  targetId: string;
  label?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");

  // "Copied" goes back to "Copy" after a moment, so a second copy also gets feedback.
  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      const target = document.getElementById(targetId);
      if (target) selectContents(target);
      setState("selected");
    }
  }

  return (
    <span className="copy">
      <button type="button" className="secondary copy-button" onClick={() => void copy()}>
        {state === "copied" ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
        {state === "copied" ? "Copied" : label}
      </button>
      <span role="status" className="copy-status">
        {state === "copied" && <span className="visually-hidden">Copied to the clipboard</span>}
        {state === "selected" && "Selected. Press Cmd+C or Ctrl+C to copy."}
      </span>
    </span>
  );
}
