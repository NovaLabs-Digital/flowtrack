-- FlowTrack: Payment source display metadata on debts (non-destructive)
-- Run this independently in the Supabase SQL Editor, after migration.sql
-- has already been applied. Safe to run more than once.
--
-- Lets a bill show which account/card it's paid from in the UI and in
-- reminder emails, e.g. "Chase Checking •••• 1234". This is DISPLAY-ONLY
-- metadata — never a real account, routing, debit, or credit card number.
-- All three columns are nullable so every existing row keeps working
-- unchanged, with no backfill required.

ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS payment_source_type TEXT;
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS payment_source_name TEXT;
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS payment_source_last4 TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'debts_payment_source_type_check'
  ) THEN
    ALTER TABLE public.debts
      ADD CONSTRAINT debts_payment_source_type_check
      CHECK (payment_source_type IS NULL OR payment_source_type IN ('bank_account', 'credit_card', 'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'debts_payment_source_last4_format_check'
  ) THEN
    -- Belt-and-suspenders: enforced in the app layer too, but a DB-level
    -- constraint guarantees no more than 4 digits can ever be stored here,
    -- regardless of how a row is written.
    ALTER TABLE public.debts
      ADD CONSTRAINT debts_payment_source_last4_format_check
      CHECK (payment_source_last4 IS NULL OR payment_source_last4 ~ '^[0-9]{4}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'debts_payment_source_name_length_check'
  ) THEN
    ALTER TABLE public.debts
      ADD CONSTRAINT debts_payment_source_name_length_check
      CHECK (payment_source_name IS NULL OR char_length(payment_source_name) <= 80);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'debts_payment_source_name_digit_check'
  ) THEN
    -- A full account/routing/card number pasted into the free-text name
    -- field would carry far more than 4 digits once every non-numeric
    -- character (spaces, dashes, etc.) is stripped away. This blocks that
    -- at the database level even if the app-layer check is bypassed.
    ALTER TABLE public.debts
      ADD CONSTRAINT debts_payment_source_name_digit_check
      CHECK (
        payment_source_name IS NULL
        OR char_length(regexp_replace(payment_source_name, '\D', '', 'g')) <= 4
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'debts_payment_source_last4_requires_name_check'
  ) THEN
    -- A last-four value with no name to attach it to is orphaned, ambiguous
    -- display metadata — require a non-empty name whenever last4 is set.
    ALTER TABLE public.debts
      ADD CONSTRAINT debts_payment_source_last4_requires_name_check
      CHECK (
        payment_source_last4 IS NULL
        OR (payment_source_name IS NOT NULL AND btrim(payment_source_name) <> '')
      );
  END IF;
END $$;
