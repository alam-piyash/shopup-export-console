import { Link, useParams } from "react-router-dom";
import { useCollections, useDecide, useIsAdmin, useProfiles, COLLECTION_DOCS } from "@/lib/api";
import { bdt, bdtShort, fmtDate } from "@/lib/format";
import { ApproveReject, Chip, Empty, Kpi, KpiGrid, LoadingRows, Money, Panel, Row } from "@/components/ui";
import { AttachmentList } from "@/components/files";

export default function CollectionDetail() {
  const { collectionId = "" } = useParams();
  const isAdmin = useIsAdmin();
  const decide = useDecide("collection");
  const profiles = useProfiles().data ?? {};
  const { data, isLoading } = useCollections();
  if (isLoading) return <LoadingRows rows={6} />;
  const c = data?.find((r) => r.id === collectionId);
  if (!c) return <Empty title="Collection not found" body="It may have been removed." action={<Link to="/collections" className="btn btn-outline">Back to collections</Link>} />;
  const pending = c.status === "pending_approval";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link to={`/trades/${c.trade_id}`} className="num text-[0.8125rem] text-mut hover:text-accent">{c.trades?.code} · {c.trades?.importer_name}</Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <h1 className="h1 num">{c.code}</h1>
            <Chip status={c.status} />
            {c.is_demo && <Chip label="Demo" tone="gray" dot={false} />}
          </div>
        </div>
        {isAdmin && pending && <ApproveReject label={c.code} onApprove={() => decide(c.id, true)} onReject={(reason) => decide(c.id, false, reason)} />}
      </div>

      {c.rejection_reason && <div className="banner chip-bad">Rejected: {c.rejection_reason}</div>}
      {pending && !isAdmin && <div className="banner chip-warn">Waiting for an admin to approve. The EXPs count as collected only after approval.</div>}

      <KpiGrid cols={3}>
        <Kpi label="Amount received" value={bdtShort(c.amount)} usdValue={c.amount_usd} sub={<span className="num">{bdt(c.amount)}</span>} />
        <Kpi label="EXPs covered" value={c.collection_exps.length} sub={c.collection_exps.map((x) => x.exps?.code).join(", ")} />
        <Kpi label="Submitted" value={fmtDate(c.created_at)} sub={c.is_demo ? "Demo" : profiles[c.created_by] ?? ""} />
      </KpiGrid>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Panel title="Details">
            <div className="px-4 py-2">
              <Row label="Amount received" value={<Money bdt={c.amount} usd={c.amount_usd} align="end" />} />
              <Row label="Bank reference" value={c.bank_reference || "None"} />
              <Row label="Trade" value={<Link to={`/trades/${c.trade_id}`} className="num hover:text-accent">{c.trades?.code}</Link>} />
              <Row label="Status" value={<Chip status={c.status} />} />
              {c.approved_at && <Row label={c.status === "rejected" ? "Rejected on" : "Approved on"} value={fmtDate(c.approved_at)} />}
            </div>
          </Panel>
          <Panel title="EXPs in this collection">
            <ul className="divide-y divide-line/70">
              {c.collection_exps.map((x) => (
                <li key={x.exps?.code} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="num text-[0.8438rem]">{x.exps?.code}</span>
                  <span className="num text-[0.8438rem]">{bdt(x.amount)}</span>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 bg-bg px-4 py-2.5">
                <span className="lbl">Total</span>
                <span className="num font-semibold">{bdt(c.collection_exps.reduce((s, x) => s + Number(x.amount), 0))}</span>
              </li>
            </ul>
          </Panel>
        </div>
        <Panel title="Documents" right={<span className="text-[0.75rem] text-mut">PRC, Ka Form, Swift Copy, TT Voucher</span>}>
          <AttachmentList entityId={c.id} expected={COLLECTION_DOCS} />
        </Panel>
      </div>
    </>
  );
}
