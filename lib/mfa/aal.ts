// Pure AAL (Authenticator Assurance Level) transition logic for optional TOTP MFA.
// No Supabase calls happen here — AuthContext/pages call Supabase, then hand the
// resulting levels to this module to decide what to do. Keeping this pure makes
// every transition independently testable without a Supabase mock.

export type AalLevel = "aal1" | "aal2" | null;

export type AalDecisionInput = {
  hasSession: boolean;
  currentLevel: AalLevel;
  nextLevel: AalLevel;
};

// "login": no session, or levels missing entirely — go to /login.
// "continue": session already satisfies the highest level it can reach — render protected content.
// "challenge": session could reach a higher level than it currently has — send to /mfa-challenge.
// "reverify": current > next, which should not happen for a session that hasn't
//   changed since it was issued (e.g. a factor was unenrolled elsewhere after this
//   session's JWT already recorded aal2). Never trust the stale "current" value in
//   this case — re-fetch the user/session and recompute before deciding anything.
export type AalDecision = "login" | "continue" | "challenge" | "reverify";

export function decideAalAction(input: AalDecisionInput): AalDecision {
  const { hasSession, currentLevel, nextLevel } = input;

  if (!hasSession || !currentLevel || !nextLevel) {
    return "login";
  }

  if (currentLevel === "aal1" && nextLevel === "aal1") return "continue";
  if (currentLevel === "aal1" && nextLevel === "aal2") return "challenge";
  if (currentLevel === "aal2" && nextLevel === "aal2") return "continue";
  if (currentLevel === "aal2" && nextLevel === "aal1") return "reverify";

  // Exhaustive given the aal1/aal2 matrix above; unreachable in practice.
  return "login";
}

export function isProtectedContentReady(decision: AalDecision | null): boolean {
  return decision === "continue";
}
