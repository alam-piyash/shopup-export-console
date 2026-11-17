"use client";
import Login from "@/views/Login";
import Setup from "@/views/Setup";
import { supabaseConfigured } from "@/lib/supabase";

export default function Page() {
  return supabaseConfigured ? <Login /> : <Setup />;
}
