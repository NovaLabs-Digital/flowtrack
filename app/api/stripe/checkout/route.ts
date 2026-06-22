import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function isLiveStripeKey(key: string) {
  return key.startsWith("sk_live_");
}

export async function POST(req: Request) {
  try {
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user.id;
    const email = user.email;

    if (!email) {
      return NextResponse.json(
        { error: "No email on authenticated user" },
        { status: 400 }
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      return NextResponse.json(
        { error: "Missing NEXT_PUBLIC_APP_URL" },
        { status: 500 }
      );
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return NextResponse.json(
        { error: "Missing STRIPE_SECRET_KEY" },
        { status: 500 }
      );
    }

    const priceId = isLiveStripeKey(secretKey)
      ? process.env.STRIPE_PRICE_MONTHLY_LIVE
      : process.env.STRIPE_PRICE_MONTHLY_TEST;

    if (!priceId) {
      return NextResponse.json(
        {
          error: isLiveStripeKey(secretKey)
            ? "Missing STRIPE_PRICE_MONTHLY_LIVE"
            : "Missing STRIPE_PRICE_MONTHLY_TEST",
        },
        { status: 500 }
      );
    }

    const { data: profile, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", userId)
      .single();

    if (profErr) {
      return NextResponse.json(
        { error: `Profile lookup failed: ${profErr.message}` },
        { status: 500 }
      );
    }

    const stripeCustomerId = profile?.stripe_customer_id ?? null;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],

      ...(stripeCustomerId
        ? { customer: stripeCustomerId }
        : { customer_email: email }),

      success_url: `${appUrl}/dashboard?upgraded=1`,
      cancel_url: `${appUrl}/dashboard?canceled=1`,

      metadata: { userId, email },
      client_reference_id: userId,
      subscription_data: {
        metadata: { userId, email },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Stripe error" },
      { status: 500 }
    );
  }
}
