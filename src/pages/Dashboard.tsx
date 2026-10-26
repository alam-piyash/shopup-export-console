import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftRight, CheckCircle2, Coins, Ship, Wallet } from "lucide-react";
import { actionLabel, actionTone, useActivity, useAllExps, useCollections, useDecide, useIncentives, useMe, useProfiles, useTradeActions, useTrades } from "@/lib/api";
import { bdt, bdtShort, daysUntil, fmtDate, pct, timeAgo } from "@/lib/format";
import { ApproveReject, Chip, Empty, Kpi, KpiGrid, Panel, Skeleton, cn } from "@/components/ui";

export default function Dashboard() {
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  const trades = useTrades();
  const exps = useAllExps();
  const cols = useCollections();
  const incs = useIncentives();
  const activity = useActivity(14);
  const profiles = useProfiles().data ?? {};
  const ta = useTradeActions();
  const decideCol = useDecide("collection");
  const decideInc = useDecide("incentive");

  const s = useMemo(() => {
    const live = (trades.data ?? []).filter((t) => t.status !== "rejected");
    const sum = (arr: unknown[], f: (x: never) => unknown) => arr.reduce<number>((a, x) => a + Number(f(x as never) ?? 0), 0);
    const contract = sum(live, (t: { contract_amount: number }) => t.contract_amount);
    const issued = sum(live, (t: { exp_issued: number }) => t.exp_issued);
    const collected = sum(live, (t: { collected: number }) => t.collected);
    const incApproved = sum((incs.data ?? []).filter((i) => i.status === "approved"), (i: { incentive_amount: number }) => i.incentive_amount);
    const incPending = sum((incs.data ?? []).filter((i) => i.status === "pending_approval"), (i: { incentive_amount: number }) => i.incentive_amount);
    const openExps = (exps.data ?? []).filter((e) => e.status === "open");
    const noShipment = openExps.filter((e) => !e.shipment_id);
    const docsPending = openExps.filter((e) => e.shipment_id && e.docs_final < 6);
    const uncollected = (exps.data ?? []).filter((e) => !e.collection_status && e.trade_status !== "rejected");
    const expiring = live
      .filter((t) => t.status === "active" && t.expiry_date)
      .map((t) => ({ t, d: daysUntil(t.expiry_date)! }))
      .filter((x) => x.d <= 30)
      .sort((a, b) => a.d - b.d);
    const byBuyer = new Map<string, number>();
    live.forEach((t) => byBuyer.set(t.importer_name, (byBuyer.get(t.importer_name) ?? 0) + Number(t.contract_amount)));
    const buyers = [...byBuyer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { live, contract, issued, collected, incApproved, incPending, openExps, noShipment, docsPending, uncollected, expiring, buyers };
  }, [trades.data, exps.data, incs.data]);

  const pendingTrades = (trades.data ?? []).filter((t) => t.status === "pending_approval" || (t.status === "revision_pending" && t.pending_revision_id));
  const pendingCols = (cols.data ?? []).filter((c) => c.status === "pending_approval");
  const pendingIncs = (incs.data ?? []).filter((i) => i.status === "pending_approval");
  const approvals = pendingTrades.length + pendingCols.length + pendingIncs.length;
  const loading = trades.isLoading || exps.isLoading;
  const firstName = (me?.full_name || me?.email || "").split(/[ @.]/)[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[0.8125rem] text-mut">{greet}{firstName ? `, ${firstName[0].toUpperCase() + firstName.slice(1)}` : ""}</div>
          <h1 className="h1 mt-1">Dashboard</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/collections/new" className="btn btn-outline">New collection</Link>
          <Link to="/trades/new" className="btn btn-primary">Create trade</Link>
        </div>
      </div>

      {loading ? (
        <KpiGrid>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[7.5rem]" />)}</KpiGrid>
      ) : (
        <KpiGrid>
          <Kpi label="Contract value" value={bdtShort(s.contract)} icon={<ArrowLeftRight />} sub={`${s.live.length} trades · ${bdt(s.contract)}`} />
          <Kpi label="EXP issued" value={bdtShort(s.issued)} icon={<Ship />} sub={`${pct(s.issued, s.contract)}% of contract value`} />
          <Kpi label="Collected" value={bdtShort(s.collected)} icon={<Wallet />} sub={`${pct(s.collected, s.issued)}% of EXP issued`} />
          <Kpi label="Incentive approved" value={bdtShort(s.incApproved)} icon={<Coins />} sub={s.incPending ? `${bdtShort(s.incPending)} pending` : "Nothing pending"} />
        </KpiGrid>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Panel title="Top buyers" right={<Link to="/trades" className="text-[0.7812rem] text-mut hover:text-fg">All trades</Link>}>
          <BuyerTable live={s.live} />
        </Panel>
        <Panel title="Money flow">
          <div className="flex flex-col px-4 py-3 text-[0.8125rem]">
            <div className="pb-1 text-[0.75rem] text-mut">Contracts</div>
            <Line label="Contract value" v={s.contract} />
            <Line label="EXP issued" v={s.issued} />
            <Line label="Left to issue" v={s.contract - s.issued} />
            <div className="my-2 h-px bg-line" />
            <div className="pb-1 text-[0.75rem] text-mut">Money in</div>
            <Line label="Collected" v={s.collected} />
            <Line label="Awaiting collection" v={s.issued - s.collected} />
            <Line label="Incentive approved" v={s.incApproved} />
            <div className="my-2 h-px bg-line" />
            <div className="flex justify-between py-1 font-semibold"><span>Open EXPs</span><span className="num">{s.openExps.length}</span></div>
          </div>
        </Panel>
      </div>

      <TrendCard trades={s.live} exps={exps.data ?? []} cols={(cols.data ?? []).filter((c) => c.status === "approved")} totals={{ contract: s.contract, issued: s.issued, collected: s.collected }} />

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Needs attention">
          <ul className="divide-y divide-line/70">
            <Attn label="Advance EXPs without shipment ID" n={s.noShipment.length} to="/exps?filter=no_shipment" />
            <Attn label="EXPs with documents pending" n={s.docsPending.length} to="/exps?filter=docs_pending" />
            <Attn label="EXPs not yet in a collection" n={s.uncollected.length} to="/exps?filter=uncollected" />
            <Attn label="Contracts expiring in 30 days" n={s.expiring.length} to="/trades?status=active" />
          </ul>
          {s.expiring.length > 0 && (
            <div className="border-t border-line px-4 py-3">
              <div className="mb-1.5 text-[0.75rem] text-mut">Expiring soon</div>
              {s.expiring.slice(0, 4).map(({ t, d }) => (
                <Link key={t.id} to={`/trades/${t.id}`} className="flex items-center justify-between py-1.5 text-[0.8125rem] hover:underline">
                  <span className="truncate"><span className="num font-medium">{t.code}</span> · {t.importer_name}</span>
                  <Chip tone={d < 0 ? "bad" : d <= 7 ? "warn" : "gray"} label={d < 0 ? `Expired ${-d}d ago` : `${d}d left`} dot={false} />
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Recent activity">
          {!activity.data?.length ? (
            <Empty title="No activity yet" />
          ) : (
            <ol className="scroll-thin flex max-h-[22rem] flex-col overflow-y-auto">
              {activity.data.map((a) => (
                <li key={a.id} className="flex items-baseline justify-between gap-3 border-b border-line/70 px-4 py-2.5 text-[0.8125rem] last:border-b-0">
                  <div className="min-w-0">
                    <span className="font-medium">{a.is_demo ? "Demo" : profiles[a.actor_id ?? ""] ?? "System"}</span>{" "}
                    <span className="text-mut">{actionLabel(a.action)}</span>{" "}
                    {a.details?.code ? (
                      a.trade_id ? <Link to={`/trades/${a.trade_id}`} className="num font-medium hover:underline">{String(a.details.code)}</Link> : <span className="num font-medium">{String(a.details.code)}</span>
                    ) : null}
                    {a.details?.doc ? <span className="text-mut"> · {String(a.details.doc)}</span> : null}
                  </div>
                  <span className="shrink-0 text-[0.75rem] text-mut">{timeAgo(a.created_at)}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      {isAdmin && (
        <Panel title={<span className="flex items-center gap-2">Approval queue {approvals > 0 && <span className="num rounded-md bg-fg px-1.5 text-[0.6875rem] leading-[1.125rem] text-bg">{approvals}</span>}</span>}>
          {approvals === 0 ? (
            <Empty icon={<CheckCircle2 />} title="All caught up" body="No trades, amendments, collections or incentives are waiting for you." />
          ) : (
            <ul className="divide-y divide-line/70">
              {pendingTrades.map((t) => (
                <QueueRow
                  key={t.id}
                  kind={t.status === "pending_approval" ? "Trade" : "Amendment"}
                  code={t.code}
                  title={t.importer_name}
                  amount={t.contract_amount}
                  to={`/trades/${t.id}`}
                  who={t.is_demo ? "Demo" : profiles[t.created_by]}
                  when={t.updated_at}
                  actions={
                    t.status === "pending_approval" ? (
                      <ApproveReject label={t.code} onApprove={() => ta.approveTrade(t.id)} onReject={(r) => ta.rejectTrade(t.id, r)} />
                    ) : (
                      <Link to={`/trades/${t.id}?tab=amendments`} className="btn btn-outline btn-sm">Review</Link>
                    )
                  }
                />
              ))}
              {pendingCols.map((c) => (
                <QueueRow key={c.id} kind="Collection" code={c.code} title={`${c.trades?.code} · ${c.trades?.importer_name}`} amount={c.amount} to="/collections?status=pending_approval" who={c.is_demo ? "Demo" : profiles[c.created_by]} when={c.created_at}
                  actions={<ApproveReject label={c.code} onApprove={() => decideCol(c.id, true)} onReject={(r) => decideCol(c.id, false, r)} />} />
              ))}
              {pendingIncs.map((i) => (
                <QueueRow key={i.id} kind="Incentive" code={i.code} title={[...new Set(i.incentive_exps.map((e) => e.exps?.trades?.code))].join(", ")} amount={i.incentive_amount} to="/incentives?status=pending_approval" who={i.is_demo ? "Demo" : profiles[i.created_by]} when={i.created_at}
                  actions={<ApproveReject label={i.code} onApprove={() => decideInc(i.id, true)} onReject={(r) => decideInc(i.id, false, r)} />} />
              ))}
            </ul>
          )}
        </Panel>
      )}
    </>
  );
}

function Line({ label, v }: { label: string; v: number }) {
  return <div className="flex justify-between gap-3 py-1"><span className="text-fg/85">{label}</span><span className="num">{bdt(v)}</span></div>;
}

function Attn({ label, n, to }: { label: string; n: number; to: string }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 px-4 py-2.5 text-[0.8125rem] transition hover:bg-raised/60">
        <span className="flex-1">{label}</span>
        <span className={cn("num font-semibold", n ? "" : "text-mut")}>{n}</span>
      </Link>
    </li>
  );
}

type LiveTrade = { importer_name: string; contract_amount: number | string; exp_issued: number | string; collected: number | string };
function BuyerTable({ live }: { live: LiveTrade[] }) {
  const rows = useMemo(() => {
    const m = new Map<string, { n: number; c: number; i: number; col: number }>();
    live.forEach((t) => {
      const r = m.get(t.importer_name) ?? { n: 0, c: 0, i: 0, col: 0 };
      r.n += 1; r.c += Number(t.contract_amount); r.i += Number(t.exp_issued); r.col += Number(t.collected);
      m.set(t.importer_name, r);
    });
    return [...m.entries()].sort((a, b) => b[1].c - a[1].c).slice(0, 6);
  }, [live]);
  if (!rows.length) return <Empty title="No trades yet" />;
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="tbl min-w-[40rem]">
        <thead><tr><th>Buyer</th><th className="r">Trades</th><th className="r">Contract value</th><th className="r">EXP issued</th><th className="r">Collected</th><th className="r">Collected of issued</th></tr></thead>
        <tbody>
          {rows.map(([name, r]) => (
            <tr key={name}>
              <td className="max-w-[14rem] truncate">{name}</td>
              <td className="r num">{r.n}</td>
              <td className="r num">{bdt(r.c)}</td>
              <td className="r num">{bdt(r.i)}</td>
              <td className="r num">{bdt(r.col)}</td>
              <td className="r num">{pct(r.col, r.i)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Dated = { amount?: number | string; contract_amount?: number | string; shipment_date?: string | null; contract_date?: string | null; created_at?: string };
function monthly(rows: Dated[], val: (r: Dated) => number, date: (r: Dated) => string | null | undefined) {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 11 + i, 1));
  const sums = months.map(() => 0);
  rows.forEach((r) => {
    const d = date(r); if (!d) return;
    const x = new Date(d);
    const idx = (x.getFullYear() - months[0].getFullYear()) * 12 + x.getMonth() - months[0].getMonth();
    if (idx >= 0 && idx < 12) sums[idx] += val(r);
  });
  return { labels: months.map((m) => m.toLocaleString("en", { month: "short" })), sums };
}

function TrendCard({ trades, exps, cols, totals }: { trades: Dated[]; exps: Dated[]; cols: Dated[]; totals: { contract: number; issued: number; collected: number } }) {
  const [tab, setTab] = useState<"contract" | "issued" | "collected">("issued");
  const series = useMemo(() => ({
    contract: monthly(trades, (r) => Number(r.contract_amount ?? 0), (r) => r.contract_date ?? r.created_at),
    issued: monthly(exps, (r) => Number(r.amount ?? 0), (r) => r.shipment_date ?? r.created_at),
    collected: monthly(cols, (r) => Number(r.amount ?? 0), (r) => r.created_at),
  }), [trades, exps, cols]);
  const { labels, sums } = series[tab];
  const max = Math.max(...sums, 1);
  const W = 1000, H = 200, pad = 8;
  const pts = sums.map((v, i) => [pad + (i * (W - 2 * pad)) / 11, H - 10 - (v / max) * (H - 30)] as const);
  const line = pts.map(([x, y], i) => {
    if (i === 0) return `M${x},${y}`;
    const [px, py] = pts[i - 1]; const cx = (px + x) / 2;
    return `C${cx},${py} ${cx},${y} ${x},${y}`;
  }).join(" ");
  const area = `${line} L${pts[11][0]},${H} L${pts[0][0]},${H} Z`;
  const tabs = [
    { k: "contract" as const, label: "Contract value", v: totals.contract },
    { k: "issued" as const, label: "EXP issued", v: totals.issued },
    { k: "collected" as const, label: "Collected", v: totals.collected },
  ];
  return (
    <div className="card overflow-hidden">
      <div className="grid border-b border-line sm:grid-cols-[1.2fr_repeat(3,1fr)]">
        <div className="flex items-center px-4 py-3 text-[0.9375rem] font-semibold">Last 12 months</div>
        {tabs.map((t) => (
          <button key={t.k} type="button" onClick={() => setTab(t.k)} className={cn("border-t border-line px-4 py-3 text-left transition sm:border-l sm:border-t-0", tab === t.k ? "bg-raised" : "hover:bg-raised/50")}>
            <div className="text-[0.8125rem] text-fg/80">{t.label}</div>
            <div className="num mt-0.5 text-[1.25rem] font-semibold tracking-tight">{bdtShort(t.v)}</div>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2 px-4 pb-3 pt-5">
        <div className="num flex h-[12.5rem] flex-col justify-between text-right text-[0.6875rem] text-mut">
          <span>{bdtShort(max)}</span><span>{bdtShort(max * 0.66)}</span><span>{bdtShort(max * 0.33)}</span><span>৳0</span>
        </div>
        <div className="min-w-0">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[12.5rem] w-full" role="img" aria-label={`${tabs.find((t) => t.k === tab)?.label} by month`}>
            <defs><linearGradient id="trendfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgb(var(--fg))" stopOpacity=".22" /><stop offset="1" stopColor="rgb(var(--fg))" stopOpacity="0" /></linearGradient></defs>
            {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgb(var(--line))" vectorEffect="non-scaling-stroke" />)}
            <path d={area} fill="url(#trendfill)" />
            <path d={line} fill="none" stroke="rgb(var(--fg))" strokeOpacity=".85" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="mt-2 grid grid-cols-12 text-center text-[0.6875rem] text-mut">{labels.map((l, i) => <span key={i}>{l}</span>)}</div>
        </div>
      </div>
    </div>
  );
}

function QueueRow({ kind, code, title, amount, to, who, when, actions }: { kind: string; code: string; title: string; amount: number | string; to: string; who?: string; when: string; actions: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <Link to={to} className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={kind === "Trade" ? "info" : kind === "Amendment" ? "info" : kind === "Collection" ? "ok" : "warn"} label={kind} dot={false} />
          <span className="num text-[0.8125rem] font-medium">{code}</span>
          <span className="truncate text-[0.8125rem] text-mut">{title}</span>
        </div>
        <div className="mt-1 text-[0.75rem] text-mut">{who ? `${who} · ` : ""}{fmtDate(when)}</div>
      </Link>
      <span className="num text-[0.875rem] font-semibold sm:w-32 sm:text-right">{bdt(amount)}</span>
      <div className="shrink-0">{actions}</div>
    </li>
  );
}
