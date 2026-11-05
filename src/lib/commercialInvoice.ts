/**
 * Commercial Invoice + Packing List on one page, following the export team's format
 * (Commercial Invoice Data Source Map, Nov 2026). Data comes from the EXP and its trade.
 */

export type CiItem = { description: string; net: number; cartons: number; gross: number };

export type CiData = {
  consignee: string[]; // name first, then address lines
  shipper: string[];
  notify?: string[] | null;
  ercNo?: string;
  vatNo?: string;
  invoiceNo: string;
  invoiceDate?: string | null;
  contractNo: string;
  contractDate?: string | null;
  portOfLoading?: string | null;
  finalDestination?: string | null;
  countryOfOrigin?: string | null;
  shippingMarks?: string | null;
  goodsDescription: string;
  cartons: number;
  netKg: number;
  grossKg: number;
  amount: number;
  items: CiItem[];
  expNo: string;
  expDate?: string | null;
  awbNo?: string | null;
  awbDate?: string | null;
  flightNo?: string | null;
  flightDate?: string | null;
  signFor: string;
};

/** dd/mm/yyyy */
export const dmy = (d?: string | null) => {
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
};
/** $16,500 (cents only when present) */
export const ciMoney = (n: number) =>
  "$" + new Intl.NumberFormat("en-US", { minimumFractionDigits: Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2, maximumFractionDigits: 2 }).format(n);

/** Largest remainder: whole numbers in proportion to weights, summing exactly to total. Ties go to the earlier line. */
export function splitWhole(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!weights.length) return [];
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => ({ i, f: v - Math.floor(v) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) out[order[k].i]++;
  return out;
}

/**
 * Packing list rows. Net per item follows the item quantities, scaled to the EXP net weight;
 * cartons split by net; gross = net plus a share of (gross - net). Every column sums to its total.
 */
export function packingRows(lines: { description: string; qty: number }[], netKg: number, cartons: number, grossKg: number): { rows: CiItem[]; scalePct: number } {
  const goods = lines.filter((l) => l.description.trim() && l.qty > 0);
  if (!goods.length) return { rows: [], scalePct: 0 };
  const plantTotal = goods.reduce((s, l) => s + l.qty, 0);
  const scalePct = plantTotal ? Math.round(((netKg - plantTotal) / plantTotal) * 1000) / 10 : 0;
  const net = splitWhole(Math.round(netKg), goods.map((l) => l.qty));
  const ctn = splitWhole(Math.round(cartons), net);
  const extra = splitWhole(Math.max(0, Math.round(grossKg) - Math.round(netKg)), net);
  const rows = goods.map((l, i) => ({ description: l.description, net: net[i], cartons: ctn[i], gross: net[i] + extra[i] }));
  // every gross must be above its net: move 1 kg from the item with the most slack
  for (const r of rows) {
    if (r.gross <= r.net && r.net > 0) {
      const donor = rows.filter((x) => x !== r).sort((a, b) => b.gross - b.net - (a.gross - a.net))[0];
      if (donor && donor.gross - donor.net > 1) { donor.gross--; r.gross++; }
    }
  }
  return { rows, scalePct };
}

/** Reads field 50K (Ordering Customer) from a SWIFT MT103 TT voucher PDF: name, then address lines. */
export async function readTtNotifyParty(blob: Blob): Promise<string[] | null> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const pdf = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of tc.items as { str: string; transform: number[] }[]) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 2) * 2;
      rows.set(y, [...(rows.get(y) ?? []), { x: it.transform[4], s: it.str }]);
    }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, r]) => lines.push(r.sort((a, b) => a.x - b.x).map((x) => x.s).join(" ").replace(/\s+/g, " ").trim()));
  }
  const i = lines.findIndex((l) => /^50[AFK]\b/.test(l));
  if (i < 0) return null;
  const out: string[] = [];
  for (let j = i; j < lines.length; j++) {
    let l = lines[j];
    if (j > i && /^\d{2}[A-Z]?\b\s*:?/.test(l)) break;
    l = l.replace(/^50[AFK]\s*:?\s*/, "").replace(/^ORDERING CUSTOMER\s*/i, "").trim();
    if (!l || l.startsWith("/")) continue;
    out.push(l.replace(/^\d\//, ""));
  }
  return out.length ? out : null;
}

export async function buildCiPdf(d: CiData): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const atMod = (await import("jspdf-autotable")) as unknown as { default: unknown; autoTable?: unknown };
  const autoTable = (typeof atMod.autoTable === "function" ? atMod.autoTable : typeof atMod.default === "function" ? atMod.default : (atMod.default as { default: unknown }).default) as typeof import("jspdf-autotable").default;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  const black: [number, number, number] = [0, 0, 0];
  const grid = { lineColor: black, lineWidth: 0.6, textColor: black, font: "times", fontSize: 9, cellPadding: 4, valign: "middle" as const, halign: "center" as const };
  const head = { fillColor: [255, 255, 255] as [number, number, number], textColor: black, fontStyle: "bold" as const, lineColor: black, lineWidth: 0.6 };

  const title = (t: string, y: number) => {
    doc.setFont("times", "bold");
    doc.setFontSize(12);
    doc.text(t, W / 2, y, { align: "center" });
    const tw = doc.getTextWidth(t);
    doc.setLineWidth(0.8);
    doc.line(W / 2 - tw / 2, y + 2, W / 2 + tw / 2, y + 2);
  };
  title("COMMERCIAL INVOICE", 60);

  // left block: consignee, shipper, notify party
  doc.setFontSize(9);
  let y = 92;
  const block = (label: string, body: string[]) => {
    doc.setFont("times", "bold");
    doc.text(label, M, y);
    y += 11;
    doc.setFont("times", "normal");
    for (const l of body) {
      for (const part of doc.splitTextToSize(l, 250) as string[]) { doc.text(part, M, y); y += 11; }
    }
    y += 10;
  };
  block("CONSIGNEE:-", d.consignee);
  block("SHIPPER NAME:-", d.shipper);
  if (d.notify?.length) block("NOTIFY PARTY", d.notify);
  const leftEnd = y;

  // right block
  const RX = 320;
  let ry = 92;
  const right = (label: string, value?: string | null, date?: string | null) => {
    doc.setFont("times", "normal");
    doc.text(`${label}${value ?? ""}`, RX, ry);
    if (date) doc.text(`DATE:- ${date}`, RX + 125, ry);
    ry += 11;
  };
  if (d.ercNo) right("ERC NO: ", d.ercNo);
  if (d.vatNo) right("VAT NO: ", d.vatNo);
  right("INV NO: ", d.invoiceNo, dmy(d.invoiceDate));
  right("CONT NO : ", d.contractNo, dmy(d.contractDate));
  ry += 11;
  right("PORT OF LOADING:-", d.portOfLoading ?? "");
  right("FINAL DESTINATION:- ", d.finalDestination ?? "");
  right("COUNTRY OF ORIGIN:-", d.countryOfOrigin ?? "");
  right("SHIPPING MARKS:- ", d.shippingMarks ?? "");

  const kg = (n: number) => `${Math.round(n)}-KGS`;
  const ctn = (n: number) => `${Math.round(n)}-CTN`;
  autoTable(doc, {
    startY: Math.max(leftEnd, ry) + 8,
    margin: { left: M, right: M },
    theme: "grid",
    styles: grid,
    headStyles: head,
    head: [["S/L NO", "DESCRIPTION OF GOODS", "NO. OF PICES", "QUANTITY", "INVOICE AMOUNT"]],
    body: [["1", { content: d.goodsDescription, styles: { halign: "left" } }, `${Math.round(d.cartons)}- CTN`, kg(d.netKg), ciMoney(d.amount)]],
    foot: [[{ content: "TOTAL", colSpan: 2 }, ctn(d.cartons), kg(d.netKg), ciMoney(d.amount)]],
    footStyles: head,
    columnStyles: { 0: { cellWidth: 45 }, 2: { cellWidth: 80 }, 3: { cellWidth: 80 }, 4: { cellWidth: 95 } },
  });

  const after = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  title("PACKING LIST", after + 34);
  autoTable(doc, {
    startY: after + 44,
    margin: { left: M, right: M },
    theme: "grid",
    styles: grid,
    headStyles: head,
    head: [["SL. NO OF PACKAGE", "TOTAL PACKAGE", "DESCRIPTION OF GOODS", "TOTAL WEIGHT (NET) KGS", "TOTAL WEIGHT (GROSS) KGS"]],
    body: d.items.map((r, i) => [String(i + 1), String(r.cartons), { content: r.description, styles: { halign: "left" as const } }, String(r.net), String(r.gross)]),
    foot: [["", ctn(d.cartons), `TOTAL= ${Math.round(d.cartons)} CTN`, kg(d.netKg), kg(d.grossKg)]],
    footStyles: head,
    columnStyles: { 0: { cellWidth: 75 }, 1: { cellWidth: 65 }, 3: { cellWidth: 85 }, 4: { cellWidth: 90 } },
  });

  let by = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
  doc.setFont("times", "normal");
  doc.setFontSize(9);
  const bottom = (label: string, value?: string | null, date?: string | null) => {
    doc.text(label, M, by);
    doc.text(value ?? "", M + 62, by);
    if (date) doc.text(`DATE:-  ${date}`, 320, by);
    by += 12;
  };
  bottom("EXP NO:-", d.expNo, dmy(d.expDate));
  bottom("AWB NO:", d.awbNo, dmy(d.awbDate));
  bottom("FLIGHT NO:-", d.flightNo, dmy(d.flightDate));
  bottom("TOTAL CTN :", ctn(d.cartons));
  doc.setFont("times", "bold");
  doc.text(`FOR:- ${d.signFor}`, W - M, by + 14, { align: "right" });
  return doc.output("blob");
}
