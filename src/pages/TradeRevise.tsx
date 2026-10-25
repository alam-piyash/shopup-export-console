import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Lock, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { rpc, useRefresh, useTrade } from "@/lib/api";
import { bdt, cents, errMsg } from "@/lib/format";
import type { UploadedFile } from "@/lib/types";
import { Button, Chip, Empty, Field, Grid, Input, LoadingRows, PageHeader, Row, Section, Switch, Textarea, cn } from "@/components/ui";
import { FileField } from "@/components/files";
import { ItemsEditor, itemsTotal, itemsValid, type ItemLine } from "@/components/items";

export default function TradeRevise() {
  const { tradeId = "" } = useParams();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const { data, isLoading } = useTrade(tradeId);
  const { data: meta } = useQuery({
    queryKey: ["trade", tradeId, "amend-meta"],
    queryFn: async () => {
      const [a, i] = await Promise.all([
        supabase.from("trade_amendments").select("amendment_no, status").eq("trade_id", tradeId),
        supabase.from("trade_items").select("*").eq("trade_id", tradeId).order("sort_order"),
      ]);
      if (a.error) throw a.error;
      if (i.error) throw i.error;
      const used = (a.data ?? []).filter((x) => x.status !== "rejected" && x.status !== "withdrawn").map((x) => x.amendment_no as number);
      return { nextNo: (used.length ? Math.max(...used) : 0) + 1, items: i.data ?? [] };
    },
  });
  const [no, setNo] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [editItems, setEditItems] = useState(false);
  const [items, setItems] = useState<ItemLine[]>([]);
  const [newAmount, setNewAmount] = useState("");
  const [newExpiry, setNewExpiry] = useState("");
  const [newTimeline, setNewTimeline] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!meta) return;
    setNo((v) => v || String(meta.nextNo));
    setItems((v) =>
      v.length
        ? v
        : meta.items.map((i) => ({
            description: i.description,
            carton_size: i.carton_size ?? "",
            hs_code: i.hs_code ?? "",
            incoterm: i.incoterm ?? "",
            quantity_kg: String(i.quantity_kg),
            rate_per_kg: String(i.rate_per_kg),
            rate_usd_per_kg: i.rate_usd_per_kg == null ? "" : String(i.rate_usd_per_kg),
          })),
    );
  }, [meta]);

  if (isLoading) return <LoadingRows rows={5} />;
  if (!data) return <Empty title="Trade not found" />;
  const { trade: t, exps } = data;
  if (t.status !== "active") return <Empty title="This trade cannot be amended now" body="Only active trades without a pending amendment can be amended." />;

  const valueOf = (id: string, current: number) => (amounts[id] !== undefined ? Number(amounts[id] || 0) : current);
  const total = exps.reduce((s, e) => s + valueOf(e.id, Number(e.amount)), 0);
  const target = editItems ? itemsTotal(items) : Number(newAmount || 0);
  const over = cents(total) > cents(target);
  const badExp = exps.some((e) => valueOf(e.id, Number(e.amount)) <= 0);
  const valid = target > 0 && !over && !badExp && !!reason.trim() && !!file && Number(no) > 0 && !!date && (!editItems || itemsValid(items));
  const delta = target - Number(t.contract_amount);

  async function submit() {
    setBusy(true);
    try {
      const changes = exps.filter((e) => e.status === "open").map((e) => ({ exp_id: e.id, amount: valueOf(e.id, Number(e.amount)) }));
      await rpc("request_amendment", {
        p_trade: tradeId,
        p_data: { amendment_no: Number(no), amendment_date: date, reason, new_amount: editItems ? null : target, new_expiry_date: newExpiry || null, new_shipment_timeline: newTimeline || null },
        p_items: editItems ? items : null,
        p_file: file,
        p_changes: changes,
      });
      toast.success("Amendment submitted for approval");
      refresh();
      navigate(`/trades/${tradeId}?tab=amendments`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={<>Revise contract <span className="num text-mut">· {t.code}</span></>} sub={`SC ${t.sales_contract_no}. Nothing changes until an admin approves. Closed EXPs are locked.`} />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Section step={1} title="Amendment">
            <Grid>
              <Field label="Amendment number" required hint={`Suggested next number: ${meta?.nextNo ?? 1}`}>
                <Input type="number" min={1} value={no} onChange={(e) => setNo(e.target.value)} />
              </Field>
              <Field label="Amendment date" required>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Reason" required className="sm:col-span-2">
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="What changed and why" />
              </Field>
            </Grid>
            <FileField label="Amendment copy" folder="trades/amendments" value={file} onChange={setFile} required />
          </Section>
          <Section step={2} title="What changed">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-bg p-3.5">
              <div>
                <div className="text-[0.8438rem] font-medium">Edit item lines</div>
                <div className="text-[0.75rem] text-mut">Change quantity and rate. The amount is recomputed from the lines.</div>
              </div>
              <Switch checked={editItems} onChange={setEditItems} label="Edit item lines" />
            </div>
            {editItems ? (
              <ItemsEditor items={items} onChange={setItems} />
            ) : (
              <Grid>
                <Field label="Current amount"><Input className="num" value={bdt(t.contract_amount)} disabled /></Field>
                <Field label="New contract amount (BDT)" required>
                  <Input type="number" inputMode="decimal" step="0.01" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} />
                </Field>
              </Grid>
            )}
            <Grid>
              <Field label="New expiry date (optional)" hint={t.expiry_date ? `Now ${t.expiry_date}` : undefined}>
                <Input type="date" value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)} />
              </Field>
              <Field label="New shipment timeline (optional)">
                <Input value={newTimeline} onChange={(e) => setNewTimeline(e.target.value)} placeholder={t.shipment_timeline ?? ""} />
              </Field>
            </Grid>
          </Section>
          <Section step={3} title="EXP amounts" hint="Adjust open EXPs so their total fits the new contract amount.">
            {exps.length === 0 ? (
              <p className="text-mut">No EXPs on this trade.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {exps.map((e) => {
                  const changed = amounts[e.id] !== undefined && Number(amounts[e.id]) !== Number(e.amount);
                  return (
                    <div key={e.id} className={cn("sel cursor-default", changed && "on")}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="num text-[0.8438rem] font-medium">{e.code}</span>
                          <Chip status={e.status} />
                          {changed && <Chip label="Changed" tone="info" dot={false} />}
                        </div>
                        <div className="num text-[0.75rem] text-mut">Now {bdt(e.amount)}</div>
                      </div>
                      {e.status === "closed" ? (
                        <span className="num flex items-center gap-1 text-[0.8125rem] text-mut"><Lock className="size-3" /> {bdt(e.amount)}</span>
                      ) : (
                        <Input className="!w-40" type="number" inputMode="decimal" step="0.01" value={amounts[e.id] ?? String(e.amount)} onChange={(ev) => setAmounts((s) => ({ ...s, [e.id]: ev.target.value }))} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        </div>
        <aside className="flex flex-col gap-3 lg:sticky lg:top-20">
          <div className="card p-5">
            <div className="lbl mb-2">Summary of changes</div>
            <Row label="Amendment" value={`No ${no || "?"}`} />
            <Row label="Current contract" value={<span className="num">{bdt(t.contract_amount)}</span>} />
            <Row label="New contract" value={<span className="num">{bdt(target)}</span>} />
            {target > 0 && delta !== 0 && <Row label="Change" value={<span className={cn("num", delta > 0 ? "text-ok" : "text-bad")}>{delta > 0 ? "+" : ""}{bdt(delta)}</span>} />}
            <Row label="EXP total" value={<span className="num">{bdt(total)}</span>} />
            <div className="my-3 border-t border-line" />
            <div className="lbl">Headroom</div>
            <div className={cn("num mt-1 text-[1.75rem] font-semibold", over ? "text-bad" : "text-ok")}>{bdt(target - total)}</div>
            {over && <p className="mt-2 text-[0.7812rem] text-bad">EXP total is above the new contract amount. Lower open EXPs or raise the amount.</p>}
          </div>
          <Button className="h-11 w-full" disabled={!valid} loading={busy} onClick={submit}>{!busy && <Send />} Submit for approval</Button>
          <p className="text-center text-[0.75rem] text-mut">Nothing changes until an admin approves.</p>
        </aside>
      </div>
    </>
  );
}
