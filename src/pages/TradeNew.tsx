import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileUp, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { rpc, useRefresh, useTrades } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { money, errMsg } from "@/lib/format";
import type { UploadedFile } from "@/lib/types";
import { FREIGHT_LABEL, nextScNo, useBuyers, useCompanyProfiles, useProducts, type Buyer, type CompanyProfile, type Notify } from "@/lib/masters";
import { scDataFrom, saveGeneratedVersion } from "@/lib/contractDocs";
import { Button, Chip, Field, Grid, Input, PageHeader, Row, Section, Select, Switch, Textarea } from "@/components/ui";
import { FileField } from "@/components/files";
import { ItemsEditor, emptyItem, itemsTotal, withRates, type ItemLine } from "@/components/items";

type F = { key: string; label: string; type?: "text" | "date" | "number" | "textarea" | "select" | "email"; options?: string[]; required?: boolean; placeholder?: string; hint?: string };

const EXPORTER: F[] = [
  { key: "exporter", label: "Exporter name", required: true },
  { key: "exporter_phone", label: "Phone" },
  { key: "exporter_email", label: "Email", type: "email" },
  { key: "exporter_address", label: "Address", type: "textarea" },
  { key: "signatory_name", label: "Signatory name" },
  { key: "signatory_designation", label: "Signatory designation" },
];
const BUYER: F[] = [
  { key: "importer_name", label: "Buyer name", required: true },
  { key: "importer_country", label: "Country", required: true },
  { key: "buyer_cr_no", label: "CR number" },
  { key: "buyer_vat_no", label: "VAT registration number" },
  { key: "buyer_address", label: "Address", type: "textarea" },
];
const CONTRACT: F[] = [
  { key: "sales_contract_no", label: "SC number", required: true, placeholder: "VEG/SU/39", hint: "Suggested from the company profile. Must be unique." },
  { key: "contract_date", label: "Contract date", type: "date", required: true },
  { key: "shipment_deadline", label: "Shipment deadline", type: "date", required: true, hint: "Follow-ups run at 25, 50, 75 and 100% of this period" },
  { key: "expiry_date", label: "Contract expiry date", type: "date" },
  { key: "shipping_mark", label: "Shipping mark" },
  { key: "country_of_origin", label: "Country of origin", placeholder: "Bangladesh" },
  { key: "country_of_destination", label: "Country of destination" },
  { key: "carriage_by", label: "Carriage by", type: "select", options: ["Air", "Sea", "Road"] },
  { key: "departure_port", label: "Departure airport or port" },
  { key: "point_of_entry", label: "Point of entry" },
  { key: "tolerance_pct", label: "Quantity and amount tolerance (%)", type: "number", placeholder: "10", hint: "More or less at seller's option. Information only." },
  { key: "payment_terms", label: "Terms of delivery and payment", type: "textarea" },
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
          {[...f.options!, ...(value && !f.options!.includes(value) ? [value] : [])].map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      ) : (
        <Input type={f.type ?? "text"} inputMode={f.type === "number" ? "decimal" : undefined} step={f.type === "number" ? "any" : undefined} value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} />
      )}
    </Field>
  );
}

const profileValues = (p: CompanyProfile): Record<string, string> => ({
  exporter: p.legal_name,
  exporter_address: p.address ?? "",
  exporter_phone: p.phone ?? "",
  exporter_email: p.email ?? "",
  signatory_name: p.signatory_name ?? "",
  signatory_designation: p.signatory_designation ?? "",
  bank_name: p.bank_name ?? "",
  bank_branch: p.bank_branch ?? "",
  bank_routing_no: p.bank_routing_no ?? "",
  bank_swift: p.bank_swift ?? "",
  bank_account_name: p.bank_account_name ?? "",
  bank_account_no: p.bank_account_no ?? "",
  shipping_mark: p.shipping_mark ?? "",
  country_of_origin: p.default_terms?.country_of_origin ?? "",
  carriage_by: (p.default_terms?.carriage_by ?? "").replace(/^by\s+/i, ""),
  departure_port: p.default_terms?.departure_port ?? "",
  payment_terms: p.default_terms?.payment_terms ?? "",
  tolerance_pct: p.default_terms?.tolerance_pct != null ? String(p.default_terms.tolerance_pct) : "",
});
const buyerValues = (b: Buyer): Record<string, string> => ({
  importer_name: b.name,
  importer_country: b.country ?? "",
  country_of_destination: b.country ?? "",
  buyer_cr_no: b.cr_no ?? "",
  buyer_vat_no: b.vat_no ?? "",
  buyer_address: b.address ?? "",
  point_of_entry: b.point_of_entry ?? "",
});
const r2 = (n: number) => Math.round(n * 100) / 100;

export default function TradeNew() {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const profiles = useCompanyProfiles().data;
  const buyers = useBuyers().data ?? [];
  const products = useProducts().data ?? [];
  const trades = useTrades().data;
  const [v, setV] = useState<Record<string, string>>({ country_of_origin: "Bangladesh", contract_date: new Date().toISOString().slice(0, 10) });
  const [profileId, setProfileId] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [saveBuyer, setSaveBuyer] = useState(true);
  const [notify, setNotify] = useState<Notify[]>([]);
  const [items, setItems] = useState<ItemLine[]>([emptyItem()]);
  const [freightUsd, setFreightUsd] = useState("");
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const pdfRef = useRef<HTMLInputElement>(null);
  const set = (k: string) => (val: string) => setV((s) => ({ ...s, [k]: val }));
  const fields = (list: F[]) => <Grid>{list.map((f) => <FieldInput key={f.key} f={f} value={v[f.key] ?? ""} onChange={set(f.key)} />)}</Grid>;

  // Default company profile fills exporter, bank and default terms once
  const applyProfile = (p: CompanyProfile, scSuggest = true) => {
    setProfileId(p.id);
    setV((s) => {
      const next = { ...s, ...Object.fromEntries(Object.entries(profileValues(p)).filter(([, val]) => val !== "")) };
      if (scSuggest && trades) next.sales_contract_no = nextScNo(p.sc_prefix, trades.map((t) => t.sales_contract_no)) || s.sales_contract_no || "";
      return next;
    });
    if (p.default_terms?.notify_parties?.length) setNotify((n) => (n.some((x) => x.name.trim()) ? n : p.default_terms.notify_parties!));
  };
  useEffect(() => {
    if (profileId || !profiles || !trades) return;
    const d = profiles.find((p) => p.is_default && p.is_active) ?? profiles.find((p) => p.is_active);
    if (d) applyProfile(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, trades]);

  function pickBuyer(id: string) {
    setBuyerId(id);
    const b = buyers.find((x) => x.id === id);
    if (!b) return;
    setV((s) => ({ ...s, ...Object.fromEntries(Object.entries(buyerValues(b)).filter(([, val]) => val !== "")) }));
    if (b.notify_parties?.length) setNotify(b.notify_parties);
  }

  async function autofill(f?: File) {
    if (!f) return;
    setParsing(true);
    try {
      const { parseScPdf } = await import("@/lib/scParser");
      const p = await parseScPdf(f);
      const fx = { ...p.fields };
      if (fx.country_of_destination && !fx.importer_country) fx.importer_country = fx.country_of_destination;
      if (fx.carriage_by) fx.carriage_by = fx.carriage_by.replace(/^by\s+/i, "");
      if (p.signatory) { fx.signatory_name = p.signatory.name; fx.signatory_designation = p.signatory.designation; }
      // A parsed SC number that already exists is cleared so the suggestion stays
      if (fx.sales_contract_no && trades?.some((t) => t.sales_contract_no.toLowerCase() === fx.sales_contract_no.toLowerCase())) {
        toast.warning(`SC ${fx.sales_contract_no} already exists here. Keeping the suggested number.`);
        delete fx.sales_contract_no;
      }
      setV((s) => ({ ...s, ...Object.fromEntries(Object.entries(fx).filter(([, val]) => val)) }));
      if (p.notify.length) setNotify(p.notify);
      if (p.items.length) setItems(p.items.map((i) => ({ ...emptyItem(), ...i, rate_per_kg: "" })));
      setFreightUsd(p.freightUsd || "");
      const b = buyers.find((x) => x.name.toLowerCase() === (fx.importer_name ?? "").toLowerCase());
      setBuyerId(b?.id ?? "");
      toast.success(`Filled from ${f.name}. Check every field before submitting.`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setParsing(false);
      if (pdfRef.current) pdfRef.current.value = "";
    }
  }

  const goods = withRates(items);
  const freight = Number(freightUsd || 0);
  const freightLine: ItemLine | null = freight > 0 ? { ...emptyItem(), description: FREIGHT_LABEL, incoterm: "", quantity_kg: "1", rate_usd_per_kg: String(freight), rate_per_kg: String(freight) } : null;
  const allLines = freightLine ? [...goods, freightLine] : goods;
  const total = itemsTotal(allLines);
  const goodsUsd = r2(items.reduce((s, i) => s + Number(i.quantity_kg || 0) * Number(i.rate_usd_per_kg || 0), 0));
  const totalUsd = r2(goodsUsd + freight);
  const profile = profiles?.find((p) => p.id === profileId);

  const missing = REQUIRED.filter((f) => !v[f.key]?.trim()).map((f) => f.label.toLowerCase());
  if (!items.length || !items.every((i) => i.description.trim() && Number(i.quantity_kg) > 0 && Number(i.rate_usd_per_kg) > 0)) missing.push("complete item lines");
  const valid = missing.length === 0 && total > 0;
  const buyerIsNew = !buyerId && !!v.importer_name?.trim() && !buyers.some((b) => b.name.toLowerCase() === v.importer_name.trim().toLowerCase());

  const shipDays = useMemo(() => {
    if (!v.contract_date || !v.shipment_deadline) return null;
    const d = Math.round((new Date(v.shipment_deadline).getTime() - new Date(v.contract_date).getTime()) / 86400000);
    return d > 0 ? d : null;
  }, [v.contract_date, v.shipment_deadline]);

  async function submit() {
    setBusy("Saving trade");
    try {
      const notifyClean = notify.filter((n) => n.name.trim());
      let bId = buyerId || null;
      if (buyerIsNew && saveBuyer) {
        bId = await rpc<string>("save_buyer", {
          p: { name: v.importer_name, cr_no: v.buyer_cr_no, vat_no: v.buyer_vat_no, address: v.buyer_address, country: v.importer_country, point_of_entry: v.point_of_entry, notify_parties: notifyClean, is_active: true },
        });
      }
      const { signatory_name, signatory_designation, ...rest } = v;
      const data = {
        ...rest,
        shipment_timeline: rest.shipment_timeline || (v.shipment_deadline ? v.shipment_deadline.split("-").reverse().join("/") : ""),
        contract_amount_usd: totalUsd || null,
        notify_parties: notifyClean,
        company_profile_id: profileId || null,
        buyer_id: bId,
        contract_extra: { ...(signatory_name ? { signatory_name } : {}), ...(signatory_designation ? { signatory_designation } : {}) },
      };
      const id = await rpc<string>("create_trade", { p_data: data, p_items: allLines, p_file: null });

      setBusy("Saving documents");
      try {
        const sc = scDataFrom({ ...(data as Record<string, unknown>), exporter: v.exporter, importer_name: v.importer_name, sales_contract_no: v.sales_contract_no, contract_date: v.contract_date }, allLines, [], v.shipment_deadline);
        await saveGeneratedVersion(id, sc, 1, "Generated from the trade form", profile?.logo_path);
        if (file) {
          await rpc("add_contract_version", { p_trade: id, p_file: file, p_source: "uploaded", p_note: "Uploaded when the trade was created" });
          if (signed) {
            const { data: doc, error } = await supabase.from("contract_documents").select("id").eq("trade_id", id).eq("source", "uploaded").order("version", { ascending: false }).limit(1).single();
            if (error) throw error;
            await rpc("mark_contract_signed", { p_id: doc.id });
          }
        }
      } catch (e) {
        toast.error(`Trade saved, but the contract PDF failed: ${errMsg(e)}. Generate it from the Sales contract tab.`);
      }
      toast.success("Trade submitted for approval");
      refresh();
      navigate(`/trades/${id}?tab=contract`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Create trade"
        sub="Fill the contract details and submit. An admin approves the trade, and EXPs open once the signed copy is on file."
        actions={
          <>
            <input ref={pdfRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => autofill(e.target.files?.[0])} />
            <Button variant="outline" disabled={parsing} onClick={() => pdfRef.current?.click()}>
              {parsing ? <Loader2 className="animate-spin" /> : <FileUp />} Auto-fill from SC PDF
            </Button>
          </>
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Section step={1} title="Company profile" hint="Fills the exporter, bank, signatory and default terms. Manage profiles in Masters.">
            <Grid>
              <Field label="Profile">
                <Select value={profileId} onChange={(e) => { const p = profiles?.find((x) => x.id === e.target.value); if (p) applyProfile(p); }} placeholder={profiles?.length ? "Select" : "No profiles yet"}>
                  {(profiles ?? []).filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.label}{p.is_default ? " (default)" : ""}</option>)}
                </Select>
              </Field>
            </Grid>
          </Section>
          <Section step={2} title="Sales contract" hint="Core contract details">
            {fields(CONTRACT)}
            {shipDays && <p className="text-[0.7812rem] text-mut">Shipment period {shipDays} days. Follow-ups on day {[1, 2, 3, 4].map((k) => Math.round((shipDays * k) / 4)).join(", ")}.</p>}
          </Section>
          <Section step={3} title="Buyer (consignee)" hint="Pick a saved buyer or type a new one">
            <Grid>
              <Field label="Saved buyer">
                <Select value={buyerId} onChange={(e) => (e.target.value ? pickBuyer(e.target.value) : setBuyerId(""))} placeholder="New buyer">
                  {buyers.filter((b) => b.is_active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
            </Grid>
            {fields(BUYER)}
            {buyerIsNew && <Switch checked={saveBuyer} onChange={setSaveBuyer} label="Save this buyer to Masters" />}
          </Section>
          <Section step={4} title="Items" hint="All rates and amounts are in USD.">
            <Grid>
              <Field label="Freight (USD)" hint="Printed as Freight Cost (Subject to Change)">
                <Input type="number" inputMode="decimal" step="any" value={freightUsd} onChange={(e) => setFreightUsd(e.target.value)} placeholder="0" />
              </Field>
            </Grid>
            <ItemsEditor items={items} onChange={setItems} products={products} />
          </Section>
          <Section step={5} title="Exporter and signatory" hint="From the company profile. Edit if needed.">{fields(EXPORTER)}</Section>
          <Section step={6} title="Notify parties" hint="Add as many as the contract lists.">
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
          <Section step={7} title="Bank coordinates for receiving TT">{fields(BANK)}</Section>
          <Section step={8} title="Sales contract upload" hint="Optional. You can also upload it later from the trade page.">
            <FileField label="Sales contract copy" folder="trades/contracts" value={file} onChange={(f) => { setFile(f); if (!f) setSigned(false); }} />
            <label className={`flex items-center gap-2.5 text-[0.8125rem] ${file ? "" : "text-mut"}`}>
              <input type="checkbox" checked={signed} disabled={!file} onChange={(e) => setSigned(e.target.checked)} />
              Mark as signed (this is the copy signed by both parties)
            </label>
            <p className="text-[0.75rem] text-mut">EXPs open once the trade is approved and a signed copy is on file.</p>
          </Section>
        </div>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-20">
          <div className="card p-5">
            <div className="lbl mb-2">Review</div>
            <Row label="Profile" value={profile?.label ?? <span className="text-mut">Not set</span>} />
            <Row label="SC number" value={v.sales_contract_no || <span className="text-mut">Not set</span>} />
            <Row label="Buyer" value={v.importer_name || <span className="text-mut">Not set</span>} />
            <Row label="Destination" value={v.country_of_destination || v.importer_country || <span className="text-mut">Not set</span>} />
            <Row label="Items" value={<span className="num">{items.filter((i) => i.description.trim()).length}</span>} />
            {freight > 0 && <Row label="Freight" value={<span className="num">{money(freight)}</span>} />}
            <Row label="Sales contract copy" value={file ? <Chip label={signed ? "Signed" : "Attached"} tone="ok" /> : <Chip label="Later" tone="gray" />} />
            <div className="my-3 border-t border-line" />
            <div className="lbl">Total CFR amount</div>
            <div className="num mt-1 text-[1.75rem] font-semibold leading-tight">{money(totalUsd)}</div>
            {missing.length > 0 && <p className="mt-3 text-[0.7812rem] text-mut">Still needed: {missing.join(", ")}.</p>}
          </div>
          <Button className="h-11 w-full" disabled={!valid || !!busy} loading={!!busy} onClick={submit}>
            {!busy && <Send />} {busy ?? "Submit"}
          </Button>
          <p className="text-center text-[0.75rem] text-mut">An admin reviews the trade before EXPs can be added.</p>
        </aside>
      </div>
    </>
  );
}
