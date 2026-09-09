import { Resend } from "resend";
import type { BuiltEmail } from "./email-builder";

let resendInstance: Resend | null = null;

export function getResend(): Resend {
  if (!resendInstance) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is required");
    resendInstance = new Resend(key);
  }
  return resendInstance;
}

export type SendEmailOptions = {
  // Forwarded verbatim to Resend's `Idempotency-Key` header (see
  // node_modules/resend/dist/index.d.mts — `IdempotentRequest.idempotencyKey`,
  // the second argument to `emails.send()`, not a body field). Optional and
  // additive: every existing call site that omits it is unaffected.
  idempotencyKey?: string;
};

export async function sendEmail(
  email: BuiltEmail,
  options?: SendEmailOptions
): Promise<{ success: boolean; error?: string; id?: string }> {
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? "FlowTrack Companion <companion@appflowtrack.com>";

  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send(
      {
        from: fromAddress,
        to: email.to,
        subject: email.subject,
        html: email.html,
        ...(email.text ? { text: email.text } : {}),
        ...(email.replyTo ? { replyTo: email.replyTo } : {}),
      },
      options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined
    );

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, id: data?.id };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
}
