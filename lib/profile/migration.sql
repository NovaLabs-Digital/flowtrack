-- Migration: per-user timezone preference for Bill Guardian reminder scheduling
-- Run this in the Supabase SQL Editor.
--
-- Stores a valid IANA timezone name (e.g. "America/New_York", "America/Chicago",
-- "America/Denver", "America/Los_Angeles", "Europe/London", "America/Sao_Paulo").
-- Nullable on purpose: users without a stored value fall back to
-- lib/profile/timezone.ts's DEFAULT_TIME_ZONE at the application layer as a
-- migration-era fallback only, not as reminder logic baked into the schema.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS timezone TEXT;
