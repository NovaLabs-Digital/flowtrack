-- FlowTrack: Bill Guardian — Add last_payment_date to debts table
-- Run this in the Supabase SQL Editor

ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS last_payment_date DATE;
