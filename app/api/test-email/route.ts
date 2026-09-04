import { NextResponse } from "next/server";
import { buildGoodMorningEmail } from "@/lib/daily-companion";
import { sendEmail } from "@/lib/daily-companion";
import type { DailyReport } from "@/lib/daily-companion";

export const runtime = "nodejs";

function buildTestReport(recipientEmail: string): DailyReport {
  return {
    userName: "Test User",
    userEmail: recipientEmail,
    emailType: "good_morning",
    greeting: "Good morning, Test User.",
    bills: [
      {
        name: "Apple Card",
        dueLabel: "Due Tomorrow",
        minimumPayment: 95.74,
        recommendedPayment: 145.74,
        freedomDaysGained: 11,
        balance: 4280,
        paymentSourceName: "Chase Checking",
        paymentSourceLast4: "1234",
      },
    ],
    freedomDate: "September 29, 2031",
    freedomDaysGained: 14,
    debtRemaining: 19840,
    progressPercent: 18,
    encouragement: "Every good financial decision builds a stronger tomorrow.",
    generatedAt: new Date().toISOString(),
  };
}

export async function POST() {
  // Every Vercel build (Production and Preview alike) runs `next build`,
  // which sets NODE_ENV=production regardless of which Vercel environment
  // it's deployed to. Only `next dev` (local) sets NODE_ENV=development, so
  // this check alone removes the route from every deployed environment.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (process.env.ENABLE_TEST_EMAIL !== "true") {
    return NextResponse.json(
      {
        success: false,
        error: "Test email sending is disabled. Set ENABLE_TEST_EMAIL=true locally to enable it.",
      },
      { status: 403 }
    );
  }

  const recipient = process.env.TEST_EMAIL_RECIPIENT;
  if (!recipient) {
    return NextResponse.json(
      { success: false, error: "TEST_EMAIL_RECIPIENT is not set." },
      { status: 400 }
    );
  }

  try {
    const email = buildGoodMorningEmail(buildTestReport(recipient));
    const result = await sendEmail(email);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, subject: email.subject });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
