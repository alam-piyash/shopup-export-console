import { Link, useParams } from "react-router-dom";
import { ArrowRightLeft, CheckCircle2 } from "lucide-react";
import { kindLabel, useCollections, useDecide, useIncentives, useIsApprover, useIsFinance, useProfiles } from "@/lib/api";
import { money, fmtDate } from "@/lib/format";
import type { Collection } from "@/lib/types";
import { ApproveReject, Chip, Empty, LoadingRows } from "@/components/ui";
import { EntityDocPanel } from "@/components/entityDocs";
import { DetailHeader, ExpRowsTable, HeroCard } from "@/components/detailParts";

type Line = Collection["collection_exps"][number];
const partCell = (r: Line) => {
  const full = Number(r.exps?.amount ?? r.amount);
  return Math.round(Number(r.amount) * 100) >= Math.round(full * 100) ? "Full" : <span className="text-warn">Partial of {money(full)}</span>;
};

export default function CollectionDetail() {
  const { collectionId = "" } = useParams();
  const isApprover = useIsApprover();
  const isFinance = useIsFinance();
  const decide = useDecide("collection");
  const profiles = useProfiles().data ?? {};
  const { data, isLoading } = useCollections();
  const incs = useIncentives().data ?? [];
  if (isLoading) return <LoadingRows rows={6} />;
  const c = data?.find((r) => r.id === collectionId);
  if (!c) return <Empty title="Collection not found" body="It may have been removed." action={<Link to="/collections" className="btn btn-outline">Back to collections</Link>} />;
  const pending = c.status === "pending_approval";
  const kind = c.kind ?? "exp";
  const expTotal = c.collection_exps.reduce((s, x) => s + Number(x.amount), 0);
  const matches = Math.round(expTotal * 100) === Math.round(Number(c.amount) * 100);
  const ids = new Set(c.collection_exps.map((x) => x.exps?.id));
  const inc = incs.find((i) => i.status !== "rejected" && i.incentive_exps.some((e) => ids.has(e.exps?.id)));
  const who = c.is_demo ? "Demo" : profiles[c.created_by];
  const source = kind === "settlement" ? data?.find((r) => r.id === c.source_collection_id) : undefined;
  const settlements = kind === "prepaid" ? (data ?? []).filter((r) => r.kind === "settlement" && r.source_collection_id === c.id && r.status !== "rejected" && r.status !== "withdrawn") : [];
  const settledOk = settlements.filter((s) => s.status === "approved").reduce((t, s) => t + Number(s.amount), 0);
  const settling = settlements.filter((s) => s.status === "pending_approval").reduce((t, s) => t + Number(s.amount), 0);
  const left = Number(c.amount) - settledOk - settling;
  const partials = c.collection_exps.filter((r) => Math.round(Number(r.amount) * 100) < Math.round(Number(r.exps?.amount ?? r.amount) * 100)).length;
  const approverText = "Waiting for Admin or Finance to approve.";

  return (
    <div className="mx-auto flex w-full max-w-[65rem] flex-col gap-5">
      <DetailHeader
        code={c.code}
        chips={<><Chip status={c.status} />{kind !== "exp" && <Chip label={kindLabel(kind)} tone={kind === "prepaid" ? "info" : "gray"} dot={false} />}{c.is_demo && <Chip label="Demo" tone="gray" dot={false} />}</>}
        meta={<>{isFinance ? <span className="code-id">{c.trades?.code}</span> : <Link to={`/trades/${c.trade_id}`} className="code-id text-accent hover:underline">{c.trades?.code}</Link>} · {c.trades?.importer_name} · Submitted {fmtDate(c.created_at)}{who ? ` by ${who}` : ""}</>}
        actions={
          isApprover && pending ? <ApproveReject label={c.code} onApprove={() => decide(c.id, true)} onReject={(reason) => decide(c.id, false, reason)} />
          : kind === "prepaid" && c.status === "approved" && left > 0.004 && !isFinance ? <Link to={`/collections/new?settle=${c.id}`} className="btn btn-primary"><ArrowRightLeft className="size-4" /> Settle EXPs</Link>
          : undefined
        }
      />

      {c.rejection_reason && <div className="banner chip-bad">Rejected: {c.rejection_reason}</div>}
      {pending && !isApprover && <div className="banner chip-warn">{approverText} {kind === "prepaid" ? "The money can be settled onto EXPs only after approval." : "The EXPs count as collected only after approval."}</div>}

      {kind === "prepaid" ? (
        <HeroCard
          label="Prepaid received"
          amount={money(c.amount)}
          aside={c.status === "approved" ? `${money(Math.max(left, 0))} left to settle` : "Settle EXPs after approval"}
          stats={[
            { label: "Settled onto EXPs", value: money(settledOk) },
            { label: "Settling (pending)", value: settling ? money(settling) : <span className="text-mut">None</span> },
            { label: "Left", value: money(Math.max(left, 0)) },
            { label: "Bank reference", value: c.bank_reference || <span className="text-mut">Not set</span> },
            { label: c.status === "rejected" ? "Rejected on" : "Approved on", value: c.approved_at ? fmtDate(c.approved_at) : <span className="text-mut">Pending</span> },
          ]}
        />
      ) : kind === "settlement" ? (
        <HeroCard
          label="Settled from prepaid"
          amount={money(c.amount)}
          aside={source ? <>From <Link to={`/collections/${source.id}`} className="code-id text-accent hover:underline">{source.code}</Link></> : undefined}
          stats={[
            { label: "EXPs settled", value: c.collection_exps.length },
            { label: "Partial", value: partials || <span className="text-mut">None</span> },
            { label: "Prepaid collection", value: source ? <Link to={`/collections/${source.id}`} className="code-id text-accent hover:underline">{source.code}</Link> : <span className="text-mut">Unknown</span> },
            { label: c.status === "rejected" ? "Rejected on" : "Approved on", value: c.approved_at ? fmtDate(c.approved_at) : <span className="text-mut">Pending</span> },
            { label: "Incentive", value: inc ? <Link to={`/incentives/${inc.id}`} className="code-id text-accent hover:underline">{inc.code}</Link> : <span className="text-mut">Not claimed</span> },
          ]}
        />
      ) : (
        <HeroCard
          label="Amount received"
          amount={money(c.amount)}
          aside={matches ? <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-4 text-ok" /> Matches {c.collection_exps.length} EXP{c.collection_exps.length === 1 ? "" : "s"} exactly</span> : `EXPs total ${money(expTotal)}`}
          stats={[
            { label: "EXPs covered", value: c.collection_exps.length },
            { label: "Partial", value: partials || <span className="text-mut">None</span> },
            { label: "Bank reference", value: c.bank_reference || <span className="text-mut">Not set</span> },
            { label: c.status === "rejected" ? "Rejected on" : "Approved on", value: c.approved_at ? fmtDate(c.approved_at) : <span className="text-mut">Pending</span> },
            { label: "Incentive", value: inc ? <Link to={`/incentives/${inc.id}`} className="code-id text-accent hover:underline">{inc.code}</Link> : <span className="text-mut">Not claimed</span> },
          ]}
        />
      )}

      {kind === "settlement" ? (
        <div className="banner border border-line bg-bg text-mut">No documents for a settlement. The Swift Message and other files are on the prepaid collection{source ? <> <Link to={`/collections/${source.id}`} className="code-id text-accent hover:underline">{source.code}</Link></> : ""}.</div>
      ) : (
        <EntityDocPanel entityType="collection" entityId={c.id} folder="collections" readOnly={isFinance} hint="Add a new version each time a copy comes back. Mark final when the bank file is complete." />
      )}

      {kind === "prepaid" ? (
        <section className="card overflow-hidden">
          <div className="px-6 pb-3 pt-4">
            <h2 className="text-[1.0625rem] font-semibold">Settlements</h2>
            <p className="text-[0.8125rem] text-mut">EXPs paid from this prepaid money.</p>
          </div>
          {settlements.length === 0 ? (
            <p className="px-6 pb-5 text-[0.8125rem] text-mut">{c.status === "approved" ? "Nothing settled yet. Use Settle EXPs once the EXPs exist." : "Settlements can be made after approval."}</p>
          ) : (
            <div className="scroll-thin overflow-x-auto">
              <table className="tbl min-w-[34rem]">
                <thead><tr><th>Settlement</th><th>EXPs</th><th>Date</th><th>Status</th><th className="!text-right">Amount</th></tr></thead>
                <tbody>
                  {settlements.map((s) => (
                    <tr key={s.id}>
                      <td><Link to={`/collections/${s.id}`} className="code-id font-medium text-accent hover:underline">{s.code}</Link></td>
                      <td className="code-id text-mut">{s.collection_exps.map((x) => x.exps?.code).filter(Boolean).slice(0, 3).join(", ")}{s.collection_exps.length > 3 ? ` +${s.collection_exps.length - 3}` : ""}</td>
                      <td>{fmtDate(s.created_at)}</td>
                      <td><Chip status={s.status} /></td>
                      <td className="num !text-right font-medium">{money(s.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <ExpRowsTable
          title={kind === "settlement" ? "EXPs settled" : "EXPs in this collection"}
          sub={`${c.collection_exps.length} EXP${c.collection_exps.length === 1 ? "" : "s"}${partials ? `, ${partials} partial` : ""}${kind === "exp" && matches ? " · totals match the amount received" : ""}`}
          rows={c.collection_exps}
          extra={{ label: "Part", cell: partCell }}
        />
      )}
    </div>
  );
}
