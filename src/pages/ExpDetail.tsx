import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Lock, Pencil, Scale } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { rpc, useRefresh } from "@/lib/api";
import { money, moneyShort, errMsg, fmtDate } from "@/lib/format";
import type { Exp, ExpDoc, ExpDocVersion } from "@/lib/types";
import { Button, Chip, Empty, Kpi, KpiGrid, LoadingRows, Progress, cn } from "@/components/ui";
import { DocPanel, type DocModel } from "@/components/docs";
import { EditExpDialog } from "@/components/expDialogs";
import { AmountChangesPanel, ChangeAmountDialog } from "@/components/expAmount";
import { EXP_FIELDS, expNumber, fieldValue, isRequired, isShipped, typeLabel } from "@/lib/expFields";

function ExpFieldsPanel({ exp, onEdit }: { exp: Exp; onEdit: () => void }) {
  const dup = exp.type === "regular";
  const show = (key: string, kind: string) => {
    const v = fieldValue(exp, key);
    if (!v) return null;
    if (kind === "date") return fmtDate(v);
    if (key === "amount" || key === "freight") return money(v);
    return v;
  };
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h2 className="text-[0.9375rem] font-semibold">EXP details</h2>
          <p className="text-[0.75rem] text-mut">Template fields. Locked fields cannot change once saved.</p>
        </div>
        <Button size="sm" variant="outline" onClick={onEdit}><Pencil /> Edit</Button>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-3 lg:grid-cols-4">
        {EXP_FIELDS.map((f) => {
          const v = show(f.key, f.kind);
          const needed = isRequired(f, true);
          return (
            <div key={f.key} className="min-w-0">
              <dt className="flex items-center gap-1 text-[0.7188rem] text-mut">{f.label}{f.locked && v && <Lock className="size-3" aria-label="Locked" />}</dt>
              <dd className={cn("truncate text-[0.8125rem]", !v && "text-mut", !v && needed && (dup || f.stage === "advance") && "text-warn")} title={v ?? undefined}>
                {v ?? (needed ? "Missing" : "Not set")}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

export default function ExpDetail() {
  const { expId = "" } = useParams();
  const [edit, setEdit] = useState(false);
  const [changing, setChanging] = useState(false);
  const refresh = useRefresh();
  const { data, isLoading, error } = useQuery({
    queryKey: ["exp", expId],
    queryFn: async () => {
      const { data: exp, error } = await supabase.from("exp_overview").select("*").eq("id", expId).single();
      if (error) throw error;
      const [{ data: docs, error: de }, { data: trade, error: te }, { data: versions, error: ve }] = await Promise.all([
        supabase.from("exp_documents").select("*").eq("exp_id", expId).order("sort_order"),
        supabase.from("trade_overview").select("contract_amount, exp_issued, tolerance_pct, status").eq("id", exp.trade_id).single(),
        supabase.from("exp_document_versions").select("*").eq("exp_id", expId).order("version", { ascending: false }),
      ]);
      if (ve) throw ve;
      if (de) throw de;
      if (te) throw te;
      const limit = Math.round(Number(trade.contract_amount) * (1 + Number(trade.tolerance_pct || 0) / 100) * 100) / 100;
      return { exp: exp as Exp, docs: docs as ExpDoc[], versions: (versions ?? []) as ExpDocVersion[], available: Number(trade.contract_amount) - Number(trade.exp_issued), limitLeft: limit - Number(trade.exp_issued), tradeStatus: trade.status as string };
    },
  });

  if (isLoading) return <LoadingRows rows={6} />;
  if (error || !data) return <Empty title="EXP not found" body={error ? errMsg(error) : undefined} />;
  const { exp, docs } = data;
  const finals = docs.filter((d) => d.status === "final").length;
  const total = docs.length || 8;
  const closed = exp.status === "closed";
  const needsShipment = !isShipped(exp);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to={`/trades/${exp.trade_id}`} className="code-id text-[0.8125rem] text-mut hover:text-accent">{exp.trade_code} · {exp.importer_name}</Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <h1 className="h1 code-id">{exp.code}</h1>
            <Chip status={exp.status} />
            <Chip label={`${typeLabel(exp.type)} EXP`} tone={exp.type === "advance" ? "info" : "gray"} dot={false} />
            {exp.is_demo && <Chip label="Demo" tone="gray" dot={false} />}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!!exp.pending_amount_change_id || !["active", "closed"].includes(data.tradeStatus)}
            title={exp.pending_amount_change_id ? "A change is already awaiting approval" : undefined}
            onClick={() => setChanging(true)}
          >
            <Scale /> Change amount
          </Button>
          <Button variant="outline" onClick={() => setEdit(true)}><Pencil /> Edit details</Button>
        </div>
      </div>

      {exp.pending_amount_change_id && <div className="banner chip-info">An amount change is awaiting admin approval. Totals use the current amount until it is approved.</div>}
      {closed && <div className={cn("banner items-center", finals === total ? "chip-ok" : "chip-warn")}><Lock className="size-4" /> {finals === total ? "All shipment documents are final. This EXP closed automatically. Use Change amount if the shipped value differs." : `This EXP is closed. ${total - finals} document${total - finals > 1 ? "s are" : " is"} still missing; upload to complete the file.`}</div>}
      {exp.type === "advance" && (
        <div className="banner chip-warn flex-wrap items-center justify-between">
          <span>
            Advance EXP. {exp.fields_missing ? `${exp.fields_missing} field${exp.fields_missing === 1 ? "" : "s"} still empty for the Duplicate EXP.` : "All fields are filled; mark it a Duplicate EXP."}
            {needsShipment && " Add the Ship Date before uploading documents."}
          </span>
          <Button size="sm" variant="outline" onClick={() => setEdit(true)}>Complete fields</Button>
        </div>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label={exp.amount_changes ? "Amount (updated)" : "Amount"}
          value={moneyShort(exp.amount)}
          usdValue={exp.amount_usd}
          sub={exp.issued_amount !== undefined && Number(exp.issued_amount) !== Number(exp.amount) ? <>Issued on EXP <span className="num">{money(exp.issued_amount)}</span></> : "Same as issued on EXP"}
        />
        <Kpi label="EXP number" value={expNumber(exp) || "Not set"} sub={[exp.awb_no && `AWB ${exp.awb_no}`, exp.flight_no && `Flight ${exp.flight_no}`, exp.shipment_date && `Shipped ${fmtDate(exp.shipment_date)}`].filter(Boolean).join(" · ") || undefined} />
        <Kpi label="Documents final" value={`${finals}/${total}`} sub={<Progress value={(finals / total) * 100} tone={finals === total ? "ok" : "accent"} />} />
        <Kpi
          label="Collection"
          value={exp.collection_status === "approved" ? "Collected" : exp.collection_status ? "Pending" : "Not yet"}
          sub={exp.collection_code ? <span className="code-id">{exp.collection_code}</span> : undefined}
        />
      </KpiGrid>

      <ExpFieldsPanel exp={exp} onEdit={() => setEdit(true)} />
      <AmountChangesPanel exp={exp} />
      <DocPanel
        title="Shipment documents"
        docs={docs.map((d) => {
          const versions = data.versions.filter((v) => v.doc_id === d.id);
          return {
            key: d.id,
            name: d.doc_type,
            status: d.status,
            finalizedAt: d.finalized_at,
            versions,
            folder: "exps",
            disabled: needsShipment ? "Add the Ship Date first" : null,
            onAdd: async ({ file, stage, note, submittedOn }) => {
              await rpc("upload_exp_document", { p_doc: d.id, p_file: file, p_stage: stage, p_note: note || null, p_submitted_on: submittedOn || null });
              refresh();
            },
            onFinal: async () => {
              await rpc("finalize_exp_document", { p_doc: d.id });
              refresh();
            },
          } satisfies DocModel;
        })}
        hint="Add a new version each time a copy comes back (Submitted, Signed or your own label). Earlier versions are kept. Mark final to close a document."
      />
      {changing && <ChangeAmountDialog exp={exp} limitLeft={data.limitLeft} onClose={() => setChanging(false)} />}
      {edit && <EditExpDialog exp={exp} available={data.available} onClose={() => setEdit(false)} />}
    </>
  );
}
