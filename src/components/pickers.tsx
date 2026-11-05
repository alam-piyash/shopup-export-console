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

/** Searchable multi-select for EXPs with select all (filtered) and a running total. */
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
  meta?: (e: Exp) => ReactNode;
  empty?: string;
}) {
  const [q, setQ] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const filtered = useMemo(() => exps.filter((e) => expMatches(e, q) && (!onlySelected || selected.includes(e.id))), [exps, q, onlySelected, selected]);
  const shown = filtered.slice(0, LIMIT);
  const sel = new Set(selected);
  const allOn = filtered.length > 0 && filtered.every((e) => sel.has(e.id));
  const total = exps.filter((e) => sel.has(e.id)).reduce((s, e) => s + Number(e.amount || 0), 0);
  const toggleAll = () => {
    if (allOn) onChange(selected.filter((id) => !filtered.some((e) => e.id === id)));
    else onChange([...new Set([...selected, ...filtered.map((e) => e.id)])]);
  };
  if (!exps.length) return <p className="text-mut">{empty}</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search EXP code, EXP number, AWB, invoice" className="min-w-[14rem] flex-1" />
        <button type="button" onClick={() => setOnlySelected((v) => !v)} className={cn("btn btn-sm", onlySelected ? "btn-primary" : "btn-outline")}>
          Selected {selected.length}
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-lg bg-raised/60 px-3 py-2 text-[0.8125rem]">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={allOn} onChange={toggleAll} />
          {allOn ? "Clear" : "Select"} all {q || onlySelected ? "matching" : ""} ({filtered.length})
        </label>
        <span className="text-mut">
          {selected.length} selected · <span className="num font-medium text-fg">{money(total)}</span>
        </span>
      </div>
      <div className="scroll-thin flex max-h-[26rem] flex-col gap-1.5 overflow-y-auto pr-1">
        {shown.map((e) => {
          const on = sel.has(e.id);
          return (
            <label key={e.id} className={cn("sel", on && "on")}>
              <input type="checkbox" checked={on} onChange={(ev) => onChange(ev.target.checked ? [...selected, e.id] : selected.filter((x) => x !== e.id))} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="code-id font-medium">{e.code}</span>
                  {expNumber(e) && <span className="code-id text-[0.75rem] text-mut">EXP {expNumber(e)}</span>}
                  <span className="text-[0.7188rem] text-mut">{typeLabel(e.type)}</span>
                </div>
                <div className="truncate text-[0.75rem] text-mut">{meta ? meta(e) : [e.awb_no && `AWB ${e.awb_no}`, e.invoice_no && `Inv ${e.invoice_no}`].filter(Boolean).join(" · ") || "No shipment details yet"}</div>
              </div>
              <span className="num min-w-[7.5rem] text-right font-semibold">{money(e.amount)}</span>
            </label>
          );
        })}
        {filtered.length > LIMIT && <p className="px-3 py-2 text-center text-[0.75rem] text-mut">Showing {LIMIT} of {filtered.length}. Search to narrow the list; select all still covers every match.</p>}
        {filtered.length === 0 && <p className="px-3 py-4 text-center text-[0.8125rem] text-mut">No EXPs match</p>}
      </div>
    </div>
  );
}
