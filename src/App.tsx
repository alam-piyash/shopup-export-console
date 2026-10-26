import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { Loader2, ShieldAlert } from "lucide-react";
import { isAllowedEmail, supabase, supabaseConfigured } from "@/lib/supabase";
import { useMe } from "@/lib/api";
import { AppShell } from "@/components/Shell";
import { Button } from "@/components/ui";
import Login from "@/pages/Login";
import Setup from "@/pages/Setup";

const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Trades = lazy(() => import("@/pages/Trades"));
const TradeNew = lazy(() => import("@/pages/TradeNew"));
const TradeDetail = lazy(() => import("@/pages/TradeDetail"));
const TradeRevise = lazy(() => import("@/pages/TradeRevise"));
const Exps = lazy(() => import("@/pages/Exps"));
const ExpDetail = lazy(() => import("@/pages/ExpDetail"));
const Collections = lazy(() => import("@/pages/Collections"));
const CollectionNew = lazy(() => import("@/pages/CollectionNew"));
const Incentives = lazy(() => import("@/pages/Incentives"));
const IncentiveNew = lazy(() => import("@/pages/IncentiveNew"));
const CollectionDetail = lazy(() => import("@/pages/CollectionDetail"));
const IncentiveDetail = lazy(() => import("@/pages/IncentiveDetail"));
const Access = lazy(() => import("@/pages/Access"));

function FullLoader() {
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

function ProtectedLayout() {
  const session = useSession();
  const location = useLocation();
  const { data: me, isLoading } = useMe();
  if (session === undefined) return <FullLoader />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!isAllowedEmail(session.user.email)) {
    supabase.auth.signOut();
    return <Navigate to="/login?error=domain" replace />;
  }
  if (isLoading) return <FullLoader />;
  if (!me?.role) return <NoAccess reason="Your account is signed in but has no role. Ask an admin to grant you access in Access control." />;
  return (
    <AppShell>
      <Suspense fallback={<div className="grid h-64 place-items-center"><Loader2 className="size-5 animate-spin text-mut" /></div>}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  if (me?.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  if (!supabaseConfigured) return <Setup />;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedLayout />}>
      <Route path="/" element={<Dashboard />} />
      <Route path="/trades" element={<Trades />} />
      <Route path="/trades/new" element={<TradeNew />} />
      <Route path="/trades/:tradeId" element={<TradeDetail />} />
      <Route path="/trades/:tradeId/revise" element={<TradeRevise />} />
      <Route path="/exps" element={<Exps />} />
      <Route path="/exps/:expId" element={<ExpDetail />} />
      <Route path="/collections" element={<Collections />} />
      <Route path="/collections/new" element={<CollectionNew />} />
      <Route path="/collections/:collectionId" element={<CollectionDetail />} />
      <Route path="/incentives" element={<Incentives />} />
      <Route path="/incentives/new" element={<IncentiveNew />} />
      <Route path="/incentives/:incentiveId" element={<IncentiveDetail />} />
      <Route path="/access" element={<AdminOnly><Access /></AdminOnly>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
