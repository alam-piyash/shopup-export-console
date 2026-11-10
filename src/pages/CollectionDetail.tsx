import { Link, useParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { useCollections, useDecide, useIncentives, useIsAdmin, useProfiles } from "@/lib/api";
import { money, fmtDate } from "@/lib/format";
import { ApproveReject, Chip, Empty, LoadingRows } from "@/components/ui";
import { EntityDocPanel } from "@/components/entityDocs";
import { DetailHeader, ExpRowsTable, HeroCard } from "@/components/detailParts";

export default function CollectionDetail() {
  const { collectionId = "" } = useParams();
  const isAdmin = useIsAdmin();
  const decide = useDecide("collection");
  const profiles = useProfiles().data ?? {};
  const { data, isLoading } = useCollections();
  const incs = useIncentives().data ?? [];
  if (isLoading) return <LoadingRows rows={6} />;
  const c = data?.find((r) => r.id === collectionId);
  if (!c) return <Empty title="Collection not found" body="It may have been removed." action={<Link to="/collections" className="btn btn-outline">Back to collections</Link>} />;
  const pending = c.status === "pending_approval";
  const expTotal = c.collection_exps.reduce((s, x) => s + Number(x.amount), 0);
  const matches = Math.round(expTotal * 100) === Math.round(Number(c.amount) * 100);
  const ids = new Set(c.collection_exps.map((x) => x.exps?.id));
  const inc = incs.find((i) => i.status !== "rejected" && i.incentive_exps.some((e) => ids.has(e.exps?.id)));
  const who = c.is_demo ? "Demo" : profiles[c.created_by];

  return (
    <div className="mx-auto flex w-full max-w-[65rem] flex-col gap-5">
      <DetailHeader
        code={c.code}
        chips={<><Chip status={c.status} />{c.is_demo && <Chip label="Demo" tone="gray" dot={false} />}</>}
        meta={<><Link to={`/trades/${c.trade_id}`} className="code-id text-accent hover:underline">{c.trades?.code}</Link> · {c.trades?.importer_name} · Submitted {fmtDate(c.created_at)}{who ? ` by ${who}` : ""}</>}
        actions={isAdmin && pending ? <ApproveReject label={c.code} onApprove={() => decide(c.id, true)} onReject={(reason) => decide(c.id, false, reason)} /> : undefined}
      />

      {c.rejection_reason && <div className="banner chip-bad">Rejected: {c.rejection_reason}</div>}
      {pending && !isAdmin && <div className="banner chip-warn">Waiting for an admin to approve. The EXPs count as collected only after approval.</div>}

      <HeroCard
        label="Amount received"
        amount={money(c.amount)}
        aside={matches ? <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-4 text-ok" /> Matches {c.collection_exps.length} EXP{c.collection_exps.length === 1 ? "" : "s"} exactly</span> : `EXPs total ${money(expTotal)}`}
        stats={[
          { label: "EXPs covered", value: c.collection_exps.length },
          { label: "Bank reference", value: c.bank_reference || <span className="text-mut">Not set</span> },
          { label: c.status === "rejected" ? "Rejected on" : "Approved on", value: c.approved_at ? fmtDate(c.approved_at) : <span className="text-mut">Pending</span> },
          { label: "Incentive", value: inc ? <Link to={`/incentives/${inc.id}`} className="code-id text-accent hover:underline">{inc.code}</Link> : <span className="text-mut">Not claimed</span> },
        ]}
      />

      <EntityDocPanel entityType="collection" entityId={c.id} folder="collections" hint="Add a new version each time a copy comes back. Mark final when the bank file is complete." />

      <ExpRowsTable
        title="EXPs in this collection"
        sub={`${c.collection_exps.length} EXP${c.collection_exps.length === 1 ? "" : "s"}${matches ? " · totals match the amount received" : ""}`}
        rows={c.collection_exps}
        extra={{ label: "AWB", cell: (r) => r.exps?.awb_no || "Not set" }}
      />
    </div>
  );
}
