import type { Exp } from "./types";

export type ExpGroup = "exp" | "goods" | "shipment" | "bank";
export const EXP_GROUPS: { key: ExpGroup; title: string }[] = [
  { key: "exp", title: "EXP" },
  { key: "goods", title: "Goods and value" },
  { key: "shipment", title: "Shipment" },
  { key: "bank", title: "Invoice, customs and bank" },
];

export type ExpFieldKind = "text" | "date" | "number" | "year";
export type ExpField = {
  key: string;
  /** Column name in the EXP template (EXP Template_Cross Border.xlsx). */
  label: string;
  kind: ExpFieldKind;
  /** advance: needed for every EXP. regular: needed once it is a Regular EXP. extra: optional. */
  stage: "advance" | "regular" | "extra";
  /** Section in the EXP form. */
  group: ExpGroup;
  /** Locked once a value is saved (marked red in the template). */
  locked?: boolean;
  placeholder?: string;
  hint?: string;
};

/** The 23 template fields in template order, then optional extras. Amount Inv is the EXP amount (USD). */
export const EXP_FIELDS: ExpField[] = [
  { key: "lc_contract", label: "Lc Contact", kind: "text", stage: "advance", group: "exp", locked: true, hint: "Sales contract number. Defaults to the trade's SC number." },
  { key: "importer", label: "Importer", kind: "text", stage: "advance", group: "exp", locked: true, hint: "Defaults to the trade's buyer." },
  { key: "exp_serial", label: "EXP Serial", kind: "text", stage: "advance", group: "exp", locked: true, placeholder: "026361" },
  { key: "exp_year", label: "EXP Year", kind: "year", stage: "advance", group: "exp", locked: true, placeholder: "2026" },
  { key: "entry_date", label: "Entry Date", kind: "date", stage: "advance", group: "exp", locked: true },
  { key: "hs_code", label: "HSCODE", kind: "text", stage: "advance", group: "goods", locked: true, placeholder: "07099990" },
  { key: "unit_iso", label: "Unit ISO", kind: "text", stage: "advance", group: "goods", locked: true, placeholder: "KGM" },
  { key: "incoterm", label: "Incoterm", kind: "text", stage: "advance", group: "goods", locked: true, placeholder: "CFR" },
  { key: "quantity", label: "Quantity", kind: "number", stage: "advance", group: "goods" },
  { key: "amount", label: "Amount Inv", kind: "number", stage: "advance", group: "goods", hint: "USD" },
  { key: "freight", label: "Freight", kind: "number", stage: "advance", group: "goods", hint: "USD" },
  { key: "dest_port", label: "Dest Port", kind: "text", stage: "regular", group: "shipment", placeholder: "RUH" },
  { key: "shipment_date", label: "Ship Date", kind: "date", stage: "regular", group: "shipment" },
  { key: "dup_flag", label: "Dup Flag", kind: "text", stage: "regular", group: "exp", placeholder: "Y" },
  { key: "dup_date", label: "Dup Date", kind: "date", stage: "regular", group: "exp" },
  { key: "invoice_no", label: "Invoice No", kind: "text", stage: "regular", group: "bank" },
  { key: "invoice_date", label: "Invoice Date", kind: "date", stage: "regular", group: "bank" },
  { key: "carrier", label: "Carrier", kind: "text", stage: "regular", group: "shipment", placeholder: "BG" },
  { key: "awb_no", label: "Trans Doc No", kind: "text", stage: "regular", group: "shipment", hint: "AWB number for air shipments", placeholder: "997-6726-5170" },
  { key: "trans_doc_date", label: "Trans Doc Date", kind: "date", stage: "regular", group: "shipment" },
  { key: "custom_code", label: "Custom Code", kind: "text", stage: "regular", group: "bank", placeholder: "301" },
  { key: "export_bill_no", label: "Export Bill No", kind: "text", stage: "regular", group: "bank" },
  { key: "export_bill_date", label: "Export Bill Date", kind: "date", stage: "regular", group: "bank" },
  { key: "cartons", label: "Cartons", kind: "number", stage: "extra", group: "goods", hint: "Used on the Commercial Invoice and Packing List" },
  { key: "gross_weight", label: "Gross Weight", kind: "number", stage: "extra", group: "goods", hint: "KG" },
  { key: "flight_no", label: "Flight No", kind: "text", stage: "extra", group: "shipment", placeholder: "BG-349" },
  { key: "shipment_id", label: "Shipment ID", kind: "text", stage: "extra", group: "shipment" },
];

export const TEMPLATE_FIELDS = EXP_FIELDS.filter((f) => f.stage !== "extra");
export const LOCKED_FIELDS = EXP_FIELDS.filter((f) => f.locked);

export const typeLabel = (t: Exp["type"]) => (t === "advance" ? "Advance" : "Regular");

export const isRequired = (f: ExpField, regular: boolean) => f.stage === "advance" || (regular && f.stage === "regular");

/** Value of a field on an EXP as a form string. */
export function fieldValue(e: Partial<Exp> | undefined, key: string): string {
  const v = (e as Record<string, unknown> | undefined)?.[key];
  if (v === null || v === undefined) return "";
  return String(v);
}

/** Labels of required fields still empty for the given stage. Lc Contact and Importer fill from the trade. */
export function missingFields(values: Record<string, string>, regular: boolean, autoFilled: string[] = ["lc_contract", "importer"]) {
  return EXP_FIELDS.filter((f) => isRequired(f, regular) && !autoFilled.includes(f.key) && !String(values[f.key] ?? "").trim()).map((f) => f.label);
}

/** Bangladesh Bank EXP number from serial and year. */
export const expNumber = (e: Pick<Exp, "exp_serial" | "exp_year" | "exp_no">) =>
  e.exp_serial && e.exp_year ? `${e.exp_serial}/${e.exp_year}` : e.exp_no ?? "";

/** Documents open once the EXP has shipped: a Regular EXP, or a Ship Date or Shipment ID on an Advance EXP. */
export const isShipped = (e: Pick<Exp, "type" | "shipment_date" | "shipment_id">) => e.type === "regular" || !!e.shipment_date || !!e.shipment_id;
