import { Plus, Trash2 } from "lucide-react";
import { bdt, usdOpt } from "@/lib/format";
import { Button, Input } from "./ui";

export type ItemLine = {
  description: string;
  carton_size: string;
  hs_code: string;
  incoterm: string;
  quantity_kg: string;
  rate_per_kg: string;
  rate_usd_per_kg: string;
};
export const emptyItem = (): ItemLine => ({ description: "", carton_size: "", hs_code: "", incoterm: "CFR", quantity_kg: "", rate_per_kg: "", rate_usd_per_kg: "" });
export const lineTotal = (i: ItemLine) => Math.round(Number(i.quantity_kg || 0) * Number(i.rate_per_kg || 0) * 100) / 100;
export const itemsTotal = (items: ItemLine[]) => Math.round(items.reduce((s, i) => s + lineTotal(i), 0) * 100) / 100;
export const itemsUsdTotal = (items: ItemLine[]) =>
  items.some((i) => Number(i.rate_usd_per_kg) > 0)
    ? Math.round(items.reduce((s, i) => s + Number(i.quantity_kg || 0) * Number(i.rate_usd_per_kg || 0), 0) * 100) / 100
    : null;
export const itemsValid = (items: ItemLine[]) =>
  items.length > 0 && items.every((i) => i.description.trim() && Number(i.quantity_kg) > 0 && Number(i.rate_per_kg) > 0);

const COLS: { key: keyof ItemLine; label: string; num?: boolean; placeholder?: string; span?: string }[] = [
  { key: "description", label: "Item description", placeholder: "Fresh vegetables", span: "sm:col-span-2" },
  { key: "carton_size", label: "Carton size", placeholder: "CTN 1KG x 10KG" },
  { key: "hs_code", label: "HS code", placeholder: "0709 99 00" },
  { key: "incoterm", label: "Incoterm", placeholder: "CFR" },
  { key: "quantity_kg", label: "Qty (KG)", num: true },
  { key: "rate_per_kg", label: "Rate / KG (BDT)", num: true },
  { key: "rate_usd_per_kg", label: "Rate / KG (USD, optional)", num: true },
];

export function ItemsEditor({ items, onChange }: { items: ItemLine[]; onChange: (i: ItemLine[]) => void }) {
  const set = (idx: number, k: keyof ItemLine, v: string) => onChange(items.map((it, i) => (i === idx ? { ...it, [k]: v } : it)));
  const usdTotal = usdOpt(itemsUsdTotal(items));
  return (
    <div className="space-y-3">
      {items.map((it, idx) => (
        <div key={idx} className="rounded-xl border border-line bg-bg p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="lbl">Line {idx + 1}</span>
            <div className="flex items-center gap-2">
              <span className="num text-[0.8125rem] font-medium">{bdt(lineTotal(it))}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={items.length === 1} onClick={() => onChange(items.filter((_, i) => i !== idx))} aria-label="Remove line">
                <Trash2 />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            {COLS.map((c) => (
              <label key={c.key} className={`flex flex-col gap-1.5 ${c.span ?? ""}`}>
                <span className="text-[0.75rem] text-mut">{c.label}</span>
                <Input
                  type={c.num ? "number" : "text"}
                  inputMode={c.num ? "decimal" : undefined}
                  step={c.num ? "any" : undefined}
                  placeholder={c.placeholder}
                  value={it[c.key]}
                  onChange={(e) => set(idx, c.key, e.target.value)}
                />
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={() => onChange([...items, emptyItem()])}>
          <Plus /> Add item
        </Button>
        <div className="text-right">
          <div className="lbl">Total CFR amount</div>
          <div className="num text-[1.25rem] font-semibold">{bdt(itemsTotal(items))}</div>
          {usdTotal && <div className="num text-[0.75rem] text-mut">{usdTotal}</div>}
        </div>
      </div>
    </div>
  );
}
