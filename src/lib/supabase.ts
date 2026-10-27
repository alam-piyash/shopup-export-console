import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = !!url && !!key;

export const supabase = createClient(url || "https://placeholder.supabase.co", key || "placeholder", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});

/** Allowed Google Workspace domains, comma separated in VITE_ALLOWED_DOMAIN (for example "shopup.org,silq.net"). */
export const ALLOWED_DOMAINS = ((import.meta.env.VITE_ALLOWED_DOMAIN as string | undefined) || "shopup.org,silq.net")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);
/** Human readable list, for example "shopup.org or silq.net". */
export const ALLOWED_DOMAIN = ALLOWED_DOMAINS.join(" or ");
export const isAllowedEmail = (email?: string | null) => {
  const m = (email ?? "").trim().toLowerCase().match(/^[^@\s]+@([^@\s]+)$/);
  return !!m && ALLOWED_DOMAINS.includes(m[1]);
};
