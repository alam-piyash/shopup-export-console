import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Send, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { COLLECTION_DOCS, rpc, useRefresh } from "@/lib/api";
import { bdt, cents, errMsg, rateHint, usdOpt } from "@/lib/format";
import type { Exp, UploadedFile } from "@/lib/types";
import { Button, Chip, Field, Grid, Input, PageHeader, Row, Section, Select, cn } from "@/components/ui";
import { FileField } from "@/components/files";

export default function CollectionNew() {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const [tradeId, setTradeId] = useState("");
  const [amount, setAmount] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [bankRef, setBankRef] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [docs, setDocs] = useState<Record<string, UploadedFile | null>>({});
  const [busy, setBusy] = useState(false);

  const { data: trades } = useQuery({
    queryKey: ["trades", "collectable"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trades").select("id, code, importer_name").in("status", ["active", "revision_pending"]).order("created_at", { ascending: false });
      if (error) throw error;
      return data as { id: string; code: string; importer_name: string }[];
    },
  });
  const { data: exps, isLoading: expsLoading } = useQuery({
    queryKey: ["exps", "uncollected", tradeId],
    enabled: !!tradeId,
    queryFn: async () => {
      const { data, error } = await supabase.from("exp_overview").select("*").eq("trade_id", tradeId).is("collection_status", null).order("created_at");
      if (error) throw error;
      return data as Exp[];
    },
  });

  const received = Number(amount || 0);
  const sum = (exps ?? []).filter((e) => selected.includes(e.id)).reduce((s, e) => s + Number(e.amount), 0);
  const diff = received - sum;
  const matches = received > 0 && selected.length > 0 && cents(sum) === cents(received);
  const docsDone = COLLECTION_DOCS.filter((d) => docs[d]).length;
  const valid = matches && docsDone === COLLECTION_DOCS.length && !!tradeId;

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
        p_docs: COLLECTION_DOCS.map((d) => ({ doc_type: d, ...docs[d] })),
        p_amount_usd: amountUsd ? Number(amountUsd) : null,
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
          <Section step={1} title="Trade and amount received">
            <Field label="Trade" required>
              <Select value={tradeId} onChange={(e) => { setTradeId(e.target.value); setSelected([]); }} placeholder={trades?.length ? "Select an active trade" : "No active trades"}>
                {trades?.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.importer_name}</option>)}
              </Select>
            </Field>
            <Grid cols={3}>
              <Field label="Amount received (BDT)" required>
                <Input type="number" inputMode="decimal" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
              </Field>
              <Field label="Amount received (USD, optional)" hint={rateHint(amount, amountUsd)}>
                <Input type="number" inputMode="decimal" step="0.01" value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} placeholder="0" />
              </Field>
              <Field label="Bank reference or notes">
                <Input value={bankRef} onChange={(e) => setBankRef(e.target.value)} />
              </Field>
            </Grid>
          </Section>
          <Section
            step={2}
            title="EXPs in this collection"
            hint="Only EXPs not already in a pending or approved collection are shown."
            right={tradeId && received > 0 && (exps?.length ?? 0) > 0 ? <Button size="sm" variant="outline" onClick={autoMatch}><Wand2 /> Auto match</Button> : undefined}
          >
            {!tradeId ? <p className="text-mut">Select a trade first.</p> : expsLoading ? <p className="text-mut">Loading EXPs</p> : !exps?.length ? <p className="text-mut">No uncollected EXPs on this trade.</p> : (
              <div className="flex flex-col gap-2">
                {exps.map((e) => {
                  const on = selected.includes(e.id);
                  return (
                    <label key={e.id} className={cn("sel", on && "on")}>
                      <input type="checkbox" checked={on} onChange={(ev) => setSelected((s) => (ev.target.checked ? [...s, e.id] : s.filter((x) => x !== e.id)))} />
                      <div className="min-w-0 flex-1">
                        <div className="num font-medium">{e.code}</div>
                        <div className="text-[0.75rem] text-mut">Shipment {e.shipment_id || "not set"}</div>
                      </div>
                      <Chip status={e.status} />
                      <span className="num min-w-[7.5rem] text-right font-semibold">{bdt(e.amount)}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </Section>
          <Section step={3} title="Documents" hint="All four are required.">
            <div className="flex flex-col gap-2">
              {COLLECTION_DOCS.map((d) => <FileField key={d} label={d} folder="collections" value={docs[d] ?? null} onChange={(f) => setDocs((s) => ({ ...s, [d]: f }))} required />)}
            </div>
          </Section>
        </div>
        <aside className="flex flex-col gap-3 lg:sticky lg:top-20">
          <div className="card p-5">
            <div className="lbl mb-2">Match check</div>
            <Row label="Amount received" value={<span className="num">{bdt(received)}</span>} />
            {usdOpt(amountUsd) && <Row label="In USD" value={<span className="num">{usdOpt(amountUsd)}</span>} />}
            <Row label={`Selected EXPs (${selected.length})`} value={<span className="num">{bdt(sum)}</span>} />
            <Row label="Documents" value={<span className="num">{docsDone}/4</span>} />
            <div className="my-3 border-t border-line" />
            <div className="lbl">Difference</div>
            <div className={cn("num mt-1 text-[1.75rem] font-semibold", matches ? "text-ok" : received ? "text-bad" : "text-mut")}>{bdt(diff)}</div>
            <div className="mt-2">{matches ? <Chip label="Totals match" tone="ok" /> : <Chip label="Totals must match exactly" tone="warn" />}</div>
          </div>
          <Button className="h-11 w-full" disabled={!valid} loading={busy} onClick={submit}>{!busy && <Send />} Submit for approval</Button>
          <p className="text-center text-[0.75rem] text-mut">An admin approves before EXPs count as collected.</p>
        </aside>
      </div>
    </>
  );
}
