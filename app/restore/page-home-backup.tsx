// app/page.tsx
import Link from "next/link";
import { PRICING } from "@/lib/pricing";


export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-100">
      <div className="max-w-xl w-full px-6 py-10 bg-slate-800/80 rounded-2xl shadow-xl border border-slate-700">
        <h1 className="text-2xl md:text-3xl font-semibold mb-4">
          Take Control of Your Money
        </h1>
        <p className="text-sm md:text-base text-slate-300 mb-6">
          If you can <span className="font-semibold">see</span> it, you can
          measure it. If you can measure it, you can control it.
          No more guessing. No more paycheck-to-paycheck surprises.
        </p>

        <div className="space-y-3">
          <Link
            href="/signup"
            className="block w-full text-center rounded-lg py-2.5 text-sm font-medium bg-emerald-500 hover:bg-emerald-400 transition"
          >
            Get Started — 30-Day Free Trial
          </Link>

          <Link
            href="/login"
            className="block w-full text-center rounded-lg py-2.5 text-sm font-medium border border-slate-500 hover:bg-slate-700/60 transition"
          >
            I already have an account
          </Link>
        </div>

        <p className="mt-4 text-[11px] text-slate-400">
          Built for young professionals who want clarity, not complexity.
        </p>
      </div>
    </main>
  );
}
