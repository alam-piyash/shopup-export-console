/**
 * The EXP Excel template: dropdowns, type-aware required highlighting and a "How to fill" sheet.
 * exceljs is loaded only when a file is built.
 */
import { EXP_FIELDS, fieldValue, typeLabel, type ExpField } from "./expFields";
import type { Exp } from "./types";

export const UNIT_ISO = ["KGM", "PCS", "TNE", "LTR", "MTR", "DZN", "SET", "PRS"];
export const INCOTERMS = ["CFR", "FOB", "CIF", "CPT", "CIP", "FCA", "EXW", "DAP", "DPU", "DDP"];
export const EXP_TYPES = ["Advance", "Regular"];

/** The trade a new-EXP file is for; shown on the How to fill sheet. */
export type TemplateTrade = { code: string; sc?: string | null; buyer?: string | null };

/** A row for the file: values by field key plus trade_code and type. */
export type TemplateRow = Record<string, string>;

export const rowFromExp = (e: Exp): TemplateRow => ({
  type: typeLabel(e.type),
  ...Object.fromEntries(EXP_FIELDS.map((f) => [f.key, fieldValue(e, f.key)])),
});

export type ExpKind = "advance" | "regular";

type Opts = {
  mode: "create" | "update";
  /** Bulk EXP: which type the file is for. Advance files carry only the Advance columns. */
  kind?: ExpKind;
  trade?: TemplateTrade;
  rows?: TemplateRow[];
  /** Error text per row (same order as rows): adds an Errors column. */
  errors?: (string | undefined)[];
  emptyRows?: number;
};
type Col = { key: string; label: string; f?: ExpField; req: boolean };

const colLetter = (i: number) => {
  let s = "", n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

const FILL = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
const AUTO = ["lc_contract", "importer"];
const RED = "FFC81E1E", GREY = "FFE5E5EA", INK = "FF1D1D1F", WHITE = "FFFFFFFF";

/** The columns of a file: create files follow the chosen type; correction files carry every field. */
export function templateColumns(mode: Opts["mode"], kind: ExpKind = "advance"): Col[] {
  if (mode === "update") {
    return [
      ...EXP_FIELDS.filter((f) => f.key === "exp_serial" || f.key === "exp_year").map((f) => ({ key: f.key, label: f.label, f, req: true })),
      { key: "type", label: "EXP Type", req: false },
      ...EXP_FIELDS.filter((f) => f.key !== "exp_serial" && f.key !== "exp_year").map((f) => ({ key: f.key, label: f.label, f, req: false })),
    ];
  }
  const fields = EXP_FIELDS.filter((f) => (kind === "advance" ? f.stage === "advance" : true));
  return fields.map((f) => ({ key: f.key, label: f.label, f, req: !AUTO.includes(f.key) && (f.stage === "advance" || (kind === "regular" && f.stage === "regular")) }));
}

function note(c: Col, mode: Opts["mode"]): string {
  if (c.key === "type") return "Optional. Write Regular to complete an Advance EXP (all Regular fields must then be filled). A Regular EXP cannot go back to Advance.";
  const f = c.f!;
  const parts: string[] = [];
  if (mode === "update") parts.push(c.req ? "Required. Finds the EXP to correct." : "Optional. Empty keeps the saved value.");
  else if (AUTO.includes(f.key)) parts.push("Optional. Filled from the trade when empty.");
  else parts.push(c.req ? "Required." : "Optional.");
  if (f.locked && mode === "update" && !c.req) parts.push("Locked once saved: a change is refused.");
  if (f.key === "amount") parts.push("USD." + (mode === "update" ? " Cannot change here; use Change amount on the EXP." : ""));
  else if (f.hint) parts.push(f.hint + ".");
  if (f.kind === "date") parts.push("Date, for example 26/04/2026.");
  if (f.key === "exp_serial") parts.push("Keep leading zeros (026361).");
  return parts.join("\n");
}

export async function buildExpWorkbook(o: Opts): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "ShopUp Export Console";
  const ws = wb.addWorksheet("EXPs", { views: [{ state: "frozen", xSplit: 0, ySplit: 1 }] });
  const lists = wb.addWorksheet("Lists", { state: "veryHidden" });
  const how = wb.addWorksheet("How to fill");
  const kind = o.kind ?? "advance";
  const base = templateColumns(o.mode, kind);

  const withErrors = !!o.errors?.some(Boolean);
  const cols: Col[] = withErrors ? [{ key: "_errors", label: "Errors", req: false }, ...base] : base;
  const L = (key: string) => colLetter(cols.findIndex((c) => c.key === key));
  const first = colLetter(withErrors ? 1 : 0), last = colLetter(cols.length - 1);

  ws.columns = cols.map((c) => ({ key: c.key, width: c.key === "_errors" ? 48 : c.key === "importer" || c.key === "lc_contract" ? 22 : Math.max(12, c.label.length + 4) }));
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  const header = ws.getRow(1);
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.req ? `${c.label} *` : c.label;
    cell.fill = FILL(c.key === "_errors" || c.req ? RED : GREY);
    cell.font = { bold: true, color: { argb: c.key === "_errors" || c.req ? WHITE : INK }, size: 10 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    if (c.key !== "_errors") cell.note = { texts: [{ text: note(c, o.mode) }] };
  });
  header.height = 30;

  lists.getColumn(2).values = ["EXP Type", ...EXP_TYPES];
  lists.getColumn(3).values = ["Unit ISO", ...UNIT_ISO];
  lists.getColumn(4).values = ["Incoterm", ...INCOTERMS];
  lists.getColumn(5).values = ["Dup Flag", "Y", "N"];
  const listRef = (col: string, n: number) => `Lists!$${col}$2:$${col}$${Math.max(2, n + 1)}`;

  const rows = o.rows ?? [];
  const total = Math.max(rows.length, o.emptyRows ?? 0, 1);
  for (let r = 0; r < total; r++) {
    const src: TemplateRow = rows[r] ?? {};
    const row = ws.getRow(r + 2);
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const v = c.key === "_errors" ? o.errors?.[r] ?? "" : src[c.key] ?? "";
      const k = c.f?.kind;
      if (c.f && (c.f.key === "exp_serial" || k === "text")) cell.numFmt = "@";
      if (k === "date") cell.numFmt = "dd/mm/yyyy";
      if (!v) return;
      if (k === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) cell.value = new Date(`${v}T00:00:00Z`);
      else if ((k === "number" || k === "year") && !Number.isNaN(Number(v))) cell.value = Number(v);
      else cell.value = v;
      if (c.key === "_errors") { cell.font = { color: { argb: RED } }; cell.alignment = { wrapText: true, vertical: "top" }; }
    });
  }

  const has = (key: string) => cols.some((c) => c.key === key);
  const range = (key: string) => `${L(key)}2:${L(key)}${total + 1}`;
  const dv = ws as unknown as { dataValidations: { add: (ref: string, v: Record<string, unknown>) => void } };
  const listDv = (key: string, ref: string, strict: boolean, title: string) => has(key) &&
    dv.dataValidations.add(range(key), {
      type: "list", allowBlank: true, formulae: [ref], showErrorMessage: true,
      errorStyle: strict ? "stop" : "warning", errorTitle: title, error: strict ? `Pick a ${title} from the list.` : `${title} is not in the usual list. Keep it anyway?`,
    });
  listDv("type", listRef("B", EXP_TYPES.length), true, "EXP Type");
  listDv("unit_iso", listRef("C", UNIT_ISO.length), false, "Unit ISO");
  listDv("incoterm", listRef("D", INCOTERMS.length), false, "Incoterm");
  listDv("dup_flag", listRef("E", 2), true, "Dup Flag");
  for (const c of base) {
    const f = c.f;
    if (!f) continue;
    if (f.kind === "date")
      dv.dataValidations.add(range(f.key), { type: "date", operator: "between", allowBlank: true, formulae: [new Date("2000-01-01"), new Date("2100-12-31")], showErrorMessage: true, errorTitle: f.label, error: "Enter a date, for example 26/04/2026." });
    else if (f.kind === "year")
      dv.dataValidations.add(range(f.key), { type: "whole", operator: "between", allowBlank: true, formulae: [2000, 2100], showErrorMessage: true, errorTitle: f.label, error: "Enter a year, for example 2026." });
    else if (f.kind === "number")
      dv.dataValidations.add(range(f.key), { type: "decimal", operator: "greaterThanOrEqual", allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: f.label, error: "Enter a number (no currency sign)." });
  }

  // a required cell turns red while its row is in use and the cell is empty
  const used = `COUNTA($${first}2:$${last}2)>0`;
  const cf = ws as unknown as { addConditionalFormatting: (r: Record<string, unknown>) => void };
  let pri = 1;
  for (const c of base.filter((x) => x.req)) {
    cf.addConditionalFormatting({ ref: range(c.key), rules: [{ type: "expression", priority: pri++, formulae: [`AND(${used},ISBLANK(${L(c.key)}2))`], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFDE2E1" } } } }] });
  }

  // How to fill
  how.getColumn(1).width = 24;
  how.getColumn(2).width = 92;
  const reqCount = base.filter((c) => c.req).length;
  const lines: [string, string][] = o.mode === "create"
    ? [
        [kind === "advance" ? "Bulk EXP: Advance" : "Bulk EXP: Regular", `One row per new ${kind === "advance" ? "Advance" : "Regular"} EXP.${o.trade ? ` All rows go to trade ${o.trade.code}${o.trade.sc ? ` (SC ${o.trade.sc})` : ""}${o.trade.buyer ? `, ${o.trade.buyer}` : ""}.` : ""}`],
        ["", kind === "advance" ? "Advance: issued before shipment. Shipment, invoice and bank details are added later with EXP correction." : "Regular: all details are known now."],
        ["", ""],
        ["Columns", `Red header with *: required (${reqCount} columns). Grey header: optional.`],
        ["", "A required cell turns red while it is empty on a row you are filling."],
        ["", "Lc Contact and Importer are filled from the trade when left empty."],
        ["", ""],
        ["Rules", "An EXP number (EXP Serial + EXP Year) can exist only once, across all trades."],
        ["", "Amounts in USD, without a currency sign. Dates as dd/mm/yyyy. Keep leading zeros in EXP Serial."],
        ["", "Every row is checked before anything is saved. Rows with problems are listed with the reason."],
      ]
    : [
        ["EXP correction", "One row per EXP to fill in or correct. Rows are found by EXP Serial + EXP Year (red headers)."],
        ["", "Fill only the cells you want to change. Empty cells keep the saved value."],
        ["", "To complete an Advance EXP, fill its shipment, invoice and bank columns and write Regular in EXP Type."],
        ["", ""],
        ["Rules", "Locked fields (Lc Contact, Importer, Entry Date, HSCODE, Unit ISO, Incoterm) cannot change once saved."],
        ["", "Amount Inv changes only through Change amount on the EXP page."],
        ["", "Every row is checked before anything is saved. Rows with problems are listed with the reason."],
      ];
  lines.forEach(([x, y], i) => {
    const r = how.getRow(i + 1);
    r.getCell(1).value = x;
    r.getCell(2).value = y;
    r.getCell(1).font = { bold: true };
    r.getCell(2).alignment = { wrapText: true };
  });
  how.getRow(1).getCell(1).font = { bold: true, size: 13 };

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
