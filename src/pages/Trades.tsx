import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeftRight, ChevronRight, Download, Plus, Search } from "lucide-react";
import { useIsAdmin, useTradeActions, useTrades } from "@/lib/api";
import { bdt, bdtShort, downloadCsv, fmtDate, pct } from "@/lib/format";
import type { Trade } from "@/lib/types";
import { ApproveReject, Button, Chip, Empty, Input, Kpi, KpiGrid, LoadingRows, Money, PageHeader, Panel, Progress, Segments } from "@/components/ui";

type Filter = "all" | "awaiting" | "active" | "revision_pending" | "closed" | "rejected";

export function TradeApprovals({ t }: { t: Trade }) {
  const isAdmin = useIsAdmin();
  const a = useTradeActions();
  if (!isAdmin) return null;
  if (t.status === "pending_approval") return <ApproveReject label={t.code} onApprove={() => a.approveTrade(t.id)} onReject={(r) => a.rejectTrade(t.id, r)} />;
  if (t.status === "revision_pending" && t.pending_revision_id)
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <Link to={`/trades/${t.id}?tab=amendments`} className="btn btn-outline btn-sm">Review amendment</Link>
      </div>
    );
  return null;
}

export default function Trades() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = (params.get("status") as Filter) || "all";
  const setFilter = (f: Filter) => setParams(f === "all" ? {} : { status: f }, { replace: true });
  const [q, setQ] = useState("");
  const { data, isLoading } = useTrades();
  const rows = data ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    rows.forEach((r) => (c[r.status] = (c[r.status] ?? 0) + 1));
    return c;
  }, [rows]);
  const live = rows.filter((r) => r.status !== "rejected");
  const sum = (f: (r: Trade) => unknown) => live.reduce((s, r) => s + Number(f(r) ?? 0), 0);
  const sumUsd = (f: (r: Trade) => unknown) => (live.some((r) => f(r) != null) ? sum(f) : null);
  const kpi = {
    contract: sum((r) => r.contract_amount),
    contractUsd: sumUsd((r) => r.contract_amount_usd),
    exp: sum((r) => r.exp_issued),
    expUsd: sumUsd((r) => r.exp_issued_usd),
    collected: sum((r) => r.collected),
    collectedUsd: sumUsd((r) => r.collected_usd),
    awaiting: (counts.pending_approval ?? 0) + (counts.revision_pending ?? 0),
  };
  const ql = q.toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === "all" || (filter === "awaiting" ? r.status === "pending_approval" || r.status === "revision_pending" : r.status === filter)) &&
      (!q || [r.code, r.importer_name, r.products, r.sales_contract_no, r.importer_country].some((v) => v?.toLowerCase().includes(ql))),
  );
  const open = (t: Trade) => navigate(`/trades/${t.id}`);
  const exportCsv = () =>
    downloadCsv(
      `trades-${new Date().toISOString().slice(0, 10)}.csv`,
      shown.map((t) => ({
        Code: t.code, "SC number": t.sales_contract_no, "Contract date": t.contract_date, Buyer: t.importer_name, Country: t.importer_country,
        Products: t.products, "Contract BDT": t.contract_amount, "Contract USD": t.contract_amount_usd ?? "", "EXP issued BDT": t.exp_issued,
        "Collected BDT": t.collected, EXPs: t.exp_count, Status: t.status, Expiry: t.expiry_date ?? "",
      })),
    );

  return (
    <>
      <PageHeader
        title="Trades"
        sub="One sales contract per trade. EXPs, collections and incentives follow approved trades."
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} disabled={!shown.length}><Download /> Export</Button>
            <Link to="/trades/new" className="btn btn-primary"><Plus /> Create trade</Link>
          </>
        }
      />
      <KpiGrid>
        <Kpi label="Contract value" value={bdtShort(kpi.contract)} usdValue={kpi.contractUsd} sub={`${live.length} trades`} />
        <Kpi label="EXP issued" value={bdtShort(kpi.exp)} usdValue={kpi.expUsd} sub={kpi.contract ? `${pct(kpi.exp, kpi.contract)}% of contract value` : "No contracts yet"} />
        <Kpi label="Collected" value={bdtShort(kpi.collected)} usdValue={kpi.collectedUsd} sub={kpi.exp ? `${pct(kpi.collected, kpi.exp)}% of EXP issued` : "Nothing collected yet"} />
        <Kpi label="Awaiting approval" value={kpi.awaiting} sub="Trades and amendments" />
      </KpiGrid>

      <Panel
        title={
          <Segments
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All", count: rows.length },
              { value: "awaiting", label: "Awaiting", count: kpi.awaiting },
              { value: "active", label: "Active", count: counts.active ?? 0 },
              { value: "closed", label: "Closed", count: counts.closed ?? 0 },
              { value: "rejected", label: "Rejected", count: counts.rejected ?? 0 },
            ]}
          />
        }
        right={
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mut" />
            <Input className="pl-9" placeholder="Search code, buyer, SC" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        }
      >
        {isLoading ? (
          <LoadingRows />
        ) : shown.length === 0 ? (
          <Empty
            icon={<ArrowLeftRight />}
            title={rows.length ? "No trades match" : "No trades yet"}
            body={rows.length ? "Try another filter or search." : "Create the first trade from a signed sales contract. It goes to an admin for approval."}
            action={!rows.length && <Link to="/trades/new" className="btn btn-primary"><Plus /> Create trade</Link>}
          />
        ) : (
          <>
            <div className="scroll-thin hidden overflow-x-auto md:block">
              <table className="tbl min-w-[56.25rem]">
                <thead>
                  <tr>{["Trade", "Buyer", "Contract", "EXP issued", "Collected", "Status", ""].map((h) => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {shown.map((t) => {
                    const p = pct(t.exp_issued, t.contract_amount);
                    return (
                      <tr key={t.id} className="cursor-pointer" onClick={() => open(t)}>
                        <td>
                          <div className="num font-medium">{t.code}</div>
                          <div className="text-[0.75rem] text-mut">SC {t.sales_contract_no} · {fmtDate(t.contract_date)}</div>
                        </td>
                        <td className="max-w-[15rem]">
                          <div className="flex items-center gap-2 truncate font-medium">{t.importer_name}{t.is_demo && <Chip label="Demo" tone="gray" dot={false} />}</div>
                          <div className="truncate text-[0.75rem] text-mut">{t.importer_country} · {t.products}</div>
                        </td>
                        <td><Money bdt={t.contract_amount} usd={t.contract_amount_usd} /></td>
                        <td>
                          <div className="flex items-center gap-3">
                            <Money bdt={t.exp_issued} usd={t.exp_issued_usd} />
                            <Progress value={p} className="w-16" />
                          </div>
                        </td>
                        <td><Money bdt={t.collected} usd={t.collected_usd} /></td>
                        <td><Chip status={t.status} /></td>
                        <td className="text-right">
                          <div className="inline-flex items-center justify-end gap-2">
                            <TradeApprovals t={t} />
                            <ChevronRight className="size-4 text-mut" />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-2.5 p-3 md:hidden">
              {shown.map((t) => (
                <div key={t.id} className="flex cursor-pointer flex-col gap-3 rounded-xl border border-line bg-bg p-4" onClick={() => open(t)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="num font-semibold">{t.code}</span>
                    <Chip status={t.status} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{t.importer_name}</div>
                    <div className="truncate text-[0.75rem] text-mut">{t.products}</div>
                  </div>
                  <Progress value={pct(t.exp_issued, t.contract_amount)} />
                  <div className="grid grid-cols-3 gap-2 text-[0.8125rem]">
                    <div><div className="lbl">Contract</div><span className="num">{bdtShort(t.contract_amount)}</span></div>
                    <div><div className="lbl">EXP</div><span className="num">{bdtShort(t.exp_issued)}</span></div>
                    <div><div className="lbl">Collected</div><span className="num">{bdtShort(t.collected)}</span></div>
                  </div>
                  <div className="empty:hidden"><TradeApprovals t={t} /></div>
                </div>
              ))}
            </div>
            <div className="border-t border-line px-4 py-2.5 text-[0.75rem] text-mut">
              Showing {shown.length} of {rows.length} · total contract {bdt(shown.reduce((s, t) => s + Number(t.contract_amount), 0))}
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
