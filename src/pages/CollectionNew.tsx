import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Send, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { COLLECTION_DOCS, COLLECTION_REQUIRED, rpc, selectAll, useRefresh } from "@/lib/api";
import { money, cents, errMsg, pct } from "@/lib/format";
import type { Exp, UploadedFile } from "@/lib/types";
import { Button, Chip, Field, Grid, Input, PageHeader, Progress, Row, Section, cn } from "@/components/ui";
import { ExpMultiPicker, TradePicker } from "@/components/pickers";
import { FileField } from "@/components/files";

export default function CollectionNew() {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const [params] = useSearchParams();
  const [tradeId, setTradeId] = useState(params.get("trade") ?? "");
  const [amount, setAmount] = useState("");
  const [bankRef, setBankRef] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [docs, setDocs] = useState<Record<string, UploadedFile | null>>({});
  const [busy, setBusy] = useState(false);

  const { data: trades } = useQuery({
    queryKey: ["trades", "collectable"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trades").select("id, code, importer_name, sales_contract_no").in("status", ["active", "revision_pending"]).order("created_at", { ascending: false });
      if (error) throw error;
      return data as { id: string; code: string; importer_name: string; sales_contract_no: string }[];
    },
  });
  const { data: exps, isLoading: expsLoading } = useQuery({
    queryKey: ["exps", "uncollected", tradeId],
    enabled: !!tradeId,
    queryFn: async () => {
      return selectAll<Exp>(() => supabase.from("exp_overview").select("*").eq("trade_id", tradeId).is("collection_status", null).order("created_at").order("id"));
    },
  });

  const received = Number(amount || 0);
  const sum = (exps ?? []).filter((e) => selected.includes(e.id)).reduce((s, e) => s + Number(e.amount), 0);
  const diff = received - sum;
  const matches = received > 0 && selected.length > 0 && cents(sum) === cents(received);
  const pendingDocs = COLLECTION_DOCS.filter((d) => !docs[d] && !COLLECTION_REQUIRED.includes(d));
  const valid = matches && COLLECTION_REQUIRED.every((d) => docs[d]) && !!tradeId;

  /** Pick the subset of EXPs whose total equals the amount received (small sets only). */
  function autoMatch() {
    const list = exps ?? [];
    const target = cents(received);
    if (!target || !list.length) return;
    const n = Math.min(list.length, 16);
    for (let mask = 1; mask < 1 << n; mask++) {
      let s = 0;
      for (let i = 0; i < n; i++) if (mask & (1 << i)) s += cents(list[i].amount);
      if (s === target) {
        setSelected(list.filter((_, i) => mask & (1 << i)).map((e) => e.id));
        toast.success("Found EXPs that match the amount");
        return;
      }
    }
    toast.error("No combination of EXPs matches this amount exactly");
  }

  async function submit() {
    setBusy(true);
    try {
      await rpc("create_collection", {
        p_trade: tradeId,
        p_amount: received,
        p_bank_ref: bankRef,
        p_exp_ids: selected,
        p_docs: COLLECTION_DOCS.filter((d) => docs[d]).map((d) => ({ doc_type: d, ...docs[d] })),
      });
      toast.success("Collection submitted for approval");
      refresh();
      navigate("/collections");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="New collection" sub="Pick a trade, enter the amount received, then tick the EXPs it covers. The totals must match exactly." />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Section step={1} title="Trade and amount received" done={!!tradeId && received > 0} active={!tradeId || !(received > 0)}>
            <Field label="Trade" required>
              <TradePicker trades={trades ?? []} value={tradeId} onChange={(id) => { setTradeId(id); setSelected([]); }} />
            </Field>
            <Grid>
              <Field label="Amount received (USD)" required>
                <Input type="number" inputMode="decimal" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
              </Field>
              <Field label="Bank reference or notes">
                <Input value={bankRef} onChange={(e) => setBankRef(e.target.value)} />
              </Field>
            </Grid>
          </Section>
          <Section
            step={2}
            done={matches}
            active={!!tradeId && received > 0 && !matches}
            title="EXPs in this collection"
            hint="Only EXPs not already in a pending or approved collection are shown."
            right={tradeId && received > 0 && (exps?.length ?? 0) > 0 ? <Button size="sm" variant="outline" onClick={autoMatch}><Wand2 /> Auto match</Button> : undefined}
          >
            {!tradeId ? <p className="text-mut">Select a trade first.</p> : expsLoading ? <p className="text-mut">Loading EXPs</p> : !exps?.length ? <p className="text-mut">No uncollected EXPs on this trade.</p> : (
              <ExpMultiPicker
                exps={exps}
                selected={selected}
                onChange={setSelected}
                              />
            )}
          </Section>
          <Section step={3} done={!!docs["Swift Message"]} active={matches && !docs["Swift Message"]} title="Documents" hint="The Swift Message is required now. Swift Copy, PRC and TT Voucher can be added later from the collection page.">
            <div className="flex flex-col gap-2">
              {COLLECTION_DOCS.map((d) => {
                const req = COLLECTION_REQUIRED.includes(d);
                return <FileField key={d} label={req ? d : `${d} (can be added later)`} folder="collections" value={docs[d] ?? null} onChange={(f) => setDocs((s) => ({ ...s, [d]: f }))} required={req} />;
              })}
            </div>
          </Section>
        </div>
        <aside className="flex flex-col gap-3 lg:sticky lg:top-20">
          <div className="card overflow-hidden">
            <div className="head-strip border-b border-line px-5 py-3 text-[0.875rem] font-semibold">Match check</div>
            <div className="px-5 py-3">
              <Row label="Amount received" value={<span className="num font-medium">{received ? money(received) : <span className="text-mut">Not entered</span>}</span>} />
              <Row label={`Selected EXPs (${selected.length})`} value={<span className="num font-medium">{money(sum)}</span>} />
              {received > 0 && <Progress value={pct(sum, received)} tone={matches ? "ok" : diff < 0 ? "bad" : "accent"} className="my-2" />}
              <Row label="Swift Message" value={docs["Swift Message"] ? <Chip label="Attached" tone="ok" dot={false} /> : <Chip label="Required" tone="warn" dot={false} />} />
              {pendingDocs.length > 0 && <Row label="Can be added later" value={<span className="text-mut">{pendingDocs.join(", ")}</span>} />}
            </div>
            <div className={cn("border-t px-5 py-4", matches ? "border-ok/30 bg-ok/[0.07]" : received && selected.length ? (diff < 0 ? "border-bad/25 bg-bad/[0.05]" : "border-warn/30 bg-warn/[0.06]") : "border-line bg-bg")}>
              {!received ? (
                <p className="text-[0.8125rem] text-mut">Enter the amount received, then tick the EXPs it pays for.</p>
              ) : !selected.length ? (
                <><div className="lbl">To match</div><div className="num mt-1 text-[1.5rem] font-semibold">{money(received)}</div><p className="mt-1 text-[0.75rem] text-mut">Tick EXPs that add up to this amount, or use Auto match.</p></>
              ) : matches ? (
                <><div className="lbl text-ok">Totals match</div><div className="num mt-1 text-[1.5rem] font-semibold text-ok">{money(sum)}</div><p className="mt-1 text-[0.75rem] text-mut">Ready to submit once the Swift Message is attached.</p></>
              ) : diff > 0 ? (
                <><div className="lbl">Still to match</div><div className="num mt-1 text-[1.5rem] font-semibold text-warn">{money(diff)}</div><p className="mt-1 text-[0.75rem] text-mut">Tick more EXPs. Totals must match exactly.</p></>
              ) : (
                <><div className="lbl">Over by</div><div className="num mt-1 text-[1.5rem] font-semibold text-bad">{money(-diff)}</div><p className="mt-1 text-[0.75rem] text-mut">Untick an EXP. Totals must match exactly.</p></>
              )}
            </div>
          </div>
          <Button className="h-11 w-full" disabled={!valid} loading={busy} onClick={submit}>{!busy && <Send />} Submit for approval</Button>
          <p className="text-center text-[0.75rem] text-mut">An admin approves before EXPs count as collected.</p>
        </aside>
      </div>
    </>
  );
}
