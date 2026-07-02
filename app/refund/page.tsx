import Link from "next/link";
import Footer from "@/app/components/Footer";

export default function RefundPage() {
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

        <h1 className="text-3xl font-semibold text-white">Refund Policy</h1>
        <p className="mt-2 text-xs text-slate-500">Last updated: July 1, 2026</p>

        <div className="mt-10 space-y-8 text-sm leading-7 text-slate-400">
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">Our commitment</h2>
            <p>
              We want you to feel confident using FlowTrack. If the product does
              not meet your needs, we will work with you to make it right.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">Free tier</h2>
            <p>
              The free tier requires no payment. No refunds are applicable.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">Pro plan — 7-day refund window</h2>
            <p>
              If you upgrade to FlowTrack Pro and are not satisfied, you may
              request a full refund within <strong className="text-slate-200">7 days</strong> of your
              initial purchase. Refunds are not available for renewals after the
              first billing period.
            </p>
            <p>
              To request a refund, email{" "}
              <a
                href="mailto:support@appflowtrack.com?subject=Refund Request"
                className="text-emerald-400 hover:underline"
              >
                support@appflowtrack.com
              </a>{" "}
              with the subject line "Refund Request" and include the email address
              associated with your account. We will process your request within 3
              business days.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">Cancellations</h2>
            <p>
              You may cancel your Pro subscription at any time from the Settings
              page inside your dashboard. Cancellation stops future billing. You
              retain Pro access through the end of your current billing period. No
              partial refunds are issued for unused time beyond the 7-day window.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">Exceptions</h2>
            <p>
              We reserve the right to decline refund requests in cases of repeated
              abuse of this policy or violations of the Terms of Service.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-200">Contact</h2>
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
