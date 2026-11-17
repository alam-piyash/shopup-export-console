import { createClient } from "@supabase/supabase-js";

// Supabase is used only for Google sign-in. All data goes through the Go API (/api).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = !!url && !!key;

export const supabase = createClient(url || "https://placeholder.supabase.co", key || "placeholder", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});

/** Allowed Google Workspace domains, comma separated in NEXT_PUBLIC_ALLOWED_DOMAIN (for example "shopup.org,silq.net"). */
export const ALLOWED_DOMAINS = (process.env.NEXT_PUBLIC_ALLOWED_DOMAIN || "shopup.org,silq.net")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);
/** Human readable list, for example "shopup.org or silq.net". */
export const ALLOWED_DOMAIN = ALLOWED_DOMAINS.join(" or ");
export const isAllowedEmail = (email?: string | null) => {
  const m = (email ?? "").trim().toLowerCase().match(/^[^@\s]+@([^@\s]+)$/);
  return !!m && ALLOWED_DOMAINS.includes(m[1]);
};
