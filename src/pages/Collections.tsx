import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronRight, Download, Plus, Search, Wallet } from "lucide-react";
import { useCollections, useDecide, useIsAdmin, useProfiles } from "@/lib/api";
import { bdt, bdtShort, downloadCsv, fmtDate } from "@/lib/format";
import type { Collection } from "@/lib/types";
import { ApproveReject, Button, Chip, Empty, Input, Kpi, KpiGrid, LoadingRows, Modal, Money, PageHeader, Panel, Row, Segments } from "@/components/ui";
import { AttachmentList } from "@/components/files";

type Filter = "all" | "pending_approval" | "approved" | "rejected";

export default function Collections() {
  const isAdmin = useIsAdmin();
  const [params, setParams] = useSearchParams();
  const filter = (params.get("status") as Filter) || "all";
  const setFilter = (f: Filter) => setParams(f === "all" ? {} : { status: f }, { replace: true });
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const { data, isLoading } = useCollections();
  const decide = useDecide("collection");
  const profiles = useProfiles().data ?? {};
  const rows = data ?? [];
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const ql = q.toLowerCase();
  const visible = rows.filter(
    (r) =>
      (filter === "all" || r.status === filter) &&
      (!q || [r.code, r.trades?.code, r.trades?.importer_name, r.bank_reference, ...r.collection_exps.map((c) => c.exps?.code)].some((v) => v?.toLowerCase().includes(ql))),
  );
  const open = rows.find((r) => r.id === openId);
  const actions = (r: Collection) =>
    isAdmin && r.status === "pending_approval" ? <ApproveReject label={r.code} onApprove={() => decide(r.id, true)} onReject={(reason) => decide(r.id, false, reason)} /> : null;
  const sumBy = (st: string, k: "amount" | "amount_usd") => {
    const rs = rows.filter((r) => r.status === st);
    if (k === "amount_usd" && !rs.some((r) => r.amount_usd != null)) return null;
    return rs.reduce((x, r) => x + Number(r[k] ?? 0), 0);
  };

  return (
    <>
      <PageHeader
        title="Collections"
        sub="Money received against EXPs. Only approved collections mark EXPs as collected."
        actions={
          <>
            <Button variant="outline" disabled={!visible.length} onClick={() => downloadCsv(`collections-${new Date().toISOString().slice(0, 10)}.csv`, visible.map((r) => ({
              Code: r.code, Trade: r.trades?.code, Buyer: r.trades?.importer_name, EXPs: r.collection_exps.map((c) => c.exps?.code).join(" "), "Amount BDT": r.amount,
              "Amount USD": r.amount_usd ?? "", "Bank ref": r.bank_reference ?? "", Date: r.created_at.slice(0, 10), Status: r.status,
            })))}><Download /> Export</Button>
            <Link to="/collections/new" className="btn btn-primary"><Plus /> New collection</Link>
          </>
        }
      />
      <KpiGrid cols={3}>
        <Kpi label="Approved" value={bdtShort(sumBy("approved", "amount"))} usdValue={sumBy("approved", "amount_usd")} sub={`${count("approved")} collections`} />
        <Kpi label="Pending" value={bdtShort(sumBy("pending_approval", "amount"))} usdValue={sumBy("pending_approval", "amount_usd")} sub={`${count("pending_approval")} waiting for an admin`} />
        <Kpi label="Rejected" value={count("rejected")} sub="Collections" />
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
          <Empty icon={<Wallet />} title={rows.length ? "Nothing here" : "No collections yet"} body="Record money received and group it against the EXPs it pays for." action={!rows.length && <Link to="/collections/new" className="btn btn-primary"><Plus /> New collection</Link>} />
        ) : (
          <>
            <div className="scroll-thin hidden overflow-x-auto md:block">
              <table className="tbl min-w-[55rem]">
                <thead><tr>{["Code", "Trade", "EXPs", "Amount", "Bank ref", "Date", "Status", ""].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                      <td className="num font-medium">{r.code}</td>
                      <td><div className="num">{r.trades?.code}</div><div className="max-w-[11.25rem] truncate text-[0.75rem] text-mut">{r.trades?.importer_name}</div></td>
                      <td className="num max-w-[12.5rem] text-[0.75rem] text-mut">{r.collection_exps.map((c) => c.exps?.code).join(", ")}</td>
                      <td><Money bdt={r.amount} usd={r.amount_usd} /></td>
                      <td className="max-w-40 truncate text-mut">{r.bank_reference}</td>
                      <td className="num text-mut">{fmtDate(r.created_at)}</td>
                      <td><Chip status={r.status} /></td>
                      <td className="text-right"><div className="inline-flex items-center gap-2">{actions(r)}<ChevronRight className="size-4 text-mut" /></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-2.5 p-3 md:hidden">
              {visible.map((r) => (
                <div key={r.id} className="flex cursor-pointer flex-col gap-2 rounded-xl border border-line bg-bg p-4" onClick={() => setOpenId(r.id)}>
                  <div className="flex items-center justify-between"><span className="num font-semibold">{r.code}</span><Chip status={r.status} /></div>
                  <div className="text-[0.75rem] text-mut">{r.trades?.code} · {r.trades?.importer_name}</div>
                  <div className="num text-[0.75rem] text-mut">{r.collection_exps.map((c) => c.exps?.code).join(", ")}</div>
                  <Money bdt={r.amount} usd={r.amount_usd} className="font-semibold" />
                  <div className="empty:hidden">{actions(r)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>
      <Modal open={!!open} onOpenChange={(o) => !o && setOpenId(null)} title={<span className="num">{open?.code}</span>} description={open ? `${open.trades?.code} · ${open.trades?.importer_name}` : undefined} footer={open && actions(open)}>
        {open && (
          <div>
            <Row label="Amount received" value={<Money bdt={open.amount} usd={open.amount_usd} align="end" />} />
            <Row label="Bank reference" value={open.bank_reference || "None"} />
            <Row label="Submitted" value={`${open.is_demo ? "Demo" : profiles[open.created_by] ?? ""} · ${fmtDate(open.created_at)}`} />
            <Row label="Status" value={<Chip status={open.status} />} />
            {open.rejection_reason && <Row label="Reason" value={<span className="text-bad">{open.rejection_reason}</span>} />}
            <div className="lbl mb-2 mt-5">EXPs</div>
            <div className="rounded-lg border border-line px-3">
              {open.collection_exps.map((c) => <Row key={c.exps?.code} label={<span className="num">{c.exps?.code}</span>} value={<span className="num">{bdt(c.amount)}</span>} />)}
            </div>
            <div className="lbl mb-2 mt-5">Documents</div>
            <AttachmentList entityId={open.id} />
          </div>
        )}
      </Modal>
    </>
  );
}
