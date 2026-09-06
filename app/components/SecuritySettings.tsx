"use client";

import { useEffect, useState, FormEvent } from "react";
import { supabase } from "@/lib/supabaseclient";
import {
  getVerifiedTotpFactors,
  getUnverifiedTotpFactors,
  isLastVerifiedTotpFactor,
  type MfaFactor,
} from "@/lib/mfa/factors";
import { normalizeTotpCode, isValidTotpCode } from "@/lib/mfa/totp";

const GENERIC_CODE_ERROR = "Incorrect or expired code. Please try again.";

type View = "idle" | "acknowledging" | "enrolling" | "removing";

export default function SecuritySettings() {
  const [loading, setLoading] = useState(true);
  const [verifiedFactors, setVerifiedFactors] = useState<MfaFactor[]>([]);
  const [view, setView] = useState<View>("idle");

  // First-enrollment acknowledgment. Component state only — never persisted
  // to any table, log, or browser storage in this phase.
  const [ackNoRecoveryCodes, setAckNoRecoveryCodes] = useState(false);
  const [ackAddBackup, setAckAddBackup] = useState(false);
  const [ackLockoutRisk, setAckLockoutRisk] = useState(false);
  const allAcknowledged = ackNoRecoveryCodes && ackAddBackup && ackLockoutRisk;

  // Enrollment state — the secret/QR code live only in component state and
  // are never sent to FlowTrack's own tables, logged, or persisted to
  // browser storage.
  const [pendingFactorId, setPendingFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [enrollCode, setEnrollCode] = useState("");
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [startingEnrollment, setStartingEnrollment] = useState(false);

  // Removal state. targetFactorId is the factor being removed;
  // verifyFactorId is the (possibly different) verified factor the user
  // authorizes the removal with.
  const [removeTargetId, setRemoveTargetId] = useState<string | null>(null);
  const [verifyFactorId, setVerifyFactorId] = useState<string | null>(null);
  const [removeConfirmed, setRemoveConfirmed] = useState(false);
  const [removeCode, setRemoveCode] = useState("");
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  async function loadFactors() {
    setLoading(true);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (!error && data) {
      setVerifiedFactors(getVerifiedTotpFactors(data.totp as MfaFactor[]));
    }
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (cancelled) return;
      if (!error && data) {
        setVerifiedFactors(getVerifiedTotpFactors(data.totp as MfaFactor[]));
      }
      setLoading(false);
    }

    init();

    return () => {
      cancelled = true;
    };
  }, []);

  const isEnabled = verifiedFactors.length > 0;

  function handleRequestEnrollment() {
    if (isEnabled) {
      // Already enrolled once before — the first-enrollment acknowledgment
      // has already been shown for this account's very first factor.
      handleStartEnrollment();
      return;
    }
    setAckNoRecoveryCodes(false);
    setAckAddBackup(false);
    setAckLockoutRisk(false);
    setView("acknowledging");
  }

  function handleCancelAcknowledgment() {
    setAckNoRecoveryCodes(false);
    setAckAddBackup(false);
    setAckLockoutRisk(false);
    setView("idle");
  }

  async function handleStartEnrollment() {
    setEnrollError(null);
    setStartingEnrollment(true);

    // Clean up any previously abandoned, never-verified factors first so
    // repeated setup attempts don't accumulate orphaned enrollments. This
    // never touches a verified factor, since the filter is on status.
    const { data: listData } = await supabase.auth.mfa.listFactors();
    const unverified = listData
      ? getUnverifiedTotpFactors(listData.totp as MfaFactor[])
      : [];
    for (const factor of unverified) {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }

    const friendlyName = `Authenticator ${verifiedFactors.length + 1}`;
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName,
    });

    setStartingEnrollment(false);

    if (error || !data) {
      setEnrollError("Could not start setup. Please try again.");
      return;
    }

    setPendingFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    setView("enrolling");
  }

  async function handleVerifyEnrollment(e: FormEvent) {
    e.preventDefault();
    setEnrollError(null);

    const normalized = normalizeTotpCode(enrollCode);
    if (!isValidTotpCode(normalized)) {
      setEnrollError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    if (!pendingFactorId) return;

    setEnrolling(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: pendingFactorId,
      code: normalized,
    });
    setEnrolling(false);

    if (error) {
      setEnrollError(GENERIC_CODE_ERROR);
      setEnrollCode("");
      return;
    }

    setPendingFactorId(null);
    setQrCode(null);
    setSecret(null);
    setEnrollCode("");
    setAckNoRecoveryCodes(false);
    setAckAddBackup(false);
    setAckLockoutRisk(false);
    setView("idle");
    await loadFactors();
  }

  async function handleCancelEnrollment() {
    if (pendingFactorId) {
      // Only ever unenrolls the exact factor this session just created and
      // that has not been verified — never a previously-verified factor.
      await supabase.auth.mfa.unenroll({ factorId: pendingFactorId });
    }
    setPendingFactorId(null);
    setQrCode(null);
    setSecret(null);
    setEnrollCode("");
    setEnrollError(null);
    setView("idle");
  }

  function handleRequestRemove(targetFactorId: string) {
    const isLast = isLastVerifiedTotpFactor(verifiedFactors, targetFactorId);
    // Prefer a verification factor different from the target when
    // available — a user must be able to authorize removing a lost primary
    // device using a backup authenticator they still hold. If this is the
    // last verified factor, verification necessarily uses that same factor.
    const alternative = verifiedFactors.find((f) => f.id !== targetFactorId);

    setRemoveTargetId(targetFactorId);
    setVerifyFactorId(isLast ? targetFactorId : alternative?.id ?? targetFactorId);
    setRemoveConfirmed(!isLast);
    setRemoveCode("");
    setRemoveError(null);
    setView("removing");
  }

  async function handleSubmitRemove(e: FormEvent) {
    e.preventDefault();
    setRemoveError(null);
    if (!removeTargetId || !verifyFactorId) return;

    const normalized = normalizeTotpCode(removeCode);
    if (!isValidTotpCode(normalized)) {
      setRemoveError("Enter the 6-digit code from your authenticator app.");
      return;
    }

    setRemoving(true);

    // Never rely on an existing/stale aal2 session: require a fresh,
    // successful challenge of the chosen verification factor (which may
    // differ from the factor being removed) before anything is unenrolled.
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: verifyFactorId,
      code: normalized,
    });

    if (verifyError) {
      setRemoving(false);
      setRemoveError(GENERIC_CODE_ERROR);
      setRemoveCode("");
      return;
    }

    // Re-fetch verified factors after verification and immediately before
    // unenroll, and confirm the target still exists and is still verified.
    // This closes a race where the target could have been removed or
    // changed concurrently (e.g. a second tab) between opening this form
    // and the verification above, and prevents acting on a stale/swapped id.
    const { data: refreshedList, error: refreshError } = await supabase.auth.mfa.listFactors();

    if (refreshError || !refreshedList) {
      setRemoving(false);
      setRemoveError("Could not confirm this authenticator still exists. Please try again.");
      return;
    }

    const stillVerifiedTarget = getVerifiedTotpFactors(refreshedList.totp as MfaFactor[]).find(
      (f) => f.id === removeTargetId
    );

    if (!stillVerifiedTarget) {
      // Fail closed: the target factor is gone or no longer verified — do
      // not unenroll an id that may no longer refer to what the user saw.
      setRemoving(false);
      setRemoveError("This authenticator is no longer available. Please refresh and try again.");
      setRemoveTargetId(null);
      setVerifyFactorId(null);
      setView("idle");
      await loadFactors();
      return;
    }

    const { error: unenrollError } = await supabase.auth.mfa.unenroll({
      factorId: removeTargetId,
    });
    setRemoving(false);

    if (unenrollError) {
      setRemoveError("Could not remove this authenticator. Please try again.");
      return;
    }

    setRemoveTargetId(null);
    setVerifyFactorId(null);
    setRemoveConfirmed(false);
    setRemoveCode("");
    setView("idle");
    await loadFactors();
  }

  function handleCancelRemove() {
    setRemoveTargetId(null);
    setVerifyFactorId(null);
    setRemoveConfirmed(false);
    setRemoveCode("");
    setRemoveError(null);
    setView("idle");
  }

  const inputClass =
    "w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 tracking-widest text-center focus:outline-none focus:ring-1 focus:ring-emerald-500";
  const primaryButtonClass =
    "rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium";
  const secondaryButtonClass =
    "rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800";

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
      <h2 className="text-base font-semibold sm:text-lg">Two-step verification</h2>

      {loading && <p className="mt-3 text-sm text-slate-400">Loading...</p>}

      {!loading && view === "idle" && !isEnabled && (
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-slate-400">Two-step verification is off.</p>
          <p className="text-xs text-slate-500">
            FlowTrack shows your financial information, so we recommend adding
            an authenticator app for a second layer of protection beyond your
            password.
          </p>
          {enrollError && (
            <div className="bg-red-500/10 border border-red-500 text-red-200 text-xs rounded-lg px-3 py-2">
              {enrollError}
            </div>
          )}
          <button
            type="button"
            onClick={handleRequestEnrollment}
            disabled={startingEnrollment}
            className={primaryButtonClass}
          >
            {startingEnrollment ? "Starting..." : "Set up authenticator app"}
          </button>
        </div>
      )}

      {!loading && view === "acknowledging" && (
        <div className="mt-3 space-y-3 text-sm">
          <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
            <p className="font-medium">Before you turn on two-step verification:</p>
            <p>
              FlowTrack does not provide recovery codes. Add a backup
              authenticator on another device. If you lose access to every
              authenticator, you may be unable to access your account.
            </p>
          </div>

          <label className="flex items-start gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={ackNoRecoveryCodes}
              onChange={(e) => setAckNoRecoveryCodes(e.target.checked)}
            />
            <span>I understand FlowTrack does not provide recovery codes.</span>
          </label>
          <label className="flex items-start gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={ackAddBackup}
              onChange={(e) => setAckAddBackup(e.target.checked)}
            />
            <span>I understand I should add a backup authenticator on another device.</span>
          </label>
          <label className="flex items-start gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={ackLockoutRisk}
              onChange={(e) => setAckLockoutRisk(e.target.checked)}
            />
            <span>
              I understand that losing access to every authenticator may lock
              me out of my account.
            </span>
          </label>

          <div className="flex gap-2">
            <button type="button" onClick={handleCancelAcknowledgment} className={secondaryButtonClass}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleStartEnrollment}
              disabled={!allAcknowledged || startingEnrollment}
              className={primaryButtonClass}
            >
              {startingEnrollment ? "Starting..." : "Continue"}
            </button>
          </div>
        </div>
      )}

      {!loading && view === "idle" && isEnabled && (
        <div className="mt-3 space-y-3 text-sm">
          <p className="font-medium text-emerald-400">
            Protected — two-step verification is on.
          </p>
          <ul className="space-y-1.5">
            {verifiedFactors.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
              >
                <span className="text-slate-300">{f.friendly_name || "Authenticator app"}</span>
                <button
                  type="button"
                  onClick={() => handleRequestRemove(f.id)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">
            FlowTrack does not provide recovery codes. Add a backup
            authenticator on another device. If you lose access to every
            authenticator, you may be unable to access your account.
            Resetting your password does not turn off two-step verification.
          </p>
          {enrollError && (
            <div className="bg-red-500/10 border border-red-500 text-red-200 text-xs rounded-lg px-3 py-2">
              {enrollError}
            </div>
          )}
          <button
            type="button"
            onClick={handleRequestEnrollment}
            disabled={startingEnrollment}
            className={secondaryButtonClass}
          >
            {startingEnrollment ? "Starting..." : "Add a backup authenticator"}
          </button>
        </div>
      )}

      {!loading && view === "enrolling" && (
        <form onSubmit={handleVerifyEnrollment} className="mt-3 space-y-3 text-sm">
          <p className="text-xs text-slate-400">
            Scan this QR code with your authenticator app (Google
            Authenticator, 1Password, Authy, etc.).
          </p>

          {qrCode && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrCode}
              alt="Authenticator setup QR code"
              className="mx-auto h-40 w-40 rounded-lg bg-white p-2"
            />
          )}

          <details className="text-xs text-slate-400">
            <summary className="cursor-pointer hover:text-slate-300">Can&apos;t scan?</summary>
            <p className="mt-2 text-slate-500">Enter this code manually instead:</p>
            <code className="mt-1 block break-all rounded bg-slate-950 border border-slate-800 px-2 py-1 text-[11px] text-slate-300">
              {secret}
            </code>
          </details>

          {enrollError && (
            <div className="bg-red-500/10 border border-red-500 text-red-200 text-xs rounded-lg px-3 py-2">
              {enrollError}
            </div>
          )}

          <div>
            <label className="block mb-1 text-slate-300" htmlFor="enroll-code">
              6-digit code
            </label>
            <input
              id="enroll-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={enrollCode}
              onChange={(e) => setEnrollCode(e.target.value)}
              className={inputClass}
              placeholder="000000"
            />
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={handleCancelEnrollment} className={secondaryButtonClass}>
              Cancel
            </button>
            <button type="submit" disabled={enrolling} className={primaryButtonClass}>
              {enrolling ? "Verifying..." : "Verify and enable"}
            </button>
          </div>
        </form>
      )}

      {!loading && view === "removing" && removeTargetId && (
        <div className="mt-3 space-y-3 text-sm">
          {!removeConfirmed ? (
            <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
              <p>
                This is your only authenticator. Removing it will turn off
                two-step verification for your account.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={handleCancelRemove} className={secondaryButtonClass}>
                  Keep two-step verification on
                </button>
                <button
                  type="button"
                  onClick={() => setRemoveConfirmed(true)}
                  className="rounded-lg border border-red-500 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10"
                >
                  Turn off two-step verification
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmitRemove} className="space-y-3">
              <p className="text-xs text-slate-400">
                Verify with an authenticator you still have access to.
              </p>

              {verifiedFactors.length > 1 && (
                <div>
                  <label className="block mb-1 text-slate-300" htmlFor="verify-factor">
                    Verify with
                  </label>
                  <select
                    id="verify-factor"
                    value={verifyFactorId ?? ""}
                    onChange={(e) => setVerifyFactorId(e.target.value)}
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    {verifiedFactors.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.friendly_name || "Authenticator app"}
                        {f.id === removeTargetId ? " (being removed)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {removeError && (
                <div className="bg-red-500/10 border border-red-500 text-red-200 text-xs rounded-lg px-3 py-2">
                  {removeError}
                </div>
              )}
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={removeCode}
                onChange={(e) => setRemoveCode(e.target.value)}
                className={inputClass}
                placeholder="000000"
              />
              <div className="flex gap-2">
                <button type="button" onClick={handleCancelRemove} className={secondaryButtonClass}>
                  Cancel
                </button>
                <button type="submit" disabled={removing} className={primaryButtonClass}>
                  {removing ? "Removing..." : "Remove"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
