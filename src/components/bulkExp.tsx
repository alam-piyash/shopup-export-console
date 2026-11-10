import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, Download, FileSpreadsheet, Loader2, RotateCcw, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { rpc, useAllExps, useRefresh, useTrades } from "@/lib/api";
import { money, errMsg } from "@/lib/format";
import { EXP_FIELDS } from "@/lib/expFields";
import { buildExpWorkbook, rowFromExp, saveBlob, type TemplateRow } from "@/lib/expTemplate";
import type { Exp } from "@/lib/types";
import { Button, Chip, Field, Modal, Progress, Segments, cn } from "./ui";
import { TradePicker } from "./pickers";

export type BulkMode = "create" | "update";

const key = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES: Record<string, string> = {
  exptype: "type", type: "type",
  lccontract: "lc_contract", lccontact: "lc_contract",
  amountinv: "amount", amount: "amount", amountusd: "amount",
  transdocnoawb: "awb_no", awbno: "awb_no",
};
for (const f of EXP_FIELDS) ALIASES[key(f.label)] = f.key;

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

type FileRow = { n: number; trade_code: string; type: string; amount: string; fields: Record<string, string>; label: string; raw: TemplateRow };
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

async function parseFile(f: File, tradeCode: string): Promise<FileRow[]> {
  let grid: unknown[][];
  if (/\.xlsx$/i.test(f.name)) {
    const readXlsx = (await import("read-excel-file")).default;
    grid = (await readXlsx(f)) as unknown[][];
  } else if (/\.(csv|txt)$/i.test(f.name)) {
    grid = parseCsv((await f.text()).replace(/^\uFEFF/, ""));
  } else throw new Error("Use the Excel template (.xlsx) or a CSV file");
  // the header row is the first row that names EXP Serial
  const hi = grid.findIndex((r) => r.some((c) => key(c) === "expserial"));
  if (hi < 0) throw new Error("No header row found. The file needs the template columns (EXP Serial, EXP Year, ...). Download the template.");
  const cols = grid[hi].map((h) => ALIASES[key(h)] ?? null);
  const parsed: FileRow[] = [];
  grid.slice(hi + 1).forEach((r, i) => {
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
    // rows with only an EXP Type are empty
    if (!Object.entries(vals).some(([k, v]) => v && k !== "type")) return;
    const { type = "", amount = "", ...fields } = vals;
    const trade_code = tradeCode;
    // empty cells leave values unchanged on update
    const kept = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== ""));
    parsed.push({ n: hi + i + 2, trade_code, type, amount, fields: kept, label: kept.exp_serial && kept.exp_year ? `${kept.exp_serial}/${kept.exp_year}` : "", raw: vals });
  });
  if (!parsed.length) throw new Error("No EXP rows found under the headers");
  if (parsed.length > 2000) throw new Error("Up to 2000 rows per file. Split the file and import in parts.");
  return parsed;
}

function Steps({ step }: { step: number }) {
  const names = ["Get the template", "Upload the file", "Review and import"];
  return (
    <ol className="flex items-center gap-2 text-[0.8125rem]">
      {names.map((n, i) => (
        <li key={n} className="flex min-w-0 items-center gap-2">
          {i > 0 && <span className="h-px w-5 bg-line sm:w-8" />}
          <span className={cn("grid size-5 shrink-0 place-items-center rounded-full text-[0.6875rem] font-semibold", i < step ? "bg-ok text-white" : i === step ? "bg-accent text-white" : "bg-raised text-mut")}>
            {i < step ? <Check className="size-3" /> : i + 1}
          </span>
          <span className={cn("truncate", i === step ? "font-medium" : "hidden text-mut sm:inline")}>{n}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Import or bulk update EXPs in three steps: template, upload, review.
 * Every row is checked on the server first; only the rows that pass are saved.
 */
export function BulkExpDialog({ open, onOpenChange, mode = "create", prefill, tradeId }: { open: boolean; onOpenChange: (o: boolean) => void; mode?: BulkMode; prefill?: Exp[]; tradeId?: string }) {
  const refresh = useRefresh();
  const create = mode === "create";
  const ref = useRef<HTMLInputElement>(null);
  const { data: allTrades } = useTrades();
  const { data: allExps } = useAllExps();
  const trades = useMemo(() => (allTrades ?? []).filter((t) => t.status === "active" && t.contract_signed !== false), [allTrades]);
  const [preset, setPreset] = useState(tradeId ?? "");
  const [rows, setRows] = useState<FileRow[]>([]);
  const [checks, setChecks] = useState<Record<number, Result>>({});
  const [done, setDone] = useState<Record<number, Result>>({});
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [view, setView] = useState<"all" | "problems" | "ready">("all");
  const [drag, setDrag] = useState(false);
  const [step, setStep] = useState(0);

  const picked = trades.find((t) => t.id === preset);
  const tradeInfo = picked ? { code: picked.code, sc: picked.sales_contract_no, buyer: picked.importer_name } : undefined;
  const needTrade = create && !picked;

  async function downloadTemplate() {
    setBusy("Preparing the file");
    try {
      const date = new Date().toISOString().slice(0, 10);
      if (!create && prefill?.length) {
        saveBlob(`exp-correction-${date}.xlsx`, await buildExpWorkbook({ mode: "update", rows: prefill.map(rowFromExp) }));
      } else {
        saveBlob(create ? `bulk-exp-${picked?.code ?? "template"}.xlsx` : "exp-correction-template.xlsx", await buildExpWorkbook({ mode, trade: tradeInfo, emptyRows: 300 }));
      }
      setStep(1);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function read(f?: File) {
    if (!f) return;
    setBusy("Reading the file");
    try {
      if (needTrade) throw new Error("Pick the trade first");
      const parsed = await parseFile(f, picked?.code ?? "");
      setRows(parsed);
      setFileName(f.name);
      setDone({});
      setChecks({});
      setStep(2);
      setBusy(`Checking ${parsed.length} row${parsed.length === 1 ? "" : "s"}`);
      const res = await runBulk(mode, parsed, false);
      const c = Object.fromEntries(res.map((r) => [r.n, r]));
      setChecks(c);
      setView(res.some((r) => !r.ok) ? "problems" : "all");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
      if (ref.current) ref.current.value = "";
    }
  }

  const ready = rows.filter((r) => checks[r.n]?.ok && !done[r.n]?.ok);
  const problems = rows.filter((r) => (done[r.n] && !done[r.n].ok) || (checks[r.n] && !checks[r.n].ok));
  const saved = rows.filter((r) => done[r.n]?.ok);
  const checked = rows.length > 0 && rows.every((r) => checks[r.n]);

  async function run() {
    setBusy(create ? "Creating EXPs" : "Updating EXPs");
    setProgress(0);
    try {
      const res = await runBulk(mode, ready, true, (d) => setProgress(Math.round((d / ready.length) * 100)));
      setDone((s) => ({ ...s, ...Object.fromEntries(res.map((r) => [r.n, r])) }));
      const ok = res.filter((r) => r.ok).length;
      const bad = res.length - ok;
      toast[bad ? "warning" : "success"](`${ok} EXP${ok === 1 ? "" : "s"} ${create ? "created" : "updated"}${bad ? `, ${bad} failed` : ""}`);
      setView(bad ? "problems" : "all");
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function errorReport() {
    const bad = problems;
    const blob = await buildExpWorkbook({ mode, trade: tradeInfo, rows: bad.map((r) => r.raw), emptyRows: bad.length + 50, errors: bad.map((r) => (done[r.n] ?? checks[r.n])?.error) });
    saveBlob(`${create ? "bulk-exp" : "exp-correction"}-problems.xlsx`, blob);
  }

  const reset = () => { setRows([]); setChecks({}); setDone({}); setFileName(""); setStep(1); };
  const close = (o: boolean) => { if (!busy) { onOpenChange(o); if (!o) { reset(); setStep(0); } } };
  const idOf = (code?: string) => (code ? (allExps ?? []).find((e) => e.code === code)?.id : undefined);
  const list = view === "problems" ? problems : view === "ready" ? rows.filter((r) => checks[r.n]?.ok) : rows;

  const footer = step < 2 ? (
    <>
      {busy && <span className="mr-auto flex items-center gap-2 self-center text-[0.8125rem] text-mut"><Loader2 className="size-4 animate-spin" /> {busy}</span>}
      <Button variant="outline" onClick={() => close(false)} disabled={!!busy}>Cancel</Button>
      {step === 0 && <Button variant="ghost" disabled={needTrade} onClick={() => setStep(1)}>I already have a file</Button>}
    </>
  ) : (
    <>
      {busy ? (
        <span className="mr-auto flex min-w-[12rem] flex-1 items-center gap-3 self-center text-[0.8125rem] text-mut">
          <Loader2 className="size-4 shrink-0 animate-spin" /> {busy}
          {progress !== null && <Progress value={progress} className="max-w-[12rem]" />}
        </span>
      ) : (
        <Button variant="ghost" className="mr-auto" onClick={reset}><RotateCcw /> Upload another file</Button>
      )}
      <Button variant="outline" onClick={() => close(false)} disabled={!!busy}>{saved.length ? "Done" : "Cancel"}</Button>
      {(ready.length > 0 || !saved.length) && (
        <Button disabled={!ready.length || !!busy || !checked} onClick={run}>
          {create ? "Create" : "Update"} {ready.length || ""} EXP{ready.length === 1 ? "" : "s"}
        </Button>
      )}
    </>
  );

  return (
    <Modal open={open} onOpenChange={close} xwide title={create ? "Bulk EXP" : "EXP correction"} description={create ? "Add many EXPs to one trade from an Excel file." : "Fill in or correct many EXPs from one Excel file."} footer={footer}>
      <div className="mb-4 border-b border-line pb-3"><Steps step={step} /></div>
      {step === 0 && (
        <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
          <div className="flex flex-col gap-3">
            <p className="text-[0.8125rem]">
              {create
                ? "Pick the trade, download the Excel template, fill one row per EXP, then upload it. The template has dropdowns for EXP Type, Unit ISO, Incoterm and Dup Flag, and marks the cells each row still needs."
                : prefill?.length
                  ? `Download the ${prefill.length} EXP${prefill.length === 1 ? "" : "s"} you selected as an Excel file, fill in or correct the cells, then upload it.`
                  : "Download the template, add one row per EXP to correct (matched by EXP Serial + EXP Year), then upload it."}
            </p>
            {create && (
              <Field label="Trade" required hint="Every EXP in the file is added to this trade.">
                <TradePicker trades={trades} value={preset} onChange={setPreset} placeholder="Type an SC number, trade code or buyer" />
              </Field>
            )}
            <Button className="self-start" disabled={!!busy || needTrade} onClick={downloadTemplate}>
              <Download /> {!create && prefill?.length ? `Download ${prefill.length} EXPs` : "Download template"}
            </Button>
          </div>
          <div className="rounded-xl border border-line bg-bg p-4 text-[0.8125rem]">
            <div className="mb-2 font-medium">Advance or Regular</div>
            <p className="text-mut">Both are the same EXP. The type only decides what is needed now.</p>
            <dl className="mt-3 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2">
              <dt className="font-medium">Advance</dt><dd className="text-mut">Issued before shipment. 11 fields now; shipment, invoice and bank fields later.</dd>
              <dt className="font-medium">Regular</dt><dd className="text-mut">Everything is known. All 23 fields.</dd>
            </dl>
            <p className="mt-3 text-mut">{create ? "Lc Contact and Importer fill from the trade. Each EXP number (Serial + Year) can exist only once." : "Empty cells keep the saved value. Locked fields and Amount Inv do not change. Set EXP Type to Regular to complete an Advance EXP."}</p>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-3">
          {create && picked && <div className="rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[0.8125rem]">EXPs in this file are added to <span className="code-id font-medium">{picked.code}</span> · SC {picked.sales_contract_no} · {picked.importer_name}</div>}
          <input ref={ref} type="file" className="hidden" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => read(e.target.files?.[0])} />
          <button
            type="button"
            disabled={!!busy}
            onClick={() => ref.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); read(e.dataTransfer.files?.[0]); }}
            className={cn("flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition", drag ? "border-accent bg-accent/5" : "border-line hover:border-mut hover:bg-bg")}
          >
            {busy ? <Loader2 className="size-7 animate-spin text-mut" /> : <UploadCloud className="size-7 text-mut" />}
            <span className="text-[0.875rem] font-medium">{busy ?? "Drop the filled file here, or click to choose"}</span>
            <span className="text-[0.75rem] text-mut">Excel (.xlsx) or CSV, up to 2000 rows. Nothing is saved until you confirm.</span>
          </button>
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setStep(0)}><ArrowLeft /> Back to the template</Button>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
            <FileSpreadsheet className="size-4 text-mut" />
            <span className="truncate font-medium">{fileName}</span>
            <span className="text-mut">· {rows.length} row{rows.length === 1 ? "" : "s"}{create && picked ? <> · to <span className="code-id text-fg">{picked.code}</span> SC {picked.sales_contract_no}</> : null}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: saved.length ? (create ? "Created" : "Updated") : "Ready", n: saved.length || rows.filter((r) => checks[r.n]?.ok).length, tone: saved.length ? "text-ok" : "" },
              { label: "With problems", n: problems.length, tone: problems.length ? "text-bad" : "" },
              { label: saved.length ? "Still to save" : "Checked", n: saved.length ? ready.length : Object.keys(checks).length, tone: "" },
            ].map((k) => (
              <div key={k.label} className="rounded-xl border border-line bg-bg px-3.5 py-2.5">
                <div className="text-[0.75rem] text-mut">{k.label}</div>
                <div className={cn("num text-[1.125rem] font-semibold", k.tone)}>{k.n}</div>
              </div>
            ))}
          </div>
          {problems.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bad/30 bg-bad/[0.04] px-3.5 py-2.5 text-[0.8125rem]">
              <span>{problems.length} row{problems.length === 1 ? "" : "s"} will be skipped. Fix {problems.length === 1 ? "it" : "them"} in the file and upload it again{ready.length ? ", or import the others now" : ""}.</span>
              <Button size="sm" variant="outline" onClick={errorReport}><Download /> Download rows with problems</Button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segments
              value={view}
              onChange={setView}
              options={[
                { value: "all", label: "All", count: rows.length },
                { value: "problems", label: "Problems", count: problems.length },
                { value: "ready", label: "Ready", count: rows.filter((r) => checks[r.n]?.ok).length },
              ]}
            />
          </div>
          <div className="scroll-thin max-h-[46vh] overflow-auto rounded-lg border border-line">
            <table className="tbl min-w-[48rem]">
              <thead><tr>{["Row", "EXP number", "Type", "Amount Inv", "Result"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {list.map((r) => {
                  const d = done[r.n], c = checks[r.n];
                  const err = (d && !d.ok && d.error) || (c && !c.ok && c.error);
                  const id = d?.ok ? idOf(d.code) : undefined;
                  return (
                    <tr key={r.n} className={cn(err && "bg-bad/[0.04]")}>
                      <td className="num text-mut">{r.n}</td>
                      <td className="code-id">{r.label}</td>
                      <td>{r.type ? (/^dup/i.test(r.type) ? "Regular" : r.type[0].toUpperCase() + r.type.slice(1).toLowerCase()) : create ? "Advance" : ""}</td>
                      <td className="num">{r.amount ? money(r.amount) : ""}</td>
                      <td className="max-w-[26rem]">
                        {d?.ok ? (id ? <Link to={`/exps/${id}`} className="chip chip-ok code-id hover:underline">{create ? "Created" : "Updated"} {d.code}</Link> : <Chip label={`${create ? "Created" : "Updated"} ${d.code ?? ""}`} tone="ok" />)
                          : err ? <span className="text-[0.75rem] text-bad">{err}</span>
                          : !c ? <span className="text-[0.75rem] text-mut">Checking</span>
                          : <Chip label="Ready" tone="info" dot={false} />}
                      </td>
                    </tr>
                  );
                })}
                {!list.length && <tr><td colSpan={5} className="py-6 text-center text-mut">Nothing here</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
