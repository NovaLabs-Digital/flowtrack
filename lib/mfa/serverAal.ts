// Server-side (API route) mirror of the exact predicate implemented in
// flowtrack_private.mfa_access_allowed() (lib/security/migration_mfa_enforcement.sql):
//
//   valid_aal AND (NOT enrolled OR aal = 'aal2')
//
// Kept as its own pure function (not reusing lib/mfa/aal.ts's four-way
// client decision enum) because a stateless server request has no session
// to redirect/re-fetch from — it needs a single boolean answer per request,
// computed from data that was just fetched live (never cached/stale).

export type ServerAalDecisionInput = {
  // Untyped on purpose: this comes from a JWT claim (arbitrary JSON) and
  // must never be trusted to already be a valid level.
  currentAal: unknown;
  hasVerifiedFactor: boolean;
};

export function isValidAalClaim(value: unknown): value is "aal1" | "aal2" {
  return value === "aal1" || value === "aal2";
}

export function decideServerMfaAccess(input: ServerAalDecisionInput): boolean {
  const { currentAal, hasVerifiedFactor } = input;

  if (!isValidAalClaim(currentAal)) {
    return false;
  }

  // currentAal is now known to be exactly "aal1" | "aal2".
  return !hasVerifiedFactor || currentAal === "aal2";
}
