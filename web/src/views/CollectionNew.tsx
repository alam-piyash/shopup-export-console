import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, Send, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { COLLECTION_DOCS, COLLECTION_REQUIRED, get, post, useRefresh } from "@/lib/api";
import { money, cents, errMsg, pct, fmtDate } from "@/lib/format";
import type { Exp, UploadedFile } from "@/lib/types";
import { Button, Chip, Field, Grid, Input, PageHeader, Progress, Row, Section, cn } from "@/components/ui";
import { ExpAllocTable, TradePicker, allocErrors, fillTo } from "@/components/pickers";
import { FileField } from "@/components/files";

type TradeRow = { id: string; code: string; importer_name: string; sales_contract_no: string; contract_amount: number; contract_signed: boolean };
type Prepaid = { id: string; code: string; amount: number; created_at: string; left: number };

export default function CollectionNew() {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const [params] = useSearchParams();
  const settleParam = params.get("settle");
  const [tradeId, setTradeId] = useState(params.get("trade") ?? "");
  const [mode, setMode] = useState<"exp" | "prepaid" | "settle">(settleParam ? "settle" : "exp");
  const [sourceId, setSourceId] = useState(settleParam ?? "");
  const [amount, setAmount] = useState("");
  const [bankRef, setBankRef] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [docs, setDocs] = useState<Record<string, UploadedFile | null>>({});
  const [busy, setBusy] = useState(false);

  const { data: trades } = useQuery({
    queryKey: ["trades", "collectable"],
    queryFn: () => get<TradeRow[]>("/trades?status=active,revision_pending"),
  });
  // a settlement link can arrive without a trade: find the trade of the prepaid collection
  useEffect(() => {
    if (!settleParam || tradeId) return;
    get<{ trade_id: string }>(`/collections/${settleParam}`).then((c) => setTradeId(c.trade_id)).catch(() => undefined);
  }, [settleParam, tradeId]);

  const trade = trades?.find((t) => t.id === tradeId);
  const { data: exps, isLoading: expsLoading } = useQuery({
    queryKey: ["exps", "outstanding", tradeId],
    enabled: !!tradeId,
    queryFn: () => get<Exp[]>(`/exps?trade_id=${tradeId}&outstanding=true&order=asc`),
  });
  const { data: prepaids } = useQuery({
    queryKey: ["prepaid", tradeId],
    enabled: !!tradeId,
    queryFn: async () => {
      const rows = (await get(`/trades/${tradeId}/prepaids`)) as { id: string; code: string; amount: number; created_at: string; status: string; kind: string; source_collection_id: string | null }[];
      const used = (id: string) => rows.filter((r) => r.kind === "settlement" && r.source_collection_id === id && r.status !== "rejected" && r.status !== "withdrawn").reduce((s, r) => s + Number(r.amount), 0);
      return rows
        .filter((r) => r.kind === "prepaid" && r.status === "approved")
        .map((r) => ({ id: r.id, code: r.code, amount: Number(r.amount), created_at: r.created_at, left: Math.round((Number(r.amount) - used(r.id)) * 100) / 100 }))
        .filter((r) => r.left > 0)
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1)) as Prepaid[];
    },
  });
  // default to the oldest prepaid balance when settling
  useEffect(() => {
    if (mode === "settle" && prepaids?.length && !prepaids.some((p) => p.id === sourceId)) setSourceId(prepaids[0].id);
  }, [mode, prepaids, sourceId]);

  const source = prepaids?.find((p) => p.id === sourceId);
  const prepaidLeft = (prepaids ?? []).reduce((s, p) => s + p.left, 0);
  const list = exps ?? [];
  const errors = allocErrors(list, alloc);
  const hasErrors = Object.keys(errors).length > 0;
  const lines = Object.entries(alloc).map(([exp_id, a]) => ({ exp_id, amount: Number(a) }));
  const sum = lines.reduce((s, l) => s + (l.amount || 0), 0);
  const received = Number(amount || 0);
  const target = mode === "settle" ? source?.left ?? 0 : received;
  const diff = target - sum;
  const matches = mode === "exp" ? received > 0 && lines.length > 0 && !hasErrors && cents(sum) === cents(received) : false;
  const settleOk = mode === "settle" && !!source && lines.length > 0 && !hasErrors && sum > 0 && cents(sum) <= cents(source.left);
  const pendingDocs = COLLECTION_DOCS.filter((d) => !docs[d] && !COLLECTION_REQUIRED.includes(d));
  const swift = !!docs["Swift Message"];
  const prepaidBlocked = mode === "prepaid" && trade && !trade.contract_signed;
  const valid = !!tradeId && (mode === "exp" ? matches && swift : mode === "prepaid" ? received > 0 && swift && !prepaidBlocked : settleOk);

  function pickTrade(id: string) {
    setTradeId(id); setAlloc({}); setSourceId("");
    if (mode === "settle") setMode("exp");
  }
  function switchMode(m: typeof mode) {
    setMode(m); setAlloc({});
  }
  /** Fills EXPs in order (ticked ones if any) until the amount is used; the last one may be partial. */
  function autoFill() {
    if (!(target > 0)) return;
    const ticked = Object.keys(alloc);
    const r = fillTo(list, target, ticked.length ? ticked : undefined);
    setAlloc(r.amounts);
    if (r.left > 0) toast.message(`${money(r.left)} could not be placed. Tick more EXPs or check the amount.`);
    else toast.success("Filled. The last EXP may be partial; adjust any amount if needed.");
  }

  async function submit() {
    setBusy(true);
    try {
      if (mode === "settle") {
        await post(`/collections/${sourceId}/settle`, { lines });
        toast.success("Settlement submitted for approval");
      } else {
        await post("/collections", {
          trade: tradeId,
          amount: received,
          bank_ref: bankRef,
          prepaid: mode === "prepaid",
          lines: mode === "prepaid" ? [] : lines,
          docs: COLLECTION_DOCS.filter((d) => docs[d]).map((d) => ({ doc_type: d, ...docs[d] })),
        });
        toast.success(mode === "prepaid" ? "Prepaid collection submitted for approval" : "Collection submitted for approval");
      }
      refresh();
      navigate("/collections");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "settle" ? "Settle EXPs from prepaid" : "New collection";
  const sub = mode === "settle"
    ? "Move prepaid money onto EXPs. No documents are needed; they came with the prepaid collection."
    : mode === "prepaid"
      ? "Money received before the EXPs. It is held against the sales contract and settled onto EXPs later."
      : "Pick a trade, enter the amount received, then tick the EXPs it covers. Ticking fills the full amount; type a smaller number for a partial collection.";

  return (
    <>
      <PageHeader title={title} sub={sub} />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Section step={1} title={mode === "settle" ? "Trade and prepaid balance" : "Trade and amount received"} done={!!tradeId && (mode === "settle" ? !!source : received > 0)} active={!tradeId || (mode === "settle" ? !source : !(received > 0))}>
            <Field label="Trade" required>
              <TradePicker trades={trades ?? []} value={tradeId} onChange={pickTrade} />
            </Field>
            {tradeId && mode !== "settle" && (
              <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition", mode === "prepaid" ? "border-accent/50 bg-accent/[0.06]" : "border-line hover:bg-raised")}>
                <input type="checkbox" checked={mode === "prepaid"} onChange={(e) => switchMode(e.target.checked ? "prepaid" : "exp")} className="mt-0.5 size-4 accent-[rgb(var(--accent))]" />
                <span className="min-w-0">
                  <span className="block text-[0.875rem] font-medium">Prepaid collection (before EXPs)</span>
                  <span className="block text-[0.75rem] text-mut">No EXPs now. The money is held against SC {trade?.sales_contract_no}; settle EXPs from it once they are created.</span>
                </span>
              </label>
            )}
            {prepaidBlocked && <div className="banner chip-bad">The sales contract for {trade?.code} is not signed yet. Upload the signed copy and mark it signed before recording prepaid money.</div>}
            {mode === "settle" ? (
              !tradeId ? null : !prepaids?.length ? (
                <p className="text-mut">No approved prepaid balance on this trade.</p>
              ) : (
                <Field label="Prepaid collection" required hint={prepaids.length > 1 ? "Oldest first. Settlements draw from the one you pick." : undefined}>
                  <div className="flex flex-col gap-1.5">
                    {prepaids.map((p) => (
                      <label key={p.id} className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[0.8125rem]", p.id === sourceId ? "border-accent/50 bg-accent/[0.06]" : "border-line hover:bg-raised")}>
                        <span className="flex items-center gap-2.5">
                          <input type="radio" name="source" checked={p.id === sourceId} onChange={() => { setSourceId(p.id); setAlloc({}); }} className="accent-[rgb(var(--accent))]" />
                          <span className="code-id font-medium">{p.code}</span>
                          <span className="text-mut">received {fmtDate(p.created_at)}, {money(p.amount)}</span>
                        </span>
                        <span className="num font-semibold">{money(p.left)} left</span>
                      </label>
                    ))}
                  </div>
                </Field>
              )
            ) : (
              <Grid>
                <Field label="Amount received (USD)" required>
                  <Input type="number" inputMode="decimal" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
                </Field>
                <Field label="Bank reference or notes">
                  <Input value={bankRef} onChange={(e) => setBankRef(e.target.value)} />
                </Field>
              </Grid>
            )}
            {mode === "exp" && prepaidLeft > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-bg px-4 py-3 text-[0.8125rem]">
                <span><span className="font-medium">{money(prepaidLeft)}</span> <span className="text-mut">prepaid money on this trade is not yet settled onto EXPs.</span></span>
                <Button size="sm" variant="outline" onClick={() => switchMode("settle")}><ArrowRightLeft /> Settle from prepaid</Button>
              </div>
            )}
            {mode === "settle" && <button type="button" className="self-start text-[0.8125rem] text-accent hover:underline" onClick={() => switchMode("exp")}>Record new money instead</button>}
          </Section>

          {mode !== "prepaid" && (
            <Section
              step={2}
              done={mode === "settle" ? settleOk : matches}
              active={!!tradeId && target > 0 && !(mode === "settle" ? settleOk : matches)}
              title={mode === "settle" ? "EXPs to settle" : "EXPs in this collection"}
              hint="Only EXPs with money outstanding are shown. Ticking fills the full outstanding amount; type a smaller number for a partial amount."
              right={tradeId && target > 0 && list.length > 0 ? <Button size="sm" variant="outline" onClick={autoFill}><Wand2 /> Auto fill</Button> : undefined}
            >
              {!tradeId ? <p className="text-mut">Select a trade first.</p> : expsLoading ? <p className="text-mut">Loading EXPs</p> : (
                <ExpAllocTable exps={list} amounts={alloc} onChange={setAlloc} amountLabel={mode === "settle" ? "Settle now" : "Collect now"} />
              )}
            </Section>
          )}

          {mode !== "settle" && (
            <Section step={mode === "prepaid" ? 2 : 3} done={swift} active={(mode === "prepaid" ? received > 0 : matches) && !swift} title="Documents" hint="The Swift Message is required now. Swift Copy, PRC, TT Voucher and PRS can be added later from the collection page.">
              <div className="flex flex-col gap-2">
                {COLLECTION_DOCS.map((d) => {
                  const req = COLLECTION_REQUIRED.includes(d);
                  return <FileField key={d} label={req ? d : `${d} (can be added later)`} folder="collections" value={docs[d] ?? null} onChange={(f) => setDocs((s) => ({ ...s, [d]: f }))} required={req} />;
                })}
              </div>
            </Section>
          )}
        </div>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-20">
          <div className="card overflow-hidden">
            <div className="head-strip border-b border-line px-5 py-3 text-[0.875rem] font-semibold">{mode === "exp" ? "Match check" : mode === "prepaid" ? "Prepaid summary" : "Settlement check"}</div>
            <div className="px-5 py-3">
              {mode === "settle" ? (
                <>
                  <Row label="Prepaid left" value={<span className="num font-medium">{source ? money(source.left) : <span className="text-mut">Pick one</span>}</span>} />
                  <Row label={`Selected EXPs (${lines.length})`} value={<span className="num font-medium">{money(sum)}</span>} />
                  {source && <Progress value={pct(sum, source.left)} tone={cents(sum) > cents(source.left) ? "bad" : "accent"} className="my-2" />}
                  <Row label="Documents" value={<span className="text-mut">Not needed</span>} />
                </>
              ) : (
                <>
                  <Row label="Amount received" value={<span className="num font-medium">{received ? money(received) : <span className="text-mut">Not entered</span>}</span>} />
                  {mode === "exp" ? (
                    <>
                      <Row label={`Selected EXPs (${lines.length})`} value={<span className="num font-medium">{money(sum)}</span>} />
                      {received > 0 && <Progress value={pct(sum, received)} tone={matches ? "ok" : diff < 0 ? "bad" : "accent"} className="my-2" />}
                    </>
                  ) : (
                    <Row label="Contract" value={<span className="num">{trade ? money(trade.contract_amount) : "Not selected"}</span>} />
                  )}
                  <Row label="Swift Message" value={swift ? <Chip label="Attached" tone="ok" dot={false} /> : <Chip label="Required" tone="warn" dot={false} />} />
                  {pendingDocs.length > 0 && <Row label="Can be added later" value={<span className="text-mut">{pendingDocs.join(", ")}</span>} />}
                </>
              )}
            </div>
            <Outcome mode={mode} received={received} target={target} sum={sum} lines={lines.length} matches={matches} settleOk={settleOk} hasErrors={hasErrors} swift={swift} />
          </div>
          <Button className="h-11 w-full" disabled={!valid} loading={busy} onClick={submit}>{!busy && <Send />} Submit for approval</Button>
          <p className="text-center text-[0.75rem] text-mut">
            {mode === "settle" ? "Admin or Finance approves before the EXPs count as collected." : mode === "prepaid" ? "Admin or Finance approves before the money can be settled onto EXPs." : "Admin or Finance approves before EXPs count as collected."}
          </p>
        </aside>
      </div>
    </>
  );
}

function Outcome({ mode, received, target, sum, lines, matches, settleOk, hasErrors, swift }: { mode: "exp" | "prepaid" | "settle"; received: number; target: number; sum: number; lines: number; matches: boolean; settleOk: boolean; hasErrors: boolean; swift: boolean }) {
  const diff = target - sum;
  const box = (tone: "ok" | "warn" | "bad" | "none", label: string, value: string, note: string) => (
    <div className={cn("border-t px-5 py-4", tone === "ok" ? "border-ok/30 bg-ok/[0.07]" : tone === "bad" ? "border-bad/25 bg-bad/[0.05]" : tone === "warn" ? "border-warn/30 bg-warn/[0.06]" : "border-line bg-bg")}>
      <div className={cn("lbl", tone === "ok" && "text-ok")}>{label}</div>
      {value && <div className={cn("num mt-1 text-[1.5rem] font-semibold", tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "")}>{value}</div>}
      <p className="mt-1 text-[0.75rem] text-mut">{note}</p>
    </div>
  );
  if (mode === "prepaid") {
    return received > 0
      ? box(swift ? "ok" : "warn", "Prepaid amount", money(received), swift ? "Ready to submit. Settle EXPs from it after approval." : "Attach the Swift Message to submit.")
      : box("none", "Prepaid amount", "", "Enter the amount received.");
  }
  if (mode === "settle") {
    if (!(target > 0)) return box("none", "To settle", "", "Pick a prepaid collection with money left.");
    if (hasErrors) return box("bad", "Check amounts", "", "An EXP amount is empty or above its outstanding amount.");
    if (!lines) return box("none", "Available", money(target), "Tick EXPs to settle, or use Auto fill.");
    if (diff < 0) return box("bad", "Over by", money(-diff), "The EXPs total more than the prepaid balance left.");
    return box(settleOk ? "ok" : "warn", "Settling", money(sum), diff > 0 ? `${money(diff)} prepaid stays for later EXPs.` : "Uses the whole prepaid balance.");
  }
  if (!received) return box("none", "To match", "", "Enter the amount received, then tick the EXPs it pays for.");
  if (hasErrors) return box("bad", "Check amounts", "", "An EXP amount is empty or above its outstanding amount.");
  if (!lines) return box("none", "To match", money(received), "Tick EXPs, or use Auto fill to fill them in order.");
  if (matches) return box("ok", "Totals match", money(sum), swift ? "Ready to submit." : "Ready to submit once the Swift Message is attached.");
  if (diff > 0) return box("warn", "Still to match", money(diff), "Tick more EXPs or raise an amount. Totals must match exactly.");
  return box("bad", "Over by", money(-diff), "Lower an amount or untick an EXP. Totals must match exactly.");
}
