-- FlowTrack: Debts table for Debt Recovery Center
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.debts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',
  balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  apr NUMERIC(6, 3) NOT NULL DEFAULT 0,
  minimum_payment NUMERIC(10, 2) NOT NULL DEFAULT 0,
  due_day INTEGER NOT NULL DEFAULT 1,
  payment_plan TEXT NOT NULL DEFAULT 'minimum',
  custom_payment NUMERIC(10, 2),
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT,
  reminder_enabled BOOLEAN NOT NULL DEFAULT false,
  reminder_method TEXT,
  reminder_offset INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast user-scoped queries
CREATE INDEX IF NOT EXISTS idx_debts_user_id ON public.debts(user_id);

-- Row Level Security
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own debts"
  ON public.debts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own debts"
  ON public.debts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own debts"
  ON public.debts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own debts"
  ON public.debts FOR DELETE
  USING (auth.uid() = user_id);

-- Migration from v1 (if table already exists with old column names):
-- ALTER TABLE public.debts RENAME COLUMN suggested_payment TO custom_payment;
-- ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS payment_plan TEXT NOT NULL DEFAULT 'minimum';

-- Migration: Bill Guardian reminder duplicate-prevention tracking
-- Records the last time an automated reminder email was sent for a debt,
-- so the cron job never sends the same reminder twice in one billing cycle.
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ;
