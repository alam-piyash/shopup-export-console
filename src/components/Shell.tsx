import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import * as P from "@radix-ui/react-popover";
import * as D from "@radix-ui/react-dialog";
import { ArrowLeftRight, Bell, Coins, FileStack, LayoutDashboard, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Search, ShieldCheck, Sun, Wallet, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { actionLabel, actionTone, useActivity, useAllExps, useMe, usePendingCounts, useTrades } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { Me } from "@/lib/types";
import { Avatar, cn } from "./ui";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, key: null },
  { to: "/trades", label: "Trades", icon: ArrowLeftRight, key: "trades" },
  { to: "/exps", label: "EXPs", icon: FileStack, key: null },
  { to: "/collections", label: "Collections", icon: Wallet, key: "collections" },
  { to: "/incentives", label: "Incentives", icon: Coins, key: "incentives" },
] as const;

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("ed-theme", next ? "dark" : "light"); } catch { /* ignore */ }
    setDark(next);
  };
  return { dark, toggle };
}

function useSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };
}

function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <Link to="/" className={cn("flex items-center gap-2.5", collapsed ? "justify-center" : "px-1")} title="ShopUp Export Console">
      <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-fg text-[0.9375rem] font-bold text-bg">S</span>
      {!collapsed && (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[0.875rem] font-semibold tracking-tight">Export Console</span>
          <span className="text-[0.75rem] text-mut">ShopUp</span>
        </span>
      )}
    </Link>
  );
}

function NavList({ me, onNavigate, collapsed }: { me: Me | null | undefined; onNavigate?: () => void; collapsed?: boolean }) {
  const isAdmin = me?.role === "admin";
  const { data: counts } = usePendingCounts(isAdmin);
  const item = (to: string, label: string, Icon: typeof Bell, badge?: number, end?: boolean) => (
    <NavLink
      key={to}
      to={to}
      end={end}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          "relative flex items-center rounded-lg text-[0.8438rem] transition",
          collapsed ? "mx-auto size-10 justify-center" : "h-9 gap-2.5 px-2.5",
          isActive ? "bg-raised font-medium text-fg" : "text-fg/75 hover:bg-raised/70 hover:text-fg",
        )
      }
    >
      <Icon className="size-[1.0625rem] shrink-0" strokeWidth={1.8} />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {badge ? (
        collapsed
          ? <span className="absolute right-2 top-2 size-1.5 rounded-full bg-fg" />
          : <span className="num rounded-md bg-fg px-1.5 text-[0.6875rem] font-semibold leading-[1.125rem] text-bg">{badge}</span>
      ) : null}
    </NavLink>
  );
  return (
    <nav className="flex flex-col gap-0.5">
      {!collapsed && <div className="px-2.5 pb-1.5 text-[0.6875rem] font-medium text-mut">Workspace</div>}
      {NAV.map((n) => item(n.to, n.label, n.icon, isAdmin && n.key ? counts?.[n.key] : undefined, n.to === "/"))}
      {isAdmin && (
        <>
          {collapsed ? <div className="mx-auto my-2 h-px w-6 bg-line" /> : <div className="px-2.5 pb-1.5 pt-5 text-[0.6875rem] font-medium text-mut">Admin</div>}
          {item("/access", "Access control", ShieldCheck)}
        </>
      )}
    </nav>
  );
}

function UserCard({ me, collapsed }: { me: Me | null | undefined; collapsed?: boolean }) {
  const signOut = useSignOut();
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2">
        <Avatar name={me?.full_name || me?.email} src={me?.avatar_url} size={30} />
        <button className="btn btn-ghost btn-icon h-9 w-9" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut /></button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 border-t border-line px-1 pt-3">
      <Avatar name={me?.full_name || me?.email} src={me?.avatar_url} size={30} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.8125rem] font-medium">{me?.full_name || me?.email}</div>
        <div className="text-[0.75rem] text-mut">{me?.role === "admin" ? "Admin" : me?.role === "operation" ? "Operation" : "No role"}</div>
      </div>
      <button className="btn btn-ghost btn-icon h-8 w-8" onClick={signOut} aria-label="Sign out" title="Sign out">
        <LogOut />
      </button>
    </div>
  );
}

function Notifications({ me }: { me: Me | null | undefined }) {
  const isAdmin = me?.role === "admin";
  const { data: counts } = usePendingCounts(isAdmin);
  const { data: recent } = useActivity(10);
  const total = isAdmin ? (counts?.trades ?? 0) + (counts?.collections ?? 0) + (counts?.incentives ?? 0) : 0;
  return (
    <P.Root>
      <P.Trigger asChild>
        <button className="btn btn-ghost btn-icon relative" aria-label="Notifications">
          <Bell />
          {total > 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-warn ring-2 ring-bg" />}
        </button>
      </P.Trigger>
      <P.Portal>
        <P.Content align="end" sideOffset={8} className="z-50 w-[21.25rem] max-w-[calc(100vw-24px)] animate-in rounded-xl border border-line bg-surface shadow-2xl">
          {isAdmin && (
            <div className="border-b border-line p-4">
              <div className="lbl mb-2">Awaiting your approval</div>
              {total === 0 ? (
                <p className="text-[0.8125rem] text-mut">Nothing pending. Nice.</p>
              ) : (
                <div className="flex flex-col gap-1.5 text-[0.8438rem]">
                  {counts?.trades ? <Link to="/trades?status=awaiting" className="flex justify-between hover:underline"><span>Trades and amendments</span><span className="num">{counts.trades}</span></Link> : null}
                  {counts?.collections ? <Link to="/collections?status=pending_approval" className="flex justify-between hover:underline"><span>Collections</span><span className="num">{counts.collections}</span></Link> : null}
                  {counts?.incentives ? <Link to="/incentives?status=pending_approval" className="flex justify-between hover:underline"><span>Incentives</span><span className="num">{counts.incentives}</span></Link> : null}
                </div>
              )}
            </div>
          )}
          <div className="p-4">
            <div className="lbl mb-3">Recent activity</div>
            {!recent?.length ? (
              <p className="text-[0.8125rem] text-mut">No activity yet.</p>
            ) : (
              <ul className="scroll-thin flex max-h-72 flex-col gap-3 overflow-y-auto">
                {recent.map((r) => (
                  <li key={r.id} className="flex gap-2.5 text-[0.8125rem]">
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", { ok: "bg-ok", bad: "bg-bad", warn: "bg-warn", info: "bg-info", gray: "bg-mut" }[actionTone(r.action)])} />
                    <div className="min-w-0">
                      <span className="text-mut">{actionLabel(r.action)}</span>{" "}
                      {r.details?.code ? <span className="num">{String(r.details.code)}</span> : null}
                      {r.is_demo && <span className="ml-1.5 text-[0.6875rem] text-mut">(demo)</span>}
                      <div className="text-[0.6875rem] text-mut">{timeAgo(r.created_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const { data: trades } = useTrades();
  const { data: exps } = useAllExps();
  useEffect(() => { if (!open) setQ(""); }, [open]);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const pages = [
      { label: "Create trade", sub: "New sales contract", to: "/trades/new" },
      { label: "New collection", sub: "Record money received", to: "/collections/new" },
      { label: "New incentive", sub: "Claim from collected EXPs", to: "/incentives/new" },
      ...NAV.map((n) => ({ label: n.label, sub: "Go to page", to: n.to })),
    ];
    const t = (trades ?? []).map((x) => ({ label: `${x.code} · ${x.importer_name}`, sub: `SC ${x.sales_contract_no} · ${x.products}`, to: `/trades/${x.id}` }));
    const e = (exps ?? []).map((x) => ({ label: `${x.code}`, sub: `${x.trade_code} · ${x.importer_name} · Shipment ${x.shipment_id || "not set"}`, to: `/exps/${x.id}` }));
    const all = [...pages, ...t, ...e];
    if (!s) return all.slice(0, 9);
    return all.filter((r) => (r.label + " " + r.sub).toLowerCase().includes(s)).slice(0, 12);
  }, [q, trades, exps]);
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [q]);
  const go = (to: string) => { onOpenChange(false); navigate(to); };
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[0.125rem]" />
        <D.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 animate-in overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl outline-none">
          <D.Title className="sr-only">Search</D.Title>
          <D.Description className="sr-only">Search trades, EXPs and pages</D.Description>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="size-4 text-mut" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
                if (e.key === "Enter" && results[idx]) go(results[idx].to);
              }}
              placeholder="Search trades, EXPs, buyers, SC numbers"
              className="h-12 flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-mut"
            />
            <kbd className="num rounded border border-line px-1.5 py-0.5 text-[0.6875rem] text-mut">Esc</kbd>
          </div>
          <ul className="scroll-thin max-h-[50vh] overflow-y-auto p-2">
            {results.length === 0 && <li className="px-3 py-6 text-center text-mut">No results</li>}
            {results.map((r, i) => (
              <li key={r.to + r.label}>
                <button
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => go(r.to)}
                  className={cn("flex w-full flex-col rounded-lg px-3 py-2 text-left", i === idx ? "bg-raised" : "")}
                >
                  <span className="text-[0.875rem] font-medium">{r.label}</span>
                  <span className="truncate text-[0.75rem] text-mut">{r.sub}</span>
                </button>
              </li>
            ))}
          </ul>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

const CRUMBS: Record<string, string> = {
  trades: "Trades",
  exps: "EXPs",
  collections: "Collections",
  incentives: "Incentives",
  access: "Access control",
  new: "New",
  revise: "Amendment",
};

function Breadcrumb() {
  const { pathname } = useLocation();
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return <span className="font-medium">Dashboard</span>;
  return (
    <div className="flex min-w-0 items-center gap-2 text-[0.8438rem]">
      {parts.map((p, i) => {
        const href = "/" + parts.slice(0, i + 1).join("/");
        const last = i === parts.length - 1;
        const label = CRUMBS[p] ?? "Detail";
        return (
          <span key={href} className="flex min-w-0 items-center gap-2">
            {i > 0 && <span className="text-mut/60">/</span>}
            {last ? <span className="truncate font-medium">{label}</span> : <Link to={href} className="truncate text-mut hover:text-fg">{label}</Link>}
          </span>
        );
      })}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [cmd, setCmd] = useState(false);
  const { dark, toggle } = useTheme();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("ed-sidebar") === "collapsed"; } catch { return false; } });
  const toggleSidebar = () => setCollapsed((c) => { const n = !c; try { localStorage.setItem("ed-sidebar", n ? "collapsed" : "open"); } catch { /* ignore */ } return n; });
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmd((c) => !c); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  const sidebar = (onNavigate?: () => void, small = false) => (
    <>
      <div className={cn("flex items-center gap-2 border-b border-line pb-4", small ? "flex-col" : "")}>
        <div className="min-w-0 flex-1"><Brand collapsed={small} /></div>
        {!onNavigate && (
          <button className="btn btn-ghost btn-icon h-8 w-8 text-mut" onClick={toggleSidebar} aria-label={small ? "Expand sidebar" : "Collapse sidebar"} title={small ? "Expand sidebar" : "Collapse sidebar"}>
            {small ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        )}
      </div>
      <NavList me={me} onNavigate={onNavigate} collapsed={small} />
      <div className="mt-auto flex flex-col gap-2">
        <UserCard me={me} collapsed={small} />
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen">
      <aside className={cn("sticky top-0 hidden h-screen shrink-0 flex-col gap-5 border-r border-line bg-surface px-3 py-4 transition-[width] duration-200 lg:flex", collapsed ? "w-[4.25rem]" : "w-[15rem]")}>{sidebar(undefined, collapsed)}</aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-bg/85 px-3 backdrop-blur-md sm:px-6">
          <button className="btn btn-ghost btn-icon lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu /></button>
          <div className="min-w-0 flex-1"><Breadcrumb /></div>
          <button
            onClick={() => setCmd(true)}
            className="hidden h-8 w-60 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[0.8125rem] text-mut transition hover:border-mut/50 md:flex"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">Search</span>
            <kbd className="num rounded border border-line px-1.5 text-[0.6875rem]">Ctrl K</kbd>
          </button>
          <button className="btn btn-ghost btn-icon md:hidden" onClick={() => setCmd(true)} aria-label="Search"><Search /></button>
          <Notifications me={me} />
          <button className="btn btn-ghost btn-icon" onClick={toggle} aria-label="Toggle theme">{dark ? <Sun /> : <Moon />}</button>
        </header>
        <main className="mx-auto flex w-full max-w-[90rem] min-w-0 flex-1 flex-col gap-5 px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-10">{children}</main>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[17rem] max-w-[85%] animate-in flex-col gap-5 overflow-y-auto border-r border-line bg-surface px-3 py-4">
            <button className="btn btn-ghost btn-icon absolute right-2 top-4" onClick={() => setOpen(false)} aria-label="Close menu"><X /></button>
            {sidebar(() => setOpen(false))}
          </div>
        </div>
      )}
      <CommandPalette open={cmd} onOpenChange={setCmd} />
    </div>
  );
}
