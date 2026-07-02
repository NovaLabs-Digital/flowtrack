"use client";

import { useState, type FormEvent } from "react";

type Category = "question" | "bug" | "idea";

// Auto-generated subject per category — no user typing required
const ACTIONS: {
  category: Category;
  emoji: string;
  label: string;
  subject: string;
}[] = [
  { category: "question", emoji: "❓", label: "Ask a Question", subject: "General Question" },
  { category: "bug",      emoji: "🐞", label: "Report a Bug",   subject: "Bug Report" },
  { category: "idea",     emoji: "💡", label: "Suggest an Idea", subject: "Feature Request" },
];

// ── Types ──────────────────────────────────────────────────────────────────────
// Future slots: "live_chat" | "ai_assistant" | "ticket_history" | "attachments"

export interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  userName?: string;
  userEmail?: string;
  userId?: string;
  currentPage?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function HelpModal({
  isOpen,
  onClose,
  userName,
  userEmail,
  userId,
  currentPage,
}: HelpModalProps) {
  const [category, setCategory] = useState<Category | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const selectedAction = ACTIONS.find((a) => a.category === category) ?? null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!category || !message.trim()) return;

    setSending(true);
    setError(null);

    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userName:  userName  || "FlowTrack User",
          userEmail: userEmail || undefined,
          userId:    userId    || "unknown",
          page:      currentPage || "Dashboard",
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
          category,
          subject:   selectedAction?.subject ?? "General Question",
          message:   message.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to send your message. Please try again.");
        return;
      }

      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  }

  function handleClose() {
    onClose();
    // Reset after the modal fade animation would complete
    setTimeout(() => {
      setSent(false);
      setCategory(null);
      setMessage("");
      setError(null);
    }, 200);
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-100">How can we help?</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Questions, bug reports, and ideas go directly to the FlowTrack team.
            </p>
            <p className="mt-0.5 text-xs text-slate-500">We read every message.</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="shrink-0 rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* ── Success screen ── */}
        {sent ? (
          <div className="p-8 text-center">
            <div className="mb-4 text-3xl">✅</div>
            <p className="text-base font-semibold text-slate-100">Message Sent</p>
            <p className="mt-4 text-sm leading-relaxed text-slate-400">
              Thank you for helping improve FlowTrack.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Your message has been delivered to the FlowTrack team.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              Every message is personally reviewed and helps us make FlowTrack better.
            </p>
            <p className="mt-2 text-sm text-slate-500">
              We usually respond within one business day.
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="mt-6 w-full rounded-xl border border-slate-700 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        ) : (

          /* ── Form screen ── */
          <div className="space-y-4 p-5">

            {/* Category cards */}
            <div className="grid grid-cols-3 gap-2">
              {ACTIONS.map((action) => {
                const isSelected = category === action.category;
                return (
                  <button
                    key={action.category}
                    type="button"
                    onClick={() => setCategory(action.category)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center text-xs transition-all ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/40"
                        : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-slate-200"
                    }`}
                  >
                    <span className="text-base">{action.emoji}</span>
                    <span className="leading-tight">{action.label}</span>
                    {isSelected && (
                      <span className="text-[9px] font-semibold uppercase tracking-wide text-emerald-400">
                        Selected
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">

              {/* Message textarea */}
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Message</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={"Describe your question or tell us what happened.\n\nThe more details you provide, the faster we can help."}
                  rows={5}
                  className="w-full resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                  required
                />
              </div>

              {error && <p className="text-xs text-red-400">{error}</p>}

              <button
                type="submit"
                disabled={sending || !category || !message.trim()}
                className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? "Sending..." : "Send Message"}
              </button>

              {/* Fallback contact */}
              <p className="text-center text-[11px] text-slate-600">
                support@appflowtrack.com
              </p>

            </form>
          </div>
        )}

      </div>
    </div>
  );
}
