import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeftRight, ArrowRight, CalendarClock, CheckCircle2, Coins, FileWarning, Plus, Ship, Wallet } from "lucide-react";
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

  const flow = [
    { label: "Contracted", v: s.contract, tone: "bg-accent" },
    { label: "EXP issued", v: s.issued, tone: "bg-info" },
    { label: "Collected", v: s.collected, tone: "bg-ok" },
    { label: "Incentive approved", v: s.incApproved, tone: "bg-warn" },
  ];
  const maxFlow = Math.max(...flow.map((f) => f.v), 1);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-mut">{greet}{firstName ? `, ${firstName[0].toUpperCase() + firstName.slice(1)}` : ""}</div>
          <h1 className="h1 mt-1">Export overview</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/collections/new" className="btn btn-outline"><Wallet /> New collection</Link>
          <Link to="/trades/new" className="btn btn-primary"><Plus /> Create trade</Link>
        </div>
      </div>

      {loading ? (
        <KpiGrid>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[7.875rem]" />)}</KpiGrid>
      ) : (
        <KpiGrid>
          <Kpi label="Contract value" value={bdtShort(s.contract)} icon={<ArrowLeftRight />} tone="info" sub={`${s.live.length} trades · ${bdt(s.contract)}`} />
          <Kpi label="EXP issued" value={bdtShort(s.issued)} icon={<Ship />} tone="info" sub={`${pct(s.issued, s.contract)}% of contract value`} />
          <Kpi label="Collected" value={bdtShort(s.collected)} icon={<Wallet />} tone="ok" sub={`${pct(s.collected, s.issued)}% of EXP issued`} />
          <Kpi label="Incentive approved" value={bdtShort(s.incApproved)} icon={<Coins />} tone="warn" sub={s.incPending ? `${bdtShort(s.incPending)} pending` : "Nothing pending"} />
        </KpiGrid>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Money flow" right={<span className="text-[0.75rem] text-mut">All live trades, BDT</span>}>
          <div className="flex flex-col gap-4 p-5">
            {flow.map((f, i) => (
              <div key={f.label} className="grid grid-cols-[120px_1fr_auto] items-center gap-4 sm:grid-cols-[150px_1fr_auto]">
                <div className="text-[0.8125rem] text-mut">{f.label}</div>
                <div className="h-8 overflow-hidden rounded-lg bg-raised">
                  <div className={cn("flex h-full items-center rounded-lg px-2.5 transition-all duration-700", f.tone)} style={{ width: `${Math.max(2, (f.v / maxFlow) * 100)}%`, opacity: 0.85 }}>
                    {i > 0 && flow[i - 1].v > 0 && (f.v / maxFlow) > 0.18 && (
                      <span className="num hidden text-[0.6875rem] font-semibold text-black/70 sm:inline">{pct(f.v, flow[i - 1].v)}%</span>
                    )}
                  </div>
                </div>
                <div className="num w-24 text-right text-[0.8125rem] font-medium">{bdtShort(f.v)}</div>
              </div>
            ))}
            <div className="mt-1 grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-3">
              <Mini label="Left to issue" value={bdtShort(s.contract - s.issued)} />
              <Mini label="Awaiting collection" value={bdtShort(s.issued - s.collected)} />
              <Mini label="Open EXPs" value={String(s.openExps.length)} />
            </div>
          </div>
        </Panel>

        <Panel title="Needs attention" right={<AlertTriangle className="size-4 text-warn" />}>
          <ul className="divide-y divide-line/70">
            <Attn icon={<Ship />} label="Advance EXPs without shipment ID" n={s.noShipment.length} to="/exps?filter=no_shipment" />
            <Attn icon={<FileWarning />} label="EXPs with documents pending" n={s.docsPending.length} to="/exps?filter=docs_pending" />
            <Attn icon={<Wallet />} label="EXPs not yet in a collection" n={s.uncollected.length} to="/exps?filter=uncollected" />
            <Attn icon={<CalendarClock />} label="Contracts expiring in 30 days" n={s.expiring.length} to="/trades?status=active" />
          </ul>
          {s.expiring.length > 0 && (
            <div className="border-t border-line p-4">
              <div className="lbl mb-2">Expiring soon</div>
              {s.expiring.slice(0, 4).map(({ t, d }) => (
                <Link key={t.id} to={`/trades/${t.id}`} className="flex items-center justify-between py-1.5 text-[0.8125rem] hover:text-accent">
                  <span className="truncate"><span className="num">{t.code}</span> · {t.importer_name}</span>
                  <Chip tone={d < 0 ? "bad" : d <= 7 ? "warn" : "gray"} label={d < 0 ? `Expired ${-d}d ago` : `${d}d left`} dot={false} />
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        {isAdmin ? (
          <Panel title={<span className="flex items-center gap-2">Approval queue {approvals > 0 && <span className="num rounded-full bg-warn/15 px-2 py-0.5 text-[0.6875rem] text-warn">{approvals}</span>}</span>}>
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
        ) : (
          <Panel title="Top buyers by contract value">
            <BuyerBars buyers={s.buyers} />
          </Panel>
        )}

        <Panel title="Recent activity" right={<Link to="/trades" className="text-[0.7812rem] text-mut hover:text-fg">All trades</Link>}>
          {!activity.data?.length ? (
            <Empty title="No activity yet" />
          ) : (
            <ol className="scroll-thin max-h-[26.25rem] overflow-y-auto p-4">
              {activity.data.map((a, i) => (
                <li key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < activity.data.length - 1 && <span className="absolute left-[0.3125rem] top-4 h-full w-px bg-line" />}
                  <span className={cn("relative mt-1.5 size-[0.6875rem] shrink-0 rounded-full border-2 border-surface", { ok: "bg-ok", bad: "bg-bad", warn: "bg-warn", info: "bg-info", gray: "bg-mut" }[actionTone(a.action)])} />
                  <div className="min-w-0 text-[0.8125rem]">
                    <span className="font-medium">{a.is_demo ? "Demo" : profiles[a.actor_id ?? ""] ?? "System"}</span>{" "}
                    <span className="text-mut">{actionLabel(a.action)}</span>{" "}
                    {a.details?.code ? (
                      a.trade_id ? <Link to={`/trades/${a.trade_id}`} className="num hover:text-accent">{String(a.details.code)}</Link> : <span className="num">{String(a.details.code)}</span>
                    ) : null}
                    {a.details?.doc ? <span className="text-mut"> · {String(a.details.doc)}</span> : null}
                    <div className="text-[0.7188rem] text-mut">{timeAgo(a.created_at)}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      {isAdmin && (
        <Panel title="Top buyers by contract value">
          <BuyerBars buyers={s.buyers} />
        </Panel>
      )}
    </>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="lbl">{label}</div>
      <div className="num mt-1 text-[1rem] font-semibold">{value}</div>
    </div>
  );
}

function Attn({ icon, label, n, to }: { icon: React.ReactNode; label: string; n: number; to: string }) {
  return (
    <li>
      <Link to={to} className="group flex items-center gap-3 px-4 py-3 transition hover:bg-raised/60">
        <span className={cn("grid size-8 place-items-center rounded-lg [&_svg]:size-4", n ? "chip-warn" : "bg-raised text-mut")}>{icon}</span>
        <span className="flex-1 text-[0.8438rem]">{label}</span>
        <span className={cn("num text-[0.9375rem] font-semibold", n ? "" : "text-mut")}>{n}</span>
        <ArrowRight className="size-4 text-mut opacity-0 transition group-hover:opacity-100" />
      </Link>
    </li>
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

function BuyerBars({ buyers }: { buyers: [string, number][] }) {
  if (!buyers.length) return <Empty title="No trades yet" />;
  const max = buyers[0][1] || 1;
  return (
    <ul className="flex flex-col gap-3.5 p-5">
      {buyers.map(([name, v]) => (
        <li key={name}>
          <div className="mb-1.5 flex justify-between gap-3 text-[0.8125rem]">
            <span className="truncate">{name}</span>
            <span className="num text-mut">{bdtShort(v)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-gradient-to-r from-accent to-info" style={{ width: `${(v / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
