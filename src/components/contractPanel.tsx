import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, CheckCircle2, FilePlus2, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { rpc, uploadFile, useProfiles, useRefresh } from "@/lib/api";
import { errMsg, fmtDate } from "@/lib/format";
import { followupCheckpoints, useContractDocs } from "@/lib/masters";
import { scDataFrom, saveGeneratedVersion } from "@/lib/contractDocs";
import type { Amendment, Exp, Trade, TradeItem } from "@/lib/types";
import { Button, Chip, Confirm, Empty, Panel } from "./ui";
import { FileActions } from "./files";

/** Versions of the sales contract: generated drafts and uploaded copies, one of which is marked signed. */
export function ContractVersions({ trade, items, revs }: { trade: Trade; items: TradeItem[]; revs: Amendment[] }) {
  const { data: docs, isLoading } = useContractDocs(trade.id);
  const profiles = useProfiles().data ?? {};
  const refresh = useRefresh();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"gen" | "up" | null>(null);
  const [signing, setSigning] = useState<{ id: string; version: number } | null>(null);
  const next = (docs?.[0]?.version ?? 0) + 1;
  const signed = docs?.find((d) => d.status === "signed");

  async function generate() {
    setBusy("gen");
    try {
      await saveGeneratedVersion(trade.id, scDataFrom(trade, items, revs), next, revs.some((r) => r.status === "approved") ? `Includes amendment ${Math.max(...revs.filter((r) => r.status === "approved").map((r) => r.amendment_no))}` : "Generated from the trade");
      toast.success(`Version ${next} generated`);
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }
  async function upload(f?: File) {
    if (!f) return;
    setBusy("up");
    try {
      const up = await uploadFile(f, "trades/contracts");
      await rpc("add_contract_version", { p_trade: trade.id, p_file: up, p_source: "uploaded", p_note: null });
      toast.success(`Version ${next} uploaded. Mark it signed once it carries both signatures.`);
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <Panel
      title="Sales contract versions"
      right={
        <div className="flex flex-wrap gap-2">
          <input ref={ref} type="file" className="hidden" accept="application/pdf,image/*" onChange={(e) => upload(e.target.files?.[0])} />
          <Button size="sm" variant="outline" disabled={!!busy} onClick={generate}>{busy === "gen" ? <Loader2 className="animate-spin" /> : <FilePlus2 />} Generate PDF</Button>
          <Button size="sm" disabled={!!busy} onClick={() => ref.current?.click()}>{busy === "up" ? <Loader2 className="animate-spin" /> : <Upload />} Upload signed copy</Button>
        </div>
      }
    >
      {!signed && !isLoading && (
        <div className="mx-4 mt-4 rounded-lg border border-warn/40 bg-warn/[0.06] px-3.5 py-2.5 text-[0.8125rem]">
          No signed version yet. Download the generated PDF, get it signed, upload the signed copy and mark it signed. EXPs open after that.
        </div>
      )}
      {isLoading ? <div className="p-5 text-mut">Loading</div> : !docs?.length ? (
        <Empty title="No versions yet" body="Generate the PDF from the trade details, or upload a copy." />
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <table className="tbl min-w-[46rem]">
            <thead><tr>{["Version", "Source", "Status", "File", "Note", "Added", ""].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className="num font-medium">v{d.version}</td>
                  <td>{d.source === "generated" ? "Generated" : "Uploaded"}</td>
                  <td>{d.status === "signed" ? <Chip label="Signed" tone="ok" /> : <Chip label="Draft" tone="gray" />}</td>
                  <td className="max-w-[14rem] truncate" title={d.file_name}>{d.file_name}</td>
                  <td className="max-w-[14rem] truncate text-mut" title={d.note ?? ""}>{d.note}</td>
                  <td className="whitespace-nowrap text-mut">{fmtDate(d.created_at)} · {profiles[d.uploaded_by ?? ""] ?? ""}</td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <FileActions path={d.file_path} name={d.file_name} />
                      {d.source === "uploaded" && d.status === "draft" && (
                        <Button size="sm" variant="outline" onClick={() => setSigning({ id: d.id, version: d.version })}><BadgeCheck /> Mark signed</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Confirm
        open={!!signing}
        onOpenChange={(o) => !o && setSigning(null)}
        title={`Mark version ${signing?.version} as signed?`}
        body="Confirm this copy carries the signatures of both seller and buyer. EXPs can be added once a signed version exists."
        confirmLabel="Mark signed"
        onConfirm={async () => {
          try {
            await rpc("mark_contract_signed", { p_id: signing!.id });
            toast.success("Marked signed");
            refresh();
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </Panel>
  );
}

type FollowupRow = { trade_id: string; checkpoint: number; note: string | null; done_by: string | null; done_at: string };

export function useFollowups(tradeId: string) {
  return useQuery({
    queryKey: ["trade", tradeId, "followups"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trade_followups").select("*").eq("trade_id", tradeId);
      if (error) throw error;
      return (data ?? []) as FollowupRow[];
    },
  });
}

/** Status of each follow-up for a trade. Used by the trade page, dashboard and bell. */
export function followupState(t: Pick<Trade, "contract_date" | "shipment_deadline" | "expiry_date" | "followups_done" | "status">, today = new Date().toISOString().slice(0, 10)) {
  const cps = followupCheckpoints(t.contract_date, t.shipment_deadline || t.expiry_date);
  const done = t.followups_done ?? [];
  return cps.map((c) => ({ ...c, done: done.includes(c.checkpoint), due: !done.includes(c.checkpoint) && c.date <= today && t.status === "active" }));
}

/** Follow-ups at 25/50/75/100% of the shipment period, with the EXP value issued by each date. */
export function FollowupsPanel({ trade, exps }: { trade: Trade; exps: Exp[] }) {
  const { data: rows } = useFollowups(trade.id);
  const profiles = useProfiles().data ?? {};
  const refresh = useRefresh();
  const [busy, setBusy] = useState<number | null>(null);
  const state = followupState({ ...trade, followups_done: rows?.map((r) => r.checkpoint) ?? trade.followups_done });
  const contract = Number(trade.contract_amount) || 0;
  if (!state.length)
    return (
      <Panel title="Follow-ups">
        <Empty title="No shipment deadline" body="Follow-ups need a contract date and a shipment deadline (or expiry date). Set it with a contract revision." />
      </Panel>
    );
  const issuedBy = (date: string) =>
    exps.filter((e) => (e.shipment_date ?? e.created_at).slice(0, 10) <= date).reduce((s, e) => s + Number(e.amount || 0), 0);

  async function done(cp: number) {
    setBusy(cp);
    try {
      await rpc("mark_followup_done", { p_trade: trade.id, p_checkpoint: cp, p_note: null });
      toast.success("Follow-up marked done");
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Panel title="Follow-ups" right={<span className="text-[0.75rem] text-mut">Shipment period {state[0].days} days</span>}>
      <div className="scroll-thin overflow-x-auto">
        <table className="tbl min-w-[40rem]">
          <thead><tr>{["Checkpoint", "Date", "Target", "EXP issued by then", "Status", ""].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {state.map((c) => {
              const r = rows?.find((x) => x.checkpoint === c.checkpoint);
              const pctIssued = contract ? Math.round((issuedBy(c.date) / contract) * 100) : 0;
              return (
                <tr key={c.checkpoint}>
                  <td className="font-medium">Day {c.day}</td>
                  <td className="num">{fmtDate(c.date)}</td>
                  <td className="num">{c.checkpoint * 25}%</td>
                  <td className="num">{pctIssued}%</td>
                  <td>
                    {c.done ? <Chip label={`Done${r?.done_at ? ` ${fmtDate(r.done_at)}` : ""}${r?.done_by && profiles[r.done_by] ? ` by ${profiles[r.done_by]}` : ""}`} tone="ok" /> : c.due ? <Chip label="Due" tone="warn" /> : <Chip label="Upcoming" tone="gray" />}
                  </td>
                  <td>
                    {!c.done && trade.status === "active" && c.date <= new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10) && (
                      <Button size="sm" variant="outline" disabled={busy === c.checkpoint} onClick={() => done(c.checkpoint)}><CheckCircle2 /> Mark done</Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
