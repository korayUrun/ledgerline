import type { ApiErrorDto } from "@ledgerline/schemas";

// Errors from a server action travel back to the page in the URL
// (?error=…&issue=…&issue=…). No client-side state is needed, the page simply
// renders what the URL says, and a reload clears it.

export type SearchParams = Record<string, string | string[] | undefined>;

export function withError(path: string, error: ApiErrorDto | string): string {
  const params = new URLSearchParams();
  if (typeof error === "string") {
    params.set("error", error);
  } else {
    params.set("error", error.message);
    for (const issue of error.issues ?? []) {
      params.append("issue", issue.path ? `${issue.path}: ${issue.message}` : issue.message);
    }
  }
  return `${path}?${params.toString()}`;
}

export function readError(
  searchParams: SearchParams,
): { message: string; issues: string[] } | null {
  const message = searchParams["error"];
  if (typeof message !== "string") {
    return null;
  }
  const issue = searchParams["issue"];
  return { message, issues: issue === undefined ? [] : Array.isArray(issue) ? issue : [issue] };
}
