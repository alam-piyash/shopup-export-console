import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, FileText, Loader2, Lock, Pencil, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { rpc, uploadFile, useRefresh } from "@/lib/api";
import { bdtShort, errMsg, fmtDate, fmtDateTime } from "@/lib/format";
import type { Exp, ExpDoc } from "@/lib/types";
import { Button, Chip, Empty, Kpi, KpiGrid, LoadingRows, Panel, Progress, cn } from "@/components/ui";
import { FileLink } from "@/components/files";
import { EditExpDialog } from "@/components/expDialogs";

export default function ExpDetail() {
  const { expId = "" } = useParams();
  const [edit, setEdit] = useState(false);
  const refresh = useRefresh();
  const { data, isLoading, error } = useQuery({
    queryKey: ["exp", expId],
    queryFn: async () => {
      const { data: exp, error } = await supabase.from("exp_overview").select("*").eq("id", expId).single();
      if (error) throw error;
      const [{ data: docs, error: de }, { data: trade, error: te }] = await Promise.all([
        supabase.from("exp_documents").select("*").eq("exp_id", expId).order("sort_order"),
        supabase.from("trade_overview").select("contract_amount, exp_issued").eq("id", exp.trade_id).single(),
      ]);
      if (de) throw de;
      if (te) throw te;
      return { exp: exp as Exp, docs: docs as ExpDoc[], available: Number(trade.contract_amount) - Number(trade.exp_issued) };
    },
  });

  if (isLoading) return <LoadingRows rows={6} />;
  if (error || !data) return <Empty title="EXP not found" body={error ? errMsg(error) : undefined} />;
  const { exp, docs } = data;
  const finals = docs.filter((d) => d.status === "final").length;
  const closed = exp.status === "closed";
  const needsShipment = !exp.shipment_id;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to={`/trades/${exp.trade_id}`} className="num text-[0.8125rem] text-mut hover:text-accent">{exp.trade_code} · {exp.importer_name}</Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <h1 className="h1 num">{exp.code}</h1>
            <Chip status={exp.status} />
            {exp.type === "advance" && <Chip label="Advance" tone="info" dot={false} />}
            {exp.is_demo && <Chip label="Demo" tone="gray" dot={false} />}
          </div>
        </div>
        <Button variant="outline" onClick={() => setEdit(true)}><Pencil /> Edit EXP</Button>
      </div>

      {closed && <div className="banner chip-ok items-center"><Lock className="size-4" /> All six documents are final. This EXP closed automatically and its amount is locked.</div>}
      {needsShipment && (
        <div className="banner chip-warn flex-wrap items-center justify-between">
          <span>Advance EXP. Add the shipment ID before uploading documents.</span>
          <Button size="sm" variant="outline" onClick={() => setEdit(true)}>Add shipment ID</Button>
        </div>
      )}

      <KpiGrid cols={4}>
        <Kpi label="Amount" value={bdtShort(exp.amount)} usdValue={exp.amount_usd} />
        <Kpi label="Shipment" value={exp.shipment_id || "Not set"} sub={[exp.awb_no && `AWB ${exp.awb_no}`, exp.flight_no && `Flight ${exp.flight_no}`, exp.shipment_date && fmtDate(exp.shipment_date)].filter(Boolean).join(" · ") || undefined} />
        <Kpi label="Documents final" value={`${finals}/6`} sub={<Progress value={(finals / 6) * 100} tone={finals === 6 ? "ok" : "accent"} />} />
        <Kpi
          label="Collection"
          value={exp.collection_status === "approved" ? "Collected" : exp.collection_status ? "Pending" : "Not yet"}
          sub={exp.collection_code ? <span className="num">{exp.collection_code}</span> : exp.exp_no ? `EXP no ${exp.exp_no}` : undefined}
        />
      </KpiGrid>

      <Panel title="Documents" right={<span className="text-[0.7812rem] text-mut">Upload, then mark final. Final documents are locked.</span>}>
        <div className="flex flex-col divide-y divide-line/70">
          {docs.map((d, i) => <DocRow key={d.id} n={i + 1} doc={d} disabled={needsShipment} onDone={refresh} />)}
        </div>
      </Panel>
      {edit && <EditExpDialog exp={exp} available={data.available} onClose={() => setEdit(false)} />}
    </>
  );
}

function DocRow({ n, doc, disabled, onDone }: { n: number; doc: ExpDoc; disabled: boolean; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"up" | "final" | null>(null);
  async function upload(f?: File) {
    if (!f) return;
    setBusy("up");
    try {
      const file = await uploadFile(f, "exps");
      await rpc("upload_exp_document", { p_doc: doc.id, p_file: file });
      toast.success(`${doc.doc_type} uploaded`);
      onDone();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
      if (ref.current) ref.current.value = "";
    }
  }
  async function finalize() {
    setBusy("final");
    try {
      await rpc("finalize_exp_document", { p_doc: doc.id });
      toast.success(`${doc.doc_type} marked final`);
      onDone();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }
  const tone = doc.status === "final" ? "bg-ok/10 text-ok" : doc.status === "uploaded" ? "bg-warn/10 text-warn" : "bg-raised text-mut";
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", tone)}>
          {doc.status === "final" ? <CheckCircle2 className="size-4" /> : <FileText className="size-4" />}
        </span>
        <div className="min-w-0">
          <div className="text-[0.875rem] font-medium"><span className="num mr-1.5 text-mut">{n}.</span>{doc.doc_type}</div>
          {(doc.file_path || (doc.is_demo && doc.status !== "missing")) ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <FileLink path={doc.file_path} name={doc.file_name ?? "file"} size={doc.file_size} demo={doc.is_demo} />
              <span className="num text-[0.7188rem] text-mut">{fmtDateTime(doc.finalized_at ?? doc.uploaded_at)}</span>
            </div>
          ) : (
            <div className="text-[0.75rem] text-mut">Not uploaded</div>
          )}
        </div>
      </div>
      <input ref={ref} type="file" className="hidden" accept="image/*,application/pdf" onChange={(e) => upload(e.target.files?.[0])} />
      <div className="flex items-center gap-2">
        <Chip status={doc.status} />
        {doc.status !== "final" ? (
          <>
            <Button size="sm" variant="outline" disabled={disabled || !!busy} onClick={() => ref.current?.click()}>
              {busy === "up" ? <Loader2 className="animate-spin" /> : <Upload />}
              {doc.status === "uploaded" ? "Replace" : "Upload"}
            </Button>
            <Button size="sm" disabled={doc.status !== "uploaded" || !!busy} onClick={finalize}>
              {busy === "final" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
              Mark final
            </Button>
          </>
        ) : (
          <span className="lbl flex items-center gap-1"><Lock className="size-3" /> Locked</span>
        )}
      </div>
    </div>
  );
}
