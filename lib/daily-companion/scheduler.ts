import { Resend } from "resend";
import type { BuiltEmail } from "./email-builder";

let resendInstance: Resend | null = null;

function getResend(): Resend {
  if (!resendInstance) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is required");
    resendInstance = new Resend(key);
  }
  return resendInstance;
}

export async function sendEmail(email: BuiltEmail): Promise<{ success: boolean; error?: string }> {
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? "FlowTrack Companion <companion@appflowtrack.com>";

  try {
    const resend = getResend();
    const { error } = await resend.emails.send({
      from: fromAddress,
      to: email.to,
      subject: email.subject,
      html: email.html,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
}
