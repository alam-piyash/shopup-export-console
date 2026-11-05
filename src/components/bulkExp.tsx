import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { rpc, useRefresh } from "@/lib/api";
import { money, downloadCsv, errMsg } from "@/lib/format";
import { EXP_FIELDS, fieldValue, typeLabel } from "@/lib/expFields";
import type { Exp } from "@/lib/types";
import { Button, Chip, Modal, cn } from "./ui";

export type BulkMode = "create" | "update";

/** File columns: Trade Code, EXP Type, the 23 template fields, then Flight No and Shipment ID. */
export const FILE_HEADERS = ["Trade Code", "EXP Type", ...EXP_FIELDS.map((f) => f.label)];

const key = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES: Record<string, string> = {
  tradecode: "trade_code", tradeid: "trade_code", trade: "trade_code",
  exptype: "type", type: "type",
  lccontract: "lc_contract", lccontact: "lc_contract",
  amountinv: "amount", amount: "amount", amountusd: "amount",
  transdocnoawb: "awb_no", awbno: "awb_no",
};
for (const f of EXP_FIELDS) ALIASES[key(f.label)] = f.key;

/** One row per EXP for the file, using the template column names. */
export function expRowsForFile(exps: Exp[]) {
  return exps.map((e) => ({
    "Trade Code": e.trade_code,
    "EXP Type": typeLabel(e.type),
    ...Object.fromEntries(EXP_FIELDS.map((f) => [f.label, fieldValue(e, f.key)])),
  }));
}

function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); out.push(row); row = []; cur = "";
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out.filter((r) => r.some((x) => String(x).trim()));
}

const toDate = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  if (!s) return "";
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -](\d{4})$/.exec(s);
  if (m) {
    const mo = "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(m[2].toLowerCase()) / 3 + 1;
    if (mo > 0) return `${m[3]}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return s; // the server reports it as not a valid date
};
const cell = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").trim());
const num = (v: string) => v.replace(/[,$\s]/g, "");

type FileRow = { n: number; trade_code: string; type: string; amount: string; fields: Record<string, string>; label: string };
type Result = { n: number; ok: boolean; code?: string; error?: string };
type BulkResult = { ok: number; errors: number; committed: boolean; rows: Result[] };

const CHUNK = 500;

async function runBulk(mode: BulkMode, rows: FileRow[], commit: boolean, onProgress?: (done: number) => void) {
  const all: Result[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK).map(({ n, trade_code, type, amount, fields }) => ({ n, trade_code, type, amount, fields }));
    const res = await rpc<BulkResult>("bulk_exps", { p_mode: mode, p_rows: part, p_commit: commit });
    all.push(...res.rows);
    onProgress?.(Math.min(rows.length, i + CHUNK));
  }
  return all;
}

export function BulkExpDialog({ open, onOpenChange, mode = "create", prefill }: { open: boolean; onOpenChange: (o: boolean) => void; mode?: BulkMode; prefill?: Exp[] }) {
  const refresh = useRefresh();
  const ref = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [checks, setChecks] = useState<Record<number, Result>>({});
  const [done, setDone] = useState<Record<number, Result>>({});
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const create = mode === "create";

  async function read(f?: File) {
    if (!f) return;
    setBusy("Reading file");
    try {
      let grid: unknown[][];
      if (/\.xlsx$/i.test(f.name)) {
        const readXlsx = (await import("read-excel-file")).default;
        grid = (await readXlsx(f)) as unknown[][];
      } else {
        grid = parseCsv((await f.text()).replace(/^﻿/, ""));
      }
      // the header row is the first row that names EXP Serial
      const hi = grid.findIndex((r) => r.some((c) => key(c) === "expserial"));
      if (hi < 0) throw new Error("No header row found. The file needs the template columns (EXP Serial, EXP Year, ...). Download the template.");
      const cols = grid[hi].map((h) => ALIASES[key(h)] ?? null);
      if (create && !cols.includes("trade_code")) throw new Error("Add a Trade Code column (for example TRD-0003) for new EXPs.");
      const body = grid.slice(hi + 1);
      const parsed: FileRow[] = [];
      body.forEach((r, i) => {
        if (r.some((c) => key(c) === "expserial")) return; // a repeated header row
        const vals: Record<string, string> = {};
        cols.forEach((k, j) => {
          if (!k) return;
          let v = cell(r[j]);
          if (/^mandatory$/i.test(v)) v = "";
          const f = EXP_FIELDS.find((x) => x.key === k);
          if (v && f?.kind === "date") v = toDate(r[j]);
          if (v && (f?.kind === "number" || k === "amount")) v = num(v);
          if (v && f?.kind === "year") v = v.replace(/\.0+$/, "");
          vals[k] = v;
        });
        if (!Object.entries(vals).some(([k, v]) => v && k !== "type")) return; // empty or "Mandatory" marker rows
        const { trade_code = "", type = "", amount = "", ...fields } = vals;
        // empty cells leave values unchanged on update
        const kept = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== ""));
        parsed.push({ n: hi + i + 2, trade_code, type, amount, fields: kept, label: kept.exp_serial && kept.exp_year ? `${kept.exp_serial}/${kept.exp_year}` : "" });
      });
      if (!parsed.length) throw new Error("No EXP rows found under the headers");
      if (parsed.length > 2000) throw new Error("Up to 2000 rows per file");
      setRows(parsed);
      setFileName(f.name);
      setDone({});
      setBusy(`Checking ${parsed.length} rows`);
      const res = await runBulk(mode, parsed, false);
      setChecks(Object.fromEntries(res.map((r) => [r.n, r])));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
      if (ref.current) ref.current.value = "";
    }
  }

  const ready = rows.filter((r) => checks[r.n]?.ok && !done[r.n]?.ok);
  async function run() {
    setBusy(create ? "Creating EXPs" : "Updating EXPs");
    try {
      const res = await runBulk(mode, ready, true, (d) => setBusy(`${create ? "Creating" : "Updating"} ${d} of ${ready.length}`));
      setDone((s) => ({ ...s, ...Object.fromEntries(res.map((r) => [r.n, r])) }));
      const ok = res.filter((r) => r.ok).length;
      const bad = res.length - ok;
      toast[bad ? "warning" : "success"](`${ok} EXP${ok === 1 ? "" : "s"} ${create ? "created" : "updated"}${bad ? `, ${bad} failed` : ""}`);
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const close = (o: boolean) => { if (!busy) { onOpenChange(o); if (!o) { setRows([]); setChecks({}); setDone({}); setFileName(""); } } };
  const failing = rows.filter((r) => checks[r.n] && !checks[r.n].ok).length;

  function template() {
    if (!create && prefill?.length) {
      downloadCsv(`exp-update-${new Date().toISOString().slice(0, 10)}.csv`, expRowsForFile(prefill));
      return;
    }
    const example: Record<string, string> = Object.fromEntries(FILE_HEADERS.map((h) => [h, ""]));
    Object.assign(example, {
      "Trade Code": "TRD-0003", "EXP Type": "Advance", "EXP Serial": "026361", "EXP Year": "2026", "Entry Date": "2026-04-26",
      HSCODE: "07099990", "Unit ISO": "KGM", Incoterm: "CFR", Quantity: "2100", "Amount Inv": "5250", Freight: "1050",
    });
    downloadCsv("exp-template.csv", [example]);
  }

  return (
    <Modal
      open={open}
      onOpenChange={close}
      xwide
      title={create ? "Import new EXPs" : "Bulk update EXPs"}
      description={
        create
          ? "One row per EXP. Each row names its trade by Trade Code. An EXP number (EXP Serial + EXP Year) can only exist once."
          : "Rows are matched by EXP Serial + EXP Year. Empty cells leave the saved value as it is. Locked fields and Amount Inv cannot change here."
      }
      footer={
        <>
          {busy && <span className="mr-auto flex items-center gap-2 self-center text-[0.8125rem] text-mut"><Loader2 className="size-4 animate-spin" /> {busy}</span>}
          <Button variant="outline" onClick={() => close(false)} disabled={!!busy}>{Object.values(done).some((r) => r.ok) ? "Done" : "Cancel"}</Button>
          <Button disabled={!ready.length || !!busy} onClick={run}>
            {create ? "Create" : "Update"} {ready.length || ""} EXP{ready.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={template}>
            <Download /> {create ? "Template" : prefill?.length ? `Download ${prefill.length} selected EXPs` : "Template"}
          </Button>
          <input ref={ref} type="file" className="hidden" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => read(e.target.files?.[0])} />
          <Button size="sm" disabled={!!busy} onClick={() => ref.current?.click()}>
            <FileSpreadsheet /> {fileName ? "Choose another file" : "Choose CSV or Excel"}
          </Button>
          {fileName && <span className="truncate text-[0.8125rem] text-mut">{fileName}</span>}
        </div>
        <ul className="list-disc space-y-0.5 pl-5 text-[0.75rem] text-mut">
          <li>Columns follow the EXP template: {EXP_FIELDS.filter((f) => f.stage !== "extra").map((f) => f.label).join(", ")}. Flight No and Shipment ID are optional.</li>
          {create ? (
            <li>EXP Type is Advance or Duplicate. Advance needs the first 11 fields; Duplicate needs all 23. Lc Contact and Importer fill from the trade when empty.</li>
          ) : (
            <li>Put Duplicate in EXP Type to turn an Advance EXP into a Duplicate EXP (all 23 fields must then be filled).</li>
          )}
          <li>Amounts in USD. Dates as yyyy-mm-dd, dd/mm/yyyy or 26-Apr-2026. Every row is checked before anything is saved.</li>
        </ul>
        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 text-[0.8125rem]">
              <Chip label={`${rows.length} rows`} tone="gray" dot={false} />
              <Chip label={`${rows.filter((r) => checks[r.n]?.ok).length} ready`} tone="info" dot={false} />
              {failing > 0 && <Chip label={`${failing} with problems`} tone="bad" dot={false} />}
              {Object.values(done).some((r) => r.ok) && <Chip label={`${Object.values(done).filter((r) => r.ok).length} saved`} tone="ok" dot={false} />}
            </div>
            <div className="scroll-thin max-h-[50vh] overflow-auto rounded-lg border border-line">
              <table className="tbl min-w-[48rem]">
                <thead><tr>{["Row", ...(create ? ["Trade"] : []), "EXP number", "Type", "Amount Inv", "Check"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const d = done[r.n], c = checks[r.n];
                    return (
                      <tr key={r.n} className={cn(c && !c.ok && "bg-bad/[0.04]")}>
                        <td className="num text-mut">{r.n}</td>
                        {create && <td className="code-id">{r.trade_code}</td>}
                        <td className="code-id">{r.label}</td>
                        <td>{r.type || (create ? "Advance" : "")}</td>
                        <td className="num">{r.amount ? money(r.amount) : ""}</td>
                        <td className="max-w-[24rem]">
                          {d?.ok ? <Chip label={`${create ? "Created" : "Updated"} ${d.code ?? ""}`} tone="ok" />
                            : d && !d.ok ? <span className="text-[0.75rem] text-bad">{d.error}</span>
                            : !c ? <span className="text-[0.75rem] text-mut">Checking</span>
                            : c.ok ? <Chip label="Ready" tone="info" dot={false} />
                            : <span className="text-[0.75rem] text-bad">{c.error}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
