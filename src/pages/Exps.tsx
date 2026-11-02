import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Download, FileStack, FileUp, Plus, Search } from "lucide-react";
import { AddExpDialog } from "@/components/expDialogs";
import { BulkExpDialog } from "@/components/bulkExp";
import { EXP_DOCS, useAllExps } from "@/lib/api";
import { bdt, bdtShort, downloadCsv, fmtDate } from "@/lib/format";
import { Button, Chip, Empty, Input, Kpi, KpiGrid, LoadingRows, Money, PageHeader, Panel, Segments } from "@/components/ui";

type Filter = "all" | "open" | "closed" | "no_shipment" | "docs_pending" | "uncollected" | "amount_pending";

export default function Exps() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = (params.get("filter") as Filter) || "all";
  const setFilter = (f: Filter) => setParams(f === "all" ? {} : { filter: f }, { replace: true });
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const { data, isLoading } = useAllExps();
  const rows = (data ?? []).filter((e) => e.trade_status !== "rejected");
  const match: Record<Filter, (e: (typeof rows)[number]) => boolean> = {
    all: () => true,
    open: (e) => e.status === "open",
    closed: (e) => e.status === "closed",
    no_shipment: (e) => e.status === "open" && !e.shipment_id,
    docs_pending: (e) => e.status === "open" && !!e.shipment_id && e.docs_final < (e.docs_total ?? EXP_DOCS.length),
    uncollected: (e) => !e.collection_status,
    amount_pending: (e) => !!e.pending_amount_change_id,
  };
  const count = (f: Filter) => rows.filter(match[f]).length;
  const ql = q.toLowerCase();
  const shown = rows.filter((e) => match[filter](e) && (!q || [e.code, e.trade_code, e.importer_name, e.shipment_id, e.exp_no, e.awb_no].some((v) => v?.toLowerCase().includes(ql))));
  const total = (arr: typeof rows) => arr.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <>
      <PageHeader
        title="EXPs"
        sub="Every shipment across all trades, with document and collection progress."
        actions={
          <>
          <Button
            variant="outline"
            disabled={!shown.length}
            onClick={() =>
              downloadCsv(`exps-${new Date().toISOString().slice(0, 10)}.csv`, shown.map((e) => ({
                Code: e.code, Trade: e.trade_code, Buyer: e.importer_name, Type: e.type, "Shipment ID": e.shipment_id ?? "", "EXP no": e.exp_no ?? "",
                AWB: e.awb_no ?? "", "Shipment date": e.shipment_date ?? "", "Amount BDT": e.amount, "Amount USD": e.amount_usd ?? "", "Issued BDT": e.issued_amount ?? e.amount, "Issued USD": e.issued_amount_usd ?? "",
                "Docs final": e.docs_final, Status: e.status, Collection: e.collection_status ?? "", Incentive: e.incentive_status ?? "",
              })))
            }
          >
            <Download /> Export
          </Button>
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            <FileUp /> Import
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus /> Add EXP
          </Button>
          </>
        }
      />
      <AddExpDialog open={addOpen} onOpenChange={setAddOpen} />
      <BulkExpDialog open={bulkOpen} onOpenChange={setBulkOpen} />
      <KpiGrid>
        <Kpi label="Total EXPs" value={rows.length} sub={bdtShort(total(rows))} />
        <Kpi label="Open" value={count("open")} sub={bdtShort(total(rows.filter(match.open)))} />
        <Kpi label="Docs pending" value={count("docs_pending")} sub="Open EXPs with shipment" />
        <Kpi label="Not collected" value={count("uncollected")} sub={bdtShort(total(rows.filter(match.uncollected)))} />
      </KpiGrid>
      <Panel
        title={
          <Segments
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All", count: rows.length },
              { value: "open", label: "Open", count: count("open") },
              { value: "docs_pending", label: "Docs pending", count: count("docs_pending") },
              { value: "no_shipment", label: "No shipment", count: count("no_shipment") },
              { value: "uncollected", label: "Uncollected", count: count("uncollected") },
              { value: "closed", label: "Closed", count: count("closed") },
              ...(count("amount_pending") ? [{ value: "amount_pending" as Filter, label: "Amount change pending", count: count("amount_pending") }] : []),
            ]}
          />
        }
        right={
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mut" />
            <Input className="pl-9" placeholder="Search EXP, trade, AWB" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        }
      >
        {isLoading ? <LoadingRows /> : shown.length === 0 ? (
          <Empty icon={<FileStack />} title={rows.length ? "Nothing here" : "No EXPs yet"} body="EXPs are added from an active trade." />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="tbl min-w-[76rem]">
              <thead><tr>{["EXP", "Type", "Trade", "Buyer", "Shipment ID", "Shipment date", "Amount", "Issued on EXP", "Documents", "Collection", "Status"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} className="cursor-pointer" onClick={() => navigate(`/exps/${e.id}`)}>
                    <td className="code-id font-medium">{e.code}</td>
                    <td>{e.type === "advance" ? "Advance" : "Regular"}</td>
                    <td className="code-id">{e.trade_code}</td>
                    <td className="max-w-[13rem] truncate">{e.importer_name}</td>
                    <td className="code-id">{e.shipment_id || <span className="text-warn">Not set</span>}</td>
                    <td className="num">{e.shipment_date ? fmtDate(e.shipment_date) : <span className="text-mut">Not set</span>}</td>
                    <td className="num">{bdt(e.amount)}{e.pending_amount_change_id && <span className="ml-1.5 text-[0.7188rem] text-info">change pending</span>}</td>
                    <td className="num text-mut">{e.issued_amount !== undefined && Number(e.issued_amount) !== Number(e.amount) ? bdt(e.issued_amount) : "Same"}</td>
                    <td className="num">{e.docs_final} / {e.docs_total ?? EXP_DOCS.length} final</td>
                    <td>{e.collection_status ? <Chip label={e.collection_status === "approved" ? "Collected" : "Pending"} tone={e.collection_status === "approved" ? "ok" : "warn"} dot={false} /> : <span className="text-mut">Not collected</span>}</td>
                    <td><Chip status={e.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-line px-4 py-2.5 text-[0.75rem] text-mut">Showing {shown.length} · total {bdt(total(shown))}</div>
          </div>
        )}
      </Panel>
    </>
  );
}
