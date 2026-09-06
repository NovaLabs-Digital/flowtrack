import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { checkMfaAuthorization, MFA_DENIAL_BODY, MFA_DENIAL_STATUS } from "@/lib/mfa/serverAuthorize";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

    const { authorized } = await checkMfaAuthorization(supabaseAdmin, token, user.id);
    if (!authorized) {
      return NextResponse.json(MFA_DENIAL_BODY, { status: MFA_DENIAL_STATUS });
    }

    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (error || !profile?.stripe_customer_id) {
      return NextResponse.json(
        { error: "Stripe customer not found" },
        { status: 404 }
      );
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Stripe portal error:", err);

    return NextResponse.json(
      { error: "Unable to create Stripe portal session" },
      { status: 500 }
    );
  }
}
