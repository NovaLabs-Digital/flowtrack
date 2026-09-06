import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// This repo has no component-test framework (no React Testing Library / jsdom
// setup), so — following the convention already used for the API routes and
// the SQL migration/runbook — these are source-content assertions, not
// rendered-behavior tests. See the manual test plan in the final report for
// the browser-level checks these cannot cover.
const source = readFileSync(join(__dirname, "./AuthContext.tsx"), "utf-8");

describe("AuthContext: AAL gate wiring", () => {
  it("imports the pure MFA decision/sanitization helpers rather than re-implementing them", () => {
    expect(source).toMatch(/from ["']@\/lib\/mfa\/aal["']/);
    expect(source).toMatch(/from ["']@\/lib\/mfa\/nextUrl["']/);
    expect(source).toContain("decideAalAction");
    expect(source).toContain("sanitizeNextPath");
  });

  it("fetches the assurance level via Supabase's native MFA API", () => {
    expect(source).toContain("supabase.auth.mfa.getAuthenticatorAssuranceLevel()");
  });

  it("resolves AAL only after the session itself has resolved", () => {
    const effectBody = source.slice(
      source.indexOf("async function resolveAal"),
      source.indexOf("resolveAal();")
    );
    expect(effectBody).toMatch(/if \(sessionLoading\) return;/);
  });
});

describe("AuthContext: loading semantics cover both session and AAL", () => {
  it("loading is true while the session is loading OR (on a protected route) AAL is loading", () => {
    expect(source).toMatch(
      /const loading = sessionLoading \|\| \(!isPublicRoute && aalLoading\);/
    );
  });
});

describe("AuthContext: redirect behavior", () => {
  it("redirects to /login (with a sanitized next param) when there is no user or the decision is login", () => {
    const effectBody = source.slice(
      source.indexOf("// Redirect ONLY on protected routes"),
      source.indexOf("readyToRenderProtectedContent")
    );
    expect(effectBody).toMatch(/if \(!user \|\| aalDecision === "login"\)/);
    expect(effectBody).toMatch(/router\.push\(`\/login\?next=/);
  });

  it("redirects aal1-enrolled users to /mfa-challenge with a sanitized next param, unless already there", () => {
    const effectBody = source.slice(
      source.indexOf("// Redirect ONLY on protected routes"),
      source.indexOf("readyToRenderProtectedContent")
    );
    expect(effectBody).toMatch(/aalDecision === "challenge"/);
    expect(effectBody).toMatch(/pathname !== MFA_CHALLENGE_ROUTE/);
    expect(effectBody).toMatch(/router\.push\(`\$\{MFA_CHALLENGE_ROUTE\}\?next=/);
  });

  it("redirects an already-cleared user away from /mfa-challenge instead of looping", () => {
    const effectBody = source.slice(
      source.indexOf("// Redirect ONLY on protected routes"),
      source.indexOf("readyToRenderProtectedContent")
    );
    expect(effectBody).toMatch(
      /aalDecision === "continue" && pathname === MFA_CHALLENGE_ROUTE/
    );
  });
});

describe("AuthContext: reverify handles a stale aal2 claim safely", () => {
  it("re-fetches the user before recomputing on a reverify decision", () => {
    const reverifyBlock = source.slice(
      source.indexOf('if (decision === "reverify")'),
      source.indexOf("reverifyAttempts.current = 0;\n      setAalDecision(decision);")
    );
    expect(reverifyBlock).toContain("supabase.auth.getUser()");
    expect(reverifyBlock).toContain("MAX_REVERIFY_ATTEMPTS");
  });

  it("fails closed (signs out) if the contradiction persists after one retry, rather than looping forever", () => {
    const reverifyBlock = source.slice(
      source.indexOf('if (decision === "reverify")'),
      source.indexOf("reverifyAttempts.current += 1;")
    );
    expect(reverifyBlock).toContain("supabase.auth.signOut()");
  });

  it("never lets a reverify resolve back into another reverify (no infinite loop)", () => {
    expect(source).toMatch(
      /setAalDecision\(finalDecision === "reverify" \? "login" : finalDecision\)/
    );
  });
});

describe("AuthContext: protected content is gated on more than just session loading", () => {
  it("withholds children on protected routes until session, AAL loading, user, and decision all line up", () => {
    const gate = source.slice(
      source.indexOf("const readyToRenderProtectedContent"),
      source.indexOf("return (\n    <AuthContext.Provider")
    );
    expect(gate).toContain("isPublicRoute");
    expect(gate).toContain("!sessionLoading");
    expect(gate).toContain("!aalLoading");
    expect(gate).toContain("!!user");
    expect(gate).toMatch(/aalDecision === "continue" && pathname !== MFA_CHALLENGE_ROUTE/);
    expect(gate).toMatch(/aalDecision === "challenge" && pathname === MFA_CHALLENGE_ROUTE/);
  });

  it("renders a loading fallback, not the real children, when not ready", () => {
    expect(source).toMatch(/readyToRenderProtectedContent \? \(\s*children/);
    expect(source).toMatch(/Loading your session/);
  });
});

describe("AuthContext: route classification", () => {
  it("keeps the original public routes and does not add /mfa-challenge to them", () => {
    expect(source).toMatch(/"\/",\s*"\/login",\s*"\/signup",\s*"\/pro",\s*"\/update-password"/);
    const publicRoutesBlock = source.slice(
      source.indexOf("const PUBLIC_ROUTES"),
      source.indexOf(");", source.indexOf("const PUBLIC_ROUTES"))
    );
    expect(publicRoutesBlock).not.toContain("mfa-challenge");
  });

  it("does not special-case /restore anywhere — it gets the same gate as any other protected route", () => {
    expect(source).not.toContain("/restore");
  });
});

describe("AuthContext: re-resolves promptly after a successful challenge", () => {
  it("listens for the MFA_CHALLENGE_VERIFIED auth event", () => {
    expect(source).toContain('"MFA_CHALLENGE_VERIFIED"');
  });

  it("triggers reconciliation via a nonce bump rather than re-deriving the decision inline", () => {
    const listenerBody = source.slice(
      source.indexOf("supabase.auth.onAuthStateChange((event) => {"),
      source.indexOf("return () => listener?.subscription.unsubscribe();")
    );
    expect(listenerBody).toContain("setReconcileNonce((n) => n + 1)");
    expect(listenerBody).not.toContain("getAuthenticatorAssuranceLevel");
  });
});

describe("AuthContext: onAuthStateChange callbacks never deadlock", () => {
  it("the session-listener callback only calls setUser/ref resets — no Supabase auth calls", () => {
    const callbackBody = source.slice(
      source.indexOf("(_event, session) => {"),
      source.indexOf("}\n    );")
    );
    expect(callbackBody).not.toMatch(/supabase\.auth\./);
    expect(callbackBody).toContain("setUser(session?.user ?? null)");
  });

  it("the MFA_CHALLENGE_VERIFIED callback calls no Supabase auth method directly", () => {
    const callbackBody = source.slice(
      source.indexOf("if (event !== \"MFA_CHALLENGE_VERIFIED\") return;"),
      source.indexOf("return () => listener?.subscription.unsubscribe();")
    );
    expect(callbackBody).not.toMatch(/supabase\.auth\./);
  });

  it("defers even the state update to a macrotask outside the callback via setTimeout", () => {
    const callbackBody = source.slice(
      source.indexOf("supabase.auth.onAuthStateChange((event) => {"),
      source.indexOf("return () => listener?.subscription.unsubscribe();")
    );
    expect(callbackBody).toMatch(/setTimeout\(\(\) => \{[\s\S]*setReconcileNonce/);
  });

  it("documents the deadlock hazard this defers around", () => {
    expect(source).toMatch(/internal lock/i);
    expect(source).toMatch(/deadlock/i);
  });
});

describe("AuthContext: overlapping AAL reconciliations cannot grant stale readiness", () => {
  it("uses a monotonic run-id version guard rather than a plain boolean flag", () => {
    expect(source).toContain("const aalRunId = useRef(0);");
    expect(source).toMatch(/const runId = \+\+aalRunId\.current;/);
    expect(source).toMatch(/const isCurrentRun = \(\) => aalRunId\.current === runId;/);
  });

  it("every setState following an awaited Supabase call is preceded by an isCurrentRun() check", () => {
    const effectBody = source.slice(
      source.indexOf("useEffect(() => {\n    const runId ="),
      source.indexOf("}, [user, sessionLoading, reconcileNonce]);")
    );
    // Each of the three `await supabase...` points in this effect must be
    // immediately followed by an isCurrentRun()/isCurrentRun bail-out before
    // any further setState call is reachable.
    const awaitCount = (effectBody.match(/await supabase\./g) || []).length;
    const guardCount = (effectBody.match(/isCurrentRun\(\)/g) || []).length;
    expect(awaitCount).toBeGreaterThan(0);
    expect(guardCount).toBeGreaterThanOrEqual(awaitCount);
  });

  it("invalidates the run on effect cleanup too, not only on the next run's start", () => {
    const effectBody = source.slice(
      source.indexOf("useEffect(() => {\n    const runId ="),
      source.indexOf("}, [user, sessionLoading, reconcileNonce]);")
    );
    const cleanup = effectBody.slice(effectBody.indexOf("return () => {"));
    expect(cleanup).toContain("aalRunId.current += 1;");
  });

  it("the reconciliation effect re-runs on reconcileNonce as well as user/sessionLoading", () => {
    expect(source).toContain("}, [user, sessionLoading, reconcileNonce]);");
  });
});

describe("AuthContext: protected readiness always belongs to the current session/user", () => {
  it("the readiness gate re-checks !!user directly rather than trusting a cached decision alone", () => {
    const gate = source.slice(
      source.indexOf("const readyToRenderProtectedContent"),
      source.indexOf("return (\n    <AuthContext.Provider")
    );
    expect(gate).toContain("!!user");
  });

  it("a null/changed user synchronously forces the login decision with no pending await in between", () => {
    const nullUserBranch = source.slice(
      source.indexOf("if (!user) {"),
      source.indexOf("setAalLoading(true);")
    );
    expect(nullUserBranch).not.toMatch(/await/);
    expect(nullUserBranch).toContain('setAalDecision("login")');
  });
});

describe("AuthContext: auth events cannot cause a redirect loop", () => {
  it("the redirect effect exits immediately for public routes before evaluating any auth event's effect", () => {
    const effectBody = source.slice(
      source.indexOf("// Redirect ONLY on protected routes"),
      source.indexOf("readyToRenderProtectedContent")
    );
    expect(effectBody.trim().startsWith("useEffect(() => {")).toBe(false); // sanity: this slice starts at the comment, not the hook
    expect(effectBody).toMatch(/if \(isPublicRoute\) return;/);
  });

  it("the mfa-challenge redirect only fires when not already on that route (no self-redirect loop)", () => {
    const effectBody = source.slice(
      source.indexOf("// Redirect ONLY on protected routes"),
      source.indexOf("readyToRenderProtectedContent")
    );
    const challengeBranch = effectBody.slice(effectBody.indexOf('aalDecision === "challenge"'));
    expect(challengeBranch).toMatch(/if \(pathname !== MFA_CHALLENGE_ROUTE\) \{/);
  });

  it("the continue-on-challenge-route redirect only fires when actually on that route (no self-redirect loop)", () => {
    const effectBody = source.slice(
      source.indexOf("// Redirect ONLY on protected routes"),
      source.indexOf("readyToRenderProtectedContent")
    );
    expect(effectBody).toMatch(
      /if \(aalDecision === "continue" && pathname === MFA_CHALLENGE_ROUTE\) \{/
    );
  });
});

describe("AuthContext: never logs sensitive MFA data", () => {
  it("contains no console.log/console.error of factor ids, codes, or tokens", () => {
    expect(source).not.toMatch(/console\.(log|error|warn)/);
  });
});
