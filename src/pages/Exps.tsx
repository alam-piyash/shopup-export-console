import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronDown, FileStack, FilePen, FileUp, Plus, X } from "lucide-react";
import { AddExpDialog } from "@/components/expDialogs";
import { BulkExpDialog, type BulkMode } from "@/components/bulkExp";
import { SearchBox, TradePicker, expMatches } from "@/components/pickers";
import { EXP_DOCS, useAllExps, useTrades } from "@/lib/api";
import { money, moneyShort, fmtDate } from "@/lib/format";
import { expNumber, isShipped, typeLabel } from "@/lib/expFields";
import { Button, Chip, Empty, Kpi, KpiGrid, LoadingRows, Menu, PageHeader, Panel, Segments, cn } from "@/components/ui";

type Filter = "all" | "advance" | "regular" | "open" | "closed" | "docs_pending" | "uncollected" | "amount_pending";
const PAGE = 200;

export default function Exps() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = (params.get("filter") as Filter) || "all";
  const tradeFilter = params.get("trade") ?? "";
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v && v !== "all") next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [bulk, setBulk] = useState<BulkMode | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const { data, isLoading } = useAllExps();
  const { data: trades } = useTrades();
  const rows = useMemo(() => (data ?? []).filter((e) => e.trade_status !== "rejected"), [data]);
  const match: Record<Filter, (e: (typeof rows)[number]) => boolean> = {
    all: () => true,
    advance: (e) => e.type === "advance",
    regular: (e) => e.type === "regular",
    open: (e) => e.status === "open",
    closed: (e) => e.status === "closed",
    docs_pending: (e) => e.status === "open" && isShipped(e) && e.docs_final < (e.docs_total ?? EXP_DOCS.length),
    uncollected: (e) => !e.collection_status,
    amount_pending: (e) => !!e.pending_amount_change_id,
  };
  const inTrade = rows.filter((e) => !tradeFilter || e.trade_id === tradeFilter);
  const count = (f: Filter) => inTrade.filter(match[f]).length;
  const shown = inTrade.filter((e) => match[filter](e) && expMatches(e, q));
  const total = (arr: typeof rows) => arr.reduce((s, e) => s + Number(e.amount), 0);
  const sel = new Set(selected);
  const selRows = rows.filter((e) => sel.has(e.id));
  const allShownOn = shown.length > 0 && shown.every((e) => sel.has(e.id));
  const toggleShown = () => setSelected(allShownOn ? selected.filter((id) => !shown.some((e) => e.id === id)) : [...new Set([...selected, ...shown.map((e) => e.id)])]);

  return (
    <>
      <PageHeader
        title="EXPs"
        sub="Every EXP across all trades. Add one, or use Bulk to add or correct many from an Excel file."
        actions={
          <>
            <Menu
              trigger={<Button variant="outline"><FileStack /> Bulk <ChevronDown /></Button>}
              items={[
                { label: "Bulk EXP", hint: "Add many EXPs to a trade from Excel", icon: <FileUp />, onClick: () => setBulk("create") },
                { label: "EXP correction", hint: selRows.length ? `Correct the ${selRows.length} selected EXPs` : "Fill in or correct many EXPs from Excel", icon: <FilePen />, onClick: () => setBulk("update") },
              ]}
            />
            <Button onClick={() => setAddOpen(true)}><Plus /> Add EXP</Button>
          </>
        }
      />
      <AddExpDialog open={addOpen} onOpenChange={setAddOpen} />
      <BulkExpDialog key={bulk ?? "none"} open={!!bulk} onOpenChange={(o) => !o && setBulk(null)} mode={bulk ?? "create"} tradeId={tradeFilter || undefined} prefill={bulk === "update" ? (selRows.length ? selRows : shown) : undefined} />
      <KpiGrid>
        <Kpi label="Total EXPs" value={inTrade.length} sub={moneyShort(total(inTrade))} />
        <Kpi label="Advance" value={count("advance")} sub="Waiting for shipment fields" />
        <Kpi label="Docs pending" value={count("docs_pending")} sub="Shipped, documents not final" />
        <Kpi label="Not collected" value={count("uncollected")} sub={moneyShort(total(inTrade.filter(match.uncollected)))} />
      </KpiGrid>
      <Panel
        title={
          <Segments
            value={filter}
            onChange={(f) => setParam("filter", f)}
            options={[
              { value: "all", label: "All", count: inTrade.length },
              { value: "advance", label: "Advance", count: count("advance") },
              { value: "regular", label: "Regular", count: count("regular") },
              { value: "docs_pending", label: "Docs pending", count: count("docs_pending") },
              { value: "uncollected", label: "Uncollected", count: count("uncollected") },
              { value: "closed", label: "Closed", count: count("closed") },
              ...(count("amount_pending") ? [{ value: "amount_pending" as Filter, label: "Amount change pending", count: count("amount_pending") }] : []),
            ]}
          />
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <SearchBox value={q} onChange={(v) => { setQ(v); setLimit(PAGE); }} placeholder="Search EXP code, EXP number, SC, AWB, invoice" className="min-w-[16rem] flex-1" />
          <div className="w-full sm:w-80">
            <TradePicker trades={trades ?? []} value={tradeFilter} onChange={(id) => setParam("trade", id)} placeholder="Filter by trade code, SC or buyer" />
          </div>
          {tradeFilter && <Button size="sm" variant="ghost" onClick={() => setParam("trade", "")}><X /> All trades</Button>}
        </div>
        {selected.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raised/60 px-4 py-2.5 text-[0.8125rem]">
            <span className="font-medium">{selected.length} selected</span>
            <span className="num text-mut">{money(total(selRows))}</span>
            <span className="flex-1" />
            <Button size="sm" variant="outline" onClick={() => setBulk("update")}><FilePen /> EXP correction</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}><X /> Clear</Button>
          </div>
        )}
        {isLoading ? <LoadingRows /> : shown.length === 0 ? (
          <Empty icon={<FileStack />} title={rows.length ? "Nothing matches" : "No EXPs yet"} body={rows.length ? "Change the filter or search." : "Add an EXP or import a file. The trade must be approved with a signed contract."} />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="tbl min-w-[78rem]">
              <thead>
                <tr>
                  <th className="w-10"><input type="checkbox" aria-label="Select all shown" checked={allShownOn} onChange={toggleShown} /></th>
                  {["EXP", "EXP number", "Type", "Trade", "Buyer", "Ship date", "Amount Inv", "Fields", "Documents", "Collection", "Status"].map((h) => <th key={h}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, limit).map((e) => {
                  const on = sel.has(e.id);
                  const missing = e.fields_missing ?? 0;
                  return (
                    <tr key={e.id} className={cn("cursor-pointer", on && "bg-raised/70")} onClick={() => navigate(`/exps/${e.id}`)}>
                      <td onClick={(ev) => ev.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${e.code}`} checked={on} onChange={(ev) => setSelected(ev.target.checked ? [...selected, e.id] : selected.filter((x) => x !== e.id))} />
                      </td>
                      <td className="code-id font-medium">{e.code}</td>
                      <td className="code-id">{expNumber(e) || <span className="text-mut">Not set</span>}</td>
                      <td>{typeLabel(e.type)}</td>
                      <td className="code-id">{e.trade_code}</td>
                      <td className="max-w-[12rem] truncate">{e.importer_name}</td>
                      <td className="num">{e.shipment_date ? fmtDate(e.shipment_date) : <span className="text-mut">Not set</span>}</td>
                      <td className="num">{money(e.amount)}{e.pending_amount_change_id && <span className="ml-1.5 text-[0.7188rem] text-info">change pending</span>}</td>
                      <td>{missing ? <span className="text-[0.75rem] text-warn">{missing} missing</span> : <Chip label="Complete" tone="ok" dot={false} />}</td>
                      <td className="num">{e.docs_final} / {e.docs_total ?? EXP_DOCS.length}</td>
                      <td>{e.collection_status ? <Chip label={e.collection_status === "approved" ? "Collected" : "Pending"} tone={e.collection_status === "approved" ? "ok" : "warn"} dot={false} /> : <span className="text-mut">Not collected</span>}</td>
                      <td><Chip status={e.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[0.75rem] text-mut">
              <span>Showing {Math.min(limit, shown.length)} of {shown.length} · total {money(total(shown))}</span>
              {shown.length > limit && <Button size="sm" variant="outline" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, shown.length - limit)} more</Button>}
            </div>
          </div>
        )}
      </Panel>
    </>
  );
}
