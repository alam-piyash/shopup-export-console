import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "./supabase";
import type { Activity, AppRole, Exp, Me, Trade, UploadedFile } from "./types";

/** Shipment documents every EXP needs (the sales contract is attached to the trade itself). */
export const EXP_DOCS = [
  "EXP Form",
  "Commercial Invoice",
  "Packing List",
  "Airway Bill",
  "Bill of Export",
  "VAT Document",
  "Phytosanitary Certificate",
  "Mushak 6.3",
] as const;
/** Swift Message is required when a collection is submitted; the others can be added later. */
export const COLLECTION_DOCS = ["Swift Message", "Swift Copy", "PRC", "TT Voucher"] as const;
export const COLLECTION_REQUIRED: readonly string[] = ["Swift Message"];
export const INCENTIVE_DOCS = [
  "Ka Form",
  "Association Certificate",
  "Forwarding Letter",
  "Overdue Certificate",
  "Undertakings",
] as const;

/** Call an RPC and throw on error. */
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export async function fetchMe(): Promise<Me | null> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;
  const [{ data: profile }, { data: role }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
  ]);
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email ?? "",
    full_name: profile?.full_name ?? meta.full_name ?? meta.name ?? null,
    avatar_url: profile?.avatar_url ?? meta.avatar_url ?? null,
    role: (role?.role as AppRole | undefined) ?? null,
  };
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 60_000 });
}
export function useIsAdmin() {
  return useMe().data?.role === "admin";
}

export function usePendingCounts(enabled = true) {
  return useQuery({
    queryKey: ["pending-counts"],
    enabled,
    refetchInterval: 60_000,
    queryFn: () => rpc<{ trades: number; collections: number; incentives: number; exp_amounts?: number }>("pending_counts"),
  });
}

export function useTrades() {
  return useQuery({
    queryKey: ["trades"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trade_overview").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Trade[];
    },
  });
}

/** Reads every row past the API's 1000-row page size. `make` builds the query for one page. */
export async function selectAll<T>(make: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }> }, page = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await make().range(from, from + page - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < page) return out;
  }
}

export function useAllExps() {
  return useQuery({
    queryKey: ["exps", "all"],
    queryFn: () => selectAll<Exp>(() => supabase.from("exp_overview").select("*").order("created_at", { ascending: false }).order("id")),
  });
}

export function useTrade(id: string) {
  return useQuery({
    queryKey: ["trade", id],
    queryFn: async () => {
      const [t, exps] = await Promise.all([
        supabase.from("trade_overview").select("*").eq("id", id).single(),
        selectAll<Exp>(() => supabase.from("exp_overview").select("*").eq("trade_id", id).order("created_at").order("id")),
      ]);
      if (t.error) throw t.error;
      return { trade: t.data as Trade, exps };
    },
  });
}

export function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name, email");
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((p) => [p.id, (p.full_name as string) || (p.email as string)])) as Record<string, string>;
    },
  });
}

export function useActivity(limit = 12, tradeId?: string) {
  return useQuery({
    queryKey: ["activity", tradeId ?? "all", limit],
    refetchInterval: 60_000,
    queryFn: async () => {
      let q = supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(limit);
      if (tradeId) q = q.eq("trade_id", tradeId);
      const { data, error } = await q;
      if (error) throw error;
      return data as Activity[];
    },
  });
}

/** Invalidate everything that a write could affect. */
export function useRefresh() {
  const qc = useQueryClient();
  return () => {
    ["trades", "trade", "exps", "exp", "collections", "incentives", "pending-counts", "activity", "attachments", "demo-count", "contract_documents", "exp_amount_changes", "documents"].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k] }),
    );
  };
}

export function useTradeActions() {
  const refresh = useRefresh();
  const run = async (fn: string, args: Record<string, unknown>, msg: string) => {
    await rpc(fn, args);
    toast.success(msg);
    refresh();
  };
  return {
    approveTrade: (id: string) => run("approve_trade", { p_id: id }, "Trade approved"),
    rejectTrade: (id: string, reason: string) => run("reject_trade", { p_id: id, p_reason: reason }, "Trade rejected"),
    closeTrade: (id: string) => run("close_trade", { p_id: id }, "Trade closed"),
    approveAmendment: (id: string) => run("approve_amendment", { p_id: id }, "Amendment approved, new values applied"),
    rejectAmendment: (id: string, reason: string) => run("reject_amendment", { p_id: id, p_reason: reason }, "Amendment rejected"),
    withdrawAmendment: (id: string) => run("withdraw_amendment", { p_id: id }, "Amendment withdrawn"),
  };
}

export async function uploadFile(file: File, folder: string): Promise<UploadedFile> {
  if (file.size > 25 * 1024 * 1024) throw new Error("File is larger than 25 MB");
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120);
  const path = `${folder}/${crypto.randomUUID()}/${safe}`;
  const { error } = await supabase.storage.from("documents").upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw error;
  return { path, name: file.name, size: file.size };
}

export async function openFile(path: string) {
  const win = window.open("", "_blank");
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 120);
  if (error || !data) {
    win?.close();
    throw error ?? new Error("Could not open file");
  }
  if (win) win.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}

export async function downloadFile(path: string, name: string) {
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 120, { download: name });
  if (error || !data) throw error ?? new Error("Could not download file");
  const a = document.createElement("a");
  a.href = data.signedUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const ACTION_LABEL: Record<string, string> = {
  trade_created: "submitted trade",
  trade_approved: "approved trade",
  trade_rejected: "rejected trade",
  trade_closed: "closed trade",
  exp_created: "added EXP",
  exp_updated: "updated EXP",
  exp_duplicated: "made Regular EXP",
  exp_closed: "EXP closed",
  document_uploaded: "uploaded document",
  document_final: "marked document final",
  revision_requested: "requested amendment",
  revision_approved: "approved amendment",
  revision_rejected: "rejected amendment",
  revision_withdrawn: "withdrew amendment",
  collection_created: "submitted collection",
  collection_approved: "approved collection",
  collection_rejected: "rejected collection",
  incentive_created: "submitted incentive",
  incentive_approved: "approved incentive",
  incentive_rejected: "rejected incentive",
  role_changed: "changed a role",
  access_removed: "removed access",
  contract_generated: "generated sales contract",
  contract_uploaded: "uploaded sales contract",
  contract_signed: "marked sales contract signed",
  followup_done: "completed follow-up",
  exp_amount_requested: "requested EXP amount change",
  exp_amount_approved: "approved EXP amount change",
  exp_amount_rejected: "rejected EXP amount change",
  exp_amount_withdrawn: "withdrew EXP amount change",
};
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a.replace(/_/g, " ");
export const actionTone = (a: string): "ok" | "bad" | "warn" | "info" | "gray" =>
  /approved|closed|final|signed|done/.test(a) ? "ok" : /rejected|removed/.test(a) ? "bad" : /requested|created|submitted/.test(a) ? "warn" : /withdrawn/.test(a) ? "gray" : "info";

export function useCollections() {
  return useQuery({
    queryKey: ["collections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collections")
        .select("*, trades(code, importer_name), collection_exps(amount, exps(code))")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as import("./types").Collection[];
    },
  });
}

export function useIncentives() {
  return useQuery({
    queryKey: ["incentives"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("incentives")
        .select("*, incentive_exps(amount, exps(code, trades(code, importer_name)))")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as import("./types").Incentive[];
    },
  });
}

export function useDecide(kind: "collection" | "incentive") {
  const refresh = useRefresh();
  return async (id: string, approve: boolean, reason?: string) => {
    await rpc(kind === "collection" ? "decide_collection" : "decide_incentive", { p_id: id, p_approve: approve, p_reason: reason ?? "" });
    toast.success(`${kind === "collection" ? "Collection" : "Incentive"} ${approve ? "approved" : "rejected"}`);
    refresh();
  };
}
