import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950">
      <div className="mx-auto max-w-6xl px-6 py-12">
        {/* 4-column grid */}
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-200">FlowTrack</p>
            <p className="text-xs leading-relaxed text-slate-500">
              See it. Measure it. Control it.
            </p>
            <p className="text-xs leading-relaxed text-slate-500">
              Helping entrepreneurs take control of their finances.
            </p>
          </div>

          {/* Product */}
          <div className="space-y-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Product
            </p>
            <ul className="space-y-2.5">
              <li>
                <Link
                  href="/#features"
                  className="text-xs text-slate-500 transition-colors hover:text-slate-200"
                >
                  Features
                </Link>
              </li>
              <li>
                <Link
                  href="/signup"
                  className="text-xs text-slate-500 transition-colors hover:text-slate-200"
                >
                  Pricing
                </Link>
              </li>
              <li>
                <Link
                  href="/#ai-coach"
                  className="text-xs text-slate-500 transition-colors hover:text-slate-200"
                >
                  AI Financial Coach
                </Link>
              </li>
            </ul>
          </div>

          {/* Support */}
          <div className="space-y-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Support
            </p>
            <ul className="space-y-2.5">
              <li>
                <a
                  href="mailto:support@appflowtrack.com"
                  className="text-xs text-slate-500 transition-colors hover:text-slate-200"
                >
                  Contact
                </a>
              </li>
              <li>
                <Link
                  href="/faq"
                  className="text-xs text-slate-500 transition-colors hover:text-slate-200"
                >
                  FAQ
                </Link>
              </li>
              <li>
                <span className="text-xs text-slate-600">
                  Help Center{" "}
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-500">
                    Coming Soon
                  </span>
                </span>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div className="space-y-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Legal
            </p>
            <ul className="space-y-2.5">
              <li>
                <Link
                  href="/privacy"
                  className="text-xs text-slate-500 transition-colors hover:text-slate-200"
                >
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="text-xs text-slate-500 transition-colors hover:text-slate-200"
                >
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link
                  href="/refund"
                  className="text-xs text-slate-500 transition-colors hover:text-slate-200"
                >
                  Refund Policy
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-slate-800 pt-6 sm:flex-row">
          <p className="text-[11px] text-slate-600">
            © 2026 Nova Labs Digital LLC. All rights reserved.
          </p>
          <p className="text-[11px] text-slate-700">Version 1.0</p>
        </div>
      </div>
    </footer>
  );
}
