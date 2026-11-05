import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2, WandSparkles } from "lucide-react";
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

export function GenerateCiDialog({ exp, docs, onClose }: { exp: Exp; docs: ExpDoc[]; onClose: () => void }) {
  const refresh = useRefresh();
  const { data: src, isLoading, error } = useQuery({ queryKey: ["ci-sources", exp.id], queryFn: () => loadSources(exp) });
  const [withNotify, setWithNotify] = useState(false);
  const [notifyText, setNotifyText] = useState("");
  const [goods, setGoods] = useState("");
  const [cartons, setCartons] = useState("");
  const [gross, setGross] = useState("");
  const [net, setNet] = useState(exp.quantity ? String(Number(exp.quantity)) : "");
  const [erc, setErc] = useState(remember("erc") || "260326210606923");
  const [vat, setVat] = useState(remember("vat") || "002726427-0101");
  const [prefix, setPrefix] = useState(remember("exp-prefix") || "1475");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!src) return;
    setGoods((g) => g || (src.items.length === 1 ? src.items[0].description : src.trade.products || ""));
    if (src.notify) { setNotifyText((t) => t || src.notify!.join("\n")); setWithNotify(true); }
  }, [src]);

  const netKg = Number(net || 0), ctn = Number(cartons || 0), grossKg = Number(gross || 0);
  const lines = useMemo(() => (src?.items ?? []).map((i) => ({ description: i.description, qty: Number(i.quantity_kg || 0) })), [src]);
  const { rows, scalePct } = packingRows(lines.length ? lines : [{ description: goods || "Goods", qty: netKg || 1 }], netKg, ctn, grossKg);
  const expNo = exp.exp_serial && exp.exp_year ? [prefix.trim(), exp.exp_serial, exp.exp_year].filter(Boolean).join("-") : exp.exp_no ?? "";

  const missing = [
    !exp.invoice_no && "Invoice No",
    !exp.invoice_date && "Invoice Date",
    !expNo && "EXP Serial and Year",
    !exp.awb_no && "Trans Doc No (AWB)",
    !exp.trans_doc_date && "Trans Doc Date",
    !exp.shipment_date && "Ship Date",
    !(netKg > 0) && "Net weight",
    !(ctn > 0) && "Cartons",
    !(grossKg > 0) && "Gross weight",
    grossKg > 0 && netKg > 0 && grossKg <= netKg && "Gross weight above net",
    !goods.trim() && "Description of goods",
    withNotify && !notifyText.trim() && "Notify party",
  ].filter(Boolean) as string[];

  async function generate() {
    if (!src) return;
    setBusy(true);
    try {
      remember("erc", erc); remember("vat", vat); remember("exp-prefix", prefix);
      const t = src.trade;
      const data: CiData = {
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
      const blob = await buildCiPdf(data);
      const serial = (exp.exp_serial ?? exp.code).replace(/^0+/, "");
      const file = new File([blob], `${serial}${withNotify ? "-notify-party" : ""}.pdf`, { type: "application/pdf" });
      const up = await uploadFile(file, "exps/generated");
      const stage = withNotify ? "Generated, with notify party" : "Generated";
      const targets = docs.filter((d) => CI_DOCS.includes(d.doc_type) && d.status !== "final");
      for (const d of targets) {
        await rpc("upload_exp_document", { p_doc: d.id, p_file: up, p_stage: stage, p_note: "Commercial Invoice and Packing List on one page", p_submitted_on: null });
      }
      toast.success(`Generated and added to ${targets.map((d) => d.doc_type).join(" and ")}`);
      refresh();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      xwide
      title="Generate Commercial Invoice and Packing List"
      description="Built from this EXP and its trade, on one page. Saved as a new version of both documents."
      footer={
        <>
          {missing.length > 0 && <span className="mr-auto self-center text-[0.75rem] text-mut">Still needed: {missing.join(", ")}</span>}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={isLoading || missing.length > 0} loading={busy} onClick={generate}>{!busy && <WandSparkles />} Generate PDF</Button>
        </>
      }
    >
      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-mut"><Loader2 className="size-4 animate-spin" /> Reading the trade and the TT voucher</div>
      ) : error || !src ? (
        <p className="text-bad">{errMsg(error)}</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-raised p-1">
            {[
              { v: false, label: "Regular", sub: "Without notify party" },
              { v: true, label: "With notify party", sub: src.tt ? "For the bank's incentive file" : "Needs a TT Voucher on the EXP's collection" },
            ].map((o) => (
              <button key={o.label} type="button" disabled={o.v && !src.tt && !notifyText} onClick={() => setWithNotify(o.v)}
                className={cn("rounded-lg px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40", withNotify === o.v ? "bg-surface shadow-sm ring-1 ring-line" : "text-mut hover:text-fg")}>
                <div className="text-[0.8438rem] font-medium">{o.label}</div>
                <div className="text-[0.7188rem] text-mut">{o.sub}</div>
              </button>
            ))}
          </div>
          {withNotify && (
            <Field label="Notify party" hint={src.notify ? `Read from field 50K (Ordering Customer) of ${src.tt?.name}. Edit if needed.` : src.tt ? "Could not read field 50K from the TT voucher. Type it in." : undefined}>
              <Textarea rows={4} value={notifyText} onChange={(e) => setNotifyText(e.target.value)} />
            </Field>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Description of goods" className="sm:col-span-2"><Input value={goods} onChange={(e) => setGoods(e.target.value)} /></Field>
            <Field label="No. of cartons" required><Input type="number" inputMode="numeric" value={cartons} onChange={(e) => setCartons(e.target.value)} placeholder="BoE box 31" /></Field>
            <Field label="Invoice amount"><Input className="num" value={money(exp.amount)} disabled /></Field>
            <Field label="Net weight (KG)" required hint="EXP Quantity"><Input type="number" inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} placeholder="BoE box 38" /></Field>
            <Field label="Gross weight (KG)" required><Input type="number" inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="BoE box 35" /></Field>
            <Field label="ERC NO"><Input value={erc} onChange={(e) => setErc(e.target.value)} /></Field>
            <Field label="VAT NO"><Input value={vat} onChange={(e) => setVat(e.target.value)} /></Field>
            <Field label="EXP NO prefix" hint={expNo ? `Prints ${expNo}` : undefined}><Input value={prefix} onChange={(e) => setPrefix(e.target.value)} /></Field>
          </div>
          <div className="rounded-xl border border-line">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2.5 text-[0.8125rem]">
              <span className="flex items-center gap-2 font-medium"><FileText className="size-4 text-mut" /> Packing list preview</span>
              {lines.length > 0 && netKg > 0 && Math.abs(scalePct) > 0 && <span className={cn("text-[0.75rem]", Math.abs(scalePct) > 10 ? "text-warn" : "text-mut")}>Item weights scaled {scalePct > 0 ? "up" : "down"} {Math.abs(scalePct)}% to match the net weight{Math.abs(scalePct) > 10 ? " (over 10%, check it)" : ""}</span>}
            </div>
            <table className="tbl">
              <thead><tr>{["SL", "Cartons", "Description", "Net KG", "Gross KG"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}><td className="num">{i + 1}</td><td className="num">{r.cartons}</td><td>{r.description}</td><td className="num">{r.net}</td><td className="num">{r.gross}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[0.75rem] text-mut sm:grid-cols-3">
            <span>Invoice {exp.invoice_no || "missing"} · {dmy(exp.invoice_date) || "no date"}</span>
            <span>AWB {exp.awb_no || "missing"} · {dmy(exp.trans_doc_date) || "no date"}</span>
            <span>Ship date {exp.shipment_date ? fmtDate(exp.shipment_date) : "missing"}</span>
            <span>Contract {exp.lc_contract || src.trade.sales_contract_no} · {dmy(src.trade.contract_date)}</span>
            <span>Destination {src.trade.country_of_destination || "not set"}</span>
            <span>Shipping marks {src.trade.shipping_mark || "not set"}</span>
          </div>
        </div>
      )}
    </Modal>
  );
}
