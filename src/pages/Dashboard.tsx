import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { EXP_DOCS, actionLabel, actionTone, useActivity, useAllExps, useCollections, useDecide, useIncentives, useMe, useProfiles, useTradeActions, useTrades } from "@/lib/api";
import { followupState } from "@/components/contractPanel";
import { money, moneyShort, daysUntil, fmtDate, pct, timeAgo } from "@/lib/format";
import { isShipped } from "@/lib/expFields";
import { ApproveReject, Chip, Empty, Progress, Skeleton, cn } from "@/components/ui";

export default function Dashboard() {
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  const trades = useTrades();
  const exps = useAllExps();
  const cols = useCollections();
  const incs = useIncentives();
  const activity = useActivity(40);
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
    const noShipment = openExps.filter((e) => e.type === "advance");
    const docsPending = openExps.filter((e) => isShipped(e) && e.docs_final < (e.docs_total ?? EXP_DOCS.length));
    const uncollected = (exps.data ?? []).filter((e) => !e.collection_status && e.trade_status !== "rejected");
    const expiring = live
      .filter((t) => t.status === "active" && t.expiry_date)
      .map((t) => ({ t, d: daysUntil(t.expiry_date)! }))
      .filter((x) => x.d <= 30)
      .sort((a, b) => a.d - b.d);
    const byBuyer = new Map<string, number>();
    live.forEach((t) => byBuyer.set(t.importer_name, (byBuyer.get(t.importer_name) ?? 0) + Number(t.contract_amount)));
    const buyers = [...byBuyer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const followups = live
      .filter((t) => t.status === "active")
      .flatMap((t) => followupState(t).filter((c) => c.due).slice(-1).map((c) => ({ t, c })));
    const unsigned = live.filter((t) => t.status === "active" && t.contract_signed === false);
    return { live, contract, issued, collected, incApproved, incPending, openExps, noShipment, docsPending, uncollected, expiring, buyers, followups, unsigned };
  }, [trades.data, exps.data, incs.data]);

  const pendingTrades = (trades.data ?? []).filter((t) => t.status === "pending_approval" || (t.status === "revision_pending" && t.pending_revision_id));
  const pendingCols = (cols.data ?? []).filter((c) => c.status === "pending_approval");
  const pendingIncs = (incs.data ?? []).filter((i) => i.status === "pending_approval");
  const pendingAmounts = (exps.data ?? []).filter((e) => e.pending_amount_change_id);
  const approvals = pendingTrades.length + pendingCols.length + pendingIncs.length + pendingAmounts.length;
  const loading = trades.isLoading || exps.isLoading;
  const firstName = (me?.full_name || me?.email || "").split(/[ @.]/)[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const sumOf = (arr: { amount: number | string }[]) => arr.reduce((t, e) => t + Number(e.amount || 0), 0);
  const followupSub = s.followups.slice(0, 3).map(({ t }) => `${t.code} at ${pct(t.exp_issued, t.contract_amount)}%`).join(", ");
  const tasks: { n: number; label: string; sub: string; to: string; tone: "bad" | "warn" | "ok" }[] = [
    { n: s.docsPending.length, label: "EXPs with documents pending", sub: "Shipped, shipment documents not final", to: "/exps?filter=docs_pending", tone: "warn" },
    { n: s.uncollected.length, label: "EXPs not yet in a collection", sub: `${money(sumOf(s.uncollected))} waiting for money`, to: "/exps?filter=uncollected", tone: "warn" },
    { n: s.expiring.length, label: s.expiring.some((x) => x.d < 0) ? "Contracts expired or expiring in 30 days" : "Contracts expiring in 30 days", sub: s.expiring.slice(0, 3).map((x) => x.t.code).join(", ") || "None", to: "/trades?status=active", tone: s.expiring.some((x) => x.d < 0) ? "bad" : "warn" },
    { n: s.followups.length, label: "Shipment follow-ups due", sub: followupSub || "None", to: "/trades?status=active", tone: "warn" },
    { n: s.noShipment.length, label: "Advance EXPs waiting for shipment fields", sub: "Fill them with EXP correction", to: "/exps?filter=advance", tone: "warn" },
    { n: s.unsigned.length, label: "Active trades without a signed contract", sub: s.unsigned.length ? s.unsigned.slice(0, 3).map((t) => t.code).join(", ") : "All signed", to: "/trades?status=active", tone: "bad" },
  ];
  const stages = [
    { label: "Contract value", value: s.contract, share: `${s.live.length} trade${s.live.length === 1 ? "" : "s"}`, bar: 100, sub: `${money(s.contract - s.issued)} left to issue` },
    { label: "EXP issued", value: s.issued, share: `${pct(s.issued, s.contract)}% of contract`, bar: pct(s.issued, s.contract), sub: `${s.openExps.length} open EXPs` },
    { label: "Collected", value: s.collected, share: `${pct(s.collected, s.issued)}% of issued`, bar: pct(s.collected, s.issued), sub: `${money(s.issued - s.collected)} awaiting collection` },
    { label: "Incentive approved", value: s.incApproved, share: s.incPending ? `${money(s.incPending)} pending` : "Nothing pending", bar: pct(s.incApproved, s.collected), sub: "On collected EXPs" },
  ];

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="text-[0.8125rem] text-mut">{greet}{firstName ? `, ${firstName[0].toUpperCase() + firstName.slice(1)}` : ""}</div>
        <h1 className="h1">Dashboard</h1>
      </div>

      {loading ? <Skeleton className="h-[11rem]" /> : (
        <section className="card flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[1.0625rem] font-semibold">From contract to incentive</h2>
            <span className="text-[0.75rem] text-mut">{s.live.length} trades · {s.openExps.length} open EXPs</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {stages.map((st) => (
              <div key={st.label} className="flex min-w-0 flex-col gap-2 rounded-xl bg-bg px-4 py-3.5">
                <div className="flex items-center justify-between gap-2 text-[0.8125rem] text-mut"><span>{st.label}</span><span className="num truncate text-[0.75rem]">{st.share}</span></div>
                <span className="num truncate text-[1.5rem] font-semibold tracking-tight">{money(st.value)}</span>
                <Progress value={st.bar} />
                <span className="truncate text-[0.75rem] text-mut">{st.sub}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className={cn("grid items-stretch gap-5", isAdmin && "xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]")}>
        <section className="card overflow-hidden">
          <div className="flex items-baseline justify-between gap-2 px-5 pb-2 pt-4">
            <h2 className="text-[1.0625rem] font-semibold">Needs attention</h2>
            <span className="text-[0.75rem] text-mut">Open a row to see the list</span>
          </div>
          <ul className="flex flex-col px-2 pb-2">
            {tasks.map((k) => (
              <li key={k.label}>
                <Link to={k.to} className="flex items-center gap-3.5 rounded-lg px-3 py-2.5 transition hover:bg-bg">
                  <span className={cn("num grid h-7 min-w-10 place-items-center rounded-lg px-2 text-[0.875rem] font-semibold",
                    !k.n ? "bg-raised text-mut" : k.tone === "bad" ? "bg-bad/10 text-bad" : "bg-warn/10 text-warn")}>{k.n}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{k.label}</span>
                    <span className="block truncate text-[0.75rem] text-mut">{k.sub}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-mut" />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {isAdmin && (
          <section className="card flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-5 pb-2 pt-4">
              <h2 className="text-[1.0625rem] font-semibold">Approval queue</h2>
              {approvals > 0 && <span className="num rounded-md bg-accent px-1.5 text-[0.6875rem] font-semibold leading-[1.125rem] text-accent-fg">{approvals}</span>}
            </div>
            {approvals === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-8 text-center">
                <span className="grid size-11 place-items-center rounded-full bg-bg"><CheckCircle2 className="size-5 text-ok" /></span>
                <span className="font-semibold">All caught up</span>
                <span className="max-w-[16rem] text-[0.8125rem] text-mut">No trades, amendments, amount changes, collections or incentives waiting for you.</span>
              </div>
            ) : (
              <ul className="scroll-thin flex max-h-[26rem] flex-col divide-y divide-line overflow-y-auto">
                {pendingTrades.map((t) => (
                  <QueueRow key={t.id} kind={t.status === "pending_approval" ? "Trade" : "Amendment"} code={t.code} title={t.importer_name} amount={t.contract_amount} to={`/trades/${t.id}`} who={t.is_demo ? "Demo" : profiles[t.created_by]} when={t.updated_at}
                    actions={t.status === "pending_approval" ? <ApproveReject label={t.code} onApprove={() => ta.approveTrade(t.id)} onReject={(r) => ta.rejectTrade(t.id, r)} /> : <Link to={`/trades/${t.id}?tab=amendments`} className="btn btn-outline btn-sm">Review</Link>} />
                ))}
                {pendingAmounts.map((e) => (
                  <QueueRow key={e.id} kind="EXP amount" code={e.code} title={`${e.trade_code} · ${e.importer_name}`} amount={e.amount} to={`/exps/${e.id}`} who={undefined} when={e.created_at}
                    actions={<Link to={`/exps/${e.id}`} className="btn btn-outline btn-sm">Review</Link>} />
                ))}
                {pendingCols.map((c) => (
                  <QueueRow key={c.id} kind="Collection" code={c.code} title={`${c.trades?.code} · ${c.trades?.importer_name}`} amount={c.amount} to={`/collections/${c.id}`} who={c.is_demo ? "Demo" : profiles[c.created_by]} when={c.created_at}
                    actions={<ApproveReject label={c.code} onApprove={() => decideCol(c.id, true)} onReject={(r) => decideCol(c.id, false, r)} />} />
                ))}
                {pendingIncs.map((i) => (
                  <QueueRow key={i.id} kind="Incentive" code={i.code} title={[...new Set(i.incentive_exps.map((e) => e.exps?.trades?.code))].join(", ")} amount={i.incentive_amount} to={`/incentives/${i.id}`} who={i.is_demo ? "Demo" : profiles[i.created_by]} when={i.created_at}
                    actions={<ApproveReject label={i.code} onApprove={() => decideInc(i.id, true)} onReject={(r) => decideInc(i.id, false, r)} />} />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <MonthlyBars exps={exps.data ?? []} cols={(cols.data ?? []).filter((c) => c.status === "approved")} issued={s.issued} collected={s.collected} />

      <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section className="card overflow-hidden">
          <div className="flex items-baseline justify-between gap-2 px-5 pb-3 pt-4">
            <h2 className="text-[1.0625rem] font-semibold">Top buyers</h2>
            <Link to="/trades" className="text-[0.8125rem] font-medium text-accent">All trades</Link>
          </div>
          <BuyerTable live={s.live} />
        </section>
        <section className="card overflow-hidden">
          <div className="flex items-baseline justify-between gap-2 px-5 pb-1 pt-4">
            <h2 className="text-[1.0625rem] font-semibold">Recent activity</h2>
          </div>
          {!activity.data?.length ? <Empty title="No activity yet" /> : (
            <ol className="flex flex-col px-5 pb-3">
              {groupActivity(activity.data).slice(0, 7).map((g) => (
                <li key={g.a.id} className="grid grid-cols-[0.5rem_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-line py-2.5 text-[0.8125rem] last:border-b-0">
                  <span aria-hidden="true" className={cn("size-1.5 rounded-full", g.n > 1 ? "bg-mut/50" : "bg-accent")} />
                  <span className="min-w-0">
                    <span className="font-medium">{g.a.is_demo ? "Demo" : profiles[g.a.actor_id ?? ""] ?? "System"}</span>{" "}
                    <span className="text-mut">{actionLabel(g.a.action)}</span>{" "}
                    {g.n > 1 ? <span className="text-mut">and {g.n - 1} more</span> : g.a.details?.code ? (
                      g.a.trade_id ? <Link to={`/trades/${g.a.trade_id}`} className="code-id whitespace-nowrap font-medium hover:underline">{String(g.a.details.code)}</Link> : <span className="code-id whitespace-nowrap font-medium">{String(g.a.details.code)}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[0.75rem] text-mut">{timeAgo(g.a.created_at)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

type Act = { id: string; actor_id: string | null; action: string; is_demo: boolean; created_at: string; trade_id: string | null; details: Record<string, unknown> | null };
/** Collapses runs of the same person doing the same action (for example adding many EXPs). */
function groupActivity<T extends Act>(rows: T[]) {
  const out: { a: T; n: number }[] = [];
  for (const a of rows) {
    const last = out[out.length - 1];
    if (last && last.a.actor_id === a.actor_id && last.a.action === a.action) last.n++;
    else out.push({ a, n: 1 });
  }
  return out;
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
    return [...m.entries()].sort((a, b) => b[1].i - a[1].i || b[1].c - a[1].c).slice(0, 6);
  }, [live]);
  if (!rows.length) return <Empty title="No trades yet" />;
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="tbl min-w-[34rem]">
        <thead><tr><th>Buyer</th><th className="!text-right">Contract</th><th className="!text-right">EXP issued</th><th className="w-44">Collected of issued</th></tr></thead>
        <tbody>
          {rows.map(([name, r]) => (
            <tr key={name}>
              <td className="max-w-[16rem] truncate"><span className="font-medium">{name}</span> <span className="text-[0.75rem] text-mut">· {r.n} trade{r.n === 1 ? "" : "s"}</span></td>
              <td className="!text-right num">{money(r.c)}</td>
              <td className="!text-right num">{money(r.i)}</td>
              <td><div className="flex items-center gap-2.5"><Progress value={pct(r.col, r.i)} /><span className="num w-9 text-right text-[0.75rem]">{pct(r.col, r.i)}%</span></div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Dated = { amount?: number | string; shipment_date?: string | null; created_at?: string };
function monthly(rows: Dated[], date: (r: Dated) => string | null | undefined) {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 11 + i, 1));
  const sums = months.map(() => 0);
  rows.forEach((r) => {
    const d = date(r); if (!d) return;
    const x = new Date(d);
    const idx = (x.getFullYear() - months[0].getFullYear()) * 12 + x.getMonth() - months[0].getMonth();
    if (idx >= 0 && idx < 12) sums[idx] += Number(r.amount ?? 0);
  });
  return { labels: months.map((m) => m.toLocaleString("en", { month: "short" })), sums };
}

function MonthlyBars({ exps, cols, issued, collected }: { exps: Dated[]; cols: Dated[]; issued: number; collected: number }) {
  const data = useMemo(() => {
    const a = monthly(exps, (r) => r.shipment_date ?? r.created_at);
    const b = monthly(cols, (r) => r.created_at);
    return { labels: a.labels, issued: a.sums, collected: b.sums };
  }, [exps, cols]);
  const max = Math.max(...data.issued, ...data.collected, 1);
  const h = (v: number) => (v ? `${Math.max(1.5, (v / max) * 100)}%` : "0%");
  return (
    <section className="card flex flex-col gap-4 px-5 pb-5 pt-4" aria-label="EXP issued and collected by month">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[1.0625rem] font-semibold">EXP issued and collected, by month</h2>
        <div className="flex flex-wrap gap-4 text-[0.75rem] text-mut">
          <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-accent" />EXP issued {moneyShort(issued)}</span>
          <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-mut/40" />Collected {moneyShort(collected)}</span>
        </div>
      </div>
      <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-2">
        <div className="num flex h-44 flex-col justify-between text-right text-[0.6875rem] text-mut"><span>{moneyShort(max)}</span><span>{moneyShort(max / 2)}</span><span>$0</span></div>
        <div className="min-w-0">
          <div className="relative grid h-44 grid-cols-12 items-end gap-2 border-b border-line">
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-line" />
            {data.labels.map((l, i) => (
              <div key={i} className="flex h-full items-end justify-center gap-[3px]" title={`${l}: issued ${money(data.issued[i])}, collected ${money(data.collected[i])}`}>
                <div className="w-[40%] max-w-[1.125rem] rounded-t bg-accent" style={{ height: h(data.issued[i]) }} />
                <div className="w-[40%] max-w-[1.125rem] rounded-t bg-mut/40" style={{ height: h(data.collected[i]) }} />
              </div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-12 gap-2 text-center text-[0.6875rem] text-mut">{data.labels.map((l, i) => <span key={i}>{l}</span>)}</div>
        </div>
      </div>
    </section>
  );
}

function QueueRow({ kind, code, title, amount, to, who, when, actions }: { kind: string; code: string; title: string; amount: number | string; to: string; who?: string; when: string; actions: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-2.5 px-5 py-3">
      <Link to={to} className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={kind === "Trade" ? "info" : kind === "Amendment" ? "info" : kind === "Collection" ? "ok" : "warn"} label={kind} dot={false} />
          <span className="code-id text-[0.8125rem] font-medium">{code}</span>
          <span className="truncate text-[0.8125rem] text-mut">{title}</span>
        </div>
        <div className="mt-1 text-[0.75rem] text-mut">{who ? `${who} · ` : ""}{fmtDate(when)}</div>
      </Link>
      <div className="flex items-center justify-between gap-3"><span className="num text-[0.875rem] font-semibold">{money(amount)}</span><div className="shrink-0">{actions}</div></div>
    </li>
  );
}
