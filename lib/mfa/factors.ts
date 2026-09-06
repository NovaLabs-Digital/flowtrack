// Helpers over the factor list shape returned by Supabase's
// supabase.auth.mfa.listFactors() (data.totp / data.all entries).

export type MfaFactorStatus = "verified" | "unverified";

export type MfaFactor = {
  id: string;
  factor_type: string;
  status: MfaFactorStatus;
  friendly_name?: string | null;
};

export function getVerifiedTotpFactors(factors: MfaFactor[]): MfaFactor[] {
  return factors.filter((f) => f.factor_type === "totp" && f.status === "verified");
}

export function getUnverifiedTotpFactors(factors: MfaFactor[]): MfaFactor[] {
  return factors.filter((f) => f.factor_type === "totp" && f.status === "unverified");
}

export function hasVerifiedTotpFactor(factors: MfaFactor[]): boolean {
  return getVerifiedTotpFactors(factors).length > 0;
}

export function isLastVerifiedTotpFactor(
  factors: MfaFactor[],
  factorId: string
): boolean {
  const verified = getVerifiedTotpFactors(factors);
  return verified.length === 1 && verified[0]?.id === factorId;
}
