import { useRef, useState, type ReactNode } from "react";
import * as P from "@radix-ui/react-popover";
import { ArrowUp, Check, CheckCircle2, Download, Eye, FileCheck2, FileClock, History, Loader2, MoreHorizontal, Plus, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { downloadFile, openFile, uploadFile, useProfiles } from "@/lib/api";
import { errMsg, fileSize, fmtDate, fmtDateTime } from "@/lib/format";
import type { UploadedFile } from "@/lib/types";
import { Button, Confirm, Input, Modal, cn } from "./ui";

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
  canFinalAfterAdd?: boolean;
};

/** Stages offered when adding a version. "Other" lets the user type a label. */
export const DEFAULT_STAGES = ["Submitted", "Signed"];

const STATUS: Record<DocStatus, { label: string; pill: string; dot: string; tile: string; icon: string }> = {
  missing: { label: "To upload", pill: "bg-raised text-fg/70", dot: "bg-mut/70", tile: "border-dashed border-mut/40 bg-transparent", icon: "text-mut" },
  uploaded: { label: "In progress", pill: "bg-warn/10 text-warn", dot: "bg-warn", tile: "border-warn/20 bg-warn/[0.08]", icon: "text-warn" },
  final: { label: "Final", pill: "bg-ok/10 text-ok", dot: "bg-ok", tile: "border-ok/20 bg-ok/[0.08]", icon: "text-ok" },
};

const run = (f: () => Promise<unknown>) => () => {
  f().catch((e) => toast.error(errMsg(e)));
};
const done = (verb: string) => verb.toLowerCase().replace("mark ", "marked ");

/* ---------- pieces ---------- */

export function StatusTile({ status, count = 0, small }: { status: DocStatus; count?: number; small?: boolean }) {
  const s = STATUS[status];
  const Icon = status === "final" ? FileCheck2 : status === "uploaded" ? FileClock : ArrowUp;
  return (
    <span className={cn("relative grid shrink-0 place-items-center rounded-[0.8125rem] border", s.tile, small ? "size-10" : "size-11")}>
      <Icon className={cn(s.icon, small ? "size-[1.125rem]" : "size-5")} strokeWidth={1.9} />
      {count > 1 && (
        <span className="num absolute -bottom-1.5 -right-1.5 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full border-2 border-surface bg-fg px-1 text-[0.625rem] font-semibold text-bg">{count}</span>
      )}
    </span>
  );
}

export function StatusPill({ status, finalWord }: { status: DocStatus; finalWord?: string }) {
  const s = STATUS[status];
  return (
    <span className={cn("inline-flex h-[1.375rem] items-center gap-1.5 rounded-full px-2.5 text-[0.75rem] font-medium", s.pill)}>
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {status === "final" && finalWord ? finalWord : s.label}
    </span>
  );
}

function Menu({ items }: { items: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; tone?: "ok"; divider?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Trigger asChild>
        <button type="button" className={cn("grid size-9 shrink-0 place-items-center rounded-full text-mut transition hover:bg-raised hover:text-fg", open && "bg-raised text-fg")} aria-label="More actions">
          <MoreHorizontal className="size-[1.125rem]" />
        </button>
      </P.Trigger>
      <P.Portal>
        <P.Content align="end" sideOffset={6} className="z-50 w-60 animate-in rounded-2xl border border-line bg-surface p-1.5 shadow-[0_12px_32px_rgb(0_0_0/0.12)]">
          {items.map((it) => (
            <div key={it.label}>
              {it.divider && <div className="mx-2 my-1.5 h-px bg-line" />}
              <button
                type="button"
                disabled={it.disabled}
                onClick={() => { setOpen(false); it.onClick(); }}
                className={cn(
                  "flex h-[2.375rem] w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[0.8438rem] transition-colors hover:bg-raised disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4",
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

export function DocCard({ doc, small, defaultOpen }: { doc: DocModel; n?: number; small?: boolean; defaultOpen?: boolean }) {
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
  const hasHistory = doc.versions.length > 0;
  const detail = !latest
    ? "Nothing uploaded yet"
    : `${latest.stage ?? "Uploaded"} · ${isFinal && doc.finalizedAt ? `${(doc.finalWord ?? "final").toLowerCase()} ${fmtDateTime(doc.finalizedAt)}` : `${doc.versions.length > 1 ? "updated " : ""}${fmtDateTime(latest.uploaded_at)}`}`;

  const items = [
    ...(latest ? [
      { label: "View latest", icon: <Eye />, onClick: run(() => openFile(latest.file_path)) },
      { label: "Download latest", icon: <Download />, onClick: run(() => downloadFile(latest.file_path, latest.file_name)) },
    ] : []),
    ...(canAdd ? [{ label: latest ? "Add version" : "Upload", icon: <Upload />, onClick: () => setAdding(true), disabled: !!doc.disabled }] : []),
    ...(doc.extraMenu ?? []),
    ...(hasHistory ? [{ label: open ? "Hide history" : `Version history (${doc.versions.length})`, icon: <History />, onClick: () => setOpen((o) => !o) }] : []),
    ...(finalOpen ? [{ label: verb, icon: <CheckCircle2 />, onClick: () => setFinalizing(true), disabled: !canFinal, tone: "ok" as const, divider: true }] : []),
  ];

  return (
    <article
      className={cn(
        "rounded-2xl border transition-[background-color,border-color,box-shadow] duration-200",
        open ? "border-line bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_rgb(0_0_0/0.06)]" : "border-transparent hover:bg-raised/50",
      )}
    >
      <div className={cn("flex items-center gap-3.5", small ? "py-2.5 pl-3 pr-2" : "py-3 pl-3.5 pr-3")}>
        <StatusTile status={doc.status} count={doc.versions.length} small={small} />
        <button
          type="button"
          disabled={!hasHistory}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 flex-col gap-1 text-left disabled:cursor-default"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn("truncate font-medium", small ? "text-[0.875rem]" : "text-[0.9063rem]")}>{doc.name}</span>
            {doc.tag && <span className="shrink-0 rounded-full bg-raised px-2 py-px text-[0.6875rem] text-fg/70">{doc.tag}</span>}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7812rem]">
            <StatusPill status={doc.status} finalWord={doc.finalWord} />
            <span className="num text-fg/65">{detail}</span>
          </span>
        </button>
        {!latest && canAdd && (
          <Button size="sm" className="rounded-full px-4" disabled={!!doc.disabled} title={doc.disabled ?? undefined} onClick={() => setAdding(true)}><Upload /> Upload</Button>
        )}
        {latest && doc.status === "uploaded" && canAdd && !small && (
          <Button size="sm" variant="outline" className="hidden rounded-full px-3.5 sm:inline-flex" disabled={!!doc.disabled} onClick={() => setAdding(true)}><Plus /> Add version</Button>
        )}
        <Menu items={items} />
      </div>

      <div className={cn("grid transition-[grid-template-rows] duration-300 ease-out", open && hasHistory ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden">
          <div className={cn("mb-3 mr-3 flex flex-col gap-1 rounded-xl bg-raised/60 p-2.5", small ? "ml-3 sm:ml-[3.875rem]" : "ml-3 sm:ml-[4.5rem]")}>
            {doc.versions.map((v, i) => {
              const tone = v.is_final ? "bg-ok/10 text-ok" : i === 0 && !isFinal ? "bg-warn/10 text-warn" : "bg-line/70 text-fg/70";
              return (
                <div key={v.id} className={cn("flex flex-col gap-2 rounded-[0.625rem] px-2.5 py-2 sm:flex-row sm:items-center sm:gap-3", i === 0 && "bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04)]")}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className={cn("num grid size-7 shrink-0 place-items-center rounded-full text-[0.6875rem] font-medium", tone)}>v{v.version}</span>
                    <div className="flex min-w-0 flex-col">
                      <span className="flex flex-wrap items-center gap-1.5 text-[0.8438rem] font-medium">
                        {v.stage || "Uploaded"}
                        {v.badge && <span className="rounded-full bg-raised px-1.5 text-[0.6875rem] font-normal text-fg/70">{v.badge}</span>}
                        {v.is_final && <span className="rounded-full bg-ok/10 px-1.5 text-[0.6875rem] text-ok">{doc.finalWord ?? "Final"}</span>}
                      </span>
                      <span className="num truncate text-[0.75rem] text-mut">
                        {v.submitted_on ? `Submitted ${fmtDate(v.submitted_on)} · ` : ""}uploaded {fmtDateTime(v.uploaded_at)}
                        {v.is_demo ? " · Demo" : profiles[v.uploaded_by ?? ""] ? ` by ${profiles[v.uploaded_by ?? ""]}` : ""}
                      </span>
                      {v.note && <span className="text-[0.75rem] text-fg/75">{v.note}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 pl-10 sm:pl-0">
                    <span className="mr-1 hidden max-w-[12rem] truncate text-[0.75rem] text-mut lg:inline" title={v.file_name}>{v.file_size ? fileSize(v.file_size) : ""}</span>
                    <button type="button" onClick={run(() => openFile(v.file_path))} className="inline-flex h-[1.875rem] items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[0.7812rem] transition-colors hover:border-mut/50"><Eye className="size-3.5" /> View</button>
                    <button type="button" aria-label={`Download version ${v.version}`} onClick={run(() => downloadFile(v.file_path, v.file_name))} className="grid size-[1.875rem] place-items-center rounded-full border border-line bg-surface transition-colors hover:border-mut/50"><Download className="size-3.5" /></button>
                  </div>
                </div>
              );
            })}
            {(canAdd || finalOpen) && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 pb-0.5 pt-2">
                <span className="text-[0.7812rem] text-mut">
                  {doc.finalBlocked ?? (isFinal ? "Add a new version when the contract changes." : `Waiting for the next copy? Add it as version ${(latest?.version ?? 0) + 1}.`)}
                </span>
                <div className="flex gap-1.5">
                  {canAdd && small && <Button size="sm" variant="outline" className="rounded-full" disabled={!!doc.disabled} onClick={() => setAdding(true)}><Plus /> Add version</Button>}
                  {finalOpen && (
                    <button
                      type="button"
                      disabled={!canFinal}
                      onClick={() => setFinalizing(true)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-ok px-3.5 text-[0.7812rem] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      <Check className="size-3.5" strokeWidth={2.6} /> {verb}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

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
            toast.success(`${doc.name} ${done(verb)}`);
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
  const next = (doc.versions[0]?.version ?? 0) + 1;
  const usedSubmitted = doc.versions.some((v) => (v.stage ?? "").toLowerCase().startsWith("submitted"));
  const [choice, setChoice] = useState<string>(usedSubmitted && stages[1] ? stages[1] : stages[0]);
  const [otherText, setOtherText] = useState("");
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [closeAfter, setCloseAfter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const verb = doc.finalVerb ?? "Mark final";
  const canCloseAfter = doc.canFinalAfterAdd !== false && (doc.status !== "final" || !!doc.addAfterFinal);
  const stage = choice === "Other" ? otherText.trim() : choice;

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
      await doc.onAdd({ file, stage, note: note.trim(), submittedOn: date });
      if (closeAfter) await doc.onFinal();
      toast.success(`${doc.name} v${next} submitted${closeAfter ? ` and ${done(verb)}` : ""}`);
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
      title={<span className="flex items-center gap-3"><StatusTile status={doc.status === "missing" ? "missing" : "uploaded"} small />Add version {next}</span>}
      description={`${doc.name} · earlier versions are kept`}
      footer={
        <>
          <Button variant="ghost" className="rounded-full" onClick={onClose}>Cancel</Button>
          <Button className="rounded-full px-5" disabled={!file || !stage || uploading} loading={busy} onClick={submit}>{closeAfter ? `Submit and ${verb.toLowerCase()}` : "Submit"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-[1.125rem]">
        <div className="flex flex-col gap-2">
          <span className="text-[0.8125rem] font-medium">Stage</span>
          <div role="radiogroup" aria-label="Stage" className="grid gap-1 rounded-[0.875rem] bg-raised p-1" style={{ gridTemplateColumns: `repeat(${stages.length + 1}, minmax(0, 1fr))` }}>
            {[...stages, "Other"].map((s) => {
              const on = choice === s;
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setChoice(s)}
                  className={cn("h-[2.375rem] rounded-[0.625rem] text-[0.8438rem] transition-all duration-200", on ? "bg-surface font-semibold text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08),0_2px_8px_rgb(0_0_0/0.06)]" : "text-fg/65 hover:text-fg")}
                >
                  {s}
                </button>
              );
            })}
          </div>
          {choice === "Other" ? (
            <Input autoFocus placeholder="Name this stage, e.g. Bank endorsed" value={otherText} onChange={(e) => setOtherText(e.target.value)} className="rounded-xl" />
          ) : (
            <span className="text-[0.75rem] text-mut">Choose Other to type your own label.</span>
          )}
        </div>

        <input ref={ref} type="file" className="hidden" accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx" onChange={(e) => pick(e.target.files?.[0])} />
        {file ? (
          <div className="flex items-center gap-3.5 rounded-2xl border border-ok/25 bg-ok/[0.05] p-3.5">
            <span className="grid size-11 shrink-0 place-items-center rounded-[0.8125rem] bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.08)]"><FileCheck2 className="size-5 text-ok" /></span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[0.875rem] font-medium">{file.name}</span>
              <span className="text-[0.7812rem] text-ok">Ready · {fileSize(file.size)}</span>
            </div>
            <button type="button" aria-label="Remove file" onClick={() => setFile(null)} className="grid size-8 place-items-center rounded-full text-mut transition-colors hover:bg-raised hover:text-fg"><X className="size-4" /></button>
          </div>
        ) : (
          <div
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}
            className={cn("flex items-center gap-3.5 rounded-2xl border-[1.5px] border-dashed p-4 transition-colors", over ? "border-fg/60 bg-raised" : "border-line bg-bg")}
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-[0.8125rem] bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.08)]">
              {uploading ? <Loader2 className="size-5 animate-spin text-mut" /> : <Upload className="size-5" />}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[0.875rem] font-medium">{uploading ? "Uploading" : "Drop the file here"}</span>
              <span className="text-[0.7812rem] text-mut">PDF, image, Word or Excel, up to 25 MB</span>
            </div>
            <Button size="sm" variant="outline" className="rounded-full px-4" disabled={uploading} onClick={() => ref.current?.click()}>Browse</Button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.8125rem] font-medium">Submitted on</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-xl" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.8125rem] font-medium">Note <span className="font-normal text-mut">(optional)</span></span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything to remember" className="rounded-xl" />
          </label>
        </div>

        {canCloseAfter && (
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-[0.875rem] bg-raised/70 px-4 py-3.5">
            <span className="flex flex-col gap-0.5">
              <span className="text-[0.8438rem] font-medium">{verb} after submitting</span>
              <span className="text-[0.75rem] text-mut">{doc.addAfterFinal ? "This version becomes the signed copy." : "Closes the document. Time is recorded automatically."}</span>
            </span>
            <span className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200", closeAfter ? "bg-ok" : "bg-mut/40")}>
              <input type="checkbox" className="absolute inset-0 m-0 cursor-pointer opacity-0" checked={closeAfter} onChange={(e) => setCloseAfter(e.target.checked)} aria-label={`${verb} after submitting`} />
              <span className={cn("pointer-events-none absolute top-[3px] size-[1.125rem] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-[left] duration-200", closeAfter ? "left-[19px]" : "left-[3px]")} />
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
}

/* ---------- panel ---------- */

function Ring({ value, total }: { value: number; total: number }) {
  const r = 19, c = 2 * Math.PI * r, p = total ? value / total : 0;
  return (
    <span className="relative grid size-[2.875rem] shrink-0 place-items-center">
      <svg viewBox="0 0 46 46" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="23" cy="23" r={r} fill="none" strokeWidth="4.5" className="stroke-raised" />
        <circle cx="23" cy="23" r={r} fill="none" strokeWidth="4.5" strokeLinecap="round" className="stroke-ok transition-[stroke-dashoffset] duration-500" strokeDasharray={c} strokeDashoffset={c * (1 - p)} />
      </svg>
      <span className="num text-[0.6875rem] font-semibold">{value}/{total}</span>
    </span>
  );
}

export function DocList({ docs, small }: { docs: DocModel[]; numbered?: boolean; small?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      {docs.map((d) => <DocCard key={d.key} doc={d} small={small} />)}
    </div>
  );
}

export function DocPanel({ title, docs, hint, empty, actions, banner }: { title: ReactNode; docs: DocModel[]; hint?: ReactNode; numbered?: boolean; empty?: string; actions?: ReactNode; banner?: ReactNode }) {
  const [filter, setFilter] = useState<"all" | DocStatus>("all");
  const count = (s: DocStatus) => docs.filter((d) => d.status === s).length;
  const finals = count("final");
  const shown = docs.filter((d) => filter === "all" || d.status === filter);
  const finalWord = docs[0]?.finalWord ?? "Final";
  const parts = [`${finals} ${finalWord.toLowerCase()}`, count("uploaded") && `${count("uploaded")} in progress`, count("missing") && `${count("missing")} to upload`].filter(Boolean);
  const tabs: { v: "all" | DocStatus; label: string; n: number }[] = [
    { v: "all", label: "All", n: docs.length },
    { v: "uploaded", label: "In progress", n: count("uploaded") },
    { v: "missing", label: "To upload", n: count("missing") },
    { v: "final", label: finalWord, n: finals },
  ];
  return (
    <section className="rounded-[1.25rem] border border-line bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.03),0_12px_32px_rgb(0_0_0/0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 pb-3 pt-5">
        <div className="flex min-w-0 items-center gap-3.5">
          {docs.length > 1 && <Ring value={finals} total={docs.length} />}
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em]">{title}</h2>
            {docs.length > 1 && <span className="text-[0.8125rem] text-mut">{parts.join(" · ")}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {docs.length > 3 && (
            <div role="tablist" aria-label="Filter by status" className="flex gap-0.5 overflow-x-auto rounded-full bg-raised p-1">
              {tabs.map((t) => (
                <button
                  key={t.v}
                  type="button"
                  role="tab"
                  aria-selected={filter === t.v}
                  onClick={() => setFilter(t.v)}
                  className={cn("h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[0.8125rem] transition-all duration-200", filter === t.v ? "bg-surface font-medium text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08),0_1px_6px_rgb(0_0_0/0.06)]" : "text-fg/65 hover:text-fg")}
                >
                  {t.label} <span className="num text-mut">{t.n}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1 px-2.5 pb-3 sm:px-3">
        {banner && <div className="px-1.5 pb-1.5">{banner}</div>}
        {!docs.length && <p className="py-6 text-center text-[0.8125rem] text-mut">{empty ?? "No documents yet."}</p>}
        {shown.map((d) => <DocCard key={d.key} doc={d} />)}
        {docs.length > 0 && !shown.length && <p className="py-6 text-center text-[0.8125rem] text-mut">No documents with this status.</p>}
        {hint && <p className="px-3.5 pb-1 pt-2 text-[0.75rem] text-mut">{hint}</p>}
      </div>
    </section>
  );
}


