// Normalization/validation for the six-digit TOTP codes entered at /mfa-challenge
// and during Settings enrollment. Never logs or persists the code — callers must
// not either.

export function normalizeTotpCode(raw: string): string {
  return raw.replace(/\s+/g, "").trim();
}

export function isValidTotpCode(raw: string): boolean {
  const normalized = normalizeTotpCode(raw);
  return /^\d{6}$/.test(normalized);
}
