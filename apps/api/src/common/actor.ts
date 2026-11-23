// Who is making a change. Written into AuditLog.actor. For a person, the AuthGuard
// (modules/auth) finds it from the session and controllers read it with
// @CurrentActor().
export type Actor = { userId: string; label: string }; // label: "user:<id>"

// Used for changes nobody asked for directly, e.g. marking a settlement stale after
// noticing that its inputs changed behind the API's back.
export const SYSTEM_ACTOR_LABEL = "system";

export function userActor(userId: string): Actor {
  return { userId, label: `user:${userId}` };
}
