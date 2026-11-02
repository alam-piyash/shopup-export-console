import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ImageUp, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { rpc, uploadFile, useIsAdmin } from "@/lib/api";
import { loadLogo } from "@/lib/contractDocs";
import { errMsg } from "@/lib/format";
import { useBuyers, useCompanyProfiles, useProducts, type Notify } from "@/lib/masters";
import { Button, Chip, Empty, Field, Grid, Input, LoadingRows, Modal, PageHeader, Panel, Segments, Select, Switch, Textarea } from "@/components/ui";

type Tab = "profiles" | "buyers" | "products";
type Def = { key: string; label: string; type?: "text" | "number" | "textarea" | "select"; options?: string[]; required?: boolean; placeholder?: string; wide?: boolean };

const PROFILE_FIELDS: Def[] = [
  { key: "label", label: "Profile name", required: true, placeholder: "Unicorn Distribution (Eastern Bank)" },
  { key: "legal_name", label: "Company legal name", required: true },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "address", label: "Address", type: "textarea", wide: true },
  { key: "signatory_name", label: "Authorised signatory" },
  { key: "signatory_designation", label: "Signatory designation" },
  { key: "sc_prefix", label: "SC number prefix", placeholder: "VEG/SU/" },
  { key: "shipping_mark", label: "Shipping mark" },
  { key: "bank_name", label: "Bank name" },
  { key: "bank_branch", label: "Branch" },
  { key: "bank_routing_no", label: "Routing number" },
  { key: "bank_swift", label: "SWIFT code" },
  { key: "bank_account_name", label: "Account name" },
  { key: "bank_account_no", label: "Account number" },
  { key: "t_country_of_origin", label: "Default country of origin" },
  { key: "t_carriage_by", label: "Default carriage", type: "select", options: ["Air", "Sea", "Road"] },
  { key: "t_departure_port", label: "Default departure port" },
  { key: "t_tolerance_pct", label: "Default tolerance (%)", type: "number" },
  { key: "t_payment_terms", label: "Default terms of delivery and payment", type: "textarea", wide: true },
];
const BUYER_FIELDS: Def[] = [
  { key: "name", label: "Buyer name", required: true },
  { key: "country", label: "Country", placeholder: "KSA" },
  { key: "cr_no", label: "CR number" },
  { key: "vat_no", label: "VAT registration number" },
  { key: "point_of_entry", label: "Point of entry", wide: true },
  { key: "address", label: "Address", type: "textarea", wide: true },
];
const PRODUCT_FIELDS: Def[] = [
  { key: "description", label: "Description", required: true, placeholder: "FRESH BETEL LEAVES" },
  { key: "hs_code", label: "HS code", placeholder: "1404 90 92" },
  { key: "carton_size", label: "Carton size", placeholder: "1 KG x 9 PCS" },
  { key: "incoterm", label: "Incoterm", placeholder: "CFR" },
  { key: "rate_usd_per_kg", label: "Usual rate per KG (USD)", type: "number" },
];

type Rec = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function useLogoPreview(path?: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    if (path) loadLogo(path).then((l) => live && setSrc(l?.data ?? null));
    return () => { live = false; };
  }, [path]);
  return src;
}

function LogoThumb({ path }: { path?: string | null }) {
  const src = useLogoPreview(path);
  if (!path) return <span className="text-mut">None</span>;
  return src ? <img src={src} alt="" className="h-7 max-w-[4.5rem] object-contain" /> : <span className="text-mut">Loading</span>;
}

/** Logo upload for a company profile. Printed at the top left of generated sales contracts. */
function LogoField({ path, name, onChange }: { path?: string; name?: string; onChange: (path: string, name: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const src = useLogoPreview(path);
  async function pick(f?: File) {
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(f.type)) { toast.error("Use a PNG, JPG, WEBP or SVG image"); return; }
    if (f.size > 2 * 1024 * 1024) { toast.error("Logo must be under 2 MB"); return; }
    setBusy(true);
    try {
      const up = await uploadFile(f, "company/logos");
      onChange(up.path, up.name);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }
  return (
    <div className="flex items-center gap-4 rounded-xl border border-line bg-bg p-3.5">
      <div className="grid h-16 w-28 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-white">
        {path ? (src ? <img src={src} alt="Company logo" className="max-h-14 max-w-[6.5rem] object-contain" /> : <Loader2 className="size-4 animate-spin text-mut" />) : <ImageUp className="size-5 text-mut" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[0.8438rem] font-medium">Company logo</div>
        <div className="truncate text-[0.75rem] text-mut">{path ? name || "Logo uploaded" : "Printed at the top left of generated sales contracts. PNG, JPG, WEBP or SVG, under 2 MB."}</div>
      </div>
      <input ref={ref} type="file" className="hidden" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => pick(e.target.files?.[0])} />
      {path && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onChange("", "")} aria-label="Remove logo"><X /></Button>}
      <Button variant="outline" size="sm" disabled={busy} onClick={() => ref.current?.click()}>{busy ? <Loader2 className="animate-spin" /> : <ImageUp />} {path ? "Replace" : "Upload"}</Button>
    </div>
  );
}

function toForm(tab: Tab, r: Rec | null): Record<string, string> {
  if (!r) return tab === "products" ? { incoterm: "CFR" } : {};
  const f: Record<string, string> = {};
  Object.entries(r).forEach(([k, v]) => { if (typeof v !== "object") f[k] = str(v); });
  if (tab === "profiles") {
    const t = (r.default_terms ?? {}) as Rec;
    ["country_of_origin", "carriage_by", "departure_port", "tolerance_pct", "payment_terms"].forEach((k) => (f[`t_${k}`] = str(t[k])));
  }
  return f;
}

export default function Masters() {
  const isAdmin = useIsAdmin();
  const [tab, setTab] = useState<Tab>("profiles");
  const profiles = useCompanyProfiles();
  const buyers = useBuyers();
  const products = useProducts();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<{ tab: Tab; rec: Rec | null } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [notify, setNotify] = useState<Notify[]>([]);
  const [active, setActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);

  function open(t: Tab, rec: Rec | null) {
    setEdit({ tab: t, rec });
    setForm(toForm(t, rec));
    const n = t === "buyers" ? (rec?.notify_parties as Notify[]) : ((rec?.default_terms as Rec | undefined)?.notify_parties as Notify[]);
    setNotify(Array.isArray(n) ? n : []);
    setActive(rec ? rec.is_active !== false : true);
    setIsDefault(!!rec?.is_default);
  }

  async function save() {
    if (!edit) return;
    setBusy(true);
    try {
      const base: Rec = { ...form, id: edit.rec?.id ?? null, is_active: active };
      const cleanNotify = notify.filter((n) => n.name.trim());
      if (edit.tab === "profiles") {
        const terms: Rec = { notify_parties: cleanNotify };
        ["country_of_origin", "carriage_by", "departure_port", "payment_terms"].forEach((k) => { if (form[`t_${k}`]?.trim()) terms[k] = form[`t_${k}`].trim(); });
        if (form.t_tolerance_pct) terms.tolerance_pct = Number(form.t_tolerance_pct);
        await rpc("save_company_profile", { p: { ...base, default_terms: terms, is_default: isDefault } });
        qc.invalidateQueries({ queryKey: ["company_profiles"] });
      } else if (edit.tab === "buyers") {
        await rpc("save_buyer", { p: { ...base, notify_parties: cleanNotify } });
        qc.invalidateQueries({ queryKey: ["buyers"] });
      } else {
        await rpc("save_product", { p: base });
        qc.invalidateQueries({ queryKey: ["products"] });
      }
      toast.success("Saved");
      setEdit(null);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const defs = edit?.tab === "profiles" ? PROFILE_FIELDS : edit?.tab === "buyers" ? BUYER_FIELDS : PRODUCT_FIELDS;
  const canEdit = tab !== "profiles" || isAdmin;
  const missing = defs.filter((d) => d.required && !form[d.key]?.trim());

  return (
    <>
      <PageHeader
        title="Masters"
        sub="Saved company profiles, buyers and products. Trade forms and generated sales contracts fill from here."
        actions={canEdit && <Button onClick={() => open(tab, null)}><Plus /> {tab === "profiles" ? "Add profile" : tab === "buyers" ? "Add buyer" : "Add product"}</Button>}
      />
      <Panel
        title={
          <Segments
            value={tab}
            onChange={setTab}
            options={[
              { value: "profiles", label: "Company profiles", count: profiles.data?.length },
              { value: "buyers", label: "Buyers", count: buyers.data?.length },
              { value: "products", label: "Products", count: products.data?.length },
            ]}
          />
        }
        right={tab === "profiles" && !isAdmin ? <span className="text-[0.75rem] text-mut">Only admins can edit company profiles</span> : undefined}
      >
        {tab === "profiles" && (profiles.isLoading ? <LoadingRows /> : !profiles.data?.length ? <Empty title="No company profiles yet" /> : (
          <div className="scroll-thin overflow-x-auto">
            <table className="tbl min-w-[56rem]">
              <thead><tr><th>Logo</th><th>Profile</th><th>Company</th><th>Bank</th><th>Account</th><th>SC prefix</th><th>Signatory</th><th>Status</th></tr></thead>
              <tbody>
                {profiles.data.map((p) => (
                  <tr key={p.id} className={canEdit ? "cursor-pointer" : undefined} onClick={() => canEdit && open("profiles", p as unknown as Rec)}>
                    <td><LogoThumb path={p.logo_path} /></td>
                    <td className="font-medium">{p.label}</td>
                    <td>{p.legal_name}</td>
                    <td>{[p.bank_name, p.bank_branch].filter(Boolean).join(", ")}</td>
                    <td className="code-id">{p.bank_account_no}</td>
                    <td className="code-id">{p.sc_prefix}</td>
                    <td>{p.signatory_name}</td>
                    <td>{p.is_default ? <Chip label="Default" tone="info" dot={false} /> : p.is_active ? <Chip label="Active" tone="ok" dot={false} /> : <Chip label="Archived" tone="gray" dot={false} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {tab === "buyers" && (buyers.isLoading ? <LoadingRows /> : !buyers.data?.length ? <Empty title="No buyers yet" body="Buyers you add here can be picked on the trade form." /> : (
          <div className="scroll-thin overflow-x-auto">
            <table className="tbl min-w-[56rem]">
              <thead><tr><th>Buyer</th><th>Country</th><th>CR number</th><th>VAT number</th><th>Point of entry</th><th>Notify parties</th><th>Status</th></tr></thead>
              <tbody>
                {buyers.data.map((b) => (
                  <tr key={b.id} className="cursor-pointer" onClick={() => open("buyers", b as unknown as Rec)}>
                    <td className="font-medium">{b.name}</td>
                    <td>{b.country}</td>
                    <td className="num">{b.cr_no}</td>
                    <td className="num">{b.vat_no}</td>
                    <td className="max-w-[14rem] truncate">{b.point_of_entry}</td>
                    <td className="num">{b.notify_parties?.length || 0}</td>
                    <td>{b.is_active ? <Chip label="Active" tone="ok" dot={false} /> : <Chip label="Archived" tone="gray" dot={false} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {tab === "products" && (products.isLoading ? <LoadingRows /> : !products.data?.length ? <Empty title="No products yet" /> : (
          <div className="scroll-thin overflow-x-auto">
            <table className="tbl min-w-[48rem]">
              <thead><tr><th>Description</th><th>HS code</th><th>Carton size</th><th>Incoterm</th><th>Usual rate (USD/KG)</th><th>Status</th></tr></thead>
              <tbody>
                {products.data.map((p) => (
                  <tr key={p.id} className="cursor-pointer" onClick={() => open("products", p as unknown as Rec)}>
                    <td className="font-medium">{p.description}</td>
                    <td className="code-id">{p.hs_code}</td>
                    <td>{p.carton_size}</td>
                    <td>{p.incoterm}</td>
                    <td className="num">{p.rate_usd_per_kg ? `$${Number(p.rate_usd_per_kg).toFixed(2)}` : ""}</td>
                    <td>{p.is_active ? <Chip label="Active" tone="ok" dot={false} /> : <Chip label="Archived" tone="gray" dot={false} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Panel>

      <Modal
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        wide
        title={`${edit?.rec ? "Edit" : "Add"} ${edit?.tab === "profiles" ? "company profile" : edit?.tab === "buyers" ? "buyer" : "product"}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button disabled={missing.length > 0} loading={busy} onClick={save}>Save</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {edit?.tab === "profiles" && (
            <LogoField path={form.logo_path} name={form.logo_name} onChange={(path, name) => setForm((s) => ({ ...s, logo_path: path, logo_name: name }))} />
          )}
          <Grid>
            {defs.map((d) => (
              <Field key={d.key} label={d.label} required={d.required} className={d.wide || d.type === "textarea" ? "sm:col-span-2" : undefined}>
                {d.type === "textarea" ? (
                  <Textarea rows={2} value={form[d.key] ?? ""} onChange={(e) => setForm((s) => ({ ...s, [d.key]: e.target.value }))} placeholder={d.placeholder} />
                ) : d.type === "select" ? (
                  <Select value={form[d.key] ?? ""} onChange={(e) => setForm((s) => ({ ...s, [d.key]: e.target.value }))} placeholder="Select">
                    {d.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                  </Select>
                ) : (
                  <Input type={d.type === "number" ? "number" : "text"} step={d.type === "number" ? "any" : undefined} value={form[d.key] ?? ""} onChange={(e) => setForm((s) => ({ ...s, [d.key]: e.target.value }))} placeholder={d.placeholder} />
                )}
              </Field>
            ))}
          </Grid>
          {edit?.tab !== "products" && (
            <div className="flex flex-col gap-2">
              <div className="text-[0.8125rem] font-medium">{edit?.tab === "profiles" ? "Default notify parties" : "Notify parties"}</div>
              {notify.map((n, i) => (
                <div key={i} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_2fr_auto]">
                  <Input placeholder="Name" value={n.name} onChange={(e) => setNotify((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <Input placeholder="Address" value={n.address} onChange={(e) => setNotify((s) => s.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))} />
                  <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setNotify((s) => s.filter((_, j) => j !== i))} aria-label="Remove notify party"><Trash2 /></Button>
                </div>
              ))}
              <div><Button variant="outline" size="sm" onClick={() => setNotify((s) => [...s, { name: "", address: "" }])}><Plus /> Add notify party</Button></div>
            </div>
          )}
          <div className="flex flex-wrap gap-6">
            {edit?.tab === "profiles" && <span className="flex items-center gap-2 text-[0.8125rem]"><Switch checked={isDefault} onChange={setIsDefault} label="Default profile for new trades" />Default profile for new trades</span>}
            <span className="flex items-center gap-2 text-[0.8125rem]"><Switch checked={active} onChange={setActive} label="Active" />Active</span>
          </div>
        </div>
      </Modal>
    </>
  );
}
