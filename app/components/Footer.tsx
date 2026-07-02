import Link from "next/link";

function Dot() {
  return <span className="text-slate-700 select-none">•</span>;
}

export default function Footer() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950">
      <div className="mx-auto max-w-6xl px-6 py-8">

        {/* Line 1 — Navigation */}
        <nav
          aria-label="Footer navigation"
          className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-8"
        >
          {/* Support */}
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
              </svg>
              Support:
            </span>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <a
                href="mailto:support@appflowtrack.com"
                className="text-slate-400 transition-colors hover:text-slate-100"
              >
                Contact
              </a>
              <Dot />
              <Link href="/faq" className="text-slate-400 transition-colors hover:text-slate-100">
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

          {/* Vertical divider — desktop only */}
          <div className="hidden sm:block self-stretch w-px bg-slate-800" aria-hidden="true" />

          {/* Product */}
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              Product:
            </span>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Link href="/#features" className="text-slate-400 transition-colors hover:text-slate-100">
                Features
              </Link>
              <Dot />
              <Link href="/signup" className="text-slate-400 transition-colors hover:text-slate-100">
                Pricing
              </Link>
              <Dot />
              <Link href="/#ai-coach" className="text-slate-400 transition-colors hover:text-slate-100">
                AI Financial Coach
              </Link>
            </div>
          </div>

          {/* Vertical divider — desktop only */}
          <div className="hidden sm:block self-stretch w-px bg-slate-800" aria-hidden="true" />

          {/* Legal */}
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Legal:
            </span>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Link href="/privacy" className="text-slate-400 transition-colors hover:text-slate-100">
                Privacy Policy
              </Link>
              <Dot />
              <Link href="/terms" className="text-slate-400 transition-colors hover:text-slate-100">
                Terms of Service
              </Link>
              <Dot />
              <Link href="/refund" className="text-slate-400 transition-colors hover:text-slate-100">
                Refund Policy
              </Link>
            </div>
          </div>
        </nav>

        {/* Line 2 — Divider */}
        <div className="mt-6 border-t border-slate-800" />

        {/* Line 3 — Bottom bar */}
        <div className="mt-4 flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-slate-600">
            © 2026 Nova Labs Digital LLC. All rights reserved.
          </p>
          <p className="text-[11px] text-slate-700">FlowTrack v1.0</p>
        </div>

      </div>
    </footer>
  );
}
