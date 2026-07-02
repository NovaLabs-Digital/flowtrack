"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseclient";
import HelpModal from "@/app/components/HelpModal";

export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [userEmail, setUserEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
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
      setUserId(user.id);

      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (data) {
        const graceExpired =
          data.pro_grace_until &&
          new Date(data.pro_grace_until).getTime() < Date.now();

        const subscriptionInactive =
          data.stripe_subscription_status &&
          data.stripe_subscription_status !== "active" &&
          data.stripe_subscription_status !== "trialing";

        if (data.plan === "pro" && graceExpired && subscriptionInactive) {
          await supabase
            .from("profiles")
            .update({ plan: "free", pro_grace_until: null })
            .eq("id", user.id);

          data.plan = "free";
          data.pro_grace_until = null;
        }
      }

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
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
          >
            ← Back to Dashboard
          </button>
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-400 hover:bg-slate-800"
          >
            Need Help?
          </button>
        </div>

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
            <div className="mt-3 space-y-1 text-sm">
              <div className="text-slate-400">
                Email:{" "}
                <span className="text-slate-200">{userEmail}</span>
              </div>
            </div>
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
                  Upgrade to Pro for custom date ranges, advanced reports, and up to 180 days of history.
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

        </div>
      </div>

      <HelpModal
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
        userEmail={userEmail || undefined}
        userId={userId ?? undefined}
        currentPage="Settings"
      />
    </main>
  );
}