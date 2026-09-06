"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseclient";
import { decideAalAction, AalDecision, AalLevel } from "@/lib/mfa/aal";
import { sanitizeNextPath } from "@/lib/mfa/nextUrl";

type AuthContextType = {
  user: User | null;
  // True until the session AND (for a protected route) the AAL decision are
  // both resolved. Existing pages that already gate their data-loading
  // effects on `loading` therefore automatically wait for MFA resolution
  // with no page-level changes required.
  loading: boolean;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
});

const PUBLIC_ROUTES = new Set([
  "/",
  "/login",
  "/signup",
  "/pro",
  "/update-password",
]);

// /mfa-challenge is deliberately NOT in PUBLIC_ROUTES: it still requires an
// authenticated session. It is exempted below from the "must already be
// aal2" requirement that applies to every other protected route.
const MFA_CHALLENGE_ROUTE = "/mfa-challenge";

const MAX_REVERIFY_ATTEMPTS = 1;

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUser] = useState<User | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [aalDecision, setAalDecision] = useState<AalDecision | null>(null);
  const [aalLoading, setAalLoading] = useState(true);
  const [reconcileNonce, setReconcileNonce] = useState(0);
  const reverifyAttempts = useRef(0);
  // Monotonically-incrementing run id guarding the AAL reconciliation effect
  // below against overlapping/out-of-order async results (e.g. a slow
  // request from a superseded run resolving after a newer one has already
  // started). Incremented at the start of every run and on cleanup, so a
  // stale run's late `await` can detect it no longer owns the outcome.
  const aalRunId = useRef(0);

  const isPublicRoute = useMemo(() => {
    if (!pathname) return true;
    if (pathname.startsWith("/auth")) return true;
    return PUBLIC_ROUTES.has(pathname);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      setSessionLoading(true);
      const { data } = await supabase.auth.getSession();

      if (!cancelled) {
        setUser(data?.session?.user ?? null);
        setSessionLoading(false);
      }
    }

    loadSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        reverifyAttempts.current = 0;
        setUser(session?.user ?? null);
      }
    );

    return () => {
      cancelled = true;
      listener?.subscription.unsubscribe();
    };
  }, []);

  // Resolve the AAL decision whenever the user/session changes, or when a
  // successful MFA challenge schedules a reconciliation via reconcileNonce
  // below. Public routes never need this (they render immediately below
  // regardless), but it still runs for them harmlessly if a session exists.
  //
  // Guarded by aalRunId (a version counter, not a boolean) so that if this
  // effect re-runs before a prior run's awaited calls resolve, the prior
  // run's late results are detected as stale and never applied — this is
  // what prevents an overlapping reconciliation from marking protected
  // content ready with an outdated user/decision (e.g. right after logout).
  useEffect(() => {
    const runId = ++aalRunId.current;
    const isCurrentRun = () => aalRunId.current === runId;

    async function resolveAal() {
      if (sessionLoading) return;

      if (!user) {
        if (isCurrentRun()) {
          setAalDecision("login");
          setAalLoading(false);
        }
        return;
      }

      setAalLoading(true);

      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

      if (!isCurrentRun()) return;

      if (error || !data) {
        // Fail closed: an assurance-level lookup failure is treated the same
        // as "not yet cleared" rather than silently granting access.
        setAalDecision("login");
        setAalLoading(false);
        return;
      }

      const currentLevel = data.currentLevel as AalLevel;
      const nextLevel = data.nextLevel as AalLevel;
      const decision = decideAalAction({ hasSession: true, currentLevel, nextLevel });

      if (decision === "reverify") {
        if (reverifyAttempts.current >= MAX_REVERIFY_ATTEMPTS) {
          // Persisted, contradictory AAL state after a retry: fail closed
          // rather than trust a stale aal2 claim or loop forever.
          await supabase.auth.signOut();
          if (isCurrentRun()) {
            setAalDecision("login");
            setAalLoading(false);
          }
          return;
        }

        reverifyAttempts.current += 1;
        // Force a network refresh of the user (and its enrolled factors)
        // before recomputing, since getAuthenticatorAssuranceLevel() itself
        // only reads the currently cached session/user.
        await supabase.auth.getUser();
        const refreshed = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (!isCurrentRun()) return;

        if (refreshed.error || !refreshed.data) {
          setAalDecision("login");
          setAalLoading(false);
          return;
        }

        const finalDecision = decideAalAction({
          hasSession: true,
          currentLevel: refreshed.data.currentLevel as AalLevel,
          nextLevel: refreshed.data.nextLevel as AalLevel,
        });

        setAalDecision(finalDecision === "reverify" ? "login" : finalDecision);
        setAalLoading(false);
        return;
      }

      reverifyAttempts.current = 0;
      setAalDecision(decision);
      setAalLoading(false);
    }

    resolveAal();

    return () => {
      // Invalidate this run on cleanup too (not just on the next run's
      // start), so an in-flight request from an unmounted/superseded effect
      // can never apply its result.
      aalRunId.current += 1;
    };
  }, [user, sessionLoading, reconcileNonce]);

  // Re-resolve immediately after a successful MFA challenge, without waiting
  // for the next unrelated auth-state change (user/session don't change on
  // MFA_CHALLENGE_VERIFIED, so the effect above wouldn't otherwise re-run).
  //
  // This callback is deliberately minimal and calls no Supabase auth method
  // itself: supabase-js holds an internal lock while an onAuthStateChange
  // callback runs, and re-entrant auth calls (getSession/getUser/
  // getAuthenticatorAssuranceLevel/signOut) issued synchronously from inside
  // it can deadlock. The setTimeout defers even the state update that
  // triggers reconciliation to a separate macrotask outside the callback's
  // call stack; the actual Supabase calls happen only in the effect above,
  // under its own version guard.
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "MFA_CHALLENGE_VERIFIED") return;

      setTimeout(() => {
        reverifyAttempts.current = 0;
        setReconcileNonce((n) => n + 1);
      }, 0);
    });

    return () => listener?.subscription.unsubscribe();
  }, []);

  const loading = sessionLoading || (!isPublicRoute && aalLoading);

  // Redirect ONLY on protected routes, and only after loading finishes.
  useEffect(() => {
    if (isPublicRoute) return;
    if (sessionLoading || aalLoading) return;

    if (!user || aalDecision === "login") {
      const next = sanitizeNextPath(pathname ?? undefined);
      router.push(`/login?next=${encodeURIComponent(next)}`);
      return;
    }

    if (aalDecision === "challenge") {
      if (pathname !== MFA_CHALLENGE_ROUTE) {
        const next = sanitizeNextPath(pathname ?? undefined);
        router.push(`${MFA_CHALLENGE_ROUTE}?next=${encodeURIComponent(next)}`);
      }
      return;
    }

    if (aalDecision === "continue" && pathname === MFA_CHALLENGE_ROUTE) {
      // Already fully cleared: nothing to challenge, so don't show the
      // challenge screen — this is what prevents a redirect loop for
      // already-aal2 (or never-enrolled) users landing on the route.
      router.push("/dashboard");
    }
  }, [isPublicRoute, sessionLoading, aalLoading, user, aalDecision, pathname, router]);

  // On protected routes, withhold rendering of children entirely until the
  // user/session and AAL decision are both resolved and safe to show. This
  // is what prevents any protected page's own data-loading effects from
  // starting before MFA is resolved, even for pages that don't themselves
  // check `loading` (e.g. Settings, Onboarding) — the fix lives once, here,
  // rather than being repeated per page.
  const readyToRenderProtectedContent =
    isPublicRoute ||
    (!sessionLoading &&
      !aalLoading &&
      !!user &&
      ((aalDecision === "continue" && pathname !== MFA_CHALLENGE_ROUTE) ||
        (aalDecision === "challenge" && pathname === MFA_CHALLENGE_ROUTE)));

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {readyToRenderProtectedContent ? (
        children
      ) : (
        <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
          <p className="text-sm text-slate-400">Loading your session...</p>
        </main>
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
