import { Link, useParams } from "react-router-dom";
import { useDecide, useIncentives, useIsAdmin, useProfiles } from "@/lib/api";
import { money, fmtDate } from "@/lib/format";
import { ApproveReject, Chip, Empty, LoadingRows } from "@/components/ui";
import { EntityDocPanel } from "@/components/entityDocs";
import { DetailHeader, ExpRowsTable, HeroCard } from "@/components/detailParts";

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
  const tradeIds = r.incentive_exps.map((e) => e.exps?.trades?.code).filter(Boolean);
  const who = r.is_demo ? "Demo" : profiles[r.created_by];
  const colOf = (e: (typeof r.incentive_exps)[number]) => e.exps?.collection_exps?.map((x) => x.collections).find((c) => c && c.status === "approved")?.code ?? "";

  return (
    <div className="mx-auto flex w-full max-w-[65rem] flex-col gap-5">
      <DetailHeader
        code={r.code}
        chips={<><Chip status={r.status} />{r.is_demo && <Chip label="Demo" tone="gray" dot={false} />}</>}
        meta={<>{trades.map((t, i) => <span key={t?.code}>{i > 0 && ", "}<span className="code-id">{t?.code}</span> · {t?.importer_name}</span>)} · Submitted {fmtDate(r.created_at)}{who ? ` by ${who}` : ""}</>}
        actions={isAdmin && pending ? <ApproveReject label={r.code} onApprove={() => decide(r.id, true)} onReject={(reason) => decide(r.id, false, reason)} /> : undefined}
      />

      {r.rejection_reason && <div className="banner chip-bad">Rejected: {r.rejection_reason}</div>}
      {pending && !isAdmin && <div className="banner chip-warn">Waiting for an admin to approve.</div>}

      <HeroCard
        label="Incentive"
        amount={money(r.incentive_amount)}
        aside={`${Number(r.incentive_pct)}% of FOB · ${r.incentive_exps.length} EXP${r.incentive_exps.length === 1 ? "" : "s"}`}
        stats={[
          { label: "EXP amount", value: money(r.exp_amount) },
          { label: "Net proceed", value: money(r.net_proceed) },
          { label: "minus Freight", value: money(r.freight) },
          { label: "= FOB", value: money(r.fob) },
          { label: "× Rate", value: `${Number(r.incentive_pct)}%` },
        ]}
      />

      <EntityDocPanel entityType="incentive" entityId={r.id} folder="incentives" hint="Add a new version each time a copy comes back. Mark final to close a document." />

      <ExpRowsTable
        title="EXPs in this claim"
        sub={`${r.incentive_exps.length} EXP${r.incentive_exps.length === 1 ? "" : "s"}${new Set(tradeIds).size === 1 ? ` · all from ${tradeIds[0]}` : ""}`}
        rows={r.incentive_exps}
        extra={{ label: "Collection", cell: (e) => colOf(e) || "Not set" }}
      />
    </div>
  );
}
