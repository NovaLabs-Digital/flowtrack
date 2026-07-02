import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";

const CATEGORY_LABELS: Record<string, string> = {
  question: "❓ Question",
  bug: "🐞 Bug Report",
  idea: "💡 Feature Idea",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      userName,
      userEmail,
      userId,
      page,
      userAgent,
      timestamp,
      category,
      subject,
      message,
    } = body as {
      userName: string;
      userEmail: string;
      userId: string;
      page: string;
      userAgent: string;
      timestamp: string;
      category: string;
      subject: string;
      message: string;
    };

    const key = process.env.RESEND_API_KEY;
    if (!key) {
      return NextResponse.json(
        { error: "Email service not configured." },
        { status: 500 }
      );
    }

    const resend = new Resend(key);
    const from =
      process.env.RESEND_FROM_ADDRESS ??
      "FlowTrack Companion <companion@appflowtrack.com>";

    const categoryLabel = CATEGORY_LABELS[category] ?? "General";
    const sentAt = new Date(timestamp).toLocaleString("en-US", {
      timeZoneName: "short",
    });

    const html = `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px;">
<div style="max-width:580px;margin:0 auto;background:#1e293b;border:1px solid #334155;border-radius:12px;overflow:hidden;">
  <div style="padding:20px 24px;border-bottom:1px solid #334155;">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.15em;color:#64748b;margin-bottom:6px;">FlowTrack Support</div>
    <div style="font-size:17px;font-weight:600;color:#f1f5f9;">${escapeHtml(categoryLabel)}: ${escapeHtml(subject)}</div>
  </div>
  <div style="padding:20px 24px;">
    <div style="font-size:14px;line-height:1.7;color:#cbd5e1;white-space:pre-wrap;">${escapeHtml(message)}</div>
    <hr style="border:none;border-top:1px solid #334155;margin:20px 0;" />
    <table style="width:100%;font-size:11px;color:#94a3b8;border-collapse:collapse;">
      <tr><td style="padding:4px 0;color:#64748b;width:90px;">User</td><td style="padding:4px 0;">${escapeHtml(userName)} &lt;${escapeHtml(userEmail)}&gt;</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;">User ID</td><td style="padding:4px 0;">${escapeHtml(userId)}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;">Page</td><td style="padding:4px 0;">${escapeHtml(page)}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;">Sent</td><td style="padding:4px 0;">${escapeHtml(sentAt)}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;vertical-align:top;">Browser</td><td style="padding:4px 0;word-break:break-all;">${escapeHtml(userAgent)}</td></tr>
    </table>
  </div>
</div>
</body>
</html>`;

    const { error } = await resend.emails.send({
      from,
      to: "support@appflowtrack.com",
      replyTo: userEmail,
      subject: `[FlowTrack Support] ${categoryLabel}: ${subject}`,
      html,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
