/** Lakh/crore grouping (3 then 2s), e.g. 1,22,00,000. */
export function groupBD(v: number) {
  const [int, dec] = (Math.round(v * 100) / 100).toFixed(2).split(".");
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  const head = rest ? rest + "," + last3 : last3;
  return dec === "00" ? head : head + "." + dec;
}
type N = number | string | null | undefined;

export function bdt(n: N) {
  const v = Number(n ?? 0);
  return (v < 0 ? "-৳" : "৳") + groupBD(Math.abs(v));
}
/** Compact BDT for KPIs: ৳1.22 Cr, ৳30.5 L */
export function bdtShort(n: N) {
  const v = Math.abs(Number(n ?? 0));
  const s = Number(n ?? 0) < 0 ? "-৳" : "৳";
  if (v >= 1e7) return s + (v / 1e7).toFixed(v >= 1e9 ? 0 : 2).replace(/\.?0+$/, "") + " Cr";
  if (v >= 1e5) return s + (v / 1e5).toFixed(2).replace(/\.?0+$/, "") + " L";
  return s + groupBD(v);
}
const usdFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export function usd(n: N) {
  const v = Number(n ?? 0);
  return (v < 0 ? "-$" : "$") + usdFmt.format(Math.abs(v));
}
export function usdOpt(n: N) {
  return n === null || n === undefined || n === "" ? null : usd(n);
}
export function impliedRate(b: N, u: N) {
  const x = Number(b || 0), y = Number(u || 0);
  if (!(x > 0) || !(y > 0)) return null;
  return Math.round((x / y) * 100) / 100;
}
export function rateHint(b: N, u: N) {
  const r = impliedRate(b, u);
  return r ? `Implied rate ৳${r} per USD` : undefined;
}
export const cents = (n: N) => Math.round(Number(n ?? 0) * 100);
export const pct = (a: N, b: N) => (Number(b) ? Math.round((Number(a) / Number(b)) * 100) : 0);

export function fmtDate(d?: string | null) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
export function fmtDateTime(d?: string | null) {
  if (!d) return "";
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
export function timeAgo(d?: string | null) {
  if (!d) return "";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(d);
}
export function daysUntil(d?: string | null) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}
export function errMsg(e: unknown) {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong";
}
export function fileSize(n?: number | null) {
  if (!n) return "";
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return Math.max(1, Math.round(n / 1024)) + " KB";
}
export function initials(s?: string | null) {
  return (s || "?").split(/[ .@_-]/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("");
}

export function calcIncentive(expAmount: number, netProceed: number, freight: number, p: number) {
  const fob = Math.round((netProceed - freight) * 100) / 100;
  const incentive = Math.round(fob * p) / 100;
  const errors: string[] = [];
  if (netProceed > expAmount) errors.push("Net proceed cannot be above the EXP amount");
  if (netProceed <= 0) errors.push("Enter the net proceed");
  if (freight < 0) errors.push("Freight cannot be negative");
  if (freight >= netProceed && netProceed > 0) errors.push("Freight must be less than net proceed");
  if (p <= 0 || p > 100) errors.push("Incentive percent must be between 0 and 100");
  return { fob, incentive, errors };
}

/** Download rows as CSV. */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
