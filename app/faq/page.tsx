import Link from "next/link";
import Footer from "@/app/components/Footer";

const faqs = [
  {
    q: "What is FlowTrack?",
    a: "FlowTrack is a personal finance dashboard built for entrepreneurs, freelancers, and small business owners who want clear visibility into their income and expenses without the complexity of traditional accounting software.",
  },
  {
    q: "Is FlowTrack free to use?",
    a: "Yes. FlowTrack has a free tier that gives you up to 30 days of transaction history and core tracking features. Pro unlocks extended history (up to 180 days), custom date ranges, PDF reports, and the AI Financial Coach.",
  },
  {
    q: "What is the AI Financial Coach?",
    a: "The AI Financial Coach analyzes your actual income, expenses, savings rate, and cash flow to surface prioritized insights. It does not invent calculations — every recommendation is grounded in your real numbers.",
  },
  {
    q: "How do I cancel or change my plan?",
    a: "You can manage your subscription at any time from the Settings page inside your dashboard. There are no long-term contracts — you can cancel anytime.",
  },
  {
    q: "Is my financial data secure?",
    a: "Yes. FlowTrack stores your data in Supabase with row-level security, meaning your data is only accessible to your authenticated account. We do not share or sell your data.",
  },
  {
    q: "How do I get support?",
    a: "Email us at support@appflowtrack.com. We aim to respond within one business day.",
  },
];

export default function FaqPage() {
  return (
    <main className="bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-6 py-16">
        {/* Back */}
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

        <h1 className="text-3xl font-semibold text-white">
          Frequently Asked Questions
        </h1>
        <p className="mt-3 text-sm text-slate-400">
          Have a question not listed here? Email us at{" "}
          <a
            href="mailto:support@appflowtrack.com"
            className="text-emerald-400 hover:underline"
          >
            support@appflowtrack.com
          </a>
          .
        </p>

        <div className="mt-10 space-y-6">
          {faqs.map((item) => (
            <div
              key={item.q}
              className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"
            >
              <h2 className="text-sm font-semibold text-slate-100">{item.q}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{item.a}</p>
            </div>
          ))}
        </div>
      </div>
      <Footer />
    </main>
  );
}
