import Link from "next/link";

function Dot() {
  return <span className="text-slate-700 select-none" aria-hidden="true">•</span>;
}

export default function Footer() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950">
      <div className="mx-auto max-w-6xl px-6 py-10">

        {/* Main row: brand left + nav groups right */}
        <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between">

          {/* Brand */}
          <div className="shrink-0 space-y-2 lg:max-w-[220px]">
            <p className="text-sm font-semibold text-slate-200">FlowTrack</p>
            <p className="text-xs leading-relaxed text-slate-500">
              See it. Measure it. Control it.
            </p>
            <p className="text-xs leading-relaxed text-slate-500">
              Helping entrepreneurs take control of their finances.
            </p>
          </div>

          {/* Nav groups */}
          <nav
            aria-label="Footer navigation"
            className="grid grid-cols-1 gap-8 sm:grid-cols-3 lg:gap-12"
          >
            {/* Support */}
            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Support
              </p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
                <a
                  href="mailto:support@appflowtrack.com"
                  className="text-slate-400 transition-colors hover:text-slate-100"
                >
                  Contact
                </a>
                <Dot />
                <Link
                  href="/faq"
                  className="text-slate-400 transition-colors hover:text-slate-100"
                >
                  FAQ
                </Link>
                <Dot />
                <span className="inline-flex items-center gap-1.5 text-slate-600">
                  Help Center
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-500">
                    Coming Soon
                  </span>
                </span>
              </div>
            </div>

            {/* Product */}
            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Product
              </p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
                <Link
                  href="/#features"
                  className="text-slate-400 transition-colors hover:text-slate-100"
                >
                  Features
                </Link>
                <Dot />
                <Link
                  href="/signup"
                  className="text-slate-400 transition-colors hover:text-slate-100"
                >
                  Pricing
                </Link>
                <Dot />
                <Link
                  href="/#ai-coach"
                  className="text-slate-400 transition-colors hover:text-slate-100"
                >
                  AI Financial Coach
                </Link>
              </div>
            </div>

            {/* Legal */}
            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Legal
              </p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
                <Link
                  href="/privacy"
                  className="text-slate-400 transition-colors hover:text-slate-100"
                >
                  Privacy Policy
                </Link>
                <Dot />
                <Link
                  href="/terms"
                  className="text-slate-400 transition-colors hover:text-slate-100"
                >
                  Terms of Service
                </Link>
                <Dot />
                <Link
                  href="/refund"
                  className="text-slate-400 transition-colors hover:text-slate-100"
                >
                  Refund Policy
                </Link>
              </div>
            </div>
          </nav>
        </div>

        {/* Divider */}
        <div className="mt-10 border-t border-slate-800" />

        {/* Bottom bar */}
        <div className="mt-5 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-slate-600">
            © 2026 Nova Labs Digital LLC. All rights reserved.
          </p>
          <p className="text-[11px] text-slate-700">FlowTrack v1.0</p>
        </div>

      </div>
    </footer>
  );
}
