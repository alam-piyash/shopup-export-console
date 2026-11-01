import { Plus, Trash2 } from "lucide-react";
import { bdt, usdOpt } from "@/lib/format";
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
export const lineTotal = (i: ItemLine) => Math.round(Number(i.quantity_kg || 0) * Number(i.rate_per_kg || 0) * 100) / 100;
export const itemsTotal = (items: ItemLine[]) => Math.round(items.reduce((s, i) => s + lineTotal(i), 0) * 100) / 100;
export const itemsUsdTotal = (items: ItemLine[]) =>
  items.some((i) => Number(i.rate_usd_per_kg) > 0)
    ? Math.round(items.reduce((s, i) => s + Number(i.quantity_kg || 0) * Number(i.rate_usd_per_kg || 0), 0) * 100) / 100
    : null;
export const itemsValid = (items: ItemLine[]) =>
  items.length > 0 && items.every((i) => i.description.trim() && Number(i.quantity_kg) > 0 && Number(i.rate_per_kg) > 0);

/** USD mode: the BDT rate is the USD rate times the exchange rate. */
export const withBdtRates = (items: ItemLine[], xr: number) =>
  items.map((i) => ({ ...i, rate_per_kg: xr > 0 && Number(i.rate_usd_per_kg) > 0 ? String(Math.round(Number(i.rate_usd_per_kg) * xr * 10000) / 10000) : "" }));
export const goodsLines = (items: ItemLine[]) => items.filter((i) => !isFreight(i.description));

const COLS: { key: keyof ItemLine; label: string; num?: boolean; placeholder?: string; span?: string }[] = [
  { key: "description", label: "Item description", placeholder: "Fresh vegetables", span: "sm:col-span-2" },
  { key: "carton_size", label: "Carton size", placeholder: "CTN 1KG x 10KG" },
  { key: "hs_code", label: "HS code", placeholder: "0709 99 00" },
  { key: "incoterm", label: "Incoterm", placeholder: "CFR" },
  { key: "quantity_kg", label: "Qty (KG)", num: true },
  { key: "rate_per_kg", label: "Rate / KG (BDT)", num: true },
  { key: "rate_usd_per_kg", label: "Rate / KG (USD, optional)", num: true },
];

const USD_COLS: typeof COLS = [
  { key: "description", label: "Item description", placeholder: "Pick a product or type", span: "sm:col-span-2" },
  { key: "carton_size", label: "Carton size", placeholder: "1 KG x 10 PCS" },
  { key: "hs_code", label: "HS code", placeholder: "0711 90 00" },
  { key: "incoterm", label: "Incoterm", placeholder: "CFR" },
  { key: "quantity_kg", label: "Qty (KG)", num: true },
  { key: "rate_usd_per_kg", label: "Rate / KG (USD)", num: true },
];

/**
 * BDT mode (default): rates typed in BDT, USD optional.
 * USD mode (pass `xr`): rates typed in USD, BDT computed from the exchange rate; products fill a line.
 */
export function ItemsEditor({ items, onChange, xr, products }: { items: ItemLine[]; onChange: (i: ItemLine[]) => void; xr?: number; products?: Product[] }) {
  const usdMode = xr !== undefined;
  const view = usdMode ? withBdtRates(items, xr) : items;
  const cols = usdMode ? USD_COLS : COLS;
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
  const usdTotal = usdOpt(itemsUsdTotal(items));
  const listId = products?.length ? "product-list" : undefined;
  return (
    <div className="space-y-3">
      {listId && <datalist id={listId}>{products!.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.description} />)}</datalist>}
      {view.map((it, idx) => (
        <div key={idx} className="rounded-xl border border-line bg-bg p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="lbl">Line {idx + 1}</span>
            <div className="flex items-center gap-2">
              <span className="num text-[0.8125rem] font-medium">
                {usdMode && Number(it.rate_usd_per_kg) > 0 && <span className="mr-2 text-mut">{usdOpt(Number(it.quantity_kg || 0) * Number(it.rate_usd_per_kg))}</span>}
                {bdt(lineTotal(it))}
              </span>
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
                  value={it[c.key]}
                  onChange={(e) => set(idx, c.key, e.target.value)}
                />
              </label>
            ))}
            {usdMode && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[0.75rem] text-mut">Rate / KG (BDT)</span>
                <div className="num flex h-10 items-center rounded-lg border border-line bg-raised/50 px-3 text-mut">{it.rate_per_kg ? bdt(it.rate_per_kg) : "Set rates"}</div>
              </div>
            )}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={() => onChange([...items, emptyItem()])}>
          <Plus /> Add item
        </Button>
        <div className="text-right">
          <div className="lbl">{usdMode ? "Goods total" : "Total CFR amount"}</div>
          <div className="num text-[1.25rem] font-semibold">{bdt(itemsTotal(view))}</div>
          {usdTotal && <div className="num text-[0.75rem] text-mut">{usdTotal}</div>}
        </div>
      </div>
    </div>
  );
}
