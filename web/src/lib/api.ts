import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "./supabase";
import { del, get, patch, post, put, qs } from "./http";
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
export const COLLECTION_DOCS = ["Swift Message", "Swift Copy", "PRC", "TT Voucher", "PRS"] as const;
export const COLLECTION_REQUIRED: readonly string[] = ["Swift Message"];
export const INCENTIVE_DOCS = [
  "Ka Form",
  "Association Certificate",
  "Forwarding Letter",
  "Overdue Certificate",
  "Undertakings",
] as const;

export { del, get, patch, post, put, qs };

export async function fetchMe(): Promise<Me | null> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  const me = await get<Me & { role: AppRole | null }>("/me");
  return { ...me, email: me.email ?? "", role: me.role ?? null };
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 60_000 });
}
export function useIsAdmin() {
  return useMe().data?.role === "admin";
}
/** Admin or Finance: may approve collections, settlements and incentives. */
export function useIsApprover() {
  const r = useMe().data?.role;
  return r === "admin" || r === "finance";
}
/** Finance sees only collections and incentives and cannot create anything. */
export function useIsFinance() {
  return useMe().data?.role === "finance";
}
export const roleLabel = (r?: string | null) => (r === "admin" ? "Admin" : r === "operation" ? "Operation" : r === "finance" ? "Finance" : "No role");
export const kindLabel = (k?: string | null) => (k === "prepaid" ? "Prepaid" : k === "settlement" ? "Settlement" : "EXP collection");

export function usePendingCounts(enabled = true) {
  return useQuery({
    queryKey: ["pending-counts"],
    enabled,
    refetchInterval: 60_000,
    queryFn: () => get<{ trades: number; collections: number; incentives: number; exp_amounts?: number }>("/pending-counts"),
  });
}

export function useTrades() {
  return useQuery({
    queryKey: ["trades"],
    queryFn: () => get<Trade[]>("/trades"),
  });
}

export function useAllExps() {
  return useQuery({
    queryKey: ["exps", "all"],
    queryFn: () => get<Exp[]>("/exps"),
  });
}

export function useTrade(id: string) {
  return useQuery({
    queryKey: ["trade", id],
    queryFn: () => get<{ trade: Trade; exps: Exp[] }>(`/trades/${id}`),
  });
}

export function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const data = await get<{ id: string; full_name: string | null; email: string | null }[]>("/profiles");
      return Object.fromEntries(data.map((p) => [p.id, p.full_name || p.email || ""])) as Record<string, string>;
    },
  });
}

export function useActivity(limit = 12, tradeId?: string) {
  return useQuery({
    queryKey: ["activity", tradeId ?? "all", limit],
    refetchInterval: 60_000,
    queryFn: () => get<Activity[]>(`/activity${qs({ limit, trade_id: tradeId })}`),
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
  const run = async (path: string, body: Record<string, unknown>, msg: string) => {
    await post(path, body);
    toast.success(msg);
    refresh();
  };
  return {
    approveTrade: (id: string) => run(`/trades/${id}/approve`, {}, "Trade approved"),
    rejectTrade: (id: string, reason: string) => run(`/trades/${id}/reject`, { reason }, "Trade rejected"),
    closeTrade: (id: string) => run(`/trades/${id}/close`, {}, "Trade closed"),
    approveAmendment: (id: string) => run(`/amendments/${id}/approve`, {}, "Amendment approved, new values applied"),
    rejectAmendment: (id: string, reason: string) => run(`/amendments/${id}/reject`, { reason }, "Amendment rejected"),
    withdrawAmendment: (id: string) => run(`/amendments/${id}/withdraw`, {}, "Amendment withdrawn"),
  };
}

export async function uploadFile(file: File, folder: string): Promise<UploadedFile> {
  if (file.size > 25 * 1024 * 1024) throw new Error("File is larger than 25 MB");
  const { path, upload_url } = await post<{ path: string; upload_url: string }>("/files/upload-url", { folder, name: file.name, size: file.size });
  const res = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" },
    body: file,
  });
  if (!res.ok) throw new Error("Upload failed. Please try again.");
  return { path, name: file.name, size: file.size };
}

export async function openFile(path: string) {
  const win = window.open("", "_blank");
  try {
    const { url } = await post<{ url: string }>("/files/signed-url", { path });
    if (win) win.location.href = url;
    else window.location.href = url;
  } catch (e) {
    win?.close();
    throw e;
  }
}

export async function downloadFile(path: string, name: string) {
  const { url } = await post<{ url: string }>("/files/signed-url", { path, download: name });
  const a = document.createElement("a");
  a.href = url;
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
    queryFn: () => get<import("./types").Collection[]>("/collections"),
  });
}

export function useIncentives() {
  return useQuery({
    queryKey: ["incentives"],
    queryFn: () => get<import("./types").Incentive[]>("/incentives"),
  });
}

export function useDecide(kind: "collection" | "incentive") {
  const refresh = useRefresh();
  return async (id: string, approve: boolean, reason?: string) => {
    await post(`/${kind === "collection" ? "collections" : "incentives"}/${id}/decide`, { approve, reason: reason ?? "" });
    toast.success(`${kind === "collection" ? "Collection" : "Incentive"} ${approve ? "approved" : "rejected"}`);
    refresh();
  };
}

/** Gets a short-lived link to a stored file and downloads its bytes (for reading PDFs and logos in the browser). */
export async function fetchFileBlob(path: string): Promise<Blob> {
  const { url } = await post<{ url: string }>("/files/signed-url", { path });
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not read file");
  return res.blob();
}
