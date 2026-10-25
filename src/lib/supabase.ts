import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = !!url && !!key;

export const supabase = createClient(url || "https://placeholder.supabase.co", key || "placeholder", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});

export const ALLOWED_DOMAIN = ((import.meta.env.VITE_ALLOWED_DOMAIN as string | undefined) || "shopup.org").toLowerCase();
export const isAllowedEmail = (email?: string | null) => !!email && email.toLowerCase().endsWith("@" + ALLOWED_DOMAIN);
