import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2, Pencil, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { rpc, uploadFile, useRefresh } from "@/lib/api";
import { errMsg, fmtDate, money } from "@/lib/format";
import { isFreight } from "@/lib/masters";
import { buildCiPdf, dmy, packingRows, readTtNotifyParty, type CiData } from "@/lib/commercialInvoice";
import type { Exp, ExpDoc } from "@/lib/types";
import { Button, Field, Input, Modal, Textarea, cn } from "./ui";

/** Document types that have a template the console can fill. */
export const CI_DOCS = ["Commercial Invoice", "Packing List"];

const remember = (k: string, v?: string) => {
  try {
    if (v === undefined) return localStorage.getItem(`ci-${k}`) ?? "";
    localStorage.setItem(`ci-${k}`, v);
  } catch { /* storage may be blocked */ }
  return "";
};

type TradeRow = {
  code: string; sales_contract_no: string; contract_date: string; exporter: string; exporter_address: string | null;
  importer_name: string; buyer_address: string | null; buyer_cr_no: string | null; buyer_vat_no: string | null;
  departure_port: string | null; country_of_destination: string | null; country_of_origin: string | null; shipping_mark: string | null; products: string | null;
};

async function loadSources(exp: Exp) {
  const [{ data: trade, error: te }, { data: items, error: ie }, { data: links }] = await Promise.all([
    supabase.from("trades").select("code, sales_contract_no, contract_date, exporter, exporter_address, importer_name, buyer_address, buyer_cr_no, buyer_vat_no, departure_port, country_of_destination, country_of_origin, shipping_mark, products").eq("id", exp.trade_id).single(),
    supabase.from("trade_items").select("description, quantity_kg").eq("trade_id", exp.trade_id).order("sort_order"),
    supabase.from("collection_exps").select("collection_id, collections(status, created_at)").eq("exp_id", exp.id),
  ]);
  if (te) throw te;
  if (ie) throw ie;
  if (!trade) throw new Error("Trade not found for this EXP");
  // TT voucher on the EXP's collection (pending or approved), newest first
  const cols = ((links ?? []) as unknown as { collection_id: string; collections: { status: string; created_at: string } | null }[])
    .filter((l) => l.collections && l.collections.status !== "rejected")
    .sort((a, b) => (b.collections!.created_at > a.collections!.created_at ? 1 : -1));
  let tt: { path: string; name: string } | null = null;
  for (const c of cols) {
    const { data: d } = await supabase.from("documents").select("file_path, file_name").eq("entity_type", "collection").eq("entity_id", c.collection_id).eq("doc_type", "TT Voucher").maybeSingle();
    if (d?.file_path) { tt = { path: d.file_path, name: d.file_name }; break; }
    const { data: a } = await supabase.from("attachments").select("file_path, file_name").eq("entity_type", "collection").eq("entity_id", c.collection_id).eq("doc_type", "TT Voucher").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (a?.file_path) { tt = { path: a.file_path, name: a.file_name }; break; }
  }
  let notify: string[] | null = null;
  if (tt) {
    try {
      const { data: blob } = await supabase.storage.from("documents").download(tt.path);
      if (blob) notify = await readTtNotifyParty(blob);
    } catch { notify = null; }
  }
  return { trade: trade as TradeRow, items: ((items ?? []) as { description: string; quantity_kg: number }[]).filter((i) => !isFreight(i.description)), tt, notify };
}

export function GenerateCiDialog({ exp, docs, onClose, onEditExp }: { exp: Exp; docs: ExpDoc[]; onClose: () => void; onEditExp?: () => void }) {
  const refresh = useRefresh();
  const { data: src, isLoading, error } = useQuery({ queryKey: ["ci-sources", exp.id], queryFn: () => loadSources(exp) });
  const [withNotify, setWithNotify] = useState(false);
  const [notifyText, setNotifyText] = useState("");
  const [goods, setGoods] = useState("");
  const [cartons, setCartons] = useState(exp.cartons ? String(exp.cartons) : "");
  const [gross, setGross] = useState(exp.gross_weight ? String(Number(exp.gross_weight)) : "");
  const [net, setNet] = useState(exp.quantity ? String(Number(exp.quantity)) : "");
  const [erc, setErc] = useState(remember("erc") || "260326210606923");
  const [vat, setVat] = useState(remember("vat") || "002726427-0101");
  const [prefix, setPrefix] = useState(remember("exp-prefix") || "1475");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  /** Per item: included, and the KG from the Plants sheet (defaults to the contract quantity). */
  const [lineKg, setLineKg] = useState<Record<number, string>>({});
  const [skip, setSkip] = useState<number[]>([]);

  useEffect(() => {
    if (!src) return;
    setGoods((g) => g || (src.items.length === 1 ? src.items[0].description : src.trade.products || ""));
    if (src.notify) { setNotifyText((t) => t || src.notify!.join("\n")); setWithNotify(true); }
  }, [src]);

  const netKg = Number(net || 0), ctn = Number(cartons || 0), grossKg = Number(gross || 0);
  const allLines = useMemo(() => (src?.items ?? []).map((i) => ({ description: i.description, qty: Number(i.quantity_kg || 0) })), [src]);
  const lines = allLines.map((l, i) => ({ ...l, qty: lineKg[i] !== undefined ? Number(lineKg[i] || 0) : l.qty })).filter((_, i) => !skip.includes(i));
  const { rows, scalePct } = packingRows(lines.length ? lines : [{ description: goods || "Goods", qty: netKg || 1 }], netKg, ctn, grossKg);
  const expNo = exp.exp_serial && exp.exp_year ? [prefix.trim(), exp.exp_serial, exp.exp_year].filter(Boolean).join("-") : exp.exp_no ?? "";

  /** EXP fields the document prints; fixed on the EXP itself. */
  const fromExp = [
    { label: "Invoice No", ok: !!exp.invoice_no },
    { label: "Invoice Date", ok: !!exp.invoice_date },
    { label: "EXP Serial and Year", ok: !!expNo },
    { label: "Trans Doc No (AWB)", ok: !!exp.awb_no },
    { label: "Trans Doc Date", ok: !!exp.trans_doc_date },
    { label: "Ship Date", ok: !!exp.shipment_date },
  ];
  const expGaps = fromExp.filter((f) => !f.ok).map((f) => f.label);
  const here = [
    !(ctn > 0) && "Cartons",
    !(netKg > 0) && "Net weight",
    !(grossKg > 0) && "Gross weight",
    grossKg > 0 && netKg > 0 && grossKg <= netKg && "Gross weight above net",
    !goods.trim() && "Description of goods",
    withNotify && !notifyText.trim() && "Notify party",
  ].filter(Boolean) as string[];
  const missing = [...expGaps, ...here];

  const data: CiData | null = useMemo(() => {
    if (!src) return null;
    const t = src.trade;
    return {
      consignee: [t.importer_name, [t.buyer_cr_no && `CR NO: ${t.buyer_cr_no}`, t.buyer_vat_no && `VAT NO: ${t.buyer_vat_no}`].filter(Boolean).join(", "), ...(t.buyer_address ?? "").split(/\n/)].filter((x) => x && x.trim()),
      shipper: [t.exporter.toUpperCase(), ...(t.exporter_address ?? "").split(/\n/)].filter((x) => x && x.trim()),
      notify: withNotify ? notifyText.split(/\n/).map((x) => x.trim()).filter(Boolean) : null,
      ercNo: erc.trim() || undefined,
      vatNo: vat.trim() || undefined,
      invoiceNo: exp.invoice_no ?? "",
      invoiceDate: exp.invoice_date,
      contractNo: exp.lc_contract || t.sales_contract_no,
      contractDate: t.contract_date,
      portOfLoading: t.departure_port,
      finalDestination: t.country_of_destination,
      countryOfOrigin: t.country_of_origin,
      shippingMarks: t.shipping_mark,
      goodsDescription: goods.trim(),
      cartons: ctn,
      netKg,
      grossKg,
      amount: Number(exp.amount),
      items: rows,
      expNo,
      expDate: exp.entry_date,
      awbNo: exp.awb_no,
      awbDate: exp.trans_doc_date,
      flightNo: exp.flight_no || exp.carrier,
      flightDate: exp.shipment_date,
      signFor: t.exporter,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, withNotify, notifyText, erc, vat, goods, ctn, netKg, grossKg, JSON.stringify(rows), expNo, exp]);

  // live preview, rebuilt shortly after the last change
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    setRendering(true);
    const t = setTimeout(async () => {
      try {
        const blob = await buildCiPdf(data);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setPreview((old) => { if (old) URL.revokeObjectURL(old); return url; });
      } catch { /* the preview is best effort */ } finally {
        if (!cancelled) setRendering(false);
      }
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
  }, [data]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function generate() {
    if (!data) return;
    setBusy(true);
    try {
      remember("erc", erc); remember("vat", vat); remember("exp-prefix", prefix);
      const blob = await buildCiPdf(data);
      const serial = (exp.exp_serial ?? exp.code).replace(/^0+/, "");
      const file = new File([blob], `${serial}${withNotify ? "-notify-party" : ""}.pdf`, { type: "application/pdf" });
      const up = await uploadFile(file, "exps/generated");
      const stage = withNotify ? "Generated, with notify party" : "Generated";
      const targets = docs.filter((d) => CI_DOCS.includes(d.doc_type) && d.status !== "final");
      for (const d of targets) {
        await rpc("upload_exp_document", { p_doc: d.id, p_file: up, p_stage: stage, p_note: "Commercial Invoice and Packing List on one page", p_submitted_on: null });
      }
      // keep cartons and gross weight on the EXP for next time
      const keep: Record<string, string> = {};
      if (String(exp.cartons ?? "") !== String(ctn)) keep.cartons = String(ctn);
      if (Number(exp.gross_weight ?? 0) !== grossKg) keep.gross_weight = String(grossKg);
      if (Object.keys(keep).length) await rpc("update_exp", { p_id: exp.id, p_amount: null, p_fields: keep }).catch(() => undefined);
      const url = URL.createObjectURL(blob);
      toast.success(`Saved as a new version of ${targets.map((d) => d.doc_type).join(" and ")}`, { action: { label: "Open PDF", onClick: () => window.open(url, "_blank") }, duration: 8000 });
      refresh();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const finalAlready = docs.filter((d) => CI_DOCS.includes(d.doc_type) && d.status === "final").map((d) => d.doc_type);

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      xwide
      title="Generate Commercial Invoice and Packing List"
      description="Built from this EXP and its trade. The preview updates as you type."
      footer={
        <>
          <span className="mr-auto self-center text-[0.75rem] text-mut">
            {missing.length ? <>Still needed: <span className="text-fg">{missing.join(", ")}</span></> : "Ready. Saved as a new version of both documents."}
          </span>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={isLoading || missing.length > 0} loading={busy} onClick={generate}>{!busy && <WandSparkles />} Save PDF</Button>
        </>
      }
    >
      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-mut"><Loader2 className="size-4 animate-spin" /> Reading the trade and the TT voucher</div>
      ) : error || !src ? (
        <p className="text-bad">{errMsg(error)}</p>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-raised p-1">
              {[
                { v: false, label: "Standard", sub: "Without notify party" },
                { v: true, label: "With notify party", sub: src.tt ? "From the TT voucher" : "Needs a TT Voucher on the collection" },
              ].map((o) => (
                <button key={o.label} type="button" disabled={o.v && !src.tt && !notifyText} onClick={() => setWithNotify(o.v)} aria-pressed={withNotify === o.v}
                  className={cn("rounded-lg px-3 py-1.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40", withNotify === o.v ? "bg-surface shadow-sm ring-1 ring-line" : "text-mut hover:text-fg")}>
                  <div className="text-[0.8438rem] font-medium">{o.label}</div>
                  <div className="text-[0.7188rem] text-mut">{o.sub}</div>
                </button>
              ))}
            </div>
            {withNotify && (
              <Field label="Notify party" hint={src.notify ? `Read from field 50K of ${src.tt?.name}. Edit if needed.` : src.tt ? "Could not read field 50K from the TT voucher. Type it in." : undefined}>
                <Textarea rows={3} value={notifyText} onChange={(e) => setNotifyText(e.target.value)} />
              </Field>
            )}

            {expGaps.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warn/40 bg-warn/[0.06] px-3.5 py-2.5 text-[0.8125rem]">
                <span>Missing on the EXP: {expGaps.join(", ")}</span>
                {onEditExp && <Button size="sm" variant="outline" onClick={onEditExp}><Pencil /> Edit EXP</Button>}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Description of goods" className="col-span-2"><Input value={goods} onChange={(e) => setGoods(e.target.value)} /></Field>
              <Field label="Cartons" required hint={exp.cartons ? "From the EXP" : "BoE box 31"}><Input type="number" inputMode="numeric" value={cartons} onChange={(e) => setCartons(e.target.value)} autoFocus={!exp.cartons} /></Field>
              <Field label="Net weight (KG)" required hint="EXP Quantity"><Input type="number" inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} /></Field>
              <Field label="Gross weight (KG)" required hint={exp.gross_weight ? "From the EXP" : "BoE box 35"}><Input type="number" inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} /></Field>
              <Field label="Invoice amount"><Input className="num" value={money(exp.amount)} disabled /></Field>
            </div>

            {allLines.length > 1 && (
              <details className="rounded-xl border border-line">
                <summary className="cursor-pointer px-3.5 py-2.5 text-[0.8125rem] font-medium">
                  Items on this shipment <span className="font-normal text-mut">({lines.length} of {allLines.length})</span>
                  {Object.keys(lineKg).length > 0 && netKg > 0 && Math.abs(scalePct) > 10 && <span className="ml-2 font-normal text-warn">KG scaled {Math.abs(scalePct)}%, check it</span>}
                </summary>
                <div className="border-t border-line px-3.5 py-2.5">
                  <p className="mb-2 text-[0.75rem] text-mut">Untick items not shipped. Type the KG from the Plants sheet if you have it; weights scale to the net weight, and cartons and gross split to match the totals.</p>
                  <div className="flex flex-col gap-2">
                    {allLines.map((l, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input type="checkbox" checked={!skip.includes(i)} onChange={(e) => setSkip((s) => (e.target.checked ? s.filter((x) => x !== i) : [...s, i]))} aria-label={`Include ${l.description}`} />
                        <span className="min-w-0 flex-1 truncate text-[0.8125rem]">{l.description}</span>
                        <Input className="h-8 w-28 text-right" type="number" inputMode="decimal" disabled={skip.includes(i)} value={lineKg[i] ?? ""} placeholder={`${l.qty} KG`} onChange={(e) => setLineKg((s) => ({ ...s, [i]: e.target.value }))} />
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            )}

            <details className="rounded-xl border border-line">
              <summary className="cursor-pointer px-3.5 py-2.5 text-[0.8125rem] font-medium">Exporter details <span className="font-normal text-mut">ERC, VAT, EXP prefix</span></summary>
              <div className="grid grid-cols-1 gap-3 border-t border-line px-3.5 py-3 sm:grid-cols-3">
                <Field label="ERC NO"><Input value={erc} onChange={(e) => setErc(e.target.value)} /></Field>
                <Field label="VAT NO"><Input value={vat} onChange={(e) => setVat(e.target.value)} /></Field>
                <Field label="EXP NO prefix" hint={expNo ? `Prints ${expNo}` : undefined}><Input value={prefix} onChange={(e) => setPrefix(e.target.value)} /></Field>
              </div>
            </details>
            {finalAlready.length > 0 && <p className="text-[0.75rem] text-mut">{finalAlready.join(" and ")} {finalAlready.length > 1 ? "are" : "is"} already final and will not get a new version.</p>}
          </div>

          <div className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-0">
            <div className="flex items-center justify-between text-[0.75rem] text-mut">
              <span className="flex items-center gap-1.5"><FileText className="size-3.5" /> Preview{missing.length ? " (draft, some fields still empty)" : ""}</span>
              {rendering && <span className="flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Updating</span>}
            </div>
            <div className="overflow-hidden rounded-xl border border-line bg-white">
              {preview ? <iframe title="Commercial Invoice preview" src={`${preview}#toolbar=0&navpanes=0&view=FitH`} className="h-[34rem] w-full" /> : <div className="grid h-[34rem] place-items-center text-[0.8125rem] text-mut">Building the preview</div>}
            </div>
            <div className="text-[0.7188rem] text-mut">Contract {exp.lc_contract || src.trade.sales_contract_no} · {dmy(src.trade.contract_date)} · Destination {src.trade.country_of_destination || "not set"} · Marks {src.trade.shipping_mark || "not set"}{exp.shipment_date ? ` · Shipped ${fmtDate(exp.shipment_date)}` : ""}</div>
          </div>
        </div>
      )}
    </Modal>
  );
}
