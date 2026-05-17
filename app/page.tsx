import Link from "next/link";

const WAITLIST_URL = "PASTE_YOUR_GOOGLE_FORM_LINK_HERE";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <p className="text-sm font-semibold tracking-wide text-slate-300">
              Nova Labs Digital
            </p>
            <p className="text-xs text-slate-500">FlowTrack Personal</p>
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
                FlowTrack Personal
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
                  href={WAITLIST_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                >
                  Request Beta Access
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
                    FlowTrack Personal is designed for real life: simple entry,
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

        {/* Bottom section */}
        <section className="border-t border-slate-800 py-10">
          <div className="grid gap-8 md:grid-cols-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                For
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                Solo entrepreneurs, small business owners, contractors, and
                freelancers who want clarity without complexity.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                Beta access
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                Request access through the waitlist. Approved users will receive
                onboarding instructions by email.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                Contact
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                Nova Labs Digital
                <br />
                support@appflowtrack.com
              </p>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}