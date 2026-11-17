import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, FilePlus2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { get, post, useProfiles, useRefresh } from "@/lib/api";
import { errMsg, fmtDate } from "@/lib/format";
import { followupCheckpoints, useCompanyProfiles, useContractDocs } from "@/lib/masters";
import { scDataFrom, saveGeneratedVersion } from "@/lib/contractDocs";
import type { Amendment, Exp, Trade, TradeItem } from "@/lib/types";
import { Button, Chip, Empty, Panel } from "./ui";
import { DocPanel, type DocModel } from "./docs";

/** The sales contract as a document card: generated drafts and uploaded copies, one marked signed. */
export function ContractVersions({ trade, items, revs }: { trade: Trade; items: TradeItem[]; revs: Amendment[] }) {
  const { data: docs, isLoading } = useContractDocs(trade.id);
  const { data: companyProfiles } = useCompanyProfiles();
  const profile = companyProfiles?.find((p) => p.id === trade.company_profile_id) ?? companyProfiles?.find((p) => p.is_default);
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);
  const list = docs ?? [];
  const next = (list[0]?.version ?? 0) + 1;
  const signed = list.find((d) => d.status === "signed");
  const latest = list[0];
  const approved = revs.filter((r) => r.status === "approved");

  async function generate() {
    setBusy(true);
    try {
      await saveGeneratedVersion(trade.id, scDataFrom(trade, items, revs), next, approved.length ? `Includes amendment ${Math.max(...approved.map((r) => r.amendment_no))}` : "Generated from the trade", profile?.logo_path);
      toast.success(`Version ${next} generated`);
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const doc: DocModel = {
    key: "contract",
    name: `Sales contract ${trade.sales_contract_no}`,
    tag: approved.length ? `Amendment ${Math.max(...approved.map((r) => r.amendment_no))}` : null,
    status: signed ? "final" : list.length ? "uploaded" : "missing",
    finalizedAt: signed?.signed_at,
    finalWord: "Signed",
    finalVerb: "Mark signed",
    addAfterFinal: true,
    finalBlocked: latest && latest.source === "generated" ? "Generated drafts cannot be marked signed. Upload the signed copy as a new version, then mark it signed." : null,
    folder: "trades/contracts",
    versions: list.map((d) => ({
      id: d.id,
      version: d.version,
      stage: d.stage ?? (d.source === "generated" ? "Generated draft" : "Uploaded copy"),
      submitted_on: d.submitted_on ?? null,
      note: d.note,
      file_path: d.file_path,
      file_name: d.file_name,
      file_size: d.file_size,
      uploaded_by: d.uploaded_by,
      uploaded_at: d.created_at,
      is_final: d.status === "signed",
      badge: d.source === "generated" ? "Generated" : null,
    })),
    extraMenu: [{ label: "Generate PDF from trade", icon: <FilePlus2 />, onClick: generate }],
    onAdd: async ({ file, stage, note, submittedOn }) => {
      await post(`/trades/${trade.id}/contract-versions`, { file, source: "uploaded", note: note || null, stage, submitted_on: submittedOn || null });
      refresh();
    },
    onFinal: async () => {
      const [data] = await get<{ id: string; source: string; status: string }[]>(`/trades/${trade.id}/contract-documents`);
      if (!data) throw new Error("No sales contract yet");
      if (data.source !== "uploaded") throw new Error("Upload the signed copy first, then mark it signed");
      await post(`/contract-documents/${data.id}/sign`);
      refresh();
    },
  };

  if (isLoading) return <section className="card p-5 text-[0.8125rem] text-mut">Loading sales contract</section>;
  return (
    <DocPanel
      title="Sales contract"
      docs={[doc]}
      numbered={false}
      actions={<Button size="sm" variant="outline" disabled={busy} onClick={generate}>{busy ? <Loader2 className="animate-spin" /> : <FilePlus2 />} Generate PDF</Button>}
      banner={!signed ? <div className="rounded-lg border border-warn/40 bg-warn/[0.06] px-3.5 py-2.5 text-[0.8125rem]">No signed version yet. Download the generated PDF, get it signed, add the signed copy as a new version and mark it signed. EXPs open after that.</div> : undefined}
      hint="Each generated draft and uploaded copy is kept as a version. Generate a new PDF after an amendment is approved."
    />
  );
}

type FollowupRow = { trade_id: string; checkpoint: number; note: string | null; done_by: string | null; done_at: string };

export function useFollowups(tradeId: string) {
  return useQuery({
    queryKey: ["trade", tradeId, "followups"],
    queryFn: () => get<FollowupRow[]>(`/trades/${tradeId}/followups`),
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
      await post(`/trades/${trade.id}/followups/${cp}/done`, { note: null });
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
