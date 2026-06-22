// lib/supabaseAdmin.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL is required");
}

// Service role key MUST come from the server env (Vercel only, never public)
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceRoleKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
}

export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceRoleKey as string
);
