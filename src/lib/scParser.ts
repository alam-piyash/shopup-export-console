/**
 * Reads a Sales Contract / Proforma Invoice in the ShopUp layout (VEG/SU/xx) and returns the trade form values.
 * Works on the text layer of the PDF, so scanned images are not supported.
 */
export type ParsedSc = {
  fields: Record<string, string>;
  notify: { name: string; address: string }[];
  items: { description: string; carton_size: string; hs_code: string; incoterm: string; quantity_kg: string; rate_usd_per_kg: string }[];
  freightUsd: string;
  amendments: { no: string; date: string }[];
  signatory?: { name: string; designation: string };
};

type Item = { str: string; x: number; y: number; w: number };
export type Line = { y: number; left: string; right: string; full: string };

const ymd = (dmy?: string) => {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(dmy ?? "");
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
};
const num = (s?: string) => (s ?? "").replace(/[$,\s]/g, "");

/** Groups text items into visual lines and splits each line into a left and right column. */
export function toLines(items: Item[], pageWidth: number): Line[] {
  const sorted = [...items].filter((i) => i.str !== "").sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Item[][] = [];
  // whitespace items only matter inside a row

  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r[0].y - it.y) < 3);
    if (row) row.push(it); else rows.push([it]);
  }
  const mid = pageWidth * 0.5;
  const join = (arr: Item[]) => {
    let out = "", lastEnd = -1;
    for (const it of arr.sort((a, b) => a.x - b.x)) {
      if (!it.str.trim()) { if (out && !out.endsWith(" ")) out += " "; lastEnd = it.x + it.w; continue; }
      if (lastEnd >= 0 && !out.endsWith(" ")) out += it.x - lastEnd > 12 ? "   " : it.x - lastEnd > 1.5 ? " " : "";
      else if (lastEnd >= 0 && it.x - lastEnd > 12) out += "  ";
      out += it.str;
      lastEnd = it.x + it.w;
    }
    return out.replace(/\s+$/, "").replace(/^\s+/, "");
  };
  return rows.map((r) => ({
    y: r[0].y,
    left: join(r.filter((i) => i.x < mid)),
    right: join(r.filter((i) => i.x >= mid)),
    full: join(r),
  }));
}

export function parseScLines(lines: Line[]): ParsedSc {
  const f: Record<string, string> = {};
  const full = lines.map((l) => l.full);
  const all = full.join("\n");
  const pick = (re: RegExp, src = all) => (re.exec(src)?.[1] ?? "").trim();
  const idx = (re: RegExp) => lines.findIndex((l) => re.test(l.full));

  f.contract_date = ymd(pick(/DATE:\s*(\d{1,2}\/\d{1,2}\/\d{4})/));
  f.sales_contract_no = pick(/(?:SALES CONTRACT NO|SC NO)\s*:\s*([A-Z0-9/\-]+)/i);
  f.shipping_mark = pick(/SHIPPING MARK:\s*([^\n]+?)(?:\s{3,}|$)/m);

  // Exporter block (left column, lines after EXPORTER:)
  const ex = idx(/EXPORTER:/);
  const by = idx(/CONSIGNEE\s*\/\s*BUYER:/);
  if (ex >= 0 && by > ex) {
    const blk = lines.slice(ex + 1, by).map((l) => l.left.trim()).filter(Boolean);
    f.exporter = blk[0] ?? "";
    const tel = blk.find((s) => /^Tel/i.test(s));
    const mail = blk.find((s) => /^Email/i.test(s));
    f.exporter_phone = (tel ?? "").replace(/^Tel\s*:\s*/i, "");
    f.exporter_email = (mail ?? "").replace(/^Email\s*:\s*/i, "");
    f.exporter_address = blk.slice(1).filter((s) => s !== tel && s !== mail).join(", ");
  }

  // Buyer block (left column, until NOTIFY PARTY)
  const np = idx(/NOTIFY PARTY:/);
  if (by >= 0) {
    const blk = lines.slice(by + 1, np > by ? np : by + 8).map((l) => l.left.trim()).filter(Boolean);
    f.importer_name = blk[0] ?? "";
    const addr: string[] = [];
    let inAddr = false;
    for (const s of blk.slice(1)) {
      if (/^CR NO/i.test(s)) { f.buyer_cr_no = s.replace(/^CR NO\s*:\s*/i, ""); inAddr = false; }
      else if (/^VAT/i.test(s)) { f.buyer_vat_no = s.replace(/^VAT\s*REG\w*\s*:\s*/i, ""); inAddr = false; }
      else if (/^ADDRESS/i.test(s)) { addr.push(s.replace(/^ADDRESS\s*:\s*/i, "")); inAddr = true; }
      else if (inAddr) addr.push(s);
    }
    f.buyer_address = addr.join(" ").replace(/\s+,/g, ",").replace(/\s{2,}/g, " ").trim();
  }

  // Bank (right column)
  const right = lines.map((l) => l.right).join("\n");
  f.bank_name = pick(/BANK NAME:\s*([^\n]+)/, right);
  f.bank_branch = pick(/BRANCH:\s*([^\n]+)/, right);
  f.bank_routing_no = pick(/ROUTING NO:\s*([^\n]+)/, right);
  f.bank_swift = pick(/SWIFT CODE:\s*([^\n]+)/, right);
  f.bank_account_name = pick(/ACCOUNT NAME:\s*([^\n]+)/, right);
  f.bank_account_no = pick(/ACCOUNT NUMBER:\s*([^\n]+)/, right);

  // Notify parties (left column, NOTIFY PARTY: until CARRIAGE BY)
  const cb = idx(/CARRIAGE BY/);
  const notify: { name: string; address: string }[] = [];
  if (np >= 0) {
    const blk = lines.slice(np + 1, cb > np ? cb : np + 12).map((l) => l.left.trim()).filter(Boolean);
    let cur: { name: string; address: string } | null = null;
    for (const s of blk) {
      const m = /^Notify\s*\d+\s*:\s*(.+)$/i.exec(s);
      if (m) { cur = { name: m[1].trim(), address: "" }; notify.push(cur); }
      else if (/^ADDRESS\s*:/i.test(s) && cur) cur.address = s.replace(/^ADDRESS\s*:\s*/i, "");
      else if (!cur || /\b(LLC|LTD|LIMITED|BHD|EST|SOC|INC|PTE|CO|CORP|GMBH|FZE|FZCO|TRADING)\.?$/i.test(s)) { cur = { name: s, address: "" }; notify.push(cur); }
      else cur.address = cur.address ? `${cur.address} ${s}` : s;
    }
  }
  // Origin / destination: the line after the header holds both values
  const od = idx(/COUNTRY OF ORIGIN/);
  if (od >= 0) {
    for (const l of lines.slice(od + 1, od + 4)) {
      const r = l.right.trim();
      if (!r || /COUNTRY/i.test(r)) continue;
      const parts = r.split(/\s{3,}/).filter(Boolean);
      if (parts.length >= 2) { f.country_of_origin = parts[0]; f.country_of_destination = parts[parts.length - 1]; break; }
      const m = /^(BANGLADESH|\S+)\s+(.+)$/i.exec(r);
      if (m) { f.country_of_origin = m[1]; f.country_of_destination = m[2]; break; }
    }
  }

  // Shipping and terms
  const carriage = pick(/CARRIAGE BY\s+(By \w+|Air|Sea|Road)/i);
  f.carriage_by = carriage ? (/^by/i.test(carriage) ? carriage.replace(/^by/i, "By") : `By ${carriage}`) : "";
  f.departure_port = pick(/DEPARTURE (?:AIRPORT|PORT)\s+([^\n]+?)(?:\s{3,}|$)/m);
  const pe = idx(/POINT OF ENTRY/);
  if (pe >= 0) {
    const vals = [lines[pe - 1], lines[pe], lines[pe + 1]].filter(Boolean)
      .map((l) => l.left.replace(/POINT OF ENTRY|DEPARTURE (?:AIRPORT|PORT).*/i, "").trim())
      .filter((s) => s && !/^(DHAKA|EXP NO)/i.test(s));
    f.point_of_entry = vals.join(" ").replace(/\s{2,}/g, " ");
  }
  const tp = idx(/TERMS OF DELIVERY AND PAYMENT/);
  if (tp >= 0) {
    const terms: string[] = [];
    for (const l of lines.slice(tp + 1, tp + 6)) {
      const r = l.right.trim();
      if (/Shipment Timeline|Contract Expiry/i.test(r)) break;
      if (r) terms.push(r);
    }
    f.payment_terms = terms.join(" ");
  }
  f.shipment_deadline = ymd(pick(/Shipment Timeline:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i));
  f.shipment_timeline = pick(/Shipment Timeline:\s*([^\n]+)/i);
  f.expiry_date = ymd(pick(/Contract Expiry Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i));
  f.tolerance_pct = pick(/Tolerance for quantity and amount is\s*(\d+(?:\.\d+)?)%/i);

  // Items
  const head = idx(/ITEM DESCRIPTION/);
  const end = idx(/Total CFR Amount/i);
  const items: ParsedSc["items"] = [];
  let freightUsd = "";
  if (head >= 0) {
    let cur: ParsedSc["items"][number] | null = null;
    for (const l of lines.slice(head + 1, end > head ? end + 1 : head + 40)) {
      const s = l.full.trim();
      const m = /^(\d+)\s+(.+?)\s{2,}([\d,]+(?:\.\d+)?)\s+\$\s?([\d,]+(?:\.\d+)?)/.exec(s);
      if (m) {
        cur = { description: m[2].trim(), carton_size: "", hs_code: "", incoterm: "", quantity_kg: num(m[3]), rate_usd_per_kg: num(m[4]) };
        items.push(cur);
        continue;
      }
      if (/Freight Cost/i.test(s)) { freightUsd = num(pick(/\$\s?([\d,]+(?:\.\d+)?)\s*$/, s)); continue; }
      if (!cur) continue;
      const ctn = /CTN Size:\s*\(?([^)]+?)\)?\s*(?:HS|$)/i.exec(s);
      if (ctn) cur.carton_size = ctn[1].trim();
      const hs = /(?:HS\s*Code:|^Code:)\s*([\d ]{4,})/i.exec(s);
      if (hs) cur.hs_code = hs[1].trim();
      const inc = /Incoterms?:\s*([A-Z]{3})/i.exec(s);
      if (inc) cur.incoterm = inc[1].toUpperCase();
    }
  }

  // Amendments
  const amendments: ParsedSc["amendments"] = [];
  const re = /AMENDMENT NO:\s*(\d+)(?:[\s\S]{0,40}?AMENDMENT DATE:\s*(\d{1,2}\/\d{1,2}\/\d{4}))?/g;
  let am: RegExpExecArray | null;
  while ((am = re.exec(right))) amendments.push({ no: am[1], date: ymd(am[2]) });

  const sig = { name: pick(/^Name:[ \t]*(\S[^\n]*?)(?:\s{3,}Name:|$)/m), designation: pick(/^Designation:[ \t]*(\S[^\n]*?)(?:\s{3,}Designation:|$)/m) };

  Object.keys(f).forEach((k) => { if (!f[k]) delete f[k]; });
  return { fields: f, notify, items, freightUsd, amendments, signatory: sig.name ? sig : undefined };
}

/** Loads a PDF in the browser and parses it. */
export async function parseScPdf(file: File): Promise<ParsedSc> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const lines: Line[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = (tc.items as { str: string; transform: number[]; width: number }[]).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] - p * 10000, w: i.width }));
    lines.push(...toLines(items, vp.width));
  }
  const parsed = parseScLines(lines);
  if (!parsed.fields.sales_contract_no && !parsed.items.length) throw new Error("This does not look like a ShopUp sales contract. Fill the form by hand.");
  return parsed;
}
