import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { rpc, useMe, useProfiles, useRefresh } from "@/lib/api";
import { bdt, errMsg, fmtDate, rateHint, usdOpt } from "@/lib/format";
import type { Exp, ExpAmountChange, UploadedFile } from "@/lib/types";
import { ApproveReject, Button, Chip, Field, Grid, Input, Modal, Panel, Textarea, cn } from "./ui";
import { FileActions, FileField } from "./files";
import { DocList } from "./docs";
import { entityDocModels, useEntityDocs } from "@/lib/documents";

export function useExpAmountChanges(expId: string) {
  return useQuery({
    queryKey: ["exp_amount_changes", expId],
    queryFn: async () => {
      const { data, error } = await supabase.from("exp_amount_changes").select("*").eq("exp_id", expId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ExpAmountChange[];
    },
  });
}

/** Request a new amount for an EXP (actual shipment value), with a reason and a backing document. Admin approves. */
export function ChangeAmountDialog({ exp, limitLeft, onClose }: { exp: Exp; limitLeft: number; onClose: () => void }) {
  const refresh = useRefresh();
  const [amount, setAmount] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const n = Number(amount || 0);
  const delta = n - Number(exp.amount);
  const over = n > 0 && delta > limitLeft + 0.0001;
  const valid = n > 0 && (n !== Number(exp.amount) || (amountUsd !== "" && Number(amountUsd) !== Number(exp.amount_usd ?? NaN))) && reason.trim() && file && !over;
  async function submit() {
    setBusy(true);
    try {
      await rpc("request_exp_amount_change", { p_exp: exp.id, p_amount: n, p_amount_usd: amountUsd ? Number(amountUsd) : null, p_reason: reason, p_file: file });
      toast.success("Amount change sent for approval");
      refresh();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      wide
      title={<span className="num">Change amount of {exp.code}</span>}
      description="Use this when the shipped value differs from the EXP. An admin approves, then all totals use the new amount."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} loading={busy} onClick={submit}>Send for approval</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-bg p-3.5 text-[0.8125rem]">
          <div>
            <div className="lbl">Issued on EXP</div>
            <div className="num mt-0.5 font-medium">{bdt(exp.issued_amount ?? exp.amount)}</div>
            {usdOpt(exp.issued_amount_usd) && <div className="num text-mut">{usdOpt(exp.issued_amount_usd)}</div>}
          </div>
          <div>
            <div className="lbl">Current amount</div>
            <div className="num mt-0.5 font-medium">{bdt(exp.amount)}</div>
            {usdOpt(exp.amount_usd) && <div className="num text-mut">{usdOpt(exp.amount_usd)}</div>}
          </div>
        </div>
        <Grid>
          <Field
            label="New amount (BDT)"
            required
            error={over}
            hint={
              n > 0 ? (
                <>
                  Change <span className={cn("num", delta > 0 ? "text-ok" : delta < 0 ? "text-bad" : "")}>{delta > 0 ? "+" : ""}{bdt(delta)}</span>
                  {over ? " · above the contract limit, amend the contract first" : ` · room left ${bdt(limitLeft)}`}
                </>
              ) : `Room left on the contract (with tolerance) ${bdt(limitLeft)}`
            }
          >
            <Input type="number" inputMode="decimal" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus />
          </Field>
          <Field label="New amount (USD, optional)" hint={rateHint(amount, amountUsd)}>
            <Input type="number" inputMode="decimal" step="0.01" value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} placeholder="0" />
          </Field>
        </Grid>
        <Field label="Reason" required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Actual shipped quantity 9,400 KG against 10,000 KG on the EXP" />
        </Field>
        <FileField label="Backing document" folder="exps/amount-changes" value={file} onChange={setFile} required />
        <p className="-mt-2 text-[0.75rem] text-mut">For example the final commercial invoice, packing list or bank-endorsed EXP. Closed EXPs can be changed too.</p>
      </div>
    </Modal>
  );
}

/** History of amount changes with approve, reject and withdraw. */
export function AmountChangesPanel({ exp }: { exp: Exp }) {
  const { data } = useExpAmountChanges(exp.id);
  const backing = useEntityDocs("exp_amount_change", (data ?? []).map((c) => c.id));
  const profiles = useProfiles().data ?? {};
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  const refresh = useRefresh();
  const [busy, setBusy] = useState<string | null>(null);
  if (!data?.length) return null;
  const backingDocs = data.flatMap((c) =>
    entityDocModels(backing.data, { entityId: c.id, folder: "exps/amount-changes", refresh }).map((d) => ({
      ...d,
      name: `Backing document · ${bdt(c.old_amount)} to ${bdt(c.new_amount)}`,
      tag: c.status === "pending_approval" ? "Awaiting approval" : c.status === "approved" ? "Approved" : c.status === "rejected" ? "Rejected" : "Withdrawn",
    })),
  );
  const decide = async (id: string, approve: boolean, reason?: string) => {
    try {
      await rpc("decide_exp_amount_change", { p_id: id, p_approve: approve, p_reason: reason ?? null });
      toast.success(approve ? "Amount change approved, new amount applied" : "Amount change rejected");
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
      throw e;
    }
  };
  const withdraw = async (id: string) => {
    setBusy(id);
    try {
      await rpc("withdraw_exp_amount_change", { p_id: id });
      toast.success("Request withdrawn");
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Panel title="Amount changes">
      <div className="scroll-thin overflow-x-auto">
        <table className="tbl min-w-[52rem]">
          <thead><tr>{["Requested", "From", "To", "Reason", "Document", "Status", ""].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {data.map((c) => {
              const d = Number(c.new_amount) - Number(c.old_amount);
              return (
                <tr key={c.id}>
                  <td className="whitespace-nowrap text-mut">{fmtDate(c.created_at)} · {c.is_demo ? "Demo" : profiles[c.requested_by ?? ""] ?? ""}</td>
                  <td className="num text-mut">{bdt(c.old_amount)}</td>
                  <td className="num">
                    {bdt(c.new_amount)} <span className={cn("ml-1 text-[0.75rem]", d > 0 ? "text-ok" : "text-bad")}>{d > 0 ? "+" : ""}{bdt(d)}</span>
                    {usdOpt(c.new_amount_usd) && <div className="text-[0.7188rem] text-mut">{usdOpt(c.new_amount_usd)}</div>}
                  </td>
                  <td className="max-w-[16rem] truncate" title={c.reason}>{c.reason}{c.rejection_reason && <div className="text-[0.75rem] text-bad">Rejected: {c.rejection_reason}</div>}</td>
                  <td><FileActions path={c.file_path} name={c.file_name} /></td>
                  <td>
                    <Chip status={c.status} />
                    {c.approved_at && c.status !== "pending_approval" && <div className="mt-0.5 text-[0.7188rem] text-mut">{fmtDate(c.approved_at)}{c.approved_by && profiles[c.approved_by] ? ` · ${profiles[c.approved_by]}` : ""}</div>}
                  </td>
                  <td>
                    {c.status === "pending_approval" && (
                      <div className="flex items-center gap-1.5">
                        {isAdmin && <ApproveReject label={`amount change on ${exp.code}`} onApprove={() => decide(c.id, true)} onReject={(r) => decide(c.id, false, r)} />}
                        {(c.requested_by === me?.id || isAdmin) && <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => withdraw(c.id)}><Undo2 /> Withdraw</Button>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {backingDocs.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line p-4">
          <div className="lbl">Backing documents</div>
          <DocList docs={backingDocs} small />
        </div>
      )}
    </Panel>
  );
}
