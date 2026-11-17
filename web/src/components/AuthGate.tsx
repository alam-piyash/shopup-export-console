"use client";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { Loader2, ShieldAlert } from "lucide-react";
import { isAllowedEmail, supabase, supabaseConfigured } from "@/lib/supabase";
import { useMe } from "@/lib/api";
import { Navigate, useLocation } from "@/lib/router";
import { AppShell } from "@/components/Shell";
import { Button } from "@/components/ui";
import Setup from "@/views/Setup";

export function FullLoader() {
  return (
    <div className="grid min-h-screen place-items-center">
      <Loader2 className="size-6 animate-spin text-mut" />
    </div>
  );
}

function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const qc = useQueryClient();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      qc.invalidateQueries({ queryKey: ["me"] });
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);
  return session;
}

function NoAccess({ reason }: { reason: string }) {
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="card max-w-md p-7 text-center">
        <ShieldAlert className="mx-auto mb-3 size-8 text-warn" />
        <h2 className="text-[1.125rem] font-semibold">No access yet</h2>
        <p className="mt-2 text-mut">{reason}</p>
        <Button variant="outline" className="mt-5" onClick={() => supabase.auth.signOut()}>Sign out</Button>
      </div>
    </div>
  );
}

/** Signed-in area: checks the session, the email domain and the user's role, then shows the app shell. */
export function ProtectedLayout({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  const { data: me, isLoading } = useMe();
  if (!supabaseConfigured) return <Setup />;
  if (session === undefined) return <FullLoader />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!isAllowedEmail(session.user.email)) {
    supabase.auth.signOut();
    return <Navigate to="/login?error=domain" replace />;
  }
  if (isLoading) return <FullLoader />;
  if (!me?.role) return <NoAccess reason="Your account is signed in but has no role. Ask an admin to grant you access in Access control." />;
  // Finance: collections and incentives only, viewing and approving (no create pages)
  if (me.role === "finance" && !/^\/(collections|incentives)(\/(?!new$)[^/]+)?\/?$/.test(location.pathname)) return <Navigate to="/collections" replace />;
  return (
    <AppShell>
      <Suspense fallback={<div className="grid h-64 place-items-center"><Loader2 className="size-5 animate-spin text-mut" /></div>}>{children}</Suspense>
    </AppShell>
  );
}

export function AdminOnly({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  if (me?.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}
