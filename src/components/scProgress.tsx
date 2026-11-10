import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Plus, X } from "lucide-react";
import { useAllExps, useTrades } from "@/lib/api";
import { money, pct } from "@/lib/format";
import { expNumber } from "@/lib/expFields";
import { Button, Chip, cn } from "./ui";
import { TradePicker } from "./pickers";

/**
 * Look up a trade by SC number and see where its EXPs stand.
 * incentive: collected, claimed and approved. collection: EXPs still due for money.
 */
export function ScProgress({ mode }: { mode: "incentive" | "collection" }) {
  const { data: trades } = useTrades();
  const { data: exps } = useAllExps();
  const [tradeId, setTradeId] = useState("");
  const trade = trades?.find((t) => t.id === tradeId);
  const list = useMemo(() => (exps ?? []).filter((e) => e.trade_id === tradeId), [exps, tradeId]);
  const sum = (arr: typeof list) => arr.reduce((s, e) => s + Number(e.amount || 0), 0);

  const collected = list.filter((e) => e.collection_status === "approved");
  const collPending = list.filter((e) => e.collection_status === "pending_approval");
  const due = list.filter((e) => !e.collection_status);
  const incApproved = list.filter((e) => e.incentive_status === "approved");
  const incPending = list.filter((e) => e.incentive_status === "pending_approval");
  const claimable = collected.filter((e) => !e.incentive_status);

  const buckets = [
    { label: "Claimed and approved", arr: incApproved, bar: "bg-ok", box: "border-ok/35 bg-ok/[0.05]" },
    { label: "Claimed, awaiting approval", arr: incPending, bar: "bg-warn", box: "border-warn/40 bg-warn/[0.06]" },
    { label: "Not yet claimed", arr: claimable, bar: "bg-mut/50", box: "border-line bg-bg" },
  ];

  const stat = (label: string, arr: typeof list, tone?: string) => (
    <div className="rounded-xl border border-line bg-bg px-3.5 py-3">
      <div className="text-[0.75rem] text-mut">{label}</div>
      <div className={`num mt-0.5 text-[1.125rem] font-semibold ${tone ?? ""}`}>{arr.length}</div>
      <div className="num text-[0.75rem] text-mut">{money(sum(arr))}</div>
    </div>
  );

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[0.9375rem] font-semibold">{mode === "incentive" ? "Claim progress by SC number" : "EXPs due by SC number"}</h2>
          <p className="text-[0.75rem] text-mut">{mode === "incentive" ? "Search a sales contract to see how much of it is collected, claimed and approved." : "Search a sales contract to see the EXPs still waiting for money."}</p>
        </div>
        <div className="w-full sm:w-96">
          <TradePicker trades={trades ?? []} value={tradeId} onChange={setTradeId} placeholder="Type an SC number, trade code or buyer" />
        </div>
        {tradeId && <Button size="sm" variant="ghost" onClick={() => setTradeId("")}><X /> Clear</Button>}
      </div>

      {trade && (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
            <Link to={`/trades/${trade.id}`} className="code-id font-medium hover:underline">{trade.code}</Link>
            <span className="code-id text-mut">SC {trade.sales_contract_no}</span>
            <span className="text-mut">· {trade.importer_name}</span>
            <Chip status={trade.status} />
            <span className="ml-auto text-mut">Contract <span className="num font-medium text-fg">{money(trade.contract_amount)}</span> · {list.length} EXPs</span>
          </div>

          {mode === "incentive" ? (
            <>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto_1.4fr] sm:items-stretch">
                <div className="rounded-xl border border-line bg-bg px-3.5 py-3">
                  <div className="text-[0.75rem] text-mut">EXPs on this contract</div>
                  <div className="num mt-0.5 text-[1.125rem] font-semibold">{list.length} <span className="text-[0.8125rem] font-normal text-mut">· {money(sum(list))}</span></div>
                  <div className="num text-[0.75rem] text-mut">{due.length + collPending.length} not collected yet · {money(sum(due) + sum(collPending))}</div>
                </div>
                <div className="hidden items-center text-mut sm:flex"><ChevronRight className="size-4" /></div>
                <div className="rounded-xl border border-ok/40 bg-ok/[0.06] px-3.5 py-3">
                  <div className="text-[0.75rem] font-medium text-ok">Collected, can be claimed</div>
                  <div className="num mt-0.5 text-[1.125rem] font-semibold">{collected.length} <span className="text-[0.8125rem] font-normal text-mut">· {money(sum(collected))}</span></div>
                  <div className="text-[0.75rem] text-mut">The three buckets below add up to this.</div>
                </div>
              </div>
              <div>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line">
                  {buckets.map((b) => <div key={b.label} className={b.bar} style={{ width: `${pct(sum(b.arr), sum(collected))}%` }} />)}
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {buckets.map((b) => (
                    <div key={b.label} className={cn("rounded-xl border px-3.5 py-3", b.box)}>
                      <div className="flex items-center gap-1.5 text-[0.75rem] font-medium"><i className={cn("size-2 rounded-full", b.bar)} />{b.label}</div>
                      <div className="num mt-0.5 text-[1.125rem] font-semibold">{b.arr.length} <span className="text-[0.8125rem] font-normal text-mut">· {money(sum(b.arr))}</span></div>
                      <div className="num text-[0.75rem] text-mut">{pct(sum(b.arr), sum(collected))}% of collected</div>
                    </div>
                  ))}
                </div>
              </div>
              {claimable.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[0.8125rem]">
                  <span>{claimable.length} collected EXP{claimable.length === 1 ? "" : "s"} not yet claimed: <span className="code-id text-mut">{claimable.slice(0, 6).map((e) => e.code).join(", ")}{claimable.length > 6 ? ` +${claimable.length - 6}` : ""}</span></span>
                  <Link to="/incentives/new" className="btn btn-primary btn-sm"><Plus /> New incentive</Link>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {stat("Due for collection", due, "text-warn")}
                {stat("Collection pending approval", collPending)}
                {stat("Collected", collected, "text-ok")}
              </div>
              {due.length > 0 ? (
                <div className="rounded-xl border border-line">
                  <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5 text-[0.8125rem]">
                    <span className="font-medium">EXPs due ({due.length})</span>
                    {["active", "revision_pending"].includes(trade.status) && <Link to={`/collections/new?trade=${trade.id}`} className="btn btn-primary btn-sm"><Plus /> New collection</Link>}
                  </div>
                  <div className="scroll-thin max-h-72 overflow-y-auto">
                    <table className="tbl">
                      <thead><tr>{["EXP", "EXP number", "Invoice", "Status", "Amount Inv"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                      <tbody>
                        {due.map((e) => (
                          <tr key={e.id}>
                            <td><Link to={`/exps/${e.id}`} className="code-id font-medium hover:underline">{e.code}</Link></td>
                            <td className="code-id">{expNumber(e)}</td>
                            <td className="code-id">{e.invoice_no ?? ""}</td>
                            <td><Chip status={e.status} /></td>
                            <td className="num">{money(e.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="text-[0.8125rem] text-mut">Nothing due on this contract.</p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
