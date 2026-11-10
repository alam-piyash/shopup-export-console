import { useMemo, useState, type ReactNode } from "react";
import * as P from "@radix-ui/react-popover";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { money } from "@/lib/format";
import { expNumber, typeLabel } from "@/lib/expFields";
import type { Exp, Trade } from "@/lib/types";
import { cn } from "./ui";

const norm = (s: unknown) => String(s ?? "").toLowerCase();

/** Search box with a magnifier, used above long lists. */
export function SearchBox({ value, onChange, placeholder, className, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mut" />
      <input className="field w-full pl-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
    </div>
  );
}

/** Searchable single select for trades (code, SC number, buyer). */
export function TradePicker<T extends Pick<Trade, "id" | "code" | "sales_contract_no" | "importer_name">>({
  trades,
  value,
  onChange,
  extra,
  placeholder = "Search trade code, SC number or buyer",
  disabledIf,
}: {
  trades: T[];
  value: string;
  onChange: (id: string) => void;
  extra?: (t: T) => ReactNode;
  placeholder?: string;
  disabledIf?: (t: T) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const picked = trades.find((t) => t.id === value);
  const shown = useMemo(() => {
    const s = norm(q).trim();
    return trades.filter((t) => !s || [t.code, t.sales_contract_no, t.importer_name].some((x) => norm(x).includes(s))).slice(0, 100);
  }, [trades, q]);
  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Trigger asChild>
        <button type="button" className="field flex w-full items-center justify-between gap-2 text-left">
          {picked ? (
            <span className="min-w-0 truncate">
              <span className="code-id font-medium">{picked.code}</span> <span className="text-mut">· SC {picked.sales_contract_no} · {picked.importer_name}</span>
            </span>
          ) : (
            <span className="text-mut">{trades.length ? "Select a trade" : "No trades available"}</span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 text-mut" />
        </button>
      </P.Trigger>
      <P.Portal>
        <P.Content align="start" sideOffset={6} className="z-[60] w-[var(--radix-popover-trigger-width)] min-w-[18rem] rounded-xl border border-line bg-surface p-2 shadow-xl">
          <SearchBox value={q} onChange={setQ} placeholder={placeholder} autoFocus />
          <div className="scroll-thin mt-2 max-h-72 overflow-y-auto">
            {shown.length === 0 && <div className="px-3 py-4 text-center text-[0.8125rem] text-mut">No matching trades</div>}
            {shown.map((t) => {
              const off = disabledIf?.(t);
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={off}
                  onClick={() => { onChange(t.id); setOpen(false); setQ(""); }}
                  className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[0.8125rem] hover:bg-raised disabled:opacity-40", t.id === value && "bg-raised")}
                >
                  <Check className={cn("size-4 shrink-0", t.id === value ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1">
                    <span className="code-id font-medium">{t.code}</span> <span className="code-id text-mut">· SC {t.sales_contract_no}</span>
                    <span className="block truncate text-[0.75rem] text-mut">{t.importer_name}</span>
                  </span>
                  {extra && <span className="shrink-0 text-[0.75rem] text-mut">{extra(t)}</span>}
                </button>
              );
            })}
          </div>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

export const expMatches = (e: Partial<Exp>, q: string) => {
  const s = norm(q).trim();
  if (!s) return true;
  return [e.code, e.exp_no, e.exp_serial, e.trade_code, e.sales_contract_no, e.importer_name, e.awb_no, e.invoice_no, e.shipment_id, e.export_bill_no].some((x) => norm(x).includes(s));
};

const LIMIT = 300;

/** Searchable multi-select for EXPs: a compact table with select all (filtered) and a running total. */
export function ExpMultiPicker({
  exps,
  selected,
  onChange,
  meta,
  empty = "No EXPs",
}: {
  exps: Exp[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Optional extra line under the EXP code (for example the trade). */
  meta?: (e: Exp) => ReactNode;
  empty?: string;
}) {
  const [q, setQ] = useState("");
  const [view, setView] = useState<"all" | "selected">("all");
  const sel = new Set(selected);
  const filtered = useMemo(() => exps.filter((e) => expMatches(e, q) && (view === "all" || sel.has(e.id))), [exps, q, view, selected]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = filtered.slice(0, LIMIT);
  const allOn = filtered.length > 0 && filtered.every((e) => sel.has(e.id));
  const someOn = !allOn && filtered.some((e) => sel.has(e.id));
  const total = exps.filter((e) => sel.has(e.id)).reduce((s, e) => s + Number(e.amount || 0), 0);
  const toggleAll = () => {
    if (allOn) onChange(selected.filter((id) => !filtered.some((e) => e.id === id)));
    else onChange([...new Set([...selected, ...filtered.map((e) => e.id)])]);
  };
  const toggle = (id: string) => onChange(sel.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  if (!exps.length) return <p className="text-mut">{empty}</p>;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search EXP code, EXP number, AWB, invoice" className="min-w-[14rem] flex-1" />
        <div className="flex gap-0.5 rounded-lg border border-line bg-surface p-[3px] text-[0.8125rem]">
          {(["all", "selected"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={cn("rounded-md px-2.5 py-1 transition", view === v ? "bg-raised font-medium" : "text-mut hover:text-fg")}>
              {v === "all" ? "All" : "Selected"} <span className="num text-mut">{v === "all" ? exps.length : selected.length}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-line">
        <div className="scroll-thin max-h-[26rem] overflow-y-auto">
          <table className="tbl">
            <thead className="sticky top-0 z-[1]">
              <tr>
                <th className="w-10">
                  <input type="checkbox" checked={allOn} ref={(el) => { if (el) el.indeterminate = someOn; }} onChange={toggleAll} aria-label={allOn ? "Clear all shown" : "Select all shown"} className="size-4 accent-[rgb(var(--accent))]" />
                </th>
                <th>EXP</th>
                <th>EXP number</th>
                <th className="max-md:hidden">Invoice</th>
                <th className="max-md:hidden">AWB</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => {
                const on = sel.has(e.id);
                return (
                  <tr key={e.id} onClick={() => toggle(e.id)} className={cn("cursor-pointer", on && "!bg-accent/[0.08]")}>
                    <td className={cn("w-10", on && "shadow-[inset_3px_0_0_rgb(var(--accent))]")}>
                      <input type="checkbox" checked={on} onChange={() => toggle(e.id)} onClick={(ev) => ev.stopPropagation()} aria-label={`Select ${e.code}`} className="size-4 accent-[rgb(var(--accent))]" />
                    </td>
                    <td>
                      <div className="code-id font-medium">{e.code}</div>
                      {meta && <div className="text-[0.7188rem] text-mut">{meta(e)}</div>}
                    </td>
                    <td className="code-id">{expNumber(e) || <span className="text-mut">Not set</span>}</td>
                    <td className="code-id max-md:hidden">{e.invoice_no || <span className="text-mut">Not set</span>}</td>
                    <td className="code-id max-md:hidden">{e.awb_no || <span className="text-mut">Not set</span>}</td>
                    <td className="num text-right font-medium">{money(e.amount)}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={6} className="py-5 text-center text-mut">{view === "selected" ? "Nothing selected yet" : "No EXPs match"}</td></tr>}
            </tbody>
          </table>
        </div>
        {filtered.length > LIMIT && <p className="border-t border-line px-3 py-2 text-center text-[0.75rem] text-mut">Showing {LIMIT} of {filtered.length}. Search to narrow the list; select all still covers every match.</p>}
        <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2 text-[0.8125rem]" style={{ background: "rgb(var(--bg) / 0.6)" }}>
          <span className="text-mut">{selected.length} of {exps.length} EXPs selected</span>
          <span className="num font-semibold">{money(total)}</span>
        </div>
      </div>
    </div>
  );
}
