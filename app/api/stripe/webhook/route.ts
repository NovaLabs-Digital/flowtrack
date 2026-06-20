import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Missing STRIPE_WEBHOOK_SECRET" },
      { status: 500 }
    );
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${err?.message}` },
      { status: 400 }
    );
  }

  // ✅ Upgrade on checkout completion
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    const userId = session.metadata?.userId;
    if (!userId) {
      // Don’t fail the webhook; just report missing mapping
      return NextResponse.json({ received: true, missingUserId: true });
    }

    const customerId =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id ?? null;

    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id ?? null;

    const { error } = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          id: userId,
          plan: "pro",
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          stripe_subscription_status: "active",
          pro_grace_until: null,
        },
        { onConflict: "id" }
      );

    if (error) {
      return NextResponse.json(
        { error: `Supabase update failed: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      received: true,
      updated: true,
      userId,
      customerId,
      subscriptionId,
    });
  }

  // ✅ Handle subscription.created so it never 500s
  // (We don’t require userId here unless you explicitly set subscription metadata.)
  if (event.type === "customer.subscription.created") {
    const sub = event.data.object as Stripe.Subscription;

    const customerId =
      typeof sub.customer === "string"
        ? sub.customer
        : sub.customer && "id" in sub.customer
        ? sub.customer.id
        : null;

    const userId = sub.metadata?.userId;

    // If no userId in subscription metadata, do NOT fail.
    // We'll rely on checkout.session.completed (which should have metadata.userId).
    if (!userId) {
      return NextResponse.json({ received: true, missingUserId: true });
    }

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        plan: "pro",
        stripe_customer_id: customerId,
        stripe_subscription_id: sub.id,
        stripe_subscription_status: sub.status,
      })
      .eq("id", userId);

    if (error) {
      return NextResponse.json(
        { error: `Supabase update failed: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ received: true, updated: true, userId });
  }

// ✅ Start grace period when payment fails
if (event.type === "invoice.payment_failed") {
  const invoice = event.data.object as Stripe.Invoice;

  const subscriptionId =
  typeof (invoice as any).subscription === "string"
    ? (invoice as any).subscription
    : (invoice as any).subscription?.id ?? null;

  if (!subscriptionId) {
    return NextResponse.json({ received: true, missingSubscriptionId: true });
  }

  const graceUntil = new Date();
  graceUntil.setDate(graceUntil.getDate() + 3);

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      stripe_subscription_status: "past_due",
      pro_grace_until: graceUntil.toISOString(),
    })
    .eq("stripe_subscription_id", subscriptionId);

  if (error) {
    return NextResponse.json(
      { error: `Supabase grace update failed: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true, graceStarted: true });
}

// ✅ Restore Pro when invoice is paid
if (event.type === "invoice.payment_succeeded") {
  const invoice = event.data.object as Stripe.Invoice;

  const subscriptionId =
  typeof (invoice as any).subscription === "string"
    ? (invoice as any).subscription
    : (invoice as any).subscription?.id ?? null;

  if (!subscriptionId) {
    return NextResponse.json({ received: true, missingSubscriptionId: true });
  }

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      plan: "pro",
      stripe_subscription_status: "active",
      pro_grace_until: null,
    })
    .eq("stripe_subscription_id", subscriptionId);

  if (error) {
    return NextResponse.json(
      { error: `Supabase payment restore failed: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true, restored: true });
}

  // ✅ Downgrade to free when subscription is canceled
    if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;

   const userId = sub.metadata?.userId;

    let profileQuery = supabaseAdmin
      .from("profiles")
      .update({
        plan: "free",
        stripe_subscription_id: null,
        stripe_subscription_status: sub.status,
        pro_grace_until: null,
      });

    if (userId) {
      profileQuery = profileQuery.eq("id", userId);
    } else {
      profileQuery = profileQuery.eq(
        "stripe_subscription_id",
        sub.id
      );
    }

   const { error } = await profileQuery;

    if (error) {
      return NextResponse.json(
        { error: `Supabase downgrade failed: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ received: true, downgraded: true, userId });
  }

  return NextResponse.json({
    received: true,
    ignored: event.type,
  });
}