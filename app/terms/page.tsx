import Link from "next/link";
import Footer from "@/app/components/Footer";

export default function TermsPage() {
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

        <h1 className="text-3xl font-semibold text-white">Terms of Service</h1>
        <p className="mt-2 text-xs text-slate-500">Last updated: July 1, 2026</p>

        <div className="mt-10 space-y-8 text-sm leading-7 text-slate-400">
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">1. Acceptance</h2>
            <p>
              By creating an account or using FlowTrack, you agree to these Terms
              of Service. If you do not agree, do not use the service. FlowTrack
              is operated by Nova Labs Digital LLC.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">2. Use of the service</h2>
            <p>
              FlowTrack is a personal finance tracking tool. You may use it to
              record your own income, expenses, and financial goals. You may not
              use it for unlawful purposes, to input false information, or to
              attempt to gain unauthorized access to other accounts or systems.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">3. Accounts</h2>
            <p>
              You are responsible for maintaining the confidentiality of your
              account credentials. You agree to notify us immediately of any
              unauthorized access. Nova Labs Digital LLC is not liable for losses
              resulting from unauthorized account use.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">4. Subscriptions and billing</h2>
            <p>
              FlowTrack offers a free tier and a paid Pro plan. Pro subscriptions
              are billed monthly. You may cancel at any time. See the Refund
              Policy for details on refunds.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">5. No financial advice</h2>
            <p>
              FlowTrack provides tools and insights based on data you enter. This
              is not financial advice. Always consult a qualified financial
              professional for decisions that affect your financial wellbeing.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">6. Availability</h2>
            <p>
              We aim for high availability but do not guarantee uninterrupted
              service. We may perform maintenance or updates that temporarily
              affect access.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">7. Limitation of liability</h2>
            <p>
              Nova Labs Digital LLC is not liable for any indirect, incidental, or
              consequential damages arising from your use of FlowTrack. Our total
              liability is limited to the amount you paid in the 30 days preceding
              any claim.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">8. Termination</h2>
            <p>
              We reserve the right to suspend or terminate accounts that violate
              these terms. You may delete your account at any time by contacting
              support.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">9. Governing law</h2>
            <p>
              These terms are governed by the laws of the State of Florida, United
              States, without regard to conflict of law principles.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">10. Contact</h2>
            <p>
              Questions?{" "}
              <a
                href="mailto:support@appflowtrack.com"
                className="text-emerald-400 hover:underline"
              >
                support@appflowtrack.com
              </a>
            </p>
          </section>
        </div>
      </div>
      <Footer />
    </main>
  );
}
