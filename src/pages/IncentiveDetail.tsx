import { Link, useParams } from "react-router-dom";
import { useDecide, useIncentives, useIsAdmin, useProfiles, INCENTIVE_DOCS } from "@/lib/api";
import { bdt, bdtShort, fmtDate } from "@/lib/format";
import { ApproveReject, Chip, Empty, Kpi, KpiGrid, LoadingRows, Money, Panel, Row } from "@/components/ui";
import { AttachmentList } from "@/components/files";

export default function IncentiveDetail() {
  const { incentiveId = "" } = useParams();
  const isAdmin = useIsAdmin();
  const decide = useDecide("incentive");
  const profiles = useProfiles().data ?? {};
  const { data, isLoading } = useIncentives();
  if (isLoading) return <LoadingRows rows={6} />;
  const r = data?.find((x) => x.id === incentiveId);
  if (!r) return <Empty title="Incentive not found" body="It may have been removed." action={<Link to="/incentives" className="btn btn-outline">Back to incentives</Link>} />;
  const pending = r.status === "pending_approval";
  const trades = [...new Map(r.incentive_exps.map((e) => [e.exps?.trades?.code, e.exps?.trades])).values()].filter(Boolean);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="num text-[0.8125rem] text-mut">{trades.map((t) => `${t?.code} · ${t?.importer_name}`).join(", ")}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <h1 className="h1 num">{r.code}</h1>
            <Chip status={r.status} />
            {r.is_demo && <Chip label="Demo" tone="gray" dot={false} />}
          </div>
        </div>
        {isAdmin && pending && <ApproveReject label={r.code} onApprove={() => decide(r.id, true)} onReject={(reason) => decide(r.id, false, reason)} />}
      </div>

      {r.rejection_reason && <div className="banner chip-bad">Rejected: {r.rejection_reason}</div>}
      {pending && !isAdmin && <div className="banner chip-warn">Waiting for an admin to approve.</div>}

      <KpiGrid cols={4}>
        <Kpi label="Incentive" value={bdtShort(r.incentive_amount)} sub={<span className="num">{bdt(r.incentive_amount)}</span>} />
        <Kpi label="FOB" value={bdtShort(r.fob)} sub={`at ${Number(r.incentive_pct)}%`} />
        <Kpi label="EXPs claimed" value={r.incentive_exps.length} sub={bdtShort(r.exp_amount)} />
        <Kpi label="Submitted" value={fmtDate(r.created_at)} sub={r.is_demo ? "Demo" : profiles[r.created_by] ?? ""} />
      </KpiGrid>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Panel title="Calculation">
            <div className="px-4 py-2">
              <Row label="EXP amount" value={<span className="num">{bdt(r.exp_amount)}</span>} />
              <Row label="Net proceed" value={<Money bdt={r.net_proceed} usd={r.net_proceed_usd} align="end" />} />
              <Row label="Freight" value={<Money bdt={r.freight} usd={r.freight_usd} align="end" />} />
              <Row label="FOB (net minus freight)" value={<span className="num">{bdt(r.fob)}</span>} />
              <Row label="Incentive rate" value={<span className="num">{Number(r.incentive_pct)}%</span>} />
            </div>
            <div className="flex items-baseline justify-between border-t border-line bg-bg px-4 py-3">
              <span className="lbl">Incentive</span>
              <span className="num text-[1.125rem] font-semibold">{bdt(r.incentive_amount)}</span>
            </div>
          </Panel>
          <Panel title="EXPs in this claim">
            <ul className="divide-y divide-line/70">
              {r.incentive_exps.map((e) => (
                <li key={e.exps?.code} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="num min-w-0 truncate text-[0.8438rem]">{e.exps?.code} <span className="text-mut">· {e.exps?.trades?.code}</span></span>
                  <span className="num shrink-0 text-[0.8438rem]">{bdt(e.amount)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <Panel title="Documents" right={<span className="text-[0.75rem] text-mut">Eight required documents</span>}>
          <AttachmentList entityId={r.id} expected={INCENTIVE_DOCS} />
        </Panel>
      </div>
    </>
  );
}
