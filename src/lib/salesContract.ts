import { isFreight } from "./masters";

/** Everything the Sales Contract / Proforma Invoice needs. Dates as yyyy-mm-dd. */
export type ScData = {
  exporter: string;
  exporter_address?: string | null;
  exporter_phone?: string | null;
  exporter_email?: string | null;
  sales_contract_no: string;
  contract_date: string;
  amendments?: { no: number; date: string }[];
  shipping_mark?: string | null;
  importer_name: string;
  buyer_cr_no?: string | null;
  buyer_vat_no?: string | null;
  buyer_address?: string | null;
  notify_parties?: { name: string; address: string }[];
  bank_name?: string | null;
  bank_branch?: string | null;
  bank_routing_no?: string | null;
  bank_swift?: string | null;
  bank_account_name?: string | null;
  bank_account_no?: string | null;
  country_of_origin?: string | null;
  country_of_destination?: string | null;
  carriage_by?: string | null;
  departure_port?: string | null;
  point_of_entry?: string | null;
  payment_terms?: string | null;
  shipment_deadline?: string | null;
  shipment_timeline?: string | null;
  expiry_date?: string | null;
  tolerance_pct?: number | string | null;
  signatory_name?: string | null;
  signatory_designation?: string | null;
  items: { description: string; carton_size?: string | null; hs_code?: string | null; incoterm?: string | null; quantity_kg: number | string; rate_usd_per_kg: number | string | null }[];
};

export const dmy = (d?: string | null) => {
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
};
const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function under1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r) parts.push(r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : ""));
  return parts.join(" ");
}
/** 728000 -> "Seven Hundred Twenty-Eight Thousand Dollars Only" */
export function usdInWords(amount: number) {
  const dollars = Math.floor(amount);
  const cents = Math.round((amount - dollars) * 100);
  const scales = ["", "Thousand", "Million", "Billion"];
  const words: string[] = [];
  let n = dollars, i = 0;
  if (n === 0) words.push("Zero");
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) words.unshift(`${under1000(chunk)}${scales[i] ? " " + scales[i] : ""}`);
    n = Math.floor(n / 1000);
    i++;
  }
  return `${words.join(" ")} Dollars${cents ? ` and ${under1000(cents)} Cents` : ""} Only`;
}

export function scTotals(items: ScData["items"]) {
  const goods = items.filter((i) => !isFreight(i.description));
  const freight = items.filter((i) => isFreight(i.description)).reduce((s, i) => s + Number(i.quantity_kg || 0) * Number(i.rate_usd_per_kg || 0), 0);
  const goodsTotal = goods.reduce((s, i) => s + Number(i.quantity_kg || 0) * Number(i.rate_usd_per_kg || 0), 0);
  return { goods, freight: Math.round(freight * 100) / 100, goodsTotal: Math.round(goodsTotal * 100) / 100, total: Math.round((goodsTotal + freight) * 100) / 100 };
}

/** Builds the Sales Contract / Proforma Invoice PDF in the ShopUp layout. */
export async function buildScPdf(d: ScData): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const atMod = (await import("jspdf-autotable")) as unknown as { default: unknown; autoTable?: unknown };
  const autoTable = (typeof atMod.autoTable === "function" ? atMod.autoTable : typeof atMod.default === "function" ? atMod.default : (atMod.default as { default: unknown }).default) as typeof import("jspdf-autotable").default;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 36;
  const black: [number, number, number] = [0, 0, 0];
  const cell = { lineColor: black, lineWidth: 0.6, textColor: black, font: "helvetica", fontSize: 8.5, cellPadding: 4, valign: "top" as const };
  const half = (W - 2 * M) / 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Sales Contract/Proforma Invoice", W / 2, 44, { align: "center" });

  const lines = (rows: (string | null | undefined | false)[]) => rows.filter(Boolean).join("\n");
  const amendments = (d.amendments ?? []).map((a) => `AMENDMENT NO: ${String(a.no).padStart(2, "0")}\nAMENDMENT DATE: ${dmy(a.date)}`).join("\n");

  // Exporter | contract refs ; Buyer | bank ; Notify | origin/destination
  autoTable(doc, {
    startY: 56,
    margin: { left: M, right: M },
    theme: "grid",
    styles: cell,
    columnStyles: { 0: { cellWidth: half }, 1: { cellWidth: half } },
    body: [
      [
        { content: lines([`EXPORTER:`, d.exporter, d.exporter_address, d.exporter_phone && `Tel: ${d.exporter_phone}`, d.exporter_email && `Email: ${d.exporter_email}`]) },
        { content: lines([`DATE: ${dmy(d.contract_date)}`, `SALES CONTRACT NO: ${d.sales_contract_no}`, amendments, d.shipping_mark && `SHIPPING MARK: ${d.shipping_mark}`]) },
      ],
      [
        { content: lines(["CONSIGNEE / BUYER:", d.importer_name, d.buyer_cr_no && `CR NO: ${d.buyer_cr_no}`, d.buyer_vat_no && `VAT REG: ${d.buyer_vat_no}`, d.buyer_address && `ADDRESS: ${d.buyer_address}`]) },
        { content: lines(["BANK COORDINATES FOR RECEIVING TT:", d.bank_name && `BANK NAME: ${d.bank_name}`, d.bank_branch && `BRANCH: ${d.bank_branch}`, d.bank_routing_no && `ROUTING NO: ${d.bank_routing_no}`, d.bank_swift && `SWIFT CODE: ${d.bank_swift}`, d.bank_account_name && `ACCOUNT NAME: ${d.bank_account_name}`, d.bank_account_no && `ACCOUNT NUMBER: ${d.bank_account_no}`]) },
      ],
      [
        { content: lines(["NOTIFY PARTY:", ...(d.notify_parties ?? []).map((n, i) => `Notify ${i + 1}: ${n.name}${n.address ? `\nADDRESS: ${n.address}` : ""}`)]) },
        { content: `COUNTRY OF ORIGIN: ${d.country_of_origin || "BANGLADESH"}\n\nCOUNTRY OF DESTINATION: ${d.country_of_destination || ""}` },
      ],
    ],
    didParseCell: (h) => {
      const t = String(h.cell.raw && typeof h.cell.raw === "object" && "content" in h.cell.raw ? h.cell.raw.content : "");
      if (/^(EXPORTER|CONSIGNEE|BANK COORDINATES|NOTIFY PARTY)/.test(t)) h.cell.styles.fontStyle = "normal";
    },
  });

  // Shipping | terms
  const q = 'lastAutoTable' as const;
  type WithLast = { [q]: { finalY: number } };
  const shipTimeline = d.shipment_deadline ? dmy(d.shipment_deadline) : d.shipment_timeline || "";
  autoTable(doc, {
    startY: (doc as unknown as WithLast)[q].finalY,
    margin: { left: M, right: M },
    theme: "grid",
    styles: cell,
    columnStyles: { 0: { cellWidth: half * 0.42 }, 1: { cellWidth: half * 0.58 }, 2: { cellWidth: half } },
    body: [
      ["CARRIAGE BY", d.carriage_by || "", { content: lines(["TERMS OF DELIVERY AND PAYMENT", "", d.payment_terms, "", shipTimeline && `Shipment Timeline: ${shipTimeline}`, d.expiry_date && `Contract Expiry Date: ${dmy(d.expiry_date)}`]), rowSpan: 6 }],
      ["DEPARTURE AIRPORT", d.departure_port || ""],
      ["POINT OF ENTRY", d.point_of_entry || ""],
      ["EXP NO.", ""],
      ["AWB NO.", ""],
      ["FLIGHT NO.", ""],
    ],
  });

  // Items
  const t = scTotals(d.items);
  const body: (string | { content: string; colSpan?: number; styles?: object })[][] = t.goods.map((it, i) => [
    String(i + 1),
    lines([it.description, it.carton_size && `CTN Size: (${it.carton_size})`, it.hs_code && `HS Code: ${it.hs_code}`, it.incoterm && `Incoterms: ${it.incoterm}`]),
    qty(Number(it.quantity_kg)),
    it.rate_usd_per_kg ? usd(Number(it.rate_usd_per_kg)) : "",
    usd(Math.round(Number(it.quantity_kg) * Number(it.rate_usd_per_kg || 0) * 100) / 100),
  ]);
  if (t.freight) body.push(["", "(+) Freight Cost (Subject to Change)", "", "", usd(t.freight)]);
  body.push([{ content: "Total CFR Amount", colSpan: 4, styles: { halign: "right", fontStyle: "bold" } }, { content: usd(t.total), styles: { fontStyle: "bold" } }]);
  autoTable(doc, {
    startY: (doc as unknown as WithLast)[q].finalY + 8,
    margin: { left: M, right: M },
    theme: "grid",
    styles: cell,
    headStyles: { fillColor: [235, 235, 235], textColor: black, fontStyle: "bold", lineColor: black, lineWidth: 0.6, halign: "center" },
    head: [["NO.", "ITEM DESCRIPTION", "QUANTITY (KG)", "RATE/KG (USD)", "TOTAL AMOUNT (USD)"]],
    columnStyles: { 0: { cellWidth: 30, halign: "center" }, 2: { halign: "right", cellWidth: 80 }, 3: { halign: "right", cellWidth: 80 }, 4: { halign: "right", cellWidth: 100 } },
    body,
  });

  let y = (doc as unknown as WithLast)[q].finalY + 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const tol = Number(d.tolerance_pct || 0);
  if (tol) { doc.text(`Tolerance for quantity and amount is ${tol}% more or less at Seller's option`, M, y); y += 14; }
  const words = doc.splitTextToSize(`AMOUNT CHARGEABLE (IN WORDS): USD ${usdInWords(t.total)}`, W - 2 * M - 160);
  doc.text(words, M, y);
  doc.setFont("helvetica", "bold");
  doc.text(`TOTAL CFR   ${usd(t.total)}`, W - M, y, { align: "right" });
  y += 14 * words.length + 34;

  // Signatures
  if (y > doc.internal.pageSize.getHeight() - 110) { doc.addPage(); y = 60; }
  doc.setFont("helvetica", "bold");
  doc.text("AUTHORISED SIGNATORY (SELLER)", M, y);
  doc.text("AUTHORISED SIGNATORY (BUYER)", W / 2 + 20, y);
  y += 56;
  doc.setDrawColor(0);
  doc.line(M, y, M + 200, y);
  doc.line(W / 2 + 20, y, W / 2 + 220, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.text(`Name: ${d.signatory_name || ""}`, M, y);
  doc.text("Name:", W / 2 + 20, y);
  y += 12;
  doc.text(`Designation: ${d.signatory_designation || ""}`, M, y);
  doc.text("Designation:", W / 2 + 20, y);

  return doc.output("blob");
}

export const scFileName = (scNo: string, version?: number) => `SC-${scNo.replace(/[^A-Za-z0-9]+/g, "-")}${version ? `-v${version}` : ""}.pdf`;
