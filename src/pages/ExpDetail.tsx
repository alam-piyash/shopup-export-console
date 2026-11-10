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
import { CI_DOCS, GenerateCiDialog } from "@/components/ciGenerate";
import { AmountChangesPanel, ChangeAmountDialog } from "@/components/expAmount";
import { EXP_FIELDS, EXP_GROUPS, expNumber, fieldValue, isShipped, typeLabel } from "@/lib/expFields";

function ExpFieldsPanel({ exp, onEdit }: { exp: Exp; onEdit: () => void }) {
  const dup = exp.type === "regular";
  const show = (key: string, kind: string) => {
    const v = fieldValue(exp, key);
    if (!v) return null;
    if (kind === "date") return fmtDate(v);
    if (key === "amount" || key === "freight") return money(v);
    if (key === "gross_weight") return `${v} kg`;
    return v;
  };
  const filled = EXP_FIELDS.filter((f) => fieldValue(exp, f.key)).length;
  return (
    <section className="card overflow-hidden">
      <div className="head-strip flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[0.9375rem] font-semibold">EXP details</h2>
          <span className="num text-[0.75rem] text-mut">{filled}/{EXP_FIELDS.length} filled</span>
        </div>
        <Button size="sm" variant="outline" onClick={onEdit}><Pencil /> Edit</Button>
      </div>
      <div className="divide-y divide-line">
        {EXP_GROUPS.map((g) => (
          <div key={g.key} className="grid sm:grid-cols-[8.5rem_minmax(0,1fr)]">
            <div className="flex items-center px-4 pt-2.5 sm:border-r sm:border-line sm:py-2.5" style={{ background: "rgb(var(--bg) / 0.6)" }}>
              <span className="lbl leading-tight">{g.title}</span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-2.5 sm:grid-cols-3 xl:grid-cols-6">
              {EXP_FIELDS.filter((f) => f.group === g.key).map((f) => {
                const v = show(f.key, f.kind);
                const due = !v && (f.stage === "advance" || (dup && f.stage === "regular"));
                return (
                  <div key={f.key} className="min-w-0">
                    <dt className="flex items-center gap-1 text-[0.6875rem] leading-4 text-mut">{f.label}{f.locked && v && <Lock className="size-2.5" aria-label="Locked" />}</dt>
                    <dd className={cn("truncate text-[0.8125rem] font-medium leading-5", !v && "font-normal text-mut/70", due && "text-warn")} title={v ?? undefined}>
                      {v ?? (due ? "Missing" : "Not set")}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 border-t border-line px-4 py-2 text-[0.7188rem] text-mut"><Lock className="size-3" /> Locked fields cannot change once saved.</div>
    </section>
  );
}

export default function ExpDetail() {
  const { expId = "" } = useParams();
  const [edit, setEdit] = useState(false);
  const [changing, setChanging] = useState(false);
  const [generating, setGenerating] = useState(false);
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
            Advance EXP. {exp.fields_missing ? `${exp.fields_missing} field${exp.fields_missing === 1 ? "" : "s"} still empty before it can be a Regular EXP.` : "All fields are filled. Edit it and switch the type to Regular."}
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
            generate: CI_DOCS.includes(d.doc_type) ? { onClick: () => setGenerating(true) } : undefined,
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
        hint="Add a new version each time a copy comes back (Submitted, Signed or your own label), or Generate where a template exists. Earlier versions are kept. Mark final to close a document."
      />
      {generating && <GenerateCiDialog exp={exp} docs={docs} onClose={() => setGenerating(false)} onEditExp={() => { setGenerating(false); setEdit(true); }} />}
      {changing && <ChangeAmountDialog exp={exp} limitLeft={data.limitLeft} onClose={() => setChanging(false)} />}
      {edit && <EditExpDialog exp={exp} available={data.available} onClose={() => setEdit(false)} />}
    </>
  );
}
