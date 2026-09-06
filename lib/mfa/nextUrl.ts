// Validates the "next" redirect target used by login and /mfa-challenge so an
// attacker cannot use it to bounce an authenticated user off FlowTrack. Only a
// same-app path beginning with exactly one "/" is ever allowed.

const DEFAULT_NEXT_PATH = "/dashboard";

const LOOP_PREFIXES = ["/login", "/mfa-challenge"];

function startsWithLoopPath(pathOnly: string): boolean {
  return LOOP_PREFIXES.some(
    (prefix) => pathOnly === prefix || pathOnly.startsWith(`${prefix}/`)
  );
}

function looksLikeRedirectTrick(candidate: string): boolean {
  if (!candidate.startsWith("/")) return true;
  if (candidate.startsWith("//")) return true; // protocol-relative URL
  if (candidate.includes("\\")) return true; // backslash tricks some parsers treat as "/"
  if (candidate.includes("://")) return true; // absolute URL smuggled after a leading "/"
  if (/[\x00-\x1f]/.test(candidate)) return true; // control characters
  return false;
}

export function sanitizeNextPath(
  rawNext: string | null | undefined,
  fallback: string = DEFAULT_NEXT_PATH
): string {
  if (!rawNext) return fallback;

  let candidate: string;
  try {
    candidate = decodeURIComponent(rawNext);
  } catch {
    return fallback;
  }

  if (looksLikeRedirectTrick(candidate)) return fallback;

  // Defend against a second layer of percent-encoding smuggling another
  // slash or scheme past the single-decode check above.
  try {
    const doubleDecoded = decodeURIComponent(candidate);
    if (doubleDecoded !== candidate && looksLikeRedirectTrick(doubleDecoded)) {
      return fallback;
    }
  } catch {
    // candidate already validated above; a failed second decode is fine.
  }

  const pathOnly = candidate.split(/[?#]/)[0];
  if (startsWithLoopPath(pathOnly)) return fallback;

  return candidate;
}

export function buildNextQueryParam(candidatePath: string): string {
  return `next=${encodeURIComponent(sanitizeNextPath(candidatePath))}`;
}
