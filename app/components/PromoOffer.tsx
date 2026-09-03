import {
  isPromotionActive,
  getPromotionHeadline,
  getPromotionDisclosure,
  getPromotionShortBadge,
} from "@/lib/pricing";

// Slim top-of-page announcement. Links to the pricing section (scroll),
// never straight to signup/checkout — the visitor still chooses to act.
export function PromoAnnouncementBar() {
  if (!isPromotionActive()) return null;

  return (
    <a
      href="#pricing"
      className="block w-full border-b border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-center text-xs text-emerald-200 transition-colors hover:bg-emerald-500/15 sm:text-sm"
    >
      <span className="font-semibold text-emerald-100">{getPromotionHeadline()}</span>
      <span className="hidden text-emerald-400/80 sm:inline"> — see pricing ↓</span>
    </a>
  );
}

// Compact secondary mention near the hero's primary CTA. Deliberately
// smaller/quieter than the h1 and the CTA buttons themselves.
export function PromoHeroBadge() {
  if (!isPromotionActive()) return null;

  return (
    <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
      <span aria-hidden="true">🎉</span>
      {getPromotionShortBadge()}
    </p>
  );
}

// Green-accented callout with the full headline + disclosure. Reused inside
// the Pro pricing card and inside every "Unlock Pro" acquisition modal, so
// the wording is identical everywhere it appears.
export function PromoCallout({ className = "" }: { className?: string }) {
  if (!isPromotionActive()) return null;

  return (
    <div className={`rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 ${className}`}>
      <p className="text-xs font-semibold text-emerald-300">{getPromotionHeadline()}</p>
      <p className="mt-1 text-[10px] leading-relaxed text-emerald-400/80">{getPromotionDisclosure()}</p>
    </div>
  );
}
