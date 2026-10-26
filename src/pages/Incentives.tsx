import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Coins, Download, Plus, Search } from "lucide-react";
import { useDecide, useIncentives, useIsAdmin } from "@/lib/api";
import { bdt, bdtShort, downloadCsv, fmtDate } from "@/lib/format";
import type { Incentive } from "@/lib/types";
import { ApproveReject, Button, Chip, Empty, Input, Kpi, KpiGrid, LoadingRows, Money, PageHeader, Panel, Row, Segments, cn } from "@/components/ui";
import { AttachmentList } from "@/components/files";

type Filter = "all" | "pending_approval" | "approved" | "rejected";

export default function Incentives() {
  const isAdmin = useIsAdmin();
  const [params, setParams] = useSearchParams();
  const filter = (params.get("status") as Filter) || "all";
  const setFilter = (f: Filter) => setParams(f === "all" ? {} : { status: f }, { replace: true });
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const { data, isLoading } = useIncentives();
  const decide = useDecide("incentive");
  const rows = data ?? [];
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const tradesOf = (r: Incentive) => [...new Set(r.incentive_exps.map((e) => e.exps?.trades?.code))].join(", ");
  const actions = (r: Incentive) =>
    isAdmin && r.status === "pending_approval" ? <ApproveReject label={r.code} onApprove={() => decide(r.id, true)} onReject={(reason) => decide(r.id, false, reason)} /> : null;
  const sumBy = (st: string) => rows.filter((r) => r.status === st).reduce((x, r) => x + Number(r.incentive_amount ?? 0), 0);
  const ql = q.toLowerCase();
  const visible = rows.filter((r) => (filter === "all" || r.status === filter) && (!q || [r.code, tradesOf(r), ...r.incentive_exps.map((e) => e.exps?.code)].some((v) => v?.toLowerCase().includes(ql))));

  return (
    <>
      <PageHeader
        title="Incentives"
        sub="Export incentive claims built from collected EXPs. FOB = net proceed minus freight."
        actions={
          <>
            <Button variant="outline" disabled={!visible.length} onClick={() => downloadCsv(`incentives-${new Date().toISOString().slice(0, 10)}.csv`, visible.map((r) => ({
              Code: r.code, Trades: tradesOf(r), EXPs: r.incentive_exps.map((e) => e.exps?.code).join(" "), "EXP amount": r.exp_amount, "Net proceed": r.net_proceed,
              Freight: r.freight, FOB: r.fob, "Rate %": r.incentive_pct, Incentive: r.incentive_amount, Date: r.created_at.slice(0, 10), Status: r.status,
            })))}><Download /> Export</Button>
            <Link to="/incentives/new" className="btn btn-primary"><Plus /> New incentive</Link>
          </>
        }
      />
      <KpiGrid cols={3}>
        <Kpi label="Approved incentive" value={bdtShort(sumBy("approved"))} sub={`${count("approved")} claims`} />
        <Kpi label="Pending incentive" value={bdtShort(sumBy("pending_approval"))} sub={`${count("pending_approval")} waiting for an admin`} />
        <Kpi label="Rejected" value={count("rejected")} sub="Claims" />
      </KpiGrid>
      <Panel
        title={
          <Segments value={filter} onChange={setFilter} options={[
            { value: "all", label: "All", count: rows.length },
            { value: "pending_approval", label: "Awaiting", count: count("pending_approval") },
            { value: "approved", label: "Approved", count: count("approved") },
            { value: "rejected", label: "Rejected", count: count("rejected") },
          ]} />
        }
        right={
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mut" />
            <Input className="pl-9" placeholder="Search code, trade, EXP" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        }
      >
        {isLoading ? <LoadingRows /> : visible.length === 0 ? (
          <Empty icon={<Coins />} title={rows.length ? "Nothing here" : "No incentives yet"} body="Claims use EXPs from approved collections." action={!rows.length && <Link to="/incentives/new" className="btn btn-primary"><Plus /> New incentive</Link>} />
        ) : (
          <>
            <div className="scroll-thin hidden overflow-x-auto md:block">
              <table className="tbl min-w-[64rem]">
                <thead><tr>{["Code", "Trades", "EXPs", "EXP amount", "FOB", "Rate", "Incentive", "Date", "Status", ""].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.id} className="cursor-pointer" onClick={() => navigate(`/incentives/${r.id}`)}>
                      <td className="num font-medium">{r.code}</td>
                      <td className="num">{tradesOf(r)}</td>
                      <td className="num">{r.incentive_exps.length}</td>
                      <td className="num">{bdt(r.exp_amount)}</td>
                      <td className="num">{bdt(r.fob)}</td>
                      <td className="num">{Number(r.incentive_pct)}%</td>
                      <td className="num font-medium">{bdt(r.incentive_amount)}</td>
                      <td className="num">{fmtDate(r.created_at)}</td>
                      <td><Chip status={r.status} /></td>
                      <td><div className="flex justify-end gap-2">{actions(r)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-2.5 p-3 md:hidden">
              {visible.map((r) => (
                <div key={r.id} className="flex cursor-pointer flex-col gap-2 rounded-xl border border-line bg-bg p-4" onClick={() => navigate(`/incentives/${r.id}`)}>
                  <div className="flex items-center justify-between"><span className="num font-semibold">{r.code}</span><Chip status={r.status} /></div>
                  <div className="text-[0.75rem] text-mut">{tradesOf(r)} · FOB {bdt(r.fob)} at {Number(r.incentive_pct)}%</div>
                  <div className="num font-semibold">{bdt(r.incentive_amount)}</div>
                  <div className="empty:hidden">{actions(r)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
