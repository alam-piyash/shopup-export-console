import { useRef, useState, type ReactNode } from "react";
import * as P from "@radix-ui/react-popover";
import { Check, CheckCircle2, Download, Eye, History, Loader2, Lock, MoreVertical, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { downloadFile, openFile, uploadFile, useProfiles } from "@/lib/api";
import { errMsg, fileSize, fmtDate, fmtDateTime } from "@/lib/format";
import type { UploadedFile } from "@/lib/types";
import { Button, Confirm, Field, Input, Modal, Select, Textarea, cn } from "./ui";

/* ---------- model ---------- */

export type DocVersion = {
  id: string;
  version: number;
  stage: string | null;
  submitted_on: string | null;
  note: string | null;
  file_path: string;
  file_name: string;
  file_size: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
  is_final: boolean;
  is_demo?: boolean;
  badge?: string | null;
};

export type DocStatus = "missing" | "uploaded" | "final";

export type DocModel = {
  key: string;
  name: string;
  status: DocStatus;
  /** Newest first */
  versions: DocVersion[];
  finalizedAt?: string | null;
  tag?: string | null;
  /** "Final" for most files, "Signed" for the sales contract */
  finalWord?: string;
  /** Verb on the close action, e.g. "Mark final" or "Mark signed" */
  finalVerb?: string;
  /** Allow new versions after the document is final (sales contract amendments) */
  addAfterFinal?: boolean;
  /** Why closing is not possible yet, if it is not */
  finalBlocked?: string | null;
  stages?: string[];
  folder: string;
  disabled?: string | null;
  extraMenu?: { label: string; icon: ReactNode; onClick: () => void }[];
  onAdd: (v: { file: UploadedFile; stage: string; note: string; submittedOn: string }) => Promise<unknown>;
  onFinal: () => Promise<unknown>;
  /** Ask the dialog to close after upload ("Mark final after submitting") */
  canFinalAfterAdd?: boolean;
};

export const DEFAULT_STAGES = ["Submitted copy", "Signed copy", "Signed by both parties and Bangladesh Bank"];

const PILL: Record<DocStatus, { label: string; cls: string }> = {
  missing: { label: "Not uploaded", cls: "bg-raised text-fg/70" },
  uploaded: { label: "In progress", cls: "bg-warn/10 text-warn" },
  final: { label: "Final", cls: "bg-ok/10 text-ok" },
};

const extOf = (name?: string | null) => {
  if (!name) return "";
  const e = (name.split(".").pop() ?? "").toLowerCase();
  if (e === "pdf") return "PDF";
  if (["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(e)) return "IMG";
  if (["doc", "docx"].includes(e)) return "DOC";
  if (["xls", "xlsx", "csv"].includes(e)) return "XLS";
  return e.slice(0, 4).toUpperCase() || "FILE";
};

const run = (f: () => Promise<unknown>) => () => {
  f().catch((e) => toast.error(errMsg(e)));
};

/* ---------- pieces ---------- */

export function FileTile({ name, small }: { name?: string | null; small?: boolean }) {
  return (
    <span className={cn("relative flex shrink-0 items-end justify-center rounded-md border border-line bg-surface shadow-sm", small ? "h-[2.625rem] w-[2.125rem] pb-1" : "h-12 w-10 pb-1.5")}>
      <span className="absolute -right-px -top-px size-3 rounded-bl-[4px] border-b border-l border-line bg-raised" />
      <span className={cn("font-bold tracking-[0.06em] text-mut", small ? "text-[0.5313rem]" : "text-[0.5938rem]")}>{extOf(name)}</span>
    </span>
  );
}

export function StatusPill({ status, finalWord }: { status: DocStatus; finalWord?: string }) {
  const p = PILL[status];
  return <span className={cn("rounded-md px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.07em]", p.cls)}>{status === "final" && finalWord ? finalWord : p.label}</span>;
}

function Menu({ items }: { items: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; tone?: "ok"; divider?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Trigger asChild>
        <button type="button" className={cn("btn btn-ghost btn-icon h-10 w-10", open && "bg-raised")} aria-label="Document actions"><MoreVertical /></button>
      </P.Trigger>
      <P.Portal>
        <P.Content align="end" sideOffset={4} className="z-50 w-60 animate-in rounded-xl border border-line bg-surface p-1.5 shadow-xl">
          {items.map((it) => (
            <div key={it.label}>
              {it.divider && <div className="mx-1 my-1.5 h-px bg-line" />}
              <button
                type="button"
                disabled={it.disabled}
                onClick={() => { setOpen(false); it.onClick(); }}
                className={cn(
                  "flex h-[2.375rem] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[0.8438rem] transition hover:bg-raised disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4",
                  it.tone === "ok" ? "font-medium text-ok [&_svg]:text-ok" : "[&_svg]:text-mut",
                )}
              >
                {it.icon}{it.label}
              </button>
            </div>
          ))}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

/* ---------- card ---------- */

export function DocCard({ doc, n, small, defaultOpen }: { doc: DocModel; n?: number; small?: boolean; defaultOpen?: boolean }) {
  const profiles = useProfiles().data ?? {};
  const [open, setOpen] = useState(!!defaultOpen);
  const [adding, setAdding] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const latest = doc.versions[0];
  const isFinal = doc.status === "final";
  const canAdd = !isFinal || !!doc.addAfterFinal;
  const verb = doc.finalVerb ?? "Mark final";
  const finalOpen = doc.status !== "missing" && !latest?.is_final && (!isFinal || !!doc.addAfterFinal);
  const canFinal = finalOpen && !doc.finalBlocked;
  const stages = doc.stages ?? DEFAULT_STAGES;
  const used = new Set(doc.versions.map((v) => v.stage).filter(Boolean) as string[]);
  const nextStage = stages.find((s) => !used.has(s));
  const when = isFinal && doc.finalizedAt ? `${doc.finalWord ?? "Final"} ${fmtDateTime(doc.finalizedAt)}` : latest ? `${doc.versions.length > 1 ? "Updated" : "Uploaded"} ${fmtDateTime(latest.uploaded_at)}` : "Not uploaded yet";

  const items = [
    ...(latest ? [
      { label: "View latest", icon: <Eye />, onClick: run(() => openFile(latest.file_path)) },
      { label: "Download latest", icon: <Download />, onClick: run(() => downloadFile(latest.file_path, latest.file_name)) },
    ] : []),
    ...(canAdd ? [{ label: latest ? "Add version" : "Upload", icon: <Upload />, onClick: () => setAdding(true), disabled: !!doc.disabled }] : []),
    ...(doc.extraMenu ?? []),
    ...(doc.versions.length ? [{ label: open ? "Hide version history" : `Version history (${doc.versions.length})`, icon: <History />, onClick: () => setOpen((o) => !o) }] : []),
    ...(finalOpen ? [{ label: verb, icon: <CheckCircle2 />, onClick: () => setFinalizing(true), disabled: !canFinal, tone: "ok" as const, divider: true }] : []),
  ];

  return (
    <article className={cn("rounded-xl border bg-surface transition", open ? "border-mut/40 shadow-sm" : "border-line hover:border-mut/40")}>
      <div className={cn("flex items-center gap-4", small ? "px-3.5 py-3" : "px-4 py-3.5")}>
        <FileTile name={latest?.file_name} small={small} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn("truncate font-medium", small ? "text-[0.875rem]" : "text-[0.9375rem]")}>
              {n !== undefined && <span className="num mr-1.5 text-mut">{n}.</span>}{doc.name}
            </span>
            {doc.tag && <span className="shrink-0 rounded-[5px] border border-line px-1.5 py-px text-[0.6875rem] text-fg/70">{doc.tag}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <StatusPill status={doc.status} finalWord={doc.finalWord} />
            {latest && <span className="text-[0.8125rem] text-fg/80"><span className="num text-[0.75rem] font-medium">v{latest.version}</span>{latest.stage ? ` · ${latest.stage}` : ""}</span>}
            <span className="num text-[0.8125rem] text-mut">{when}</span>
          </div>
        </div>
        {!latest && canAdd && (
          <Button size="sm" disabled={!!doc.disabled} title={doc.disabled ?? undefined} onClick={() => setAdding(true)}><Upload /> Upload</Button>
        )}
        {doc.versions.length > 0 && !small && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="hidden h-9 items-center gap-1.5 rounded-lg px-2.5 text-[0.8125rem] text-fg/75 transition hover:bg-raised md:flex">
            <History className="size-[0.9375rem]" /> {doc.versions.length} version{doc.versions.length > 1 ? "s" : ""}
          </button>
        )}
        {isFinal && !doc.addAfterFinal && (
          <span className="hidden items-center gap-1 text-[0.75rem] text-mut sm:flex"><Lock className="size-3" /> Closed</span>
        )}
        <Menu items={items} />
      </div>

      {open && doc.versions.length > 0 && (
        <div className={cn("flex flex-col gap-3.5 border-t border-line py-4 pr-4", small ? "pl-4 sm:pl-[4.25rem]" : "pl-4 sm:pl-[4.5rem]")}>
          <ol className="flex flex-col">
            {doc.versions.map((v, i) => (
              <li key={v.id} className="flex gap-3.5 pb-3.5 last:pb-0">
                <div className="flex w-3 shrink-0 flex-col items-center pt-1.5">
                  <span className={cn("size-2.5 rounded-full ring-[3px]", v.is_final ? "bg-ok ring-ok/15" : i === 0 && !isFinal ? "bg-warn ring-warn/15" : "bg-mut/60 ring-raised")} />
                  {i < doc.versions.length - 1 && <span className="mt-1.5 w-px flex-1 bg-line" />}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num text-[0.75rem] font-medium">v{v.version}</span>
                      <span className="text-[0.875rem] font-medium">{v.stage || "No stage"}</span>
                      {v.badge && <span className="rounded-[5px] border border-line px-1.5 py-px text-[0.6875rem] text-fg/70">{v.badge}</span>}
                      {v.is_final ? (
                        <span className="rounded-[5px] bg-ok/10 px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.07em] text-ok">{doc.finalWord ?? "Final"}</span>
                      ) : i === 0 ? (
                        <span className="rounded-[5px] bg-raised px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.07em] text-fg/70">Latest</span>
                      ) : null}
                    </div>
                    <span className="num text-[0.7812rem] text-mut">
                      {v.submitted_on ? `Submitted on ${fmtDate(v.submitted_on)} · ` : ""}uploaded {fmtDateTime(v.uploaded_at)}{v.is_demo ? " · Demo" : profiles[v.uploaded_by ?? ""] ? ` by ${profiles[v.uploaded_by ?? ""]}` : ""}
                    </span>
                    {v.note && <span className="text-[0.7812rem] text-fg/80">{v.note}</span>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="mr-1 hidden max-w-[14rem] truncate text-[0.7812rem] text-mut lg:inline" title={v.file_name}>{v.file_name}{v.file_size ? ` · ${fileSize(v.file_size)}` : ""}</span>
                    <Button size="sm" variant="outline" onClick={run(() => openFile(v.file_path))}><Eye /> View</Button>
                    <Button size="icon" variant="outline" className="h-8 w-8" aria-label={`Download version ${v.version}`} onClick={run(() => downloadFile(v.file_path, v.file_name))}><Download /></Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {(!isFinal || doc.addAfterFinal) && (
            <div className="flex flex-col gap-3 rounded-[0.625rem] border border-dashed border-line bg-bg px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[0.8125rem] font-medium">{nextStage ? `Next: ${nextStage.charAt(0).toLowerCase()}${nextStage.slice(1)}` : "Next version"}</span>
                <span className="text-[0.7812rem] text-mut">
                  {doc.finalBlocked ? doc.finalBlocked : isFinal ? "Add a new version when the contract changes." : `Add it as version ${(latest?.version ?? 0) + 1}, then ${verb.toLowerCase()} to close this document.`}
                </span>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" disabled={!!doc.disabled} onClick={() => setAdding(true)}><Upload /> Add version</Button>
                {finalOpen && <Button size="sm" disabled={!canFinal} onClick={() => setFinalizing(true)}><Check /> {verb}</Button>}
              </div>
            </div>
          )}
        </div>
      )}

      {adding && <AddVersionDialog doc={doc} onClose={() => setAdding(false)} />}
      <Confirm
        open={finalizing}
        onOpenChange={setFinalizing}
        title={`${verb} ${doc.name}?`}
        body={`Version ${latest?.version ?? 1}${latest?.stage ? ` (${latest.stage})` : ""} becomes the ${(doc.finalWord ?? "final").toLowerCase()} copy${doc.addAfterFinal ? "." : " and the document closes. No more versions can be added."} All ${doc.versions.length} version${doc.versions.length === 1 ? "" : "s"} stay in the history.`}
        confirmLabel={verb}
        onConfirm={async () => {
          try {
            await doc.onFinal();
            toast.success(`${doc.name}: ${verb.toLowerCase().replace("mark ", "marked ")}`);
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </article>
  );
}

/* ---------- add version ---------- */

function AddVersionDialog({ doc, onClose }: { doc: DocModel; onClose: () => void }) {
  const stages = doc.stages ?? DEFAULT_STAGES;
  const used = new Set(doc.versions.map((v) => v.stage).filter(Boolean) as string[]);
  const next = (doc.versions[0]?.version ?? 0) + 1;
  const firstFree = stages.find((s) => !used.has(s));
  const [stage, setStage] = useState(firstFree ?? "");
  const [other, setOther] = useState(!firstFree);
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [closeAfter, setCloseAfter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const verb = doc.finalVerb ?? "Mark final";
  const canCloseAfter = doc.canFinalAfterAdd !== false && doc.status !== "final";

  async function pick(f?: File) {
    if (!f) return;
    setUploading(true);
    try {
      setFile(await uploadFile(f, doc.folder));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setUploading(false);
      if (ref.current) ref.current.value = "";
    }
  }
  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      await doc.onAdd({ file, stage: stage.trim(), note: note.trim(), submittedOn: date });
      if (closeAfter) await doc.onFinal();
      toast.success(`${doc.name} v${next} submitted${closeAfter ? ` and ${verb.toLowerCase().replace("mark ", "marked ")}` : ""}`);
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
      title={`${doc.name} · version ${next}`}
      description="Earlier versions stay as they are. This upload gets its own timestamp."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!file || !stage.trim() || uploading} loading={busy} onClick={submit}>Submit version {next}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-[1.125rem]">
        <div className="flex flex-col gap-2">
          <span className="text-[0.8125rem] font-medium">Stage <span className="text-warn">*</span></span>
          <div className="flex flex-wrap gap-2">
            {stages.map((s) => {
              const on = !other && stage === s;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() => { setOther(false); setStage(s); }}
                  className={cn("flex h-[2.125rem] items-center gap-1.5 rounded-full border px-3 text-[0.8125rem] transition", on ? "border-fg bg-fg font-medium text-bg" : "border-line bg-surface text-fg/80 hover:border-mut/50")}
                >
                  {used.has(s) && !on && <Check className="size-3.5 text-ok" />}
                  {s}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={other}
              onClick={() => { setOther(true); setStage(""); }}
              className={cn("h-[2.125rem] rounded-full border px-3 text-[0.8125rem] transition", other ? "border-fg bg-fg font-medium text-bg" : "border-dashed border-line text-fg/80 hover:border-mut/50")}
            >
              Other stage
            </button>
          </div>
          {other && <Input autoFocus placeholder="Name this stage, e.g. Corrected copy" value={stage} onChange={(e) => setStage(e.target.value)} />}
          {used.size > 0 && <span className="text-[0.75rem] text-mut">Ticks show stages already uploaded for this document.</span>}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[0.8125rem] font-medium">File <span className="text-warn">*</span></span>
          <input ref={ref} type="file" className="hidden" accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx" onChange={(e) => pick(e.target.files?.[0])} />
          {file ? (
            <div className="flex items-center gap-3 rounded-[0.625rem] border border-line px-3 py-2.5">
              <FileTile name={file.name} small />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[0.8438rem] font-medium">{file.name}</span>
                <span className="text-[0.75rem] text-ok">Uploaded · {fileSize(file.size)}</span>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Remove file" onClick={() => setFile(null)}><X /></Button>
            </div>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}
              className={cn("flex flex-col items-center gap-2 rounded-xl border-[1.5px] border-dashed px-4 py-5 text-center transition", over ? "border-fg bg-raised" : "border-line bg-bg")}
            >
              <span className="grid size-10 place-items-center rounded-[0.625rem] border border-line bg-surface">
                {uploading ? <Loader2 className="size-[1.125rem] animate-spin text-mut" /> : <Upload className="size-[1.125rem] text-fg/80" />}
              </span>
              <span className="text-[0.8438rem]">
                <button type="button" className="font-semibold underline underline-offset-2" onClick={() => ref.current?.click()}>Choose a file</button> or drop it here
              </span>
              <span className="text-[0.75rem] text-mut">PDF, image, Word or Excel, up to 25 MB</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Field label="Submitted on">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Upload time">
            <Input value="Recorded automatically" disabled />
          </Field>
        </div>

        <Field label={<>Note <span className="font-normal text-mut">(optional)</span></>}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {canCloseAfter && (
          <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-[0.625rem] border border-line p-3", doc.finalBlocked && "opacity-60")}>
            <input type="checkbox" className="mt-0.5 size-4 accent-current" checked={closeAfter} onChange={(e) => setCloseAfter(e.target.checked)} />
            <span className="flex flex-col gap-0.5">
              <span className="text-[0.8438rem] font-medium">{verb} after submitting</span>
              <span className="text-[0.75rem] text-mut">{doc.addAfterFinal ? "This version becomes the signed copy." : "Closes this document. No more versions can be added."}</span>
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
}

/* ---------- panel ---------- */

export function DocList({ docs, numbered, small }: { docs: DocModel[]; numbered?: boolean; small?: boolean }) {
  return (
    <div className="flex flex-col gap-2.5">
      {docs.map((d, i) => <DocCard key={d.key} doc={d} n={numbered ? i + 1 : undefined} small={small} />)}
    </div>
  );
}

export function DocPanel({ title, docs, hint, numbered = true, empty, actions, banner }: { title: ReactNode; docs: DocModel[]; hint?: ReactNode; numbered?: boolean; empty?: string; actions?: ReactNode; banner?: ReactNode }) {
  const [filter, setFilter] = useState<"all" | DocStatus>("all");
  const finals = docs.filter((d) => d.status === "final").length;
  const shown = docs.map((d, i) => ({ d, i })).filter(({ d }) => filter === "all" || d.status === filter);
  const finalWord = docs[0]?.finalWord ?? "Final";
  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h2 className="text-[1rem] font-semibold">{title}</h2>
            {docs.length > 1 && <span className="text-[0.8125rem] text-mut">{finals} of {docs.length} {finalWord.toLowerCase()}</span>}
          </div>
          {docs.length > 1 && (
            <div className="h-1 w-56 overflow-hidden rounded-full bg-raised"><div className="h-1 bg-ok" style={{ width: `${(finals / docs.length) * 100}%` }} /></div>
          )}
        </div>
        {actions}
        {docs.length > 3 && (
          <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="h-[2.375rem] w-44" aria-label="Filter by status">
            <option value="all">All status</option>
            <option value="missing">Not uploaded</option>
            <option value="uploaded">In progress</option>
            <option value="final">{finalWord}</option>
          </Select>
        )}
      </div>
      <div className="flex flex-col gap-2.5 p-4 sm:px-5 sm:pb-5">
        {banner}
        {!docs.length && <p className="py-6 text-center text-[0.8125rem] text-mut">{empty ?? "No documents yet."}</p>}
        {shown.map(({ d, i }) => <DocCard key={d.key} doc={d} n={numbered ? i + 1 : undefined} />)}
        {docs.length > 0 && !shown.length && <p className="py-6 text-center text-[0.8125rem] text-mut">No documents with this status.</p>}
        {hint && <p className="pt-1 text-[0.75rem] text-mut">{hint}</p>}
      </div>
    </section>
  );
}

