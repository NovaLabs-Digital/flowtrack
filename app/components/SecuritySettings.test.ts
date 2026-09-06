import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "./SecuritySettings.tsx"), "utf-8");

describe("SecuritySettings: disabled state", () => {
  it("shows the off message and setup call-to-action", () => {
    expect(source).toMatch(/Two-step verification is off\./);
    expect(source).toMatch(/Set up authenticator app/);
  });

  it("includes a concise explanation appropriate for financial information", () => {
    expect(source).toMatch(/financial information/i);
  });

  it("the disabled-state button routes through the acknowledgment gate, not straight into enrollment", () => {
    const disabledStateBlock = source.slice(
      source.indexOf('view === "idle" && !isEnabled'),
      source.indexOf('view === "acknowledging"')
    );
    expect(disabledStateBlock).toContain("onClick={handleRequestEnrollment}");
    expect(disabledStateBlock).not.toContain("onClick={handleStartEnrollment}");
  });
});

describe("SecuritySettings: first-enrollment acknowledgment gate", () => {
  it("requires all three explicit understandings before Continue is enabled", () => {
    expect(source).toContain(
      "const allAcknowledged = ackNoRecoveryCodes && ackAddBackup && ackLockoutRisk;"
    );
    const ackView = source.slice(
      source.indexOf('view === "acknowledging"'),
      source.indexOf('view === "idle" && isEnabled')
    );
    expect(ackView).toMatch(/does not provide recovery codes\./i);
    expect(ackView).toMatch(/checked={ackNoRecoveryCodes}/);
    expect(ackView).toMatch(/checked={ackAddBackup}/);
    expect(ackView).toMatch(/checked={ackLockoutRisk}/);
    expect(ackView).toMatch(/disabled=\{!allAcknowledged \|\| startingEnrollment\}/);
  });

  it("skips the acknowledgment gate for a user who is already enrolled (adding a backup)", () => {
    const requestFn = source.slice(
      source.indexOf("function handleRequestEnrollment"),
      source.indexOf("function handleCancelAcknowledgment")
    );
    expect(requestFn).toMatch(/if \(isEnabled\) \{[\s\S]*?handleStartEnrollment\(\);\s*return;\s*\}/);
  });

  it("Cancel from the acknowledgment view resets the checkboxes and returns to idle", () => {
    const cancelFn = source.slice(
      source.indexOf("function handleCancelAcknowledgment"),
      source.indexOf("async function handleStartEnrollment")
    );
    expect(cancelFn).toContain("setAckNoRecoveryCodes(false)");
    expect(cancelFn).toContain("setAckAddBackup(false)");
    expect(cancelFn).toContain("setAckLockoutRisk(false)");
    expect(cancelFn).toMatch(/setView\("idle"\)/);
  });

  it("the already-enrolled 'add a backup' button also goes through handleRequestEnrollment (so its internal isEnabled branch decides)", () => {
    const enabledStateBlock = source.slice(
      source.indexOf('view === "idle" && isEnabled'),
      source.indexOf('view === "enrolling"')
    );
    expect(enabledStateBlock).toContain("onClick={handleRequestEnrollment}");
  });
});

describe("SecuritySettings: honest recovery messaging", () => {
  it("never promises that contacting support restores access", () => {
    expect(source).not.toMatch(/contact support/i);
  });

  it("uses the specified honest wording about no recovery codes and possible lockout", () => {
    expect(source).toMatch(/FlowTrack does not provide recovery codes\./);
    expect(source).toMatch(/Add a backup\s+authenticator on another device\./);
    expect(source).toMatch(
      /If you lose access to every\s+authenticator, you may be unable to access your account\./
    );
  });

  it("still never implies email or password reset bypasses MFA", () => {
    expect(source).toMatch(/resetting your password does not\s+turn off two-step verification/i);
  });

  it("does not store the acknowledgment anywhere but component state", () => {
    expect(source).not.toMatch(/localStorage/);
    expect(source).not.toMatch(/sessionStorage/);
    expect(source).not.toMatch(/console\.(log|error|warn)/);
    expect(source).not.toMatch(/\.from\(/); // no Supabase table writes anywhere in this component
  });
});

describe("SecuritySettings: enrollment uses Supabase's native TOTP API", () => {
  it("calls mfa.enroll with factorType totp and a friendlyName", () => {
    expect(source).toMatch(/mfa\.enroll\(\{\s*factorType: "totp",\s*friendlyName,?\s*\}\)/);
  });

  it("displays the returned QR code", () => {
    expect(source).toContain("data.totp.qr_code");
    expect(source).toMatch(/<img[\s\S]*?src=\{qrCode\}/);
  });

  it("places the manual secret behind a Can't scan? disclosure", () => {
    const detailsBlock = source.slice(
      source.indexOf("<details"),
      source.indexOf("</details>")
    );
    expect(detailsBlock).toMatch(/Can&apos;t scan\?/);
    expect(detailsBlock).toContain("{secret}");
  });

  it("verifies a six-digit code via challengeAndVerify before treating enrollment as complete", () => {
    const verifyFn = source.slice(
      source.indexOf("async function handleVerifyEnrollment"),
      source.indexOf("async function handleCancelEnrollment")
    );
    expect(verifyFn).toContain("isValidTotpCode(normalized)");
    expect(verifyFn).toMatch(/mfa\.challengeAndVerify\(\{\s*factorId: pendingFactorId,\s*code: normalized,?\s*\}\)/);
    expect(verifyFn).toContain("loadFactors()");
  });
});

describe("SecuritySettings: abandoned-enrollment cleanup", () => {
  it("unenrolls only previously unverified factors before starting a new enrollment", () => {
    const startFn = source.slice(
      source.indexOf("async function handleStartEnrollment"),
      source.indexOf("async function handleVerifyEnrollment")
    );
    expect(startFn).toContain("getUnverifiedTotpFactors");
    expect(startFn).toMatch(/for \(const factor of unverified\)/);
    expect(startFn).toMatch(/mfa\.unenroll\(\{ factorId: factor\.id \}\)/);
  });

  it("Cancel during enrollment unenrolls only the specific pending (never-verified) factor", () => {
    const cancelFn = source.slice(
      source.indexOf("async function handleCancelEnrollment"),
      source.indexOf("function handleRequestRemove")
    );
    expect(cancelFn).toMatch(/mfa\.unenroll\(\{ factorId: pendingFactorId \}\)/);
  });

  it("a successful verification never calls unenroll on the just-verified factor", () => {
    const verifyFn = source.slice(
      source.indexOf("async function handleVerifyEnrollment"),
      source.indexOf("async function handleCancelEnrollment")
    );
    expect(verifyFn).not.toMatch(/unenroll/);
  });
});

describe("SecuritySettings: enabled state", () => {
  it("clearly shows Protected and lists verified factors", () => {
    expect(source).toMatch(/Protected — two-step verification is on\./);
    expect(source).toContain("verifiedFactors.map(");
  });

  it("allows adding a second backup authenticator", () => {
    expect(source).toMatch(/Add a backup authenticator/);
  });
});

describe("SecuritySettings: target factor vs verification factor are distinct concepts", () => {
  it("tracks removeTargetId and verifyFactorId as separate state", () => {
    expect(source).toMatch(/const \[removeTargetId, setRemoveTargetId\] = useState<string \| null>\(null\);/);
    expect(source).toMatch(/const \[verifyFactorId, setVerifyFactorId\] = useState<string \| null>\(null\);/);
  });

  it("handleRequestRemove prefers a verification factor different from the target when one is available", () => {
    const requestFn = source.slice(
      source.indexOf("function handleRequestRemove"),
      source.indexOf("async function handleSubmitRemove")
    );
    expect(requestFn).toContain("isLastVerifiedTotpFactor(verifiedFactors, targetFactorId)");
    expect(requestFn).toMatch(/verifiedFactors\.find\(\(f\) => f\.id !== targetFactorId\)/);
    expect(requestFn).toMatch(
      /setVerifyFactorId\(isLast \? targetFactorId : alternative\?\.id \?\? targetFactorId\)/
    );
  });

  it("when removing the final factor, verification necessarily uses that same factor", () => {
    const requestFn = source.slice(
      source.indexOf("function handleRequestRemove"),
      source.indexOf("async function handleSubmitRemove")
    );
    // isLast=true forces verifyFactorId to targetFactorId via the ternary above,
    // and removeConfirmed starts false so the explicit warning is shown first.
    expect(requestFn).toMatch(/setRemoveConfirmed\(!isLast\)/);
  });

  it("shows a 'verify with' picker only when more than one verified factor exists", () => {
    expect(source).toMatch(/verifiedFactors\.length > 1 &&/);
    expect(source).toContain('id="verify-factor"');
    expect(source).toMatch(/value=\{verifyFactorId \?\? ""\}/);
  });

  it("uses the specified wording for choosing a verification factor", () => {
    expect(source).toContain("Verify with an authenticator you still have access to.");
  });
});

describe("SecuritySettings: removal requires a fresh successful TOTP challenge, never a stale session", () => {
  it("challenges the chosen verification factor (not necessarily the target) before unenroll", () => {
    const removeFn = source.slice(
      source.indexOf("async function handleSubmitRemove"),
      source.indexOf("function handleCancelRemove")
    );
    expect(removeFn).toMatch(/mfa\.challengeAndVerify\(\{\s*factorId: verifyFactorId,\s*code: normalized,?\s*\}\)/);
    const verifyIndex = removeFn.indexOf("mfa.challengeAndVerify(");
    const unenrollIndex = removeFn.indexOf("mfa.unenroll(");
    expect(verifyIndex).toBeGreaterThan(-1);
    expect(unenrollIndex).toBeGreaterThan(-1);
    expect(verifyIndex).toBeLessThan(unenrollIndex);
  });

  it("aborts removal (does not call unenroll) if the fresh challenge fails", () => {
    const removeFn = source.slice(
      source.indexOf("async function handleSubmitRemove"),
      source.indexOf("function handleCancelRemove")
    );
    const errorCheckIndex = removeFn.indexOf("if (verifyError) {");
    const returnAfterError = removeFn.slice(errorCheckIndex, removeFn.indexOf("}", errorCheckIndex));
    expect(returnAfterError).toMatch(/return;/);
  });

  it("re-fetches verified factors after verification and immediately before unenroll", () => {
    const removeFn = source.slice(
      source.indexOf("async function handleSubmitRemove"),
      source.indexOf("function handleCancelRemove")
    );
    const verifyIndex = removeFn.indexOf("mfa.challengeAndVerify(");
    const listFactorsIndex = removeFn.indexOf("mfa.listFactors()");
    const unenrollIndex = removeFn.indexOf("mfa.unenroll(");
    expect(verifyIndex).toBeLessThan(listFactorsIndex);
    expect(listFactorsIndex).toBeLessThan(unenrollIndex);
  });

  it("confirms the target still exists and is still verified before unenroll, and fails closed if not", () => {
    const removeFn = source.slice(
      source.indexOf("async function handleSubmitRemove"),
      source.indexOf("function handleCancelRemove")
    );
    expect(removeFn).toContain("getVerifiedTotpFactors(refreshedList.totp as MfaFactor[])");
    expect(removeFn).toMatch(/\.find\(\s*\(f\) => f\.id === removeTargetId\s*\)/);
    expect(removeFn).toMatch(/if \(!stillVerifiedTarget\) \{/);
    const failClosedBlock = removeFn.slice(
      removeFn.indexOf("if (!stillVerifiedTarget) {"),
      removeFn.indexOf("const { error: unenrollError }")
    );
    expect(failClosedBlock).toContain("return;");
    expect(failClosedBlock).not.toContain("mfa.unenroll(");
  });

  it("the final unenroll call always targets removeTargetId, never verifyFactorId", () => {
    const removeFn = source.slice(
      source.indexOf("async function handleSubmitRemove"),
      source.indexOf("function handleCancelRemove")
    );
    expect(removeFn).toMatch(/mfa\.unenroll\(\{\s*factorId: removeTargetId,?\s*\}\)/);
  });
});

describe("SecuritySettings: prevents removing the last factor without explicit confirmation", () => {
  it("uses isLastVerifiedTotpFactor to decide whether an extra confirmation step is required", () => {
    expect(source).toContain("isLastVerifiedTotpFactor(verifiedFactors, targetFactorId)");
  });

  it("shows a clear warning that two-step verification will be turned off before allowing removal", () => {
    expect(source).toMatch(/Removing it will turn off\s*[\s\S]*?two-step verification for your account\./);
    expect(source).toMatch(/Turn off two-step verification/);
  });

  it("requires an explicit second click (removeConfirmed) before the code-challenge form appears for the last factor", () => {
    expect(source).toMatch(/!removeConfirmed \?/);
    expect(source).toMatch(/onClick=\{\(\) => setRemoveConfirmed\(true\)\}/);
  });
});

describe("SecuritySettings: never logs sensitive MFA data", () => {
  it("contains no console.log/error/warn calls at all", () => {
    expect(source).not.toMatch(/console\.(log|error|warn)/);
  });
});
