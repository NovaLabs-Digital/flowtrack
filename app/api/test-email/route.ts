import { NextResponse } from "next/server";
import { buildGoodMorningEmail } from "@/lib/daily-companion";
import { sendEmail } from "@/lib/daily-companion";
import type { DailyReport } from "@/lib/daily-companion";

export const runtime = "nodejs";

const testReport: DailyReport = {
  userName: "Alberto",
  userEmail: "admin@novalabsdigital.com",
  emailType: "good_morning",
  greeting: "Good morning, Alberto.",
  bills: [
    {
      name: "Apple Card",
      dueLabel: "Due Tomorrow",
      minimumPayment: 95.74,
      recommendedPayment: 145.74,
      freedomDaysGained: 11,
      balance: 4280,
    },
  ],
  freedomDate: "September 29, 2031",
  freedomDaysGained: 14,
  debtRemaining: 19840,
  progressPercent: 18,
  encouragement: "Every good financial decision builds a stronger tomorrow.",
  generatedAt: new Date().toISOString(),
};

export async function POST() {
  try {
    const email = buildGoodMorningEmail(testReport);
    const result = await sendEmail(email);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, sentTo: email.to, subject: email.subject });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
