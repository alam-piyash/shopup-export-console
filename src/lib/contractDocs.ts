import { rpc, uploadFile } from "./api";
import { supabase } from "./supabase";
import { buildScPdf, scFileName, type ScData } from "./salesContract";
import type { Amendment, Trade, TradeItem } from "./types";

type ItemLike = { description: string; carton_size?: string | null; hs_code?: string | null; incoterm?: string | null; quantity_kg: number | string; rate_per_kg?: number | string | null; rate_usd_per_kg?: number | string | null };
type TradeLike = Partial<Trade> & Pick<Trade, "exporter" | "importer_name" | "sales_contract_no" | "contract_date">;

/** Builds the PDF data from a trade (or the form values) and its item lines. */
export function scDataFrom(t: TradeLike, items: ItemLike[], amendments: Pick<Amendment, "amendment_no" | "amendment_date" | "status">[] = [], deadline?: string | null): ScData {
  return {
    exporter: t.exporter,
    exporter_address: t.exporter_address,
    exporter_phone: t.exporter_phone,
    exporter_email: t.exporter_email,
    sales_contract_no: t.sales_contract_no,
    contract_date: t.contract_date,
    amendments: amendments.filter((a) => a.status === "approved").sort((a, b) => a.amendment_no - b.amendment_no).map((a) => ({ no: a.amendment_no, date: a.amendment_date })),
    shipping_mark: t.shipping_mark,
    importer_name: t.importer_name,
    buyer_cr_no: t.buyer_cr_no,
    buyer_vat_no: t.buyer_vat_no,
    buyer_address: t.buyer_address,
    notify_parties: (t.notify_parties ?? []).filter((n) => n.name?.trim()),
    bank_name: t.bank_name,
    bank_branch: t.bank_branch,
    bank_routing_no: t.bank_routing_no,
    bank_swift: t.bank_swift,
    bank_account_name: t.bank_account_name,
    bank_account_no: t.bank_account_no,
    country_of_origin: t.country_of_origin,
    country_of_destination: t.country_of_destination || t.importer_country,
    carriage_by: t.carriage_by ? (/^by /i.test(t.carriage_by) ? t.carriage_by : `By ${t.carriage_by}`) : null,
    departure_port: t.departure_port,
    point_of_entry: t.point_of_entry,
    payment_terms: (t.payment_type && !(t.payment_terms ?? "").toLowerCase().includes(t.payment_type.toLowerCase()) ? [t.payment_type, t.payment_terms] : [t.payment_terms]).filter(Boolean).join(", ") || null,
    shipment_deadline: deadline ?? (t as { shipment_deadline?: string | null }).shipment_deadline ?? null,
    shipment_timeline: t.shipment_timeline,
    expiry_date: t.expiry_date,
    tolerance_pct: t.tolerance_pct,
    signatory_name: (t.contract_extra as Record<string, string> | undefined)?.signatory_name ?? null,
    signatory_designation: (t.contract_extra as Record<string, string> | undefined)?.signatory_designation ?? null,
    items: items.map((i) => ({
      description: i.description,
      carton_size: i.carton_size,
      hs_code: i.hs_code,
      incoterm: i.incoterm,
      quantity_kg: i.quantity_kg,
      rate_usd_per_kg: i.rate_usd_per_kg && Number(i.rate_usd_per_kg) > 0 ? i.rate_usd_per_kg : i.rate_per_kg ?? null,
    })),
  };
}

/** Loads a stored logo and converts it to a PNG data URL (works for PNG, JPG, WEBP and SVG). */
export async function loadLogo(path?: string | null): Promise<ScData["logo"]> {
  if (!path) return null;
  const { data: blob, error } = await supabase.storage.from("documents").download(path);
  if (error || !blob) return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const w = img.naturalWidth || 300, h = img.naturalHeight || 150;
    const scale = Math.min(1, 1200 / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return { data: c.toDataURL("image/png"), w: c.width, h: c.height };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Generates the PDF, stores it and records it as a new draft version. Returns the version id. */
export async function saveGeneratedVersion(tradeId: string, data: ScData, version: number, note?: string, logoPath?: string | null) {
  if (logoPath && !data.logo) data = { ...data, logo: await loadLogo(logoPath) };
  const blob = await buildScPdf(data);
  const file = new File([blob], scFileName(data.sales_contract_no, version), { type: "application/pdf" });
  const up = await uploadFile(file, "trades/contracts");
  return rpc<string>("add_contract_version", { p_trade: tradeId, p_file: up, p_source: "generated", p_note: note ?? null });
}

export type { TradeItem };
