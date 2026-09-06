import type { SupabaseClient } from "@supabase/supabase-js";
import { decideServerMfaAccess } from "./serverAal";
import { hasVerifiedTotpFactor } from "./factors";

// Every MFA/AAL denial from a server route must return this exact body and
// status — never a message that could let a caller distinguish *why* access
// was denied (invalid AAL vs. wrong level vs. an internal lookup failure).
export const MFA_DENIAL_STATUS = 403;
export const MFA_DENIAL_BODY = { error: "Forbidden" } as const;

export type MfaAuthorizationResult = { authorized: boolean };

// The task this helper was built for specified calling
// `auth.mfa.getAuthenticatorAssuranceLevel(token)` as a documented,
// network-validating, JWT-argument API that also fetches current factors.
// That method does not exist in this form. Verified against the installed
// @supabase/auth-js package (v2.84.0):
//   - node_modules/@supabase/auth-js/dist/main/lib/types.d.ts:
//     `getAuthenticatorAssuranceLevel(): Promise<...>` — zero parameters.
//   - node_modules/@supabase/auth-js/dist/main/GoTrueClient.js,
//     `_getAuthenticatorAssuranceLevel()` — reads only `this.getSession()`
//     (the calling client's own locally-cached session) and decodes that
//     session's JWT locally via `decodeJWT()`, with no signature
//     verification and no network call.
// A service-role admin client instantiated fresh in an API route has no
// relevant cached session for the caller's bearer token — this method
// cannot be used to evaluate an arbitrary incoming request's AAL at all.
//
// This helper instead uses:
//   - `auth.getClaims(token)` — verifies the token (via cached JWKS +
//     WebCrypto signature verification for asymmetric-signing projects, or
//     an Auth-server `getUser()` round-trip for HS256 projects) and returns
//     its claims, including the required `aal` claim.
//   - `auth.admin.mfa.listFactors({ userId })` — the documented Admin API,
//     a live, server-side, per-call factor lookup (not a value cached in
//     the token), consistent with this project's fail-closed requirement
//     that only a live query-time lookup is trusted for enrollment state.
export async function checkMfaAuthorization(
  supabaseAdmin: SupabaseClient,
  token: string,
  userId: string
): Promise<MfaAuthorizationResult> {
  const { data: claimsData, error: claimsError } = await supabaseAdmin.auth.getClaims(token);

  if (claimsError || !claimsData || claimsData.claims.sub !== userId) {
    // Fails closed on any verification error, and on any mismatch between
    // the already-verified user id and the token's own subject claim —
    // defense against ever evaluating one identity's AAL for a different
    // identity's request.
    return { authorized: false };
  }

  const currentAal = claimsData.claims.aal;

  const { data: factorData, error: factorError } = await supabaseAdmin.auth.admin.mfa.listFactors({
    userId,
  });

  if (factorError || !factorData) {
    // Fails closed if enrollment state is unverifiable — never assumed
    // "not enrolled" by default.
    return { authorized: false };
  }

  // factorData.factors is the Admin API's Factor[] (factor_type: "totp" |
  // "phone" | "webauthn"), which is structurally compatible with the
  // MfaFactor[] this shared helper expects (factor_type: string) — no cast
  // needed. hasVerifiedTotpFactor() itself filters to factor_type ===
  // "totp" && status === "verified": FlowTrack Phase 1B supports TOTP only,
  // so a verified phone or webauthn factor must never count as enrolled.
  const hasVerifiedFactor = hasVerifiedTotpFactor(factorData.factors);

  return { authorized: decideServerMfaAccess({ currentAal, hasVerifiedFactor }) };
}
