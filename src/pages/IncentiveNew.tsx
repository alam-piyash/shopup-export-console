import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { INCENTIVE_DOCS, rpc, selectAll, useRefresh } from "@/lib/api";
import { money, calcIncentive, errMsg } from "@/lib/format";
import type { Exp, UploadedFile } from "@/lib/types";
import { Button, Chip, Field, Grid, Input, PageHeader, Row, Section, cn } from "@/components/ui";
import { FileField } from "@/components/files";
import { ExpMultiPicker, SearchBox } from "@/components/pickers";
import { expNumber } from "@/lib/expFields";

export default function IncentiveNew() {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const [trades, setTrades] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [net, setNet] = useState("");
  const [freight, setFreight] = useState("");
  const [pct, setPct] = useState("");
  const [docs, setDocs] = useState<Record<string, UploadedFile | null>>({});
  const [busy, setBusy] = useState(false);
  const [tq, setTq] = useState("");

  const { data: eligible, isLoading } = useQuery({
    queryKey: ["exps", "incentive-eligible"],
    queryFn: async () => {
      return selectAll<Exp>(() => supabase.from("exp_overview").select("*").eq("collection_status", "approved").is("incentive_status", null).order("created_at").order("id"));
    },
  });
  const tradeList = useMemo(() => {
    const m = new Map<string, { id: string; code: string; sc: string; importer: string; count: number; total: number }>();
    (eligible ?? []).forEach((e) => {
      const cur = m.get(e.trade_id) ?? { id: e.trade_id, code: e.trade_code, sc: e.sales_contract_no ?? "", importer: e.importer_name, count: 0, total: 0 };
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

  const pickedTrades = tradeList.filter((t) => trades.includes(t.id));
  const need = (v: string, ok: boolean) => cn(!v.trim() || !ok ? "need" : "");
  const formDone = selected.length > 0 && calc.errors.length === 0;
  const stage = !trades.length ? 1 : !selected.length ? 2 : !formDone ? 3 : docsDone < INCENTIVE_DOCS.length ? 4 : 0;

  return (
    <>
      <PageHeader title="New incentive" sub="Pick the trade, check its collected EXPs, then fill the form. All amounts in USD." />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Section step={1} title="Trade" hint="Trades with collected EXPs that are not yet claimed." done={trades.length > 0} active={stage === 1}
            right={trades.length > 0 ? <Chip label={`${trades.length} selected`} tone="ok" dot={false} /> : undefined}>
            {isLoading ? <p className="text-mut">Loading</p> : !tradeList.length ? <p className="text-mut">No collected EXPs available. Collections must be approved first.</p> : (
              <div className="flex flex-col gap-2">
                {tradeList.length > 5 && <SearchBox value={tq} onChange={setTq} placeholder="Search trade code, SC number or buyer" />}
                {tradeList.filter((t) => !tq || [t.code, t.sc, t.importer].some((x) => x.toLowerCase().includes(tq.toLowerCase()))).map((t) => {
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
                        <div className="code-id font-medium">SC {t.sc} <span className="font-normal text-mut">· {t.code}</span></div>
                        <div className="truncate text-[0.75rem] text-mut">{t.importer}</div>
                      </div>
                      <Chip label={`${t.count} collected EXP${t.count === 1 ? "" : "s"}`} tone={on ? "ok" : "gray"} dot={false} />
                      <span className="num min-w-[6.875rem] text-right text-[0.8125rem] font-medium">{money(t.total)}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </Section>
          <Section step={2} title="Collected EXPs" hint="All collected EXPs of a selected trade are ticked. Untick any you want to leave out." done={selected.length > 0} active={stage === 2}
            right={selected.length > 0 ? <Chip label={`${selected.length} EXP${selected.length === 1 ? "" : "s"} · ${money(expAmount)}`} tone="ok" dot={false} /> : undefined}>
            {!trades.length ? <p className="text-mut">Select a trade above to see its collected EXPs.</p> : (
              <ExpMultiPicker
                exps={exps}
                selected={selected}
                onChange={setSelected}
                meta={(e) => [`SC ${e.sales_contract_no ?? e.trade_code}`, e.collection_code].filter(Boolean).join(" · ")}
              />
            )}
          </Section>
          <Section step={3} title="Claim form" hint="Fields marked in amber still need a value." done={formDone} active={stage === 3}>
            <div className="rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[0.8125rem]">
              {selected.length ? <>Claiming on <span className="font-medium">{selected.length} EXP{selected.length === 1 ? "" : "s"}</span> from {pickedTrades.map((t) => `SC ${t.sc}`).join(", ")} · EXP amount <span className="num font-medium">{money(expAmount)}</span></> : <span className="text-mut">Select EXPs first. The net proceed cannot be above their total.</span>}
            </div>
            <Grid cols={3}>
              <Field label="Net proceed (USD)" required hint={n > expAmount && selected.length ? "Cannot be above the EXP amount" : "After govt and bank charges"} error={n > expAmount && selected.length > 0}>
                <Input className={need(net, n > 0 && (!selected.length || n <= expAmount))} type="number" inputMode="decimal" step="0.01" value={net} onChange={(e) => setNet(e.target.value)} />
              </Field>
              <Field label="Freight (USD)" required hint={f >= n && n > 0 ? "Must be less than net proceed" : undefined} error={f >= n && n > 0}>
                <Input className={need(freight, f >= 0 && (n <= 0 || f < n))} type="number" inputMode="decimal" step="0.01" value={freight} onChange={(e) => setFreight(e.target.value)} />
              </Field>
              <Field label="Incentive %" required>
                <Input className={need(pct, p > 0 && p <= 100)} type="number" inputMode="decimal" step="0.01" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="e.g. 10" />
              </Field>
            </Grid>
          </Section>
          <Section step={4} title="Attachments" hint={`All ${INCENTIVE_DOCS.length} are required.`} done={docsDone === INCENTIVE_DOCS.length} active={stage === 4}
            right={<Chip label={`${docsDone}/${INCENTIVE_DOCS.length}`} tone={docsDone === INCENTIVE_DOCS.length ? "ok" : "gray"} dot={false} />}>
            <div className="flex flex-col gap-2">
              {INCENTIVE_DOCS.map((d) => <FileField key={d} label={d} folder="incentives" value={docs[d] ?? null} onChange={(file) => setDocs((s) => ({ ...s, [d]: file }))} required />)}
            </div>
          </Section>
        </div>
        <aside className="flex flex-col gap-3 lg:sticky lg:top-20">
          <div className="card p-5">
            <div className="lbl mb-2">Calculation</div>
            <Row label={`Trade${pickedTrades.length === 1 ? "" : "s"}`} value={pickedTrades.length ? <span className="code-id">{pickedTrades.map((t) => t.sc || t.code).join(", ")}</span> : <span className="text-mut">Not selected</span>} />
            <Row label={`EXP amount (${selected.length})`} value={<span className="num">{money(expAmount)}</span>} />
            <Row label="Net proceed" value={<span className="num">{money(n)}</span>} />
            <Row label="Freight" value={<span className="num">minus {money(f)}</span>} />
            <Row label="FOB" value={<span className="num font-medium">{money(calc.fob)}</span>} />
            <Row label="Incentive %" value={<span className="num">{p}%</span>} />
            <Row label="Attachments" value={<span className="num">{docsDone}/{INCENTIVE_DOCS.length}</span>} />
            <div className="my-3 border-t border-line" />
            <div className="lbl">Incentive</div>
            <div className="num mt-1 text-[1.75rem] font-semibold">{money(calc.incentive)}</div>
            {selected.length > 0 && (n > 0 || p > 0) && calc.errors.map((e) => <p key={e} className="mt-1 text-[0.7812rem] text-bad">{e}</p>)}
          </div>
          <Button className="h-11 w-full" disabled={!valid} loading={busy} onClick={submit}>{!busy && <Send />} Submit for approval</Button>
          <p className="text-center text-[0.75rem] text-mut">FOB = net proceed minus freight. Incentive = FOB x % / 100.</p>
        </aside>
      </div>
    </>
  );
}
