/**
 * The EXP Excel template: dropdowns, type-aware required highlighting and a "How to fill" sheet.
 * exceljs is loaded only when a file is built.
 */
import { EXP_FIELDS, fieldValue, typeLabel, type ExpField } from "./expFields";
import type { Exp } from "./types";

export const UNIT_ISO = ["KGM", "PCS", "TNE", "LTR", "MTR", "DZN", "SET", "PRS"];
export const INCOTERMS = ["CFR", "FOB", "CIF", "CPT", "CIP", "FCA", "EXW", "DAP", "DPU", "DDP"];
export const EXP_TYPES = ["Advance", "Regular"];

export type TemplateTrade = { code: string; sc?: string | null; buyer?: string | null };

/** A row for the file: values by field key plus trade_code and type. */
export type TemplateRow = Record<string, string>;

export const rowFromExp = (e: Exp): TemplateRow => ({
  trade_code: e.trade_code,
  type: typeLabel(e.type),
  ...Object.fromEntries(EXP_FIELDS.map((f) => [f.key, fieldValue(e, f.key)])),
});

type Opts = {
  mode: "create" | "update";
  trades: TemplateTrade[];
  rows?: TemplateRow[];
  /** Error text per row (same order as rows): adds an Errors column. */
  errors?: (string | undefined)[];
  /** Prefill Trade Code and EXP Type on the empty rows of a new file. */
  presetTrade?: string;
  emptyRows?: number;
};

const COLS: { key: string; label: string; f?: ExpField }[] = [
  { key: "trade_code", label: "Trade Code" },
  { key: "type", label: "EXP Type" },
  ...EXP_FIELDS.map((f) => ({ key: f.key, label: f.label, f })),
];

const colLetter = (i: number) => {
  let s = "", n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

const FILL = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
const AUTO = ["lc_contract", "importer"];

function note(c: (typeof COLS)[number], mode: Opts["mode"]): string {
  if (c.key === "trade_code") return mode === "create" ? "Required. Pick the trade from the list (for example TRD-0003)." : "Shown for reference. Rows are matched by EXP Serial + EXP Year.";
  if (c.key === "type") return "Advance: shipment details come later (11 fields now).\nRegular: all 23 fields needed.\nAn Advance EXP can become Regular later, not the other way.";
  const f = c.f!;
  const parts: string[] = [];
  if (AUTO.includes(f.key)) parts.push("Optional. Filled from the trade when empty.");
  else if (f.stage === "advance") parts.push("Required for every EXP.");
  else if (f.stage === "regular") parts.push("Required for a Regular EXP. Can be left empty on an Advance EXP.");
  else parts.push("Optional.");
  if (f.locked) parts.push("Locked once saved.");
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

  const withErrors = !!o.errors?.some(Boolean);
  const cols = withErrors ? [{ key: "_errors", label: "Errors" }, ...COLS] : COLS;
  const off = withErrors ? 1 : 0;
  const L = (key: string) => colLetter(cols.findIndex((c) => c.key === key));
  const first = colLetter(off + 2), last = colLetter(cols.length - 1);

  ws.columns = cols.map((c) => ({
    key: c.key,
    width: c.key === "_errors" ? 48 : c.key === "importer" || c.key === "lc_contract" ? 22 : Math.max(12, c.label.length + 4),
  }));
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  const header = ws.getRow(1);
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label;
    const req = c.key === "trade_code" ? o.mode === "create" : c.key === "type" ? true : c.f && !AUTO.includes(c.key) && c.f.stage === "advance";
    const regular = c.f?.stage === "regular";
    cell.fill = FILL(c.key === "_errors" ? "FFB42318" : req ? "FF1F3A5F" : regular ? "FF2E6B5E" : "FF6B7280");
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    if (c.key !== "_errors") cell.note = { texts: [{ text: note(c as (typeof COLS)[number], o.mode) }] };
  });
  header.height = 30;

  // lists for dropdowns
  lists.getColumn(1).values = ["Trade Code", ...o.trades.map((t) => t.code)];
  lists.getColumn(2).values = ["EXP Type", ...EXP_TYPES];
  lists.getColumn(3).values = ["Unit ISO", ...UNIT_ISO];
  lists.getColumn(4).values = ["Incoterm", ...INCOTERMS];
  lists.getColumn(5).values = ["Dup Flag", "Y", "N"];
  const listRef = (col: string, n: number) => `Lists!$${col}$2:$${col}$${Math.max(2, n + 1)}`;

  // data rows
  const rows = o.rows ?? [];
  const total = Math.max(rows.length, o.emptyRows ?? 0, 1);
  for (let r = 0; r < total; r++) {
    const src = rows[r] ?? (o.presetTrade ? { trade_code: o.presetTrade, type: "Advance" } : {});
    const row = ws.getRow(r + 2);
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const v = c.key === "_errors" ? o.errors?.[r] ?? "" : src[c.key] ?? "";
      const k = c.f?.kind;
      if (c.f?.key === "exp_serial" || (c.f && k === "text")) cell.numFmt = "@";
      if (k === "date") cell.numFmt = "dd/mm/yyyy";
      if (!v) return;
      if (k === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) cell.value = new Date(`${v}T00:00:00Z`);
      else if ((k === "number" || k === "year") && v !== "" && !Number.isNaN(Number(v))) cell.value = Number(v);
      else cell.value = v;
      if (c.key === "_errors") { cell.font = { color: { argb: "FFB42318" } }; cell.alignment = { wrapText: true, vertical: "top" }; }
    });
    // update files: locked values that are set, and Amount Inv, are grey (they will not change)
    if (o.mode === "update" && rows[r]) {
      cols.forEach((c, i) => {
        if ((c.f?.locked && src[c.key]) || c.key === "amount") {
          const cell = row.getCell(i + 1);
          cell.fill = FILL("FFF1F2F4");
          cell.font = { color: { argb: "FF6B7280" } };
        }
      });
    }
  }

  const range = (key: string) => `${L(key)}2:${L(key)}${total + 1}`;
  const dv = ws as unknown as { dataValidations: { add: (ref: string, v: Record<string, unknown>) => void } };
  const listDv = (key: string, ref: string, strict: boolean, title: string) =>
    dv.dataValidations.add(range(key), {
      type: "list", allowBlank: true, formulae: [ref], showErrorMessage: true,
      errorStyle: strict ? "stop" : "warning", errorTitle: title, error: strict ? `Pick a ${title} from the list.` : `${title} is not in the usual list. Keep it anyway?`,
    });
  listDv("trade_code", listRef("A", o.trades.length), o.mode === "create", "Trade Code");
  listDv("type", listRef("B", EXP_TYPES.length), true, "EXP Type");
  listDv("unit_iso", listRef("C", UNIT_ISO.length), false, "Unit ISO");
  listDv("incoterm", listRef("D", INCOTERMS.length), false, "Incoterm");
  listDv("dup_flag", listRef("E", 2), true, "Dup Flag");
  for (const c of COLS) {
    const f = c.f;
    if (!f) continue;
    if (f.kind === "date")
      dv.dataValidations.add(range(f.key), { type: "date", operator: "between", allowBlank: true, formulae: [new Date("2000-01-01"), new Date("2100-12-31")], showErrorMessage: true, errorTitle: f.label, error: "Enter a date, for example 26/04/2026." });
    else if (f.kind === "year")
      dv.dataValidations.add(range(f.key), { type: "whole", operator: "between", allowBlank: true, formulae: [2000, 2100], showErrorMessage: true, errorTitle: f.label, error: "Enter a year, for example 2026." });
    else if (f.kind === "number")
      dv.dataValidations.add(range(f.key), { type: "decimal", operator: "greaterThanOrEqual", allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: f.label, error: "Enter a number (no currency sign)." });
  }

  // highlighting: a row is in use once any field after EXP Type has a value
  const used = (r: number) => `COUNTA($${first}${r}:$${last}${r})>0`;
  const ref = `${colLetter(off)}2:${last}${total + 1}`;
  const rules: Record<string, unknown>[] = [];
  let pri = 1;
  for (const c of COLS) {
    const L1 = `${L(c.key)}2`;
    const isReg = c.f?.stage === "regular";
    const isAll = c.key === "trade_code" ? o.mode === "create" : c.key === "type" || (c.f && c.f.stage === "advance" && !AUTO.includes(c.key));
    const typeCell = `$${L("type")}2`;
    const sqref = `${L(c.key)}2:${L(c.key)}${total + 1}`;
    if (isAll)
      rules.push({ ref: sqref, rules: [{ type: "expression", priority: pri++, formulae: [`AND(${used(2)},ISBLANK(${L1}))`], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFDE2E1" } } } }] });
    if (isReg && o.mode === "create") {
      rules.push({ ref: sqref, rules: [
        { type: "expression", priority: pri++, formulae: [`AND(${used(2)},${typeCell}="Regular",ISBLANK(${L1}))`], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFDE2E1" } } } },
        { type: "expression", priority: pri++, formulae: [`AND(${used(2)},${typeCell}<>"Regular",ISBLANK(${L1}))`], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFF3F4F6" } } } },
      ] });
    }
    if (isReg && o.mode === "update")
      rules.push({ ref: sqref, rules: [{ type: "expression", priority: pri++, formulae: [`AND(${used(2)},${typeCell}="Regular",ISBLANK(${L1}))`], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFDE2E1" } } } }] });
  }
  void ref;
  const cf = ws as unknown as { addConditionalFormatting: (r: Record<string, unknown>) => void };
  rules.forEach((r) => cf.addConditionalFormatting(r));

  // How to fill
  how.getColumn(1).width = 26;
  how.getColumn(2).width = 90;
  const lines: [string, string][] = [
    ["EXP import", o.mode === "create" ? "One row per new EXP, on the EXPs sheet." : "One row per EXP to update. Rows are matched by EXP Serial + EXP Year."],
    ["", ""],
    ["EXP Type", "Advance: the EXP is issued before shipment. Fill the 11 blue columns now; the green ones come later."],
    ["", "Regular: all details are known. Fill the blue and the green columns (23 fields)."],
    ["", "Both are the same EXP. The type only changes which columns are required. An Advance EXP becomes Regular later, by bulk update or on the EXP page."],
    ["", ""],
    ["Header colours", "Blue: required for every EXP.  Green: required for a Regular EXP.  Grey: optional."],
    ["Cell colours", "Red: required and still empty for that row's type.  Light grey: not needed yet (Advance EXP)."],
    ...(o.mode === "update" ? [["", "Grey text: locked values and Amount Inv. They do not change from this file."] as [string, string]] : []),
    ["", ""],
    ["Rules", "An EXP number (EXP Serial + EXP Year) can exist only once, across all trades."],
    ["", "Lc Contact and Importer are filled from the trade when left empty."],
    ["", "Amounts in USD, without a currency sign. Dates as dd/mm/yyyy."],
    ...(o.mode === "update" ? [["", "Empty cells leave the saved value as it is."] as [string, string]] : []),
    ["", "Locked fields (Lc Contact, Importer, EXP Serial, EXP Year, Entry Date, HSCODE, Unit ISO, Incoterm) cannot change once saved."],
    ["", "Every row is checked before anything is saved. Rows with problems are listed with the reason."],
    ["", ""],
    ["Example, Advance", "TRD-0003 · Advance · 026361 · 2026 · 26/04/2026 · 07099990 · KGM · CFR · 2100 · 5250 · 1050"],
    ["", ""],
    ["Trades in the list", ""],
    ...o.trades.map((t) => [t.code, [t.sc && `SC ${t.sc}`, t.buyer].filter(Boolean).join(" · ")] as [string, string]),
  ];
  lines.forEach(([a, b], i) => {
    const r = how.getRow(i + 1);
    r.getCell(1).value = a;
    r.getCell(2).value = b;
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
