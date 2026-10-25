import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { INCENTIVE_DOCS, rpc, useRefresh } from "@/lib/api";
import { bdt, calcIncentive, errMsg, rateHint } from "@/lib/format";
import type { Exp, UploadedFile } from "@/lib/types";
import { Button, Chip, Field, Grid, Input, PageHeader, Row, Section, cn } from "@/components/ui";
import { FileField } from "@/components/files";

export default function IncentiveNew() {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const [trades, setTrades] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [net, setNet] = useState("");
  const [freight, setFreight] = useState("");
  const [netUsd, setNetUsd] = useState("");
  const [freightUsd, setFreightUsd] = useState("");
  const [pct, setPct] = useState("");
  const [docs, setDocs] = useState<Record<string, UploadedFile | null>>({});
  const [busy, setBusy] = useState(false);

  const { data: eligible, isLoading } = useQuery({
    queryKey: ["exps", "incentive-eligible"],
    queryFn: async () => {
      const { data, error } = await supabase.from("exp_overview").select("*").eq("collection_status", "approved").is("incentive_status", null).order("created_at");
      if (error) throw error;
      return data as Exp[];
    },
  });
  const tradeList = useMemo(() => {
    const m = new Map<string, { id: string; code: string; importer: string; count: number; total: number }>();
    (eligible ?? []).forEach((e) => {
      const cur = m.get(e.trade_id) ?? { id: e.trade_id, code: e.trade_code, importer: e.importer_name, count: 0, total: 0 };
      cur.count++;
      cur.total += Number(e.amount);
      m.set(e.trade_id, cur);
    });
    return [...m.values()];
  }, [eligible]);
  const exps = (eligible ?? []).filter((e) => trades.includes(e.trade_id));
  const expAmount = exps.filter((e) => selected.includes(e.id)).reduce((s, e) => s + Number(e.amount), 0);
  const n = Number(net || 0), f = Number(freight || 0), p = Number(pct || 0);
  const calc = calcIncentive(expAmount, n, f, p);
  const docsDone = INCENTIVE_DOCS.filter((d) => docs[d]).length;
  const valid = selected.length > 0 && calc.errors.length === 0 && docsDone === INCENTIVE_DOCS.length;

  async function submit() {
    setBusy(true);
    try {
      await rpc("create_incentive", {
        p_exp_ids: selected,
        p_net: n,
        p_freight: f,
        p_pct: p,
        p_docs: INCENTIVE_DOCS.map((d) => ({ doc_type: d, ...docs[d] })),
        p_net_usd: netUsd ? Number(netUsd) : null,
        p_freight_usd: freightUsd ? Number(freightUsd) : null,
      });
      toast.success("Incentive submitted for approval");
      refresh();
      navigate("/incentives");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="New incentive" sub="Select trades, then collected EXPs, then fill in the calculation. All amounts in BDT." />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Section step={1} title="Trades" hint="Trades with collected EXPs that are not yet claimed.">
            {isLoading ? <p className="text-mut">Loading</p> : !tradeList.length ? <p className="text-mut">No collected EXPs available. Collections must be approved first.</p> : (
              <div className="flex flex-col gap-2">
                {tradeList.map((t) => {
                  const on = trades.includes(t.id);
                  return (
                    <label key={t.id} className={cn("sel", on && "on")}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => {
                          const c = e.target.checked;
                          setTrades((s) => (c ? [...s, t.id] : s.filter((x) => x !== t.id)));
                          const ids = (eligible ?? []).filter((x) => x.trade_id === t.id).map((x) => x.id);
                          setSelected((s) => (c ? [...new Set([...s, ...ids])] : s.filter((id) => !ids.includes(id))));
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="num font-medium">{t.code}</div>
                        <div className="truncate text-[0.75rem] text-mut">{t.importer}</div>
                      </div>
                      <Chip label={`${t.count} EXP`} tone="gray" dot={false} />
                      <span className="num min-w-[6.875rem] text-right text-[0.8125rem]">{bdt(t.total)}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </Section>
          <Section step={2} title="Collected EXPs" hint="All EXPs of a selected trade are ticked. Untick any you want to leave out.">
            {!trades.length ? <p className="text-mut">Select at least one trade.</p> : (
              <div className="flex flex-col gap-2">
                {exps.map((e) => {
                  const on = selected.includes(e.id);
                  return (
                    <label key={e.id} className={cn("sel", on && "on")}>
                      <input type="checkbox" checked={on} onChange={(ev) => setSelected((s) => (ev.target.checked ? [...s, e.id] : s.filter((x) => x !== e.id)))} />
                      <div className="min-w-0 flex-1">
                        <div className="num font-medium">{e.code}</div>
                        <div className="text-[0.75rem] text-mut">{e.trade_code} · {e.collection_code}</div>
                      </div>
                      <Chip label="Collected" tone="ok" />
                      <span className="num min-w-[7.5rem] text-right font-semibold">{bdt(e.amount)}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </Section>
          <Section step={3} title="Calculation inputs">
            <Grid>
              <Field label="Net proceed (BDT)" required hint="After govt and bank charges">
                <Input type="number" inputMode="decimal" step="0.01" value={net} onChange={(e) => setNet(e.target.value)} />
              </Field>
              <Field label="Net proceed (USD, optional)" hint={rateHint(net, netUsd)}>
                <Input type="number" inputMode="decimal" step="0.01" value={netUsd} onChange={(e) => setNetUsd(e.target.value)} />
              </Field>
              <Field label="Freight (BDT)" required>
                <Input type="number" inputMode="decimal" step="0.01" value={freight} onChange={(e) => setFreight(e.target.value)} />
              </Field>
              <Field label="Freight (USD, optional)" hint={rateHint(freight, freightUsd)}>
                <Input type="number" inputMode="decimal" step="0.01" value={freightUsd} onChange={(e) => setFreightUsd(e.target.value)} />
              </Field>
              <Field label="Incentive %" required>
                <Input type="number" inputMode="decimal" step="0.01" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="e.g. 10" />
              </Field>
            </Grid>
          </Section>
          <Section step={4} title="Attachments" hint="All eight are required.">
            <div className="flex flex-col gap-2">
              {INCENTIVE_DOCS.map((d) => <FileField key={d} label={d} folder="incentives" value={docs[d] ?? null} onChange={(file) => setDocs((s) => ({ ...s, [d]: file }))} required />)}
            </div>
          </Section>
        </div>
        <aside className="flex flex-col gap-3 lg:sticky lg:top-20">
          <div className="card p-5">
            <div className="lbl mb-2">Calculation</div>
            <Row label={`EXP amount (${selected.length})`} value={<span className="num">{bdt(expAmount)}</span>} />
            <Row label="Net proceed" value={<span className="num">{bdt(n)}</span>} />
            <Row label="Freight" value={<span className="num">minus {bdt(f)}</span>} />
            <Row label="FOB" value={<span className="num font-medium">{bdt(calc.fob)}</span>} />
            <Row label="Incentive %" value={<span className="num">{p}%</span>} />
            <Row label="Attachments" value={<span className="num">{docsDone}/8</span>} />
            <div className="my-3 border-t border-line" />
            <div className="lbl">Incentive</div>
            <div className="num mt-1 text-[1.75rem] font-semibold">{bdt(calc.incentive)}</div>
            {selected.length > 0 && (n > 0 || p > 0) && calc.errors.map((e) => <p key={e} className="mt-1 text-[0.7812rem] text-bad">{e}</p>)}
          </div>
          <Button className="h-11 w-full" disabled={!valid} loading={busy} onClick={submit}>{!busy && <Send />} Submit for approval</Button>
          <p className="text-center text-[0.75rem] text-mut">FOB = net proceed minus freight. Incentive = FOB x % / 100.</p>
        </aside>
      </div>
    </>
  );
}
