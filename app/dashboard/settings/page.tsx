"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseclient";

export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [userEmail, setUserEmail] = useState("");

  async function handleManageBilling() {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        alert("Not logged in");
        return;
      }

      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: session.user.id }),
      });

      const data = await res.json();

      if (data.url) {
        window.location.href = data.url;
        return;
      }

      alert(data.error || "Unable to open billing portal.");
    } catch (err) {
      console.error(err);
      alert("Something went wrong.");
    }
  }

  async function handleUpgrade() {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        alert("Not logged in");
        return;
      }

      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: session.user.id,
          email: session.user.email,
        }),
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        // ignore parse error
      }

      if (!res.ok) {
        alert(data?.error ?? `Checkout failed (status ${res.status})`);
        return;
      }

      if (data?.url) {
        window.location.href = data.url;
      } else {
        alert("Checkout failed: missing session url");
      }
    } catch (err) {
      console.error(err);
      alert("Something went wrong.");
    }
  }

  useEffect(() => {
    async function loadProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;
      setUserEmail(user.email || "");

      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      setProfile(data);
    }

    loadProfile();
  }, []);

  const graceExpired =
    profile?.pro_grace_until &&
    new Date(profile.pro_grace_until).getTime() < Date.now();

  const billingIssue =
    profile?.stripe_subscription_status === "past_due" ||
    profile?.stripe_subscription_status === "unpaid" ||
    profile?.stripe_subscription_status === "canceled";

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <button
          onClick={() => router.push("/dashboard")}
          className="mb-6 w-full rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800 sm:w-auto"
        >
          ← Back to Dashboard
        </button>

        <h1 className="text-xl font-semibold sm:text-2xl">
        Settings
        </h1>
        
        <p className="mt-2 text-sm text-slate-400">
          Manage your FlowTrack account, billing, and preferences.
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Signed in as {userEmail}
            </p>
        <div className="mt-8 grid gap-4 sm:gap-5 md:grid-cols-2">
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <h2 className="text-base font-semibold sm:text-lg">Account</h2>
            <p className="mt-2 text-sm text-slate-400">
              Profile and login settings will live here.
            </p>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <h2 className="text-base font-semibold sm:text-lg">Subscription & Billing</h2>
            <p className="mt-2 text-sm text-slate-400">
              Manage payment method, invoices, and subscription status.
            </p>

            {profile?.plan === "pro" ? (
              <>
                <div className="mt-4 space-y-2 text-sm">
                  <div>
                    Plan:{" "}
                    <span className="font-semibold text-emerald-400">PRO</span>
                  </div>

                  <div>
                    Subscription status:{" "}
                    <span
                      className={
                        profile?.stripe_subscription_status === "past_due"
                          ? "font-semibold text-amber-400"
                          : profile?.stripe_subscription_status === "active"
                          ? "font-semibold text-emerald-400"
                          : "text-slate-300"
                      }
                    >
                      {profile?.stripe_subscription_status || "none"}
                    </span>
                  </div>

                  {billingIssue && (
                    <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                      {graceExpired
                        ? "Your Pro access has expired. Update billing to restore Pro features."
                        : "Payment issue detected. Update billing to restore or keep Pro access."}
                    </div>
                  )}

                  {profile?.pro_grace_until && (
                    <div className="text-amber-400">
                      Grace access active until{" "}
                      {new Date(profile.pro_grace_until).toLocaleDateString()}.
                    </div>
                  )}
                </div>

                <button
                  onClick={handleManageBilling}
                  className="mt-4 rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800"
                >
                  Open Billing Portal
                </button>
              </>
            ) : (
              <div className="mt-4 space-y-2 text-sm">
                <div>
                  Plan:{" "}
                  <span className="font-semibold text-slate-300">FREE</span>
                </div>

                <p className="text-slate-400">
                  Upgrade to Pro for custom date ranges, advanced reports, and up to 120 days of history.
                </p>

                <button
                  onClick={handleUpgrade}
                  className="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                >
                  Upgrade to Pro
                </button>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <h2 className="text-base font-semibold sm:text-lg">Preferences</h2>
            <p className="mt-2 text-sm text-slate-400">
              Default date range, categories, and display options.
            </p>

            <button
            className="mt-4 rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800"
            disabled
            >
            Preferences coming next
            </button>

            <button
            className="mt-4 rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800"
            disabled
            >
            Profile tools coming next
            </button>

            <button
            className="mt-4 rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800"
            disabled
            >
            Security tools coming next
            </button>

          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <h2 className="text-base font-semibold sm:text-lg">Security</h2>
            <p className="mt-2 text-sm text-slate-400">
              Password and account security options.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}