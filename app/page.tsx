import Link from "next/link";
import Footer from "@/app/components/Footer";
import { PRICING } from "@/lib/pricing";

const SIGNUP_URL = "/signup";

const FREE_FEATURES = [
  "Up to 30 days of history",
  "Basic budgeting",
  "Basic reports",
  "Manual transaction entry",
  "Community support",
];

const PRO_FEATURES = [
  "Unlimited transactions",
  "Unlimited history",
  "Advanced budgeting",
  "AI Financial Coach",
  "CSV Export",
  "Print / PDF snapshots",
  "Extended date ranges",
  "All future Pro updates",
];

export default function HomePage() {
  return (
    <main className="bg-slate-950 text-slate-100">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <p className="text-sm font-semibold tracking-wide text-slate-300">
              Nova Labs Digital
            </p>
            <p className="text-xs text-slate-500">FlowTrack</p>
          </div>

          <Link
            href="/login"
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
          >
            Sign in
          </Link>
        </header>

        {/* Hero */}
        <section className="flex flex-1 items-center py-16">
          <div className="grid w-full gap-12 md:grid-cols-2 md:items-center">
            <div>
              <p className="mb-3 text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">
                FlowTrack
              </p>

              <h1 className="text-4xl font-semibold leading-tight text-white md:text-6xl">
                See it.
                <br />
                Measure it.
                <br />
                Control it.
              </h1>

              <p className="mt-6 max-w-xl text-base leading-7 text-slate-300 md:text-lg">
                Simple financial clarity for entrepreneurs, small business
                owners, contractors, and freelancers who want to understand
                where their money goes without the noise and complexity of
                traditional finance tools.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href={SIGNUP_URL}
                  className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                >
                  Get Started Free
                </a>

                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-lg border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
                >
                  I already have an account
                </Link>
              </div>

              <p className="mt-4 text-sm text-slate-500">
                Early beta access. Limited spots. Feedback shapes the product.
              </p>
            </div>

            {/* Right-side info card */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl">
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    What FlowTrack helps you do
                  </h2>
                  <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                    <li>• Track income and expenses in one clear place</li>
                    <li>• See where your money is actually going</li>
                    <li>• Measure progress over time</li>
                    <li>• Make decisions with more confidence and control</li>
                  </ul>
                </div>

                <div className="border-t border-slate-800 pt-6">
                  <h3 className="text-base font-semibold text-white">
                    Built for people who do not want accounting headaches
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    FlowTrack is designed for real life: simple entry,
                    clear visibility, and practical control without feeling like
                    bookkeeping software.
                  </p>
                </div>

                <div className="border-t border-slate-800 pt-6">
                  <h3 className="text-base font-semibold text-white">
                    Join the beta
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    We are onboarding users in small groups to keep the
                    experience focused and gather meaningful feedback before a
                    wider release.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="border-t border-slate-800 py-12">
          <div className="text-center">
            <h2 className="text-2xl font-semibold text-white">Choose your plan</h2>
            <p className="mt-2 text-sm text-slate-500">
              Choose the plan that's right for you.
            </p>
          </div>

          {/* sm:py-6 gives vertical breathing room for the scaled Pro card's badge + shadow */}
          <div className="mt-10 flex justify-center">
            <div className="grid w-full max-w-2xl grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-8 sm:py-6">

              {/* FREE card */}
              <div className="flex flex-col rounded-2xl border border-slate-700 bg-slate-900/40 p-7">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  Free
                </p>
                <p className="mt-1 text-xs text-slate-500">Perfect for getting started.</p>

                <div className="mt-6">
                  <p className="text-5xl font-bold tracking-tight text-white">$0</p>
                  <p className="mt-1 text-sm text-slate-500">Forever</p>
                </div>

                <ul className="mt-8 flex-1 space-y-2.5">
                  {FREE_FEATURES.map((feature) => (
                    <li key={feature} className="flex items-center gap-3 text-sm text-slate-500">
                      <span className="shrink-0 text-slate-600" aria-hidden="true">✓</span>
                      {feature}
                    </li>
                  ))}
                </ul>

                <a
                  href={SIGNUP_URL}
                  className="mt-8 block w-full rounded-xl border border-slate-600 py-3 text-center text-sm font-semibold text-slate-300 transition hover:bg-slate-800"
                >
                  Start Free
                </a>
                <p className="mt-2.5 text-center text-[11px] text-slate-700">
                  No credit card required.
                </p>
              </div>

              {/* PRO card — scaled ~5% larger on desktop */}
              <div className="relative flex flex-col rounded-2xl border border-emerald-500/50 bg-slate-900/60 p-7 shadow-[0_0_48px_-8px_rgba(52,211,153,0.12)] sm:scale-[1.05]">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">
                  Pro
                </p>
                <p className="mt-1 text-xs text-slate-500">Everything you need.</p>

                <div className="mt-6">
                  <p className="text-5xl font-bold tracking-tight text-white">
                    {PRICING.monthly.label}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">/month</p>
                  <p className="mt-2 text-[11px] text-slate-600">
                    Less than one coffee a month.
                  </p>
                </div>

                <ul className="mt-8 flex-1 space-y-2.5">
                  {PRO_FEATURES.map((feature) => (
                    <li key={feature} className="flex items-center gap-3 text-sm text-slate-300">
                      <span className="shrink-0 text-emerald-400" aria-hidden="true">✓</span>
                      {feature}
                    </li>
                  ))}
                </ul>

                <a
                  href={SIGNUP_URL}
                  className="mt-8 block w-full rounded-xl bg-emerald-500 py-3.5 text-center text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                >
                  Start Pro
                </a>
                <p className="mt-2.5 text-center text-[11px] text-slate-600">
                  Cancel anytime.
                </p>
              </div>

            </div>
          </div>
        </section>
      </section>
      <Footer />
    </main>
  );
}