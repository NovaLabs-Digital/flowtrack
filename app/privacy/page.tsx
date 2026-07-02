import Link from "next/link";
import Footer from "@/app/components/Footer";

export default function PrivacyPage() {
  return (
    <main className="bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-10"
        >
          <svg
            className="w-3 h-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to FlowTrack
        </Link>

        <h1 className="text-3xl font-semibold text-white">Privacy Policy</h1>
        <p className="mt-2 text-xs text-slate-500">Last updated: July 1, 2026</p>

        <div className="mt-10 space-y-8 text-sm leading-7 text-slate-400">
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">1. Who we are</h2>
            <p>
              FlowTrack is a product of Nova Labs Digital LLC. We provide a
              personal finance dashboard for entrepreneurs, freelancers, and small
              business owners. Our contact email is{" "}
              <a
                href="mailto:support@appflowtrack.com"
                className="text-emerald-400 hover:underline"
              >
                support@appflowtrack.com
              </a>
              .
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">2. What data we collect</h2>
            <p>
              We collect only the data necessary to provide the service:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Email address (for authentication and communications)</li>
              <li>Financial transactions you enter manually (income, expenses)</li>
              <li>Dashboard preferences (e.g., date range, category order)</li>
              <li>Billing information (processed by Stripe — we never store card numbers)</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">3. How we use your data</h2>
            <p>
              Your data is used exclusively to operate and improve FlowTrack. We
              do not sell, rent, or share your personal or financial data with
              third parties for advertising purposes.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">4. Data storage and security</h2>
            <p>
              Your data is stored in Supabase (hosted on AWS). Row-level security
              ensures your records are only accessible to your authenticated
              account. All data is transmitted over HTTPS.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">5. Data retention and deletion</h2>
            <p>
              You may request deletion of your account and all associated data at
              any time by contacting us at support@appflowtrack.com. We will
              process deletion requests within 30 days.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">6. Cookies</h2>
            <p>
              FlowTrack uses session cookies required for authentication. We do
              not use tracking or advertising cookies.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">7. Changes to this policy</h2>
            <p>
              We may update this policy from time to time. Material changes will
              be communicated by email or a notice in the dashboard. Continued use
              of FlowTrack after changes constitutes acceptance.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">8. Contact</h2>
            <p>
              Questions about this policy? Email{" "}
              <a
                href="mailto:support@appflowtrack.com"
                className="text-emerald-400 hover:underline"
              >
                support@appflowtrack.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
      <Footer />
    </main>
  );
}
