// Who is making a change. Written into AuditLog.actor.
//
// Two kinds, deliberately separate types:
//   - Actor: a logged-in person. The AuthGuard (modules/auth) finds it from the
//     session; controllers read it with @CurrentActor(). Every service that changes
//     state for a person (compute, confirm terms, approve, pay…) takes an Actor.
//   - ApiKeyActor: a /v1 API key (F9), e.g. the MCP server. Controllers read it with
//     @CurrentApiKey(). It has no userId, so TypeScript refuses to pass it where an
//     Actor is expected: an API key cannot approve or pay even by a coding mistake.
export type Actor = { kind: "user"; userId: string; label: string }; // label: "user:<id>"
export type ApiKeyActor = { kind: "api_key"; apiKeyId: string; label: string }; // "api_key:<id>"

// Used for changes nobody asked for directly, e.g. marking a settlement stale after
// noticing that its inputs changed behind the API's back.
export const SYSTEM_ACTOR_LABEL = "system";

export function userActor(userId: string): Actor {
  return { kind: "user", userId, label: `user:${userId}` };
}

export function apiKeyActor(apiKeyId: string): ApiKeyActor {
  return { kind: "api_key", apiKeyId, label: `api_key:${apiKeyId}` };
}
