import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { rpc, useAllExps, useRefresh, useTrades } from "@/lib/api";
import { money, downloadCsv, errMsg } from "@/lib/format";
import { Button, Chip, Modal } from "./ui";

const HEADERS = ["SC number", "Shipment ID", "EXP number", "AWB number", "Flight number", "Shipment date", "Amount BDT", "Amount USD", "Advance"] as const;
type Raw = Record<(typeof HEADERS)[number], string>;
type Row = Raw & { n: number; tradeId?: string; tradeCode?: string; amount: number; amountUsd: number | null; advance: boolean; date: string; errors: string[]; result?: "ok" | string };

/** Splits CSV text into rows, handling quotes. */
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
  return out.filter((r) => r.some((x) => x.trim()));
}

const toDate = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  if (!s) return "";
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "invalid";
};
const num = (v: string) => Number(String(v ?? "").replace(/[,$৳\s]/g, "")) || 0;

export function BulkExpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: trades } = useTrades();
  const { data: exps } = useAllExps();
  const refresh = useRefresh();
  const ref = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);

  function validate(raw: Raw[]): Row[] {
    const used = new Map<string, number>();
    const seenExp = new Set<string>();
    const existingExp = new Set((exps ?? []).map((e) => (e.exp_no ?? "").toLowerCase()).filter(Boolean));
    return raw.map((r, i) => {
      const errors: string[] = [];
      const sc = (r["SC number"] ?? "").trim().toLowerCase();
      const t = (trades ?? []).find((x) => x.sales_contract_no.toLowerCase() === sc || x.code.toLowerCase() === sc);
      if (!sc) errors.push("SC number missing");
      else if (!t) errors.push("Trade not found");
      else if (t.status !== "active") errors.push("Trade is not active");
      else if (t.contract_signed === false) errors.push("Sales contract not signed");
      const advance = /^(y|yes|true|1|advance)$/i.test((r.Advance ?? "").trim());
      const usdV = num(r["Amount USD"]);
      let amount = num(r["Amount BDT"]);
      if (!amount && usdV && t?.exchange_rate) amount = Math.round(usdV * Number(t.exchange_rate) * 100) / 100;
      if (!(amount > 0)) errors.push("Amount missing");
      if (!advance && !(r["Shipment ID"] ?? "").trim()) errors.push("Shipment ID needed (or mark Advance)");
      const date = toDate(r["Shipment date"]);
      if (date === "invalid") errors.push("Date not understood");
      const expNo = (r["EXP number"] ?? "").trim().toLowerCase();
      if (expNo && (existingExp.has(expNo) || seenExp.has(expNo))) errors.push("EXP number already used");
      if (expNo) seenExp.add(expNo);
      if (t && amount > 0) {
        const after = (used.get(t.id) ?? Number(t.exp_issued ?? 0)) + amount;
        if (after > Number(t.contract_amount) + 0.0001) errors.push(`Over contract by ${money(after - Number(t.contract_amount))}`);
        used.set(t.id, after);
      }
      return { ...r, n: i + 2, tradeId: t?.id, tradeCode: t?.code, amount, amountUsd: usdV || null, advance, date: date === "invalid" ? "" : date, errors };
    });
  }

  async function read(f?: File) {
    if (!f) return;
    setReading(true);
    try {
      let grid: unknown[][];
      if (/\.xlsx$/i.test(f.name)) {
        const readXlsx = (await import("read-excel-file")).default;
        grid = (await readXlsx(f)) as unknown[][];
      } else {
        grid = parseCsv((await f.text()).replace(/^﻿/, ""));
      }
      const head = (grid[0] ?? []).map((h) => String(h ?? "").trim().toLowerCase());
      const idx = HEADERS.map((h) => head.indexOf(h.toLowerCase()));
      if (idx[0] < 0) throw new Error("The first row must hold the template headers (SC number, Shipment ID, ...). Download the template.");
      const raw = grid.slice(1).map((r) => Object.fromEntries(HEADERS.map((h, j) => [h, idx[j] >= 0 ? (r[idx[j]] instanceof Date ? (r[idx[j]] as Date).toISOString().slice(0, 10) : String(r[idx[j]] ?? "")) : ""])) as Raw);
      if (!raw.length) throw new Error("No rows found under the headers");
      if (raw.length > 200) throw new Error("Up to 200 rows per file");
      setRows(validate(raw));
      setFileName(f.name);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setReading(false);
      if (ref.current) ref.current.value = "";
    }
  }

  async function run() {
    setRunning(true);
    const next = [...rows];
    let ok = 0;
    for (let i = 0; i < next.length; i++) {
      const r = next[i];
      if (r.errors.length || r.result === "ok") continue;
      try {
        await rpc("create_exp", {
          p_trade: r.tradeId,
          p_amount: r.amount,
          p_advance: r.advance,
          p_fields: { shipment_id: r["Shipment ID"].trim(), exp_no: r["EXP number"].trim(), awb_no: r["AWB number"].trim(), flight_no: r["Flight number"].trim(), shipment_date: r.date, amount_usd: r.amountUsd },
        });
        next[i] = { ...r, result: "ok" };
        ok++;
      } catch (e) {
        next[i] = { ...r, result: errMsg(e) };
      }
      setRows([...next]);
    }
    setRunning(false);
    refresh();
    toast.success(`${ok} EXP${ok === 1 ? "" : "s"} created`);
  }

  const ready = rows.filter((r) => !r.errors.length && r.result !== "ok").length;
  const close = (o: boolean) => { if (!running) { onOpenChange(o); if (!o) { setRows([]); setFileName(""); } } };

  return (
    <Modal
      open={open}
      onOpenChange={close}
      wide
      title="Import EXPs"
      description="Add many EXPs at once from the Bangladesh Bank entries. One row per EXP."
      footer={
        <>
          <Button variant="outline" onClick={() => close(false)} disabled={running}>{rows.some((r) => r.result === "ok") ? "Done" : "Cancel"}</Button>
          <Button disabled={!ready || running} loading={running} onClick={run}>Create {ready || ""} EXP{ready === 1 ? "" : "s"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadCsv("exp-import-template.csv", [
                { "SC number": "VEG/SU/36", "Shipment ID": "SH-1001", "EXP number": "1234-000123-2026", "AWB number": "176-12345675", "Flight number": "EK585", "Shipment date": "2026-11-01", "Amount BDT": "", "Amount USD": "26400", Advance: "no" },
              ])
            }
          >
            <Download /> Template
          </Button>
          <input ref={ref} type="file" className="hidden" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => read(e.target.files?.[0])} />
          <Button size="sm" disabled={reading || running} onClick={() => ref.current?.click()}>
            {reading ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} {fileName ? "Choose another file" : "Choose CSV or Excel"}
          </Button>
          {fileName && <span className="truncate text-[0.8125rem] text-mut">{fileName}</span>}
        </div>
        <p className="text-[0.75rem] text-mut">
          SC number can also be the trade code. Leave Amount BDT empty to convert Amount USD with the trade exchange rate. Advance is yes or no. Dates as yyyy-mm-dd or dd/mm/yyyy.
        </p>
        {rows.length > 0 && (
          <div className="scroll-thin max-h-[50vh] overflow-auto rounded-lg border border-line">
            <table className="tbl min-w-[44rem]">
              <thead><tr>{["Row", "Trade", "Shipment ID", "EXP number", "Date", "Amount", "Check"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.n}>
                    <td className="num text-mut">{r.n}</td>
                    <td className="code-id">{r.tradeCode ?? r["SC number"]}</td>
                    <td className="code-id">{r["Shipment ID"] || (r.advance ? <span className="text-mut">Advance</span> : "")}</td>
                    <td className="code-id">{r["EXP number"]}</td>
                    <td className="code-id">{r.date}</td>
                    <td className="num">{r.amount ? money(r.amount) : ""}</td>
                    <td className="max-w-[16rem]">
                      {r.result === "ok" ? <Chip label="Created" tone="ok" /> : r.result ? <span className="text-[0.75rem] text-bad">{r.result}</span> : r.errors.length ? <span className="text-[0.75rem] text-bad">{r.errors.join(". ")}</span> : <Chip label="Ready" tone="info" dot={false} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
