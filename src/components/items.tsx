import { Plus, Trash2 } from "lucide-react";
import { money } from "@/lib/format";
import type { Product } from "@/lib/masters";
import { isFreight } from "@/lib/masters";
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
/** All rates are USD per KG. rate_per_kg mirrors rate_usd_per_kg for the database. */
export const rateOf = (i: ItemLine) => Number(i.rate_usd_per_kg || i.rate_per_kg || 0);
export const lineTotal = (i: ItemLine) => Math.round(Number(i.quantity_kg || 0) * rateOf(i) * 100) / 100;
export const itemsTotal = (items: ItemLine[]) => Math.round(items.reduce((s, i) => s + lineTotal(i), 0) * 100) / 100;
export const itemsValid = (items: ItemLine[]) =>
  items.length > 0 && items.every((i) => i.description.trim() && Number(i.quantity_kg) > 0 && rateOf(i) > 0);

/** Lines ready for the database: rate_per_kg and rate_usd_per_kg both hold the USD rate. */
export const withRates = (items: ItemLine[]) =>
  items.map((i) => ({ ...i, rate_per_kg: rateOf(i) > 0 ? String(rateOf(i)) : "", rate_usd_per_kg: rateOf(i) > 0 ? String(rateOf(i)) : "" }));
export const goodsLines = (items: ItemLine[]) => items.filter((i) => !isFreight(i.description));

const COLS: { key: keyof ItemLine; label: string; num?: boolean; placeholder?: string; span?: string }[] = [
  { key: "description", label: "Item description", placeholder: "Pick a product or type", span: "sm:col-span-2" },
  { key: "carton_size", label: "Carton size", placeholder: "1 KG x 10 PCS" },
  { key: "hs_code", label: "HS code", placeholder: "0711 90 00" },
  { key: "incoterm", label: "Incoterm", placeholder: "CFR" },
  { key: "quantity_kg", label: "Qty (KG)", num: true },
  { key: "rate_usd_per_kg", label: "Rate / KG (USD)", num: true },
];

/** Item lines in USD; picking a saved product fills carton, HS code, incoterm and rate. */
export function ItemsEditor({ items, onChange, products }: { items: ItemLine[]; onChange: (i: ItemLine[]) => void; xr?: number; products?: Product[] }) {
  const view = items;
  const cols = COLS;
  const set = (idx: number, k: keyof ItemLine, v: string) =>
    onChange(
      items.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, [k]: v };
        const p = k === "description" ? products?.find((x) => x.description.toLowerCase() === v.trim().toLowerCase()) : undefined;
        if (p) {
          next.carton_size = p.carton_size ?? next.carton_size;
          next.hs_code = p.hs_code ?? next.hs_code;
          next.incoterm = p.incoterm ?? next.incoterm;
          if (p.rate_usd_per_kg && !Number(next.rate_usd_per_kg)) next.rate_usd_per_kg = String(Number(p.rate_usd_per_kg));
        }
        return next;
      }),
    );
  const listId = products?.length ? "product-list" : undefined;
  return (
    <div className="space-y-3">
      {listId && <datalist id={listId}>{products!.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.description} />)}</datalist>}
      {view.map((it, idx) => (
        <div key={idx} className="rounded-xl border border-line bg-bg p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="lbl">Line {idx + 1}</span>
            <div className="flex items-center gap-2">
              <span className="num text-[0.8125rem] font-medium">{money(lineTotal(it))}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={items.length === 1} onClick={() => onChange(items.filter((_, i) => i !== idx))} aria-label="Remove line">
                <Trash2 />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            {cols.map((c) => (
              <label key={c.key} className={`flex flex-col gap-1.5 ${c.span ?? ""}`}>
                <span className="text-[0.75rem] text-mut">{c.label}</span>
                <Input
                  type={c.num ? "number" : "text"}
                  inputMode={c.num ? "decimal" : undefined}
                  step={c.num ? "any" : undefined}
                  placeholder={c.placeholder}
                  list={c.key === "description" ? listId : undefined}
                  value={c.key === "rate_usd_per_kg" ? it.rate_usd_per_kg || it.rate_per_kg : it[c.key]}
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
          <div className="lbl">Goods total</div>
          <div className="num text-[1.25rem] font-semibold">{money(itemsTotal(view))}</div>
        </div>
      </div>
    </div>
  );
}
