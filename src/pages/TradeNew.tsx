import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { rpc, useRefresh } from "@/lib/api";
import { bdt, errMsg, rateHint, usdOpt } from "@/lib/format";
import type { UploadedFile } from "@/lib/types";
import { Button, Chip, Field, Grid, Input, PageHeader, Row, Section, Select, Textarea } from "@/components/ui";
import { FileField } from "@/components/files";
import { ItemsEditor, emptyItem, itemsTotal, itemsUsdTotal, itemsValid, type ItemLine } from "@/components/items";

type F = { key: string; label: string; type?: "text" | "date" | "number" | "textarea" | "select" | "email"; options?: string[]; required?: boolean; placeholder?: string; hint?: string };

const EXPORTER: F[] = [
  { key: "exporter", label: "Exporter name", required: true },
  { key: "exporter_phone", label: "Phone" },
  { key: "exporter_email", label: "Email", type: "email" },
  { key: "exporter_address", label: "Address", type: "textarea" },
];
const BUYER: F[] = [
  { key: "importer_name", label: "Buyer name", required: true },
  { key: "importer_country", label: "Country", required: true },
  { key: "buyer_cr_no", label: "CR number" },
  { key: "buyer_vat_no", label: "VAT registration number" },
  { key: "buyer_address", label: "Address", type: "textarea" },
];
const CONTRACT: F[] = [
  { key: "sales_contract_no", label: "SC number", required: true, placeholder: "VEG/SU/31", hint: "Must be unique" },
  { key: "contract_date", label: "Contract date", type: "date", required: true },
  { key: "shipping_mark", label: "Shipping mark" },
  { key: "country_of_origin", label: "Country of origin", placeholder: "Bangladesh" },
  { key: "country_of_destination", label: "Country of destination" },
  { key: "expiry_date", label: "Contract expiry date", type: "date" },
  { key: "shipment_timeline", label: "Shipment timeline", placeholder: "e.g. Within 30 days" },
  { key: "carriage_by", label: "Carriage by", type: "select", options: ["Air", "Sea", "Road"] },
  { key: "departure_port", label: "Departure airport or port" },
  { key: "point_of_entry", label: "Point of entry" },
  { key: "payment_type", label: "Payment type", type: "select", options: ["Advance TT", "Part TT", "After receiving TT", "LC", "Other"] },
  { key: "tolerance_pct", label: "Quantity and amount tolerance (%)", type: "number", placeholder: "10", hint: "More or less at seller's option. Information only." },
  { key: "incentive_terms", label: "Incentive terms" },
  { key: "payment_terms", label: "Other terms of delivery and payment", type: "textarea" },
  { key: "notes", label: "Notes", type: "textarea" },
];
const BANK: F[] = [
  { key: "bank_name", label: "Bank name" },
  { key: "bank_branch", label: "Branch" },
  { key: "bank_routing_no", label: "Routing number" },
  { key: "bank_swift", label: "SWIFT code" },
  { key: "bank_account_name", label: "Account name" },
  { key: "bank_account_no", label: "Account number" },
];
const REQUIRED = [...EXPORTER, ...BUYER, ...CONTRACT].filter((f) => f.required);

function FieldInput({ f, value, onChange }: { f: F; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={f.label} required={f.required} hint={f.hint} className={f.type === "textarea" ? "sm:col-span-2" : undefined}>
      {f.type === "textarea" ? (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} rows={2} />
      ) : f.type === "select" ? (
        <Select value={value} onChange={(e) => onChange(e.target.value)} placeholder="Select">
          {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      ) : (
        <Input type={f.type ?? "text"} inputMode={f.type === "number" ? "decimal" : undefined} step={f.type === "number" ? "any" : undefined} value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} />
      )}
    </Field>
  );
}

type Notify = { name: string; address: string };

export default function TradeNew() {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const [v, setV] = useState<Record<string, string>>({ exporter: "Unicorn Distribution Limited", country_of_origin: "Bangladesh", contract_date: new Date().toISOString().slice(0, 10) });
  const [notify, setNotify] = useState<Notify[]>([]);
  const [items, setItems] = useState<ItemLine[]>([emptyItem()]);
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (val: string) => setV((s) => ({ ...s, [k]: val }));
  const fields = (list: F[]) => <Grid>{list.map((f) => <FieldInput key={f.key} f={f} value={v[f.key] ?? ""} onChange={set(f.key)} />)}</Grid>;

  const total = itemsTotal(items);
  const itemsUsd = itemsUsdTotal(items);
  const contractUsd = v.contract_amount_usd ?? (itemsUsd ? String(itemsUsd) : "");
  const missing = REQUIRED.filter((f) => !v[f.key]?.trim()).map((f) => f.label.toLowerCase());
  if (!itemsValid(items)) missing.push("complete item lines");
  if (!file) missing.push("sales contract copy");
  const valid = missing.length === 0 && total > 0;

  async function submit() {
    setBusy(true);
    try {
      const id = await rpc<string>("create_trade", {
        p_data: { ...v, contract_amount_usd: contractUsd || null, notify_parties: notify.filter((n) => n.name.trim()) },
        p_items: items,
        p_file: file,
      });
      toast.success("Trade submitted for approval");
      refresh();
      navigate(`/trades/${id}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Create trade" sub="Enter the Sales Contract or Proforma Invoice. An admin approves it before EXPs can be issued." />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Section step={1} title="Sales contract" hint="Core contract details and the signed copy">
            {fields(CONTRACT)}
            <FileField label="Sales contract copy" folder="trades/contracts" value={file} onChange={setFile} required />
          </Section>
          <Section step={2} title="Buyer (consignee)">{fields(BUYER)}</Section>
          <Section step={3} title="Items" hint="Rates in BDT. Contract amount is the sum of line totals.">
            <ItemsEditor items={items} onChange={setItems} />
            <Grid>
              <Field label="Contract amount in USD (optional)" hint={itemsUsd && v.contract_amount_usd === undefined ? "Filled from the USD item rates" : undefined}>
                <Input type="number" inputMode="decimal" step="any" value={contractUsd} onChange={(e) => set("contract_amount_usd")(e.target.value)} placeholder="0" />
              </Field>
              <Field label="Exchange rate (BDT per USD, optional)" hint={rateHint(total, contractUsd)}>
                <Input type="number" inputMode="decimal" step="any" value={v.exchange_rate ?? ""} onChange={(e) => set("exchange_rate")(e.target.value)} placeholder="122" />
              </Field>
            </Grid>
          </Section>
          <Section step={4} title="Exporter" hint="Defaults to our company. Edit if needed.">{fields(EXPORTER)}</Section>
          <Section step={5} title="Notify parties" hint="Add as many as the contract lists.">
            {notify.length === 0 && <p className="text-mut">No notify parties.</p>}
            {notify.map((n, i) => (
              <div key={i} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_2fr_auto]">
                <Field label="Name"><Input value={n.name} onChange={(e) => setNotify((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></Field>
                <Field label="Address"><Input value={n.address} onChange={(e) => setNotify((s) => s.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))} /></Field>
                <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => setNotify((s) => s.filter((_, j) => j !== i))} aria-label="Remove notify party"><Trash2 /></Button>
              </div>
            ))}
            <div><Button variant="outline" size="sm" onClick={() => setNotify((s) => [...s, { name: "", address: "" }])}><Plus /> Add notify party</Button></div>
          </Section>
          <Section step={6} title="Bank coordinates for receiving TT">{fields(BANK)}</Section>
        </div>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-20">
          <div className="card p-5">
            <div className="lbl mb-2">Review</div>
            <Row label="SC number" value={v.sales_contract_no || <span className="text-mut">Not set</span>} />
            <Row label="Buyer" value={v.importer_name || <span className="text-mut">Not set</span>} />
            <Row label="Destination" value={v.country_of_destination || v.importer_country || <span className="text-mut">Not set</span>} />
            <Row label="Items" value={<span className="num">{items.filter((i) => i.description.trim()).length}</span>} />
            {v.tolerance_pct && <Row label="Tolerance" value={`${v.tolerance_pct}% more or less`} />}
            <Row label="Contract copy" value={file ? <Chip label="Attached" tone="ok" /> : <Chip label="Missing" tone="gray" />} />
            <div className="my-3 border-t border-line" />
            <div className="lbl">Total CFR amount</div>
            <div className="num mt-1 text-[1.75rem] font-semibold leading-tight">{bdt(total)}</div>
            {usdOpt(contractUsd) && <div className="num text-mut">{usdOpt(contractUsd)}</div>}
            {missing.length > 0 && <p className="mt-3 text-[0.7812rem] text-mut">Still needed: {missing.join(", ")}.</p>}
          </div>
          <Button className="h-11 w-full" disabled={!valid} loading={busy} onClick={submit}>
            {!busy && <Send />} Submit for approval
          </Button>
          <p className="text-center text-[0.75rem] text-mut">An admin reviews the trade before EXPs can be added.</p>
        </aside>
      </div>
    </>
  );
}
