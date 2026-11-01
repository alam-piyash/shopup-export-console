import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Download, Eye, History, Lock, MoreVertical, Pencil, Scale, Upload } from "lucide-react";
import * as P from "@radix-ui/react-popover";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { downloadFile, openFile, rpc, useProfiles, useRefresh } from "@/lib/api";
import { bdt, bdtShort, errMsg, fmtDate, fmtDateTime } from "@/lib/format";
import type { Exp, ExpDoc, ExpDocVersion, UploadedFile } from "@/lib/types";
import { Button, Chip, Confirm, Empty, Field, Input, Select, Kpi, KpiGrid, LoadingRows, Modal, Panel, Progress, Textarea, cn } from "@/components/ui";
import { FileActions, FileField } from "@/components/files";
import { EditExpDialog } from "@/components/expDialogs";
import { AmountChangesPanel, ChangeAmountDialog } from "@/components/expAmount";

export default function ExpDetail() {
  const { expId = "" } = useParams();
  const [edit, setEdit] = useState(false);
  const [changing, setChanging] = useState(false);
  const [docFilter, setDocFilter] = useState("all");
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
      {needsShipment && (
        <div className="banner chip-warn flex-wrap items-center justify-between">
          <span>Advance EXP. Add the shipment ID before uploading documents.</span>
          <Button size="sm" variant="outline" onClick={() => setEdit(true)}>Add shipment ID</Button>
        </div>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label={exp.amount_changes ? "Amount (updated)" : "Amount"}
          value={bdtShort(exp.amount)}
          usdValue={exp.amount_usd}
          sub={exp.issued_amount !== undefined && Number(exp.issued_amount) !== Number(exp.amount) ? <>Issued on EXP <span className="num">{bdt(exp.issued_amount)}</span></> : "Same as issued on EXP"}
        />
        <Kpi label="Shipment" value={exp.shipment_id || "Not set"} sub={[exp.awb_no && `AWB ${exp.awb_no}`, exp.flight_no && `Flight ${exp.flight_no}`, exp.shipment_date && fmtDate(exp.shipment_date)].filter(Boolean).join(" · ") || undefined} />
        <Kpi label="Documents final" value={`${finals}/${total}`} sub={<Progress value={(finals / total) * 100} tone={finals === total ? "ok" : "accent"} />} />
        <Kpi
          label="Collection"
          value={exp.collection_status === "approved" ? "Collected" : exp.collection_status ? "Pending" : "Not yet"}
          sub={exp.collection_code ? <span className="num">{exp.collection_code}</span> : exp.exp_no ? `EXP no ${exp.exp_no}` : undefined}
        />
      </KpiGrid>

      <AmountChangesPanel exp={exp} />
      <Panel
        title="Documents"
        right={
          <Select value={docFilter} onChange={(e) => setDocFilter(e.target.value)} className="h-9 w-40">
            <option value="all">All status</option>
            <option value="missing">Not uploaded</option>
            <option value="uploaded">In progress</option>
            <option value="final">Final</option>
          </Select>
        }
      >
        <div className="flex flex-col gap-2.5 p-4">
          {docs.map((d, i) => ({ d, i })).filter(({ d }) => docFilter === "all" || d.status === docFilter).map(({ d, i }) => (
            <DocRow key={d.id} n={i + 1} doc={d} versions={data.versions.filter((v) => v.doc_id === d.id)} disabled={needsShipment} onDone={refresh} />
          ))}
          {docFilter !== "all" && !docs.some((d) => d.status === docFilter) && <p className="py-6 text-center text-[0.8125rem] text-mut">No documents with this status.</p>}
          <p className="pt-1 text-[0.75rem] text-mut">Add a version at each stage (submitted copy, signed copy, signed by both parties and Bangladesh Bank). Earlier versions are kept. Mark final to close the document.</p>
        </div>
      </Panel>
      {changing && <ChangeAmountDialog exp={exp} limitLeft={data.limitLeft} onClose={() => setChanging(false)} />}
      {edit && <EditExpDialog exp={exp} available={data.available} onClose={() => setEdit(false)} />}
    </>
  );
}

const STAGES = ["Submitted copy", "Signed copy", "Signed by both parties and Bangladesh Bank", "Bank endorsed copy", "Corrected copy"];

const PILL: Record<string, { label: string; cls: string }> = {
  missing: { label: "Not uploaded", cls: "bg-raised text-mut" },
  uploaded: { label: "In progress", cls: "bg-warn/10 text-warn" },
  final: { label: "Final", cls: "bg-ok/10 text-ok" },
};

function FileTile({ name }: { name?: string | null }) {
  const ext = (name?.split(".").pop() ?? "").toLowerCase();
  const label = !name ? "" : ext === "pdf" ? "PDF" : ["png", "jpg", "jpeg", "webp", "gif"].includes(ext) ? "IMG" : ext.slice(0, 4).toUpperCase() || "FILE";
  return (
    <span className="relative grid h-12 w-10 shrink-0 place-items-end justify-center rounded-md border border-line bg-surface pb-1.5 shadow-sm">
      <span className="absolute right-0 top-0 size-3 rounded-bl-[4px] border-b border-l border-line bg-raised" />
      <span className="text-[0.625rem] font-semibold tracking-wide text-mut">{label}</span>
    </span>
  );
}

function DocMenu({ items }: { items: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; strong?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Trigger asChild>
        <button className="btn btn-ghost btn-icon h-9 w-9" aria-label="Document actions"><MoreVertical /></button>
      </P.Trigger>
      <P.Portal>
        <P.Content align="end" sideOffset={4} className="z-50 w-56 animate-in rounded-xl border border-line bg-surface p-1 shadow-xl">
          {items.map((it) => (
            <button
              key={it.label}
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick(); }}
              className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[0.8438rem] transition hover:bg-raised disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:text-mut", it.strong && "font-medium")}
            >
              {it.icon}{it.label}
            </button>
          ))}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

function DocRow({ n, doc, versions, disabled, onDone }: { n: number; doc: ExpDoc; versions: ExpDocVersion[]; disabled: boolean; onDone: () => void }) {
  const profiles = useProfiles().data ?? {};
  const [adding, setAdding] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [open, setOpen] = useState(false);
  const latest = versions[0];
  const isFinal = doc.status === "final";
  const pill = PILL[doc.status] ?? PILL.missing;
  const filePath = latest?.file_path ?? doc.file_path;
  const fileName = latest?.file_name ?? doc.file_name ?? "file";
  const when = isFinal ? doc.finalized_at : latest?.uploaded_at ?? doc.uploaded_at;
  const run = (f: () => Promise<void>) => () => { f().catch((e) => toast.error(errMsg(e))); };
  return (
    <div className="rounded-xl border border-line bg-surface transition hover:border-mut/40">
      <div className="flex items-center gap-4 px-4 py-3.5">
        <FileTile name={filePath ? fileName : null} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.9375rem] font-medium"><span className="num mr-1.5 text-mut">{n}.</span>{doc.doc_type}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className={cn("rounded-md px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider", pill.cls)}>{pill.label}</span>
            {latest && <span className="text-[0.7812rem] text-fg/80"><span className="num">v{latest.version}</span>{latest.stage ? ` · ${latest.stage}` : ""}</span>}
            {when && <span className="num text-[0.7812rem] text-mut">{fmtDateTime(when)}</span>}
          </div>
        </div>
        {!isFinal && !filePath && (
          <Button size="sm" variant="outline" className="hidden sm:inline-flex" disabled={disabled} onClick={() => setAdding(true)}><Upload /> Upload</Button>
        )}
        <DocMenu
          items={[
            ...(filePath ? [
              { label: "View latest", icon: <Eye />, onClick: run(() => openFile(filePath)) },
              { label: "Download latest", icon: <Download />, onClick: run(() => downloadFile(filePath, fileName)) },
            ] : []),
            ...(!isFinal ? [{ label: filePath ? "Add version" : "Upload", icon: <Upload />, onClick: () => setAdding(true), disabled, strong: true }] : []),
            ...(versions.length ? [{ label: open ? "Hide version history" : `Version history (${versions.length})`, icon: <History />, onClick: () => setOpen((o) => !o) }] : []),
            ...(!isFinal ? [{ label: "Mark final", icon: <CheckCircle2 />, onClick: () => setFinalizing(true), disabled: doc.status !== "uploaded" }] : []),
          ]}
        />
      </div>
      {open && versions.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <ol className="flex flex-col">
            {versions.map((v, i) => (
              <li key={v.id} className="relative flex gap-3 pb-3 last:pb-0">
                {i < versions.length - 1 && <span className="absolute left-[0.3125rem] top-4 h-full w-px bg-line" />}
                <span className={cn("relative mt-1.5 size-[0.6875rem] shrink-0 rounded-full border-2 border-surface", v.is_final ? "bg-ok" : i === 0 ? "bg-warn" : "bg-mut")} />
                <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 text-[0.8125rem]">
                    <span className="num font-medium">v{v.version}</span> <span>{v.stage || "No stage"}</span>
                    {v.is_final && <span className="ml-2 rounded-md bg-ok/10 px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wider text-ok">Final</span>}
                    <div className="num text-[0.7188rem] text-mut">
                      Uploaded {fmtDateTime(v.uploaded_at)}{v.submitted_on ? ` · submitted ${fmtDate(v.submitted_on)}` : ""} · {v.is_demo ? "Demo" : profiles[v.uploaded_by ?? ""] ?? ""}
                    </div>
                    {v.note && <div className="text-[0.75rem] text-mut">{v.note}</div>}
                  </div>
                  <FileActions path={v.file_path} name={v.file_name} />
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
      {adding && <AddVersionDialog doc={doc} next={(versions[0]?.version ?? (doc.file_path ? 1 : 0)) + 1} onClose={() => setAdding(false)} onDone={onDone} />}
      <Confirm
        open={finalizing}
        onOpenChange={setFinalizing}
        title={`Mark ${doc.doc_type} final?`}
        body={`Version ${latest?.version ?? 1}${latest?.stage ? ` (${latest.stage})` : ""} becomes the final copy and the document lifecycle closes. No more versions can be added.`}
        confirmLabel="Mark final"
        onConfirm={async () => {
          try {
            await rpc("finalize_exp_document", { p_doc: doc.id });
            toast.success(`${doc.doc_type} marked final`);
            onDone();
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}

function AddVersionDialog({ doc, next, onClose, onDone }: { doc: ExpDoc; next: number; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [stage, setStage] = useState(next === 1 ? STAGES[0] : next === 2 ? STAGES[1] : STAGES[2]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await rpc("upload_exp_document", { p_doc: doc.id, p_file: file, p_stage: stage, p_note: note || null, p_submitted_on: date || null });
      toast.success(`${doc.doc_type} v${next} submitted`);
      onDone();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${doc.doc_type}: version ${next}`}
      description="Each version is kept with its timestamp. Earlier versions are never replaced."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!file || !stage.trim()} loading={busy} onClick={submit}>Submit version</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FileField label="Document copy" folder="exps" value={file} onChange={setFile} required />
        <datalist id="doc-stages">{STAGES.map((s) => <option key={s} value={s} />)}</datalist>
        <Field label="Stage" required hint="Pick one or type your own">
          <Input list="doc-stages" value={stage} onChange={(e) => setStage(e.target.value)} />
        </Field>
        <Field label="Submitted on" hint="The date this copy was submitted or received">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Note (optional)">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
